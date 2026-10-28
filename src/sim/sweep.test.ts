import { expect, test } from 'vitest';
import { scenarioById } from './scenarios';
import { sweep } from './sweep';

function topology(id: string) {
  const s = scenarioById(id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s.topology;
}

test('the meltpoint of a single database sits just under its capacity', () => {
  const r = sweep(topology('utilization-cliff'), 42);
  // Two connections at 10 ms each: 200 queries a second.
  expect(r.meltLoad).not.toBeNull();
  expect(r.meltLoad as number).toBeGreaterThan(170);
  expect(r.meltLoad as number).toBeLessThan(215);
  expect(r.safeLoad as number).toBeLessThan(r.meltLoad as number);
  expect(r.bottleneck).toBe('db');
}, 60000);

test('a queue melts when consumers fall behind, even though users see success', () => {
  const r = sweep(topology('async-queue'), 42);
  expect(r.meltLoad as number).toBeGreaterThan(50);
  expect(r.meltLoad as number).toBeLessThan(110);
  expect(r.bottleneck).toBe('workers');
}, 60000);
