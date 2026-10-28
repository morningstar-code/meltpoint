import { makeEdge, makeNode } from './catalog';
import type { EdgePolicy, Localized, NodeParams, Topology, TrafficShape } from './types';

export type ExperimentKind = 'try' | 'break' | 'fix';

export interface Experiment {
  id: string;
  kind: ExperimentKind;
  label: Localized;
  load?: number;
  traffic?: TrafficShape;
  apply?: (t: Topology) => Topology;
}

export interface Scenario {
  id: string;
  title: Localized;
  tagline: Localized;
  lesson: Localized;
  load: number;
  traffic: TrafficShape;
  topology: Topology;
  experiments: Experiment[];
}

// ---------------------------------------------------------------------------------------
// Helpers that return a modified copy of a topology.

export function cloneTopology(t: Topology): Topology {
  return JSON.parse(JSON.stringify(t)) as Topology;
}

export function withNode(id: string, patch: Partial<NodeParams>) {
  return (t: Topology): Topology => {
    const next = cloneTopology(t);
    const n = next.nodes.find((x) => x.id === id);
    if (n) n.params = { ...n.params, ...patch, autoscale: { ...n.params.autoscale, ...(patch.autoscale ?? {}) } };
    return next;
  };
}

export function withEdge(id: string, patch: Partial<EdgePolicy>) {
  return (t: Topology): Topology => {
    const next = cloneTopology(t);
    const e = next.edges.find((x) => x.id === id);
    if (e) e.policy = { ...e.policy, ...patch };
    return next;
  };
}

function chain(...steps: ((t: Topology) => Topology)[]) {
  return (t: Topology): Topology => steps.reduce((acc, f) => f(acc), t);
}

/** Put a new node on an existing link: from -> node -> to. */
function insertOn(edgeId: string, node: ReturnType<typeof makeNode>, first: Partial<EdgePolicy>, second: Partial<EdgePolicy>) {
  return (t: Topology): Topology => {
    const next = cloneTopology(t);
    const e = next.edges.find((x) => x.id === edgeId);
    if (!e || next.nodes.some((n) => n.id === node.id)) return next;
    next.nodes.push(node);
    next.edges = next.edges.filter((x) => x.id !== edgeId);
    next.edges.push(makeEdge(e.from, node.id, { ...e.policy, ...first }));
    next.edges.push(makeEdge(node.id, e.to, { ...e.policy, ...second }));
    return next;
  };
}

// ---------------------------------------------------------------------------------------

const cliff: Scenario = {
  id: 'utilization-cliff',
  title: { en: 'The Utilization Cliff', es: 'El precipicio de la utilización' },
  tagline: {
    en: 'Latency does not grow with load. It grows with 1 / (1 − load).',
    es: 'La latencia no crece con la carga. Crece con 1 / (1 − carga).',
  },
  lesson: {
    en: 'This database finishes about 200 queries a second. At half of that, requests barely wait. Push it to 80% and the tail roughly doubles; at 95% it is several times worse and swings wildly from second to second, although the database is "only" 15% busier. Near capacity, random bursts have no idle time left to drain into, so the queue does a random walk with nothing pulling it back.',
    es: 'Esta base de datos termina unas 200 consultas por segundo. A la mitad, las peticiones apenas esperan. Llévala al 80% y la latencia de cola casi se duplica; al 95% es varias veces peor y oscila sin control de un segundo a otro, aunque la base de datos solo esté un 15% más ocupada. Cerca del límite, las ráfagas aleatorias ya no tienen tiempo libre para vaciarse, y la cola deambula sin nada que la frene.',
  },
  load: 100,
  traffic: 'steady',
  topology: {
    nodes: [
      makeNode('client', 'client', 'Users', 0, 0),
      makeNode('api', 'service', 'API', 330, 0, { concurrency: 64, serviceMs: 5 }),
      makeNode('db', 'database', 'Database', 660, 0, { concurrency: 2, serviceMs: 10, cv: 1, queueLimit: 2000 }),
    ],
    edges: [makeEdge('client', 'api', { timeoutMs: 10000 }), makeEdge('api', 'db', { timeoutMs: 8000 })],
  },
  experiments: [
    { id: 'l160', kind: 'try', label: { en: '160/s · 80% busy', es: '160/s · 80% ocupada' }, load: 160 },
    { id: 'l190', kind: 'try', label: { en: '190/s · 95% busy', es: '190/s · 95% ocupada' }, load: 190 },
    {
      id: 'index',
      kind: 'fix',
      label: { en: 'Add an index (2× faster queries)', es: 'Añadir un índice (consultas 2× más rápidas)' },
      apply: withNode('db', { serviceMs: 5 }),
    },
    {
      id: 'replica',
      kind: 'fix',
      label: { en: 'Second database instance', es: 'Segunda instancia de base de datos' },
      apply: withNode('db', { instances: 2 }),
    },
  ],
};

const retryStorm: Scenario = {
  id: 'retry-storm',
  title: { en: 'Retry Storm', es: 'Tormenta de reintentos' },
  tagline: {
    en: 'A five-second spike that the system never recovers from.',
    es: 'Un pico de cinco segundos del que el sistema nunca se recupera.',
  },
  lesson: {
    en: 'At 80/s the database is busy but fine. Fifteen seconds in, a five-second spike fills its queue. Waits pass the 250 ms timeout, the API retries three times, and 80 requests become 250 attempts. The spike ends; the storm does not. Most of the database\'s work is now for callers that already gave up. This is a metastable failure: the trigger is gone, the overload sustains itself.',
    es: 'A 80/s la base de datos está ocupada pero bien. A los quince segundos, un pico de cinco segundos llena su cola. Las esperas superan el timeout de 250 ms, la API reintenta tres veces y 80 peticiones se convierten en 250 intentos. El pico termina; la tormenta no. Casi todo el trabajo de la base de datos es ya para llamadores que se rindieron. Es un fallo metaestable: el detonante desaparece y la sobrecarga se alimenta sola.',
  },
  load: 80,
  traffic: 'spike',
  topology: {
    nodes: [
      makeNode('client', 'client', 'Users', 0, 0),
      makeNode('api', 'service', 'API', 330, 0, { concurrency: 64, serviceMs: 5 }),
      makeNode('db', 'database', 'Database', 660, 0, { concurrency: 5, serviceMs: 50, cv: 0.6, queueLimit: 100 }),
    ],
    edges: [
      makeEdge('client', 'api', { timeoutMs: 2000 }),
      makeEdge('api', 'db', { timeoutMs: 250, retries: 3, backoff: 'none', jitter: false }),
    ],
  },
  experiments: [
    {
      id: 'budget',
      kind: 'fix',
      label: { en: 'Retry budget (10%)', es: 'Presupuesto de reintentos (10%)' },
      apply: withEdge('api->db', { retryBudget: 0.1 }),
    },
    {
      id: 'deadline',
      kind: 'fix',
      label: { en: 'Deadline propagation', es: 'Propagar deadlines' },
      apply: withNode('db', { deadlineAware: true }),
    },
    {
      id: 'shed',
      kind: 'fix',
      label: { en: 'Short queue (shed early)', es: 'Cola corta (descartar pronto)' },
      apply: withNode('db', { queueLimit: 10 }),
    },
    {
      id: 'backoff',
      kind: 'try',
      label: { en: 'Backoff + jitter (enough?)', es: 'Backoff + jitter (¿basta?)' },
      apply: withEdge('api->db', { backoff: 'exponential', backoffMs: 100, jitter: true }),
    },
  ],
};

const slowDependency: Scenario = {
  id: 'slow-dependency',
  title: { en: 'One Slow Dependency', es: 'Una dependencia lenta' },
  tagline: {
    en: 'Recommendations get slow and the whole site goes down.',
    es: 'Las recomendaciones se vuelven lentas y se cae toda la web.',
  },
  lesson: {
    en: 'The API has 40 threads, and each request holds one until both of its calls return. When the recommendations service slows down, threads pile up waiting on it until none are left, and requests that never needed recommendations fail too. Slow is worse than down: a dead service fails fast, a slow one holds your resources hostage.',
    es: 'La API tiene 40 hilos y cada petición retiene uno hasta que vuelven sus dos llamadas. Cuando el servicio de recomendaciones se vuelve lento, los hilos se acumulan esperándolo hasta que no queda ninguno, y fallan incluso peticiones que no necesitaban recomendaciones. Lento es peor que caído: un servicio muerto falla rápido, uno lento secuestra tus recursos.',
  },
  load: 150,
  traffic: 'steady',
  topology: {
    nodes: [
      makeNode('client', 'client', 'Users', 0, 0),
      makeNode('api', 'service', 'API', 330, 0, { instances: 2, concurrency: 20, serviceMs: 5, blocking: true }),
      makeNode('db', 'database', 'Database', 680, -110, { concurrency: 20, serviceMs: 10 }),
      makeNode('recs', 'external', 'Recommendations', 680, 110, { serviceMs: 80, cv: 0.5, concurrency: 500 }),
    ],
    edges: [
      makeEdge('client', 'api', { timeoutMs: 3000 }),
      makeEdge('api', 'db', { timeoutMs: 1000 }),
      makeEdge('api', 'recs', { timeoutMs: 2000 }),
    ],
  },
  experiments: [
    {
      id: 'slow',
      kind: 'break',
      label: { en: 'Recommendations 20× slower', es: 'Recomendaciones 20× más lentas' },
      apply: withNode('recs', { slowdown: 20 }),
    },
    {
      id: 'timeout',
      kind: 'fix',
      label: { en: '200 ms timeout + fallback', es: 'Timeout de 200 ms + respaldo' },
      apply: withEdge('api->recs', { timeoutMs: 200, optional: true }),
    },
    {
      id: 'breaker',
      kind: 'fix',
      label: { en: 'Circuit breaker + fallback', es: 'Cortacircuitos + respaldo' },
      apply: insertOn(
        'api->recs',
        makeNode('breaker', 'breaker', 'Breaker', 680, 260, { errorThreshold: 0.5, minRequests: 20, openMs: 5000 }),
        { optional: true, timeoutMs: 2000 },
        { timeoutMs: 300 },
      ),
    },
  ],
};

const cache: Scenario = {
  id: 'cache-cliff',
  title: { en: 'The Cache Is Load-Bearing', es: 'La caché sostiene el edificio' },
  tagline: {
    en: 'A 90% hit rate means the database sees 10% of the traffic. Until it does not.',
    es: 'Un 90% de aciertos significa que la base de datos ve el 10% del tráfico. Hasta que no.',
  },
  lesson: {
    en: 'A thousand requests a second, and the database only sees the hundred the cache misses: half its capacity. Lose fifteen points of hit rate and it gets 250 a second, more than it can do. Restart the cache and it gets all thousand. The database was sized for the cache, not for the traffic, so the cache is now part of your capacity, not an optimisation.',
    es: 'Mil peticiones por segundo, y la base de datos solo ve las cien que la caché falla: la mitad de su capacidad. Pierde quince puntos de aciertos y le llegan 250 por segundo, más de lo que puede. Reinicia la caché y le llegan las mil. La base de datos se dimensionó para la caché, no para el tráfico: la caché ya es parte de tu capacidad, no una optimización.',
  },
  load: 1000,
  traffic: 'steady',
  topology: {
    nodes: [
      makeNode('client', 'client', 'Users', 0, 0),
      makeNode('api', 'service', 'API', 330, 0, { instances: 2, concurrency: 64, serviceMs: 5 }),
      makeNode('cache', 'cache', 'Cache', 660, 0, { hitRate: 0.9 }),
      makeNode('db', 'database', 'Database', 990, 0, { concurrency: 10, serviceMs: 50, queueLimit: 500 }),
    ],
    edges: [
      makeEdge('client', 'api', { timeoutMs: 3000 }),
      makeEdge('api', 'cache', { timeoutMs: 2000 }),
      makeEdge('cache', 'db', { timeoutMs: 1000 }),
    ],
  },
  experiments: [
    {
      id: 'hit75',
      kind: 'break',
      label: { en: 'Hit rate drops to 75%', es: 'Los aciertos bajan al 75%' },
      apply: withNode('cache', { hitRate: 0.75 }),
    },
    {
      id: 'cold',
      kind: 'break',
      label: { en: 'Cold cache after a restart', es: 'Caché fría tras un reinicio' },
      apply: withNode('cache', { hitRate: 0 }),
    },
    {
      id: 'replicas',
      kind: 'fix',
      label: { en: 'Add two read replicas', es: 'Añadir dos réplicas de lectura' },
      apply: withNode('db', { instances: 3 }),
    },
  ],
};

const fleet: Scenario = {
  id: 'fleet',
  title: { en: 'N + 1', es: 'N + 1' },
  tagline: {
    en: 'Three servers at 70% look like headroom. Lose one and find out.',
    es: 'Tres servidores al 70% parecen margen. Pierde uno y lo descubrirás.',
  },
  lesson: {
    en: 'Each server can do about 200 requests a second, and 420 arrive: 70% busy everywhere, which looks comfortable. Crash one and the other two need to do 210 each. Redundancy is only real if the survivors can carry the load, so size the fleet for the failure, not for the average.',
    es: 'Cada servidor puede con unas 200 peticiones por segundo y llegan 420: 70% de uso en todos, lo que parece cómodo. Tumba uno y los otros dos tienen que hacer 210 cada uno. La redundancia solo es real si los supervivientes pueden con la carga: dimensiona la flota para el fallo, no para la media.',
  },
  load: 420,
  traffic: 'steady',
  topology: {
    nodes: [
      makeNode('client', 'client', 'Users', 0, 0),
      makeNode('lb', 'lb', 'Load Balancer', 330, 0),
      makeNode('s1', 'service', 'Server 1', 660, -170, { concurrency: 8, serviceMs: 40, queueLimit: 100 }),
      makeNode('s2', 'service', 'Server 2', 660, 0, { concurrency: 8, serviceMs: 40, queueLimit: 100 }),
      makeNode('s3', 'service', 'Server 3', 660, 170, { concurrency: 8, serviceMs: 40, queueLimit: 100 }),
    ],
    edges: [
      makeEdge('client', 'lb', { timeoutMs: 2000 }),
      makeEdge('lb', 's1', { timeoutMs: 1500 }),
      makeEdge('lb', 's2', { timeoutMs: 1500 }),
      makeEdge('lb', 's3', { timeoutMs: 1500 }),
    ],
  },
  experiments: [
    {
      id: 'crash',
      kind: 'break',
      label: { en: 'Crash Server 2', es: 'Tumbar el Servidor 2' },
      apply: withNode('s2', { down: true }),
    },
    {
      id: 'fourth',
      kind: 'fix',
      label: { en: 'Add a fourth server', es: 'Añadir un cuarto servidor' },
      apply: (t) => {
        if (t.nodes.some((n) => n.id === 's4')) return t;
        const next = cloneTopology(t);
        next.nodes.push(makeNode('s4', 'service', 'Server 4', 660, 340, { concurrency: 8, serviceMs: 40, queueLimit: 100 }));
        next.edges.push(makeEdge('lb', 's4', { timeoutMs: 1500 }));
        return next;
      },
    },
    {
      id: 'least',
      kind: 'fix',
      label: { en: 'Least-busy balancing', es: 'Balanceo al menos ocupado' },
      apply: withNode('lb', { strategy: 'least-busy' }),
    },
  ],
};

const asyncQueue: Scenario = {
  id: 'async-queue',
  title: { en: 'Queues Absorb Bursts, Not Overload', es: 'Las colas absorben ráfagas, no sobrecarga' },
  tagline: {
    en: 'The backlog grows in every burst and drains in every lull. Until the average is too high.',
    es: 'El backlog crece en cada ráfaga y se vacía en cada calma. Hasta que la media es demasiado alta.',
  },
  lesson: {
    en: 'The API hands work to a queue and answers at once, so users never wait for the workers. Traffic comes in bursts above what the workers can do, and the backlog soaks them up and drains in between. A queue moves work in time; it does not create capacity. Push the average past what the workers can do and the backlog, and the age of the oldest message, grow without limit.',
    es: 'La API deja el trabajo en una cola y responde al momento, así que los usuarios nunca esperan a los workers. El tráfico llega en ráfagas por encima de lo que pueden los workers, y el backlog las absorbe y se vacía entre medias. Una cola mueve el trabajo en el tiempo; no crea capacidad. Sube la media por encima de lo que pueden los workers y el backlog, y la edad del mensaje más viejo, crecen sin límite.',
  },
  load: 50,
  traffic: 'burst',
  topology: {
    nodes: [
      makeNode('client', 'client', 'Users', 0, 0),
      makeNode('api', 'service', 'API', 330, 0, { concurrency: 64, serviceMs: 5 }),
      makeNode('queue', 'queue', 'Jobs Queue', 660, 0, { queueLimit: 20000 }),
      makeNode('workers', 'worker', 'Workers', 990, 0, { instances: 2, concurrency: 4, serviceMs: 100, blocking: true }),
      makeNode('db', 'database', 'Database', 1320, 0, { concurrency: 20, serviceMs: 20 }),
    ],
    edges: [
      makeEdge('client', 'api', { timeoutMs: 2000 }),
      makeEdge('api', 'queue', { timeoutMs: 1000 }),
      makeEdge('queue', 'workers', { timeoutMs: 30000 }),
      makeEdge('workers', 'db', { timeoutMs: 2000 }),
    ],
  },
  experiments: [
    { id: 'sustained', kind: 'try', label: { en: 'Sustained 90/s', es: '90/s sostenido' }, load: 90, traffic: 'steady' },
    {
      id: 'crash',
      kind: 'break',
      label: { en: 'Workers crash', es: 'Se caen los workers' },
      apply: withNode('workers', { down: true }),
    },
    {
      id: 'autoscale',
      kind: 'fix',
      label: { en: 'Autoscale workers 2 → 10', es: 'Autoescalar workers 2 → 10' },
      apply: withNode('workers', { autoscale: { enabled: true, min: 2, max: 10, target: 0.7, bootMs: 10000 } }),
    },
  ],
};

const limiter: Scenario = {
  id: 'rate-limiter',
  title: { en: 'Say No Early', es: 'Di que no pronto' },
  tagline: {
    en: 'A rate limiter serves a bit less, and what it serves stays fast.',
    es: 'Un limitador sirve algo menos, y lo que sirve sigue siendo rápido.',
  },
  lesson: {
    en: 'The database can do 200 a second, and the limiter in front lets 180 through. Double the traffic: the excess is refused in microseconds and everything admitted is still quick. Now remove the limiter at the same load. Everything is admitted, the queue fills, everyone waits seconds and most time out. Refusing some work is how you keep doing any work.',
    es: 'La base de datos puede con 200 por segundo y el limitador de delante deja pasar 180. Duplica el tráfico: el exceso se rechaza en microsegundos y todo lo admitido sigue siendo rápido. Ahora quita el limitador con la misma carga. Todo se admite, la cola se llena, todos esperan segundos y la mayoría agota el tiempo. Rechazar parte del trabajo es la forma de seguir haciendo algo.',
  },
  load: 150,
  traffic: 'steady',
  topology: {
    nodes: [
      makeNode('client', 'client', 'Users', 0, 0),
      makeNode('limiter', 'ratelimiter', 'Rate Limiter', 330, 0, { rate: 180, burst: 40 }),
      makeNode('api', 'service', 'API', 660, 0, { concurrency: 64, serviceMs: 5 }),
      makeNode('db', 'database', 'Database', 990, 0, { concurrency: 10, serviceMs: 50, queueLimit: 1000 }),
    ],
    edges: [
      makeEdge('client', 'limiter', { timeoutMs: 3000 }),
      makeEdge('limiter', 'api', { timeoutMs: 3000 }),
      makeEdge('api', 'db', { timeoutMs: 2000 }),
    ],
  },
  experiments: [
    { id: 'double', kind: 'try', label: { en: 'Double the traffic', es: 'Duplicar el tráfico' }, load: 300 },
    {
      id: 'remove',
      kind: 'break',
      label: { en: 'Remove the limiter (at 300/s)', es: 'Quitar el limitador (a 300/s)' },
      load: 300,
      apply: (t) => {
        const next = cloneTopology(t);
        if (!next.nodes.some((n) => n.id === 'limiter')) return next;
        next.nodes = next.nodes.filter((n) => n.id !== 'limiter');
        next.edges = next.edges.filter((e) => e.from !== 'limiter' && e.to !== 'limiter');
        next.edges.push(makeEdge('client', 'api', { timeoutMs: 3000 }));
        return next;
      },
    },
  ],
};

const autoscaling: Scenario = {
  id: 'autoscaling',
  title: { en: 'Autoscaling Is Too Slow for Spikes', es: 'El autoescalado es lento para los picos' },
  tagline: {
    en: 'New servers take 20 seconds to boot. The spike lasts five.',
    es: 'Los servidores nuevos tardan 20 segundos en arrancar. El pico dura cinco.',
  },
  lesson: {
    en: 'The autoscaler watches utilisation and adds servers when it climbs. But a server takes 20 seconds to be ready and the spike is over in five, so every request in the spike lands on the capacity you already had. The new servers arrive to an idle fleet and are removed again. Autoscaling follows trends; for spikes you need headroom, or capacity that boots in seconds.',
    es: 'El autoescalador vigila la utilización y añade servidores cuando sube. Pero un servidor tarda 20 segundos en estar listo y el pico termina en cinco, así que cada petición del pico cae sobre la capacidad que ya tenías. Los servidores nuevos llegan a una flota ociosa y se retiran otra vez. El autoescalado sigue tendencias; para los picos necesitas margen, o capacidad que arranque en segundos.',
  },
  load: 250,
  traffic: 'spike',
  topology: {
    nodes: [
      makeNode('client', 'client', 'Users', 0, 0),
      makeNode('lb', 'lb', 'Load Balancer', 330, 0),
      makeNode('api', 'service', 'API Fleet', 660, 0, {
        instances: 2,
        concurrency: 10,
        serviceMs: 50,
        queueLimit: 200,
        autoscale: { enabled: true, min: 2, max: 12, target: 0.6, bootMs: 20000 },
      }),
    ],
    edges: [makeEdge('client', 'lb', { timeoutMs: 2000 }), makeEdge('lb', 'api', { timeoutMs: 1500 })],
  },
  experiments: [
    {
      id: 'fastboot',
      kind: 'fix',
      label: { en: 'Boot in 3 s (pre-warmed)', es: 'Arrancar en 3 s (precalentado)' },
      apply: withNode('api', { autoscale: { enabled: true, min: 2, max: 12, target: 0.6, bootMs: 3000 } }),
    },
    {
      id: 'headroom',
      kind: 'fix',
      label: { en: 'Keep 4 warm (headroom)', es: 'Mantener 4 listos (margen)' },
      apply: withNode('api', { instances: 4, autoscale: { enabled: true, min: 4, max: 12, target: 0.6, bootMs: 20000 } }),
    },
    { id: 'ramp', kind: 'try', label: { en: 'Gradual ramp instead', es: 'Rampa gradual en su lugar' }, traffic: 'ramp', load: 800 },
  ],
};

const tail: Scenario = {
  id: 'tail-at-scale',
  title: { en: 'The Tail at Scale', es: 'La cola a escala' },
  tagline: {
    en: 'Wait for five backends and you get the slowest of five.',
    es: 'Espera a cinco backends y obtienes el más lento de los cinco.',
  },
  lesson: {
    en: 'Each request fans out to five backends in parallel and waits for all of them. A backend usually answers in about 3 ms but now and then takes far longer, and a request is only as fast as its slowest call, so the rare slow answer becomes the normal case: the API\'s median is around ten times a backend\'s, and its p99 is worse than any of theirs. If 1 call in 100 is slow, about 1 request in 20 is.',
    es: 'Cada petición se reparte a cinco backends en paralelo y espera a todos. Un backend suele responder en unos 3 ms pero de vez en cuando tarda mucho más, y una petición es tan rápida como su llamada más lenta, así que la respuesta lenta y rara se vuelve lo normal: la mediana de la API es unas diez veces la de un backend, y su p99 es peor que el de cualquiera de ellos. Si 1 llamada de cada 100 es lenta, lo es 1 petición de cada 20.',
  },
  load: 200,
  traffic: 'steady',
  topology: {
    nodes: [
      makeNode('client', 'client', 'Users', 0, 0),
      makeNode('api', 'service', 'API', 330, 0, { concurrency: 200, serviceMs: 2 }),
      ...[0, 1, 2, 3, 4].map((i) =>
        makeNode(`b${i + 1}`, 'service', `Backend ${i + 1}`, 700, (i - 2) * 150, { concurrency: 50, serviceMs: 10, cv: 2 }),
      ),
    ],
    edges: [
      makeEdge('client', 'api', { timeoutMs: 5000 }),
      ...[1, 2, 3, 4, 5].map((i) => makeEdge('api', `b${i}`, { timeoutMs: 4000 })),
    ],
  },
  experiments: [
    {
      id: 'one',
      kind: 'try',
      label: { en: 'Call only one backend', es: 'Llamar solo a un backend' },
      apply: chain(...[2, 3, 4, 5].map((i) => withEdge(`api->b${i}`, { probability: 0 }))),
    },
    {
      id: 'calm',
      kind: 'fix',
      label: { en: 'Tame the variance (cv 0.5)', es: 'Domar la varianza (cv 0,5)' },
      apply: chain(...[1, 2, 3, 4, 5].map((i) => withNode(`b${i}`, { cv: 0.5 }))),
    },
  ],
};

const checkout: Scenario = {
  id: 'checkout',
  title: { en: 'Checkout on Black Friday', es: 'Checkout en Black Friday' },
  tagline: {
    en: 'A realistic shop: limiter, fleet, cache, database, payments and an email queue.',
    es: 'Una tienda realista: limitador, flota, caché, base de datos, pagos y cola de emails.',
  },
  lesson: {
    en: 'Every pattern at once. A rate limiter guards the door, a fleet of API servers reads through a cache, payments go through a circuit breaker to a slow third party, and confirmation emails go through a queue so nobody waits for them. Triple the traffic or slow down the payment provider and follow the heat to see which part gives first.',
    es: 'Todos los patrones a la vez. Un limitador vigila la puerta, una flota de APIs lee a través de una caché, los pagos pasan por un cortacircuitos hacia un tercero lento, y los emails de confirmación van por una cola para que nadie los espere. Triplica el tráfico o ralentiza el proveedor de pagos y sigue el calor para ver qué cede primero.',
  },
  load: 300,
  traffic: 'wave',
  topology: {
    nodes: [
      makeNode('client', 'client', 'Shoppers', 0, 0),
      makeNode('limiter', 'ratelimiter', 'Rate Limiter', 300, 0, { rate: 700, burst: 150 }),
      makeNode('lb', 'lb', 'Load Balancer', 600, 0),
      makeNode('api', 'service', 'Checkout API', 900, 0, { instances: 3, concurrency: 32, serviceMs: 8, blocking: true }),
      makeNode('cache', 'cache', 'Cache', 1240, -230, { hitRate: 0.85 }),
      makeNode('db', 'database', 'Orders DB', 1560, -230, { concurrency: 20, serviceMs: 30, queueLimit: 400 }),
      makeNode('breaker', 'breaker', 'Breaker', 1240, 0, { errorThreshold: 0.5, minRequests: 20, openMs: 5000 }),
      makeNode('pay', 'external', 'Payments', 1560, 0, { serviceMs: 250, cv: 0.6, concurrency: 300 }),
      makeNode('queue', 'queue', 'Email Queue', 1240, 230, { queueLimit: 20000 }),
      makeNode('mail', 'worker', 'Email Workers', 1560, 230, { instances: 2, concurrency: 4, serviceMs: 80, blocking: true }),
    ],
    edges: [
      makeEdge('client', 'limiter', { timeoutMs: 5000 }),
      makeEdge('limiter', 'lb', { timeoutMs: 5000 }),
      makeEdge('lb', 'api', { timeoutMs: 4000 }),
      makeEdge('api', 'cache', { timeoutMs: 1000 }),
      makeEdge('cache', 'db', { timeoutMs: 1000, retries: 1 }),
      makeEdge('api', 'breaker', { timeoutMs: 3000, probability: 0.2 }),
      makeEdge('breaker', 'pay', { timeoutMs: 1500 }),
      makeEdge('api', 'queue', { timeoutMs: 1000, probability: 0.2 }),
      makeEdge('queue', 'mail', { timeoutMs: 30000 }),
    ],
  },
  experiments: [
    { id: 'friday', kind: 'try', label: { en: 'Black Friday: 3× traffic', es: 'Black Friday: tráfico ×3' }, load: 900 },
    {
      id: 'payslow',
      kind: 'break',
      label: { en: 'Payment provider 8× slower', es: 'Proveedor de pagos 8× más lento' },
      apply: withNode('pay', { slowdown: 8 }),
    },
    {
      id: 'mail',
      kind: 'fix',
      label: { en: 'Autoscale email workers 2 → 10', es: 'Autoescalar workers de email 2 → 10' },
      apply: withNode('mail', { autoscale: { enabled: true, min: 2, max: 10, target: 0.7, bootMs: 10000 } }),
    },
    {
      id: 'limit',
      kind: 'try',
      label: { en: 'Raise the limit to 1,200/s', es: 'Subir el límite a 1.200/s' },
      apply: withNode('limiter', { rate: 1200, burst: 200 }),
    },
  ],
};

const blank: Scenario = {
  id: 'blank',
  title: { en: 'Blank Canvas', es: 'Lienzo en blanco' },
  tagline: { en: 'Build your own system and find its melting point.', es: 'Construye tu propio sistema y encuentra su punto de fusión.' },
  lesson: {
    en: 'Drag components from the left, connect them by dragging from the dot on a card\'s right edge to another card, and select anything to tune it. Then press "Find meltpoint" to see the load at which your design breaks.',
    es: 'Arrastra componentes desde la izquierda, conéctalos arrastrando desde el punto del borde derecho de una tarjeta hasta otra, y selecciona cualquier cosa para ajustarla. Después pulsa "Buscar punto de fusión" para ver con qué carga se rompe tu diseño.',
  },
  load: 50,
  traffic: 'steady',
  topology: {
    nodes: [makeNode('client', 'client', 'Users', 0, 0), makeNode('api', 'service', 'API', 330, 0)],
    edges: [makeEdge('client', 'api', { timeoutMs: 2000 })],
  },
  experiments: [],
};

export const SCENARIOS: Scenario[] = [
  cliff,
  retryStorm,
  slowDependency,
  cache,
  fleet,
  asyncQueue,
  limiter,
  autoscaling,
  tail,
  checkout,
  blank,
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
