// The meltpoint finder: run the design at many steady loads, each from a cold start, and
// find where it stops keeping up. Every point is a full simulation, not an extrapolation.

import { Engine } from './engine';
import type { Topology } from './types';

export interface SweepPoint {
  load: number;
  /** Requests actually generated per second in the measured window. */
  offered: number;
  goodput: number;
  errorRatio: number;
  p50: number | null;
  p99: number | null;
  amplification: number;
  /** Age of the oldest queued message at the end of the run, across all queues. */
  lagMs: number;
  /** The busiest node at this load and how busy it was. */
  bottleneck: string | null;
  bottleneckUtil: number;
}

export interface SweepResult {
  points: SweepPoint[];
  baselineP99: number | null;
  /** Highest load that still felt like low load: tail within 2.5x and under 1% errors. */
  safeLoad: number | null;
  /** Lowest load at which the system stops keeping up. */
  meltLoad: number | null;
  peakGoodput: number;
  bottleneck: string | null;
  /** True when nothing melted below the highest load tried. */
  unbroken: boolean;
}

const WINDOWS = 8;
/** Each point simulates about this many requests, between 6 s and 24 s of simulated time. */
const REQUEST_BUDGET = 40000;
const MAX_LOAD = 50000;
const STEP = 1.5;

export function measure(top: Topology, load: number, seed = 42): SweepPoint {
  const total = Math.min(24000, Math.max(6000, (REQUEST_BUDGET / Math.max(1, load)) * 1000));
  const windowMs = (total * 2) / 3 / WINDOWS;
  const e = new Engine(top, { seed, load, traffic: 'steady' });
  e.advance(total / 3);
  const ok0 = e.totals.ok;
  const failed0 = e.totals.failed;
  const roots0 = e.totals.roots;
  let lagMs = 0;
  const p99s: number[] = [];
  const p50s: number[] = [];
  const amps: number[] = [];
  const util = new Map<string, number>();
  for (let i = 0; i < WINDOWS; i += 1) {
    e.advance(windowMs);
    const s = e.snapshot();
    if (s.system.p99 !== null) p99s.push(s.system.p99);
    if (s.system.p50 !== null) p50s.push(s.system.p50);
    amps.push(s.system.amplification);
    for (const n of Object.values(s.nodes)) {
      const busy = n.capacity > 0 ? n.util : n.heat;
      util.set(n.id, (util.get(n.id) ?? 0) + busy / WINDOWS);
      if (i === WINDOWS - 1 && n.kind === 'queue') lagMs = Math.max(lagMs, n.lagMs);
    }
  }
  const seconds = (windowMs * WINDOWS) / 1000;
  const offered = (e.totals.roots - roots0) / seconds;
  const ok = e.totals.ok - ok0;
  const failed = e.totals.failed - failed0;
  let bottleneck: string | null = null;
  let bottleneckUtil = 0;
  for (const [id, u] of util) {
    if (u > bottleneckUtil) {
      bottleneckUtil = u;
      bottleneck = id;
    }
  }
  return {
    load,
    offered,
    goodput: ok / seconds,
    errorRatio: ok + failed > 0 ? failed / (ok + failed) : 0,
    lagMs,
    p50: median(p50s),
    p99: median(p99s),
    amplification: median(amps) ?? 1,
    bottleneck,
    bottleneckUtil,
  };
}

function melted(p: SweepPoint, baseline: number | null): boolean {
  if (p.errorRatio >= 0.05) return true;
  if (p.goodput < p.offered * 0.9) return true;
  if (p.lagMs > 5000) return true;
  return baseline !== null && p.p99 !== null && p.p99 > baseline * 10;
}

function safe(p: SweepPoint, baseline: number | null): boolean {
  if (p.errorRatio >= 0.01) return false;
  if (p.lagMs > 1000) return false;
  if (baseline === null || p.p99 === null) return p.goodput >= p.offered * 0.97;
  return p.p99 <= baseline * 2.5;
}

export function sweep(top: Topology, seed = 42, onProgress?: (done: number, point: SweepPoint) => void): SweepResult {
  const points: SweepPoint[] = [];
  const add = (load: number): SweepPoint => {
    const p = measure(top, load, seed);
    points.push(p);
    onProgress?.(points.length, p);
    return p;
  };

  const first = add(5);
  const baseline = first.p99;
  let lastGood: SweepPoint | null = melted(first, baseline) ? null : first;
  let firstBad: SweepPoint | null = lastGood ? null : first;
  let load = 5;
  while (!firstBad && load < MAX_LOAD) {
    load = Math.min(MAX_LOAD, load * STEP);
    const p = add(load);
    if (melted(p, baseline)) firstBad = p;
    else lastGood = p;
  }

  // Bisect the edge between the last load that coped and the first that did not.
  if (firstBad && lastGood) {
    let lo = lastGood.load;
    let hi = firstBad.load;
    for (let i = 0; i < 5; i += 1) {
      const mid = Math.sqrt(lo * hi);
      if (melted(add(mid), baseline)) hi = mid;
      else lo = mid;
    }
    // One point a little past the edge shows how hard it falls.
    if (!points.some((p) => p.load > hi * 1.2)) add(hi * 1.3);
  }

  points.sort((a, b) => a.load - b.load);
  let safeLoad: number | null = null;
  let meltLoad: number | null = null;
  for (const p of points) {
    if (meltLoad === null && melted(p, baseline)) meltLoad = p.load;
    if (meltLoad === null && safe(p, baseline)) safeLoad = p.load;
  }
  const peakGoodput = Math.max(0, ...points.map((p) => p.goodput));
  const at = meltLoad !== null ? points.find((p) => p.load === meltLoad) : points[points.length - 1];
  return {
    points,
    baselineP99: baseline,
    safeLoad,
    meltLoad,
    peakGoodput,
    bottleneck: at?.bottleneck ?? null,
    unbroken: meltLoad === null,
  };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
