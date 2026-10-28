// Queueing theory to check the simulation against: Erlang C for M/M/c, with the
// Allen–Cunneen correction for service times that are not exponential.

/** Probability that an arrival has to wait, for c servers and offered load a = λ/μ. */
export function erlangC(c: number, a: number): number {
  if (c <= 0) return 1;
  const rho = a / c;
  if (rho >= 1) return 1;
  let b = 1;
  for (let k = 1; k <= c; k += 1) b = (a * b) / (k + a * b);
  return b / (1 - rho * (1 - b));
}

/**
 * Mean time spent waiting in the queue (ms) for c slots with mean service time s (ms),
 * arrival rate λ (per second) and service-time coefficient of variation cv.
 * Returns null when the queue is unstable.
 */
export function meanWaitMs(c: number, serviceMs: number, lambda: number, cv: number): number | null {
  if (c <= 0 || serviceMs <= 0) return null;
  const mu = 1000 / serviceMs;
  const a = lambda / mu;
  if (a / c >= 1) return null;
  const wq = erlangC(c, a) / (c * mu - lambda);
  return wq * ((1 + cv * cv) / 2) * 1000;
}
