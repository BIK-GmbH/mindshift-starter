import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { api, type ConnectionReason } from "../lib/api";
import { useTheme } from "../lib/ThemeContext";

interface Props {
  rootCardId: string;
  rootTitle: string;
  rootSourceType: string;
}

interface Node {
  id: string;
  title: string;
  sourceType: string;
  expanded: boolean;
  isRoot: boolean;
}

interface Link {
  source: string;
  target: string;
  score: number;
  reasons: ConnectionReason[];
}

const SOURCE_COLORS: Record<string, string> = {
  youtube: "#f87171",
  article: "#60a5fa",
  pdf: "#34d399",
};

export default function CardGraph({ rootCardId, rootTitle, rootSourceType }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const graphBg = theme === "light" ? "rgb(248,250,252)" : "rgb(11,13,18)";
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<Node, Link> | undefined>(undefined);

  const [nodes, setNodes] = useState<Map<string, Node>>(
    () => new Map([[rootCardId, { id: rootCardId, title: rootTitle, sourceType: rootSourceType, expanded: false, isRoot: true }]]),
  );
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<Link | null>(null);
  const [size, setSize] = useState({ w: 600, h: 480 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const expandNode = useCallback(
    async (nodeId: string) => {
      setLoading(nodeId);
      try {
        const connections = await api.cardConnections(nodeId, 8);
        setNodes((prev) => {
          const next = new Map(prev);
          const existing = next.get(nodeId);
          if (existing) next.set(nodeId, { ...existing, expanded: true });
          for (const c of connections) {
            if (!next.has(c.card_id)) {
              next.set(c.card_id, {
                id: c.card_id,
                title: c.title,
                sourceType: c.source_type,
                expanded: false,
                isRoot: false,
              });
            }
          }
          return next;
        });
        setLinks((prev) => {
          const seen = new Set(prev.map((l) => `${l.source}|${l.target}`));
          const additions: Link[] = [];
          for (const c of connections) {
            const a = nodeId < c.card_id ? nodeId : c.card_id;
            const b = nodeId < c.card_id ? c.card_id : nodeId;
            const key = `${a}|${b}`;
            if (seen.has(key)) continue;
            seen.add(key);
            additions.push({ source: a, target: b, score: c.score, reasons: c.reasons });
          }
          return [...prev, ...additions];
        });
      } finally {
        setLoading(null);
      }
    },
    [],
  );

  const [depth, setDepth] = useState(1);

  // Auto-expand root on mount and BFS-expand to the chosen depth.
  const initialised = useRef(false);
  const expandToDepth = useCallback(
    async (targetDepth: number) => {
      // Snapshot of nodes that already exist before this round.
      const seedExpand = async (id: string) => {
        await expandNode(id);
      };
      await seedExpand(rootCardId);
      if (targetDepth <= 1) return;

      let frontier = new Set<string>([rootCardId]);
      let visited = new Set<string>([rootCardId]);
      for (let d = 1; d < targetDepth; d++) {
        // Snapshot current node ids minus already-visited as the next frontier.
        const newFrontier = new Set<string>();
        const snapshot = Array.from(nodesRef.current.keys());
        for (const id of snapshot) {
          if (frontier.has(id) || visited.has(id)) continue;
          newFrontier.add(id);
        }
        for (const id of frontier) visited.add(id);
        for (const id of newFrontier) {
          const node = nodesRef.current.get(id);
          if (!node || node.expanded) continue;
          await expandNode(id);
        }
        frontier = newFrontier;
        if (frontier.size === 0) break;
      }
    },
    [expandNode, rootCardId],
  );

  // Keep a ref to the latest nodes Map so the BFS can read fresh state.
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    void expandToDepth(depth);
  }, [expandToDepth, depth]);

  const onDepthChange = (newDepth: number) => {
    if (newDepth === depth) return;
    setDepth(newDepth);
    if (newDepth > depth) void expandToDepth(newDepth);
  };

  const data = useMemo(
    () => ({ nodes: Array.from(nodes.values()), links }),
    [nodes, links],
  );

  const handleNodeClick = (node: Node) => {
    if (!node.expanded) {
      void expandNode(node.id);
    } else if (!node.isRoot) {
      navigate(`/cards/${node.id}`);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-300">
        <span>
          {t("graph.hint")} ·{" "}
          <span className="text-ink-400">
            {data.nodes.length} {t("graph.nodes")}, {data.links.length} {t("graph.edges")}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ink-400">{t("graph.depth")}:</span>
          <div className="flex gap-1 rounded bg-ink-700 p-0.5 text-[10px]">
            {[1, 2, 3].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDepthChange(d)}
                className={[
                  "rounded px-2 py-0.5",
                  depth === d ? "bg-ink-100 text-ink-900" : "text-ink-200 hover:bg-ink-600",
                ].join(" ")}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setNodes(
                new Map([
                  [rootCardId, { id: rootCardId, title: rootTitle, sourceType: rootSourceType, expanded: false, isRoot: true }],
                ]),
              );
              setLinks([]);
              initialised.current = false;
            }}
            className="rounded border border-ink-600 px-2 py-1 text-[10px] text-ink-200 hover:bg-ink-700"
          >
            {t("graph.reset")}
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative flex-1 min-h-0 overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
        {data.links.length === 0 && data.nodes.length === 1 && loading === null && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-center">
            <div className="surface-elevated pointer-events-auto max-w-sm rounded-lg bg-ink-800/95 p-4 text-sm text-ink-200">
              <p className="mb-1 font-medium text-ink-100">{t("graph.isolated.title")}</p>
              <p className="text-xs text-ink-300">{t("graph.isolated.body")}</p>
            </div>
          </div>
        )}
        <ForceGraph2D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor={graphBg}
          nodeRelSize={6}
          linkColor={(link) =>
            hoveredLink && hoveredLink.source === (link as Link).source && hoveredLink.target === (link as Link).target
              ? "rgba(255,255,255,0.85)"
              : "rgba(140,150,170,0.45)"
          }
          linkWidth={(link) => 0.5 + (link as Link).score * 4}
          onLinkHover={(link) => setHoveredLink((link as Link) ?? null)}
          onNodeClick={(node) => handleNodeClick(node as Node)}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as Node & { x?: number; y?: number };
            if (n.x == null || n.y == null) return;
            const isLoading = loading === n.id;
            const radius = n.isRoot ? 9 : n.expanded ? 7 : 5;
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = SOURCE_COLORS[n.sourceType] ?? "#a78bfa";
            ctx.fill();
            if (n.isRoot) {
              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = 2 / globalScale;
              ctx.stroke();
            }
            if (isLoading) {
              ctx.strokeStyle = "rgba(255,255,255,0.7)";
              ctx.lineWidth = 1.5 / globalScale;
              ctx.beginPath();
              ctx.arc(n.x, n.y, radius + 4, 0, 2 * Math.PI);
              ctx.stroke();
            }
            const label = n.title.length > 32 ? n.title.slice(0, 32) + "…" : n.title;
            ctx.font = `${12 / globalScale}px Inter, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = theme === "light" ? "rgba(15,23,42,0.85)" : "rgba(230,233,240,0.92)";
            ctx.fillText(label, n.x, n.y + radius + 2);
          }}
        />
        {hoveredLink && (
          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-ink-800/95 px-2 py-1 text-[10px] text-ink-100 shadow">
            <span className="mr-2 font-medium">
              {Math.round(hoveredLink.score * 100)}%
            </span>
            {hoveredLink.reasons.map((r, i) => (
              <span key={i} className="ml-1 rounded bg-ink-700 px-1 py-0.5 text-[10px]">
                {r.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-ink-400">
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{background: SOURCE_COLORS.youtube}} />YouTube</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{background: SOURCE_COLORS.article}} />Article</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{background: SOURCE_COLORS.pdf}} />PDF</span>
        </span>
      </p>
    </div>
  );
}
