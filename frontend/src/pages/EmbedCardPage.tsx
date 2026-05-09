import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import CardDetailContent from "../components/CardDetailContent";
import { tokenStorage } from "../lib/api";

/**
 * Embedded card view for the browser extension's side panel.
 *
 * Loaded inside an `<iframe>` from the extension; shares localStorage
 * with the main Mindshift tab so the JWT is already there. Renders
 * CardDetailContent in compact mode without the icon rail or any
 * other Library chrome — the side panel is narrow and the user
 * already knows which card they're looking at.
 *
 * If the user isn't logged in (no token in localStorage of this
 * origin), we show a one-line prompt instead of an empty frame.
 */
export default function EmbedCardPage() {
  const { cardId = "" } = useParams<{ cardId: string }>();
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    setHasToken(!!tokenStorage.get());
  }, []);

  if (hasToken === null) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900">
        <Loader2 className="h-5 w-5 animate-spin text-ink-400" />
      </div>
    );
  }

  if (!hasToken) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900 px-4 text-center text-xs text-ink-400">
        Open Mindshift in another tab and sign in — the side panel
        shares your session automatically.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <CardDetailContent
        cardId={cardId}
        // Closing the embedded view doesn't make sense — the side panel
        // is the chrome. We pass a no-op back and use the close style
        // so any internal "back" button just does nothing visible.
        onBack={() => {
          /* no-op in embed mode */
        }}
        backStyle="close"
        compact
        // The full-chat page is rendered separately; the side panel is
        // already narrow, so the in-card chat tab works fine here.
        hideChatTab={false}
      />
    </div>
  );
}
