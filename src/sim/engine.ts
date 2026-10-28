// A discrete-event simulator. Requests are real objects that queue for finite slots,
// time out, retry and get abandoned; every number the UI shows is measured from them.
// No React, no DOM: the same engine runs on the page, in a worker and in tests.

import { KINDS } from './catalog';
import { EventHeap } from './heap';
import { Rng } from './random';
import { trafficFactor } from './traffic';
import type { EdgeSpec, FailReason, NodeKind, NodeParams, NodeSpec, Topology, TrafficShape } from './types';
import { FAIL_REASONS } from './types';

export const BUCKET_MS = 250;
const BUCKETS = 20; // 5 s of history per meter
const RATE_BUCKETS = 8; // rates are averaged over the last 2 s
const HISTORY_EVERY_TICKS = 2; // one history point every 500 ms
export const HISTORY_LEN = 240; // two minutes
const SPARK_LEN = 48;
/** A call with no timeout still gives up eventually, so a cut link cannot leak forever. */
const MAX_WAIT_MS = 60000;
const MAX_EVENTS_PER_ADVANCE = 3_000_000;

// ---------------------------------------------------------------------------------------
// Runtime structures

class Meter {
  readonly v = new Float64Array(BUCKETS);
}

class Fifo<T> {
  private items: T[] = [];
  private head = 0;
  get length(): number {
    return this.items.length - this.head;
  }
  push(item: T): void {
    this.items.push(item);
  }
  shift(): T | undefined {
    if (this.head >= this.items.length) return undefined;
    const item = this.items[this.head];
    this.head += 1;
    if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }
  peek(): T | undefined {
    return this.items[this.head];
  }
}

class LatencyRing {
  private readonly values: Float64Array;
  private readonly times: Float64Array;
  private n = 0;
  private i = 0;
  constructor(size: number) {
    this.values = new Float64Array(size);
    this.times = new Float64Array(size);
  }
  add(t: number, v: number): void {
    this.values[this.i] = v;
    this.times[this.i] = t;
    this.i = (this.i + 1) % this.values.length;
    if (this.n < this.values.length) this.n += 1;
  }
  /** Sorted latencies recorded since `since`. */
  recent(since: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.n; k += 1) if (this.times[k] >= since) out.push(this.values[k]);
    out.sort((a, b) => a - b);
    return out;
  }
}

interface Message {
  createdAt: number;
  deliveries: number;
}

interface Job {
  node: RNode;
  call: Call | null;
  arrived: number;
  started: number;
  serviceMs: number;
  deadline: number;
  /** 0 waiting, 1 in service, 2 waiting on downstream, 3 done. */
  phase: number;
  pending: number;
  holding: boolean;
  abandoned: boolean;
  probe: boolean;
  calls: Call[] | null;
  message: Message | null;
}

interface Call {
  edge: REdge;
  parent: Job;
  attempt: number;
  current: Job | null;
  done: boolean;
}

type BreakerState = 'closed' | 'open' | 'half';

interface RNode {
  spec: NodeSpec;
  p: NodeParams;
  kind: NodeKind;
  slotted: boolean;
  out: REdge[];
  /** Queues that deliver to this node. */
  feeders: RNode[];
  busy: number;
  active: number;
  booting: number;
  waiting: Fifo<Job>;
  inbound: number;
  inflight: number;
  lastFlush: number;
  rr: number;
  // rate limiter
  tokens: number;
  lastRefill: number;
  // breaker
  breaker: BreakerState;
  openUntil: number;
  halfInflight: number;
  halfOk: number;
  // queue
  backlog: Fifo<Message>;
  // autoscaler
  lastScaleDown: number;
  // meters
  m: {
    arrivals: Meter;
    ok: Meter;
    failed: Meter;
    rejected: Meter;
    busyArea: Meter;
    capArea: Meter;
    wasted: Meter;
    useful: Meter;
    waitSum: Meter;
    waitCount: Meter;
    hits: Meter;
    lookups: Meter;
    bOk: Meter;
    bFail: Meter;
    deadLetters: Meter;
  };
  lat: LatencyRing;
  spark: number[];
  status: NodeStatus;
  deadLettering: boolean;
}

interface REdge {
  spec: EdgeSpec;
  from: RNode;
  to: RNode;
  m: { calls: Meter; attempts: Meter; retries: Meter; fails: Meter; timeouts: Meter; fallbacks: Meter };
}

const enum Ev {
  Root,
  Arrive,
  ServiceDone,
  Timeout,
  Retry,
  Response,
  Tick,
  Boot,
}

interface SimEvent {
  t: number;
  seq: number;
  type: Ev;
  node?: RNode;
  job?: Job;
  call?: Call;
  ok?: boolean;
  reason?: FailReason;
  gen?: number;
}

// ---------------------------------------------------------------------------------------
// Snapshot types

export type NodeStatus = 'idle' | 'ok' | 'warm' | 'hot' | 'melting' | 'down';

export interface NodeSnap {
  id: string;
  kind: NodeKind;
  status: NodeStatus;
  /** 0..1 colour temperature for the canvas. */
  heat: number;
  util: number;
  busy: number;
  capacity: number;
  waiting: number;
  inRate: number;
  okRate: number;
  failRate: number;
  rejectRate: number;
  p50: number | null;
  p99: number | null;
  meanLatency: number | null;
  meanWait: number | null;
  wasted: number;
  instances: number;
  booting: number;
  hitRate: number | null;
  breaker: BreakerState | null;
  tokens: number | null;
  backlog: number;
  lagMs: number;
  deadLetterRate: number;
  spark: number[];
}

export interface EdgeSnap {
  id: string;
  rate: number;
  callRate: number;
  retryRate: number;
  failRate: number;
  timeoutRate: number;
  fallbackRate: number;
}

export interface SystemSnap {
  t: number;
  /** Configured offered load right now, after the traffic shape. */
  target: number;
  offered: number;
  goodput: number;
  failRate: number;
  errorRatio: number;
  byReason: Record<FailReason, number>;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  /** Attempts per logical call, across every link. 1 = no retries. */
  amplification: number;
  /** Share of all slot time spent on requests nobody is waiting for any more. */
  wasted: number;
  inflight: number;
}

export interface HistoryPoint {
  t: number;
  target: number;
  offered: number;
  goodput: number;
  failRate: number;
  p99: number | null;
  maxUtil: number;
}

export type IncidentType =
  | 'melt'
  | 'recover'
  | 'collapse'
  | 'restore'
  | 'breaker_open'
  | 'breaker_half'
  | 'breaker_close'
  | 'scale_up'
  | 'scale_ready'
  | 'scale_down'
  | 'dead_letter';

export interface Incident {
  t: number;
  type: IncidentType;
  node?: string;
  value?: number;
}

export interface Snapshot {
  system: SystemSnap;
  nodes: Record<string, NodeSnap>;
  edges: Record<string, EdgeSnap>;
}

export interface Totals {
  roots: number;
  ok: number;
  failed: number;
  byReason: Record<FailReason, number>;
}

function zeroReasons(): Record<FailReason, number> {
  const r = {} as Record<FailReason, number>;
  for (const k of FAIL_REASONS) r[k] = 0;
  return r;
}

function meter(): Meter {
  return new Meter();
}

// ---------------------------------------------------------------------------------------

export interface EngineOptions {
  seed?: number;
  load?: number;
  traffic?: TrafficShape;
  /** Start the clock here instead of at zero, to carry on from an earlier run. */
  startAt?: number;
}

export class Engine {
  now = 0;
  load: number;
  traffic: TrafficShape;
  readonly seed: number;
  readonly totals: Totals = { roots: 0, ok: 0, failed: 0, byReason: zeroReasons() };
  readonly history: HistoryPoint[] = [];
  readonly incidents: Incident[] = [];
  /** True when the last advance hit the per-call event limit. */
  lagging = false;

  private rng: Rng;
  private heap = new EventHeap<SimEvent>();
  private seq = 0;
  private bi = 0;
  private ticks = 0;
  private gen = 0;
  private nodes: RNode[] = [];
  private byId = new Map<string, RNode>();
  private edges: REdge[] = [];
  private clients: RNode[] = [];
  private inflightRoots = 0;
  private collapsed = false;
  private sys = {
    offered: meter(),
    ok: meter(),
    failed: meter(),
    reasons: Object.fromEntries(FAIL_REASONS.map((r) => [r, meter()])) as Record<FailReason, Meter>,
  };
  private sysLat = new LatencyRing(4096);

  constructor(topology: Topology, opts: EngineOptions = {}) {
    this.seed = opts.seed ?? 42;
    this.load = opts.load ?? 50;
    this.traffic = opts.traffic ?? 'steady';
    this.rng = new Rng(this.seed);
    this.now = Math.max(0, opts.startAt ?? 0);
    this.build(topology);
    for (const n of this.nodes) n.lastFlush = this.now;
    this.schedule(this.now + BUCKET_MS, Ev.Tick);
    this.restartArrivals();
  }

  /**
   * A new engine for a changed topology that carries on from this one: same clock, same
   * history and incidents. Requests in flight in the old topology are dropped.
   */
  continueWith(topology: Topology): Engine {
    const next = new Engine(topology, { seed: this.seed + 1, load: this.load, traffic: this.traffic, startAt: this.now });
    next.history.push(...this.history);
    next.incidents.push(...this.incidents);
    return next;
  }

  // -------------------------------------------------------------------------------------
  // Public controls

  setLoad(load: number): void {
    if (load === this.load) return;
    this.load = Math.max(0, load);
    this.restartArrivals();
  }

  setTraffic(shape: TrafficShape): void {
    if (shape === this.traffic) return;
    this.traffic = shape;
    this.restartArrivals();
  }

  /** Swap in new parameters without disturbing the requests already in flight. */
  updateParams(topology: Topology): void {
    for (const spec of topology.nodes) {
      const n = this.byId.get(spec.id);
      if (!n) continue;
      const prev = n.p;
      this.flush(n);
      n.spec = spec;
      n.p = spec.params;
      const a = n.p.autoscale;
      if (!a.enabled || prev.instances !== n.p.instances || !prev.autoscale.enabled) {
        n.active = this.initialInstances(n.p);
        if (!a.enabled) n.booting = 0;
      } else {
        n.active = Math.min(Math.max(n.active, a.min), Math.max(a.min, a.max));
      }
      if (n.p.down && !prev.down) this.crash(n);
      if (n.kind === 'ratelimiter') n.tokens = Math.min(n.tokens, n.p.burst);
      this.pump(n);
      if (n.kind === 'queue') this.pumpQueue(n);
    }
    const byEdge = new Map(topology.edges.map((e) => [e.id, e]));
    for (const e of this.edges) {
      const spec = byEdge.get(e.spec.id);
      if (spec) e.spec = spec;
    }
    // A worker that came back up may pull again.
    for (const n of this.nodes) if (n.kind === 'queue') this.pumpQueue(n);
    this.restartArrivals();
  }

  /** A crash loses everything waiting in the node. Work in progress fails as it surfaces. */
  private crash(n: RNode): void {
    for (;;) {
      const j = n.waiting.shift();
      if (!j) break;
      if (j.phase === 0) this.reject(j, 'down');
    }
  }

  /**
   * Run the simulation forward by ms. With maxEvents set, stops early when the work runs
   * out, leaving the clock behind; the UI uses this to keep each frame short.
   */
  advance(ms: number, maxEvents = MAX_EVENTS_PER_ADVANCE): void {
    if (!(ms > 0)) return;
    const until = this.now + ms;
    let processed = 0;
    this.lagging = false;
    for (;;) {
      const ev = this.heap.peek();
      if (!ev || ev.t > until) break;
      this.heap.pop();
      this.now = ev.t;
      this.handle(ev);
      processed += 1;
      if (processed >= maxEvents) {
        this.lagging = true;
        return;
      }
    }
    this.now = until;
  }

  /** Instantaneous offered load after the traffic shape. */
  targetLoad(t = this.now): number {
    return this.load * trafficFactor(this.traffic, t);
  }

  snapshot(): Snapshot {
    const nodes: Record<string, NodeSnap> = {};
    let wasted = 0;
    let work = 0;
    for (const n of this.nodes) {
      const snap = this.nodeSnap(n);
      nodes[n.spec.id] = snap;
      wasted += this.sum(n.m.wasted);
      work += this.sum(n.m.wasted) + this.sum(n.m.useful);
    }
    const edges: Record<string, EdgeSnap> = {};
    let calls = 0;
    let attempts = 0;
    for (const e of this.edges) {
      const s = this.edgeSnap(e);
      edges[e.spec.id] = s;
      calls += this.sum(e.m.calls);
      attempts += this.sum(e.m.attempts);
    }
    const lat = this.sysLat.recent(this.now - 3000);
    const offered = this.rate(this.sys.offered);
    const goodput = this.rate(this.sys.ok);
    const failRate = this.rate(this.sys.failed);
    const byReason = zeroReasons();
    for (const r of FAIL_REASONS) byReason[r] = this.rate(this.sys.reasons[r]);
    const done = goodput + failRate;
    return {
      nodes,
      edges,
      system: {
        t: this.now,
        target: this.targetLoad(),
        offered,
        goodput,
        failRate,
        errorRatio: done > 0 ? failRate / done : 0,
        byReason,
        p50: pct(lat, 0.5),
        p95: pct(lat, 0.95),
        p99: pct(lat, 0.99),
        amplification: calls > 0 ? attempts / calls : 1,
        wasted: work > 0 ? wasted / work : 0,
        inflight: this.inflightRoots,
      },
    };
  }

  // -------------------------------------------------------------------------------------
  // Construction

  private build(top: Topology): void {
    for (const spec of top.nodes) {
      const n: RNode = {
        spec,
        p: spec.params,
        kind: spec.kind,
        slotted: KINDS[spec.kind].slotted,
        out: [],
        feeders: [],
        busy: 0,
        active: this.initialInstances(spec.params),
        booting: 0,
        waiting: new Fifo(),
        inbound: 0,
        inflight: 0,
        lastFlush: 0,
        rr: 0,
        tokens: spec.params.burst,
        lastRefill: 0,
        breaker: 'closed',
        openUntil: 0,
        halfInflight: 0,
        halfOk: 0,
        backlog: new Fifo(),
        lastScaleDown: 0,
        m: {
          arrivals: meter(),
          ok: meter(),
          failed: meter(),
          rejected: meter(),
          busyArea: meter(),
          capArea: meter(),
          wasted: meter(),
          useful: meter(),
          waitSum: meter(),
          waitCount: meter(),
          hits: meter(),
          lookups: meter(),
          bOk: meter(),
          bFail: meter(),
          deadLetters: meter(),
        },
        lat: new LatencyRing(1024),
        spark: [],
        status: 'idle',
        deadLettering: false,
      };
      this.nodes.push(n);
      this.byId.set(spec.id, n);
      if (spec.kind === 'client') this.clients.push(n);
    }
    for (const spec of top.edges) {
      const from = this.byId.get(spec.from);
      const to = this.byId.get(spec.to);
      if (!from || !to || from === to || to.kind === 'client') continue;
      const e: REdge = {
        spec,
        from,
        to,
        m: { calls: meter(), attempts: meter(), retries: meter(), fails: meter(), timeouts: meter(), fallbacks: meter() },
      };
      this.edges.push(e);
      from.out.push(e);
      if (from.kind === 'queue' && !to.feeders.includes(from)) to.feeders.push(from);
    }
  }

  private initialInstances(p: NodeParams): number {
    const n = Math.max(1, Math.round(p.instances));
    if (!p.autoscale.enabled) return n;
    return Math.min(Math.max(n, p.autoscale.min), Math.max(p.autoscale.min, p.autoscale.max));
  }

  // -------------------------------------------------------------------------------------
  // Event plumbing

  private schedule(t: number, type: Ev, fields: Partial<SimEvent> = {}): void {
    this.seq += 1;
    this.heap.push({ t, seq: this.seq, type, ...fields });
  }

  private handle(ev: SimEvent): void {
    switch (ev.type) {
      case Ev.Root:
        if (ev.gen === this.gen) this.root(ev.node as RNode, ev.ok === true);
        break;
      case Ev.Arrive:
        this.arrive(ev.job as Job);
        break;
      case Ev.ServiceDone:
        this.serviceDone(ev.job as Job);
        break;
      case Ev.Timeout:
        this.timeout(ev.call as Call, ev.job as Job);
        break;
      case Ev.Retry:
        this.retry(ev.call as Call);
        break;
      case Ev.Response:
        this.response(ev.call as Call, ev.job as Job, ev.ok as boolean, ev.reason);
        break;
      case Ev.Tick:
        this.tick();
        break;
      case Ev.Boot:
        this.boot(ev.node as RNode, ev.gen as number);
        break;
    }
  }

  private restartArrivals(): void {
    this.gen += 1;
    for (const c of this.clients) this.scheduleNextRoot(c);
  }

  private clientRate(c: RNode): number {
    let total = 0;
    for (const k of this.clients) total += Math.max(0, k.p.weight);
    if (total <= 0) return 0;
    return (this.targetLoad() * Math.max(0, c.p.weight)) / total;
  }

  /**
   * Arrivals are a Poisson process. A gap longer than a second is cut short and re-drawn
   * (not counted as an arrival), so a traffic shape that rises is picked up promptly;
   * the exponential is memoryless, so this is exact for a constant rate.
   */
  private scheduleNextRoot(c: RNode): void {
    const rate = this.clientRate(c);
    if (rate <= 0) {
      this.schedule(this.now + 100, Ev.Root, { node: c, gen: this.gen, ok: false });
      return;
    }
    const gap = this.rng.exponential(1000 / rate);
    const real = gap <= 1000;
    this.schedule(this.now + (real ? gap : 1000), Ev.Root, { node: c, gen: this.gen, ok: real });
  }

  // -------------------------------------------------------------------------------------
  // Requests

  private newJob(node: RNode, call: Call | null, deadline: number): Job {
    return {
      node,
      call,
      arrived: this.now,
      started: 0,
      serviceMs: 0,
      deadline,
      phase: 0,
      pending: 0,
      holding: false,
      abandoned: false,
      probe: false,
      calls: null,
      message: null,
    };
  }

  private root(c: RNode, arrival: boolean): void {
    this.scheduleNextRoot(c);
    if (!arrival) return;
    this.totals.roots += 1;
    this.inflightRoots += 1;
    this.add(this.sys.offered, 1);
    const job = this.newJob(c, null, Infinity);
    this.add(c.m.arrivals, 1);
    c.inflight += 1;
    if (c.p.down) {
      this.finish(job, false, 'down');
      return;
    }
    this.fanOut(job, c.out);
  }

  private arrive(job: Job): void {
    const n = job.node;
    if (job.call?.parent.message && n.inbound > 0) n.inbound -= 1;
    this.add(n.m.arrivals, 1);
    n.inflight += 1;
    if (n.p.down) {
      this.reject(job, 'down');
      return;
    }
    switch (n.kind) {
      case 'lb':
        this.route(job);
        return;
      case 'ratelimiter':
        this.rateLimit(job);
        return;
      case 'breaker':
        this.breakerAdmit(job);
        return;
      case 'queue':
        this.enqueue(job);
        return;
      case 'client':
        this.finish(job, true);
        return;
      default:
        this.admit(job);
    }
  }

  private reject(job: Job, reason: FailReason): void {
    this.add(job.node.m.rejected, 1);
    this.finish(job, false, reason);
  }

  private capacity(n: RNode): number {
    return n.active * Math.max(1, Math.round(n.p.concurrency));
  }

  private admit(job: Job): void {
    const n = job.node;
    if (n.busy < this.capacity(n) && n.waiting.length === 0) {
      this.start(job);
    } else if (n.waiting.length < n.p.queueLimit) {
      n.waiting.push(job);
    } else {
      this.reject(job, 'shed');
    }
  }

  /** Returns false when the job was dropped instead of started. */
  private start(job: Job): boolean {
    const n = job.node;
    // Deadline-aware nodes skip work that cannot finish before the caller gives up.
    if (n.p.deadlineAware && job.deadline - this.now < n.p.serviceMs * Math.max(0.01, n.p.slowdown)) {
      this.reject(job, 'deadline');
      return false;
    }
    this.add(n.m.waitSum, this.now - job.arrived);
    this.add(n.m.waitCount, 1);
    this.setBusy(n, 1);
    job.holding = true;
    job.phase = 1;
    job.started = this.now;
    const d = this.rng.duration(n.p.serviceMs * Math.max(0.01, n.p.slowdown), n.p.cv);
    job.serviceMs = d;
    this.schedule(this.now + d, Ev.ServiceDone, { job });
    return true;
  }

  private serviceDone(job: Job): void {
    if (job.phase !== 1) return;
    const n = job.node;
    this.add(this.doomed(job) ? n.m.wasted : n.m.useful, job.serviceMs);
    if (n.p.down) {
      this.finish(job, false, 'down');
      return;
    }
    if (n.p.errorRate > 0 && this.rng.chance(n.p.errorRate)) {
      this.finish(job, false, 'error');
      return;
    }
    if (n.kind === 'cache') {
      this.add(n.m.lookups, 1);
      if (this.rng.chance(n.p.hitRate) || n.out.length === 0) {
        this.add(n.m.hits, 1);
        this.finish(job, true);
        return;
      }
    }
    this.fanOut(job, n.out);
  }

  /** Call every outgoing link this request takes (each by its probability) and wait for all. */
  private fanOut(job: Job, edges: REdge[]): void {
    const chosen: REdge[] = [];
    for (const e of edges) if (this.rng.chance(e.spec.policy.probability)) chosen.push(e);
    if (chosen.length === 0) {
      this.finish(job, true);
      return;
    }
    job.phase = 2;
    job.pending = chosen.length;
    if (job.holding && !job.node.p.blocking) this.release(job);
    job.calls = [];
    for (const e of chosen) this.call(job, e);
  }

  private release(job: Job): void {
    job.holding = false;
    const n = job.node;
    this.setBusy(n, -1);
    this.pump(n);
    for (const q of n.feeders) this.pumpQueue(q);
  }

  private pump(n: RNode): void {
    if (!n.slotted) return;
    while (n.busy < this.capacity(n) && n.waiting.length > 0) {
      const next = n.waiting.shift() as Job;
      if (next.phase !== 0) continue;
      this.start(next);
    }
  }

  private call(parent: Job, edge: REdge): void {
    const c: Call = { edge, parent, attempt: 0, current: null, done: false };
    parent.calls?.push(c);
    this.add(edge.m.calls, 1);
    this.attempt(c);
  }

  private attempt(c: Call): void {
    if (c.done) return;
    const e = c.edge;
    const pol = e.spec.policy;
    c.attempt += 1;
    this.add(e.m.attempts, 1);
    if (c.attempt > 1) this.add(e.m.retries, 1);
    const wait = pol.timeoutMs > 0 ? pol.timeoutMs : MAX_WAIT_MS;
    const job = this.newJob(e.to, c, Math.min(c.parent.deadline, this.now + wait));
    c.current = job;
    if (!pol.cut) {
      if (c.parent.message) e.to.inbound += 1;
      this.schedule(this.now + Math.max(0, pol.latencyMs), Ev.Arrive, { job });
    }
    this.schedule(this.now + wait, Ev.Timeout, { call: c, job });
  }

  private timeout(c: Call, job: Job): void {
    if (c.done || c.current !== job) return;
    job.abandoned = true;
    this.add(c.edge.m.timeouts, 1);
    this.attemptFailed(c, 'timeout');
  }

  private response(c: Call, job: Job, ok: boolean, reason: FailReason | undefined): void {
    if (c.done || c.current !== job) return;
    if (c.edge.spec.policy.cut) return;
    if (ok) {
      c.done = true;
      c.current = null;
      this.childDone(c, true);
    } else {
      this.attemptFailed(c, reason ?? 'error');
    }
  }

  private attemptFailed(c: Call, reason: FailReason): void {
    const e = c.edge;
    const pol = e.spec.policy;
    this.add(e.m.fails, 1);
    c.current = null;
    const parent = c.parent;
    const parentGaveUp = parent.node.p.deadlineAware && parent.deadline <= this.now;
    if (c.attempt <= pol.retries && parent.phase !== 3 && !parentGaveUp && this.budgetAllows(e)) {
      this.schedule(this.now + this.backoff(c), Ev.Retry, { call: c, reason });
      return;
    }
    c.done = true;
    this.childDone(c, false, reason);
  }

  private backoff(c: Call): number {
    const pol = c.edge.spec.policy;
    let d = 0;
    if (pol.backoff === 'fixed') d = pol.backoffMs;
    else if (pol.backoff === 'exponential') d = pol.backoffMs * Math.pow(2, c.attempt - 1);
    d = Math.min(d, 30000);
    if (pol.jitter) d *= this.rng.next();
    return d;
  }

  private budgetAllows(e: REdge): boolean {
    const budget = e.spec.policy.retryBudget;
    if (budget <= 0) return true;
    const calls = this.sum(e.m.calls, BUCKETS);
    const retries = this.sum(e.m.retries, BUCKETS);
    return retries < Math.max(1, budget * calls);
  }

  private retry(c: Call): void {
    if (c.done) return;
    if (c.parent.phase === 3) {
      c.done = true;
      return;
    }
    this.attempt(c);
  }

  /** A downstream call settled for good (after any retries). */
  private childDone(c: Call, ok: boolean, reason?: FailReason): void {
    const parent = c.parent;
    if (parent.phase === 3) return;
    const n = parent.node;
    if (n.kind === 'breaker') this.breakerRecord(parent, ok);
    if (parent.message) {
      this.delivered(parent, ok);
      return;
    }
    if (!ok && c.edge.spec.policy.optional) {
      this.add(c.edge.m.fallbacks, 1);
      ok = true;
    }
    if (!ok || n.p.down) {
      if (parent.calls) for (const other of parent.calls) other.done = true;
      this.finish(parent, false, ok ? 'down' : reason);
      return;
    }
    parent.pending -= 1;
    if (parent.pending <= 0) this.finish(parent, true);
  }

  private finish(job: Job, ok: boolean, reason?: FailReason): void {
    if (job.phase === 3) return;
    const n = job.node;
    job.phase = 3;
    if (n.inflight > 0) n.inflight -= 1;
    if (ok) {
      this.add(n.m.ok, 1);
      n.lat.add(this.now, this.now - job.arrived);
    } else {
      this.add(n.m.failed, 1);
    }
    if (job.holding) this.release(job);
    if (job.call) {
      const delay = Math.max(0, job.call.edge.spec.policy.latencyMs);
      this.schedule(this.now + delay, Ev.Response, { call: job.call, job, ok, reason });
    } else if (n.kind === 'client') {
      this.inflightRoots -= 1;
      if (ok) {
        this.totals.ok += 1;
        this.add(this.sys.ok, 1);
        this.sysLat.add(this.now, this.now - job.arrived);
      } else {
        const r = reason ?? 'error';
        this.totals.failed += 1;
        this.totals.byReason[r] += 1;
        this.add(this.sys.failed, 1);
        this.add(this.sys.reasons[r], 1);
      }
    }
  }

  /** Work is wasted when nobody up the chain is waiting for its answer any more. */
  private doomed(job: Job): boolean {
    let j: Job = job;
    for (;;) {
      if (j.abandoned) return true;
      const c = j.call;
      if (!c) return false;
      if (c.done || c.current !== j) return true;
      j = c.parent;
      if (j.phase === 3) return true;
    }
  }

  // -------------------------------------------------------------------------------------
  // Component behaviours

  private route(job: Job): void {
    const n = job.node;
    const healthy = n.out.filter((e) => !e.to.p.down);
    if (healthy.length === 0) {
      this.reject(job, n.out.length === 0 ? 'error' : 'down');
      return;
    }
    let pick: REdge;
    if (n.p.strategy === 'random') {
      pick = healthy[this.rng.int(healthy.length)];
    } else if (n.p.strategy === 'least-busy') {
      pick = healthy[0];
      let best = Infinity;
      for (const e of healthy) {
        const t = e.to;
        const cap = t.slotted ? this.capacity(t) : 1;
        const load = (t.inflight + t.inbound) / cap;
        if (load < best) {
          best = load;
          pick = e;
        }
      }
    } else {
      pick = healthy[n.rr % healthy.length];
      n.rr += 1;
    }
    job.phase = 2;
    job.pending = 1;
    job.calls = [];
    this.call(job, pick);
  }

  private rateLimit(job: Job): void {
    const n = job.node;
    const p = n.p;
    n.tokens = Math.min(p.burst, n.tokens + ((this.now - n.lastRefill) * p.rate) / 1000);
    n.lastRefill = this.now;
    if (n.tokens >= 1) {
      n.tokens -= 1;
      this.fanOut(job, n.out);
    } else {
      this.reject(job, 'rate_limited');
    }
  }

  private breakerAdmit(job: Job): void {
    const n = job.node;
    this.breakerClock(n);
    if (n.breaker === 'open') {
      this.reject(job, 'breaker_open');
      return;
    }
    if (n.breaker === 'half') {
      if (n.halfInflight >= 3) {
        this.reject(job, 'breaker_open');
        return;
      }
      n.halfInflight += 1;
      job.probe = true;
    }
    this.fanOut(job, n.out);
  }

  private breakerClock(n: RNode): void {
    if (n.breaker === 'open' && this.now >= n.openUntil) {
      n.breaker = 'half';
      n.halfInflight = 0;
      n.halfOk = 0;
      this.incident('breaker_half', n);
    }
  }

  private breakerRecord(job: Job, ok: boolean): void {
    const n = job.node;
    if (job.probe) {
      n.halfInflight = Math.max(0, n.halfInflight - 1);
      if (n.breaker !== 'half') return;
      if (!ok) {
        this.tripBreaker(n);
      } else {
        n.halfOk += 1;
        if (n.halfOk >= 3) {
          n.breaker = 'closed';
          n.m.bOk.v.fill(0);
          n.m.bFail.v.fill(0);
          this.incident('breaker_close', n);
        }
      }
      return;
    }
    if (n.breaker !== 'closed') return;
    this.add(ok ? n.m.bOk : n.m.bFail, 1);
    const okN = this.sum(n.m.bOk, BUCKETS, true);
    const failN = this.sum(n.m.bFail, BUCKETS, true);
    const total = okN + failN;
    if (total >= Math.max(1, n.p.minRequests) && failN / total >= n.p.errorThreshold) this.tripBreaker(n);
  }

  private tripBreaker(n: RNode): void {
    n.breaker = 'open';
    n.openUntil = this.now + Math.max(100, n.p.openMs);
    n.halfInflight = 0;
    this.incident('breaker_open', n);
  }

  private enqueue(job: Job): void {
    const n = job.node;
    if (n.backlog.length >= n.p.queueLimit) {
      this.reject(job, 'shed');
      return;
    }
    n.backlog.push({ createdAt: this.now, deliveries: 0 });
    this.finish(job, true);
    this.pumpQueue(n);
  }

  private pumpQueue(q: RNode): void {
    if (q.kind !== 'queue' || q.out.length === 0 || q.p.down) return;
    while (q.backlog.length > 0) {
      let pick: REdge | null = null;
      for (let k = 0; k < q.out.length; k += 1) {
        const e = q.out[(q.rr + k) % q.out.length];
        const w = e.to;
        if (w.p.down) continue;
        const room = w.slotted ? this.capacity(w) - w.busy - w.waiting.length - w.inbound : 64 - w.inbound;
        if (room > 0) {
          pick = e;
          q.rr = (q.rr + k + 1) % q.out.length;
          break;
        }
      }
      if (!pick) return;
      const msg = q.backlog.shift() as Message;
      msg.deliveries += 1;
      const carrier = this.newJob(q, null, Infinity);
      carrier.message = msg;
      carrier.phase = 2;
      carrier.pending = 1;
      carrier.calls = [];
      this.call(carrier, pick);
    }
  }

  private delivered(carrier: Job, ok: boolean): void {
    const q = carrier.node;
    const msg = carrier.message as Message;
    carrier.phase = 3;
    if (ok) {
      this.add(q.m.ok, 1);
      q.lat.add(this.now, this.now - msg.createdAt);
    } else if (msg.deliveries < Math.max(1, q.p.maxDeliveries)) {
      q.backlog.push(msg);
    } else {
      this.add(q.m.failed, 1);
      this.add(q.m.deadLetters, 1);
    }
    this.pumpQueue(q);
  }

  // -------------------------------------------------------------------------------------
  // Time keeping

  private setBusy(n: RNode, delta: number): void {
    this.flush(n);
    n.busy += delta;
  }

  private flush(n: RNode): void {
    const dt = this.now - n.lastFlush;
    if (dt > 0) {
      n.m.busyArea.v[this.bi] += n.busy * dt;
      n.m.capArea.v[this.bi] += this.capacity(n) * dt;
    }
    n.lastFlush = this.now;
  }

  private add(m: Meter, v: number): void {
    m.v[this.bi] += v;
  }

  /** Sum of the last k complete buckets (optionally including the current one). */
  private sum(m: Meter, k = RATE_BUCKETS, includeCurrent = false): number {
    let s = includeCurrent ? m.v[this.bi] : 0;
    // The ring holds BUCKETS slots and one of them is the current bucket.
    const filled = Math.min(k, this.ticks, BUCKETS - 1);
    for (let i = 1; i <= filled; i += 1) s += m.v[(this.bi - i + BUCKETS) % BUCKETS];
    return s;
  }

  private span(k = RATE_BUCKETS): number {
    return Math.max(1, Math.min(k, this.ticks)) * BUCKET_MS;
  }

  private rate(m: Meter): number {
    if (this.ticks === 0) return 0;
    return (this.sum(m) * 1000) / this.span();
  }

  private tick(): void {
    for (const n of this.nodes) this.flush(n);
    this.ticks += 1;
    this.bi = (this.bi + 1) % BUCKETS;
    for (const n of this.nodes) for (const key in n.m) n.m[key as keyof RNode['m']].v[this.bi] = 0;
    for (const e of this.edges) for (const key in e.m) e.m[key as keyof REdge['m']].v[this.bi] = 0;
    this.sys.offered.v[this.bi] = 0;
    this.sys.ok.v[this.bi] = 0;
    this.sys.failed.v[this.bi] = 0;
    for (const r of FAIL_REASONS) this.sys.reasons[r].v[this.bi] = 0;

    for (const n of this.nodes) if (n.kind === 'breaker') this.breakerClock(n);
    if (this.ticks % 4 === 0) this.autoscale();
    if (this.ticks % HISTORY_EVERY_TICKS === 0) this.record();
    this.schedule(this.now + BUCKET_MS, Ev.Tick);
  }

  private util(n: RNode, k = RATE_BUCKETS): number {
    const cap = this.sum(n.m.capArea, k);
    return cap > 0 ? Math.min(1, this.sum(n.m.busyArea, k) / cap) : 0;
  }

  private autoscale(): void {
    for (const n of this.nodes) {
      const a = n.p.autoscale;
      if (!a.enabled || !KINDS[n.kind].autoscale) continue;
      const u = this.util(n);
      const pressure = n.waiting.length > 0 ? 1 : u;
      const want = Math.min(a.max, Math.max(a.min, Math.ceil((n.active * pressure) / Math.max(0.05, a.target))));
      if (want > n.active + n.booting) {
        const add = want - n.active - n.booting;
        n.booting += add;
        this.schedule(this.now + Math.max(0, a.bootMs), Ev.Boot, { node: n, gen: add });
        this.incident('scale_up', n, add);
      } else if (n.booting === 0 && pressure < a.target * 0.5 && n.active > a.min && this.now - n.lastScaleDown > 5000) {
        this.flush(n);
        n.active -= 1;
        n.lastScaleDown = this.now;
        this.incident('scale_down', n, n.active);
      }
    }
  }

  private boot(n: RNode, count: number): void {
    if (!n.p.autoscale.enabled) return;
    const add = Math.min(count, n.booting);
    if (add <= 0) return;
    this.flush(n);
    n.booting -= add;
    n.active = Math.min(n.p.autoscale.max, n.active + add);
    this.incident('scale_ready', n, n.active);
    this.pump(n);
    for (const q of n.feeders) this.pumpQueue(q);
  }

  private record(): void {
    let maxUtil = 0;
    for (const n of this.nodes) {
      const s = this.nodeSnap(n);
      if (n.slotted) maxUtil = Math.max(maxUtil, s.util);
      n.spark.push(n.slotted ? s.util : s.heat);
      if (n.spark.length > SPARK_LEN) n.spark.shift();
      const melting = s.status === 'melting';
      if (melting && n.status !== 'melting') this.incident('melt', n);
      if (!melting && n.status === 'melting') this.incident('recover', n);
      n.status = s.status;
      const dl = s.deadLetterRate > 0;
      if (dl && !n.deadLettering) this.incident('dead_letter', n, s.deadLetterRate);
      n.deadLettering = dl;
    }
    const offered = this.rate(this.sys.offered);
    const goodput = this.rate(this.sys.ok);
    const lat = this.sysLat.recent(this.now - 3000);
    this.history.push({
      t: this.now,
      target: this.targetLoad(),
      offered,
      goodput,
      failRate: this.rate(this.sys.failed),
      p99: pct(lat, 0.99),
      maxUtil,
    });
    if (this.history.length > HISTORY_LEN) this.history.shift();
    const collapsed = offered > 1 && goodput < offered * 0.5;
    if (collapsed && !this.collapsed && this.ticks > 8) this.incident('collapse', undefined, goodput);
    if (!collapsed && this.collapsed) this.incident('restore', undefined, goodput);
    this.collapsed = collapsed;
  }

  private incident(type: IncidentType, n?: RNode, value?: number): void {
    this.incidents.push({ t: this.now, type, node: n?.spec.id, value });
    if (this.incidents.length > 200) this.incidents.shift();
  }

  // -------------------------------------------------------------------------------------
  // Snapshots

  private nodeSnap(n: RNode): NodeSnap {
    const inRate = this.rate(n.m.arrivals);
    const okRate = this.rate(n.m.ok);
    const failRate = this.rate(n.m.failed);
    const rejectRate = this.rate(n.m.rejected);
    const util = n.slotted ? this.util(n) : 0;
    const lat = n.lat.recent(this.now - 3000);
    const waits = this.sum(n.m.waitCount);
    const wasted = this.sum(n.m.wasted);
    const work = wasted + this.sum(n.m.useful);
    const lookups = this.sum(n.m.lookups);
    const done = okRate + failRate;
    const failRatio = done > 0 ? failRate / done : 0;
    let backlogRatio = 0;
    let lagMs = 0;
    if (n.kind === 'queue') {
      backlogRatio = n.p.queueLimit > 0 ? n.backlog.length / n.p.queueLimit : 0;
      const head = n.backlog.peek();
      lagMs = head ? this.now - head.createdAt : 0;
    }
    const queueRatio = n.slotted && n.p.queueLimit > 0 ? n.waiting.length / n.p.queueLimit : 0;
    let heat = n.slotted ? util * 0.85 + Math.min(1, queueRatio * 3) * 0.15 : 0;
    // A rate limiter refusing work is doing its job, so it only ever runs warm.
    const failHeat = n.kind === 'ratelimiter' ? Math.min(0.6, failRatio * 3) : Math.min(1, failRatio * 1.4);
    heat = Math.max(heat, failHeat, Math.min(1, backlogRatio * 1.2));
    if (n.kind === 'breaker' && n.breaker !== 'closed') heat = Math.max(heat, n.breaker === 'open' ? 0.9 : 0.6);
    let status: NodeStatus;
    if (n.p.down) status = 'down';
    else if (inRate < 0.05 && n.inflight === 0 && n.backlog.length === 0) status = 'idle';
    else if (heat >= 0.9 || (failRatio > 0.2 && n.kind !== 'ratelimiter') || (n.slotted && util > 0.97 && n.waiting.length > 0)) status = 'melting';
    else if (heat >= 0.75) status = 'hot';
    else if (heat >= 0.55) status = 'warm';
    else status = 'ok';
    return {
      id: n.spec.id,
      kind: n.kind,
      status,
      heat: n.p.down ? 0 : heat,
      util,
      busy: n.busy,
      capacity: n.slotted ? this.capacity(n) : 0,
      waiting: n.waiting.length,
      inRate,
      okRate,
      failRate,
      rejectRate,
      p50: pct(lat, 0.5),
      p99: pct(lat, 0.99),
      meanLatency: lat.length > 0 ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
      meanWait: waits > 0 ? this.sum(n.m.waitSum) / waits : null,
      wasted: work > 0 ? wasted / work : 0,
      instances: n.active,
      booting: n.booting,
      hitRate: n.kind === 'cache' && lookups > 0 ? this.sum(n.m.hits) / lookups : null,
      breaker: n.kind === 'breaker' ? n.breaker : null,
      tokens: n.kind === 'ratelimiter' ? n.tokens : null,
      backlog: n.backlog.length,
      lagMs,
      deadLetterRate: this.rate(n.m.deadLetters),
      spark: n.spark.slice(),
    };
  }

  private edgeSnap(e: REdge): EdgeSnap {
    return {
      id: e.spec.id,
      rate: this.rate(e.m.attempts),
      callRate: this.rate(e.m.calls),
      retryRate: this.rate(e.m.retries),
      failRate: this.rate(e.m.fails),
      timeoutRate: this.rate(e.m.timeouts),
      fallbackRate: this.rate(e.m.fallbacks),
    };
  }
}

function pct(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}
