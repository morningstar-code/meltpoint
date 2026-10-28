// Plain-language reading of a snapshot: what is breaking, why, and a one-click change to try.

import { nominalCapacity } from './catalog';
import type { Snapshot } from './engine';
import { fmtCount, fmtMs, fmtPct, fmtRate } from './format';
import { withEdge, withNode } from './scenarios';
import type { Localized, Topology } from './types';

export type Severity = 'critical' | 'warn' | 'info' | 'good';

export interface Finding {
  id: string;
  severity: Severity;
  node?: string;
  edge?: string;
  title: Localized;
  detail: Localized;
  fix?: { label: Localized; apply: (t: Topology) => Topology };
}

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2, good: 3 };

export function diagnose(top: Topology, snap: Snapshot): Finding[] {
  const out: Finding[] = [];
  const sys = snap.system;
  const label = (id: string) => top.nodes.find((n) => n.id === id)?.label ?? id;

  if (sys.offered > 1 && sys.goodput < sys.offered * 0.5) {
    out.push({
      id: 'collapse',
      severity: 'critical',
      title: {
        en: `Meltdown: only ${fmtRate(sys.goodput)} of ${fmtRate(sys.offered)} requests/s succeed`,
        es: `Fusión: solo ${fmtRate(sys.goodput)} de ${fmtRate(sys.offered)} peticiones/s tienen éxito`,
      },
      detail: {
        en: `${fmtPct(sys.errorRatio)} of requests fail. Follow the hottest component below.`,
        es: `Falla el ${fmtPct(sys.errorRatio)} de las peticiones. Sigue el componente más caliente.`,
      },
    });
  }

  for (const spec of top.nodes) {
    const n = snap.nodes[spec.id];
    if (!n) continue;
    const p = spec.params;
    const name = spec.label;

    if (p.down) {
      out.push({
        id: `down:${spec.id}`,
        severity: 'critical',
        node: spec.id,
        title: { en: `${name} is down`, es: `${name}: fuera de servicio` },
        detail: {
          en: 'Everything that depends on it fails, unless a load balancer routes around it.',
          es: 'Todo lo que depende de él falla, salvo que un balanceador lo esquive.',
        },
        fix: { label: { en: 'Restart it', es: 'Reiniciarlo' }, apply: withNode(spec.id, { down: false }) },
      });
      continue;
    }
    if (p.slowdown > 1) {
      out.push({
        id: `slow:${spec.id}`,
        severity: 'warn',
        node: spec.id,
        title: { en: `${name} is ${p.slowdown}× slower than normal`, es: `${name}: va ${p.slowdown}× más despacio de lo normal` },
        detail: { en: 'Injected with the chaos controls.', es: 'Inyectado con los controles de caos.' },
        fix: { label: { en: 'Back to normal speed', es: 'Volver a la velocidad normal' }, apply: withNode(spec.id, { slowdown: 1 }) },
      });
    }
    if (p.errorRate > 0) {
      out.push({
        id: `err:${spec.id}`,
        severity: 'warn',
        node: spec.id,
        title: { en: `${name} fails ${fmtPct(p.errorRate)} of requests`, es: `${name} falla el ${fmtPct(p.errorRate)} de las peticiones` },
        detail: { en: 'Injected with the chaos controls.', es: 'Inyectado con los controles de caos.' },
        fix: { label: { en: 'Stop the errors', es: 'Quitar los errores' }, apply: withNode(spec.id, { errorRate: 0 }) },
      });
    }

    if (n.capacity > 0 && (n.util >= 0.9 || (n.util >= 0.8 && n.waiting > 0))) {
      const cap = nominalCapacity({ ...p, instances: n.instances });
      const blockingNote =
        p.blocking && n.meanLatency !== null && n.meanLatency > p.serviceMs * p.slowdown * 3
          ? {
              en: ' Its slots are held while it waits on downstream calls, so they are busy waiting, not working.',
              es: ' Sus hilos siguen ocupados mientras espera llamadas a otros servicios: están ocupados esperando, no trabajando.',
            }
          : { en: '', es: '' };
      out.push({
        id: `sat:${spec.id}`,
        severity: n.util >= 0.97 && n.waiting > 0 ? 'critical' : 'warn',
        node: spec.id,
        title: {
          en: `${name} is saturated: ${fmtPct(n.util)} busy, ${fmtCount(n.waiting)} waiting`,
          es: `${name}: saturación al ${fmtPct(n.util)}, ${fmtCount(n.waiting)} en espera`,
        },
        detail: {
          en: `${fmtRate(n.inRate)}/s arrive and it can finish about ${fmtRate(cap)}/s.${blockingNote.en}`,
          es: `Llegan ${fmtRate(n.inRate)}/s y puede terminar unas ${fmtRate(cap)}/s.${blockingNote.es}`,
        },
        fix: p.blocking
          ? { label: { en: 'Switch to async I/O', es: 'Pasar a E/S asíncrona' }, apply: withNode(spec.id, { blocking: false }) }
          : {
              label: { en: `Add an instance (${n.instances} → ${n.instances + 1})`, es: `Añadir instancia (${n.instances} → ${n.instances + 1})` },
              apply: withNode(spec.id, { instances: n.instances + 1 }),
            },
      });
    }

    if (n.capacity > 0 && n.wasted >= 0.3 && !p.deadlineAware) {
      out.push({
        id: `waste:${spec.id}`,
        severity: 'critical',
        node: spec.id,
        title: {
          en: `${fmtPct(n.wasted)} of ${name}'s work is for requests nobody is waiting for`,
          es: `El ${fmtPct(n.wasted)} del trabajo de ${name} es para peticiones que nadie espera ya`,
        },
        detail: {
          en: 'Callers timed out, but the work carries on and keeps the slots busy. Dropping expired work frees them.',
          es: 'Los llamadores agotaron el tiempo, pero el trabajo sigue y ocupa los huecos. Descartar lo caducado los libera.',
        },
        fix: { label: { en: 'Propagate deadlines', es: 'Propagar deadlines' }, apply: withNode(spec.id, { deadlineAware: true }) },
      });
    }

    const incoming = top.edges.filter((e) => e.to === spec.id && e.policy.timeoutMs > 0);
    const shortest = incoming.length ? Math.min(...incoming.map((e) => e.policy.timeoutMs)) : 0;
    if (n.capacity > 0 && shortest > 0 && n.meanWait !== null && n.meanWait > shortest * 0.8 && n.waiting > 0) {
      const cap = nominalCapacity({ ...p, instances: n.instances });
      const limit = Math.max(1, Math.round((cap * shortest) / 2000));
      out.push({
        id: `wait:${spec.id}`,
        severity: 'warn',
        node: spec.id,
        title: {
          en: `Requests wait ${fmtMs(n.meanWait)} in ${name}'s queue; callers give up after ${fmtMs(shortest)}`,
          es: `Las peticiones esperan ${fmtMs(n.meanWait)} en la cola de ${name}; los llamadores se rinden a los ${fmtMs(shortest)}`,
        },
        detail: {
          en: 'A queue longer than the timeout only stores requests that are already lost. Shed early instead.',
          es: 'Una cola más larga que el timeout solo almacena peticiones ya perdidas. Mejor descartar pronto.',
        },
        fix: {
          label: { en: `Cap the queue at ${limit}`, es: `Limitar la cola a ${limit}` },
          apply: withNode(spec.id, { queueLimit: limit }),
        },
      });
    }

    if (n.capacity > 0 && n.rejectRate > 0.5 && n.waiting >= p.queueLimit * 0.9) {
      out.push({
        id: `shed:${spec.id}`,
        severity: 'warn',
        node: spec.id,
        title: { en: `${name} is shedding ${fmtRate(n.rejectRate)}/s`, es: `${name} descarta ${fmtRate(n.rejectRate)}/s` },
        detail: {
          en: 'Its queue is full, so new requests are refused at the door.',
          es: 'Su cola está llena, así que las peticiones nuevas se rechazan en la puerta.',
        },
      });
    }

    if (spec.kind === 'breaker' && n.breaker && n.breaker !== 'closed') {
      const target = top.edges.find((e) => e.from === spec.id);
      out.push({
        id: `breaker:${spec.id}`,
        severity: 'info',
        node: spec.id,
        title: {
          en: n.breaker === 'open' ? `${name} is open: failing fast` : `${name} is half-open: probing`,
          es: n.breaker === 'open' ? `${name}: circuito abierto, falla rápido` : `${name}: circuito medio abierto, probando`,
        },
        detail: {
          en: `It stopped calling ${target ? label(target.to) : 'its dependency'} so callers are not held up waiting on it.`,
          es: `Dejó de llamar a ${target ? label(target.to) : 'su dependencia'} para que nadie se quede esperándola.`,
        },
      });
    }

    if (spec.kind === 'ratelimiter' && n.rejectRate > 0.5) {
      out.push({
        id: `limit:${spec.id}`,
        severity: 'info',
        node: spec.id,
        title: { en: `${name} turns away ${fmtRate(n.rejectRate)}/s`, es: `${name} rechaza ${fmtRate(n.rejectRate)}/s` },
        detail: {
          en: 'By design: everything it admits stays fast.',
          es: 'A propósito: todo lo que admite sigue siendo rápido.',
        },
      });
    }

    if (spec.kind === 'queue' && n.lagMs > 5000) {
      const worker = top.edges.find((e) => e.from === spec.id);
      const w = worker ? top.nodes.find((x) => x.id === worker.to) : undefined;
      out.push({
        id: `lag:${spec.id}`,
        severity: n.lagMs > 30000 ? 'critical' : 'warn',
        node: spec.id,
        title: {
          en: `${name} is ${fmtMs(n.lagMs)} behind with ${fmtCount(n.backlog)} messages waiting`,
          es: `${name} va ${fmtMs(n.lagMs)} con retraso y ${fmtCount(n.backlog)} mensajes esperando`,
        },
        detail: {
          en: 'Consumers are not keeping up. A queue moves work later; it does not make it smaller.',
          es: 'Los consumidores no dan abasto. Una cola retrasa el trabajo; no lo reduce.',
        },
        fix:
          w && !w.params.autoscale.enabled
            ? {
                label: { en: `Autoscale ${w.label}`, es: `Autoescalar ${w.label}` },
                apply: withNode(w.id, {
                  autoscale: { enabled: true, min: w.params.instances, max: Math.max(10, w.params.instances * 4), target: 0.7, bootMs: 10000 },
                }),
              }
            : undefined,
      });
    }

    if (n.booting > 0) {
      out.push({
        id: `boot:${spec.id}`,
        severity: 'info',
        node: spec.id,
        title: { en: `Autoscaler is booting ${n.booting} more ${name}`, es: `El autoescalador arranca ${n.booting} ${name} más` },
        detail: {
          en: `They take ${fmtMs(p.autoscale.bootMs)} before they can help.`,
          es: `Tardan ${fmtMs(p.autoscale.bootMs)} en poder ayudar.`,
        },
      });
    }
  }

  for (const spec of top.edges) {
    const e = snap.edges[spec.id];
    if (!e) continue;
    const from = label(spec.from);
    const to = label(spec.to);
    if (spec.policy.cut) {
      out.push({
        id: `cut:${spec.id}`,
        severity: 'critical',
        edge: spec.id,
        title: { en: `The link ${from} → ${to} is cut`, es: `El enlace ${from} → ${to} está cortado` },
        detail: {
          en: 'Calls vanish and every caller waits for its full timeout.',
          es: 'Las llamadas desaparecen y cada llamador espera su timeout completo.',
        },
        fix: { label: { en: 'Reconnect', es: 'Reconectar' }, apply: withEdge(spec.id, { cut: false }) },
      });
    }
    if (e.callRate > 1 && e.retryRate > e.callRate * 0.3) {
      const amp = e.rate / e.callRate;
      out.push({
        id: `retry:${spec.id}`,
        severity: amp > 1.8 ? 'critical' : 'warn',
        edge: spec.id,
        title: {
          en: `Retries multiply traffic to ${to} by ×${amp.toFixed(1)}`,
          es: `Los reintentos multiplican el tráfico a ${to} por ×${amp.toFixed(1)}`,
        },
        detail: {
          en: `${fmtRate(e.callRate)} calls/s become ${fmtRate(e.rate)} attempts/s, landing on the part that is already struggling.`,
          es: `${fmtRate(e.callRate)} llamadas/s se convierten en ${fmtRate(e.rate)} intentos/s, justo sobre la parte que ya sufre.`,
        },
        fix: {
          label: { en: 'Retry budget 10% + backoff', es: 'Presupuesto 10% + backoff' },
          apply: withEdge(spec.id, { retryBudget: 0.1, backoff: 'exponential', jitter: true, backoffMs: Math.max(50, spec.policy.backoffMs) }),
        },
      });
    }
    if (e.fallbackRate > 0.5) {
      out.push({
        id: `fallback:${spec.id}`,
        severity: 'info',
        edge: spec.id,
        title: {
          en: `${from} serves ${fmtRate(e.fallbackRate)}/s without ${to}`,
          es: `${from} sirve ${fmtRate(e.fallbackRate)}/s sin ${to}`,
        },
        detail: {
          en: 'The call is optional, so its failures degrade the answer instead of failing it.',
          es: 'La llamada es opcional, así que sus fallos empobrecen la respuesta en vez de romperla.',
        },
      });
    }
  }

  if (!out.some((f) => f.severity === 'critical' || f.severity === 'warn')) {
    let busiest: string | null = null;
    let util = 0;
    for (const spec of top.nodes) {
      const n = snap.nodes[spec.id];
      if (n && n.capacity > 0 && n.util > util) {
        util = n.util;
        busiest = spec.id;
      }
    }
    out.push({
      id: 'healthy',
      severity: 'good',
      node: busiest ?? undefined,
      title: { en: 'Holding up', es: 'Aguantando' },
      detail: busiest
        ? {
            en: `The busiest part is ${label(busiest)} at ${fmtPct(util)}. Raise the load, or find the meltpoint to see how far it goes.`,
            es: `La parte más ocupada es ${label(busiest)} al ${fmtPct(util)}. Sube la carga, o busca el punto de fusión para ver hasta dónde llega.`,
          }
        : {
            en: 'Raise the load, or find the meltpoint to see how far it goes.',
            es: 'Sube la carga, o busca el punto de fusión para ver hasta dónde llega.',
          },
    });
  }

  out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return out.slice(0, 7);
}
