"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { useEffect } from "react";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
};

export function RichEditor({ value, onChange, placeholder, minHeight = "10rem" }: Props) {
  const editor = useEditor({
    // SSR guard — TipTap accesses window during setup.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "underline",
          style: "color: rgb(var(--accent))",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: "prose-editor focus:outline-none",
        style: `min-height: ${minHeight}`,
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      // TipTap emits "<p></p>" for empty content; treat that as empty string
      // so downstream code doesn't render an empty paragraph.
      onChange(html === "<p></p>" ? "" : html);
    },
  });

  // Keep external `value` in sync if it changes (e.g. reset after submit).
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || "<p></p>";
    if (current !== incoming) editor.commands.setContent(incoming, false);
  }, [value, editor]);

  return (
    <div className="rounded-xl border border-border bg-bg">
      <Toolbar editor={editor} />
      <div className="p-3">
        <EditorContent editor={editor} />
        {placeholder && !value && (
          <div
            className="text-sm text-muted pointer-events-none -mt-[1.5rem]"
            aria-hidden
          >
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div className="h-9 border-b border-border" />;

  const btn = (active: boolean, disabled = false) =>
    `px-2 py-1 rounded text-xs border transition ${
      active
        ? "bg-accent/15 border-accent/40 text-fg"
        : "border-transparent hover:bg-surface"
    } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`;

  return (
    <div className="flex items-center gap-1 flex-wrap p-1.5 border-b border-border bg-surface/50 rounded-t-xl">
      <button
        type="button"
        className={btn(editor.isActive("bold"))}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <b>B</b>
      </button>
      <button
        type="button"
        className={btn(editor.isActive("italic"))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <i>I</i>
      </button>
      <button
        type="button"
        className={btn(editor.isActive("strike"))}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <s>S</s>
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        className={btn(editor.isActive("heading", { level: 2 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading"
      >
        H2
      </button>
      <button
        type="button"
        className={btn(editor.isActive("heading", { level: 3 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Subheading"
      >
        H3
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        className={btn(editor.isActive("bulletList"))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bulleted list"
      >
        • List
      </button>
      <button
        type="button"
        className={btn(editor.isActive("orderedList"))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
      >
        1. List
      </button>
      <button
        type="button"
        className={btn(editor.isActive("blockquote"))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Quote"
      >
        &ldquo; &rdquo;
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        className={btn(editor.isActive("link"))}
        onClick={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("URL", prev ?? "https://");
          if (url === null) return;
          if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            return;
          }
          const safe = /^https?:\/\//i.test(url) ? url : `https://${url}`;
          editor.chain().focus().extendMarkRange("link").setLink({ href: safe }).run();
        }}
        title="Link"
      >
        🔗
      </button>
      <button
        type="button"
        className={btn(false, !editor.isActive("link"))}
        disabled={!editor.isActive("link")}
        onClick={() => editor.chain().focus().unsetLink().run()}
        title="Remove link"
      >
        ⛔
      </button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        className={btn(false)}
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        title="Clear formatting"
      >
        Clear
      </button>
    </div>
  );
}
