import type { EdgePolicy, EdgeSpec, Localized, NodeKind, NodeParams, NodeSpec } from './types';

export const BASE_PARAMS: NodeParams = {
  instances: 1,
  concurrency: 8,
  serviceMs: 20,
  cv: 0.5,
  queueLimit: 200,
  blocking: false,
  deadlineAware: false,
  weight: 1,
  hitRate: 0.9,
  strategy: 'round-robin',
  rate: 100,
  burst: 20,
  errorThreshold: 0.5,
  openMs: 5000,
  minRequests: 20,
  maxDeliveries: 3,
  autoscale: { enabled: false, min: 1, max: 10, target: 0.6, bootMs: 20000 },
  down: false,
  slowdown: 1,
  errorRate: 0,
};

export const DEFAULT_POLICY: EdgePolicy = {
  timeoutMs: 1000,
  retries: 0,
  backoff: 'exponential',
  backoffMs: 50,
  jitter: true,
  retryBudget: 0,
  probability: 1,
  latencyMs: 1,
  optional: false,
  cut: false,
};

export type ParamKey = Exclude<keyof NodeParams, 'autoscale'>;

export interface KindInfo {
  name: Localized;
  blurb: Localized;
  /** Inspector fields, in order. */
  fields: ParamKey[];
  autoscale: boolean;
  defaults: Partial<NodeParams>;
  /** Whether the node does work in slots (and so has utilisation). */
  slotted: boolean;
}

export const KINDS: Record<NodeKind, KindInfo> = {
  client: {
    name: { en: 'Client', es: 'Cliente' },
    blurb: {
      en: 'Users or callers. Sends the offered load into the system.',
      es: 'Usuarios o llamadores. Envía la carga ofrecida al sistema.',
    },
    fields: ['weight'],
    autoscale: false,
    slotted: false,
    defaults: {},
  },
  lb: {
    name: { en: 'Load Balancer', es: 'Balanceador' },
    blurb: {
      en: 'Spreads each request to one healthy target behind it.',
      es: 'Reparte cada petición a un destino sano detrás de él.',
    },
    fields: ['strategy'],
    autoscale: false,
    slotted: false,
    defaults: { serviceMs: 0 },
  },
  service: {
    name: { en: 'Service', es: 'Servicio' },
    blurb: {
      en: 'An application server. Does some work, then calls everything wired after it.',
      es: 'Un servidor de aplicación. Trabaja y luego llama a todo lo conectado después.',
    },
    fields: ['instances', 'concurrency', 'serviceMs', 'cv', 'queueLimit', 'blocking', 'deadlineAware'],
    autoscale: true,
    slotted: true,
    defaults: { concurrency: 16, serviceMs: 15, cv: 0.6, queueLimit: 200 },
  },
  cache: {
    name: { en: 'Cache', es: 'Caché' },
    blurb: {
      en: 'Answers hits itself. Misses fall through to whatever is wired after it.',
      es: 'Responde los aciertos. Los fallos pasan a lo que esté conectado después.',
    },
    fields: ['hitRate', 'instances', 'concurrency', 'serviceMs', 'queueLimit'],
    autoscale: false,
    slotted: true,
    defaults: { concurrency: 64, serviceMs: 1, cv: 0.3, queueLimit: 1000, hitRate: 0.9 },
  },
  database: {
    name: { en: 'Database', es: 'Base de datos' },
    blurb: {
      en: 'A finite pool of connections, each busy for the length of a query.',
      es: 'Un número finito de conexiones, cada una ocupada lo que dura una consulta.',
    },
    fields: ['instances', 'concurrency', 'serviceMs', 'cv', 'queueLimit', 'deadlineAware'],
    autoscale: false,
    slotted: true,
    defaults: { concurrency: 10, serviceMs: 50, cv: 0.6, queueLimit: 500 },
  },
  queue: {
    name: { en: 'Queue', es: 'Cola' },
    blurb: {
      en: 'Acknowledges at once and buffers messages for the workers wired after it.',
      es: 'Confirma al instante y guarda los mensajes para los workers conectados después.',
    },
    fields: ['queueLimit', 'maxDeliveries'],
    autoscale: false,
    slotted: false,
    defaults: { queueLimit: 10000, maxDeliveries: 3 },
  },
  worker: {
    name: { en: 'Worker', es: 'Worker' },
    blurb: {
      en: 'Pulls messages from a queue when it has a free slot.',
      es: 'Saca mensajes de una cola cuando tiene un hueco libre.',
    },
    fields: ['instances', 'concurrency', 'serviceMs', 'cv', 'queueLimit'],
    autoscale: true,
    slotted: true,
    defaults: { concurrency: 4, serviceMs: 100, cv: 0.5, queueLimit: 50 },
  },
  ratelimiter: {
    name: { en: 'Rate Limiter', es: 'Limitador' },
    blurb: {
      en: 'A token bucket. Over the rate, requests are refused straight away.',
      es: 'Un cubo de fichas. Por encima del ritmo, rechaza las peticiones al momento.',
    },
    fields: ['rate', 'burst'],
    autoscale: false,
    slotted: false,
    defaults: { rate: 100, burst: 20 },
  },
  breaker: {
    name: { en: 'Circuit Breaker', es: 'Cortacircuitos' },
    blurb: {
      en: 'Stops calling a dependency that keeps failing, then probes to see if it recovered.',
      es: 'Deja de llamar a una dependencia que falla y luego prueba si se ha recuperado.',
    },
    fields: ['errorThreshold', 'minRequests', 'openMs'],
    autoscale: false,
    slotted: false,
    defaults: {},
  },
  external: {
    name: { en: 'External API', es: 'API externa' },
    blurb: {
      en: 'A third party you do not control: slow, sometimes flaky.',
      es: 'Un tercero que no controlas: lento y a veces inestable.',
    },
    fields: ['concurrency', 'serviceMs', 'cv', 'queueLimit'],
    autoscale: false,
    slotted: true,
    defaults: { concurrency: 100, serviceMs: 120, cv: 0.8, queueLimit: 1000 },
  },
};

export const PALETTE_ORDER: NodeKind[] = [
  'client',
  'lb',
  'service',
  'cache',
  'database',
  'queue',
  'worker',
  'ratelimiter',
  'breaker',
  'external',
];

export function paramsFor(kind: NodeKind, overrides: Partial<NodeParams> = {}): NodeParams {
  const merged = { ...BASE_PARAMS, ...KINDS[kind].defaults, ...overrides };
  merged.autoscale = { ...BASE_PARAMS.autoscale, ...(overrides.autoscale ?? {}) };
  return merged;
}

export function makeNode(
  id: string,
  kind: NodeKind,
  label: string,
  x: number,
  y: number,
  overrides: Partial<NodeParams> = {},
): NodeSpec {
  return { id, kind, label, x, y, params: paramsFor(kind, overrides) };
}

export function makeEdge(from: string, to: string, policy: Partial<EdgePolicy> = {}): EdgeSpec {
  return { id: `${from}->${to}`, from, to, policy: { ...DEFAULT_POLICY, ...policy } };
}

/** Requests per second a slotted node can finish when nothing downstream holds it up. */
export function nominalCapacity(p: NodeParams): number {
  if (p.serviceMs <= 0) return Infinity;
  return (p.instances * p.concurrency * 1000) / (p.serviceMs * Math.max(1, p.slowdown));
}
