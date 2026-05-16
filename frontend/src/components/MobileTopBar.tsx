import {
  Brain,
  GraduationCap,
  HelpCircle,
  Languages,
  MessageSquare,
  Menu,
  Moon,
  Network,
  Rss,
  Settings as SettingsIcon,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { useOnboardingModal } from "../lib/OnboardingModalContext";
import { useSettingsModal } from "../lib/SettingsModalContext";
import { useTheme } from "../lib/ThemeContext";
import { playSound } from "../lib/sounds";

/**
 * Slim app bar at the top of the mobile viewport (`<md`). Holds the
 * brand mark and the hamburger that opens a drawer with desktop-only
 * destinations + theme/lang/settings — keeps the bottom nav
 * uncluttered to its three primary routes.
 *
 * Drawer destinations are intentionally framed as "best on desktop"
 * so the user knows graph/chat/review work but the canvas is tight.
 */
const drawerItems = [
  { to: "/graph", labelKey: "nav.graph", Icon: Network, desktopOnly: true },
  { to: "/chat", labelKey: "nav.chat", Icon: MessageSquare, desktopOnly: true },
  { to: "/review", labelKey: "nav.review", Icon: GraduationCap, desktopOnly: true },
  { to: "/feeds", labelKey: "nav.feeds", Icon: Rss, desktopOnly: true },
];

export default function MobileTopBar() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { openModal: openSettings } = useSettingsModal();
  const { openModal: openOnboarding } = useOnboardingModal();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on Escape — common a11y expectation.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const current = i18n.resolvedLanguage ?? "en";
  const nextLang = current.startsWith("de") ? "en" : "de";
  const langLabel = current.startsWith("de") ? "DE" : "EN";

  return (
    <>
      <header
        className="sticky top-0 z-30 flex flex-shrink-0 items-center justify-between border-b border-ink-800 bg-ink-900/95 px-3 backdrop-blur md:hidden"
        style={{
          // On iOS PWA the status bar overlays the viewport — without
          // this padding the brand row hugs the clock. Expressed inline
          // so the height grows by exactly the inset rather than using
          // a magic Tailwind value.
          paddingTop: "env(safe-area-inset-top)",
          minHeight: "calc(3rem + env(safe-area-inset-top))",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink-100 text-ink-900"
            aria-hidden="true"
          >
            <Brain className="h-4 w-4" />
          </span>
          <span className="text-[13px] font-semibold tracking-tight text-ink-100">
            {t("app.name")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            playSound("tick");
            setDrawerOpen(true);
          }}
          aria-label="Menu"
          className="flex h-9 w-9 items-center justify-center rounded-md text-ink-300 transition hover:bg-ink-800 active:bg-ink-800"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {drawerOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col border-l border-ink-800 bg-ink-900 shadow-2xl md:hidden">
            <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-800 px-4 py-3">
              <p className="text-sm font-semibold text-ink-100">
                {t("nav.menu", { defaultValue: "Menu" })}
              </p>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex h-8 w-8 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                {t("nav.moreSections", { defaultValue: "More sections" })}
              </p>
              <nav className="flex flex-col" aria-label="secondary">
                {drawerItems.map(({ to, labelKey, Icon, desktopOnly }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => {
                      playSound("tick");
                      setDrawerOpen(false);
                    }}
                    className={({ isActive }) =>
                      [
                        "flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition",
                        isActive
                          ? "bg-ink-800/60 text-ink-100"
                          : "text-ink-200 active:bg-ink-800/40",
                      ].join(" ")
                    }
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4 text-ink-400" />
                      {t(labelKey)}
                    </span>
                    {desktopOnly && (
                      <span className="rounded-full border border-ink-700 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-ink-500">
                        {t("nav.desktopBetter", { defaultValue: "Desktop" })}
                      </span>
                    )}
                  </NavLink>
                ))}
              </nav>

              <p className="mt-4 px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                {t("nav.preferences", { defaultValue: "Preferences" })}
              </p>
              <button
                type="button"
                onClick={() => {
                  toggleTheme();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-ink-200 transition active:bg-ink-800/40"
              >
                {theme === "dark" ? (
                  <Moon className="h-4 w-4 text-ink-400" />
                ) : (
                  <Sun className="h-4 w-4 text-ink-400" />
                )}
                {theme === "dark"
                  ? t("settings.appearance.light")
                  : t("settings.appearance.dark")}
              </button>
              <button
                type="button"
                onClick={() => void i18n.changeLanguage(nextLang)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-ink-200 transition active:bg-ink-800/40"
              >
                <Languages className="h-4 w-4 text-ink-400" />
                {t("settings.appearance.language")}
                <span className="ml-auto rounded border border-ink-700 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-ink-300">
                  {langLabel}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  openSettings();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-ink-200 transition active:bg-ink-800/40"
              >
                <SettingsIcon className="h-4 w-4 text-ink-400" />
                {t("nav.settings")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  openOnboarding();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-ink-200 transition active:bg-ink-800/40"
              >
                <HelpCircle className="h-4 w-4 text-ink-400" />
                {t("onboarding.menuLabel", { defaultValue: "Setup guide" })}
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
