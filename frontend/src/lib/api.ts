// Production → same-origin (empty BASE_URL, served behind the same nginx).
// Local dev → talk directly to the FastAPI host on 127.0.0.1, bypassing the
// Vite proxy entirely. The proxy was a source of socket churn / SYN_SENT
// build-up under fast page navigation; cutting it out of the dev loop is
// the user-facing fix. Set VITE_API_BASE_URL to override (e.g. on Railway
// where API + web live on different hosts).
const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? "http://127.0.0.1:8001" : "");
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

// Hard ceiling for every JSON API call. Without this, a stuck backend
// pins UI buttons in their loading state forever (we hit this with the
// "make private" toggle when the polling loop saturated the connection
// pool). 30 s is generous enough for any synchronous endpoint we have.
const REQUEST_TIMEOUT_MS = 30_000;

interface RequestExtras {
  /** Override the default 30 s timeout — bump for slow synchronous
   *  endpoints (path cover, podcast generation, …) so the client
   *  doesn't abort while the server is still rendering. */
  timeoutMs?: number;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  extras: RequestExtras = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = tokenStorage.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // Compose an abort signal: caller-supplied signal still wins (cancel
  // on unmount), and our own timeout aborts after the deadline.
  const timeoutMs = extras.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ApiError(0, `Request timed out after ${timeoutMs / 1000}s`, null);
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }

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

export type CardStatus = "queued" | "processing" | "completed" | "failed" | "paused";

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
  source_url?: string | null;
  external_id?: string | null;
  source_metadata?: Record<string, unknown> | null;
  is_public?: boolean;
  public_via_tags?: string[];
  /** Set when this YouTube card's channel is already subscribed. */
  channel_subscription_id?: string | null;
  /** Set when the channel is known but not yet subscribed — render the
   *  inline "Subscribe to channel" button on the card detail header. */
  channel_resolvable?: { channel_id: string; title: string } | null;
}

/**
 * Shape of `Card.source_metadata` for GitHub repo cards. Persisted by
 * `process_github_card` from the GitHub REST response. All fields may be
 * absent on older cards or on partial fetches.
 */
export interface GithubSourceMetadata {
  owner?: string;
  repo?: string;
  full_name?: string;
  description?: string | null;
  homepage?: string | null;
  default_branch?: string;
  language?: string | null;
  languages?: Record<string, number>;
  topics?: string[];
  stars?: number;
  forks?: number;
  license?: string | null;
}

export interface TranscriptSegment {
  text: string;
  /** Seconds from the start of the source. */
  start: number;
  /** Length of this segment in seconds. */
  duration: number;
}

export interface TranscriptOut {
  card_id: string;
  language: string | null;
  provider: string | null;
  text: string;
  /** Null for transcripts without per-line timing (PDF, article).
   *  Populated for YouTube and any future segmented source. */
  segments: TranscriptSegment[] | null;
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
  getPreferences: () => request<UserPreferences>("/api/auth/me/preferences"),
  updatePreferences: (patch: Partial<UserPreferences>) =>
    request<UserPreferences>("/api/auth/me/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

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
  /** Trigger ingestion of a paused (read-later) or failed card. */
  processPausedCard: (id: string) =>
    request<{ card: Card }>(`/api/cards/${id}/process`, { method: "POST" }),
  /** Highlights — phase 5 of the extension roadmap. The content
   *  script writes here on user action and reads back on page load. */
  listCardHighlights: (cardId: string) =>
    request<HighlightOut[]>(`/api/cards/${cardId}/highlights`),
  createCardHighlight: (
    cardId: string,
    body: {
      anchor_text: string;
      prefix?: string;
      suffix?: string;
      color?: string;
      note?: string;
    },
  ) =>
    request<HighlightOut>(`/api/cards/${cardId}/highlights`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateHighlight: (id: string, patch: { color?: string; note?: string }) =>
    request<HighlightOut>(`/api/highlights/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteHighlight: (id: string) =>
    request<void>(`/api/highlights/${id}`, { method: "DELETE" }),
  listHighlightsByUrl: (sourceUrl: string) =>
    request<HighlightOut[]>(
      `/api/highlights?source_url=${encodeURIComponent(sourceUrl)}`,
    ),
  /** Bulk-trigger every paused card. Returns the count started. */
  processAllPausedCards: () =>
    request<{ started: number; total_paused: number }>(
      "/api/cards/process-paused",
      { method: "POST" },
    ),
  deleteCard: (id: string) =>
    request<void>(`/api/cards/${id}`, { method: "DELETE" }),
  getTranscript: (id: string) =>
    request<TranscriptOut>(`/api/cards/${id}/transcript`),
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
  chatCard: (
    cardId: string,
    messages: ChatMessage[],
    sessionId?: string,
    useWebSearch?: boolean,
  ) =>
    request<ChatResponse>(`/api/cards/${cardId}/chat`, {
      method: "POST",
      body: JSON.stringify({
        messages,
        session_id: sessionId,
        use_web_search: !!useWebSearch,
      }),
    }),
  chatKb: (
    messages: ChatMessage[],
    topK = 5,
    sessionId?: string,
    useWebSearch?: boolean,
  ) =>
    request<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages,
        top_k: topK,
        session_id: sessionId,
        use_web_search: !!useWebSearch,
      }),
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
  searchPublicProfile: (username: string, q: string, limit = 30) =>
    request<PublicProfileSearchOut>(
      `/api/public/users/${encodeURIComponent(username)}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
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
      is_public?: boolean;
    },
  ) =>
    request<PodcastPlaylistOut>(`/api/podcasts/playlists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getPublicPlaylist: (username: string, playlistId: string) =>
    request<PublicPlaylistDetail>(
      `/api/public/users/${encodeURIComponent(username)}/podcasts/${playlistId}`,
    ),
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
  getCardLinks: (id: string) =>
    request<{ card_id: string; links: ExtractedLink[] }>(`/api/cards/${id}/links`),
  getCardAiResources: (id: string, refresh = false) =>
    request<{ card_id: string; resources: AiResource[] }>(
      `/api/cards/${id}/ai-resources${refresh ? "?refresh=1" : ""}`,
    ),
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

  // Learning paths
  listPaths: () => request<PathListItem[]>("/api/paths"),
  createPath: (title: string, description_md?: string | null) =>
    request<PathDetail>("/api/paths", {
      method: "POST",
      body: JSON.stringify({ title, description_md }),
    }),
  getPath: (id: string) => request<PathDetail>(`/api/paths/${id}`),
  updatePath: (
    id: string,
    body: {
      title?: string;
      description_md?: string | null;
      cover_url?: string | null;
      is_public?: boolean;
      regenerate_slug?: boolean;
    },
  ) =>
    request<PathDetail>(`/api/paths/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deletePath: (id: string) => request<void>(`/api/paths/${id}`, { method: "DELETE" }),
  addCardsToPath: (id: string, cardIds: string[]) =>
    request<PathDetail>(`/api/paths/${id}/cards`, {
      method: "POST",
      body: JSON.stringify({ card_ids: cardIds }),
    }),
  removeCardFromPath: (id: string, cardId: string) =>
    request<PathDetail>(`/api/paths/${id}/cards/${cardId}`, { method: "DELETE" }),
  reorderPath: (id: string, cardIds: string[]) =>
    request<PathDetail>(`/api/paths/${id}/reorder`, {
      method: "PATCH",
      body: JSON.stringify({ card_ids: cardIds }),
    }),
  updatePathLesson: (id: string, cardId: string, lessonMd: string | null) =>
    request<PathDetail>(`/api/paths/${id}/cards/${cardId}/lesson`, {
      method: "PATCH",
      body: JSON.stringify({ lesson_md: lessonMd }),
    }),
  publicPath: (username: string, slug: string) =>
    request<PublicPathOut>(`/api/public/paths/${username}/${slug}`),
  getPublicPathCard: (username: string, slug: string, cardId: string) =>
    request<PublicCardOut>(
      `/api/public/paths/${username}/${slug}/cards/${cardId}`,
    ),
  getPublicPathCardTranscript: (
    username: string,
    slug: string,
    cardId: string,
  ) =>
    request<TranscriptOut>(
      `/api/public/paths/${username}/${slug}/cards/${cardId}/transcript`,
    ),
  getPublicPathCardQuiz: (username: string, slug: string, cardId: string) =>
    request<QuizQuestion[]>(
      `/api/public/paths/${username}/${slug}/cards/${cardId}/quiz`,
    ),
  fetchOriginalFileBlob: async (fileId: string): Promise<Blob> => {
    const token = localStorage.getItem("mindshift.token");
    const res = await fetch(`/api/files/${fileId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
  fetchPublicPathCardFileBlob: async (
    username: string,
    slug: string,
    cardId: string,
  ): Promise<Blob> => {
    const res = await fetch(
      `/api/public/paths/${username}/${slug}/cards/${cardId}/file`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  },
  getPathProgress: (id: string) =>
    request<PathProgress | null>(`/api/paths/${id}/progress`),
  updatePathProgress: (id: string, currentPosition: number) =>
    request<PathProgress>(`/api/paths/${id}/progress`, {
      method: "POST",
      body: JSON.stringify({ current_position: currentPosition }),
    }),
  getPathQuiz: (id: string) => request<PathQuiz>(`/api/paths/${id}/quiz`),
  recordQuizAttempt: (
    id: string,
    body: { score: number; total: number; duration_seconds?: number },
  ) =>
    request<QuizAttemptOut>(`/api/paths/${id}/quiz/attempts`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listQuizAttempts: (id: string) =>
    request<QuizAttemptOut[]>(`/api/paths/${id}/quiz/attempts`),
  getQuizStats: (id: string) => request<QuizStats>(`/api/paths/${id}/quiz/stats`),
  generatePathCover: (id: string) =>
    request<PathDetail>(
      `/api/paths/${id}/generate-cover`,
      { method: "POST" },
      // gpt-image-2 routinely takes 25–40 s; 30 s would race the server.
      { timeoutMs: 90_000 },
    ),

  // RSS / Atom feed subscriptions
  listFeeds: () => request<FeedOut[]>("/api/feeds"),
  createFeed: (feedUrl: string, title?: string) =>
    request<FeedOut>("/api/feeds", {
      method: "POST",
      body: JSON.stringify({ feed_url: feedUrl, title }),
    }),
  updateFeed: (id: string, body: { title?: string; is_active?: boolean }) =>
    request<FeedOut>(`/api/feeds/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteFeed: (id: string) => request<void>(`/api/feeds/${id}`, { method: "DELETE" }),
  refreshFeed: (id: string) =>
    request<FeedRefreshResult>(`/api/feeds/${id}/refresh`, { method: "POST" }),
  refreshAllFeeds: () =>
    request<FeedRefreshAllResult>(
      "/api/feeds/refresh-all",
      { method: "POST" },
      { timeoutMs: 90_000 },
    ),

  // --- Social posts (per-card LinkedIn / X / Bluesky drafts) ---
  listSocialPosts: (cardId: string) =>
    request<SocialPostOut[]>(`/api/cards/${cardId}/social-posts`),
  createSocialPost: (cardId: string, body: SocialPostCreate) =>
    request<SocialPostOut>(`/api/cards/${cardId}/social-posts`, {
      method: "POST",
      body: JSON.stringify(body),
    }, { timeoutMs: 120_000 }), // image generation can take ~30-40 s
  deleteSocialPost: (cardId: string, postId: string) =>
    request<void>(`/api/cards/${cardId}/social-posts/${postId}`, {
      method: "DELETE",
    }),

  // --- Image templates ---
  listImageTemplates: () =>
    request<ImageTemplateOut[]>("/api/image-templates"),
  createImageTemplate: (body: ImageTemplateCreate) =>
    request<ImageTemplateOut>("/api/image-templates", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateImageTemplate: (id: string, body: ImageTemplateUpdate) =>
    request<ImageTemplateOut>(`/api/image-templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteImageTemplate: (id: string) =>
    request<void>(`/api/image-templates/${id}`, { method: "DELETE" }),
  listImageTemplateVariables: () =>
    request<{ variables: ImageTemplateVariable[] }>(
      "/api/image-templates/variables"
    ),
  previewImageTemplate: (body: { content: string; card_id?: string }) =>
    request<ImageTemplatePreview>("/api/image-templates/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  recommendImageTemplate: (cardId: string) =>
    request<ImageTemplateRecommendation>(
      `/api/cards/${cardId}/image-template-recommendation`,
    ),

  // --- Posts (per-card draft) edit + rewrite ---
  updateSocialPost: (cardId: string, postId: string, text: string) =>
    request<SocialPostOut>(`/api/cards/${cardId}/social-posts/${postId}`, {
      method: "PATCH",
      body: JSON.stringify({ text }),
    }),

  // --- Posts (per-card draft) image: preview / generate / refine / versions ---
  previewPostImage: (
    cardId: string,
    postId: string,
    body: { template_content?: string | null; template_id?: string | null } = {},
  ) =>
    request<PostImagePreview>(
      `/api/cards/${cardId}/social-posts/${postId}/image/preview`,
      { method: "POST", body: JSON.stringify(body) },
      { timeoutMs: 60_000 },
    ),
  generatePostImage: (
    cardId: string,
    postId: string,
    body: { resolved_prompt?: string | null; template_id?: string | null } = {},
  ) =>
    request<PostImageVersion>(
      `/api/cards/${cardId}/social-posts/${postId}/image/generate`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  refinePostImage: (cardId: string, postId: string, prompt: string) =>
    request<PostImageVersion>(
      `/api/cards/${cardId}/social-posts/${postId}/image/refine`,
      { method: "POST", body: JSON.stringify({ prompt }) },
    ),
  listPostImageVersions: (cardId: string, postId: string) =>
    request<PostImageVersion[]>(
      `/api/cards/${cardId}/social-posts/${postId}/image/versions`,
    ),
  activatePostImageVersion: (
    cardId: string,
    postId: string,
    versionId: string,
  ) =>
    request<SocialPostOut>(
      `/api/cards/${cardId}/social-posts/${postId}/image/versions/${versionId}/activate`,
      { method: "POST" },
    ),
  rewriteSocialPostSelection: (
    cardId: string,
    postId: string,
    body: {
      action: "shorter" | "longer" | "sharper" | "rephrase";
      selection: string;
      full_text?: string;
    },
  ) =>
    request<{ text: string }>(
      `/api/cards/${cardId}/social-posts/${postId}/rewrite`,
      { method: "POST", body: JSON.stringify(body) },
      { timeoutMs: 60_000 },
    ),

  // --- MCP servers ---
  listMCPServers: () => request<MCPServerOut[]>("/api/mcp/servers"),
  createMCPServer: (body: MCPServerCreate) =>
    request<MCPServerOut>("/api/mcp/servers", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMCPServer: (id: string, body: MCPServerUpdate) =>
    request<MCPServerOut>(`/api/mcp/servers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteMCPServer: (id: string) =>
    request<void>(`/api/mcp/servers/${id}`, { method: "DELETE" }),
  testMCPServer: (id: string) =>
    request<MCPTestResult>(`/api/mcp/servers/${id}/test`, { method: "POST" }, {
      timeoutMs: 60_000,
    }),
  callMCPTool: (body: { server_id: string; tool_name: string; arguments: Record<string, unknown> }) =>
    request<MCPCallToolResponse>("/api/mcp/call", {
      method: "POST",
      body: JSON.stringify(body),
    }, { timeoutMs: 120_000 }),

  // --- Admin user management ---
  listAdminUsers: () => request<AdminUserRow[]>("/api/admin/users"),
  createAdminUser: (body: AdminUserCreate) =>
    request<AdminUserRow>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAdminUser: (id: string, body: AdminUserUpdate) =>
    request<AdminUserRow>(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAdminUser: (id: string) =>
    request<void>(`/api/admin/users/${id}`, { method: "DELETE" }),

  // ── YouTube suggestions ─────────────────────────────────────────
  suggestYouTubeForCard: (cardId: string, refresh = false) =>
    request<CardYouTubeSuggestions>(
      `/api/youtube/suggest/card/${cardId}${refresh ? "?refresh=1" : ""}`,
    ),
  getYouTubeDiscover: (refresh = false, freshness: YouTubeFreshness = "month") => {
    const params = new URLSearchParams();
    if (refresh) params.set("refresh", "1");
    if (freshness) params.set("freshness", freshness);
    const qs = params.toString();
    return request<YouTubeDiscover>(`/api/youtube/discover${qs ? `?${qs}` : ""}`);
  },
  searchYouTube: (q: string, freshness: YouTubeFreshness = "month", refresh = false) => {
    const params = new URLSearchParams();
    params.set("q", q);
    params.set("freshness", freshness);
    if (refresh) params.set("refresh", "1");
    return request<YouTubeCustomSearch>(`/api/youtube/search?${params.toString()}`);
  },

  // ── YouTube channel subscriptions ──────────────────────────────────
  listChannels: () => request<ChannelSubscription[]>("/api/channels"),
  searchChannels: (q: string) => {
    const params = new URLSearchParams({ q });
    return request<ChannelSearchResult[]>(
      `/api/channels/search?${params.toString()}`,
    );
  },
  resolveChannel: (urlOrHandle: string) =>
    request<ChannelSearchResult>("/api/channels/resolve", {
      method: "POST",
      body: JSON.stringify({ url_or_handle: urlOrHandle }),
    }),
  getChannelSuggestions: () =>
    request<ChannelSuggestion[]>("/api/channels/suggestions"),
  subscribeChannel: (channelId: string) =>
    request<ChannelSubscription>("/api/channels", {
      method: "POST",
      body: JSON.stringify({ channel_id: channelId }),
    }),
  patchChannel: (
    id: string,
    body: { ingest_mode?: "manual" | "auto"; exclude_shorts?: boolean },
  ) =>
    request<ChannelSubscription>(`/api/channels/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  unsubscribeChannel: (id: string) =>
    request<void>(`/api/channels/${id}`, { method: "DELETE" }),
  getChannelVideos: (id: string, tab: ChannelTab, offset = 0, limit = 20) => {
    const params = new URLSearchParams({
      tab,
      offset: String(offset),
      limit: String(limit),
    });
    return request<ChannelVideoListOut>(
      `/api/channels/${id}/videos?${params.toString()}`,
    );
  },
  saveChannelVideo: (id: string, videoId: string) =>
    request<{ card_id: string }>(
      `/api/channels/${id}/videos/${videoId}/save`,
      { method: "POST" },
    ),
  saveAllUnread: (id: string) =>
    request<{ queued: number }>(`/api/channels/${id}/save-all-unread`, {
      method: "POST",
    }),
  markChannelRead: (id: string) =>
    request<void>(`/api/channels/${id}/mark-read`, { method: "POST" }),
  refreshChannel: (id: string) =>
    request<ChannelRefreshResult>(`/api/channels/${id}/refresh`, {
      method: "POST",
    }),
};

// ── YouTube channel subscription types ────────────────────────────────

export type ChannelIngestMode = "manual" | "auto";
export type ChannelTab = "latest" | "popular" | "saved";

export interface ChannelSearchResult {
  channel_id: string;
  title: string;
  handle: string | null;
  thumbnail_url: string | null;
  subscriber_count: number | null;
  description: string | null;
}

export interface ChannelSuggestion extends ChannelSearchResult {
  card_count_in_library: number;
}

export interface ChannelSubscription {
  id: string;
  channel_id: string;
  handle: string | null;
  title: string;
  thumbnail_url: string | null;
  description: string | null;
  subscriber_count: number | null;
  ingest_mode: ChannelIngestMode;
  exclude_shorts: boolean;
  unread_count: number;
  items_ingested: number;
  last_polled_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface ChannelVideo {
  video_id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: string | null;
  is_short: boolean;
  read_at: string | null;
  saved_card_id: string | null;
  view_count: number | null;
}

export interface ChannelVideoListOut {
  tab: ChannelTab;
  items: ChannelVideo[];
  total: number;
}

export interface ChannelRefreshResult {
  new_videos: number;
  queued_ingestion: number;
  error: string | null;
}

export type YouTubeFreshness = "week" | "month" | "quarter" | "year" | "all";

export interface YouTubeCustomSearch {
  query: string;
  freshness: YouTubeFreshness;
  from_cache: boolean;
  api_enabled: boolean;
  results: YouTubeSuggestion[];
}

export interface YouTubeSuggestion {
  video_id: string;
  title: string;
  channel: string;
  description: string;
  thumbnail_url: string;
  published_at: string;
  duration_iso: string | null;
  already_saved_card_id: string | null;
}

export interface CardYouTubeSuggestions {
  query: string;
  results: YouTubeSuggestion[];
  from_cache: boolean;
  api_enabled: boolean;
}

export interface YouTubeDiscoverTheme {
  slug: string;
  label: string;
  query: string;
  /** Discrete sub-queries the LLM generated for this theme (v2). */
  queries: string[];
  card_count: number;
  from_cache: boolean;
  results: YouTubeSuggestion[];
}

export interface YouTubeDiscover {
  api_enabled: boolean;
  themes: YouTubeDiscoverTheme[];
  freshness: YouTubeFreshness;
}

export interface FeedOut {
  id: string;
  feed_url: string;
  title: string;
  site_url: string | null;
  is_active: boolean;
  last_polled_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  items_ingested: number;
  created_at: string;
}

export interface FeedRefreshResult {
  queued: number;
  skipped_seen: number;
  error: string | null;
}

export interface FeedRefreshAllResult {
  feeds_polled: number;
  queued: number;
  skipped_seen: number;
  per_feed_errors: Record<string, string>;
}

export interface PathCardItem {
  card_id: string;
  position: number;
  lesson_md: string | null;
  title: string;
  source_type: string;
  status: string;
  thumbnail_url: string | null;
  concise_summary_md: string | null;
}

export interface PathListItem {
  id: string;
  title: string;
  slug: string;
  description_md: string | null;
  cover_url: string | null;
  is_public: boolean;
  card_count: number;
  created_at: string;
  updated_at: string;
  progress_position: number | null;
  progress_completed_at: string | null;
}

export interface PathProgress {
  current_position: number;
  started_at: string;
  completed_at: string | null;
  total: number;
}

export interface PathQuizQuestion {
  id: string;
  card_id: string;
  card_title: string;
  card_position: number;
  question: string;
  answer: string;
  question_type: string;
  choices_json: string[] | null;
}

export interface PathQuiz {
  path_id: string;
  path_title: string;
  questions: PathQuizQuestion[];
}

export interface QuizAttemptOut {
  id: string;
  score: number;
  total: number;
  duration_seconds: number | null;
  completed_at: string;
}

export interface QuizStats {
  attempt_count: number;
  best_score: number | null;
  best_total: number | null;
  last_score: number | null;
  last_total: number | null;
  last_completed_at: string | null;
}

export interface PathDetail extends PathListItem {
  cards: PathCardItem[];
}

export interface PublicPathOut {
  id: string;
  title: string;
  slug: string;
  description_md: string | null;
  cover_url: string | null;
  author_username: string;
  cards: PathCardItem[];
  created_at: string;
}

export interface PublicCardOut {
  id: string;
  title: string;
  source_type: string;
  status: string;
  thumbnail_url: string | null;
  concise_summary_md: string | null;
  detailed_summary_md: string | null;
  key_takeaways_json: unknown[] | null;
  source_url: string | null;
  external_id: string | null;
  source_metadata: Record<string, unknown> | null;
  created_at: string;
}

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

export interface ExtractedLink {
  url: string;
  domain: string;
  context: "description" | "transcript" | "article" | string;
}

export interface AiResource {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  age: string | null;
  kind: "github" | "doc" | "web" | string;
  query: string;
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
  card_thumbnail_url: string | null;
  card_source_type: string;
  card_external_id: string | null;
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

export interface WebCitation {
  index: number;
  title: string;
  url: string;
  description: string;
  age: string | null;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  web_citations: WebCitation[];
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
  web_citations_json: WebCitation[] | null;
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
  source_url?: string | null;
  external_id?: string | null;
}

export interface UserOut {
  id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_file_id: string | null;
  public_profile: boolean;
  is_admin: boolean;
}

export interface ImageTemplateOut {
  id: string;
  name: string;
  content: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ImageTemplateCreate {
  name: string;
  content: string;
  is_default?: boolean;
}

export interface ImageTemplateUpdate {
  name?: string;
  content?: string;
  is_default?: boolean;
}

export interface ImageTemplateVariable {
  name: string;
  description: string;
}

export interface ImageTemplatePreview {
  detected: string[];
  unknown: string[];
  extracted: Record<string, string>;
  resolved: string;
  card_title: string | null;
}

export interface ImageTemplateRecommendation {
  template_id: string | null;
  template_name: string | null;
  reasoning: string;
}

export interface PostImagePreview {
  detected: string[];
  unknown: string[];
  extracted: Record<string, string>;
  resolved: string;
  template_id: string | null;
}

export interface PostImageVersion {
  id: string;
  file_id: string | null;
  image_url: string | null;
  prompt_used: string | null;
  kind: "generate" | "refine";
  status: "processing" | "ready" | "failed";
  error_message: string | null;
  parent_version_id: string | null;
  is_active: boolean;
  created_at: string;
}

export type MCPTransport = "http" | "sse";
export type MCPAuthType = "none" | "bearer" | "header";

export interface MCPToolOut {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  input_schema: Record<string, unknown> | null;
  last_seen_at: string;
}

export interface MCPServerOut {
  id: string;
  name: string;
  transport: MCPTransport;
  url: string;
  auth_type: MCPAuthType;
  has_auth_secret: boolean;
  auth_header_name: string | null;
  is_active: boolean;
  last_connected_at: string | null;
  last_error: string | null;
  tools: MCPToolOut[];
  created_at: string;
  updated_at: string;
}

export interface MCPServerCreate {
  name: string;
  url: string;
  transport?: MCPTransport;
  auth_type?: MCPAuthType;
  auth_secret?: string | null;
  auth_header_name?: string | null;
  is_active?: boolean;
}

export interface MCPServerUpdate {
  name?: string;
  url?: string;
  transport?: MCPTransport;
  auth_type?: MCPAuthType;
  /** "" clears, null/undefined leaves untouched. */
  auth_secret?: string | null;
  auth_header_name?: string | null;
  is_active?: boolean;
}

export interface MCPTestResult {
  ok: boolean;
  tool_count: number;
  tools: MCPToolOut[];
  error: string | null;
}

export interface MCPCallToolResponse {
  ok: boolean;
  result: Record<string, unknown> | null;
  error: string | null;
}

export type SocialPostPlatform = "linkedin" | "x" | "bluesky";
export type SocialPostTone =
  | "professional"
  | "casual"
  | "thought_leader"
  | "story"
  | "punchy";

export interface SocialPostCreate {
  platform: SocialPostPlatform;
  tone?: SocialPostTone;
  language?: string | null;
  with_hashtags?: boolean;
  with_cta?: boolean;
  with_image?: boolean;
  with_emoji?: boolean;
  /** Optional image-template override (UUID from /api/image-templates).
   *  null/undefined → use the user's default template (if any). */
  image_template_id?: string | null;
}

export interface SocialPostOut {
  id: string;
  card_id: string;
  platform: string;
  text: string;
  hashtags: string[];
  character_count: number;
  image_url: string | null;
  public_image_url: string | null;
  tone: string | null;
  language: string | null;
  created_at: string;
}

export interface AdminUserRow extends UserOut {
  card_count: number;
  storage_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface AdminUserCreate {
  email: string;
  password: string;
  display_name?: string | null;
  is_admin?: boolean;
  public_profile?: boolean;
}

export interface AdminUserUpdate {
  email?: string;
  display_name?: string | null;
  is_admin?: boolean;
  public_profile?: boolean;
  /** Optional password reset; leave undefined to keep the existing one. */
  password?: string;
}

export interface UserPreferences {
  /** Free-form natural-language name. null = no auto-translate. */
  default_translation_language: string | null;
}

export interface HighlightOut {
  id: string;
  card_id: string;
  source_url: string;
  anchor_text: string;
  prefix: string;
  suffix: string;
  color: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface PublicProfileTagOut {
  name: string;
  slug: string;
  card_count: number;
  /** Ancestor → leaf names. ["finance", "investment"] for nested tags. */
  name_path: string[];
  /** Descendant tag count (excludes the tag itself). 0 = leaf tag. */
  subtag_count: number;
}

export interface PublicSubtagOut {
  name: string;
  slug: string;
  card_count: number;
}

export interface PublicProfilePathOut {
  id: string;
  title: string;
  slug: string;
  description_md: string | null;
  cover_url: string | null;
  card_count: number;
}

export interface PublicProfilePlaylistOut {
  id: string;
  name: string;
  description: string | null;
  card_count: number;
  episode_count: number;
  cover_url: string | null;
}

export interface PublicProfileOut {
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_file_id: string | null;
  tags: PublicProfileTagOut[];
  paths: PublicProfilePathOut[];
  playlists: PublicProfilePlaylistOut[];
}

export interface PublicEpisodeBrief {
  id: string;
  title: string;
  voice: string;
  audio_url: string;
  cover_url: string | null;
  narrative_text: string;
  created_at: string;
}

export interface PublicPlaylistDetail {
  id: string;
  name: string;
  description: string | null;
  author_username: string;
  author_display_name: string | null;
  episodes: PublicEpisodeBrief[];
}

export interface PublicCardSummary {
  id: string;
  title: string;
  source_type: string;
  thumbnail_url: string | null;
  concise_summary_md: string | null;
  source_url: string | null;
  external_id: string | null;
}

export interface PublicTagDetail {
  name: string;
  slug: string;
  card_count: number;
  cards: PublicCardSummary[];
  subtags: PublicSubtagOut[];
  name_path: string[];
}

export interface PublicProfileSearchOut {
  query: string;
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
  is_public: boolean;
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
  timestamp_seconds?: number | null;
  youtube_video_id?: string | null;
}
