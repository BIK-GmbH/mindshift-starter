import { Brain, Compass, GraduationCap, Headphones, Library, MessageSquare, Network, Rss, Search, Shield, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

import AdminModal from "./AdminModal";
import GlobalSearchModal from "./GlobalSearchModal";
import MobileBottomNav from "./MobileBottomNav";
import MobileTopBar from "./MobileTopBar";
import OnboardingModal from "./OnboardingModal";
import RailFooterButtons from "./RailFooterButtons";
import SettingsModal from "./SettingsModal";
import { useAdminModal } from "../lib/AdminModalContext";
import { useAuth } from "../lib/AuthContext";
import {
  OnboardingModalProvider,
  useOnboardingModal,
} from "../lib/OnboardingModalContext";
import { useSearchModal } from "../lib/SearchModalContext";
import { playSound } from "../lib/sounds";

const railItems = [
  { to: "/", labelKey: "nav.library", Icon: Library, end: true },
  { to: "/graph", labelKey: "nav.graph", Icon: Network },
  { to: "/chat", labelKey: "nav.chat", Icon: MessageSquare },
  { to: "/review", labelKey: "nav.review", Icon: GraduationCap },
  { to: "/discover", labelKey: "nav.discover", Icon: Sparkles },
  { to: "/podcasts", labelKey: "nav.podcasts", Icon: Headphones },
  { to: "/feeds", labelKey: "nav.feeds", Icon: Rss },
  { to: "/paths", labelKey: "nav.paths", Icon: Compass },
];

export default function AppLayout() {
  return (
    <OnboardingModalProvider>
      <AppLayoutInner />
    </OnboardingModalProvider>
  );
}

function AppLayoutInner() {
  const { t } = useTranslation();
  const { openModal: openSearch } = useSearchModal();
  const { openModal: openAdmin } = useAdminModal();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.is_admin);
  const onboarding = useOnboardingModal();

  // Auto-open the welcome / extension-install walkthrough the first
  // time a user lands in the app. The server-side `onboarding_dismissed_at`
  // gate makes this idempotent across devices — once they close it
  // with "don't show again", the next session-start passes silently.
  useEffect(() => {
    if (!user) return;
    if (user.onboarding_dismissed_at != null) return;
    onboarding.openModal();
    // We intentionally depend only on `user.id` so opening doesn't fire
    // on every `refreshUser` call inside the modal (which would
    // re-trigger after the user dismisses).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div className="flex h-full flex-col bg-ink-900 md:flex-row">
      {/* Mobile-only top bar with brand + hamburger drawer. Hidden on
          desktop — the icon rail covers the same affordances there. */}
      <MobileTopBar />

      {/* Outer rail — desktop-only icon navigation. */}
      <aside className="panel-elevated relative z-10 hidden w-14 flex-col items-center border-r border-ink-800 bg-ink-900 py-3 md:flex">
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

          {/* Admin entry — only shown to admins. Opens the user-CRUD modal. */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                playSound("tick");
                openAdmin();
              }}
              title={t("nav.admin", { defaultValue: "Admin" }) ?? "Admin"}
              aria-label={t("nav.admin", { defaultValue: "Admin" }) ?? "Admin"}
              className="group relative flex h-9 w-9 items-center justify-center rounded-xl text-rose-300/80 transition hover:bg-rose-500/10 hover:text-rose-200"
            >
              <Shield className="h-4 w-4" />
            </button>
          )}
        </nav>

        {/* Footer — theme + lang + settings; always visible. */}
        <RailFooterButtons />
      </aside>

      {/* Main — pages render their own context sidebars (TagsTree, Graph settings, …).
          NOTE: deliberately NO `key={location.pathname}`. The key trick was
          forcing a full unmount + remount of every page on every route
          change — combined with React.StrictMode that re-fires every
          useEffect 4× per navigation, which under heavy clicking
          saturated localhost sockets and made the UI feel stuck.
          React-Router still mounts/unmounts the matched route via
          <Outlet/>, so each page resets its own state cleanly. */}
      {/* 56 px reserves space for MobileBottomNav so the last list
          item isn't hidden under it. No safe-area inset because the
          nav itself sits flush against the bottom. */}
      <main className="flex-1 overflow-hidden pb-14 page-enter md:pb-0">
        <Outlet />
      </main>

      {/* Mobile-only bottom nav. Three primary destinations + search;
          desktop-only sections live in the hamburger drawer. */}
      <MobileBottomNav />

      {/* Global modals */}
      <SettingsModal />
      <GlobalSearchModal />
      {isAdmin && <AdminModal />}
      <OnboardingModal open={onboarding.open} onClose={onboarding.closeModal} />
    </div>
  );
}
