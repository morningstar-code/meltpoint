import { describe, expect, test } from 'vitest';
import { makeEdge, makeNode } from './catalog';
import { Engine, type Snapshot } from './engine';
import { SCENARIOS, scenarioById, withEdge, withNode, type Scenario } from './scenarios';
import { erlangC, meanWaitMs } from './theory';
import type { EdgePolicy, NodeParams, Topology } from './types';

function single(params: Partial<NodeParams>, edge: Partial<EdgePolicy> = {}): Topology {
  return {
    nodes: [makeNode('c', 'client', 'Client', 0, 0), makeNode('s', 'service', 'S', 300, 0, params)],
    edges: [makeEdge('c', 's', { timeoutMs: 60000, latencyMs: 0, ...edge })],
  };
}

function scenario(id: string): Scenario {
  const s = scenarioById(id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
}

function finiteEverywhere(value: unknown, path: string): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} = ${value}`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => finiteEverywhere(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) finiteEverywhere(v, `${path}.${k}`);
  }
}

/** Average a metric over many snapshot windows to tame the noise. */
function average(e: Engine, ms: number, pick: (s: Snapshot) => number | null): number {
  const xs: number[] = [];
  for (let t = 0; t < ms; t += 3000) {
    e.advance(3000);
    const v = pick(e.snapshot());
    if (v !== null) xs.push(v);
  }
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

describe('bookkeeping', () => {
  test.each(SCENARIOS.map((s) => [s.id, s] as const))('%s conserves every request', (_id, sc) => {
    const e = new Engine(sc.topology, { seed: 3, load: sc.load, traffic: sc.traffic });
    for (let i = 0; i < 6; i += 1) {
      e.advance(5000);
      const s = e.snapshot();
      expect(e.totals.ok + e.totals.failed + s.system.inflight).toBe(e.totals.roots);
      const reasons = Object.values(e.totals.byReason).reduce((a, b) => a + b, 0);
      expect(reasons).toBe(e.totals.failed);
    }
  });

  test.each(SCENARIOS.map((s) => [s.id, s] as const))('%s keeps every number finite and in range', (_id, sc) => {
    let top = sc.topology;
    // Throw every experiment at it as well, since chaos is where edge cases live.
    for (const ex of sc.experiments) if (ex.apply) top = ex.apply(top);
    const e = new Engine(top, { seed: 5, load: sc.load * 2, traffic: sc.traffic });
    for (let i = 0; i < 4; i += 1) {
      e.advance(7000);
      const s = e.snapshot();
      const { p50, p95, p99, ...rest } = s.system;
      finiteEverywhere({ nodes: s.nodes, edges: s.edges, system: rest, p50: p50 ?? 0, p95: p95 ?? 0, p99: p99 ?? 0 }, sc.id);
      for (const n of Object.values(s.nodes)) {
        expect(n.util).toBeGreaterThanOrEqual(0);
        expect(n.util).toBeLessThanOrEqual(1);
        expect(n.wasted).toBeGreaterThanOrEqual(0);
        expect(n.wasted).toBeLessThanOrEqual(1);
        expect(n.heat).toBeGreaterThanOrEqual(0);
        expect(n.heat).toBeLessThanOrEqual(1);
      }
    }
  });

  test('the same seed replays identically', () => {
    const sc = scenario('checkout');
    const run = () => {
      const e = new Engine(sc.topology, { seed: 11, load: 500, traffic: 'spike' });
      e.advance(30000);
      return JSON.stringify({ totals: e.totals, snap: e.snapshot(), incidents: e.incidents });
    };
    expect(run()).toBe(run());
  });

  test('a different seed gives a different run', () => {
    const sc = scenario('utilization-cliff');
    const a = new Engine(sc.topology, { seed: 1, load: 150 });
    const b = new Engine(sc.topology, { seed: 2, load: 150 });
    a.advance(10000);
    b.advance(10000);
    expect(a.totals.roots).not.toBe(b.totals.roots);
  });
});

describe('agrees with queueing theory', () => {
  test('Erlang C reference values', () => {
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 10);
    expect(erlangC(2, 1)).toBeCloseTo(1 / 3, 10);
    expect(erlangC(3, 3)).toBe(1);
  });

  test('M/M/1 mean time in system is 1 / (μ − λ)', () => {
    // μ = 100/s and λ = 60/s, so 1 / 40 s = 25 ms.
    const e = new Engine(single({ concurrency: 1, serviceMs: 10, cv: 1, queueLimit: 100000 }), { seed: 9, load: 60 });
    e.advance(10000);
    const mean = average(e, 240000, (s) => s.nodes.s.meanLatency);
    expect(mean).toBeGreaterThan(25 * 0.88);
    expect(mean).toBeLessThan(25 * 1.12);
  });

  test('M/M/4 queueing delay matches Erlang C', () => {
    const e = new Engine(single({ concurrency: 4, serviceMs: 40, cv: 1, queueLimit: 100000 }), { seed: 4, load: 80 });
    e.advance(10000);
    const measured = average(e, 300000, (s) => s.nodes.s.meanWait);
    const predicted = meanWaitMs(4, 40, 80, 1) as number;
    expect(predicted).toBeGreaterThan(20);
    expect(measured).toBeGreaterThan(predicted * 0.8);
    expect(measured).toBeLessThan(predicted * 1.2);
  });

  test('utilisation equals λ / capacity below saturation', () => {
    const e = new Engine(single({ concurrency: 10, serviceMs: 50, cv: 0.5 }), { seed: 2, load: 120 });
    e.advance(5000);
    const util = average(e, 120000, (s) => s.nodes.s.util);
    expect(util).toBeGreaterThan(0.6 * 0.94);
    expect(util).toBeLessThan(0.6 * 1.06);
  });
});

describe('failure modes', () => {
  const storm = scenario('retry-storm');

  test('the retry storm outlives the spike that started it', () => {
    const e = new Engine(storm.topology, { seed: 42, load: storm.load, traffic: storm.traffic });
    e.advance(14000);
    expect(e.snapshot().system.goodput).toBeGreaterThan(60);
    e.advance(36000); // 30 s after the spike ended, the load is back to normal.
    const s = e.snapshot().system;
    expect(s.goodput).toBeLessThan(5);
    expect(s.amplification).toBeGreaterThan(2);
    expect(s.wasted).toBeGreaterThan(0.5);
  });

  test('a retry budget lets it recover', () => {
    const top = withEdge('api->db', { retryBudget: 0.1 })(storm.topology);
    const e = new Engine(top, { seed: 42, load: storm.load, traffic: storm.traffic });
    e.advance(50000);
    const s = e.snapshot().system;
    expect(s.goodput).toBeGreaterThan(65);
    expect(s.amplification).toBeLessThan(1.2);
  });

  test('deadline-aware work wastes less and serves more', () => {
    const run = (deadlineAware: boolean) => {
      const e = new Engine(withNode('db', { deadlineAware })(storm.topology), { seed: 42, load: 120 });
      e.advance(30000);
      const s = e.snapshot();
      return { wasted: s.nodes.db.wasted, goodput: s.system.goodput };
    };
    const naive = run(false);
    const aware = run(true);
    expect(naive.wasted).toBeGreaterThan(0.9);
    expect(aware.wasted).toBeLessThan(naive.wasted * 0.75);
    expect(aware.goodput).toBeGreaterThan(naive.goodput + 20);
  });

  test('a rate limiter admits its rate and refuses the rest', () => {
    const e = new Engine(scenario('rate-limiter').topology, { seed: 8, load: 400 });
    e.advance(5000);
    const admitted = average(e, 60000, (s) => s.nodes.api.inRate);
    expect(admitted).toBeGreaterThan(180 * 0.93);
    expect(admitted).toBeLessThan(180 * 1.07);
    expect(e.snapshot().system.byReason.rate_limited).toBeGreaterThan(150);
  });

  test('a circuit breaker opens on a failing dependency and closes once it heals', () => {
    const top: Topology = {
      nodes: [
        makeNode('c', 'client', 'C', 0, 0),
        makeNode('b', 'breaker', 'B', 300, 0, { minRequests: 10, errorThreshold: 0.5, openMs: 2000 }),
        makeNode('x', 'external', 'X', 600, 0, { errorRate: 1 }),
      ],
      edges: [makeEdge('c', 'b'), makeEdge('b', 'x')],
    };
    const e = new Engine(top, { seed: 1, load: 50 });
    e.advance(5000);
    expect(e.incidents.some((i) => i.type === 'breaker_open')).toBe(true);
    e.updateParams(withNode('x', { errorRate: 0 })(top));
    e.advance(10000);
    expect(e.incidents.some((i) => i.type === 'breaker_close')).toBe(true);
    expect(e.snapshot().nodes.b.breaker).toBe('closed');
  });

  test('a queue holds messages while workers are down and drains after', () => {
    const sc = scenario('async-queue');
    const e = new Engine(withNode('workers', { down: true })(sc.topology), { seed: 6, load: 40 });
    e.advance(20000);
    const backlog = e.snapshot().nodes.queue.backlog;
    expect(backlog).toBeGreaterThan(40 * 20 * 0.85);
    expect(e.snapshot().system.goodput).toBeGreaterThan(30); // users never noticed
    e.updateParams(sc.topology);
    e.advance(120000);
    expect(e.snapshot().nodes.queue.backlog).toBeLessThan(backlog * 0.2);
  });

  test('a crashed server behind a load balancer is routed around', () => {
    const sc = scenario('fleet');
    const e = new Engine(withNode('s2', { down: true })(sc.topology), { seed: 3, load: 300 });
    e.advance(20000);
    const s = e.snapshot();
    expect(s.nodes.s2.inRate).toBe(0);
    expect(s.system.errorRatio).toBeLessThan(0.02);
  });

  test('autoscaling adds instances, after their boot time', () => {
    const e = new Engine(scenario('autoscaling').topology, { seed: 2, load: 700 });
    e.advance(6000);
    const early = e.snapshot().nodes.api;
    expect(early.booting).toBeGreaterThan(0);
    expect(early.instances).toBe(2);
    e.advance(30000);
    expect(e.snapshot().nodes.api.instances).toBeGreaterThan(3);
  });

  test('an optional call falls back instead of failing the request', () => {
    const sc = scenario('slow-dependency');
    const broken = withNode('recs', { slowdown: 20 })(sc.topology);
    const fixed = withEdge('api->recs', { timeoutMs: 200, optional: true })(broken);
    const a = new Engine(broken, { seed: 1, load: 150 });
    const b = new Engine(fixed, { seed: 1, load: 150 });
    a.advance(20000);
    b.advance(20000);
    expect(a.snapshot().system.goodput).toBeLessThan(10);
    expect(b.snapshot().system.goodput).toBeGreaterThan(130);
    expect(b.snapshot().edges['api->recs'].fallbackRate).toBeGreaterThan(100);
  });

  test('carrying on after a structural edit keeps the clock and history', () => {
    const sc = scenario('fleet');
    const e = new Engine(sc.topology, { seed: 3, load: 300 });
    e.advance(20000);
    const fourth = sc.experiments.find((x) => x.id === 'fourth')?.apply?.(sc.topology) as Topology;
    const next = e.continueWith(fourth);
    expect(next.now).toBe(20000);
    expect(next.history.length).toBe(e.history.length);
    next.advance(10000);
    expect(next.snapshot().nodes.s4.inRate).toBeGreaterThan(40);
  });
});
