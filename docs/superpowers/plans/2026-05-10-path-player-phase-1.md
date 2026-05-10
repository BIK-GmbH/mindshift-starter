# Path Player Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the path-step "click play, see summary, no video, no obvious next" experience with a stripped-down course-feel player — auto-shown source media, lesson-note banner, filtered tabs, sticky next-step nav.

**Architecture:** Extract each tab body from `CardDetailContent.tsx` into its own presentational component under `frontend/src/components/cardTabs/`. Build a new `PathPlayerCardView` that composes a strict subset of those tabs (no Graph, no Podcast) with auto-shown source media and no owner action bar. Reshape `PathPlayerPage` around it: same top-bar pattern, but add a sticky bottom-nav with prev/next step *titles* and a 3-line lesson-note with read-more.

**Tech Stack:** React 18, TypeScript, Tailwind, react-i18next, lucide-react. No new deps.

**Spec reference:** `docs/superpowers/specs/2026-05-10-path-player-ux-design.md` (Phase 1 only).

**Tests gate:** Type-check via `npx tsc -b --noEmit` (frontend has no Vitest setup; manual browser verification + a single Playwright happy-path are the regression gates).

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `frontend/src/components/cardTabs/SummaryTab.tsx` | create | Render TL;DR, Key takeaways, Detailed summary from card + activeTranslation |
| `frontend/src/components/cardTabs/TranscriptTab.tsx` | create | Render transcript text or `<SkeletonLines />` while loading |
| `frontend/src/components/cardTabs/NotesTab.tsx` | create | RichTextEditor + save button + public-card hint |
| `frontend/src/components/cardTabs/QuizTab.tsx` | create | List of `<QuizCard />`, plus the empty/processing fallback |
| `frontend/src/components/cardTabs/ChatTab.tsx` | create | ChatPanel + optional source-media split (controlled by `showSourceMedia` prop) |
| `frontend/src/components/cardTabs/Section.tsx` | create | The small `<Section>` + `<SkeletonLines>` shared helpers |
| `frontend/src/components/CardDetailContent.tsx` | modify | Replace inline tab JSX with `<SummaryTab />`, `<TranscriptTab />`, etc. Pass `showSourceMedia={true}` to `ChatTab` to keep the today's "show video" behaviour |
| `frontend/src/components/PathPlayerCardView.tsx` | create | New: source-media (auto) + filtered tab strip (Summary, Transcript, Quiz, Notes, Chat) + scroll. Owns card fetch + tab state. No header, no action bar. |
| `frontend/src/pages/PathPlayerPage.tsx` | modify | Reshape: keep top header + arrows + close, add progress bar visual, new lesson-note band with `line-clamp-3` + Read-more, embed `<PathPlayerCardView />`, add sticky bottom-nav with prev/next step titles |
| `frontend/src/locales/en.json` | modify | Add `paths.lessonReadMore`, `paths.lessonReadLess`, `paths.previousStep`, `paths.nextStep` |
| `frontend/src/locales/de.json` | modify | German equivalents of the same keys |

Each tab file is ~30–80 lines, single responsibility, accepts plain props (value + handlers), no internal data fetching. The parent (CardDetailContent or PathPlayerCardView) owns lifecycle.

---

## Task 1: Extract `Section` + `SkeletonLines` helpers

**Files:**
- Create: `frontend/src/components/cardTabs/Section.tsx`
- Modify: `frontend/src/components/CardDetailContent.tsx` (remove the local `Section` and `SkeletonLines` definitions)

These two helpers are used by Summary and Transcript tabs. Extracting them first means subsequent tabs can import them from one place.

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/components/cardTabs/Section.tsx
import type { FC, ReactNode } from "react";

interface SectionProps {
  icon: FC<{ className?: string }>;
  label: string;
  children: ReactNode;
}

export function Section({ icon: Icon, label, children }: SectionProps) {
  return (
    <section>
      <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      {children}
    </section>
  );
}

export function SkeletonLines() {
  return (
    <div className="space-y-2">
      {[100, 95, 88, 92, 70, 96, 60].map((w, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-ink-800/70"
          style={{ width: `${w}%`, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Update `CardDetailContent.tsx` to import these helpers**

Add at the top of the imports section:

```tsx
import { Section, SkeletonLines } from "./cardTabs/Section";
```

Then **delete** the local `function Section({ ... })` block (around lines 634–652) and the local `function SkeletonLines()` block (around lines 887–899). Keep the rest of the file intact.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: no errors. If errors mention "Cannot find name 'Section'" or "'SkeletonLines'", verify the import path.

- [ ] **Step 4: Smoke-test in the browser**

Run `./scripts/start.sh` if not running. Open the library, click any completed card. Verify:
- Summary tab still shows TL;DR / Key takeaways / Summary sections (the icons + uppercase labels are the `<Section>` helper).
- Transcript tab while loading shows the pulsing 7-bar skeleton (the `<SkeletonLines>` helper).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/cardTabs/Section.tsx frontend/src/components/CardDetailContent.tsx
git commit -m "refactor(card): extract Section and SkeletonLines helpers"
```

---

## Task 2: Extract `SummaryTab`

**Files:**
- Create: `frontend/src/components/cardTabs/SummaryTab.tsx`
- Modify: `frontend/src/components/CardDetailContent.tsx` (replace the inline `tab === "summary"` block with `<SummaryTab ... />`)

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/components/cardTabs/SummaryTab.tsx
import { BookOpen, FileText, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import MarkdownView from "../MarkdownView";
import type { Card, CardTranslationOut } from "../../lib/api";
import { Section } from "./Section";

interface SummaryTabProps {
  card: Card;
  activeTranslation: CardTranslationOut | null;
}

export default function SummaryTab({ card, activeTranslation }: SummaryTabProps) {
  const { t } = useTranslation();
  const conciseSummary = activeTranslation?.concise_summary_md ?? card.concise_summary_md;
  const detailedSummary = activeTranslation?.detailed_summary_md ?? card.detailed_summary_md;
  const takeaways = activeTranslation?.key_takeaways_json ?? card.key_takeaways_json ?? [];

  return (
    <div className="space-y-8 text-sm leading-relaxed">
      {conciseSummary && (
        <Section icon={BookOpen} label={t("card.tldr", { defaultValue: "TL;DR" })}>
          <p className="text-base text-ink-100/90">{conciseSummary}</p>
        </Section>
      )}

      {takeaways.length > 0 && (
        <Section icon={Sparkles} label={t("card.summary") + " — Key Takeaways"}>
          <ul className="grid gap-2 md:grid-cols-2">
            {takeaways.map((point, idx) => (
              <li
                key={idx}
                className="surface-soft group flex items-start gap-2 rounded-md border border-transparent bg-ink-800/40 p-3 text-ink-200 transition hover:bg-ink-800/70"
              >
                <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink-400 transition group-hover:bg-ink-200" />
                <span>{typeof point === "string" ? point : (point as { text?: string })?.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {detailedSummary && (
        <Section icon={FileText} label={t("card.summary")}>
          <MarkdownView source={detailedSummary} />
        </Section>
      )}
    </div>
  );
}
```

Note: this version handles both string-shaped and object-shaped key-takeaway entries (the existing inline code only renders strings; `buildMarkdown` shows the schema can be `{ text }`-shaped too — making the tab robust to both saves a future bug).

- [ ] **Step 2: Replace inline JSX in `CardDetailContent.tsx`**

Find the block (around line 458):

```tsx
{tab === "summary" && (
  <div className="space-y-8 text-sm leading-relaxed">
    ...
  </div>
)}
```

Replace it with:

```tsx
{tab === "summary" && (
  <SummaryTab card={card} activeTranslation={activeTranslation} />
)}
```

Add the import at the top:

```tsx
import SummaryTab from "./cardTabs/SummaryTab";
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 4: Smoke-test**

Open the library, click a completed card. Verify the Summary tab still shows TL;DR + Key takeaways + Summary identically to before. Switch language via the language picker — translated summary still appears.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/cardTabs/SummaryTab.tsx frontend/src/components/CardDetailContent.tsx
git commit -m "refactor(card): extract SummaryTab component"
```

---

## Task 3: Extract `TranscriptTab`

**Files:**
- Create: `frontend/src/components/cardTabs/TranscriptTab.tsx`
- Modify: `frontend/src/components/CardDetailContent.tsx`

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/components/cardTabs/TranscriptTab.tsx
import { SkeletonLines } from "./Section";

interface TranscriptTabProps {
  /** `null` while loading, string (possibly empty) when fetched. */
  transcript: string | null;
}

export default function TranscriptTab({ transcript }: TranscriptTabProps) {
  return (
    <div className="text-sm leading-relaxed">
      {transcript === null ? (
        <SkeletonLines />
      ) : (
        <pre className="whitespace-pre-wrap font-sans leading-relaxed text-ink-200">
          {transcript}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace inline JSX in `CardDetailContent.tsx`**

Find the `{tab === "transcript" && ...}` block and replace with:

```tsx
{tab === "transcript" && <TranscriptTab transcript={transcript} />}
```

Add import:

```tsx
import TranscriptTab from "./cardTabs/TranscriptTab";
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 4: Smoke-test**

Open a completed YouTube card. Click "Transcript" tab. Skeleton bars flash → real transcript appears. Switching back to Summary then back to Transcript should not refetch (the parent caches `transcript` state).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/cardTabs/TranscriptTab.tsx frontend/src/components/CardDetailContent.tsx
git commit -m "refactor(card): extract TranscriptTab component"
```

---

## Task 4: Extract `NotesTab`

**Files:**
- Create: `frontend/src/components/cardTabs/NotesTab.tsx`
- Modify: `frontend/src/components/CardDetailContent.tsx`

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/components/cardTabs/NotesTab.tsx
import { Globe, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import RichTextEditor from "../RichTextEditor";

interface NotesTabProps {
  /** Current draft notes (may differ from server copy). */
  value: string;
  onChange: (next: string) => void;
  onSave: () => void | Promise<void>;
  saving: boolean;
  /** Show the public-card warning banner above the editor. */
  showPublicHint?: boolean;
}

export default function NotesTab({
  value,
  onChange,
  onSave,
  saving,
  showPublicHint = false,
}: NotesTabProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {showPublicHint && (
        <p className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-[11px] text-emerald-300">
          <Globe className="h-3 w-3" />
          {t("card.publicEditHint", {
            defaultValue:
              "Heads up — this card is reachable via a public tag. Edits go live immediately.",
          })}
        </p>
      )}
      <RichTextEditor
        markdown={value}
        onChange={onChange}
        placeholder={t("card.notesPlaceholder", {
          defaultValue: "Write your notes here — bold, lists, headings, links",
        })}
        minHeight={360}
      />
      <div className="flex items-center justify-between text-xs text-ink-400">
        <span>{value.length} chars</span>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace inline JSX**

In `CardDetailContent.tsx`, replace the `{tab === "notes" && ...}` block with:

```tsx
{tab === "notes" && (
  <NotesTab
    value={notes}
    onChange={setNotes}
    onSave={saveNotes}
    saving={savingNotes}
    showPublicHint={card.is_public}
  />
)}
```

Add import:

```tsx
import NotesTab from "./cardTabs/NotesTab";
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 4: Smoke-test**

Open any card. Notes tab renders the rich-text editor. Type a few characters, click Save → button shows loader, then settles. The character count next to "chars" updates as you type. For a card published via a public tag, the green banner with the globe icon is visible.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/cardTabs/NotesTab.tsx frontend/src/components/CardDetailContent.tsx
git commit -m "refactor(card): extract NotesTab component"
```

---

## Task 5: Extract `QuizTab` (with the inner `QuizCard`)

**Files:**
- Create: `frontend/src/components/cardTabs/QuizTab.tsx`
- Modify: `frontend/src/components/CardDetailContent.tsx`

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/components/cardTabs/QuizTab.tsx
import { Hash } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { QuizQuestion } from "../../lib/api";

interface QuizTabProps {
  quiz: QuizQuestion[];
  /** "completed" → show "no quiz yet"; otherwise → show "wait for processing". */
  cardStatus: string;
}

export default function QuizTab({ quiz, cardStatus }: QuizTabProps) {
  const { t } = useTranslation();
  if (quiz.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-ink-700 p-8 text-center text-sm text-ink-400">
        {cardStatus === "completed"
          ? t("card.quiz.empty", { defaultValue: "No quiz questions for this card." })
          : t("card.quiz.processing", {
              defaultValue: "Quiz will appear once the card finishes processing.",
            })}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {quiz.map((q, i) => (
        <QuizCard key={q.id} index={i + 1} question={q} />
      ))}
    </div>
  );
}

function QuizCard({ index, question }: { index: number; question: QuizQuestion }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="surface-soft group rounded-lg border border-transparent bg-ink-800/50 p-4 text-sm transition">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ink-700 text-[10px] font-semibold text-ink-200">
          {index}
        </span>
        <div className="flex-1">
          <p className="font-medium leading-snug text-ink-100">{question.question}</p>
          {revealed ? (
            <p className="mt-3 rounded-md bg-ink-900/60 p-3 text-ink-200 ring-1 ring-ink-700">
              {question.answer}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-300 transition hover:text-ink-100"
            >
              <Hash className="h-3 w-3" />
              {t("card.reveal")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace inline JSX**

In `CardDetailContent.tsx`, replace the `{tab === "quiz" && ...}` block with:

```tsx
{tab === "quiz" && <QuizTab quiz={quiz} cardStatus={card.status} />}
```

Add import:

```tsx
import QuizTab from "./cardTabs/QuizTab";
```

Then **delete** the now-unused inline `function QuizCard(...)` definition near the bottom of the file (around line 857).

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean. If `QuizCard` is referenced anywhere else, the type-check will catch it (it isn't — it was a private helper).

- [ ] **Step 4: Smoke-test**

Open a card with quiz questions. Quiz tab lists them. Click "Reveal" on one → the answer panel slides in. Switch tabs and back → the reveal state resets per-card visit (this is the existing behaviour).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/cardTabs/QuizTab.tsx frontend/src/components/CardDetailContent.tsx
git commit -m "refactor(card): extract QuizTab component"
```

---

## Task 6: Extract `ChatTab` (with `showSourceMedia` prop)

**Files:**
- Create: `frontend/src/components/cardTabs/ChatTab.tsx`
- Modify: `frontend/src/components/CardDetailContent.tsx`

This is the trickiest extraction because today's chat tab carries the "Show video" toggle and the source-media panel. We keep both behind a `showSourceMedia` prop (default `false`). `CardDetailContent` passes `true` to keep today's behaviour. `PathPlayerCardView` (Task 8) passes `false` because the source media is rendered above the tabs already.

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/components/cardTabs/ChatTab.tsx
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import CardSourceMedia from "../CardSourceMedia";
import ChatPanel from "../ChatPanel";
import { api, type Card } from "../../lib/api";

interface ChatTabProps {
  card: Card;
  /** When true, show the "Show video" toggle + the source-media panel inline.
   *  When false (default), only the chat panel renders — assume the source
   *  media is rendered elsewhere (e.g. above the tab strip in the path player). */
  showSourceMedia?: boolean;
}

export default function ChatTab({ card, showSourceMedia = false }: ChatTabProps) {
  const { t } = useTranslation();
  const [playerVisible, setPlayerVisible] = useState(false);
  const hasMedia = showSourceMedia && card.source_type === "youtube" && !!card.external_id;
  const playerOpen = hasMedia && playerVisible;

  return (
    <div className="flex flex-col gap-3" style={{ height: "min(80vh, 900px)" }}>
      {hasMedia && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setPlayerVisible((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/50 px-2 py-1 text-xs text-ink-300 transition hover:bg-ink-700/60 hover:text-ink-100"
          >
            {playerOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {playerOpen
              ? t("cardSource.hidePlayer", { defaultValue: "Hide video" })
              : t("cardSource.showPlayer", { defaultValue: "Show video" })}
          </button>
        </div>
      )}
      {playerOpen && (
        <div className="min-h-0 flex-1">
          <CardSourceMedia card={card} fitHeight />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatPanel
          send={(history) => api.chatCard(card.id, history)}
          placeholder={t("chat.placeholderCard") ?? ""}
          emptyHint={t("chat.cardEmpty") ?? ""}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace inline JSX**

In `CardDetailContent.tsx`, replace the entire `{tab === "chat" && (() => { ... })()}` block with:

```tsx
{tab === "chat" && <ChatTab card={card} showSourceMedia />}
```

Add import:

```tsx
import ChatTab from "./cardTabs/ChatTab";
```

The previously inline `useState` for `showPlayer` in `CardDetailContent` is no longer used here (it's now local to `ChatTab`). Remove the `const [showPlayer, setShowPlayer] = useState(false);` line (~line 101) from `CardDetailContent.tsx`.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean. If a "Cannot find name 'showPlayer'" error fires, search for any leftover reference and remove it.

- [ ] **Step 4: Smoke-test**

Open a YouTube card → Chat tab. Verify the "Show video" toggle is visible at the top right of the tab; click it → video appears at half-height above the chat. Click again → hides. Type a message → response streams. Open a non-YouTube card (article) → no toggle visible, just chat.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/cardTabs/ChatTab.tsx frontend/src/components/CardDetailContent.tsx
git commit -m "refactor(card): extract ChatTab component"
```

---

## Task 7: Build `PathPlayerCardView`

**Files:**
- Create: `frontend/src/components/PathPlayerCardView.tsx`

This is the heart of the new player. It owns:
- Card fetch (with status polling for processing cards)
- Active tab state
- Transcript and quiz lazy fetch
- Notes draft + save

It does NOT own:
- Header (page-level)
- Lesson note (page-level — it's a path concept)
- Prev / next nav (page-level)
- Owner action bar (deliberately omitted)

- [ ] **Step 1: Create the file**

```tsx
// frontend/src/components/PathPlayerCardView.tsx
import { BookOpen, FileText, Loader2, MessageSquare, Sparkles, StickyNote } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FC } from "react";
import { useTranslation } from "react-i18next";

import CardSourceMedia from "./CardSourceMedia";
import IngestionSkeleton from "./IngestionSkeleton";
import ChatTab from "./cardTabs/ChatTab";
import NotesTab from "./cardTabs/NotesTab";
import QuizTab from "./cardTabs/QuizTab";
import SummaryTab from "./cardTabs/SummaryTab";
import TranscriptTab from "./cardTabs/TranscriptTab";
import { api, type Card, type QuizQuestion } from "../lib/api";

type PlayerTab = "summary" | "transcript" | "quiz" | "notes" | "chat";

const TAB_ICONS: Record<PlayerTab, FC<{ className?: string }>> = {
  summary: BookOpen,
  transcript: FileText,
  quiz: Sparkles,
  notes: StickyNote,
  chat: MessageSquare,
};

interface PathPlayerCardViewProps {
  cardId: string;
}

export default function PathPlayerCardView({ cardId }: PathPlayerCardViewProps) {
  const { t } = useTranslation();
  const [card, setCard] = useState<Card | null>(null);
  const [tab, setTab] = useState<PlayerTab>("summary");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCard = useCallback(async () => {
    try {
      const data = await api.getCard(cardId);
      setCard(data);
      setNotes(data.notes_md ?? "");
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [cardId]);

  useEffect(() => {
    void fetchCard();
  }, [fetchCard]);

  // Reset transient state when the card changes (path player swaps cards
  // by remounting via `key={card_id}`, but defending here keeps it correct
  // if a parent ever passes a changing `cardId` without remount).
  useEffect(() => {
    setTab("summary");
    setTranscript(null);
    setQuiz([]);
  }, [cardId]);

  // Re-poll while ingestion is still running.
  useEffect(() => {
    if (!card) return;
    if (card.status === "completed" || card.status === "failed") return;
    const handle = window.setInterval(() => void fetchCard(), 2500);
    return () => window.clearInterval(handle);
  }, [card, fetchCard]);

  // Lazy fetch per active tab.
  useEffect(() => {
    if (!card || card.status !== "completed") return;
    if (tab === "transcript" && transcript === null) {
      void api
        .getTranscript(cardId)
        .then((res) => setTranscript(res.text))
        .catch((err) => setTranscript(`${(err as Error).message}`));
    }
    if (tab === "quiz" && quiz.length === 0) {
      void api.getQuiz(cardId).then(setQuiz).catch(() => undefined);
    }
  }, [tab, cardId, transcript, quiz.length, card]);

  const saveNotes = useCallback(async () => {
    setSavingNotes(true);
    try {
      const updated = await api.updateNotes(cardId, notes);
      setCard(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingNotes(false);
    }
  }, [cardId, notes]);

  const tabs = useMemo<PlayerTab[]>(
    () => ["summary", "transcript", "quiz", "notes", "chat"],
    []
  );

  if (!card) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-300">
        {error ? (
          <p className="text-red-400">{error}</p>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </span>
        )}
      </div>
    );
  }

  const isProcessing = card.status === "queued" || card.status === "processing";
  const hasMedia =
    (card.source_type === "youtube" && !!card.external_id) ||
    card.source_type === "pdf" ||
    card.source_type === "url" ||
    card.source_type === "github";

  return (
    <div className="flex h-full flex-col">
      {/* Auto-shown source media — full content width, 16:9 for YouTube,
          natural sizing for other source types. */}
      {hasMedia && (
        <div className="flex-shrink-0 border-b border-ink-800 bg-ink-950/40">
          <div className="mx-auto max-w-5xl px-4 py-4">
            <CardSourceMedia card={card} />
          </div>
        </div>
      )}

      {/* Tab strip */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/85 backdrop-blur-md">
        <nav className="no-scrollbar mx-auto flex max-w-5xl gap-0.5 overflow-x-auto px-4" aria-label="card sections">
          {tabs.map((id) => {
            const Icon = TAB_ICONS[id];
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={[
                  "group relative inline-flex items-center gap-1.5 px-3 pb-3 pt-2 text-sm transition-colors",
                  active ? "text-ink-100" : "text-ink-400 hover:text-ink-200",
                ].join(" ")}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t(`card.${id}`)}</span>
                {active && (
                  <span className="tab-indicator absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-ink-100" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Active tab body — scrolls within the player frame */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 pb-12 pt-6">
          {isProcessing ? (
            <IngestionSkeleton
              status={card.status}
              thumbnailUrl={card.thumbnail_url}
              title={card.title}
              variant="full"
            />
          ) : (
            <div key={tab} className="tab-content-enter">
              {tab === "summary" && <SummaryTab card={card} activeTranslation={null} />}
              {tab === "transcript" && <TranscriptTab transcript={transcript} />}
              {tab === "quiz" && <QuizTab quiz={quiz} cardStatus={card.status} />}
              {tab === "notes" && (
                <NotesTab
                  value={notes}
                  onChange={setNotes}
                  onSave={saveNotes}
                  saving={savingNotes}
                  showPublicHint={card.is_public}
                />
              )}
              {tab === "chat" && <ChatTab card={card} showSourceMedia={false} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

Note on `activeTranslation={null}`: the player intentionally does not surface the translation picker (one less control to think about during the course flow). Phase 2 may revisit this. The card-language fallback inside `SummaryTab` already handles the null gracefully.

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean. If `Card` interface complains about `external_id`, verify by `grep -n "external_id" frontend/src/lib/api.ts` — it exists.

- [ ] **Step 3: Commit (no smoke test yet — wired up in Task 8)**

```bash
git add frontend/src/components/PathPlayerCardView.tsx
git commit -m "feat(paths): add PathPlayerCardView component"
```

---

## Task 8: Reshape `PathPlayerPage`

**Files:**
- Modify: `frontend/src/pages/PathPlayerPage.tsx`

The new page layout: top header (back / title / step counter / arrows / progress bar) → lesson-note band (3-line truncate + read-more) → `PathPlayerCardView` → sticky bottom nav with prev/next step *titles*.

- [ ] **Step 1: Replace the file content**

Replace the entire content of `frontend/src/pages/PathPlayerPage.tsx` with:

```tsx
import { ArrowLeft, ArrowRight, ChevronLeft, Loader2, Pencil, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import MarkdownView from "../components/MarkdownView";
import MobileDesktopHint from "../components/MobileDesktopHint";
import PathPlayerCardView from "../components/PathPlayerCardView";
import { api, type PathDetail } from "../lib/api";

/**
 * Linear path player. The page owns navigation, lesson note and progress;
 * `<PathPlayerCardView />` owns the card-level rendering (source media + tabs).
 */
export default function PathPlayerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathId = "" } = useParams<{ pathId: string }>();
  const [params, setParams] = useSearchParams();
  const [path, setPath] = useState<PathDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lessonExpanded, setLessonExpanded] = useState(false);

  const fetchPath = useCallback(async () => {
    try {
      const detail = await api.getPath(pathId);
      setPath(detail);
      if (!params.get("step")) {
        try {
          const prog = await api.getPathProgress(pathId);
          if (prog && prog.current_position > 0) {
            const next = new URLSearchParams(params);
            next.set("step", String(prog.current_position + 1));
            setParams(next, { replace: true });
          }
        } catch {
          /* ignore — progress is best-effort */
        }
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathId]);

  useEffect(() => {
    void fetchPath();
  }, [fetchPath]);

  const stepRaw = parseInt(params.get("step") ?? "1", 10);
  const total = path?.cards.length ?? 0;
  const step = Number.isFinite(stepRaw) ? Math.min(Math.max(1, stepRaw), Math.max(1, total)) : 1;
  const current = path?.cards[step - 1] ?? null;
  const prevStepCard = step > 1 ? path?.cards[step - 2] ?? null : null;
  const nextStepCard = step < total ? path?.cards[step] ?? null : null;

  // Persist progress on step change (server takes max → revisits don't roll back).
  useEffect(() => {
    if (!path || total === 0) return;
    void api.updatePathProgress(pathId, step - 1).catch(() => undefined);
  }, [pathId, step, total, path]);

  // Reset lesson-expand when the step changes — short notes don't need it,
  // long notes get a fresh truncation.
  useEffect(() => {
    setLessonExpanded(false);
  }, [step]);

  const goTo = (s: number) => {
    const next = new URLSearchParams(params);
    next.set("step", String(Math.min(Math.max(1, s), total)));
    setParams(next, { replace: true });
  };

  // Arrow-key navigation; skip when typing in inputs / contenteditable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (e.key === "ArrowRight" && step < total) goTo(step + 1);
      if (e.key === "ArrowLeft" && step > 1) goTo(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, total]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }
  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-300">
        {error ?? t("paths.notFound", { defaultValue: "Path not found" })}
      </div>
    );
  }
  if (path.cards.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-ink-400">
        <div>
          <p className="mb-3">
            {t("paths.noStepsToPlay", { defaultValue: "This path has no steps yet." })}
          </p>
          <button
            type="button"
            onClick={() => navigate(`/paths/${pathId}`)}
            className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200"
          >
            <Pencil className="h-3 w-3" />
            {t("paths.openEditor", { defaultValue: "Open editor" })}
          </button>
        </div>
      </div>
    );
  }

  const lessonMd = current?.lesson_md ?? null;
  const lessonIsLong = (lessonMd?.length ?? 0) > 240; // rough proxy for "needs truncation"

  return (
    <div className="flex h-full flex-col">
      <MobileDesktopHint reasonKey="mobileHint.paths" />

      {/* === Top header (sticky) === */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate(`/paths/${pathId}`)}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
            title={t("paths.openEditor", { defaultValue: "Open editor" }) ?? ""}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.16em] text-fuchsia-300">
              {t("paths.title", { defaultValue: "Path" })}
            </p>
            <h1 className="truncate text-sm font-semibold text-ink-100">{path.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-ink-800/60 px-2 py-1 font-mono text-[10px] tabular-nums text-ink-300">
              {step} / {total}
            </span>
            <button
              type="button"
              disabled={step <= 1}
              onClick={() => goTo(step - 1)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30"
              title={t("paths.prev", { defaultValue: "Previous step" }) ?? ""}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            {step >= total ? (
              <button
                type="button"
                onClick={() => navigate(`/paths/${pathId}/quiz`)}
                className="flex h-9 items-center gap-1 rounded-md bg-fuchsia-500/20 px-3 text-xs font-semibold text-fuchsia-100 ring-1 ring-fuchsia-500/40 transition hover:bg-fuchsia-500/30"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t("paths.takeQuiz", { defaultValue: "Take quiz" })}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goTo(step + 1)}
                className="flex h-9 items-center gap-1 rounded-md bg-fuchsia-500/15 px-3 text-xs font-semibold text-fuchsia-200 ring-1 ring-fuchsia-500/30 transition hover:bg-fuchsia-500/25"
              >
                {t("paths.next", { defaultValue: "Next" })}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {/* Progress bar (full width) */}
        <div className="h-0.5 w-full bg-ink-800">
          <div
            className="h-full bg-gradient-to-r from-fuchsia-500 to-fuchsia-300 transition-all"
            style={{ width: `${(step / total) * 100}%` }}
          />
        </div>
      </div>

      {/* === Lesson note (only if present, max 3 lines + read-more) === */}
      {lessonMd && (
        <div className="flex-shrink-0 border-b border-ink-800 bg-fuchsia-500/5">
          <div className="mx-auto max-w-5xl px-4 py-3">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-fuchsia-300">
              {t("paths.lesson", { defaultValue: "Lesson" })}
            </p>
            <div
              className={[
                "prose prose-invert prose-sm max-w-none text-ink-200",
                lessonIsLong && !lessonExpanded ? "line-clamp-3" : "",
              ].join(" ")}
            >
              <MarkdownView source={lessonMd} />
            </div>
            {lessonIsLong && (
              <button
                type="button"
                onClick={() => setLessonExpanded((v) => !v)}
                className="mt-1 text-[11px] font-medium text-fuchsia-300 transition hover:text-fuchsia-200"
              >
                {lessonExpanded
                  ? t("paths.lessonReadLess", { defaultValue: "Show less" })
                  : t("paths.lessonReadMore", { defaultValue: "Read more" })}
              </button>
            )}
          </div>
        </div>
      )}

      {/* === Card content (source media + tabs) === */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {current && <PathPlayerCardView key={current.card_id} cardId={current.card_id} />}
      </div>

      {/* === Sticky bottom nav with step titles === */}
      <div className="flex-shrink-0 border-t border-ink-800 bg-ink-900/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            disabled={step <= 1}
            onClick={() => goTo(step - 1)}
            className="group flex min-w-0 flex-1 items-center gap-2 rounded-md border border-ink-700 px-3 py-2 text-left text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowLeft className="h-4 w-4 flex-shrink-0 transition group-hover:-translate-x-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] uppercase tracking-wider text-ink-500">
                {t("paths.previousStep", { defaultValue: "Previous" })}
              </span>
              <span className="block truncate text-xs font-medium">
                {prevStepCard?.card_title ?? "—"}
              </span>
            </span>
          </button>
          {step >= total ? (
            <button
              type="button"
              onClick={() => navigate(`/paths/${pathId}/quiz`)}
              className="group flex min-w-0 flex-1 items-center justify-end gap-2 rounded-md bg-fuchsia-500/20 px-3 py-2 text-right text-fuchsia-100 ring-1 ring-fuchsia-500/40 transition hover:bg-fuchsia-500/30"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] uppercase tracking-wider text-fuchsia-300">
                  {t("paths.completed", { defaultValue: "Completed" })}
                </span>
                <span className="block truncate text-xs font-medium">
                  {t("paths.takeQuiz", { defaultValue: "Take quiz" })}
                </span>
              </span>
              <Sparkles className="h-4 w-4 flex-shrink-0" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(step + 1)}
              className="group flex min-w-0 flex-1 items-center justify-end gap-2 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-right text-fuchsia-100 transition hover:bg-fuchsia-500/20"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] uppercase tracking-wider text-fuchsia-300">
                  {t("paths.nextStep", { defaultValue: "Next" })}
                </span>
                <span className="block truncate text-xs font-medium">
                  {nextStepCard?.card_title ?? "—"}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 flex-shrink-0 transition group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

Notes:
- The `card_title` field is read off `path.cards[i]` — verify against `frontend/src/lib/api.ts` that `PathDetail.cards[i].card_title` exists. If the field name differs, adjust to whatever the API returns. (Run `grep -n "card_title\|PathCard" frontend/src/lib/api.ts` if unsure.)
- `MobileDesktopHint` reasonKey `mobileHint.paths` is reused from the prior version — keep it.
- The page no longer imports `CardDetailContent`; that import is removed from the top of the file.

- [ ] **Step 2: Verify the API field name**

Run: `grep -n "card_title\|card_id" /Users/chris/Dropbox/git_reps_v4/mindshift/frontend/src/lib/api.ts | head -10`

If the field is named differently (e.g. `title` instead of `card_title`), update the two references in `prevStepCard?.card_title` and `nextStepCard?.card_title` accordingly.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/PathPlayerPage.tsx
git commit -m "feat(paths): rebuild player layout with auto source media and step nav"
```

---

## Task 9: Add i18n keys

**Files:**
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/de.json`

Both files have a top-level `paths` object. Add four new keys.

- [ ] **Step 1: Find the `paths` block in `en.json`**

Run: `grep -n '"paths":' /Users/chris/Dropbox/git_reps_v4/mindshift/frontend/src/locales/en.json`

Open the file, locate the `"paths": { ... }` object. Inside it, near the existing `"prev"` / `"next"` keys, add:

```json
"previousStep": "Previous",
"nextStep": "Next",
"lessonReadMore": "Read more",
"lessonReadLess": "Show less",
```

Make sure the trailing comma rules of the existing JSON stay valid.

- [ ] **Step 2: Add the same keys to `de.json`**

Same location in the German file:

```json
"previousStep": "Zurück",
"nextStep": "Weiter",
"lessonReadMore": "Mehr lesen",
"lessonReadLess": "Weniger anzeigen",
```

- [ ] **Step 3: Validate JSON**

Run:

```bash
python3 -c "import json; json.load(open('frontend/src/locales/en.json')); json.load(open('frontend/src/locales/de.json')); print('ok')"
```

Expected: `ok`. A `JSONDecodeError` means a comma or brace is off.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/locales/en.json frontend/src/locales/de.json
git commit -m "i18n(paths): add player step + lesson read-more keys"
```

---

## Task 10: Manual UX walkthrough + Playwright happy-path

**Files:**
- No code changes; this is the validation gate.

- [ ] **Step 1: Restart the stack to pick up everything**

Run: `./scripts/stop.sh && ./scripts/start.sh`
Wait for backend on :8001 and frontend on :5173. Tail backend log if needed: `tail -f .runtime/logs/backend.log`.

- [ ] **Step 2: Manual checklist (login as the seeded `chris@example.com` / `testpass1234`)**

Open a multi-step path that contains at least one YouTube card (use `seed_ai_videos.py` if no path exists; manually create one in the editor).

Run through:
1. Click Play on the path → land on Step 1 of N.
2. **Source media is visible immediately** (not hidden behind a tab). ✅ if you see the YouTube embed under the lesson band; ❌ if you only see text.
3. **Top-right shows `1 / N`, ←, → / Take quiz** as before.
4. **Sticky bottom nav** shows two cards: left "Previous —" (disabled, no prior step) and right "Next: <Step 2 title>".
5. **Lesson note**: if the step has one, it appears above the video, max 3 lines, with "Read more" if long. Click → expands. Click again → collapses.
6. **Tab strip** shows: Summary, Transcript, Quiz, Notes, Chat — *no* Graph, *no* Podcast.
7. **Owner action bar** (Regenerate / Delete / Share / Re-Tag / Download) is **not visible** anywhere on the page.
8. Click `→` in the top header → step advances to 2. Bottom-nav left now reads "Previous: <Step 1 title>".
9. Use **arrow keys** (focus is on the body, not an input) — Right advances, Left goes back.
10. On the final step, the right-hand button in **both** top header and bottom nav reads "Take quiz". Click it → lands on `/paths/<id>/quiz`.
11. Refresh the page mid-step → progress survives (`?step=` is in the URL; resume-from-progress also kicks in if you didn't have a `step` param).
12. Open a step whose card source is a PDF or article → source media area shows the PDF reader / URL preview accordingly (no console errors).

If any item fails, fix the bug, recommit with a `fix(paths): ...` message, and re-run the relevant items.

- [ ] **Step 3: Add a Playwright happy-path test (single test)**

Use the `frontend-test` skill (`/frontend-test`) to ask it to write a Playwright test that:
1. Logs in via the API (POST to `/api/auth/login` for the seeded user) and stores the JWT in `localStorage`.
2. Navigates to a known path's player route (`/paths/{id}`).
3. Asserts the YouTube `iframe` (or `[data-testid="card-source-media"]`) is visible on first paint.
4. Clicks the "Next" button in the bottom nav.
5. Asserts the URL now contains `?step=2`.
6. Asserts a `GET /api/paths/{id}/progress` response shows `current_position >= 1`.

Drop the test under `frontend/tests/e2e/path-player.spec.ts` (create the directory and `playwright.config.ts` if neither exists yet — the skill knows the conventions). If Playwright isn't yet a dependency, the skill will scaffold it.

- [ ] **Step 4: Run the Playwright test**

Run: `cd frontend && npx playwright test tests/e2e/path-player.spec.ts`
Expected: 1 passed.

- [ ] **Step 5: Final commit**

```bash
git add frontend/tests/e2e/path-player.spec.ts frontend/playwright.config.ts frontend/package.json frontend/package-lock.json
git commit -m "test(paths): add player happy-path Playwright test"
```

(Adjust the `git add` list to whatever Playwright actually scaffolded.)

---

## Self-review checklist (run after writing the plan)

- **Spec coverage:** Player-shell layout (Tasks 7+8), tab filter (Tasks 1–7), owner-action removal (deliberate omission in Task 7), auto source media (Task 7), lesson read-more (Task 8), sticky bottom nav with titles (Task 8), `path_progress` preserved (Task 8), no backend changes (verified — none of the tasks touch `backend/`). ✅
- **Placeholder scan:** No "TBD"/"TODO"/"similar to". Each task has full code. ✅
- **Type consistency:** `PlayerTab` union in Task 7 lists 5 tabs; same 5 are referenced from Task 8's tab strip rendering. `Card`, `CardTranslationOut`, `QuizQuestion`, `PathDetail` are existing types from `lib/api.ts` — no invented shapes. ✅

---

## Done criteria recap

- All 10 tasks ticked.
- `npx tsc -b --noEmit` clean.
- Manual checklist (Task 10 Step 2) all green.
- One Playwright test green.
- No backend changes; no DB migration; library card-detail page unchanged.
