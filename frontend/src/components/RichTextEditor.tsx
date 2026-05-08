import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { marked } from "marked";
import { useEffect, useRef } from "react";
import TurndownService from "turndown";

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

  if (!editor) return null;

  return (
    <div className="flex flex-col gap-2">
      {showToolbar && <Toolbar editor={editor} />}
      <EditorContent
        editor={editor}
        className="rounded-md border border-ink-700 bg-ink-900/40 px-3 py-2 transition focus-within:border-ink-500 focus-within:ring-2 focus-within:ring-ink-700/40"
      />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
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
    </div>
  );
}

function ToolbarButton({
  Icon,
  label,
  active,
  onClick,
}: {
  Icon: typeof Bold;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded text-[12px] transition",
        active
          ? "bg-ink-100 text-ink-900"
          : "text-ink-300 hover:bg-ink-700/60 hover:text-ink-100",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
