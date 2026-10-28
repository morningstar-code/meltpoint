import { CircleCheck, Info, OctagonAlert, TriangleAlert, Wrench } from 'lucide-react';
import type { Finding, Severity } from '../sim/diagnose';
import type { Snapshot } from '../sim/engine';
import { fmtMs, fmtPct, fmtRate } from '../sim/format';
import { FAIL_REASONS } from '../sim/types';
import { useI18n, type Key } from '../i18n';
import type { Selection } from './Canvas';

const ICON: Record<Severity, typeof Info> = {
  critical: OctagonAlert,
  warn: TriangleAlert,
  info: Info,
  good: CircleCheck,
};

const REASON_COLOR: Record<string, string> = {
  timeout: 'var(--melt)',
  shed: 'var(--hot)',
  error: '#e879f9',
  down: '#94a3b8',
  rate_limited: 'var(--warm)',
  breaker_open: '#60a5fa',
  deadline: '#2dd4bf',
  dead_letter: '#a78bfa',
};

interface Props {
  findings: Finding[];
  snap: Snapshot | null;
  onApply: (f: Finding) => void;
  onFocus: (s: Selection) => void;
}

export function Insights({ findings, snap, onApply, onFocus }: Props) {
  const { t, l } = useI18n();
  const sys = snap?.system;
  const totalFail = sys ? FAIL_REASONS.reduce((s, r) => s + sys.byReason[r], 0) : 0;
  return (
    <div className="insights">
      <h2 className="panel-title">{t('insights')}</h2>
      {!sys && <p className="muted">{t('insightsIdle')}</p>}
      <ul className="findings">
        {findings.map((f) => {
          const Icon = ICON[f.severity];
          const target: Selection | null = f.node ? { type: 'node', id: f.node } : f.edge ? { type: 'edge', id: f.edge } : null;
          return (
            <li key={f.id} className={`finding sev-${f.severity}`}>
              <button type="button" className="finding-body" onClick={() => target && onFocus(target)} disabled={!target}>
                <Icon size={16} className="finding-icon" />
                <span>
                  <strong>{l(f.title)}</strong>
                  <span className="finding-detail">{l(f.detail)}</span>
                </span>
              </button>
              {f.fix && (
                <button type="button" className="fix-btn" onClick={() => onApply(f)}>
                  <Wrench size={13} /> {l(f.fix.label)}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {sys && (
        <>
          <h3 className="sub-title">{t('latency')}</h3>
          <div className="latency-row">
            <div>
              <span className="lat-value">{fmtMs(sys.p50)}</span>
              <span className="lat-label">p50</span>
            </div>
            <div>
              <span className="lat-value">{fmtMs(sys.p95)}</span>
              <span className="lat-label">p95</span>
            </div>
            <div>
              <span className="lat-value">{fmtMs(sys.p99)}</span>
              <span className="lat-label">p99</span>
            </div>
          </div>
          <h3 className="sub-title">{t('failures')}</h3>
          {totalFail < 0.05 ? (
            <p className="muted small">{t('noFailures')}</p>
          ) : (
            <>
              <div className="reason-bar" aria-hidden="true">
                {FAIL_REASONS.filter((r) => sys.byReason[r] > 0).map((r) => (
                  <span key={r} style={{ flexGrow: sys.byReason[r], background: REASON_COLOR[r] }} />
                ))}
              </div>
              <ul className="reasons">
                {FAIL_REASONS.filter((r) => sys.byReason[r] > 0.05).map((r) => (
                  <li key={r}>
                    <i style={{ background: REASON_COLOR[r] }} />
                    <span>{t(`reason_${r}` as Key)}</span>
                    <b>
                      {fmtRate(sys.byReason[r])}/s · {fmtPct(sys.byReason[r] / totalFail)}
                    </b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
