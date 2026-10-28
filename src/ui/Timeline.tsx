import { useMemo } from 'react';
import { HISTORY_LEN, type HistoryPoint, type Incident } from '../sim/engine';
import { fmtMs, fmtRate } from '../sim/format';
import type { Topology } from '../sim/types';
import { useI18n, type Key } from '../i18n';

const W = 1000;
const H = 100;
const SPAN_MS = HISTORY_LEN * 500;

interface Props {
  history: HistoryPoint[];
  incidents: Incident[];
  topology: Topology;
  now: number;
}

const BAD = new Set(['melt', 'collapse', 'breaker_open', 'dead_letter']);
const GOOD = new Set(['recover', 'restore', 'breaker_close', 'scale_ready']);

export function Timeline({ history, incidents, topology, now }: Props) {
  const { t } = useI18n();
  // A short run fills at least half the chart; a long one scrolls through two minutes.
  const end = Math.max(now, SPAN_MS / 2);
  const start = Math.max(0, end - SPAN_MS);
  const x = (tt: number) => ((tt - start) / (end - start)) * W;

  const { rateMax, latMax, paths } = useMemo(() => {
    let rateMax = 1;
    let latMax = 1;
    for (const h of history) {
      rateMax = Math.max(rateMax, h.target, h.offered, h.goodput, h.failRate);
      if (h.p99 !== null) latMax = Math.max(latMax, h.p99);
    }
    rateMax = niceCeil(rateMax * 1.1);
    latMax = niceCeil(latMax * 1.15);
    const yr = (v: number) => H - (v / rateMax) * (H - 4) - 2;
    const yl = (v: number) => H - (v / latMax) * (H - 4) - 2;
    const line = (pick: (h: HistoryPoint) => number | null, y: (v: number) => number) => {
      let d = '';
      let pen = false;
      for (const h of history) {
        const v = pick(h);
        if (v === null) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${x(h.t).toFixed(1)} ${y(v).toFixed(1)} `;
        pen = true;
      }
      return d;
    };
    const area = (pick: (h: HistoryPoint) => number) => {
      if (history.length < 2) return '';
      let d = `M${x(history[0].t).toFixed(1)} ${H} `;
      for (const h of history) d += `L${x(h.t).toFixed(1)} ${yr(pick(h)).toFixed(1)} `;
      d += `L${x(history[history.length - 1].t).toFixed(1)} ${H} Z`;
      return d;
    };
    return {
      rateMax,
      latMax,
      paths: {
        target: line((h) => h.target, yr),
        goodput: line((h) => h.goodput, yr),
        goodArea: area((h) => h.goodput),
        failArea: area((h) => h.failRate),
        p99: line((h) => h.p99, yl),
      },
    };
    // x() depends on start, which is listed below.
  }, [history, start]);

  const last = history[history.length - 1];
  const label = (id?: string) => topology.nodes.find((n) => n.id === id)?.label ?? '';
  const visible = incidents.filter((i) => i.t >= start);

  return (
    <div className="timeline">
      <div className="tl-head">
        <span className="tl-title">{t('timeline')}</span>
        <span className="legend">
          <i className="lg-target" /> {t('offered')} <b>{fmtRate(last?.target ?? 0)}/s</b>
        </span>
        <span className="legend">
          <i className="lg-good" /> {t('goodput')} <b>{fmtRate(last?.goodput ?? 0)}/s</b>
        </span>
        <span className="legend">
          <i className="lg-fail" /> {t('failed')} <b>{fmtRate(last?.failRate ?? 0)}/s</b>
        </span>
        <span className="legend">
          <i className="lg-p99" /> p99 <b>{fmtMs(last?.p99)}</b>
        </span>
      </div>
      <div className="tl-charts">
        <div className="tl-chart">
          <span className="axis-max">{fmtRate(rateMax)}/s</span>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={paths.goodArea} className="tl-good-area" />
            <path d={paths.failArea} className="tl-fail-area" />
            <path d={paths.target} className="tl-target" vectorEffect="non-scaling-stroke" />
            <path d={paths.goodput} className="tl-good" vectorEffect="non-scaling-stroke" />
            {visible.map((i, k) => (
              <line
                key={k}
                x1={x(i.t)}
                x2={x(i.t)}
                y1={0}
                y2={H}
                className={`tl-mark ${BAD.has(i.type) ? 'bad' : GOOD.has(i.type) ? 'good' : ''}`}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>
        <div className="tl-chart small">
          <span className="axis-max">{fmtMs(latMax)}</span>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={paths.p99} className="tl-p99" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="tl-marks">
          {visible.slice(-14).map((i, k) => (
            <span
              key={`${i.t}-${k}`}
              className={`tl-pin ${BAD.has(i.type) ? 'bad' : GOOD.has(i.type) ? 'good' : ''}`}
              style={{ left: `${(x(i.t) / W) * 100}%` }}
              data-tip={`${fmtTime(i.t)} · ${t(`inc_${i.type}` as Key, { n: label(i.node), v: i.value !== undefined ? Math.round(i.value) : '' })}`}
            />
          ))}
        </div>
      </div>
      <ol className="tl-log">
        {visible
          .slice(-4)
          .reverse()
          .map((i, k) => (
            <li key={`${i.t}-${k}`} className={BAD.has(i.type) ? 'bad' : GOOD.has(i.type) ? 'good' : ''}>
              <time>{fmtTime(i.t)}</time> {t(`inc_${i.type}` as Key, { n: label(i.node), v: i.value !== undefined ? Math.round(i.value) : '' })}
            </li>
          ))}
      </ol>
    </div>
  );
}

export function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
