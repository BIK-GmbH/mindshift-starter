import {
  Brain,
  Library,
  MessageSquare,
  Network,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import LanguageToggle from "./LanguageToggle";
import TagsTree from "./TagsTree";

const railItems = [
  { to: "/", labelKey: "nav.library", Icon: Library, end: true },
  { to: "/graph", labelKey: "nav.graph", Icon: Network },
  { to: "/chat", labelKey: "nav.chat", Icon: MessageSquare },
  { to: "/search", labelKey: "nav.search", Icon: Search },
  { to: "/review", labelKey: "nav.review", Icon: RefreshCw },
];

const PAGES_WITH_TAGS_SIDEBAR = new Set<string>(["/", "/library", "/search", "/chat"]);

export default function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();

  // Show tags sidebar on Library + a few related pages. Not on /graph (has its own
  // settings panel), /review, /settings, /cards/:id (own header/sidebar layout).
  const showTagsSidebar =
    PAGES_WITH_TAGS_SIDEBAR.has(location.pathname) ||
    location.pathname.startsWith("/?");

  return (
    <div className="flex h-full bg-ink-900">
      {/* Outer rail — narrow icon-only navigation */}
      <aside className="flex w-14 flex-col items-center border-r border-ink-800 bg-ink-900 py-3">
        <div
          className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-ink-100 text-ink-900 shadow-md"
          title={t("app.name")}
        >
          <Brain className="h-4 w-4" />
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1.5" aria-label="primary">
          {railItems.map(({ to, labelKey, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={t(labelKey)}
              className={({ isActive }) =>
                [
                  "group relative flex h-9 w-9 items-center justify-center rounded-xl transition",
                  isActive
                    ? "bg-ink-800 text-ink-100 ring-1 ring-ink-700"
                    : "text-ink-400 hover:bg-ink-800/60 hover:text-ink-100",
                ].join(" ")
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute -left-3 h-5 w-0.5 rounded-full bg-ink-100" />
                  )}
                  <Icon className="h-4 w-4" />
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <NavLink
          to="/settings"
          title={t("nav.settings")}
          className={({ isActive }) =>
            [
              "flex h-9 w-9 items-center justify-center rounded-xl transition",
              isActive
                ? "bg-ink-800 text-ink-100 ring-1 ring-ink-700"
                : "text-ink-400 hover:bg-ink-800/60 hover:text-ink-100",
            ].join(" ")
          }
        >
          <SettingsIcon className="h-4 w-4" />
        </NavLink>
      </aside>

      {/* Context sidebar — tags tree by default */}
      {showTagsSidebar && (
        <aside className="flex w-60 flex-col border-r border-ink-800 bg-ink-900/60">
          <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
              {t("nav.tags")}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            <TagsTree />
          </div>
          <div className="border-t border-ink-800 p-3">
            <LanguageToggle />
          </div>
        </aside>
      )}

      {/* Main */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
