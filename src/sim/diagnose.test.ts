import { expect, test } from 'vitest';
import { diagnose } from './diagnose';
import { Engine } from './engine';
import { scenarioById } from './scenarios';

function scenario(id: string) {
  const s = scenarioById(id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
}

test('a healthy system says so', () => {
  const sc = scenario('utilization-cliff');
  const e = new Engine(sc.topology, { seed: 1, load: 60 });
  e.advance(10000);
  expect(diagnose(sc.topology, e.snapshot()).map((x) => x.id)).toEqual(['healthy']);
});

test('a retry storm is explained as retries, waste and saturation, with a fix that works', () => {
  const sc = scenario('retry-storm');
  const e = new Engine(sc.topology, { seed: 42, load: 80, traffic: 'spike' });
  e.advance(40000);
  const findings = diagnose(sc.topology, e.snapshot());
  const ids = findings.map((x) => x.id);
  expect(ids[0]).toBe('collapse');
  expect(ids).toContain('retry:api->db');
  expect(ids).toContain('waste:db');
  expect(ids).toContain('sat:db');

  const fix = findings.find((x) => x.id === 'retry:api->db')?.fix;
  expect(fix).toBeDefined();
  const after = new Engine(fix!.apply(sc.topology), { seed: 42, load: 80, traffic: 'spike' });
  after.advance(48000);
  expect(after.snapshot().system.goodput).toBeGreaterThan(60);
});
