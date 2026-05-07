import { Brain } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "../lib/AuthContext";

type Mode = "signIn" | "signUp";

export default function AuthPage() {
  const { t } = useTranslation();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signIn") {
        await signIn(email, password);
      } else {
        await signUp(email, password, displayName.trim() || undefined);
      }
    } catch (err) {
      setError((err as Error).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-ink-900 p-6">
      <div className="w-full max-w-sm rounded-lg border border-ink-700 bg-ink-800 p-6 shadow-xl">
        <div className="mb-6 flex items-center gap-2">
          <Brain className="h-6 w-6" />
          <h1 className="text-lg font-semibold tracking-tight">{t("app.name")}</h1>
        </div>

        <div className="mb-4 flex gap-1 rounded-md bg-ink-700 p-1 text-sm">
          {(["signIn", "signUp"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                "flex-1 rounded px-2 py-1.5 transition",
                mode === m ? "bg-ink-100 text-ink-900" : "text-ink-200 hover:bg-ink-600",
              ].join(" ")}
            >
              {t(`auth.${m}`)}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === "signUp" && (
            <input
              type="text"
              placeholder={t("auth.displayName") ?? ""}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded border border-ink-600 bg-ink-900 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-300"
            />
          )}
          <input
            type="email"
            required
            placeholder={t("auth.email") ?? ""}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-ink-600 bg-ink-900 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-300"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder={t("auth.password") ?? ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-ink-600 bg-ink-900 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ink-300"
          />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-ink-100 px-3 py-2 text-sm font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-60"
          >
            {busy ? t("common.loading") : t(`auth.${mode}`)}
          </button>
        </form>
      </div>
    </div>
  );
}
