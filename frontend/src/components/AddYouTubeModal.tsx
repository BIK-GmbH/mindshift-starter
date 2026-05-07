import { FileText, Globe, Loader2, Upload, X, Youtube } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../lib/api";

type Tab = "youtube" | "article" | "pdf";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (cardId: string) => void;
}

const tabs: { id: Tab; Icon: typeof Youtube; labelKey: string }[] = [
  { id: "youtube", Icon: Youtube, labelKey: "addContent.youtube" },
  { id: "article", Icon: Globe, labelKey: "addContent.article" },
  { id: "pdf", Icon: FileText, labelKey: "addContent.pdf" },
];

export default function AddContentModal({ open, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("youtube");
  const [url, setUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setUrl("");
      setPdfFile(null);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let card;
      if (tab === "youtube") {
        ({ card } = await api.createFromYouTube(url.trim()));
      } else if (tab === "article") {
        ({ card } = await api.createFromUrl(url.trim()));
      } else {
        if (!pdfFile) throw new Error(t("addContent.pickFile") ?? "Pick a file");
        ({ card } = await api.createFromPdf(pdfFile));
      }
      onCreated(card.id);
      onClose();
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  const placeholders: Record<Tab, string> = {
    youtube: "https://www.youtube.com/watch?v=…",
    article: "https://example.com/article",
    pdf: "",
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-ink-700 bg-ink-800 shadow-xl">
        <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-medium">{t("library.addContent")}</h2>
          <button type="button" onClick={onClose} className="text-ink-300 hover:text-ink-100">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex gap-1 border-b border-ink-700 px-4 pt-3 text-xs">
          {tabs.map(({ id, Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={[
                "inline-flex items-center gap-1.5 border-b-2 px-2 pb-2 transition",
                tab === id
                  ? "border-ink-100 text-ink-100"
                  : "border-transparent text-ink-300 hover:text-ink-100",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(labelKey)}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3 p-4">
          {tab === "pdf" ? (
            <div
              className="flex flex-col items-center gap-2 rounded border border-dashed border-ink-600 bg-ink-900 px-3 py-6 text-center"
            >
              <Upload className="h-5 w-5 text-ink-300" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-ink-100 underline-offset-2 hover:underline"
              >
                {pdfFile ? pdfFile.name : t("addContent.choosePdf")}
              </button>
              {pdfFile && (
                <span className="text-[10px] text-ink-400">
                  {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <input
              type="url"
              required
              autoFocus
              placeholder={placeholders[tab]}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded border border-ink-600 bg-ink-900 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-300"
            />
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-700"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || (tab === "pdf" && !pdfFile)}
              className="inline-flex items-center gap-2 rounded bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-900 hover:bg-ink-200 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
