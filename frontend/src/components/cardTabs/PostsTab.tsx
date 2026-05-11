import {
  Check,
  Copy,
  Image as ImageIcon,
  Linkedin,
  Loader2,
  Megaphone,
  Sparkles,
  Trash2,
  Twitter,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  api,
  type SocialPostCreate,
  type SocialPostOut,
  type SocialPostPlatform,
  type SocialPostTone,
} from "../../lib/api";
import { useAuthedImage } from "../../lib/useAuthedImage";
import { useDialog } from "../../lib/DialogContext";

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
  const [drafts, setDrafts] = useState<SocialPostOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const generate = async () => {
    setGenerating(true);
    setError(null);
    const body: SocialPostCreate = {
      platform,
      tone,
      with_hashtags: withHashtags,
      with_cta: withCta,
      with_image: withImage,
    };
    try {
      const post = await api.createSocialPost(cardId, body);
      setDrafts((prev) => [post, ...prev]);
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
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
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
              <DraftCard draft={d} onDelete={() => void removeDraft(d.id)} />
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
  onDelete,
}: {
  draft: SocialPostOut;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const meta =
    PLATFORM_META[draft.platform as SocialPostPlatform] ?? PLATFORM_META.x;
  const [, setCopiedText] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const { src: imageSrc } = useAuthedImage(draft.image_url);

  const fullText = draft.hashtags?.length
    ? `${draft.text}\n\n${draft.hashtags.map((h) => `#${h}`).join(" ")}`
    : draft.text;

  const overLimit =
    meta.freeLimit !== undefined && draft.character_count > meta.freeLimit;
  const overSoftLimit = draft.character_count > meta.softCharLimit;

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

      {/* Text */}
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink-100">
        {draft.text}
      </pre>

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

      {/* Image preview */}
      {imageSrc && (
        <div className="mt-3 overflow-hidden rounded-md border border-ink-700 bg-ink-900">
          <img
            src={imageSrc}
            alt={t("posts.coverAlt", { defaultValue: "Generated cover" }) ?? ""}
            className="w-full"
          />
        </div>
      )}

      {/* Footer meta — character counter */}
      <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-ink-500">
        <span>
          {draft.character_count}{" "}
          {t("posts.chars", { defaultValue: "chars" })}
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
