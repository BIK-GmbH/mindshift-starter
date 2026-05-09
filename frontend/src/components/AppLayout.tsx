import { Brain, GraduationCap, Headphones, Library, MessageSquare, Network, Rss, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import GlobalSearchModal from "./GlobalSearchModal";
import RailFooterButtons from "./RailFooterButtons";
import SettingsModal from "./SettingsModal";
import { useSearchModal } from "../lib/SearchModalContext";
import { playSound } from "../lib/sounds";

const railItems = [
  { to: "/", labelKey: "nav.library", Icon: Library, end: true },
  { to: "/graph", labelKey: "nav.graph", Icon: Network },
  { to: "/chat", labelKey: "nav.chat", Icon: MessageSquare },
  { to: "/review", labelKey: "nav.review", Icon: GraduationCap },
  { to: "/podcasts", labelKey: "nav.podcasts", Icon: Headphones },
  { to: "/feeds", labelKey: "nav.feeds", Icon: Rss },
];

export default function AppLayout() {
  const { t } = useTranslation();
  const { openModal: openSearch } = useSearchModal();
  const location = useLocation();

  return (
    <div className="flex h-full bg-ink-900">
      {/* Outer rail — narrow icon-only navigation. Always visible. */}
      <aside className="panel-elevated relative z-10 flex w-14 flex-col items-center border-r border-ink-800 bg-ink-900 py-3">
        <div
          className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-ink-100 text-ink-900 surface-soft"
          role="img"
          aria-label={t("app.name")}
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
              onClick={() => playSound("tick")}
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

          {/* Search trigger — opens the global cmd+K modal */}
          <button
            type="button"
            onClick={() => {
              playSound("tick");
              openSearch();
            }}
            title={`${t("nav.search")}  ⌘K`}
            className="group relative flex h-9 w-9 items-center justify-center rounded-xl text-ink-400 transition hover:bg-ink-800/60 hover:text-ink-100"
          >
            <Search className="h-4 w-4" />
          </button>
        </nav>

        {/* Footer — theme + lang + settings; always visible. */}
        <RailFooterButtons />
      </aside>

      {/* Main — pages render their own context sidebars (TagsTree, Graph settings, …). */}
      <main key={location.pathname} className="flex-1 overflow-hidden page-enter">
        <Outlet />
      </main>

      {/* Global modals */}
      <SettingsModal />
      <GlobalSearchModal />
    </div>
  );
}
