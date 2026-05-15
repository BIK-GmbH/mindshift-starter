import { Compass, Headphones, Library, Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { useSearchModal } from "../lib/SearchModalContext";
import { playSound } from "../lib/sounds";

/**
 * Bottom navigation for mobile (`<md`). Mirrors iOS / Android tab-bar
 * conventions — fixed to the viewport bottom, four equal-width tap
 * targets, active state indicated by the icon filling in plus a
 * thin top accent line.
 *
 * Three primary destinations + Search:
 *   - Library  → /
 *   - Paths    → /paths      (Lernpfade)
 *   - Playlists → /podcasts   (Podcast-Playlists)
 *   - Search   → opens the global search modal
 *
 * Desktop-only sections (Graph, Chat, Review, Feeds) are reachable
 * through the hamburger drawer in `MobileTopBar` — they don't fit
 * mobile UX (canvas, wide chat, side-by-side dashboards).
 *
 * Layout details:
 *   - `pb-[env(safe-area-inset-bottom)]` accounts for the iPhone's
 *     home-indicator strip so the buttons aren't underlayed.
 *   - 56 px effective height: matches Material Design's bottom
 *     navigation spec; iOS HIG suggests 44 px tap target which fits
 *     comfortably inside the 56 px row.
 */
const items = [
  { to: "/", labelKey: "nav.library", Icon: Library, end: true },
  { to: "/discover", labelKey: "nav.discover", Icon: Sparkles, end: false },
  { to: "/paths", labelKey: "nav.paths", Icon: Compass, end: false },
  { to: "/podcasts", labelKey: "nav.playlists", Icon: Headphones, end: false },
];

export default function MobileBottomNav() {
  const { t } = useTranslation();
  const { openModal: openSearch } = useSearchModal();

  return (
    <nav
      aria-label="primary"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-ink-800 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {items.map(({ to, labelKey, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => playSound("tick")}
          className={({ isActive }) =>
            [
              // Tighter vertical rhythm so icons + label sit closer to
              // the home-indicator strip (the OS-reserved area below).
              // `pt-2 pb-1` keeps a comfortable tap target but kills
              // the visual "floating" feel on iPhone Pro models.
              "group relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1 text-[10px] font-medium tracking-wide transition-colors",
              isActive ? "text-ink-100" : "text-ink-400 active:text-ink-200",
            ].join(" ")
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-ink-100" />
              )}
              <Icon
                className="h-5 w-5"
                strokeWidth={isActive ? 2.25 : 1.75}
              />
              <span>{t(labelKey, { defaultValue: labelKey })}</span>
            </>
          )}
        </NavLink>
      ))}

      <button
        type="button"
        onClick={() => {
          playSound("tick");
          openSearch();
        }}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1 text-[10px] font-medium tracking-wide text-ink-400 transition-colors active:text-ink-200"
        aria-label={t("nav.search") ?? "Search"}
      >
        <Search className="h-5 w-5" strokeWidth={1.75} />
        <span>{t("nav.search")}</span>
      </button>
    </nav>
  );
}
