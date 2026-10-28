// The canvas speaks in temperature: idle parts are cold, saturated parts glow, melting
// parts run red hot.

const STOPS: [number, [number, number, number]][] = [
  [0, [70, 92, 128]],
  [0.35, [56, 182, 214]],
  [0.6, [236, 200, 72]],
  [0.75, [255, 154, 46]],
  [0.9, [255, 90, 43]],
  [1, [255, 45, 85]],
];

export function heatRgb(h: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, h));
  for (let i = 1; i < STOPS.length; i += 1) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function heatColor(h: number, alpha = 1): string {
  const [r, g, b] = heatRgb(h);
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}
