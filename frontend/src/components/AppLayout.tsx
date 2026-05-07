import { Brain, Library, MessageSquare, RefreshCw, Search, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

import LanguageToggle from "./LanguageToggle";

const navItems = [
  { to: "/", labelKey: "nav.library", Icon: Library, end: true },
  { to: "/chat", labelKey: "nav.chat", Icon: MessageSquare },
  { to: "/search", labelKey: "nav.search", Icon: Search },
  { to: "/review", labelKey: "nav.review", Icon: RefreshCw },
  { to: "/settings", labelKey: "nav.settings", Icon: Settings },
];

export default function AppLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full">
      <aside className="flex w-60 flex-col border-r border-ink-700 bg-ink-800">
        <div className="flex items-center gap-2 px-5 py-5">
          <Brain className="h-6 w-6 text-ink-100" />
          <span className="text-lg font-semibold tracking-tight">{t("app.name")}</span>
        </div>
        <nav className="flex-1 px-2">
          {navItems.map(({ to, labelKey, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                  isActive
                    ? "bg-ink-700 text-ink-100"
                    : "text-ink-300 hover:bg-ink-700/60 hover:text-ink-100",
                ].join(" ")
              }
            >
              <Icon className="h-4 w-4" />
              <span>{t(labelKey)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-ink-700 p-3">
          <LanguageToggle />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
