import { HelpCircle, Languages, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useOptionalOnboardingModal } from "../lib/OnboardingModalContext";
import { useSettingsModal } from "../lib/SettingsModalContext";
import { useTheme } from "../lib/ThemeContext";

/**
 * Footer trio for the outer rail: theme toggle, language toggle, settings.
 * Always visible — independent of which context-sidebar is open.
 *
 * `orientation` lets the same component render vertically inside the
 * desktop rail (default) or horizontally inside a mobile top-bar.
 *
 * `showSettings` controls whether the settings cog renders — turn off
 * for public surfaces where the visitor doesn't have an account and
 * the modal would be useless.
 */
export default function RailFooterButtons({
  orientation = "col",
  showSettings = true,
}: {
  orientation?: "col" | "row";
  showSettings?: boolean;
}) {
  const { theme, toggleTheme } = useTheme();
  const { openModal } = useSettingsModal();
  const onboarding = useOptionalOnboardingModal();
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? "en";
  const nextLang = current.startsWith("de") ? "en" : "de";
  const langLabel = current.startsWith("de") ? "DE" : "EN";

  return (
    <div
      className={[
        "flex items-center gap-1.5",
        orientation === "row" ? "flex-row" : "flex-col",
      ].join(" ")}
    >
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

      {showSettings && onboarding && (
        <button
          type="button"
          onClick={onboarding.openModal}
          title={t("onboarding.menuLabel", { defaultValue: "Setup guide" })}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-400 transition hover:bg-ink-800/60 hover:text-ink-100"
          aria-label="Open setup guide"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      )}

      {showSettings && (
        <button
          type="button"
          onClick={openModal}
          title={t("nav.settings")}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-ink-400 transition hover:bg-ink-800/60 hover:text-ink-100"
          aria-label="Open settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
