import { Brain } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import RailFooterButtons from "./RailFooterButtons";

/**
 * Outer chrome for unauthenticated `/u/...`, `/share/...` and similar
 * surfaces. Mobile: slim sticky top-bar with the Mindshift logo on the
 * left and theme / language / settings on the right. Desktop (md+):
 * traditional 56 px left rail. Content fills the rest.
 *
 * The shell deliberately does not include any in-app navigation — these
 * pages are reachable from outside the app, so links to /library or
 * /paths wouldn't make sense to a visitor without an account.
 */
export default function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full bg-ink-900">
      <aside className="hidden w-14 flex-col items-center border-r border-ink-800 bg-ink-900 py-3 md:flex">
        <div
          className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-ink-100 text-ink-900 surface-soft"
          role="img"
          aria-label={t("app.name")}
        >
          <Brain className="h-4 w-4" />
        </div>
        <div className="flex-1" />
        <RailFooterButtons showSettings={false} />
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-800 bg-ink-900/95 px-3 py-2 backdrop-blur md:hidden">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-100 text-ink-900"
            role="img"
            aria-label={t("app.name")}
          >
            <Brain className="h-4 w-4" />
          </div>
          <RailFooterButtons orientation="row" showSettings={false} />
        </div>
        {children}
      </main>
    </div>
  );
}
