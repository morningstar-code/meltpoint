// Plain-data description of a system. Everything here is JSON-serialisable so a
// design can be saved, shared in a URL and replayed deterministically.

export type NodeKind =
  | 'client'
  | 'lb'
  | 'service'
  | 'cache'
  | 'database'
  | 'queue'
  | 'worker'
  | 'ratelimiter'
  | 'breaker'
  | 'external';

export type LbStrategy = 'round-robin' | 'random' | 'least-busy';

export interface Autoscale {
  enabled: boolean;
  min: number;
  max: number;
  /** Utilisation the autoscaler aims for, 0..1. */
  target: number;
  /** How long a new instance takes before it can take traffic. */
  bootMs: number;
}

export interface NodeParams {
  /** Copies of this component that are running. */
  instances: number;
  /** Requests one instance can work on at the same time (threads, connections, slots). */
  concurrency: number;
  /** Mean time one request occupies a slot, in ms. */
  serviceMs: number;
  /** Coefficient of variation of the service time. 0 = constant, 1 = exponential. */
  cv: number;
  /** Requests allowed to wait for a slot before new ones are shed. */
  queueLimit: number;
  /** Keep the slot while waiting for downstream calls (thread-per-request, blocking I/O). */
  blocking: boolean;
  /** Drop work whose caller has already given up (deadline propagation). */
  deadlineAware: boolean;

  /** client: share of the offered load this client generates. */
  weight: number;
  /** cache: fraction of lookups answered without going downstream. */
  hitRate: number;
  /** lb: how the next target is picked. */
  strategy: LbStrategy;
  /** ratelimiter: tokens per second. */
  rate: number;
  /** ratelimiter: bucket size. */
  burst: number;
  /** breaker: failure ratio that opens the circuit. */
  errorThreshold: number;
  /** breaker: how long the circuit stays open before probing. */
  openMs: number;
  /** breaker: calls needed in the window before it may trip. */
  minRequests: number;
  /** queue: how many times a message is delivered before it is dead-lettered. */
  maxDeliveries: number;

  autoscale: Autoscale;

  // Chaos controls.
  down: boolean;
  /** Multiplies the service time. 1 = normal. */
  slowdown: number;
  /** Fraction of requests that fail after doing their work. */
  errorRate: number;
}

export type Backoff = 'none' | 'fixed' | 'exponential';

export interface EdgePolicy {
  /** How long the caller waits for an attempt. 0 = forever. */
  timeoutMs: number;
  /** Extra attempts after the first one fails. */
  retries: number;
  backoff: Backoff;
  /** Base delay before a retry, in ms. */
  backoffMs: number;
  /** Randomise backoff delays so retries do not arrive in waves. */
  jitter: boolean;
  /** Max retries as a fraction of calls over the last few seconds. 0 = unlimited. */
  retryBudget: number;
  /** Fraction of requests that make this call at all. */
  probability: number;
  /** One-way network latency, in ms. */
  latencyMs: number;
  /** A failed optional call is swallowed and the caller carries on without it (a fallback). */
  optional: boolean;
  /** Chaos: the link silently drops everything (a network partition). */
  cut: boolean;
}

export interface NodeSpec {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  params: NodeParams;
}

export interface EdgeSpec {
  id: string;
  from: string;
  to: string;
  policy: EdgePolicy;
}

export interface Topology {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
}

export type TrafficShape = 'steady' | 'wave' | 'spike' | 'ramp' | 'burst';

export interface Localized {
  en: string;
  es: string;
}

/** Why a request did not succeed. */
export type FailReason =
  | 'timeout'
  | 'shed'
  | 'error'
  | 'down'
  | 'rate_limited'
  | 'breaker_open'
  | 'deadline'
  | 'dead_letter';

export const FAIL_REASONS: FailReason[] = [
  'timeout',
  'shed',
  'error',
  'down',
  'rate_limited',
  'breaker_open',
  'deadline',
  'dead_letter',
];
