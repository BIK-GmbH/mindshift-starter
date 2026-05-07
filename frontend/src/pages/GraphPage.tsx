import { Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useTranslation } from "react-i18next";

import GraphCardDrawer from "../components/GraphCardDrawer";
import { api, type ConnectionReason, type GraphEdge, type GraphView } from "../lib/api";
import { type ColorMode, SOURCE_COLORS, nodeColor } from "../lib/graphColors";

interface UiNode {
  id: string;
  title: string;
  sourceType: string;
  tags: string[];
  degree: number;
  thumbnailUrl: string | null;
}

interface UiLink {
  source: string;
  target: string;
  score: number;
  reasons: ConnectionReason[];
}

export default function GraphPage() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<UiNode, UiLink> | undefined>(undefined);

  const [data, setData] = useState<GraphView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<string>("");
  const [colorMode, setColorMode] = useState<ColorMode>("source");
  const [hoveredLink, setHoveredLink] = useState<UiLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<{ node: UiNode; x: number; y: number } | null>(
    null,
  );
  const [drawerCardId, setDrawerCardId] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const view = await api.globalGraph({
        source_type: sourceType || undefined,
        edges_per_card: 5,
      });
      setData(view);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sourceType]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as UiNode[], links: [] as UiLink[] };
    const nodes: UiNode[] = data.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      sourceType: n.source_type,
      tags: n.tags,
      degree: n.degree,
      thumbnailUrl: n.thumbnail_url,
    }));
    const links: UiLink[] = data.edges.map((e: GraphEdge) => ({
      source: e.source,
      target: e.target,
      score: e.score,
      reasons: e.reasons,
    }));
    return { nodes, links };
  }, [data]);

  const sourceTypes: { value: string; label: string }[] = [
    { value: "", label: t("graph.filter.all") },
    { value: "youtube", label: "YouTube" },
    { value: "article", label: t("addContent.article") },
    { value: "pdf", label: "PDF" },
  ];

  const handleZoom = (delta: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const z = fg.zoom();
    fg.zoom(Math.max(0.05, z * delta), 250);
  };

  const handleFit = () => fgRef.current?.zoomToFit(400, 60);

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col p-8">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("graph.global.title")}</h1>
          <p className="text-sm text-ink-300">{t("graph.global.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md bg-ink-700 p-1 text-xs">
            {sourceTypes.map((opt) => (
              <button
                key={opt.value || "all"}
                type="button"
                onClick={() => setSourceType(opt.value)}
                className={[
                  "rounded px-2 py-1 transition",
                  sourceType === opt.value
                    ? "bg-ink-100 text-ink-900"
                    : "text-ink-200 hover:bg-ink-600",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-md bg-ink-700 p-1 text-xs">
            <button
              type="button"
              onClick={() => setColorMode("source")}
              className={[
                "rounded px-2 py-1 transition",
                colorMode === "source"
                  ? "bg-ink-100 text-ink-900"
                  : "text-ink-200 hover:bg-ink-600",
              ].join(" ")}
            >
              {t("graph.color.source")}
            </button>
            <button
              type="button"
              onClick={() => setColorMode("tag")}
              className={[
                "rounded px-2 py-1 transition",
                colorMode === "tag" ? "bg-ink-100 text-ink-900" : "text-ink-200 hover:bg-ink-600",
              ].join(" ")}
            >
              {t("graph.color.tag")}
            </button>
          </div>
        </div>
      </header>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="mb-2 flex items-center gap-3 text-xs text-ink-400">
        <span>
          {graphData.nodes.length} {t("graph.nodes")} · {graphData.links.length} {t("graph.edges")}
        </span>
        {colorMode === "source" && (
          <span className="ml-auto inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: SOURCE_COLORS.youtube }} />
              YouTube
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: SOURCE_COLORS.article }} />
              Article
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: SOURCE_COLORS.pdf }} />
              PDF
            </span>
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-hidden rounded-lg border border-ink-700 bg-ink-900"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-300">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-ink-300">
            <p className="text-lg font-medium text-ink-100">{t("graph.empty.title")}</p>
            <p>{t("graph.empty.body")}</p>
          </div>
        ) : (
          <>
            <ForceGraph2D
              ref={fgRef}
              width={size.w}
              height={size.h}
              graphData={graphData}
              backgroundColor="rgb(11,13,18)"
              nodeRelSize={6}
              cooldownTicks={120}
              linkColor={(link) =>
                hoveredLink &&
                hoveredLink.source === (link as UiLink).source &&
                hoveredLink.target === (link as UiLink).target
                  ? "rgba(255,255,255,0.85)"
                  : "rgba(140,150,170,0.45)"
              }
              linkWidth={(link) => 0.5 + (link as UiLink).score * 4}
              onLinkHover={(link) => setHoveredLink((link as UiLink) ?? null)}
              onNodeHover={(node) => {
                if (!node) {
                  setHoveredNode(null);
                  return;
                }
                const n = node as UiNode & { x?: number; y?: number };
                if (n.x == null || n.y == null) return;
                const fg = fgRef.current;
                if (!fg) return;
                const screen = fg.graph2ScreenCoords(n.x, n.y);
                setHoveredNode({ node: n, x: screen.x, y: screen.y });
              }}
              onNodeClick={(node) => setDrawerCardId((node as UiNode).id)}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const n = node as UiNode & { x?: number; y?: number };
                if (n.x == null || n.y == null) return;
                const radius = 4 + Math.sqrt(Math.max(0, n.degree)) * 2.2;
                ctx.beginPath();
                ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
                ctx.fillStyle = nodeColor(colorMode, n.sourceType, n.tags);
                ctx.fill();
                if (drawerCardId === n.id) {
                  ctx.strokeStyle = "#ffffff";
                  ctx.lineWidth = 2 / globalScale;
                  ctx.stroke();
                }
                const label = n.title.length > 36 ? n.title.slice(0, 36) + "…" : n.title;
                ctx.font = `${11 / globalScale}px Inter, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = "rgba(230,233,240,0.92)";
                ctx.fillText(label, n.x, n.y + radius + 2);
              }}
            />
            {/* Zoom controls */}
            <div className="pointer-events-auto absolute right-2 top-2 z-10 flex flex-col gap-1 rounded border border-ink-700 bg-ink-800/90 p-1 shadow-md">
              <button
                type="button"
                title={t("graph.controls.zoomIn") ?? ""}
                onClick={() => handleZoom(1.4)}
                className="rounded p-1.5 text-ink-200 hover:bg-ink-700"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={t("graph.controls.zoomOut") ?? ""}
                onClick={() => handleZoom(0.7)}
                className="rounded p-1.5 text-ink-200 hover:bg-ink-700"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={t("graph.controls.fit") ?? ""}
                onClick={handleFit}
                className="rounded p-1.5 text-ink-200 hover:bg-ink-700"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Hovered node preview */}
            {hoveredNode && drawerCardId !== hoveredNode.node.id && (
              <div
                className="pointer-events-none absolute z-10 max-w-xs rounded-lg border border-ink-700 bg-ink-800/95 p-2 text-xs text-ink-100 shadow-lg"
                style={{
                  left: Math.min(hoveredNode.x + 12, size.w - 280),
                  top: Math.min(hoveredNode.y + 12, size.h - 140),
                }}
              >
                {hoveredNode.node.thumbnailUrl && (
                  <img
                    src={hoveredNode.node.thumbnailUrl}
                    alt=""
                    className="mb-1.5 aspect-video w-full rounded object-cover"
                  />
                )}
                <div className="text-[10px] uppercase text-ink-400">
                  {hoveredNode.node.sourceType} · {hoveredNode.node.degree} {t("graph.edges")}
                </div>
                <div className="font-medium leading-snug">{hoveredNode.node.title}</div>
                {hoveredNode.node.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {hoveredNode.node.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-ink-700 px-1.5 py-0.5 text-[9px] text-ink-200"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {hoveredLink && (
              <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-ink-800/95 px-2 py-1 text-[10px] text-ink-100 shadow">
                <span className="mr-2 font-medium">{Math.round(hoveredLink.score * 100)}%</span>
                {hoveredLink.reasons.map((r, i) => (
                  <span key={i} className="ml-1 rounded bg-ink-700 px-1 py-0.5 text-[10px]">
                    {r.label}
                  </span>
                ))}
              </div>
            )}

            <GraphCardDrawer cardId={drawerCardId} onClose={() => setDrawerCardId(null)} />
          </>
        )}
      </div>

      <p className="mt-2 text-[10px] text-ink-500">{t("graph.global.hint")}</p>
    </div>
  );
}
