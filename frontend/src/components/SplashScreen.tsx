import { Brain, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const SPLASH_TOTAL_MS = 1300;

/**
 * Brand splash on app launch. Theme-aware (white-on-black in dark mode,
 * black-on-white in light), 1.3 s total — soft fade in, hold, fade out.
 * After the timeout it unmounts entirely so it never re-fires on hot
 * reload-flips of the app tree.
 */
export default function SplashScreen() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), SPLASH_TOTAL_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="splash-enter pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-ink-900"
      aria-hidden="true"
    >
      <div className="splash-logo flex flex-col items-center gap-5 text-ink-100">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-100 text-ink-900 shadow-2xl">
          <Brain className="h-8 w-8" strokeWidth={1.8} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("app.name")}</h1>
          <p className="text-xs text-ink-400">{t("app.tagline")}</p>
        </div>
        <Loader2 className="mt-2 h-4 w-4 animate-spin text-ink-400" />
      </div>
    </div>
  );
}
