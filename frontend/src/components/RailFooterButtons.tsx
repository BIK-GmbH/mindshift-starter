import { Languages, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSettingsModal } from "../lib/SettingsModalContext";
import { useTheme } from "../lib/ThemeContext";

/**
 * Footer trio for the outer rail: theme toggle, language toggle, settings.
 * Always visible — independent of which context-sidebar is open.
 */
export default function RailFooterButtons() {
  const { theme, toggleTheme } = useTheme();
  const { openModal } = useSettingsModal();
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? "en";
  const nextLang = current.startsWith("de") ? "en" : "de";
  const langLabel = current.startsWith("de") ? "DE" : "EN";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={toggleTheme}
        title={theme === "dark" ? t("settings.appearance.light") : t("settings.appearance.dark")}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-400 transition hover:bg-ink-800/60 hover:text-ink-100"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>

      <button
        type="button"
        onClick={() => void i18n.changeLanguage(nextLang)}
        title={t("settings.appearance.language")}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-400 transition hover:bg-ink-800/60 hover:text-ink-100"
        aria-label="Toggle language"
      >
        <span className="flex flex-col items-center justify-center leading-none">
          <Languages className="mb-0.5 h-3.5 w-3.5" />
          <span className="text-[8px] font-semibold tracking-wider">{langLabel}</span>
        </span>
      </button>

      <button
        type="button"
        onClick={openModal}
        title={t("nav.settings")}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-400 transition hover:bg-ink-800/60 hover:text-ink-100"
        aria-label="Open settings"
      >
        <SettingsIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
