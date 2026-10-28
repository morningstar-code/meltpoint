import { expect, test } from 'vitest';
import { localizeLabel, localizeTopology } from './labels';
import { SCENARIOS } from './sim/scenarios';
import { normalize, type Design } from './share';

test('designs survive a JSON round trip', () => {
  for (const sc of SCENARIOS) {
    const d: Design = { v: 1, scenario: sc.id, load: sc.load, traffic: sc.traffic, topology: sc.topology };
    expect(normalize(JSON.parse(JSON.stringify(d)))).toEqual(d);
  }
});

test('broken input is repaired or refused, never trusted', () => {
  expect(normalize(null)).toBeNull();
  expect(normalize({ topology: { nodes: 'x', edges: [] } })).toBeNull();
  const d = normalize({
    load: 'lots',
    traffic: 'tsunami',
    topology: {
      nodes: [
        { id: 'a', kind: 'client', x: 0, y: 0 },
        { id: 'b', kind: 'service', params: { concurrency: 4 } },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'ghost' },
        { from: 'b', to: 'b' },
      ],
    },
  });
  expect(d).not.toBeNull();
  expect(d?.load).toBe(50);
  expect(d?.traffic).toBe('steady');
  expect(d?.topology.edges.map((e) => e.id)).toEqual(['a->b']);
  expect(d?.topology.nodes[1].params.concurrency).toBe(4);
  expect(d?.topology.nodes[1].params.serviceMs).toBeGreaterThan(0);
});

test('scenario names translate both ways and leave custom names alone', () => {
  expect(localizeLabel('Database', 'es')).toBe('Base de datos');
  expect(localizeLabel('Base de datos', 'en')).toBe('Database');
  expect(localizeLabel('Server 3', 'es')).toBe('Servidor 3');
  expect(localizeLabel('Servidor 3', 'en')).toBe('Server 3');
  expect(localizeLabel('My shiny DB', 'es')).toBe('My shiny DB');
  for (const sc of SCENARIOS) {
    const there = localizeTopology(sc.topology, 'es');
    expect(localizeTopology(there, 'en')).toEqual(sc.topology);
  }
});
