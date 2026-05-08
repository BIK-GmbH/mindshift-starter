import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Bot,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Maximize2,
  Minimize2,
  Quote,
  Scissors,
  Sparkles,
  Strikethrough,
  X,
} from "lucide-react";
import { marked } from "marked";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import TurndownService from "turndown";

import { api } from "../lib/api";

interface Props {
  /** Markdown source (controlled). */
  markdown: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: number;
  /** Render the toolbar above the editor. Default true. */
  showToolbar?: boolean;
  /** Auto-focus on mount. */
  autoFocus?: boolean;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});

function markdownToHtml(md: string): string {
  if (!md) return "";
  return marked.parse(md, { async: false }) as string;
}

function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return turndown.turndown(html);
}

/**
 * TipTap-based markdown editor. The component is controlled on the
 * markdown side — parent owns the source-of-truth string. The editor
 * round-trips through `marked` (md→html) and `turndown` (html→md) so
 * the persisted format stays markdown.
 */
export default function RichTextEditor({
  markdown,
  onChange,
  placeholder,
  minHeight = 200,
  showToolbar = true,
  autoFocus = false,
}: Props) {
  // Track the last markdown we emitted, so we don't loop the editor
  // when the parent re-passes the same string back.
  const lastEmitted = useRef<string>(markdown);
  const [isFullscreen, setFullscreen] = useState(false);
  const [aiBusy, setAiBusy] = useState<"expand" | "shorten" | "custom" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: "rt-codeblock" } },
        bulletList: { HTMLAttributes: { class: "list-disc pl-5" } },
        orderedList: { HTMLAttributes: { class: "list-decimal pl-5" } },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "text-ink-100 underline underline-offset-2" },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: markdownToHtml(markdown),
    editorProps: {
      attributes: {
        class:
          "prose prose-invert max-w-none focus:outline-none text-sm leading-relaxed text-ink-100",
        style: `min-height:${minHeight}px`,
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const md = htmlToMarkdown(html);
      lastEmitted.current = md;
      onChange(md);
    },
    autofocus: autoFocus ? "end" : false,
  });

  // Re-sync content if the parent swaps the markdown for a different value
  // (e.g. when loading a different card's notes). Avoids resetting the
  // editor on every keystroke since lastEmitted catches that.
  useEffect(() => {
    if (!editor) return;
    if (markdown === lastEmitted.current) return;
    editor.commands.setContent(markdownToHtml(markdown), { emitUpdate: false });
    lastEmitted.current = markdown;
  }, [markdown, editor]);

  // ESC exits fullscreen.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const runAi = async (action: "expand" | "shorten" | "custom", instruction?: string) => {
    if (!editor || aiBusy) return;
    const { from, to } = editor.state.selection;
    const hasSelection = from < to;
    const inputText = hasSelection
      ? editor.state.doc.textBetween(from, to, "\n", "\n")
      : htmlToMarkdown(editor.getHTML());
    if (!inputText.trim()) return;
    if (action === "custom" && !instruction?.trim()) return;

    setAiBusy(action);
    setAiError(null);
    try {
      const result = await api.transformText(inputText, action, instruction);
      // Convert markdown → HTML so AI-emitted formatting (bold, lists,
      // headings) actually renders instead of showing raw asterisks.
      const html = markdownToHtml(result.text);
      if (hasSelection) {
        editor.chain().focus().deleteRange({ from, to }).insertContent(html).run();
      } else {
        editor.commands.setContent(html, { emitUpdate: true });
      }
    } catch (err) {
      setAiError((err as Error).message || "AI request failed");
    } finally {
      setAiBusy(null);
    }
  };

  const submitCustomPrompt = () => {
    const instruction = customPrompt.trim();
    if (!instruction) return;
    void runAi("custom", instruction);
    setCustomMode(false);
    setCustomPrompt("");
  };

  if (!editor) return null;

  const editorClass = isFullscreen
    ? "flex-1 min-h-0 overflow-y-auto rounded-md border border-ink-700 bg-ink-900/40 px-8 py-6 transition focus-within:border-ink-500 focus-within:ring-2 focus-within:ring-ink-700/40"
    : "rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2 transition focus-within:border-ink-500 focus-within:ring-2 focus-within:ring-ink-700/40";

  const editorBlock = (
    <>
      {showToolbar && (
        <Toolbar
          editor={editor}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setFullscreen((v) => !v)}
          onAi={(action) => {
            if (action === "custom") setCustomMode((v) => !v);
            else void runAi(action);
          }}
          aiBusy={aiBusy}
          customActive={customMode}
        />
      )}
      {customMode && (
        <div className="flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-900/60 px-2 py-1.5 fullscreen-prompt-enter">
          <Bot className="h-3.5 w-3.5 flex-shrink-0 text-ink-400" />
          <input
            type="text"
            autoFocus
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitCustomPrompt();
              } else if (e.key === "Escape") {
                setCustomMode(false);
                setCustomPrompt("");
              }
            }}
            placeholder="Was soll die AI mit dem Text machen? (Enter = anwenden)"
            className="flex-1 bg-transparent text-xs text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={submitCustomPrompt}
            disabled={!customPrompt.trim() || aiBusy !== null}
            className="rounded-md bg-ink-100 px-2 py-1 text-[10px] font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
          >
            Anwenden
          </button>
          <button
            type="button"
            onClick={() => {
              setCustomMode(false);
              setCustomPrompt("");
            }}
            className="rounded p-1 text-ink-400 transition hover:bg-ink-700 hover:text-ink-100"
            aria-label="Cancel"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {aiError && (
        <p className="rounded-md bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300 ring-1 ring-red-500/30">
          {aiError}
        </p>
      )}
      <div className={isFullscreen ? "relative flex-1 min-h-0" : "relative"}>
        <EditorContent editor={editor} className={editorClass} />
        {aiBusy && <AiSkeleton action={aiBusy} />}
      </div>
    </>
  );

  if (isFullscreen) {
    // Portal-mounted into document.body so the parent modal's `transform`
    // (from its enter animation) can't reframe `position: fixed`. The
    // backdrop has a soft satin gradient + heavy blur for depth; the
    // card itself is constrained to ~A4 width (820 px) so reading lines
    // stay short and comfortable.
    return createPortal(
      <div className="fixed inset-0 z-[60] fullscreen-shell">
        <div className="absolute inset-0 fullscreen-shell-enter" />
        <div className="absolute inset-0 flex justify-center px-4 py-[6vh]">
          <div className="flex w-full max-w-[820px] flex-col gap-2 fullscreen-card-enter">
            {editorBlock}
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return <div className="flex flex-col gap-2">{editorBlock}</div>;
}

function AiSkeleton({ action }: { action: "expand" | "shorten" | "custom" }) {
  // Five lines of varying widths — looks like prose loading. Stagger the
  // pulse so the eye reads it as activity rather than a static placeholder.
  const widths = ["w-11/12", "w-10/12", "w-9/12", "w-11/12", "w-7/12"];
  const label =
    action === "expand"
      ? "Erweitern…"
      : action === "shorten"
        ? "Kürzen…"
        : "AI bearbeitet…";
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 flex flex-col gap-3 rounded-md border border-ink-700 bg-ink-900/85 px-6 py-5 backdrop-blur-sm"
    >
      <div className="mb-1 inline-flex items-center gap-2 text-[11px] font-medium text-ink-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        {label}
      </div>
      {widths.map((w, i) => (
        <div
          key={i}
          className={`h-3 animate-pulse rounded bg-ink-700/70 ${w}`}
          style={{ animationDelay: `${i * 110}ms` }}
        />
      ))}
    </div>
  );
}

function Toolbar({
  editor,
  isFullscreen,
  onToggleFullscreen,
  onAi,
  aiBusy,
  customActive,
}: {
  editor: Editor;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onAi: (action: "expand" | "shorten" | "custom") => void;
  aiBusy: "expand" | "shorten" | "custom" | null;
  customActive: boolean;
}) {
  const { from, to } = editor.state.selection;
  const hasSelection = from < to;
  const aiTooltip = hasSelection ? " (selection)" : " (whole note)";
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-ink-700 bg-ink-900/40 p-1">
      <ToolbarButton
        Icon={Heading2}
        label="Heading"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        Icon={Bold}
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        Icon={Italic}
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        Icon={Strikethrough}
        label="Strike"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <span className="mx-1 h-4 w-px bg-ink-700" />
      <ToolbarButton
        Icon={List}
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        Icon={ListOrdered}
        label="Ordered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        Icon={Quote}
        label="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolbarButton
        Icon={Code}
        label="Inline code"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <span className="mx-1 h-4 w-px bg-ink-700" />
      <ToolbarButton
        Icon={Link2}
        label="Link"
        active={editor.isActive("link")}
        onClick={() => {
          const previous = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link URL", previous ?? "https://");
          if (url === null) return; // cancelled
          if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
      />
      <span className="mx-1 h-4 w-px bg-ink-700" />
      <ToolbarButton
        Icon={aiBusy === "custom" ? Loader2 : Bot}
        label={`Eigener AI-Prompt${aiTooltip}`}
        active={customActive}
        disabled={aiBusy !== null}
        spinning={aiBusy === "custom"}
        onClick={() => onAi("custom")}
      />
      <ToolbarButton
        Icon={aiBusy === "expand" ? Loader2 : Sparkles}
        label={`Erweitern${aiTooltip}`}
        active={false}
        disabled={aiBusy !== null}
        spinning={aiBusy === "expand"}
        onClick={() => onAi("expand")}
      />
      <ToolbarButton
        Icon={aiBusy === "shorten" ? Loader2 : Scissors}
        label={`Kürzen${aiTooltip}`}
        active={false}
        disabled={aiBusy !== null}
        spinning={aiBusy === "shorten"}
        onClick={() => onAi("shorten")}
      />
      <span className="ml-auto" />
      <ToolbarButton
        Icon={isFullscreen ? Minimize2 : Maximize2}
        label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        active={isFullscreen}
        onClick={onToggleFullscreen}
      />
    </div>
  );
}

function ToolbarButton({
  Icon,
  label,
  active,
  onClick,
  disabled = false,
  spinning = false,
}: {
  Icon: typeof Bold;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded text-[12px] transition",
        active
          ? "bg-ink-100 text-ink-900"
          : "text-ink-300 hover:bg-ink-700/60 hover:text-ink-100",
        disabled ? "cursor-not-allowed opacity-50" : "",
      ].join(" ")}
    >
      <Icon className={["h-3.5 w-3.5", spinning ? "animate-spin" : ""].join(" ")} />
    </button>
  );
}
