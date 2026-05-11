import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Linkedin,
  Loader2,
  Megaphone,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Twitter,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import VoiceRecordButton from "../VoiceRecordButton";
import {
  api,
  type ImageTemplateOut,
  type ImageTemplateRecommendation,
  type MCPServerOut,
  type MCPToolOut,
  type SocialPostCreate,
  type SocialPostOut,
  type SocialPostPlatform,
  type SocialPostTone,
} from "../../lib/api";
import {
  getSelectionOffsets,
  insertAtCaretCE,
  setCaret,
} from "../../lib/contentEditableSelection";
import { useAuthedImage } from "../../lib/useAuthedImage";
import { useDialog } from "../../lib/DialogContext";
import { PostImagePregenModal } from "./PostImagePregenModal";
import { PostImageRefineModal } from "./PostImageRefineModal";
import { usePostImageVersions } from "./usePostImageVersions";

interface Props {
  cardId: string;
}

const PLATFORM_META: Record<
  SocialPostPlatform,
  { label: string; Icon: typeof Linkedin; ring: string; text: string; bg: string; softCharLimit: number; freeLimit?: number }
> = {
  linkedin: {
    label: "LinkedIn",
    Icon: Linkedin,
    ring: "ring-sky-500/40",
    text: "text-sky-300",
    bg: "bg-sky-500/15",
    softCharLimit: 1500,
  },
  x: {
    label: "X",
    Icon: Twitter,
    ring: "ring-ink-300/40",
    text: "text-ink-100",
    bg: "bg-ink-700/60",
    softCharLimit: 4000, // X Premium long-post sweet spot
    freeLimit: 280, // shown as a hint
  },
  bluesky: {
    label: "Bluesky",
    Icon: Megaphone,
    ring: "ring-cyan-500/40",
    text: "text-cyan-300",
    bg: "bg-cyan-500/15",
    softCharLimit: 300, // hard limit
  },
};

const TONE_OPTIONS: { value: SocialPostTone; labelKey: string; defaultLabel: string }[] = [
  { value: "professional", labelKey: "posts.tone.professional", defaultLabel: "Professional" },
  { value: "casual", labelKey: "posts.tone.casual", defaultLabel: "Casual" },
  { value: "thought_leader", labelKey: "posts.tone.thoughtLeader", defaultLabel: "Thought leader" },
  { value: "story", labelKey: "posts.tone.story", defaultLabel: "Story" },
  { value: "punchy", labelKey: "posts.tone.punchy", defaultLabel: "Punchy" },
];

export default function PostsTab({ cardId }: Props) {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const [platform, setPlatform] = useState<SocialPostPlatform>("linkedin");
  const [tone, setTone] = useState<SocialPostTone>("professional");
  const [withHashtags, setWithHashtags] = useState(true);
  const [withCta, setWithCta] = useState(true);
  const [withImage, setWithImage] = useState(false);
  const [withEmoji, setWithEmoji] = useState(true);
  // Language is free-form so the user can request odd dialects or
  // mixed-language posts ("German with English tech terms"). Empty =
  // let the model match the source's dominant language.
  const [language, setLanguage] = useState("");
  const [drafts, setDrafts] = useState<SocialPostOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // MCP servers + their tools — used by the per-draft "Publish via …"
  // dropdown. We only show tools whose name / description looks
  // publish-y; non-publishing tools (file readers, calendar etc) are
  // filtered client-side.
  const [mcpServers, setMcpServers] = useState<MCPServerOut[]>([]);
  // Image-templates the user has configured in Settings. When `with_image`
  // is on, the Template select lets the user override the default.
  const [imageTemplates, setImageTemplates] = useState<ImageTemplateOut[]>([]);
  const [imageTemplateId, setImageTemplateId] = useState<string>("");  // "" = use default
  // LLM-picked recommendation for this card. Fetched once on tab mount,
  // applied as the default template selection if the user hasn't picked
  // anything yet. The badge surfaces the model's one-line reasoning.
  const [imageTemplateRec, setImageTemplateRec] =
    useState<ImageTemplateRecommendation | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listSocialPosts(cardId)
      .then((list) => {
        if (!cancelled) setDrafts(list);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // Load MCP servers once when the tab mounts. Failures are silently
  // ignored — the rest of the tab still works without MCP.
  useEffect(() => {
    let cancelled = false;
    api
      .listMCPServers()
      .then((list) => {
        if (!cancelled) setMcpServers(list);
      })
      .catch(() => {
        /* MCP is optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Same for image templates — used to populate the template dropdown
  // next to "Mit Bild generieren".
  useEffect(() => {
    let cancelled = false;
    api
      .listImageTemplates()
      .then((list) => {
        if (!cancelled) setImageTemplates(list);
      })
      .catch(() => {
        /* templates optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ask the backend which template fits this card best. Runs once per
  // mount (cheap GPT-mini call ~500ms). When the user hasn't picked a
  // template yet, we apply the recommendation as the active selection
  // so a single click on "Generate" already uses the right layout.
  useEffect(() => {
    let cancelled = false;
    api
      .recommendImageTemplate(cardId)
      .then((rec) => {
        if (cancelled) return;
        setImageTemplateRec(rec);
        // Apply only if the user hasn't touched the picker.
        if (rec.template_id) {
          setImageTemplateId((current) => (current === "" ? rec.template_id! : current));
        }
      })
      .catch(() => {
        /* recommendation is a hint, not load-bearing */
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // When set, the DraftCard whose id matches auto-opens its pregen modal
  // on first render — used by the "preview first" generate flow to drop
  // the user straight into variable editing for the freshly-created post.
  const [pregenForPostId, setPregenForPostId] = useState<string | null>(null);

  const generate = async (options: { previewFirst?: boolean } = {}) => {
    const { previewFirst = false } = options;
    setGenerating(true);
    setError(null);
    // In preview-first mode we deliberately create the post WITHOUT the
    // image — the user will trigger image generation from inside the
    // modal after inspecting the extracted variables.
    const wantsImageInBackend = withImage && !previewFirst;
    const body: SocialPostCreate = {
      platform,
      tone,
      with_hashtags: withHashtags,
      with_cta: withCta,
      with_image: wantsImageInBackend,
      with_emoji: withEmoji,
      language: language.trim() || null,
      image_template_id: wantsImageInBackend && imageTemplateId ? imageTemplateId : null,
    };
    try {
      const post = await api.createSocialPost(cardId, body);
      setDrafts((prev) => [post, ...prev]);
      if (previewFirst) {
        setPregenForPostId(post.id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const removeDraft = async (postId: string) => {
    const ok = await confirm({
      title: t("posts.confirmDeleteTitle", { defaultValue: "Delete this draft?" }),
      body:
        t("posts.confirmDeleteBody", {
          defaultValue:
            "The draft and any generated cover image are removed. This can't be undone.",
        }) ?? "",
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteSocialPost(cardId, postId);
      setDrafts((prev) => prev.filter((p) => p.id !== postId));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <section className="rounded-xl border border-ink-800 bg-ink-800/30 p-4">
        <h3 className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-300">
          <Sparkles className="h-3 w-3 text-violet-300" />
          {t("posts.heading", { defaultValue: "Generate a post" })}
        </h3>

        {/* Platform pills */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(Object.keys(PLATFORM_META) as SocialPostPlatform[]).map((p) => {
            const meta = PLATFORM_META[p];
            const active = platform === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={[
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition",
                  active
                    ? `${meta.bg} ${meta.text} ring-1 ${meta.ring}`
                    : "border border-ink-700 text-ink-300 hover:bg-ink-800",
                ].join(" ")}
              >
                <meta.Icon className="h-3.5 w-3.5" />
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Options row */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <span className="text-ink-400">
              {t("posts.tone.label", { defaultValue: "Tone" })}:
            </span>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as SocialPostTone)}
              className="rounded-md border border-ink-700 bg-ink-800/40 px-2 py-1 text-xs text-ink-100 focus:border-ink-500 focus:outline-none"
            >
              {TONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey, { defaultValue: o.defaultLabel })}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <span className="text-ink-400">
              {t("posts.language.label", { defaultValue: "Language" })}:
            </span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded-md border border-ink-700 bg-ink-800/40 px-2 py-1 text-xs text-ink-100 focus:border-ink-500 focus:outline-none"
            >
              <option value="">
                {t("posts.language.auto", { defaultValue: "Auto (match source)" })}
              </option>
              <option value="Deutsch">Deutsch</option>
              <option value="English">English</option>
              <option value="Français">Français</option>
              <option value="Español">Español</option>
              <option value="Italiano">Italiano</option>
              <option value="Português">Português</option>
              <option value="Nederlands">Nederlands</option>
              <option value="日本語">日本語</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={withHashtags}
              onChange={(e) => setWithHashtags(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            {t("posts.withHashtags", { defaultValue: "Hashtags" })}
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={withEmoji}
              onChange={(e) => setWithEmoji(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            {t("posts.withEmoji", { defaultValue: "Emoji" })}
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={withCta}
              onChange={(e) => setWithCta(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            {t("posts.withCta", { defaultValue: "CTA / question" })}
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={withImage}
              onChange={(e) => setWithImage(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <ImageIcon className="h-3 w-3 text-violet-300" />
            {t("posts.withImage", { defaultValue: "Mit Bild generieren (~30 s)" })}
          </label>
          {withImage && imageTemplates.length > 0 && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
              <span className="text-ink-400">
                {t("posts.template", { defaultValue: "Template" })}:
              </span>
              <select
                value={imageTemplateId}
                onChange={(e) => setImageTemplateId(e.target.value)}
                className="rounded-md border border-ink-700 bg-ink-800/40 px-2 py-1 text-xs text-ink-100 focus:border-ink-500 focus:outline-none"
              >
                <option value="">
                  {t("posts.templateDefault", {
                    defaultValue: "Default" +
                      (imageTemplates.find((tt) => tt.is_default) ? "" : " (none)"),
                  })}
                </option>
                {imageTemplates.map((tt) => {
                  const star = tt.is_default ? "★ " : "";
                  const rec = imageTemplateRec?.template_id === tt.id ? " ✨" : "";
                  return (
                    <option key={tt.id} value={tt.id}>
                      {star}{tt.name}{rec}
                    </option>
                  );
                })}
              </select>
              {imageTemplateRec?.template_name && (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200"
                  title={imageTemplateRec.reasoning || undefined}
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  {t("posts.templateRecommended", {
                    defaultValue: "Recommended: {{name}}",
                    name: imageTemplateRec.template_name,
                  })}
                </span>
              )}
            </label>
          )}
          {/* Preview-first button: only meaningful when an image is
              actually being generated. Creates a caption-only post and
              opens the variable-editor modal so the user can tweak
              extracted values before paying for the gpt-image-2 call. */}
          {withImage && (
            <button
              type="button"
              onClick={() => void generate({ previewFirst: true })}
              disabled={generating}
              title={
                t("posts.generatePreviewTitle", {
                  defaultValue:
                    "Generate caption only, then open the variable editor for the image",
                }) ?? ""
              }
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-200 transition hover:border-violet-400 hover:bg-violet-500/10 hover:text-violet-300 disabled:opacity-50"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {t("posts.generatePreview", {
                defaultValue: "Preview variables first",
              })}
            </button>
          )}
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className={[
              withImage ? "" : "ml-auto",
              "inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50",
            ].join(" ")}
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {generating
              ? t("posts.generating", { defaultValue: "Generating…" })
              : t("posts.generate", { defaultValue: "Generate" })}
          </button>
        </div>

        {error && (
          <p className="mt-2 rounded-md bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">
            {error}
          </p>
        )}
      </section>

      {/* Drafts list */}
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-ink-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("common.loading")}
        </p>
      ) : drafts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-700 px-6 py-12 text-center text-sm text-ink-400">
          {t("posts.empty", {
            defaultValue: "No drafts yet — pick a platform and click Generate.",
          })}
        </p>
      ) : (
        <ul className="space-y-3">
          {drafts.map((d) => (
            <li key={d.id}>
              <DraftCard
                draft={d}
                cardId={cardId}
                mcpServers={mcpServers}
                imageTemplates={imageTemplates}
                initialPregenOpen={pregenForPostId === d.id}
                onUpdated={(next) =>
                  setDrafts((prev) =>
                    prev.map((p) => (p.id === next.id ? next : p)),
                  )
                }
                onDelete={() => void removeDraft(d.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Single draft card — text + hashtags + image + copy + delete.
 * -------------------------------------------------------------------- */
function DraftCard({
  draft,
  cardId,
  mcpServers,
  imageTemplates,
  initialPregenOpen = false,
  onUpdated,
  onDelete,
}: {
  draft: SocialPostOut;
  cardId: string;
  mcpServers: MCPServerOut[];
  imageTemplates: ImageTemplateOut[];
  /** When true on first render, the pregen variable-editor modal opens
   *  automatically — used by the "Preview variables first" flow in
   *  PostsTab so the user lands directly in the editor. */
  initialPregenOpen?: boolean;
  onUpdated: (next: SocialPostOut) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const meta =
    PLATFORM_META[draft.platform as SocialPostPlatform] ?? PLATFORM_META.x;
  const [, setCopiedText] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const { src: imageSrc } = useAuthedImage(draft.image_url);
  const [pregenOpen, setPregenOpen] = useState(initialPregenOpen);
  const [refineOpen, setRefineOpen] = useState(false);
  const { versions, registerPending } = usePostImageVersions(
    cardId,
    draft,
    onUpdated,
  );

  // Inline editor state — local-first so typing stays snappy; PATCH
  // is debounced 1.5 s after the last keystroke.
  const [text, setText] = useState(draft.text);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");
  // The editor is a plain-text contentEditable div so prose can wrap
  // around a floated cover image. Selection / caret are tracked by
  // computing char offsets against innerText.
  const editorRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const onVoice = useCallback(
    (voiceText: string) => {
      const el = editorRef.current;
      if (!el) return;
      const { next, offset } = insertAtCaretCE(el, text, voiceText);
      setText(next);
      el.innerText = next;
      requestAnimationFrame(() => {
        el.focus();
        setCaret(el, offset);
      });
    },
    [text],
  );

  // Sync local text when the draft prop changes (e.g. a regeneration
  // bumps the version externally) — and push it into the editor DOM
  // since contentEditable isn't a controlled-component the React way.
  useEffect(() => {
    setText(draft.text);
    const el = editorRef.current;
    if (el && el.innerText !== draft.text) {
      el.innerText = draft.text;
    }
  }, [draft.id, draft.text]);

  // Debounced auto-save: PATCH the new text 1.5 s after the user stops
  // typing.
  useEffect(() => {
    if (text === draft.text) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSavingState("saving");
    saveTimerRef.current = window.setTimeout(() => {
      void api
        .updateSocialPost(cardId, draft.id, text)
        .then((next) => {
          onUpdated(next);
          setSavingState("saved");
          window.setTimeout(() => setSavingState("idle"), 1200);
        })
        .catch(() => {
          // Failure: leave the local text in place so the user doesn't
          // lose work. They'll see the "saving…" status hang there.
          setSavingState("idle");
        });
    }, 1500);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [text, cardId, draft.id, draft.text, onUpdated]);

  // Track selection so the AI toolbar knows which fragment to rewrite.
  const refreshSelection = () => {
    const el = editorRef.current;
    if (!el) return;
    setSelection(getSelectionOffsets(el));
  };

  const runRewrite = async (
    action: "shorter" | "longer" | "sharper" | "rephrase",
  ) => {
    if (!selection) return;
    const fragment = text.slice(selection.start, selection.end);
    setRewriting(action);
    setRewriteError(null);
    try {
      const res = await api.rewriteSocialPostSelection(cardId, draft.id, {
        action,
        selection: fragment,
        full_text: text,
      });
      const next = text.slice(0, selection.start) + res.text + text.slice(selection.end);
      setText(next);
      // Move cursor + reselect the new fragment so the user can keep
      // iterating on the same span.
      requestAnimationFrame(() => {
        const el = editorRef.current;
        if (!el) return;
        el.innerText = next;
        el.focus();
        const newEnd = selection.start + res.text.length;
        setCaret(el, selection.start, newEnd);
        setSelection({ start: selection.start, end: newEnd });
      });
    } catch (err) {
      setRewriteError((err as Error).message);
    } finally {
      setRewriting(null);
    }
  };

  const fullText = draft.hashtags?.length
    ? `${text}\n\n${draft.hashtags.map((h) => `#${h}`).join(" ")}`
    : text;

  const overLimit =
    meta.freeLimit !== undefined && text.length > meta.freeLimit;
  const overSoftLimit = text.length > meta.softCharLimit;

  const copy = async (value: string, setter: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(value);
      setter(true);
      window.setTimeout(() => setter(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  return (
    <div className="rounded-xl border border-ink-800 bg-ink-800/30 p-4">
      {/* Header strip */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1",
              meta.bg,
              meta.text,
              meta.ring,
            ].join(" ")}
          >
            <meta.Icon className="h-3 w-3" />
            {meta.label}
          </span>
          {draft.tone && (
            <span className="rounded-full bg-ink-700/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-300">
              {draft.tone.replace("_", " ")}
            </span>
          )}
          <span className="text-[10px] text-ink-500">
            {new Date(draft.created_at).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <VoiceRecordButton onTranscribed={onVoice} showStatusLine={true} />
          <PublishMenu
            draft={draft}
            fullText={fullText}
            mcpServers={mcpServers}
          />
          <button
            type="button"
            onClick={() => void copy(fullText, setCopiedAll)}
            className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-200 transition hover:bg-ink-700"
            title={t("posts.copyAll", { defaultValue: "Copy text + hashtags" }) ?? ""}
          >
            {copiedAll ? (
              <Check className="h-3 w-3 text-emerald-300" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copiedAll
              ? t("posts.copied", { defaultValue: "Copied" })
              : t("posts.copy", { defaultValue: "Copy" })}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition hover:bg-red-500/10 hover:text-red-300"
            title={t("common.delete") ?? ""}
            aria-label={t("common.delete") ?? "Delete"}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Editor — auto-grows with content; user can tweak the draft
          inline. AI quick-action toolbar appears above the textarea
          when there's a non-empty selection. */}
      <div className="relative">
        {selection && (
          <div className="absolute -top-9 right-0 z-10 flex items-center gap-1 rounded-lg border border-violet-500/40 bg-ink-900/95 p-1 shadow-xl backdrop-blur">
            <span className="ml-1 mr-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-violet-300">
              <Sparkles className="h-3 w-3" />
              {t("posts.aiActions", { defaultValue: "AI" })}
            </span>
            <RewriteButton
              label={t("posts.action.sharper", { defaultValue: "Sharper" })}
              active={rewriting === "sharper"}
              disabled={rewriting !== null}
              onClick={() => void runRewrite("sharper")}
            />
            <RewriteButton
              label={t("posts.action.shorter", { defaultValue: "Shorter" })}
              active={rewriting === "shorter"}
              disabled={rewriting !== null}
              onClick={() => void runRewrite("shorter")}
            />
            <RewriteButton
              label={t("posts.action.longer", { defaultValue: "Longer" })}
              active={rewriting === "longer"}
              disabled={rewriting !== null}
              onClick={() => void runRewrite("longer")}
            />
            <RewriteButton
              label={t("posts.action.rephrase", { defaultValue: "Rephrase" })}
              active={rewriting === "rephrase"}
              disabled={rewriting !== null}
              onClick={() => void runRewrite("rephrase")}
            />
          </div>
        )}
        {/* Floated cover image — sits in the top-right and lets the
            prose wrap around it like a magazine layout. The dashed
            "Add image" CTA stays as a separate block below for the
            no-image case. */}
        {imageSrc && (
          <div className="group relative float-right ml-3 mb-2 inline-block overflow-hidden rounded-md border border-ink-700 bg-ink-900 shadow-md">
            <img
              src={imageSrc}
              alt={t("posts.coverAlt", { defaultValue: "Generated cover" }) ?? ""}
              className="block h-40 w-40 cursor-zoom-in object-cover transition hover:opacity-90"
              onClick={() => setRefineOpen(true)}
            />
            <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setRefineOpen(true);
                }}
                title={t("posts.image.refineTitle", { defaultValue: "Refine this image" }) ?? ""}
                aria-label={t("posts.image.refine", { defaultValue: "Refine" }) ?? "Refine"}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-ink-900/85 text-ink-100 backdrop-blur transition hover:bg-violet-500"
              >
                <Wand2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPregenOpen(true);
                }}
                title={t("posts.image.regenerateTitle", { defaultValue: "Regenerate from template with editable variables" }) ?? ""}
                aria-label={t("posts.image.regenerate", { defaultValue: "Regenerate" }) ?? "Regenerate"}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-ink-900/85 text-ink-100 backdrop-blur transition hover:bg-ink-700"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          onInput={(e) => setText((e.currentTarget as HTMLDivElement).innerText)}
          onMouseUp={refreshSelection}
          onKeyUp={refreshSelection}
          onBlur={() => window.setTimeout(refreshSelection, 50)}
          className="whitespace-pre-wrap break-words rounded-md border border-transparent bg-transparent font-sans text-sm leading-relaxed text-ink-100 outline-none transition focus:border-ink-700 focus:bg-ink-900/30 focus:px-2 focus:py-1.5"
        />
        <div className="clear-both" />
      </div>
      {rewriteError && (
        <p className="mt-1 rounded-md bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">
          {rewriteError}
        </p>
      )}

      {/* Hashtags */}
      {draft.hashtags && draft.hashtags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {draft.hashtags.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => void copy(`#${h}`, setCopiedText)}
              className="inline-flex items-center rounded-full bg-ink-700/60 px-2 py-0.5 text-[11px] font-medium text-ink-200 transition hover:bg-ink-700"
              title={t("posts.copyHashtag", { defaultValue: "Copy hashtag" }) ?? ""}
            >
              #{h}
            </button>
          ))}
        </div>
      )}

      {/* Image slot below the editor.
          - If we have an image: rendered as a float inside the editor above.
          - If a job is in flight (processing version, no file yet): a
            loading state so the user knows it's coming.
          - Otherwise: the "Add image" CTA opens the prompt-builder modal. */}
      {(() => {
        if (imageSrc) return null;
        const pendingVersion = versions.find(
          (v) => v.status === "processing" && v.kind === "generate",
        );
        if (pendingVersion) {
          return (
            <div className="mt-3 flex items-center justify-center gap-3 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-3 text-xs text-violet-200">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {t("posts.image.rendering", {
                  defaultValue:
                    "Image is rendering in the background — this can take 2–3 min.",
                })}
              </span>
            </div>
          );
        }
        return (
          <button
            type="button"
            onClick={() => setPregenOpen(true)}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-ink-700 px-3 py-3 text-xs text-ink-300 transition hover:border-violet-400 hover:bg-violet-500/5 hover:text-violet-200"
          >
            <ImageIcon className="h-4 w-4" />
            {t("posts.image.addImage", {
              defaultValue: "Add an image with editable variables",
            })}
          </button>
        );
      })()}

      {pregenOpen && (
        <PostImagePregenModal
          cardId={cardId}
          post={draft}
          templates={imageTemplates}
          onClose={() => setPregenOpen(false)}
          onJobStarted={registerPending}
        />
      )}
      {refineOpen && (
        <PostImageRefineModal
          cardId={cardId}
          post={draft}
          versions={versions}
          onClose={() => setRefineOpen(false)}
          onUpdated={onUpdated}
          onJobStarted={registerPending}
        />
      )}

      {/* Footer meta — live character counter + save state */}
      <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-ink-500">
        <span className="flex items-center gap-2">
          <span>
            {text.length}{" "}
            {t("posts.chars", { defaultValue: "chars" })}
          </span>
          {savingState === "saving" && (
            <span className="inline-flex items-center gap-1 text-ink-400">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {t("posts.saving", { defaultValue: "Saving…" })}
            </span>
          )}
          {savingState === "saved" && (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <Check className="h-2.5 w-2.5" />
              {t("posts.saved", { defaultValue: "Saved" })}
            </span>
          )}
        </span>
        {overLimit && meta.freeLimit && (
          <span className="text-amber-300">
            {t("posts.overFreeLimit", {
              defaultValue: "> {{n}} chars · Premium-only on X",
              n: meta.freeLimit,
            })}
          </span>
        )}
        {overSoftLimit && !overLimit && (
          <span className="text-amber-300">
            {t("posts.overSoftLimit", {
              defaultValue: "Above the recommended length",
            })}
          </span>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * "Publish via …" menu — filters configured MCP tools to publish-y
 * ones, lets the user invoke one with the draft as arguments.
 * -------------------------------------------------------------------- */
const _PUBLISH_KEYWORDS = [
  "publish",
  "post",
  "tweet",
  "share",
  "social",
  "linkedin",
  "twitter",
  "bluesky",
  "send",
  "compose",
];

function isPublishTool(tool: MCPToolOut): boolean {
  const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
  return _PUBLISH_KEYWORDS.some((kw) => haystack.includes(kw));
}

interface PublishCandidate {
  serverId: string;
  serverName: string;
  tool: MCPToolOut;
}

function PublishMenu({
  draft,
  fullText,
  mcpServers,
}: {
  draft: SocialPostOut;
  fullText: string;
  mcpServers: MCPServerOut[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [calling, setCalling] = useState<string | null>(null);
  const [result, setResult] = useState<
    | { ok: true; message: string; url: string | null }
    | { ok: false; message: string }
    | null
  >(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const candidates: PublishCandidate[] = useMemo(() => {
    const out: PublishCandidate[] = [];
    for (const s of mcpServers) {
      if (!s.is_active) continue;
      for (const tool of s.tools) {
        if (isPublishTool(tool)) {
          out.push({ serverId: s.id, serverName: s.name, tool });
        }
      }
    }
    return out;
  }, [mcpServers]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!result) return;
    const id = window.setTimeout(() => setResult(null), 6000);
    return () => window.clearTimeout(id);
  }, [result]);

  if (candidates.length === 0) {
    // No matching MCP tool configured — hide the affordance entirely.
    // The user finds the Settings → MCP servers tab on their own.
    return null;
  }

  // Detect whether the chosen tool's JSON-Schema exposes a media-URL
  // array param (Reepl uses `mediaUrls`, others may use `media_urls`,
  // `images`, `attachments`). When yes AND the draft has a public image
  // URL configured (requires PUBLIC_BASE_URL on the backend), we append
  // the URL so the published draft carries the image.
  const mediaParamFor = (tool: MCPToolOut): string | null => {
    const props = (tool.input_schema as { properties?: Record<string, unknown> } | null)
      ?.properties;
    if (!props) return null;
    for (const candidate of ["mediaUrls", "media_urls", "images", "attachments"]) {
      if (candidate in props) return candidate;
    }
    return null;
  };

  const invoke = async (cand: PublishCandidate) => {
    setCalling(cand.tool.name);
    setResult(null);
    try {
      const args: Record<string, unknown> = {
        // Send a small, well-named bag — most MCP publishing tools
        // accept some subset of these. Extra fields are typically
        // ignored by JSON-Schema validators.
        platform: draft.platform,
        text: fullText,
        body: fullText,
        content: fullText,
        hashtags: draft.hashtags,
      };
      const mediaParam = mediaParamFor(cand.tool);
      if (mediaParam && draft.public_image_url) {
        args[mediaParam] = [draft.public_image_url];
      }
      const res = await api.callMCPTool({
        server_id: cand.serverId,
        tool_name: cand.tool.name,
        arguments: args,
      });
      if (!res.ok) {
        setResult({ ok: false, message: res.error ?? "Publish failed" });
        return;
      }
      // Try to pull a posted-URL from the MCP `result.content` array.
      const contentArr =
        Array.isArray(res.result?.content) ? (res.result?.content as unknown[]) : [];
      const text = contentArr
        .map((c) => {
          if (c && typeof c === "object" && "text" in c) {
            return String((c as { text?: string }).text ?? "");
          }
          return "";
        })
        .filter(Boolean)
        .join(" ");
      const url = text.match(/https?:\/\/[^\s)]+/)?.[0] ?? null;
      setResult({
        ok: true,
        message: text || t("posts.published", { defaultValue: "Published." }),
        url,
      });
      setOpen(false);
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setCalling(null);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-200 transition hover:bg-violet-500/20"
      >
        <Send className="h-3 w-3" />
        {t("posts.publishVia", { defaultValue: "Publish via" })}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="panel-elevated absolute right-0 top-[calc(100%+4px)] z-30 w-72 overflow-hidden rounded-md border border-ink-700 bg-ink-900 shadow-xl">
          <ul className="max-h-72 overflow-y-auto py-1">
            {candidates.map((cand) => (
              <li key={`${cand.serverId}-${cand.tool.name}`}>
                <button
                  type="button"
                  onClick={() => void invoke(cand)}
                  disabled={calling !== null}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-[11px] text-ink-200 transition hover:bg-ink-800 disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5 font-medium text-ink-100">
                    {calling === cand.tool.name ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3 text-violet-300" />
                    )}
                    {cand.tool.name}
                  </span>
                  <span className="text-[10px] text-ink-400">
                    {cand.serverName}
                    {cand.tool.description ? ` · ${cand.tool.description}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <div
          className={[
            "absolute right-0 top-[calc(100%+4px)] z-30 w-80 rounded-md border p-3 text-[11px] shadow-xl",
            result.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-200",
          ].join(" ")}
        >
          <p className="font-medium">
            {result.ok
              ? t("posts.publishedTitle", { defaultValue: "Published" })
              : t("posts.publishFailed", { defaultValue: "Publish failed" })}
          </p>
          <p className="mt-1 break-words text-ink-300">{result.message}</p>
          {result.ok && result.url && (
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-emerald-200 hover:bg-emerald-500/25"
            >
              <ExternalLink className="h-3 w-3" />
              {t("posts.openPost", { defaultValue: "Open post" })}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function RewriteButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition disabled:opacity-50",
        active
          ? "bg-violet-500/25 text-violet-100 ring-1 ring-violet-500/40"
          : "text-ink-200 hover:bg-ink-800 hover:text-ink-100",
      ].join(" ")}
    >
      {active ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {label}
    </button>
  );
}
