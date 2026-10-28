import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { Snapshot } from '../sim/engine';
import { fmtRate } from '../sim/format';
import type { EdgeSpec, NodeKind, Topology } from '../sim/types';
import { useI18n } from '../i18n';
import { NODE_H, NODE_W, NodeCard } from './NodeCard';

export interface Selection {
  type: 'node' | 'edge';
  id: string;
}

interface View {
  x: number;
  y: number;
  k: number;
}

interface Props {
  topology: Topology;
  snap: Snapshot | null;
  selected: Selection | null;
  running: boolean;
  fitKey: number;
  onSelect: (s: Selection | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (from: string, to: string) => void;
  onAdd: (kind: NodeKind, x: number, y: number) => void;
  children?: ReactNode;
}

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; view: View; moved: boolean }
  | { kind: 'node'; id: string; dx: number; dy: number; startX: number; startY: number; moved: boolean }
  | { kind: 'connect'; from: string }
  | { kind: 'pinch'; dist: number; view: View; cx: number; cy: number };

const GRID = 10;
const MIN_K = 0.25;
const MAX_K = 2;

export const DRAG_MIME = 'application/x-meltpoint-kind';

function edgeGeometry(a: { x: number; y: number }, b: { x: number; y: number }) {
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
  const c1x = x1 + dx;
  const c2x = x2 - dx;
  const d = `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`;
  const mx = 0.125 * x1 + 0.375 * c1x + 0.375 * c2x + 0.125 * x2;
  const my = 0.5 * y1 + 0.5 * y2;
  return { d, mx, my };
}

function domId(edgeId: string): string {
  return `mp-edge-${edgeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export function Canvas({ topology, snap, selected, running, fitKey, onSelect, onMove, onConnect, onAdd, children }: Props) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 80, y: 200, k: 0.9 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of topology.nodes) m.set(n.id, drag && drag.id === n.id ? { x: drag.x, y: drag.y } : { x: n.x, y: n.y });
    return m;
  }, [topology.nodes, drag]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - (r?.left ?? 0) - v.x) / v.k, y: (clientY - (r?.top ?? 0) - v.y) / v.k };
  }, []);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || topology.nodes.length === 0) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of topology.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    }
    const pad = 60;
    // Keep clear of the lesson card that sits along the bottom, when there is room to.
    const bottom = h > 560 ? 170 : 40;
    const k = Math.min(1.05, Math.max(MIN_K, Math.min((w - pad * 2) / (maxX - minX), (h - pad - bottom) / (maxY - minY))));
    setView({ k, x: (w - (maxX - minX) * k) / 2 - minX * k, y: (h - bottom + pad / 2 - (maxY - minY) * k) / 2 - minY * k });
  }, [topology.nodes]);

  const fitRef = useRef(fit);
  fitRef.current = fit;
  /** Until the user pans or zooms, the view keeps the whole design in frame. */
  const autoFit = useRef(true);

  useLayoutEffect(() => {
    autoFit.current = true;
    fitRef.current();
  }, [fitKey]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
      if (autoFit.current) fitRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (running) svg.unpauseAnimations();
    else svg.pauseAnimations();
  }, [running]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const v = viewRef.current;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor));
    autoFit.current = false;
    const wx = (px - v.x) / v.k;
    const wy = (py - v.y) / v.k;
    setView({ k, x: px - wx * k, y: py - wy * k });
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        const v = viewRef.current;
        autoFit.current = false;
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const nodeAt = (wx: number, wy: number): string | null => {
    for (let i = topology.nodes.length - 1; i >= 0; i -= 1) {
      const n = topology.nodes[i];
      if (wx >= n.x - 12 && wx <= n.x + NODE_W + 12 && wy >= n.y - 12 && wy <= n.y + NODE_H + 12) return n.id;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = e.target as HTMLElement;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    wrapRef.current?.setPointerCapture(e.pointerId);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = wrapRef.current?.getBoundingClientRect();
      gesture.current = {
        kind: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        view: viewRef.current,
        cx: (a.x + b.x) / 2 - (r?.left ?? 0),
        cy: (a.y + b.y) / 2 - (r?.top ?? 0),
      };
      setDrag(null);
      setWire(null);
      return;
    }

    const port = target.closest('[data-port]') as HTMLElement | null;
    if (port) {
      const from = port.dataset.port as string;
      const w = toWorld(e.clientX, e.clientY);
      gesture.current = { kind: 'connect', from };
      setWire({ from, x: w.x, y: w.y });
      return;
    }
    const nodeEl = target.closest('[data-node]') as HTMLElement | null;
    if (nodeEl) {
      const id = nodeEl.dataset.node as string;
      const n = topology.nodes.find((x) => x.id === id);
      if (!n) return;
      const w = toWorld(e.clientX, e.clientY);
      gesture.current = { kind: 'node', id, dx: w.x - n.x, dy: w.y - n.y, startX: e.clientX, startY: e.clientY, moved: false };
      return;
    }
    const edgeEl = target.closest('[data-edge]') as Element | null;
    if (edgeEl) {
      onSelect({ type: 'edge', id: edgeEl.getAttribute('data-edge') as string });
      gesture.current = null;
      return;
    }
    gesture.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, view: viewRef.current, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const k = Math.max(MIN_K, Math.min(MAX_K, g.view.k * (dist / g.dist)));
      autoFit.current = false;
      const wx = (g.cx - g.view.x) / g.view.k;
      const wy = (g.cy - g.view.y) / g.view.k;
      setView({ k, x: g.cx - wx * k, y: g.cy - wy * k });
    } else if (g.kind === 'pan') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        g.moved = true;
        autoFit.current = false;
      }
      if (g.moved) setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    } else if (g.kind === 'node') {
      if (Math.abs(e.clientX - g.startX) + Math.abs(e.clientY - g.startY) > 3) g.moved = true;
      if (!g.moved) return;
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ id: g.id, x: Math.round((w.x - g.dx) / GRID) * GRID, y: Math.round((w.y - g.dy) / GRID) * GRID });
    } else if (g.kind === 'connect') {
      const w = toWorld(e.clientX, e.clientY);
      setWire({ from: g.from, x: w.x, y: w.y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'pan') {
      if (!g.moved) onSelect(null);
    } else if (g.kind === 'node') {
      if (g.moved && drag) onMove(g.id, drag.x, drag.y);
      else onSelect({ type: 'node', id: g.id });
      setDrag(null);
    } else if (g.kind === 'connect') {
      const w = toWorld(e.clientX, e.clientY);
      const to = nodeAt(w.x, w.y);
      if (to && to !== g.from) onConnect(g.from, to);
      setWire(null);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData(DRAG_MIME) as NodeKind;
    if (!kind) return;
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    onAdd(kind, Math.round((w.x - NODE_W / 2) / GRID) * GRID, Math.round((w.y - NODE_H / 2) / GRID) * GRID);
  };

  // The edge layer is an SVG sized to cover every node with margin, so hit-testing works
  // everywhere an edge can be drawn.
  let minX = 0;
  let minY = 0;
  let maxX = 1;
  let maxY = 1;
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + NODE_W);
    maxY = Math.max(maxY, pos.y + NODE_H);
  }
  if (wire) {
    minX = Math.min(minX, wire.x);
    minY = Math.min(minY, wire.y);
    maxX = Math.max(maxX, wire.x);
    maxY = Math.max(maxY, wire.y);
  }
  const M = 400;
  const ox = minX - M;
  const oy = minY - M;

  const targetCounts = new Map<string, number>();
  for (const e of topology.edges) targetCounts.set(e.from, (targetCounts.get(e.from) ?? 0) + 1);

  return (
    <div
      ref={wrapRef}
      className={`canvas ${gesture.current?.kind === 'pan' ? 'panning' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
      }}
      onDrop={onDrop}
      style={{
        backgroundSize: `${24 * view.k}px ${24 * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg
          ref={svgRef}
          className="edges"
          style={{ left: ox, top: oy, width: maxX - minX + 2 * M, height: maxY - minY + 2 * M }}
        >
          <defs>
            <marker id="mp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="arrow" />
            </marker>
            <marker id="mp-arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="arrow bad" />
            </marker>
            <marker id="mp-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="arrow sel" />
            </marker>
          </defs>
          <g transform={`translate(${-ox} ${-oy})`}>
            {topology.edges.map((e) => (
              <Edge
                key={e.id}
                spec={e}
                a={positions.get(e.from)}
                b={positions.get(e.to)}
                snap={snap?.edges[e.id]}
                selected={selected?.type === 'edge' && selected.id === e.id}
              />
            ))}
            {wire &&
              (() => {
                const a = positions.get(wire.from);
                if (!a) return null;
                const { d } = edgeGeometry(a, { x: wire.x, y: wire.y - NODE_H / 2 });
                return <path d={d} className="wire" />;
              })()}
          </g>
        </svg>
        {topology.nodes.map((n) => {
          const pos = positions.get(n.id) ?? n;
          return (
            <div key={n.id} data-node={n.id} className="node-wrap" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
              <NodeCard
                spec={n}
                snap={snap?.nodes[n.id]}
                selected={selected?.type === 'node' && selected.id === n.id}
                dragging={drag?.id === n.id}
                targetCount={targetCounts.get(n.id) ?? 0}
              />
            </div>
          );
        })}
      </div>
      {children}
      <div className="zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomAt(1.2)} aria-label={t('zoomIn')} title={t('zoomIn')}>
          <Plus size={15} />
        </button>
        <button type="button" onClick={() => zoomAt(1 / 1.2)} aria-label={t('zoomOut')} title={t('zoomOut')}>
          <Minus size={15} />
        </button>
        <button
          type="button"
          onClick={() => {
            autoFit.current = true;
            fit();
          }}
          aria-label={t('fit')}
          title={`${t('fit')} (F)`}
        >
          <Maximize size={14} />
        </button>
      </div>
      <div className="canvas-hint" aria-hidden="true">
        {size.w > 700 ? `${t('panHint')} · ${t('connectHint')}` : ''}
      </div>
    </div>
  );
}

function Edge({
  spec,
  a,
  b,
  snap,
  selected,
}: {
  spec: EdgeSpec;
  a: { x: number; y: number } | undefined;
  b: { x: number; y: number } | undefined;
  snap: Snapshot['edges'][string] | undefined;
  selected: boolean;
}) {
  if (!a || !b) return null;
  const { d, mx, my } = edgeGeometry(a, b);
  const rate = snap?.rate ?? 0;
  const failRatio = rate > 0 ? Math.min(1, (snap?.failRate ?? 0) / rate) : 0;
  const amp = snap && snap.callRate > 0.5 ? snap.rate / snap.callRate : 1;
  const bad = failRatio > 0.1 || spec.policy.cut;
  const width = Math.min(5, 1.4 + Math.log10(rate + 1) * 0.9);
  const count = rate <= 0.05 || spec.policy.cut ? 0 : Math.max(1, Math.min(8, Math.round(Math.log2(rate) + 1)));
  const badCount = Math.round(count * failRatio);
  const id = domId(spec.id);
  const dur = 1.8;
  const dash = spec.policy.cut ? '3 6' : spec.policy.optional ? '7 5' : undefined;
  const label = spec.policy.cut ? '✂' : `${fmtRate(rate)}/s`;
  const extra = amp >= 1.15 ? `↻ ×${amp.toFixed(1)}` : spec.policy.probability < 1 ? `${Math.round(spec.policy.probability * 100)}%` : '';

  return (
    <g className={`edge ${selected ? 'selected' : ''} ${bad ? 'bad' : ''} ${amp >= 1.15 ? 'retrying' : ''}`} data-edge={spec.id}>
      <path d={d} className="edge-hit" data-edge={spec.id} />
      <path
        id={id}
        d={d}
        className="edge-line"
        strokeWidth={width}
        strokeDasharray={dash}
        markerEnd={`url(#${selected ? 'mp-arrow-sel' : bad ? 'mp-arrow-bad' : 'mp-arrow'})`}
      />
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} r={i < badCount ? 3.2 : 2.6} className={i < badCount ? 'dot bad' : 'dot'}>
          <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`-${((i * dur) / count).toFixed(2)}s`}>
            <mpath href={`#${id}`} />
          </animateMotion>
        </circle>
      ))}
      <g transform={`translate(${mx} ${my})`} className="edge-label" data-edge={spec.id}>
        <rect x={extra ? -52 : -26} y={-11} width={extra ? 104 : 52} height={22} rx={11} />
        <text x={extra ? -44 : 0} y={4} textAnchor={extra ? 'start' : 'middle'}>
          {label}
        </text>
        {extra && (
          <text x={44} y={4} textAnchor="end" className="edge-extra">
            {extra}
          </text>
        )}
      </g>
    </g>
  );
}
