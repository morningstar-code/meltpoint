// Runs the meltpoint sweep off the main thread so the canvas keeps animating.
import { sweep } from './sweep';
import type { Topology } from './types';

interface Request {
  id: number;
  topology: Topology;
  seed: number;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, topology, seed } = e.data;
  const result = sweep(topology, seed, (done, point) => {
    self.postMessage({ type: 'progress', id, done, point });
  });
  self.postMessage({ type: 'done', id, result });
};
