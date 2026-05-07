import {
  Brain,
  Library,
  MessageSquare,
  Network,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

import LanguageToggle from "./LanguageToggle";
import TagsList from "./TagsList";

const navItems = [
  { to: "/", labelKey: "nav.library", Icon: Library, end: true },
  { to: "/graph", labelKey: "nav.graph", Icon: Network },
  { to: "/chat", labelKey: "nav.chat", Icon: MessageSquare },
  { to: "/search", labelKey: "nav.search", Icon: Search },
  { to: "/review", labelKey: "nav.review", Icon: RefreshCw },
  { to: "/settings", labelKey: "nav.settings", Icon: Settings },
];

export default function AppLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full bg-ink-900">
      <aside className="flex w-60 flex-col border-r border-ink-800 bg-gradient-to-b from-ink-800 via-ink-800 to-ink-900/95">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-700/60 ring-1 ring-ink-700">
            <Brain className="h-4 w-4 text-ink-100" />
          </div>
          <span className="text-base font-semibold tracking-tight text-ink-100">
            {t("app.name")}
          </span>
        </div>

        {/* Primary navigation */}
        <nav className="flex-shrink-0 px-3" aria-label="primary">
          {navItems.map(({ to, labelKey, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-ink-700/70 text-ink-100"
                    : "text-ink-300 hover:bg-ink-700/40 hover:text-ink-100",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute -left-0.5 top-1.5 bottom-1.5 w-0.5 rounded-full bg-ink-100" />
                  )}
                  <Icon
                    className={[
                      "h-4 w-4 transition",
                      isActive ? "text-ink-100" : "text-ink-400 group-hover:text-ink-200",
                    ].join(" ")}
                  />
                  <span>{t(labelKey)}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Tags — fills remaining height, scrolls if many tags */}
        <div className="mt-5 flex-1 overflow-y-auto pb-3">
          <TagsList />
        </div>

        {/* Footer */}
        <div className="border-t border-ink-800 p-3">
          <LanguageToggle />
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
