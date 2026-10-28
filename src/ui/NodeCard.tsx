import type { CSSProperties } from 'react';
import type { NodeSnap } from '../sim/engine';
import { fmtCount, fmtMs, fmtPct, fmtRate } from '../sim/format';
import type { NodeSpec } from '../sim/types';
import { useI18n } from '../i18n';
import { KIND_ICON, Sparkline } from './controls';
import { heatColor } from './heat';

export const NODE_W = 224;
export const NODE_H = 132;

interface Props {
  spec: NodeSpec;
  snap: NodeSnap | undefined;
  selected: boolean;
  dragging: boolean;
  targetCount: number;
}

export function NodeCard({ spec, snap, selected, dragging, targetCount }: Props) {
  const { t } = useI18n();
  const Icon = KIND_ICON[spec.kind];
  const p = spec.params;
  const heat = snap?.heat ?? 0;
  const status = snap?.status ?? 'idle';
  const color = heatColor(heat);
  const glow = Math.max(0, heat - 0.5) * 2;
  const style = {
    '--heat': color,
    '--glow': heatColor(heat, 0.55),
    '--glow-size': `${Math.round(glow * 34)}px`,
    width: NODE_W,
    height: NODE_H,
  } as CSSProperties;

  const inRate = snap?.inRate ?? 0;
  const done = (snap?.okRate ?? 0) + (snap?.failRate ?? 0);
  const failRatio = done > 0 ? (snap?.failRate ?? 0) / done : 0;

  let primary = { value: `${fmtRate(inRate)}/s`, label: t('in') };
  let secondary = { value: fmtMs(snap?.p99), label: t('p99') };
  let bar = snap?.util ?? 0;
  let foot = '';
  let state: { text: string; tone: string } | null = null;

  switch (spec.kind) {
    case 'client':
      primary = { value: `${fmtRate(inRate)}/s`, label: t('sent') };
      bar = done > 0 ? 1 - failRatio : 0;
      foot = `${t('ok')} ${fmtRate(snap?.okRate ?? 0)}/s · ${fmtPct(failRatio)} ${t('fail')}`;
      break;
    case 'lb':
      bar = failRatio;
      foot = `→ ${targetCount} ${t('targets')} · ${t(`strategy_${p.strategy.replace('-', '_')}` as 'strategy_random')}`;
      break;
    case 'ratelimiter':
      bar = snap?.tokens !== null && snap?.tokens !== undefined ? snap.tokens / Math.max(1, p.burst) : 1;
      foot = `${t('limit')} ${fmtRate(p.rate)}/s · −${fmtRate(snap?.rejectRate ?? 0)}/s`;
      break;
    case 'breaker': {
      const b = snap?.breaker ?? 'closed';
      state = { text: t(b === 'half' ? 'half' : b), tone: b === 'closed' ? 'good' : b === 'open' ? 'bad' : 'warn' };
      bar = failRatio;
      foot = `${fmtPct(failRatio)} ${t('fail')} · ≥ ${fmtPct(p.errorThreshold)} → ${fmtMs(p.openMs)}`;
      break;
    }
    case 'queue':
      secondary = { value: fmtMs(snap?.lagMs ?? 0), label: t('lag') };
      bar = p.queueLimit > 0 ? (snap?.backlog ?? 0) / p.queueLimit : 0;
      foot = `${fmtCount(snap?.backlog ?? 0)} ${t('backlog')}${(snap?.deadLetterRate ?? 0) > 0 ? ` · DLQ ${fmtRate(snap?.deadLetterRate ?? 0)}/s` : ''}`;
      break;
    case 'cache':
      foot = `${fmtPct(bar)} ${t('busy')} · ${t('hit')} ${fmtPct(snap?.hitRate ?? p.hitRate)}`;
      break;
    default: {
      const inst = snap?.instances ?? p.instances;
      const boot = snap?.booting ?? 0;
      foot = `${fmtPct(bar)} ${t('busy')} · ${fmtCount(snap?.waiting ?? 0)} ${t('waiting')}`;
      if (inst > 1 || boot > 0) foot += ` · ${inst}${boot > 0 ? `+${boot}` : ''} ${t('inst')}`;
    }
  }

  const wasted = snap && snap.capacity > 0 && snap.wasted >= 0.05 ? snap.wasted : 0;
  const instances = snap?.instances ?? p.instances;

  return (
    <div
      className={`node kind-${spec.kind} status-${status} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${instances > 1 ? 'stacked' : ''}`}
      style={style}
    >
      <div className="node-head">
        <span className={`node-icon kind-${spec.kind}`}>
          <Icon size={15} strokeWidth={2} />
        </span>
        <span className="node-label" title={spec.label}>
          {spec.label}
        </span>
        <span className={`pill status-${status}`}>
          {t(spec.kind === 'client' && status === 'melting' ? 'status_failing' : (`status_${status}` as 'status_ok'))}
        </span>
      </div>
      <div className="node-main">
        <div className="metric">
          <span className="metric-value">{primary.value}</span>
          <span className="metric-label">{primary.label}</span>
        </div>
        {state ? (
          <div className={`breaker-state tone-${state.tone}`}>{state.text}</div>
        ) : (
          <div className="metric right">
            <span className="metric-value">{secondary.value}</span>
            <span className="metric-label">{secondary.label}</span>
          </div>
        )}
      </div>
      <div className={`heatbar ${spec.kind === 'client' ? 'ok-bar' : ''}`} aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }} />
      </div>
      <div className="node-foot">
        <span className="node-detail" title={foot}>
          {wasted > 0 ? (
            <b className="wasted">
              {fmtPct(wasted)} {t('wastedShort')} ·{' '}
            </b>
          ) : null}
          {foot}
        </span>
        <Sparkline values={snap?.spark ?? []} color={color} width={54} height={18} />
      </div>
      {spec.kind !== 'client' && <span className="port port-in" aria-hidden="true" />}
      <span className="port port-out" data-port={spec.id} aria-hidden="true" />
    </div>
  );
}
