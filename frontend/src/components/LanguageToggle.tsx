import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

const languages = [
  { code: "de", label: "DE" },
  { code: "en", label: "EN" },
] as const;

export default function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? "en";

  return (
    <div className="flex items-center gap-2 text-xs text-ink-300">
      <Languages className="h-3.5 w-3.5" />
      <div className="flex overflow-hidden rounded border border-ink-600">
        {languages.map(({ code, label }) => (
          <button
            key={code}
            type="button"
            onClick={() => void i18n.changeLanguage(code)}
            className={[
              "px-2 py-1 transition",
              current.startsWith(code)
                ? "bg-ink-100 text-ink-900"
                : "bg-transparent text-ink-300 hover:bg-ink-700",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
