import {
  ArrowLeft,
  ChevronDown,
  Clock,
  EyeOff,
  Loader2,
  Lock,
  Maximize2,
  Route,
  Search as SearchIcon,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useTranslation } from "react-i18next";

import GraphCardDrawer from "../components/GraphCardDrawer";
import {
  api,
  type ConnectionReason,
  type GraphEdge,
  type GraphView,
  type TagWithCount,
} from "../lib/api";
import { type ColorMode, SOURCE_COLORS, nodeColor } from "../lib/graphColors";
import { useTheme } from "../lib/ThemeContext";

const POSITIONS_KEY = "mindshift.graphPositions";

interface UiNode {
  id: string;
  title: string;
  sourceType: string;
  tags: string[];
  degree: number;
  thumbnailUrl: string | null;
  fx?: number;
  fy?: number;
  x?: number;
  y?: number;
}

interface UiLink {
  source: string;
  target: string;
  score: number;
  reasons: ConnectionReason[];
}

export default function GraphPage() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const graphBg = theme === "light" ? "rgb(248,250,252)" : "rgb(11,13,18)";
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<UiNode, UiLink> | undefined>(undefined);

  const [data, setData] = useState<GraphView | null>(null);
  const [tagOptions, setTagOptions] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [sourceType, setSourceType] = useState<string>("");
  const [tag, setTag] = useState<string>("");
  const [hideIsolated, setHideIsolated] = useState(false);

  // Visualisation
  const [colorMode, setColorMode] = useState<ColorMode>("source");
  const [locked, setLocked] = useState(false);

  // Search + focus
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [focusBreadcrumb, setFocusBreadcrumb] = useState<{ id: string; title: string }[]>([]);

  // Hover / drawer
  const [hoveredLink, setHoveredLink] = useState<UiLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<{ node: UiNode; x: number; y: number } | null>(
    null,
  );
  const [drawerCardId, setDrawerCardId] = useState<string | null>(null);

  // Path finder
  const [pathMode, setPathMode] = useState(false);
  const [pathFrom, setPathFrom] = useState<UiNode | null>(null);
  const [pathTo, setPathTo] = useState<UiNode | null>(null);
  const [pathResult, setPathResult] = useState<string[]>([]);
  const [pathError, setPathError] = useState<string | null>(null);
  const pathSet = useMemo(() => new Set(pathResult), [pathResult]);

  // Timeline
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [createdAfter, setCreatedAfter] = useState<string>("");
  const [createdBefore, setCreatedBefore] = useState<string>("");

  const [size, setSize] = useState({ w: 800, h: 560 });

  // Reload-counter so we can ignore stale responses when filters change
  // mid-flight (and avoids the double-fetch flash that React Strict Mode
  // otherwise produces in dev).
  const reqIdRef = useRef(0);

  const fetchGraph = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    try {
      const view = await api.globalGraph({
        source_type: sourceType || undefined,
        tag: tag || undefined,
        edges_per_card: 5,
        created_after: timelineEnabled && createdAfter ? createdAfter : undefined,
        created_before: timelineEnabled && createdBefore ? createdBefore : undefined,
      });
      if (myReq !== reqIdRef.current) return; // stale
      setData(view);
      setError(null);
    } catch (err) {
      if (myReq !== reqIdRef.current) return;
      setError((err as Error).message);
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }, [sourceType, tag, timelineEnabled, createdAfter, createdBefore]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  useEffect(() => {
    void api.listTags().then(setTagOptions).catch(() => undefined);
  }, []);

  // Node spacing — 0..100. Drives linkDistance + chargeStrength.
  const [spacing, setSpacing] = useState<number>(() => {
    try {
      const v = localStorage.getItem("mindshift.graphSpacing");
      return v ? Number(v) : 50;
    } catch {
      return 50;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("mindshift.graphSpacing", String(spacing));
    } catch {
      /* ignore */
    }
  }, [spacing]);

  // Apply spacing → d3 forces on the running simulation.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const linkDistance = 30 + (spacing / 100) * 220; // 30 → 250 px
    const charge = -50 - (spacing / 100) * 350; // -50 → -400 (more negative = more spread)
    const linkForce = fg.d3Force("link") as { distance?: (d: number) => unknown } | null;
    const chargeForce = fg.d3Force("charge") as { strength?: (s: number) => unknown } | null;
    linkForce?.distance?.(linkDistance);
    chargeForce?.strength?.(charge);
    fg.d3ReheatSimulation();
  }, [spacing, data]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Focus mode trims to node + 1-hop neighbours
  const focusedNeighbours = useMemo(() => {
    if (!focusedNodeId || !data) return null;
    const allowed = new Set<string>([focusedNodeId]);
    for (const e of data.edges) {
      if (e.source === focusedNodeId) allowed.add(e.target);
      else if (e.target === focusedNodeId) allowed.add(e.source);
    }
    return allowed;
  }, [focusedNodeId, data]);

  const graphData = useMemo(() => {
    if (!data) return { nodes: [] as UiNode[], links: [] as UiLink[] };
    const positionsRaw = locked ? localStorage.getItem(POSITIONS_KEY) : null;
    const positions: Record<string, { x: number; y: number }> = positionsRaw
      ? JSON.parse(positionsRaw)
      : {};

    const filterFn = (id: string) => {
      if (focusedNeighbours && !focusedNeighbours.has(id)) return false;
      return true;
    };

    let nodes: UiNode[] = data.nodes
      .filter((n) => filterFn(n.id))
      .map((n) => {
        const ui: UiNode = {
          id: n.id,
          title: n.title,
          sourceType: n.source_type,
          tags: n.tags,
          degree: n.degree,
          thumbnailUrl: n.thumbnail_url,
        };
        const pos = positions[n.id];
        if (locked && pos) {
          ui.fx = pos.x;
          ui.fy = pos.y;
        }
        return ui;
      });

    if (hideIsolated && !focusedNodeId) {
      const connected = new Set<string>();
      for (const e of data.edges) {
        connected.add(e.source);
        connected.add(e.target);
      }
      nodes = nodes.filter((n) => connected.has(n.id));
    }

    const visibleIds = new Set(nodes.map((n) => n.id));
    const links: UiLink[] = data.edges
      .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
      .map((e: GraphEdge) => ({
        source: e.source,
        target: e.target,
        score: e.score,
        reasons: e.reasons,
      }));
    return { nodes, links };
  }, [data, focusedNeighbours, focusedNodeId, hideIsolated, locked]);

  // Search matches
  const matches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as UiNode[];
    return graphData.nodes.filter((n) => n.title.toLowerCase().includes(q));
  }, [graphData.nodes, searchQuery]);

  const currentMatch = matches[matchIndex] ?? null;

  // Center on current match
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !currentMatch) return;
    const target = currentMatch as UiNode & { x?: number; y?: number };
    if (target.x != null && target.y != null) {
      fg.centerAt(target.x, target.y, 600);
      fg.zoom(2.2, 600);
    }
  }, [currentMatch]);

  const handleZoom = (delta: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.zoom(Math.max(0.05, fg.zoom() * delta), 250);
  };
  const handleFit = () => fgRef.current?.zoomToFit(400, 60);

  const persistPositions = () => {
    const fg = fgRef.current;
    if (!fg) return;
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of graphData.nodes) {
      const node = n as UiNode;
      if (node.x != null && node.y != null) positions[node.id] = { x: node.x, y: node.y };
    }
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
  };

  const toggleLock = () => {
    if (!locked) {
      persistPositions();
    } else {
      localStorage.removeItem(POSITIONS_KEY);
    }
    setLocked((v) => !v);
  };

  const enterFocus = (node: UiNode) => {
    setFocusBreadcrumb((bc) =>
      bc.find((b) => b.id === node.id) ? bc : [...bc, { id: node.id, title: node.title }],
    );
    setFocusedNodeId(node.id);
    setSearchQuery("");
  };
  const exitFocus = () => {
    setFocusedNodeId(null);
    setFocusBreadcrumb([]);
  };
  const focusStep = (id: string) => {
    setFocusedNodeId(id);
    setFocusBreadcrumb((bc) => {
      const idx = bc.findIndex((b) => b.id === id);
      return idx >= 0 ? bc.slice(0, idx + 1) : bc;
    });
  };

  const onCanvasKeyDown = (e: React.KeyboardEvent) => {
    if (matches.length === 0) return;
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      setMatchIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
      e.preventDefault();
      setMatchIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Escape") {
      setSearchQuery("");
      setMatchIndex(0);
    }
  };

  const sourceTypes: { value: string; label: string }[] = [
    { value: "", label: t("graph.filter.all") },
    { value: "youtube", label: "YouTube" },
    { value: "article", label: t("addContent.article") },
    { value: "pdf", label: "PDF" },
  ];

  const matchSet = new Set(matches.map((m) => m.id));
  const currentMatchId = currentMatch?.id ?? null;

  return (
    <div className="flex h-full">
      {/* Context sidebar — Recall-style graph settings */}
      <aside className="panel-elevated hidden md:flex w-72 flex-shrink-0 flex-col border-r border-ink-800 bg-ink-900/60">
        <div className="flex-shrink-0 border-b border-ink-800 px-4 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">
            {t("graph.settingsHeading")}
          </h2>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {/* Search */}
          <SidebarSection title={t("graph.search.heading")}>
            <div className="relative" onKeyDown={onCanvasKeyDown}>
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setMatchIndex(0);
                }}
                onKeyDown={onCanvasKeyDown}
                placeholder={t("graph.search.placeholder") ?? ""}
                className="w-full rounded-md border border-ink-700 bg-ink-800/60 py-1.5 pl-8 pr-2 text-xs focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
              />
              {matches.length > 0 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-400">
                  {matchIndex + 1} / {matches.length}
                </span>
              )}
            </div>
          </SidebarSection>

          {/* Filters */}
          <SidebarSection title={t("graph.filtersHeading")}>
            <div className="space-y-2.5">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-ink-500">
                  {t("graph.filterSource")}
                </label>
                <div className="grid grid-cols-2 gap-1 rounded-md bg-ink-700/50 p-0.5 text-[11px]">
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
              </div>

              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-ink-500">
                  {t("graph.filterTag")}
                </label>
                <div className="relative">
                  <select
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    className="w-full appearance-none rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1.5 pr-7 text-xs text-ink-100 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
                  >
                    <option value="">{t("graph.filter.allTags")}</option>
                    {tagOptions.map((t2) => (
                      <option key={t2.name} value={t2.name}>
                        #{t2.name} ({t2.count})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-300" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setHideIsolated((v) => !v)}
                className={[
                  "flex w-full items-center justify-between rounded-md border border-ink-700 px-2.5 py-1.5 text-[11px] transition",
                  hideIsolated ? "bg-ink-700/70 text-ink-100" : "text-ink-300 hover:bg-ink-800",
                ].join(" ")}
              >
                <span className="inline-flex items-center gap-1.5">
                  <EyeOff className="h-3 w-3" />
                  {t("graph.filter.hideIsolated")}
                </span>
                <span
                  className={[
                    "h-3 w-6 rounded-full p-[2px] transition",
                    hideIsolated ? "bg-ink-100" : "bg-ink-700",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "block h-2 w-2 rounded-full bg-ink-900 transition",
                      hideIsolated ? "translate-x-3" : "translate-x-0",
                    ].join(" ")}
                  />
                </span>
              </button>
            </div>
          </SidebarSection>

          {/* Display */}
          <SidebarSection title={t("graph.displayHeading")}>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-ink-500">
              {t("graph.colorBy")}
            </label>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-ink-700/50 p-0.5 text-[11px]">
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
            {colorMode === "source" && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-400">
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
              </div>
            )}
          </SidebarSection>

          {/* Layout */}
          <SidebarSection title={t("graph.layoutHeading", { defaultValue: "Layout" })}>
            <label className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-500">
              <span>{t("graph.spacing", { defaultValue: "Node spacing" })}</span>
              <span className="font-mono tabular-nums normal-case tracking-normal text-ink-300">
                {spacing}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={spacing}
              onChange={(e) => setSpacing(Number(e.target.value))}
              className="h-1 w-full cursor-pointer appearance-none rounded bg-ink-700 accent-ink-100"
              aria-label={t("graph.spacing", { defaultValue: "Node spacing" })}
            />
          </SidebarSection>

          {/* Tools */}
          <SidebarSection title={t("graph.toolsHeading")}>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setPathMode((v) => !v);
                  setPathFrom(null);
                  setPathTo(null);
                  setPathResult([]);
                  setPathError(null);
                }}
                className={[
                  "flex w-full items-center gap-1.5 rounded-md border border-ink-700 px-2.5 py-1.5 text-[11px] transition",
                  pathMode ? "bg-ink-700/70 text-ink-100" : "text-ink-300 hover:bg-ink-800",
                ].join(" ")}
              >
                <Route className="h-3 w-3" />
                {t("graph.path.toggle")}
              </button>
              {pathMode && (
                <p className="text-[10px] text-ink-300">
                  {!pathFrom
                    ? t("graph.path.pickFrom")
                    : !pathTo
                    ? t("graph.path.pickTo")
                    : pathError
                    ? pathError
                    : pathResult.length > 0
                    ? `${pathResult.length - 1} ${t("graph.path.hops")}`
                    : t("common.loading")}
                </p>
              )}
              <button
                type="button"
                onClick={() => setTimelineEnabled((v) => !v)}
                className={[
                  "flex w-full items-center gap-1.5 rounded-md border border-ink-700 px-2.5 py-1.5 text-[11px] transition",
                  timelineEnabled ? "bg-ink-700/70 text-ink-100" : "text-ink-300 hover:bg-ink-800",
                ].join(" ")}
              >
                <Clock className="h-3 w-3" />
                {t("graph.timeline.toggle")}
              </button>
              {timelineEnabled && (
                <div className="space-y-1">
                  <input
                    type="datetime-local"
                    value={createdAfter}
                    onChange={(e) => setCreatedAfter(e.target.value)}
                    className="w-full rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 text-[10px] text-ink-100"
                  />
                  <span className="block text-center text-[10px] text-ink-500">→</span>
                  <input
                    type="datetime-local"
                    value={createdBefore}
                    onChange={(e) => setCreatedBefore(e.target.value)}
                    className="w-full rounded-md border border-ink-700 bg-ink-800/60 px-2 py-1 text-[10px] text-ink-100"
                  />
                </div>
              )}
            </div>
          </SidebarSection>

          {/* Stats footer */}
          <div className="mt-auto border-t border-ink-800 pt-3 text-[10px] text-ink-400">
            <span>
              <span className="font-medium tabular-nums text-ink-200">{graphData.nodes.length}</span>{" "}
              {t("graph.nodes")} ·{" "}
              <span className="font-medium tabular-nums text-ink-200">{graphData.links.length}</span>{" "}
              {t("graph.edges")}
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 min-w-0 flex-col p-6">
        <header className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-100">{t("graph.global.title")}</h1>
            <p className="text-sm text-ink-400">{t("graph.global.subtitle")}</p>
          </div>
          {focusedNodeId && (
            <button
              type="button"
              onClick={exitFocus}
              className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2.5 py-1.5 text-xs text-ink-200 hover:bg-ink-800"
            >
              <ArrowLeft className="h-3 w-3" />
              {t("graph.focus.exit")}
            </button>
          )}
        </header>

        {/* Focus breadcrumb */}
        {focusBreadcrumb.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1 text-[10px] text-ink-300">
            <span className="text-ink-400">{t("graph.focus.path")}:</span>
            {focusBreadcrumb.map((b, i) => (
              <span key={b.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-ink-500">›</span>}
                <button
                  type="button"
                  onClick={() => focusStep(b.id)}
                  className={[
                    "rounded px-1.5 py-0.5",
                    focusedNodeId === b.id ? "bg-ink-700 text-ink-100" : "hover:bg-ink-800",
                  ].join(" ")}
                >
                  {b.title.length > 30 ? b.title.slice(0, 30) + "…" : b.title}
                </button>
              </span>
            ))}
          </div>
        )}

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
              backgroundColor={graphBg}
              nodeRelSize={6}
              cooldownTicks={120}
              linkColor={(link) => {
                const l = link as UiLink;
                const inPath =
                  pathSet.has(l.source as unknown as string) &&
                  pathSet.has(l.target as unknown as string);
                if (inPath) return "#fbbf24"; // amber path
                if (
                  hoveredLink &&
                  hoveredLink.source === l.source &&
                  hoveredLink.target === l.target
                ) {
                  return "rgba(255,255,255,0.85)";
                }
                if (
                  searchQuery &&
                  !matchSet.has(l.source as unknown as string) &&
                  !matchSet.has(l.target as unknown as string)
                ) {
                  return "rgba(140,150,170,0.15)";
                }
                if (pathResult.length > 0) return "rgba(140,150,170,0.18)";
                return "rgba(140,150,170,0.45)";
              }}
              linkWidth={(link) => {
                const l = link as UiLink;
                const inPath =
                  pathSet.has(l.source as unknown as string) &&
                  pathSet.has(l.target as unknown as string);
                if (inPath) return 3.5;
                return 0.5 + l.score * 4;
              }}
              onLinkHover={(link) => setHoveredLink((link as UiLink) ?? null)}
              onNodeHover={(node) => {
                if (!node) {
                  setHoveredNode(null);
                  return;
                }
                const n = node as UiNode;
                if (n.x == null || n.y == null) return;
                const fg = fgRef.current;
                if (!fg) return;
                const screen = fg.graph2ScreenCoords(n.x, n.y);
                setHoveredNode({ node: n, x: screen.x, y: screen.y });
              }}
              onNodeClick={(node, event) => {
                const n = node as UiNode;
                const me = event as MouseEvent;
                if (pathMode) {
                  if (!pathFrom) {
                    setPathFrom(n);
                    setPathResult([]);
                    setPathError(null);
                  } else if (!pathTo && n.id !== pathFrom.id) {
                    setPathTo(n);
                    void api
                      .graphPath(pathFrom.id, n.id)
                      .then((res) => {
                        if (res.found) {
                          setPathResult(res.path);
                          setPathError(null);
                        } else {
                          setPathResult([]);
                          setPathError(t("graph.path.notFound") ?? "No path found");
                        }
                      })
                      .catch((err) => setPathError((err as Error).message));
                  } else {
                    // restart selection
                    setPathFrom(n);
                    setPathTo(null);
                    setPathResult([]);
                    setPathError(null);
                  }
                  return;
                }
                if (me.shiftKey || me.metaKey || me.ctrlKey) {
                  enterFocus(n);
                } else {
                  setDrawerCardId(n.id);
                }
              }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const n = node as UiNode;
                if (n.x == null || n.y == null) return;
                const isMatch = matchSet.has(n.id);
                const isCurrent = currentMatchId === n.id;
                const isPathNode = pathSet.has(n.id);
                const isPathEndpoint =
                  pathFrom?.id === n.id || pathTo?.id === n.id;
                const isDimmed =
                  (searchQuery !== "" && !isMatch) ||
                  (pathResult.length > 0 && !isPathNode);
                const radius = 4 + Math.sqrt(Math.max(0, n.degree)) * 2.2;
                const baseColor = isPathNode
                  ? "#fbbf24"
                  : nodeColor(colorMode, n.sourceType, n.tags);
                ctx.globalAlpha = isDimmed ? 0.18 : 1.0;
                ctx.beginPath();
                ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
                ctx.fillStyle = baseColor;
                ctx.fill();
                if (isPathEndpoint) {
                  ctx.strokeStyle = "#ffffff";
                  ctx.lineWidth = 3 / globalScale;
                  ctx.stroke();
                } else if (isCurrent || drawerCardId === n.id || focusedNodeId === n.id) {
                  ctx.strokeStyle = "#ffffff";
                  ctx.lineWidth = 2.5 / globalScale;
                  ctx.stroke();
                } else if (isMatch) {
                  ctx.strokeStyle = "rgba(255,255,255,0.7)";
                  ctx.lineWidth = 1.8 / globalScale;
                  ctx.stroke();
                }
                const label = n.title.length > 36 ? n.title.slice(0, 36) + "…" : n.title;
                ctx.font = `${11 / globalScale}px Inter, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = isDimmed
                  ? "rgba(140,150,170,0.4)"
                  : theme === "light"
                  ? "rgba(15,23,42,0.85)"
                  : "rgba(230,233,240,0.92)";
                ctx.fillText(label, n.x, n.y + radius + 2);
                ctx.globalAlpha = 1.0;
              }}
            />

            {/* Right-side controls */}
            <div className="pointer-events-auto absolute right-2 top-2 z-10 flex flex-col gap-1 rounded border border-ink-700 bg-ink-800/90 p-1 shadow-md">
              <button
                type="button"
                title={t("graph.controls.zoomIn") ?? ""}
                aria-label={t("graph.controls.zoomIn") ?? "Zoom in"}
                onClick={() => handleZoom(1.4)}
                className="rounded p-1.5 text-ink-200 hover:bg-ink-700"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={t("graph.controls.zoomOut") ?? ""}
                aria-label={t("graph.controls.zoomOut") ?? "Zoom out"}
                onClick={() => handleZoom(0.7)}
                className="rounded p-1.5 text-ink-200 hover:bg-ink-700"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={t("graph.controls.fit") ?? ""}
                aria-label={t("graph.controls.fit") ?? "Fit to view"}
                onClick={handleFit}
                className="rounded p-1.5 text-ink-200 hover:bg-ink-700"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={t(locked ? "graph.controls.unlock" : "graph.controls.lock") ?? ""}
                aria-label={t(locked ? "graph.controls.unlock" : "graph.controls.lock") ?? "Lock"}
                onClick={toggleLock}
                className={[
                  "rounded p-1.5",
                  locked ? "bg-ink-100 text-ink-900" : "text-ink-200 hover:bg-ink-700",
                ].join(" ")}
              >
                {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
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
                    {hoveredNode.node.tags.slice(0, 4).map((tagName) => (
                      <span
                        key={tagName}
                        className="rounded bg-ink-700 px-1.5 py-0.5 text-[9px] text-ink-200"
                      >
                        #{tagName}
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

            {error && (
              <div className="absolute bottom-2 right-2 rounded bg-red-500/20 px-2 py-1 text-xs text-red-300">
                <X className="mr-1 inline h-3 w-3" />
                {error}
              </div>
            )}

            <GraphCardDrawer cardId={drawerCardId} onClose={() => setDrawerCardId(null)} />
          </>
        )}
        </div>

        <p className="mt-2 text-[10px] text-ink-500">{t("graph.global.hint2")}</p>
      </div>
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {title}
      </h3>
      {children}
    </section>
  );
}
