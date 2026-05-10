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
