import {
  Bookmark,
  Edit3,
  ExternalLink,
  FileText as FileIcon,
  Globe,
  Inbox,
  Link as LinkIcon,
  Loader2,
  Pocket,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type ImportSummary, type WikiHit } from "../lib/api";

type Tab = "url" | "wiki" | "pdf" | "import" | "note";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (cardId?: string) => void;
}

const tabs: { id: Tab; Icon: typeof LinkIcon; labelKey: string }[] = [
  { id: "url", Icon: LinkIcon, labelKey: "addContent.tab.url" },
  { id: "wiki", Icon: Search, labelKey: "addContent.tab.wiki" },
  { id: "pdf", Icon: FileIcon, labelKey: "addContent.tab.pdf" },
  { id: "import", Icon: Inbox, labelKey: "addContent.tab.import" },
  { id: "note", Icon: Edit3, labelKey: "addContent.tab.note" },
];

const URL_EXAMPLES = [
  { Icon: ExternalLink, label: "YouTube videos" },
  { Icon: ExternalLink, label: "Spotify Podcasts" },
  { Icon: ExternalLink, label: "Apple Podcasts" },
  { Icon: ExternalLink, label: "Websites" },
  { Icon: ExternalLink, label: "Google Docs" },
  { Icon: ExternalLink, label: "TikTok" },
];

const WIKI_EXAMPLES = ["Sam Altman", "Interstellar", "Atomic Habits", "Peptide", "Machu Picchu", "Stoicism"];

export default function AddContentModal({ open, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("url");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL tab
  const [url, setUrl] = useState("");

  // PDF tab
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  // Wiki tab
  const [wikiQuery, setWikiQuery] = useState("");
  const [wikiHits, setWikiHits] = useState<WikiHit[]>([]);
  const [wikiBusy, setWikiBusy] = useState(false);

  // Note tab
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteSummarize, setNoteSummarize] = useState(false);

  // Import tab
  const bookmarksRef = useRef<HTMLInputElement>(null);
  const markdownRef = useRef<HTMLInputElement>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setError(null);
      setImportMessage(null);
      setUrl("");
      setPdfFile(null);
      setWikiQuery("");
      setWikiHits([]);
      setNoteTitle("");
      setNoteBody("");
      setNoteSummarize(false);
    }
  }, [open]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Wiki live search (debounced)
  useEffect(() => {
    if (tab !== "wiki" || !open) return;
    const q = wikiQuery.trim();
    if (q.length < 2) {
      setWikiHits([]);
      return;
    }
    let cancelled = false;
    setWikiBusy(true);
    const timer = window.setTimeout(() => {
      api
        .wikiSearch(q)
        .then((hits) => {
          if (!cancelled) setWikiHits(hits);
        })
        .catch(() => {
          if (!cancelled) setWikiHits([]);
        })
        .finally(() => {
          if (!cancelled) setWikiBusy(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setWikiBusy(false);
    };
  }, [wikiQuery, tab, open]);

  if (!open) return null;

  const submitUrl = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setBusy(true);
    try {
      const isYouTube = /(?:youtube\.com|youtu\.be)/i.test(trimmed);
      const { card } = isYouTube
        ? await api.createFromYouTube(trimmed)
        : await api.createFromUrl(trimmed);
      onCreated(card.id);
      onClose();
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const submitPdf = async () => {
    if (!pdfFile) return;
    setError(null);
    setBusy(true);
    try {
      const { card } = await api.createFromPdf(pdfFile);
      onCreated(card.id);
      onClose();
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const submitWikiHit = async (hit: WikiHit) => {
    setError(null);
    setBusy(true);
    try {
      const { card } = await api.createFromUrl(hit.url);
      onCreated(card.id);
      onClose();
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const submitNote = async () => {
    const title = noteTitle.trim();
    if (!title) return;
    setError(null);
    setBusy(true);
    try {
      const { card } = await api.createFromNote(title, noteBody, noteSummarize);
      onCreated(card.id);
      onClose();
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (kind: "bookmarks" | "markdown", file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    setImportMessage(null);
    setBusy(true);
    try {
      const summary: ImportSummary =
        kind === "bookmarks" ? await api.importBookmarks(file) : await api.importMarkdown(file);
      const msg =
        summary.queued === 0
          ? summary.detail ?? t("addContent.import.empty")
          : t("addContent.import.queued", { defaultValue: `${summary.queued} items queued.` });
      setImportMessage(msg);
      onCreated();
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("library.addContent")}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md modal-backdrop-enter"
      />

      <div className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 shadow-2xl modal-card-enter">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="text-base font-semibold text-ink-100">{t("library.addContent")}</h2>
          <div className="flex items-center gap-2">
            <kbd className="rounded border border-ink-700 bg-ink-900/40 px-1.5 py-0.5 text-[10px] font-mono text-ink-400">
              ESC
            </kbd>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-ink-300 transition hover:bg-ink-700/60 hover:text-ink-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tab strip */}
        <div className="flex gap-0.5 border-b border-ink-700 px-3 pt-3">
          {tabs.map(({ id, Icon, labelKey }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={[
                  "inline-flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-xs font-medium uppercase tracking-wide transition",
                  active
                    ? "border-ink-100 text-ink-100"
                    : "border-transparent text-ink-400 hover:text-ink-100",
                ].join(" ")}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {tab === "url" && (
            <UrlTab
              url={url}
              setUrl={setUrl}
              busy={busy}
              onSubmit={submitUrl}
            />
          )}
          {tab === "wiki" && (
            <WikiTab
              query={wikiQuery}
              setQuery={setWikiQuery}
              hits={wikiHits}
              busy={wikiBusy}
              onPick={submitWikiHit}
            />
          )}
          {tab === "pdf" && (
            <PdfTab
              file={pdfFile}
              setFile={setPdfFile}
              fileRef={pdfRef}
              busy={busy}
              onSubmit={submitPdf}
            />
          )}
          {tab === "import" && (
            <ImportTab
              busy={busy}
              message={importMessage}
              onPickBookmarks={() => bookmarksRef.current?.click()}
              onPickMarkdown={() => markdownRef.current?.click()}
            />
          )}
          {tab === "note" && (
            <NoteTab
              title={noteTitle}
              setTitle={setNoteTitle}
              body={noteBody}
              setBody={setNoteBody}
              summarize={noteSummarize}
              setSummarize={setNoteSummarize}
              busy={busy}
              onSubmit={submitNote}
            />
          )}

          {error && (
            <p className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
          )}
        </div>

        <input
          ref={bookmarksRef}
          type="file"
          accept=".html,.htm,text/html"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            void handleImport("bookmarks", f);
            if (e.target) e.target.value = "";
          }}
        />
        <input
          ref={markdownRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            void handleImport("markdown", f);
            if (e.target) e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// --- Tab components --------------------------------------------------------

function UrlTab({
  url,
  setUrl,
  busy,
  onSubmit,
}: {
  url: string;
  setUrl: (v: string) => void;
  busy: boolean;
  onSubmit: (e?: React.FormEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            type="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("addContent.urlPlaceholder", { defaultValue: "Paste a URL here" })}
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 py-2 pl-9 pr-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("addContent.create", { defaultValue: "Create" })}
        </button>
      </div>

      <div>
        <p className="mb-2 text-center text-[10px] uppercase tracking-[0.18em] text-ink-500">
          {t("addContent.examples", { defaultValue: "Examples" })}
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs text-ink-300">
          {URL_EXAMPLES.map(({ Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-2 rounded-md px-2 py-1.5">
              <Icon className="h-3.5 w-3.5 text-ink-500" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </form>
  );
}

function WikiTab({
  query,
  setQuery,
  hits,
  busy,
  onPick,
}: {
  query: string;
  setQuery: (v: string) => void;
  hits: WikiHit[];
  busy: boolean;
  onPick: (hit: WikiHit) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("addContent.wikiPlaceholder", { defaultValue: "Add wiki sources for movies, people, places, and things" })}
          className="w-full rounded-md border border-ink-700 bg-ink-900/40 py-2 pl-9 pr-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
        />
      </div>

      {query.trim().length < 2 ? (
        <div>
          <p className="mb-2 text-center text-[10px] uppercase tracking-[0.18em] text-ink-500">
            {t("addContent.examples")}
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-ink-300">
            {WIKI_EXAMPLES.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setQuery(label)}
                className="inline-flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition hover:border-ink-700 hover:bg-ink-700/30"
              >
                <Globe className="h-3.5 w-3.5 text-ink-500" />
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : busy && hits.length === 0 ? (
        <p className="flex items-center gap-2 px-2 py-3 text-sm text-ink-400">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
        </p>
      ) : hits.length === 0 ? (
        <p className="px-2 py-3 text-sm text-ink-400">
          {t("addContent.wikiEmpty", { defaultValue: "No matching Wikipedia articles." })}
        </p>
      ) : (
        <ul className="divide-y divide-ink-700/60 rounded-lg border border-ink-700">
          {hits.map((hit) => (
            <li key={hit.url}>
              <button
                type="button"
                onClick={() => onPick(hit)}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-ink-700/40"
              >
                <Globe className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-100">{hit.title}</p>
                  {hit.description && (
                    <p className="line-clamp-2 text-xs text-ink-400">{hit.description}</p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PdfTab({
  file,
  setFile,
  fileRef,
  busy,
  onSubmit,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  fileRef: React.RefObject<HTMLInputElement>;
  busy: boolean;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-ink-700 bg-ink-900/30 px-4 py-10 text-center transition hover:border-ink-500 hover:bg-ink-900/50"
      >
        <Upload className="h-6 w-6 text-ink-400" />
        <span className="text-sm font-medium text-ink-100">
          {file ? file.name : t("addContent.choosePdf")}
        </span>
        {file && (
          <span className="text-[10px] text-ink-400">
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </span>
        )}
        <span className="mt-1 text-[10px] text-ink-500">PDF · max 25 MB</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !file}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("addContent.create")}
        </button>
      </div>
    </div>
  );
}

function ImportTab({
  busy,
  message,
  onPickBookmarks,
  onPickMarkdown,
}: {
  busy: boolean;
  message: string | null;
  onPickBookmarks: () => void;
  onPickMarkdown: () => void;
}) {
  const { t } = useTranslation();
  const tiles = useMemo(
    () => [
      {
        Icon: Bookmark,
        title: t("addContent.import.bookmarks.title"),
        body: t("addContent.import.bookmarks.body"),
        onClick: onPickBookmarks,
        disabled: false,
      },
      {
        Icon: Pocket,
        title: t("addContent.import.pocket.title"),
        body: t("addContent.import.pocket.body"),
        onClick: () => undefined,
        disabled: true,
      },
      {
        Icon: FileIcon,
        title: t("addContent.import.markdown.title"),
        body: t("addContent.import.markdown.body"),
        onClick: onPickMarkdown,
        disabled: false,
      },
    ],
    [t, onPickBookmarks, onPickMarkdown],
  );

  return (
    <div className="space-y-2">
      {tiles.map(({ Icon, title, body, onClick, disabled }) => (
        <button
          key={title}
          type="button"
          onClick={onClick}
          disabled={busy || disabled}
          className="flex w-full items-start gap-3 rounded-lg border border-ink-700 bg-ink-900/30 px-4 py-3 text-left transition hover:border-ink-500 hover:bg-ink-900/50 disabled:opacity-50"
        >
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-ink-700/60">
            <Icon className="h-4 w-4 text-ink-200" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink-100">
              {title}
              {disabled && <span className="ml-2 text-[10px] uppercase text-ink-500">soon</span>}
            </p>
            <p className="text-xs text-ink-400">{body}</p>
          </div>
        </button>
      ))}
      {message && (
        <p className="rounded-md border border-ink-700 bg-ink-700/30 px-3 py-2 text-xs text-ink-200">
          {message}
        </p>
      )}
      <p className="rounded-md border border-ink-700/60 bg-ink-900/30 px-3 py-2 text-[11px] leading-relaxed text-ink-400">
        {t("addContent.import.note")}
      </p>
    </div>
  );
}

function NoteTab({
  title,
  setTitle,
  body,
  setBody,
  summarize,
  setSummarize,
  busy,
  onSubmit,
}: {
  title: string;
  setTitle: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  summarize: boolean;
  setSummarize: (v: boolean) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("addContent.notePlaceholderTitle", { defaultValue: "Title" })}
        className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("addContent.notePlaceholderBody", { defaultValue: "Write your note in markdown… *italic*, **bold**, lists, links" })}
        rows={10}
        className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
      />
      <div className="flex items-center justify-between">
        <label className="inline-flex items-center gap-2 text-xs text-ink-300">
          <input
            type="checkbox"
            checked={summarize}
            onChange={(e) => setSummarize(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t("addContent.note.summarize", { defaultValue: "Run AI summary on save" })}
        </label>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !title.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}
