// Scenario designs name their parts in English. These pairs let a Spanish reader see
// Spanish names, and flip back, without touching names the user typed.

import type { Topology } from './sim/types';
import type { Lang } from './i18n';

const PAIRS: [string, string][] = [
  ['Users', 'Usuarios'],
  ['Shoppers', 'Compradores'],
  ['Database', 'Base de datos'],
  ['Orders DB', 'BD de pedidos'],
  ['Recommendations', 'Recomendaciones'],
  ['Cache', 'Caché'],
  ['Load Balancer', 'Balanceador'],
  ['Rate Limiter', 'Limitador'],
  ['Breaker', 'Cortacircuitos'],
  ['Payments', 'Pagos'],
  ['Jobs Queue', 'Cola de trabajos'],
  ['Email Queue', 'Cola de emails'],
  ['Email Workers', 'Workers de email'],
  ['Checkout API', 'API de checkout'],
  ['API Fleet', 'Flota de API'],
  ['Queue', 'Cola'],
  ['External API', 'API externa'],
  ['Service', 'Servicio'],
  ['Client', 'Cliente'],
];

const NUMBERED: [string, string][] = [
  ['Server', 'Servidor'],
  ['Database', 'Base de datos'],
  ['Service', 'Servicio'],
  ['Cache', 'Caché'],
  ['Queue', 'Cola'],
];

export function localizeLabel(label: string, lang: Lang): string {
  const from = lang === 'es' ? 0 : 1;
  const to = lang === 'es' ? 1 : 0;
  for (const pair of PAIRS) if (pair[from] === label) return pair[to];
  for (const pair of NUMBERED) {
    const m = label.match(new RegExp(`^${pair[from]} (\\d+)$`));
    if (m) return `${pair[to]} ${m[1]}`;
  }
  return label;
}

export function localizeTopology(t: Topology, lang: Lang): Topology {
  let changed = false;
  const nodes = t.nodes.map((n) => {
    const label = localizeLabel(n.label, lang);
    if (label === n.label) return n;
    changed = true;
    return { ...n, label };
  });
  return changed ? { ...t, nodes } : t;
}
