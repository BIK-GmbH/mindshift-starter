import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAuth } from "../lib/AuthContext";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("nav.settings")}</h1>

      <section className="rounded-lg border border-ink-700 bg-ink-800 p-4">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-ink-400">Account</h2>
        <p className="text-sm">{user?.email}</p>
        {user?.display_name && <p className="text-xs text-ink-300">{user.display_name}</p>}
        <button
          type="button"
          onClick={signOut}
          className="mt-4 inline-flex items-center gap-2 rounded border border-ink-600 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
        >
          <LogOut className="h-3 w-3" />
          {t("auth.signOut")}
        </button>
      </section>
    </div>
  );
}
