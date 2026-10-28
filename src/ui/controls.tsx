import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Activity, CircleGauge, Cog, Database, Globe, Inbox, Server, ShieldAlert, Split, Users, Zap } from 'lucide-react';
import type { NodeKind } from '../sim/types';

export const KIND_ICON: Record<NodeKind, typeof Users> = {
  client: Users,
  lb: Split,
  service: Server,
  cache: Zap,
  database: Database,
  queue: Inbox,
  worker: Cog,
  ratelimiter: CircleGauge,
  breaker: ShieldAlert,
  external: Globe,
};

export const FallbackIcon = Activity;

export function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Tip({ tip, children, side = 'bottom' }: { tip: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' }) {
  return (
    <span className={`tip tip-${side}`} data-tip={tip}>
      {children}
    </span>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Logarithmic slider, for values that span orders of magnitude. */
  log?: boolean;
  /** Show and edit as a percentage of 1. */
  percent?: boolean;
  help?: string;
  integer?: boolean;
}

export function NumberField({ label, value, onChange, min, max, step, unit, log, percent, help, integer }: NumberFieldProps) {
  const shown = percent ? value * 100 : value;
  const [text, setText] = useState(format(shown));
  useEffect(() => setText(format(shown)), [shown]);

  const toSlider = (v: number) => {
    if (!log) return v;
    const lo = Math.log(Math.max(min, 1e-3));
    return (Math.log(Math.max(v, Math.max(min, 1e-3))) - lo) / (Math.log(max) - lo);
  };
  const fromSlider = (s: number) => {
    if (!log) return s;
    const lo = Math.log(Math.max(min, 1e-3));
    return Math.exp(lo + s * (Math.log(max) - lo));
  };
  const clamp = (v: number) => {
    let x = Math.max(min, Math.min(max, v));
    if (integer) x = Math.round(x);
    else if (log) x = Number(x.toPrecision(x < 10 ? 2 : 3));
    return x;
  };
  const sMin = percent ? min * 100 : min;
  const sMax = percent ? max * 100 : max;

  return (
    <label className="field">
      <span className="field-head">
        <span className="field-label">{label}</span>
        <span className="field-value">
          <input
            className="num"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const n = parseFloat(text.replace(',', '.'));
              if (Number.isFinite(n)) onChange(clamp(percent ? n / 100 : n));
              else setText(format(shown));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          {unit && <span className="unit">{unit}</span>}
        </span>
      </span>
      <input
        type="range"
        style={{ '--fill': `${Math.max(0, Math.min(1, log ? toSlider(value) : (shown - sMin) / (sMax - sMin || 1))) * 100}%` } as CSSProperties}
        min={log ? 0 : sMin}
        max={log ? 1 : sMax}
        step={log ? 0.001 : (step ?? (integer ? 1 : (sMax - sMin) / 200))}
        value={log ? toSlider(value) : shown}
        onChange={(e) => {
          const raw = parseFloat(e.target.value);
          const v = log ? fromSlider(raw) : percent ? raw / 100 : raw;
          onChange(clamp(v));
        }}
      />
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

function format(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 100 || Number.isInteger(v)) return String(Math.round(v * 100) / 100);
  return String(Number(v.toPrecision(3)));
}

export function Toggle({ label, value, onChange, help, danger }: { label: string; value: boolean; onChange: (v: boolean) => void; help?: string; danger?: boolean }) {
  return (
    <label className={`toggle ${danger ? 'danger' : ''}`}>
      <span className="toggle-row">
        <span className="field-label">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          className={`switch ${value ? 'on' : ''}`}
          onClick={() => onChange(!value)}
        >
          <span />
        </button>
      </span>
      {help && <span className="field-help">{help}</span>}
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="field">
      <span className="field-head">
        <span className="field-label">{label}</span>
      </span>
      <div className="segmented">
        {options.map((o) => (
          <button key={o.value} type="button" className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </label>
  );
}

export function Sparkline({ values, color, height = 22, width = 80, max = 1 }: { values: number[]; color: string; height?: number; width?: number; max?: number }) {
  if (values.length < 2) return <svg width={width} height={height} className="spark" aria-hidden="true" />;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * width;
    const y = height - 1 - (Math.max(0, Math.min(max, v)) / max) * (height - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} className="spark" aria-hidden="true">
      <polygon points={`0,${height} ${pts.join(' ')} ${width},${height}`} fill={color} opacity="0.14" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
