// Designs travel as compressed JSON in the URL fragment, which browsers never send to a
// server, and are autosaved to this browser's storage.

import { paramsFor, DEFAULT_POLICY } from './sim/catalog';
import type { Topology, TrafficShape } from './sim/types';

export interface Design {
  v: 1;
  scenario: string | null;
  load: number;
  traffic: TrafficShape;
  topology: Topology;
}

const STORAGE_KEY = 'meltpoint:design';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeDesign(d: Design): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(d));
  if (typeof CompressionStream === 'undefined') return `j${toBase64Url(json)}`;
  return `z${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
}

export async function decodeDesign(s: string): Promise<Design | null> {
  try {
    const kind = s[0];
    const bytes = fromBase64Url(s.slice(1));
    const raw = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
    return normalize(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    return null;
  }
}

/** Fill in anything missing so older or hand-edited designs still load. */
export function normalize(input: unknown): Design | null {
  if (!input || typeof input !== 'object') return null;
  const d = input as Partial<Design>;
  const top = d.topology;
  if (!top || !Array.isArray(top.nodes) || !Array.isArray(top.edges)) return null;
  const nodes = top.nodes
    .filter((n) => n && typeof n.id === 'string' && typeof n.kind === 'string')
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      label: typeof n.label === 'string' ? n.label : n.id,
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      params: paramsFor(n.kind, n.params ?? {}),
    }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = top.edges
    .filter((e) => e && ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e) => ({ id: `${e.from}->${e.to}`, from: e.from, to: e.to, policy: { ...DEFAULT_POLICY, ...(e.policy ?? {}) } }));
  return {
    v: 1,
    scenario: typeof d.scenario === 'string' ? d.scenario : null,
    load: Number.isFinite(d.load) ? Math.max(0, Number(d.load)) : 50,
    traffic: (['steady', 'wave', 'spike', 'ramp', 'burst'] as const).includes(d.traffic as TrafficShape)
      ? (d.traffic as TrafficShape)
      : 'steady',
    topology: { nodes, edges },
  };
}

export function saveLocal(d: Design): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // Private windows and full storage are fine: the design just is not remembered.
  }
}

export function loadLocal(): Design | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function downloadDesign(d: Design, name: string): void {
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'design'}.meltpoint.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
