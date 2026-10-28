import { useEffect, useRef, useState } from 'react';
import { Flame, RotateCcw, X } from 'lucide-react';
import { fmtMs, fmtPct, fmtRate } from '../sim/format';
import type { SweepPoint, SweepResult } from '../sim/sweep';
import type { Topology } from '../sim/types';
import { useI18n } from '../i18n';

interface Props {
  topology: Topology;
  load: number;
  title: string;
  onClose: () => void;
  onSetLoad: (load: number) => void;
}

const CW = 640;
const CH = 210;
const PAD = { l: 52, r: 16, t: 14, b: 30 };

export function MeltpointPanel({ topology, load, title, onClose, onSetLoad }: Props) {
  const { t } = useI18n();
  const [points, setPoints] = useState<SweepPoint[]>([]);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [run, setRun] = useState(0);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    setPoints([]);
    setResult(null);
    const worker = new Worker(new URL('../sim/sweep.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    const id = Date.now();
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; id: number; point?: SweepPoint; result?: SweepResult };
      if (msg.id !== id) return;
      if (msg.type === 'progress' && msg.point) setPoints((ps) => [...ps, msg.point as SweepPoint]);
      if (msg.type === 'done' && msg.result) setResult(msg.result);
    };
    worker.postMessage({ id, topology, seed: 42 });
    return () => worker.terminate();
    // Re-run only when asked: the panel measures the design as it was when opened.
  }, [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = [...(result?.points ?? points)].sort((a, b) => a.load - b.load);
  const label = (id: string | null) => topology.nodes.find((n) => n.id === id)?.label ?? '–';
  const melt = result?.meltLoad ?? null;
  const safe = result?.safeLoad ?? null;
  const share = melt ? load / melt : null;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal meltpoint" role="dialog" aria-modal="true" aria-labelledby="mp-title">
        <header className="modal-head">
          <Flame size={20} className="brand-flame" />
          <div>
            <h2 id="mp-title">
              {t('meltpointTitle')} · <span className="muted">{title}</span>
            </h2>
            <p className="muted small">{t('meltpointIntro')}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <X size={18} />
          </button>
        </header>

        {!result && (
          <div className="progress">
            <div className="progress-bar">
              <span style={{ width: `${Math.min(95, points.length * 4)}%` }} />
            </div>
            <span className="muted small">
              {t('measuring')} {points.length > 0 ? `${fmtRate(points[points.length - 1].load)}/s` : '…'} · {points.length} {t('pointsDone')}
            </span>
          </div>
        )}

        {result && (
          <div className="verdict">
            {result.unbroken ? (
              <div className="verdict-card wide">
                <span className="v-label">{t('noMelt', { n: fmtRate(shown[shown.length - 1]?.load ?? 0) })}</span>
                <span className="muted small">{t('unbrokenHint')}</span>
              </div>
            ) : (
              <>
                <div className="verdict-card good">
                  <span className="v-label">{t('safeUpTo')}</span>
                  <span className="v-value">{safe !== null ? `${fmtRate(safe)}/s` : '–'}</span>
                  <span className="v-note">{t('safeLegend')}</span>
                </div>
                <div className="verdict-card bad">
                  <span className="v-label">{t('meltsAt')}</span>
                  <span className="v-value">{melt !== null ? `${fmtRate(melt)}/s` : '–'}</span>
                  <span className="v-note">{t('meltLegend')}</span>
                </div>
                <div className="verdict-card">
                  <span className="v-label">{t('bottleneck')}</span>
                  <span className="v-value small">{label(result.bottleneck)}</span>
                  <span className="v-note">
                    {t('peak')} {fmtRate(result.peakGoodput)}/s
                  </span>
                </div>
                <div className={`verdict-card ${share !== null && share >= 1 ? 'bad' : share !== null && share > 0.8 ? 'warn' : ''}`}>
                  <span className="v-label">{t('youAreAt')}</span>
                  <span className="v-value">{share !== null ? fmtPct(share) : '–'}</span>
                  <span className="v-note">
                    {t('ofMeltpoint')}
                    {share !== null && share < 1 ? ` · ${(1 / share).toFixed(1)}× ${t('headroom')}` : ''}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        <Charts points={shown} safe={safe} melt={melt} load={load} />

        <footer className="modal-foot">
          <span className="muted small">{t('steadyNote')}</span>
          <span className="spacer" />
          {safe !== null && (
            <button type="button" className="btn" onClick={() => onSetLoad(Math.round(safe))}>
              {t('setLoadTo')} {fmtRate(safe)}/s
            </button>
          )}
          {melt !== null && (
            <button type="button" className="btn danger" onClick={() => onSetLoad(Math.round(melt))}>
              {t('setLoadTo')} {fmtRate(melt)}/s
            </button>
          )}
          <button type="button" className="btn" onClick={() => setRun((r) => r + 1)} disabled={!result}>
            <RotateCcw size={14} /> {t('rerun')}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Charts({ points, safe, melt, load }: { points: SweepPoint[]; safe: number | null; melt: number | null; load: number }) {
  const { t } = useI18n();
  if (points.length === 0) return <div className="charts-empty" />;
  const minL = Math.min(...points.map((p) => p.load), load) * 0.9;
  const maxL = Math.max(...points.map((p) => p.load), load) * 1.1;
  const lx = (v: number) => PAD.l + ((Math.log(v) - Math.log(minL)) / (Math.log(maxL) - Math.log(minL))) * (CW - PAD.l - PAD.r);
  const rateMax = Math.max(...points.map((p) => Math.max(p.load, p.goodput))) * 1.08;
  const ry = (v: number) => CH - PAD.b - (v / rateMax) * (CH - PAD.t - PAD.b);
  const lats = points.map((p) => p.p99).filter((v): v is number => v !== null && v > 0);
  const latMin = Math.max(0.1, Math.min(...lats, 1) * 0.8);
  const latMax = Math.max(...lats, 10) * 1.3;
  const ly = (v: number) => CH - PAD.b - ((Math.log(v) - Math.log(latMin)) / (Math.log(latMax) - Math.log(latMin))) * (CH - PAD.t - PAD.b);

  const ticks = logTicks(minL, maxL);
  const state = (p: SweepPoint) => (melt !== null && p.load >= melt ? 'bad' : safe !== null && p.load <= safe ? 'good' : 'warn');
  const goodPath = points.map((p, i) => `${i ? 'L' : 'M'}${lx(p.load).toFixed(1)} ${ry(p.goodput).toFixed(1)}`).join(' ');
  const latPts = points.filter((p) => p.p99 !== null && p.p99 > 0);
  const latPath = latPts.map((p, i) => `${i ? 'L' : 'M'}${lx(p.load).toFixed(1)} ${ly(p.p99 as number).toFixed(1)}`).join(' ');

  const markers = (
    <>
      {melt !== null && <rect x={lx(melt)} y={PAD.t} width={Math.max(0, CW - PAD.r - lx(melt))} height={CH - PAD.t - PAD.b} className="melt-zone" />}
      {safe !== null && <line x1={lx(safe)} x2={lx(safe)} y1={PAD.t} y2={CH - PAD.b} className="mk-safe" />}
      {melt !== null && <line x1={lx(melt)} x2={lx(melt)} y1={PAD.t} y2={CH - PAD.b} className="mk-melt" />}
      <line x1={lx(load)} x2={lx(load)} y1={PAD.t} y2={CH - PAD.b} className="mk-you" />
    </>
  );
  const axis = (
    <>
      <line x1={PAD.l} x2={CW - PAD.r} y1={CH - PAD.b} y2={CH - PAD.b} className="axis" />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={lx(v)} x2={lx(v)} y1={PAD.t} y2={CH - PAD.b} className="grid" />
          <text x={lx(v)} y={CH - PAD.b + 16} textAnchor="middle" className="tick">
            {fmtRate(v)}
          </text>
        </g>
      ))}
    </>
  );

  return (
    <div className="charts">
      <figure>
        <figcaption>
          <span>
            <i className="lg-good" /> {t('goodput')}
          </span>
          <span>
            <i className="lg-target" /> {t('offered')}
          </span>
          <span>
            <i className="lg-you" /> {t('youAreAt')} {fmtRate(load)}/s
          </span>
        </figcaption>
        <svg viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label={t('goodput')}>
          {markers}
          {axis}
          {[0.5, 1].map((f) => (
            <text key={f} x={PAD.l - 8} y={ry(rateMax * f) + 4} textAnchor="end" className="tick">
              {fmtRate(rateMax * f)}
            </text>
          ))}
          <line x1={lx(minL)} y1={ry(minL)} x2={lx(Math.min(maxL, rateMax))} y2={ry(Math.min(maxL, rateMax))} className="ideal" />
          <path d={goodPath} className="curve-good" />
          {points.map((p) => (
            <circle key={p.load} cx={lx(p.load)} cy={ry(p.goodput)} r={3.5} className={`pt ${state(p)}`}>
              <title>
                {`${fmtRate(p.load)}/s → ${fmtRate(p.goodput)}/s · ${fmtPct(p.errorRatio)} err · p99 ${fmtMs(p.p99)}`}
              </title>
            </circle>
          ))}
        </svg>
      </figure>
      <figure>
        <figcaption>
          <span>
            <i className="lg-p99" /> p99
          </span>
          <span>
            <i className="lg-fail" /> {t('errors')}
          </span>
          <span className="muted">{t('chartLoad')}</span>
        </figcaption>
        <svg viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label="p99">
          {markers}
          {axis}
          {points.map((p) => {
            const h = p.errorRatio * (CH - PAD.t - PAD.b);
            return h > 0.5 ? <rect key={p.load} x={lx(p.load) - 3} y={CH - PAD.b - h} width={6} height={h} className="err-bar" /> : null;
          })}
          {[latMin * 1.25, Math.sqrt(latMin * latMax), latMax / 1.3].map((v) => (
            <text key={v} x={PAD.l - 8} y={ly(v) + 4} textAnchor="end" className="tick">
              {fmtMs(v)}
            </text>
          ))}
          <path d={latPath} className="curve-p99" />
          {latPts.map((p) => (
            <circle key={p.load} cx={lx(p.load)} cy={ly(p.p99 as number)} r={3} className={`pt ${state(p)}`} />
          ))}
        </svg>
      </figure>
    </div>
  );
}

function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e += 1) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v >= min && v <= max) out.push(v);
    }
  }
  return out;
}
