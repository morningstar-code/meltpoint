// Seeded randomness so that the same seed and design always replay identically.

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(seed: number) {
    // splitmix32 to spread a small seed over the sfc32 state.
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i += 1) this.next();
  }

  /** Uniform in [0, 1). sfc32. */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** Uniform in (0, 1], safe for logarithms. */
  private open(): number {
    return 1 - this.next();
  }

  exponential(mean: number): number {
    return -Math.log(this.open()) * mean;
  }

  normal(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    const u = this.open();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** Gamma(shape, 1) by Marsaglia and Tsang. */
  private gammaUnit(shape: number): number {
    if (shape < 1) return this.gammaUnit(shape + 1) * Math.pow(this.open(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.open();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /**
   * A positive duration with the given mean and coefficient of variation, drawn from a
   * gamma distribution. cv = 0 is constant, cv = 1 is exponential, above 1 is heavy-tailed.
   */
  duration(mean: number, cv: number): number {
    if (mean <= 0) return 0;
    if (cv <= 0.001) return mean;
    const shape = 1 / (cv * cv);
    return this.gammaUnit(shape) * (mean / shape);
  }

  chance(p: number): boolean {
    return p > 0 && (p >= 1 || this.next() < p);
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
