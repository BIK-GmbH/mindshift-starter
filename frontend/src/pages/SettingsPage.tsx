import { Github, LogOut, Mail, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAuth } from "../lib/AuthContext";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <div className="flex-shrink-0 border-b border-ink-800 bg-ink-900/85 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-8 pb-4 pt-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-100">
            {t("nav.settings")}
          </h1>
          <p className="mt-1 text-sm text-ink-400">{t("settings.subtitle")}</p>
        </div>
      </div>

      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-8 pb-12 pt-6">
          {/* Account card */}
          <section className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-800/40">
            <div className="border-b border-ink-800 bg-ink-800/40 px-5 py-3">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                {t("settings.accountLabel")}
              </h2>
            </div>
            <div className="px-5 py-5">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-ink-100 to-ink-300 text-ink-900">
                  <UserRound className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink-100">
                    {user?.display_name ?? user?.email}
                  </p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-400">
                    <Mail className="h-3 w-3" />
                    {user?.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                >
                  <LogOut className="h-3 w-3" />
                  {t("auth.signOut")}
                </button>
              </div>
            </div>
          </section>

          {/* About card */}
          <section className="overflow-hidden rounded-2xl border border-ink-800 bg-ink-800/40">
            <div className="border-b border-ink-800 bg-ink-800/40 px-5 py-3">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                {t("settings.aboutLabel")}
              </h2>
            </div>
            <div className="space-y-3 px-5 py-5 text-sm text-ink-300">
              <p>
                <span className="font-medium text-ink-100">{t("app.name")}</span> —{" "}
                {t("app.tagline")}.
              </p>
              <p className="text-xs text-ink-400">
                {t("settings.aboutBody")}
              </p>
              <a
                href="https://github.com/BIK-GmbH/mindshift-starter"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-ink-300 transition hover:text-ink-100"
              >
                <Github className="h-3 w-3" />
                BIK-GmbH/mindshift-starter
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
