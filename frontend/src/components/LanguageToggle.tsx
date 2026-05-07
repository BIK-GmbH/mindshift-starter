import { useTranslation } from "react-i18next";

const languages = [
  { code: "de", label: "DE" },
  { code: "en", label: "EN" },
] as const;

export default function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? "en";

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-ink-500">
        {current === "de" ? "Sprache" : "Language"}
      </span>
      <div className="flex gap-0.5 rounded-md bg-ink-900/50 p-0.5 ring-1 ring-ink-800">
        {languages.map(({ code, label }) => (
          <button
            key={code}
            type="button"
            onClick={() => void i18n.changeLanguage(code)}
            className={[
              "rounded px-2 py-0.5 text-[10px] font-medium tracking-wider transition",
              current.startsWith(code)
                ? "bg-ink-100 text-ink-900"
                : "text-ink-400 hover:text-ink-100",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
