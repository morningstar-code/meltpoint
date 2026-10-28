export function fmtRate(v: number): string {
  if (!Number.isFinite(v)) return '∞';
  if (v >= 9995) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 999.5) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 99.5) return v.toFixed(0);
  if (v >= 9.95) return v.toFixed(0);
  if (v >= 0.05) return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return '0';
}

export function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  if (v >= 60000) return `${(v / 60000).toFixed(1)}m`;
  if (v >= 9950) return `${(v / 1000).toFixed(0)}s`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}s`;
  if (v >= 10) return `${v.toFixed(0)}ms`;
  if (v >= 1) return `${v.toFixed(1)}ms`;
  return `${v.toFixed(2)}ms`;
}

export function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const p = v * 100;
  if (p > 0 && p < 0.1) return '<0.1%';
  if (p >= 99.95 && p < 100) return '99.9%';
  if (p < 10) return `${p.toFixed(1)}%`;
  return `${p.toFixed(0)}%`;
}

export function fmtCount(v: number): string {
  if (v >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(0);
}
