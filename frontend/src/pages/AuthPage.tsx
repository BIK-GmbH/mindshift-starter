import { Brain, Loader2, Lock, Mail, UserRound } from "lucide-react";
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
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-ink-900 p-6">
      {/* Decorative background — subtle radial gradients */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(96,165,250,0.08), transparent), radial-gradient(ellipse 40% 30% at 80% 100%, rgba(167,139,250,0.06), transparent), radial-gradient(ellipse 50% 35% at 10% 90%, rgba(52,211,153,0.05), transparent)",
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Brand */}
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-800 ring-1 ring-ink-700 shadow-lg shadow-black/20">
            <Brain className="h-6 w-6 text-ink-100" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-ink-100">{t("app.name")}</h1>
          <p className="text-xs text-ink-400">{t("app.tagline")}</p>
        </div>

        <div className="rounded-2xl border border-ink-800 bg-ink-800/60 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
          <div className="mb-5 flex gap-1 rounded-lg border border-ink-700 bg-ink-900/50 p-1 text-sm">
            {(["signIn", "signUp"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={[
                  "flex-1 rounded-md px-2 py-1.5 transition",
                  mode === m
                    ? "bg-ink-100 text-ink-900 shadow-sm"
                    : "text-ink-300 hover:text-ink-100",
                ].join(" ")}
              >
                {t(`auth.${m}`)}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signUp" && (
              <Field
                icon={UserRound}
                type="text"
                placeholder={t("auth.displayName") ?? ""}
                value={displayName}
                onChange={setDisplayName}
              />
            )}
            <Field
              icon={Mail}
              type="email"
              placeholder={t("auth.email") ?? ""}
              value={email}
              onChange={setEmail}
              required
            />
            <Field
              icon={Lock}
              type="password"
              placeholder={t("auth.password") ?? ""}
              value={password}
              onChange={setPassword}
              required
              minLength={8}
            />

            {error && (
              <p className="rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink-100 px-3 py-2.5 text-sm font-medium text-ink-900 shadow-sm transition hover:bg-ink-200 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? t("common.loading") : t(`auth.${mode}`)}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[10px] text-ink-500">
          {mode === "signIn"
            ? t("auth.signInHint") ?? "Use the credentials you signed up with."
            : t("auth.signUpHint") ?? "Pick any email — single user mode."}
        </p>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  type,
  placeholder,
  value,
  onChange,
  required,
  minLength,
}: {
  icon: React.FC<{ className?: string }>;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        className="w-full rounded-lg border border-ink-700 bg-ink-900/60 py-2 pl-9 pr-3 text-sm text-ink-100 placeholder:text-ink-500 transition focus:border-ink-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700/40"
      />
    </div>
  );
}
