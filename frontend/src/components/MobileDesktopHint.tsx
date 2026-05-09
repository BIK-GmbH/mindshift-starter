import { Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  /** i18n key under `mobileHint.*` carrying a one-line feature-specific
   *  reason (e.g. "mobileHint.graph"). */
  reasonKey: string;
}

/**
 * Compact banner shown only on `<md` viewports — for features that are
 * functional on phones but obviously not designed for them (knowledge
 * graph, full chat workspace, review session, podcast workshop). The
 * library is the only first-class mobile experience; everything else
 * gets this hint on top so we don't pretend the layout is mobile-ready.
 */
export default function MobileDesktopHint({ reasonKey }: Props) {
  const { t } = useTranslation();
  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200 md:hidden">
      <Monitor className="h-3.5 w-3.5 flex-shrink-0 translate-y-0.5" />
      <p>
        <span className="font-medium">
          {t("mobileHint.title", { defaultValue: "Best viewed on desktop" })}
        </span>{" "}
        — {t(reasonKey)}
      </p>
    </div>
  );
}
