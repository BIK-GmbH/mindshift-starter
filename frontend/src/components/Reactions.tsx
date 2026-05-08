import { Brain, Heart, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { api, type ReactionKind, type ReactionsState } from "../lib/api";

interface Props {
  username: string;
  cardId: string;
}

const KINDS: { kind: ReactionKind; Icon: typeof Heart; label: string }[] = [
  { kind: "like", Icon: Heart, label: "Like" },
  { kind: "insightful", Icon: Sparkles, label: "Insightful" },
  { kind: "mindblown", Icon: Brain, label: "Mind blown" },
];

export default function Reactions({ username, cardId }: Props) {
  const [state, setState] = useState<ReactionsState | null>(null);
  const [pending, setPending] = useState<ReactionKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPublicCardReactions(username, cardId)
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch(() => {
        /* swallow — public route, no big deal */
      });
    return () => {
      cancelled = true;
    };
  }, [username, cardId]);

  const onClick = async (kind: ReactionKind) => {
    setPending(kind);
    setError(null);
    try {
      const next = await api.reactToPublicCard(username, cardId, kind);
      setState({ counts: next.counts, mine: next.mine });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {KINDS.map(({ kind, Icon, label }) => {
        const active = state?.mine.includes(kind) ?? false;
        const count = state?.counts[kind] ?? 0;
        const isBusy = pending === kind;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => void onClick(kind)}
            disabled={isBusy}
            title={label}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition",
              active
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-ink-700 text-ink-300 hover:border-ink-500 hover:bg-ink-800",
              isBusy ? "opacity-60" : "",
            ].join(" ")}
          >
            <Icon className={["h-3.5 w-3.5", active ? "fill-emerald-300/40" : ""].join(" ")} />
            <span>{label}</span>
            {count > 0 && <span className="font-mono tabular-nums text-[10px]">{count}</span>}
          </button>
        );
      })}
      {error && <p className="ml-2 text-[10px] text-red-300">{error}</p>}
    </div>
  );
}
