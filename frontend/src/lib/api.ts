// Empty default → relative URLs, served through Vite dev-proxy in development
// and same-origin in production. Set VITE_API_BASE_URL to point at a separate
// backend host (e.g. on Railway).
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const TOKEN_KEY = "mindshift.token";

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = tokenStorage.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const rawDetail =
      data && typeof data === "object" && "detail" in data
        ? (data as { detail?: unknown }).detail
        : null;
    let message: string;
    if (typeof rawDetail === "string") {
      message = rawDetail;
    } else if (Array.isArray(rawDetail)) {
      message = rawDetail
        .map((d: unknown) =>
          d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d),
        )
        .join("; ");
    } else {
      message = response.statusText;
    }
    throw new ApiError(response.status, message, data);
  }
  return data as T;
}

export type CardStatus = "queued" | "processing" | "completed" | "failed";

export interface CardListItem {
  id: string;
  title: string;
  source_type: string;
  status: CardStatus;
  thumbnail_url: string | null;
  concise_summary_md: string | null;
  created_at: string;
  updated_at: string;
}

export interface Card extends CardListItem {
  user_id: string;
  source_id: string | null;
  detailed_summary_md: string | null;
  key_takeaways_json: string[] | null;
  notes_md: string | null;
  error_message: string | null;
}

export interface JobOut {
  id: string;
  card_id: string | null;
  job_type: string;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuizQuestion {
  id: string;
  card_id: string;
  question: string;
  answer: string;
  question_type: string;
  difficulty: string | null;
}

export const api = {
  register: (email: string, password: string, displayName?: string) =>
    request<{ access_token: string; token_type: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name: displayName }),
    }),
  login: (email: string, password: string) =>
    request<{ access_token: string; token_type: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<{ id: string; email: string; display_name: string | null }>("/api/auth/me"),

  listCards: (params: { q?: string; status?: string; tag?: string; untagged?: boolean; sort?: string } = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "" || v === false) return;
      search.set(k, String(v));
    });
    const qs = search.toString();
    return request<CardListItem[]>(`/api/cards${qs ? `?${qs}` : ""}`);
  },
  getCard: (id: string) => request<Card>(`/api/cards/${id}`),
  createFromYouTube: (url: string) =>
    request<{ card: Card; job: JobOut }>("/api/cards/from-youtube", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  createFromUrl: (url: string) =>
    request<{ card: Card; job: JobOut }>("/api/cards/from-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  createFromPdf: async (file: File, title?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);
    const headers: Record<string, string> = {};
    const token = tokenStorage.get();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const response = await fetch(`${BASE_URL}/api/cards/from-pdf`, {
      method: "POST",
      body: form,
      headers,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        data && typeof data === "object" && "detail" in data
          ? String((data as { detail?: unknown }).detail)
          : response.statusText;
      throw new ApiError(response.status, detail, data);
    }
    return data as { card: Card; job: JobOut };
  },
  updateNotes: (id: string, notes: string) =>
    request<Card>(`/api/cards/${id}/notes`, {
      method: "PATCH",
      body: JSON.stringify({ notes_md: notes }),
    }),
  deleteCard: (id: string) =>
    request<void>(`/api/cards/${id}`, { method: "DELETE" }),
  getTranscript: (id: string) =>
    request<{ card_id: string; language: string | null; provider: string | null; text: string }>(
      `/api/cards/${id}/transcript`,
    ),
  getQuiz: (id: string) => request<QuizQuestion[]>(`/api/cards/${id}/quiz`),
  getJob: (id: string) => request<JobOut>(`/api/jobs/${id}`),
  searchKeyword: (q: string, limit = 20) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    return request<SearchHit[]>(`/api/search?${params.toString()}`);
  },
  searchSemantic: (query: string, limit = 10) =>
    request<SearchHit[]>("/api/search/semantic", {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    }),
  chatCard: (cardId: string, messages: ChatMessage[], sessionId?: string) =>
    request<ChatResponse>(`/api/cards/${cardId}/chat`, {
      method: "POST",
      body: JSON.stringify({ messages, session_id: sessionId }),
    }),
  chatKb: (messages: ChatMessage[], topK = 5, sessionId?: string) =>
    request<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages, top_k: topK, session_id: sessionId }),
    }),
  listChatSessions: (cardId?: string) => {
    const qs = cardId ? `?card_id=${cardId}` : "";
    return request<ChatSessionItem[]>(`/api/chat/sessions${qs}`);
  },
  getChatSession: (id: string) =>
    request<ChatSessionDetail>(`/api/chat/sessions/${id}`),
  createChatSession: (cardId?: string, title?: string) =>
    request<ChatSessionItem>("/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify({ card_id: cardId, title }),
    }),
  renameChatSession: (id: string, title: string) =>
    request<ChatSessionItem>(`/api/chat/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  deleteChatSession: (id: string) =>
    request<void>(`/api/chat/sessions/${id}`, { method: "DELETE" }),
  reviewQueue: (limit = 20) => request<ReviewQueueItem[]>(`/api/review/queue?limit=${limit}`),
  reviewStats: () => request<ReviewStats>("/api/review/stats"),
  submitReviewAnswer: (questionId: string, rating: ReviewRating) =>
    request<AnswerResponse>(`/api/review/${questionId}/answer`, {
      method: "POST",
      body: JSON.stringify({ rating }),
    }),
  regenerateCard: (id: string) =>
    request<{ card: Card; job: JobOut }>(`/api/cards/${id}/regenerate`, { method: "POST" }),
  listTags: () => request<TagWithCount[]>("/api/tags"),
  tagsTree: () => request<TagsTree>("/api/tags/tree"),
  untaggedCount: () => request<{ count: number }>("/api/tags/untagged-count"),
  assignTag: (tagId: string, cardId: string) =>
    request<void>(`/api/tags/${tagId}/assign`, {
      method: "POST",
      body: JSON.stringify({ tag_id: tagId, card_id: cardId }),
    }),
  unassignTag: (tagId: string, cardId: string) =>
    request<void>(`/api/tags/${tagId}/assign/${cardId}`, { method: "DELETE" }),
  createTag: (name: string, parentId?: string | null) =>
    request<TagWithCount>("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name, parent_id: parentId ?? null }),
    }),
  updateTag: (id: string, body: { name?: string; parent_id?: string | null }) =>
    request<TagWithCount>(`/api/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTag: (id: string) => request<void>(`/api/tags/${id}`, { method: "DELETE" }),
  exportCardMarkdownUrl: (id: string) => `${BASE_URL}/api/cards/${id}/export.md`,
  cardConnections: (id: string, limit = 10) =>
    request<Connection[]>(`/api/cards/${id}/connections?limit=${limit}`),
  globalGraph: (params: {
    source_type?: string;
    tag?: string;
    edges_per_card?: number;
    min_score?: number;
    created_after?: string;
    created_before?: string;
  } = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
    });
    const qs = search.toString();
    return request<GraphView>(`/api/graph${qs ? `?${qs}` : ""}`);
  },
  graphPath: (fromId: string, toId: string, maxHops = 6) =>
    request<{ path: string[]; found: boolean; hops: number }>("/api/graph/path", {
      method: "POST",
      body: JSON.stringify({ from_id: fromId, to_id: toId, max_hops: maxHops }),
    }),
};

export interface GraphNode {
  id: string;
  title: string;
  source_type: string;
  thumbnail_url: string | null;
  tags: string[];
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  score: number;
  reasons: ConnectionReason[];
}

export interface GraphView {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ConnectionReason {
  kind: "semantic" | "entity" | "tag" | "relation";
  label: string;
  weight: number;
}

export interface Connection {
  card_id: string;
  title: string;
  source_type: string;
  thumbnail_url: string | null;
  tags: string[];
  score: number;
  reasons: ConnectionReason[];
}

export interface TagWithCount {
  id: string;
  name: string;
  parent_id: string | null;
  count: number;
}

export interface TagCard {
  id: string;
  title: string;
  source_type: string;
  status: CardStatus;
  thumbnail_url: string | null;
}

export interface TagWithCards {
  id: string;
  name: string;
  parent_id: string | null;
  count: number;
  cards: TagCard[];
}

export interface TagsTree {
  tags: TagWithCards[];
  untagged: TagCard[];
}

export type ReviewRating = "again" | "hard" | "good" | "easy";
export type ReviewStage = "new" | "learning" | "practiced" | "confident" | "mastered";

export interface ReviewQueueItem {
  id: string;
  card_id: string;
  card_title: string;
  question: string;
  answer: string;
  question_type: string;
  difficulty: string | null;
  stage: ReviewStage;
  interval_days: number;
  lapses: number;
  last_reviewed_at: string | null;
  next_due_at: string | null;
  created_at: string;
}

export interface ReviewStats {
  total: number;
  due_now: number;
  new: number;
  learning: number;
  practiced: number;
  confident: number;
  mastered: number;
}

export interface AnswerResponse {
  question_id: string;
  rating: ReviewRating;
  stage: ReviewStage;
  interval_days: number;
  next_due_at: string;
  lapses: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Citation {
  index: number;
  card_id: string;
  title: string;
  source_type: string;
  chunk_index: number | null;
  snippet: string;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  session_id: string | null;
}

export interface ChatSessionItem {
  id: string;
  title: string;
  card_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface PersistedChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations_json: Citation[] | null;
  created_at: string;
}

export interface ChatSessionDetail {
  id: string;
  title: string;
  card_id: string | null;
  created_at: string;
  updated_at: string;
  messages: PersistedChatMessage[];
}

export interface SearchHit {
  card_id: string;
  title: string;
  source_type: string;
  thumbnail_url: string | null;
  snippet: string;
  chunk_type: string | null;
  chunk_index: number | null;
  score: number;
  created_at: string;
}
