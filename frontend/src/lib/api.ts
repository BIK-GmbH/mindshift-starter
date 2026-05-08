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

async function uploadFile<T>(path: string, file: File, fieldName = "file"): Promise<T> {
  const form = new FormData();
  form.append(fieldName, file);
  const headers: Record<string, string> = {};
  const token = tokenStorage.get();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}${path}`, { method: "POST", body: form, headers });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? String((data as { detail?: unknown }).detail)
        : response.statusText;
    throw new ApiError(response.status, detail, data);
  }
  return data as T;
}

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
  original_file_id: string | null;
  detailed_summary_md: string | null;
  key_takeaways_json: string[] | null;
  notes_md: string | null;
  error_message: string | null;
  tags?: string[];
  is_public?: boolean;
  public_via_tags?: string[];
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
  me: () => request<UserOut>("/api/auth/me"),

  listCards: (params: {
    q?: string;
    status?: string;
    tag?: string;
    untagged?: boolean;
    source_type?: string;
    sort?: "newest" | "oldest" | "title";
  } = {}) => {
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
  createFromNote: (title: string, body: string, summarize = false) =>
    request<{ card: Card; job: JobOut }>("/api/cards/from-note", {
      method: "POST",
      body: JSON.stringify({ title, body, summarize }),
    }),
  wikiSearch: (q: string, lang: "en" | "de" = "en", limit = 8) => {
    const params = new URLSearchParams({ q, lang, limit: String(limit) });
    return request<WikiHit[]>(`/api/wiki/search?${params.toString()}`);
  },
  importBookmarks: async (file: File) => uploadFile<ImportSummary>("/api/import/bookmarks", file),
  importMarkdown: async (file: File) => uploadFile<ImportSummary>("/api/import/markdown", file),
  getShare: (cardId: string) => request<ShareOut | null>(`/api/cards/${cardId}/share`),
  createShare: (cardId: string) =>
    request<ShareOut>(`/api/cards/${cardId}/share`, { method: "POST" }),
  revokeShare: (cardId: string) =>
    request<void>(`/api/cards/${cardId}/share`, { method: "DELETE" }),
  getPublicCard: (token: string) => request<PublicCard>(`/api/public/share/${token}`),
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
  exportMarkdownUrl: () => `${BASE_URL}/api/export/markdown`,
  fileDownloadUrl: (fileId: string) => `${BASE_URL}/api/files/${fileId}`,
  publicAvatarUrl: (fileId: string) => `${BASE_URL}/api/public/avatars/${fileId}`,
  updateProfile: (body: {
    display_name?: string | null;
    username?: string | null;
    bio?: string | null;
    public_profile?: boolean | null;
  }) =>
    request<UserOut>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  uploadAvatar: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const headers: Record<string, string> = {};
    const token = tokenStorage.get();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}/api/auth/me/avatar`, { method: "POST", body: form, headers });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail =
        data && typeof data === "object" && "detail" in data
          ? String((data as { detail?: unknown }).detail)
          : res.statusText;
      throw new ApiError(res.status, detail, data);
    }
    return data as UserOut;
  },
  removeAvatar: () => request<UserOut>("/api/auth/me/avatar", { method: "DELETE" }),
  getPublicProfile: (username: string) =>
    request<PublicProfileOut>(`/api/public/users/${encodeURIComponent(username)}`),
  getPublicTag: (username: string, slug: string) =>
    request<PublicTagDetail>(
      `/api/public/users/${encodeURIComponent(username)}/tags/${encodeURI(slug)}`,
    ),
  getPublicProfileCard: (username: string, cardId: string) =>
    request<PublicCard>(
      `/api/public/users/${encodeURIComponent(username)}/cards/${cardId}`,
    ),
  getPublicCardReactions: (username: string, cardId: string) =>
    request<ReactionsState>(
      `/api/public/users/${encodeURIComponent(username)}/cards/${cardId}/reactions`,
    ),
  reactToPublicCard: (username: string, cardId: string, kind: ReactionKind) =>
    request<ReactionsState & { kind: ReactionKind; active: boolean }>(
      `/api/public/users/${encodeURIComponent(username)}/cards/${cardId}/reactions`,
      { method: "POST", body: JSON.stringify({ kind }) },
    ),
  publicTagRssUrl: (username: string, slug: string) =>
    `${BASE_URL || window.location.origin}/api/public/users/${encodeURIComponent(username)}/feeds/${encodeURI(slug)}.rss`,
  createExtensionToken: () =>
    request<{ access_token: string; token_type: string }>("/api/auth/extension-token", {
      method: "POST",
    }),
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
  updateTag: (
    id: string,
    body: { name?: string; parent_id?: string | null; is_public?: boolean },
  ) =>
    request<TagWithCount>(`/api/tags/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTag: (id: string) => request<void>(`/api/tags/${id}`, { method: "DELETE" }),
  listGraphPresets: () => request<GraphPresetOut[]>("/api/graph-presets"),
  createGraphPreset: (name: string, settings: GraphPresetSettings) =>
    request<GraphPresetOut>("/api/graph-presets", {
      method: "POST",
      body: JSON.stringify({ name, settings }),
    }),
  deleteGraphPreset: (id: string) =>
    request<void>(`/api/graph-presets/${id}`, { method: "DELETE" }),
  listLearningSessions: (limit = 200) =>
    request<LearningSessionItem[]>(`/api/review/sessions?limit=${limit}`),
  getLearningSession: (id: string) => request<SessionDetail>(`/api/review/sessions/${id}`),
  reviewActivity: (days = 365) =>
    request<ActivityDay[]>(`/api/review/activity?days=${days}`),
  transformText: (
    text: string,
    action: "expand" | "shorten" | "custom",
    instruction?: string,
  ) =>
    request<{ text: string }>("/api/ai/transform", {
      method: "POST",
      body: JSON.stringify({ text, action, instruction }),
    }),
  getCardAudio: (cardId: string) =>
    request<CardAudioOut>(`/api/cards/${cardId}/audio`),
  generateCardAudio: (cardId: string, voice?: string) =>
    request<CardAudioOut>(`/api/cards/${cardId}/audio`, {
      method: "POST",
      body: JSON.stringify({ voice }),
    }),
  deleteCardAudio: (cardId: string) =>
    request<void>(`/api/cards/${cardId}/audio`, { method: "DELETE" }),
  cardAudioStreamUrl: (cardId: string) =>
    `${BASE_URL}/api/cards/${cardId}/audio.wav`,
  // Podcast playlists
  listPlaylists: () => request<PodcastPlaylistOut[]>("/api/podcasts/playlists"),
  createPlaylist: (name: string, description?: string) =>
    request<PodcastPlaylistOut>("/api/podcasts/playlists", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  getPlaylist: (id: string) =>
    request<PodcastPlaylistDetail>(`/api/podcasts/playlists/${id}`),
  updatePlaylist: (
    id: string,
    body: {
      name?: string;
      description?: string;
      draft_title?: string | null;
      draft_narrative_text?: string | null;
      draft_target_minutes?: number | null;
    },
  ) =>
    request<PodcastPlaylistOut>(`/api/podcasts/playlists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deletePlaylist: (id: string) =>
    request<void>(`/api/podcasts/playlists/${id}`, { method: "DELETE" }),
  addPlaylistCard: (id: string, cardId: string) =>
    request<PodcastPlaylistDetail>(`/api/podcasts/playlists/${id}/cards`, {
      method: "POST",
      body: JSON.stringify({ card_id: cardId }),
    }),
  addPlaylistCardsBulk: (id: string, cardIds: string[]) =>
    request<PodcastPlaylistDetail>(`/api/podcasts/playlists/${id}/cards/bulk`, {
      method: "POST",
      body: JSON.stringify({ card_ids: cardIds }),
    }),
  removePlaylistCard: (id: string, cardId: string) =>
    request<PodcastPlaylistDetail>(
      `/api/podcasts/playlists/${id}/cards/${cardId}`,
      { method: "DELETE" },
    ),
  reorderPlaylist: (id: string, cardIds: string[]) =>
    request<PodcastPlaylistDetail>(`/api/podcasts/playlists/${id}/reorder`, {
      method: "POST",
      body: JSON.stringify({ card_ids: cardIds }),
    }),
  suggestCoverMeta: (title: string, narrativeText: string) =>
    request<{ cover_style: string; cover_text: string }>(
      "/api/podcasts/episodes/cover-suggest",
      {
        method: "POST",
        body: JSON.stringify({ title, narrative_text: narrativeText }),
      },
    ),
  draftEpisode: (playlistId: string, targetMinutes = 5, language?: string) =>
    request<{ title: string; narrative_text: string }>(
      `/api/podcasts/playlists/${playlistId}/episodes/draft`,
      {
        method: "POST",
        body: JSON.stringify({
          target_minutes: targetMinutes,
          language: language || undefined,
        }),
      },
    ),
  produceEpisode: (
    playlistId: string,
    body: {
      title: string;
      narrative_text: string;
      voice?: string;
      generate_cover?: boolean;
      cover_prompt?: string;
      cover_style?: string;
      cover_text?: string;
    },
  ) =>
    request<PodcastEpisodeOut>(
      `/api/podcasts/playlists/${playlistId}/episodes`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  deleteEpisode: (playlistId: string, episodeId: string) =>
    request<void>(
      `/api/podcasts/playlists/${playlistId}/episodes/${episodeId}`,
      { method: "DELETE" },
    ),
  retryEpisode: (playlistId: string, episodeId: string) =>
    request<PodcastEpisodeOut>(
      `/api/podcasts/playlists/${playlistId}/episodes/${episodeId}/retry`,
      { method: "POST" },
    ),

  episodeAudioUrl: (episodeId: string) =>
    `${BASE_URL}/api/podcasts/episodes/${episodeId}/audio.wav`,
  episodeCoverUrl: (episodeId: string) =>
    `${BASE_URL}/api/podcasts/episodes/${episodeId}/cover.png`,
  getEpisodeShare: (episodeId: string) =>
    request<EpisodeShareOut | null>(
      `/api/podcasts/episodes/${episodeId}/share`,
    ),
  createEpisodeShare: (episodeId: string) =>
    request<EpisodeShareOut>(`/api/podcasts/episodes/${episodeId}/share`, {
      method: "POST",
    }),
  revokeEpisodeShare: (episodeId: string) =>
    request<void>(`/api/podcasts/episodes/${episodeId}/share`, { method: "DELETE" }),
  publicEpisode: (token: string) =>
    request<PublicEpisodeOut>(`/api/public/episodes/${token}`),
  publicEpisodeAudioUrl: (token: string) =>
    `${BASE_URL}/api/public/episodes/${token}/audio.wav`,
  publicEpisodeCoverUrl: (token: string) =>
    `${BASE_URL}/api/public/episodes/${token}/cover.png`,
  listTranslations: (cardId: string) =>
    request<CardTranslationOut[]>(`/api/cards/${cardId}/translations`),
  createTranslation: (cardId: string, language: string) =>
    request<CardTranslationOut>(`/api/cards/${cardId}/translations`, {
      method: "POST",
      body: JSON.stringify({ language }),
    }),
  getTranslation: (cardId: string, language: string) =>
    request<CardTranslationOut>(
      `/api/cards/${cardId}/translations/${encodeURIComponent(language)}`,
    ),
  deleteTranslation: (cardId: string, language: string) =>
    request<void>(
      `/api/cards/${cardId}/translations/${encodeURIComponent(language)}`,
      { method: "DELETE" },
    ),
  createPlaylistFromTag: (
    tagName: string,
    options: { include_subtags?: boolean; name?: string } = {},
  ) =>
    request<PodcastPlaylistOut>(`/api/podcasts/playlists/from-tag`, {
      method: "POST",
      body: JSON.stringify({
        tag_name: tagName,
        include_subtags: options.include_subtags ?? true,
        name: options.name,
      }),
    }),
  exportCardMarkdownUrl: (id: string) => `${BASE_URL}/api/cards/${id}/export.md`,
  cardConnections: (id: string, limit = 10) =>
    request<Connection[]>(`/api/cards/${id}/connections?limit=${limit}`),
  globalGraph: (params: {
    source_type?: string;
    tags?: string[];
    edges_per_card?: number;
    min_score?: number;
    created_after?: string;
    created_before?: string;
  } = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item !== undefined && item !== null && item !== "") search.append(k, String(item));
        }
      } else {
        search.set(k, String(v));
      }
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
  is_public?: boolean;
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
  is_public?: boolean;
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
  choices_json: string[] | null;
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

export interface WikiHit {
  title: string;
  description: string;
  url: string;
}

export interface ImportSummary {
  queued: number;
  skipped: number;
  detail: string | null;
}

export interface ShareOut {
  token: string;
  card_id: string;
}

export interface PublicCard {
  id: string;
  title: string;
  source_type: string;
  thumbnail_url: string | null;
  concise_summary_md: string | null;
  detailed_summary_md: string | null;
  key_takeaways_json: unknown[] | null;
  notes_md: string | null;
}

export interface UserOut {
  id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_file_id: string | null;
  public_profile: boolean;
}

export interface PublicProfileTagOut {
  name: string;
  slug: string;
  card_count: number;
}

export interface PublicProfileOut {
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_file_id: string | null;
  tags: PublicProfileTagOut[];
}

export interface PublicCardSummary {
  id: string;
  title: string;
  source_type: string;
  thumbnail_url: string | null;
  concise_summary_md: string | null;
}

export interface PublicTagDetail {
  name: string;
  slug: string;
  card_count: number;
  cards: PublicCardSummary[];
}

export type ReactionKind = "like" | "insightful" | "mindblown";

export interface ReactionsState {
  counts: Record<ReactionKind, number>;
  mine: ReactionKind[];
}

export interface GraphPresetSettings {
  searchQuery?: string;
  sourceType?: string;
  /** Multi-select tags filter (OR-semantics). */
  tags?: string[];
  /** @deprecated old single-tag presets — read on apply, never written. */
  tag?: string;
  hideIsolated?: boolean;
  colorMode?: string;
  nodeSpacing?: number;
}

export interface GraphPresetOut {
  id: string;
  name: string;
  settings: GraphPresetSettings;
  created_at: string;
}

export interface LearningSessionItem {
  id: string;
  started_at: string;
  ended_at: string;
  event_count: number;
  correct_count: number;
}

export interface SessionEventOut {
  id: string;
  reviewed_at: string;
  rating: string;
  stage: string | null;
  interval_days: number | null;
  question_id: string;
  question: string;
  answer: string;
  card_id: string;
  card_title: string;
}

export interface SessionDetail {
  id: string;
  started_at: string;
  ended_at: string;
  event_count: number;
  correct_count: number;
  events: SessionEventOut[];
}

export interface ActivityDay {
  date: string; // YYYY-MM-DD
  count: number;
  correct: number;
}

export interface PodcastPlaylistOut {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  card_count: number;
  has_draft: boolean;
}

export interface PodcastEpisodeOut {
  id: string;
  playlist_id: string;
  title: string;
  voice: string;
  status: "processing" | "ready" | "failed";
  error_message: string | null;
  has_audio: boolean;
  has_cover: boolean;
  audio_url: string | null;
  cover_url: string | null;
  created_at: string;
}

export interface PodcastPlaylistCardOut {
  card_id: string;
  position: number;
  title: string;
  source_type: string;
  thumbnail_url: string | null;
}

export interface PodcastPlaylistDetail extends PodcastPlaylistOut {
  cards: PodcastPlaylistCardOut[];
  episodes: PodcastEpisodeOut[];
  draft_title: string | null;
  draft_narrative_text: string | null;
  draft_target_minutes: number | null;
}

export interface EpisodeShareOut {
  token: string;
  public_url: string;
  embed_url: string;
  audio_url: string;
  cover_url: string | null;
  created_at: string;
}

export interface PublicEpisodeOut {
  title: string;
  voice: string;
  narrative_text: string;
  audio_url: string;
  cover_url: string | null;
  created_at: string;
}

export interface CardTranslationOut {
  id: string;
  card_id: string;
  language: string;
  title: string | null;
  concise_summary_md: string | null;
  detailed_summary_md: string | null;
  key_takeaways_json: string[] | null;
  status: "processing" | "ready" | "failed";
  error_message: string | null;
  created_at: string;
}

export interface CardAudioOut {
  id: string;
  card_id: string;
  narrative_text: string;
  voice: string;
  status: "processing" | "ready" | "failed";
  error_message: string | null;
  created_at: string;
  audio_url: string | null;
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
