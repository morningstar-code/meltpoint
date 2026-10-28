import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { KINDS, nominalCapacity, type ParamKey } from '../sim/catalog';
import type { Snapshot } from '../sim/engine';
import { fmtCount, fmtMs, fmtPct, fmtRate } from '../sim/format';
import { meanWaitMs } from '../sim/theory';
import type { Backoff, EdgePolicy, EdgeSpec, LbStrategy, NodeParams, NodeSpec } from '../sim/types';
import { useI18n, type Key } from '../i18n';
import { KIND_ICON, NumberField, SelectField, Toggle } from './controls';
import { heatColor } from './heat';

interface NodeProps {
  spec: NodeSpec;
  snap: Snapshot | null;
  onChange: (patch: Partial<NodeParams>, key: string) => void;
  onRename: (label: string) => void;
  onDelete: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="insp-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function NodeInspector({ spec, snap, onChange, onRename, onDelete }: NodeProps) {
  const { t, l } = useI18n();
  const info = KINDS[spec.kind];
  const p = spec.params;
  const n = snap?.nodes[spec.id];
  const Icon = KIND_ICON[spec.kind];
  const field = (key: ParamKey) => {
    const label = t(`field_${key}` as Key);
    const set = (v: unknown) => onChange({ [key]: v } as Partial<NodeParams>, `${spec.id}:${key}`);
    switch (key) {
      case 'instances':
        return <NumberField key={key} label={label} value={p.instances} min={1} max={64} integer onChange={set} />;
      case 'concurrency':
        return <NumberField key={key} label={label} value={p.concurrency} min={1} max={1024} log integer onChange={set} />;
      case 'serviceMs':
        return <NumberField key={key} label={label} value={p.serviceMs} min={0.1} max={10000} log unit="ms" onChange={set} />;
      case 'cv':
        return <NumberField key={key} label={label} value={p.cv} min={0} max={3} step={0.05} help={t('help_cv')} onChange={set} />;
      case 'queueLimit':
        return <NumberField key={key} label={label} value={p.queueLimit} min={0} max={100000} integer onChange={set} />;
      case 'blocking':
        return <Toggle key={key} label={label} value={p.blocking} help={t('help_blocking')} onChange={set} />;
      case 'deadlineAware':
        return <Toggle key={key} label={label} value={p.deadlineAware} help={t('help_deadlineAware')} onChange={set} />;
      case 'weight':
        return <NumberField key={key} label={label} value={p.weight} min={0} max={10} step={0.1} onChange={set} />;
      case 'hitRate':
        return <NumberField key={key} label={label} value={p.hitRate} min={0} max={1} percent unit="%" step={0.5} onChange={set} />;
      case 'strategy':
        return (
          <SelectField<LbStrategy>
            key={key}
            label={label}
            value={p.strategy}
            onChange={set}
            options={(['round-robin', 'random', 'least-busy'] as LbStrategy[]).map((s) => ({
              value: s,
              label: t(`strategy_${s.replace('-', '_')}` as Key),
            }))}
          />
        );
      case 'rate':
        return <NumberField key={key} label={label} value={p.rate} min={1} max={100000} log integer unit="/s" onChange={set} />;
      case 'burst':
        return <NumberField key={key} label={label} value={p.burst} min={1} max={10000} log integer onChange={set} />;
      case 'errorThreshold':
        return <NumberField key={key} label={label} value={p.errorThreshold} min={0.05} max={1} percent unit="%" onChange={set} />;
      case 'openMs':
        return <NumberField key={key} label={label} value={p.openMs} min={100} max={120000} log unit="ms" onChange={set} />;
      case 'minRequests':
        return <NumberField key={key} label={label} value={p.minRequests} min={1} max={1000} log integer onChange={set} />;
      case 'maxDeliveries':
        return <NumberField key={key} label={label} value={p.maxDeliveries} min={1} max={20} integer onChange={set} />;
      default:
        return null;
    }
  };

  const capacity = info.slotted ? nominalCapacity({ ...p, instances: n?.instances ?? p.instances }) : null;
  const theory =
    info.slotted && n && !p.blocking && n.inRate > 0.5
      ? {
          c: (n.instances ?? p.instances) * p.concurrency,
          rho: n.inRate / (capacity ?? Infinity),
          predicted: meanWaitMs((n.instances ?? p.instances) * p.concurrency, p.serviceMs * p.slowdown, n.inRate, p.cv),
        }
      : null;

  return (
    <div className="inspector">
      <header className="insp-head" style={{ '--heat': heatColor(n?.heat ?? 0) } as React.CSSProperties}>
        <span className={`node-icon kind-${spec.kind} big`}>
          <Icon size={18} />
        </span>
        <div className="insp-title">
          <input className="title-input" value={spec.label} onChange={(e) => onRename(e.target.value)} aria-label={t('label')} />
          <span className="insp-kind">{l(info.name)}</span>
        </div>
        <button type="button" className="icon-btn danger" onClick={onDelete} title={`${t('deleteSel')} (Del)`} aria-label={t('deleteSel')}>
          <Trash2 size={16} />
        </button>
      </header>
      <p className="insp-blurb">{l(info.blurb)}</p>

      {n && (
        <Section title={t('live')}>
          <div className="stats">
            <Stat label={`${t('in')} /s`} value={fmtRate(n.inRate)} />
            <Stat label={`${t('ok')} /s`} value={fmtRate(n.okRate)} tone="good" />
            <Stat label={`${t('fail')} /s`} value={fmtRate(n.failRate)} tone={n.failRate > 0.05 ? 'bad' : ''} />
            {info.slotted && <Stat label={t('busy')} value={fmtPct(n.util)} tone={n.util > 0.9 ? 'bad' : n.util > 0.75 ? 'warn' : ''} />}
            <Stat label="p50" value={fmtMs(n.p50)} />
            <Stat label="p99" value={fmtMs(n.p99)} />
            {info.slotted && <Stat label={t('waiting')} value={fmtCount(n.waiting)} />}
            {info.slotted && <Stat label={t('wastedShort')} value={fmtPct(n.wasted)} tone={n.wasted > 0.3 ? 'bad' : ''} />}
            {spec.kind === 'queue' && <Stat label={t('backlog')} value={fmtCount(n.backlog)} />}
            {spec.kind === 'queue' && <Stat label={t('lag')} value={fmtMs(n.lagMs)} />}
            {capacity !== null && Number.isFinite(capacity) && <Stat label="max /s" value={fmtRate(capacity)} />}
          </div>
          {theory && (
            <div className="theory">
              <h4>{t('theory')}</h4>
              {theory.predicted === null ? (
                <p>{t('theoryUnstable')}</p>
              ) : (
                <p>
                  {t('theoryPredicts')} <b>{fmtMs(theory.predicted)}</b> {t('theoryWait')} · {t('theoryMeasured')}{' '}
                  <b>{fmtMs(n.meanWait ?? 0)}</b>
                </p>
              )}
              <small>{t('theoryNote', { c: theory.c, rho: theory.rho.toFixed(2) })}</small>
            </div>
          )}
        </Section>
      )}

      {info.fields.length > 0 && <Section title={t('settings')}>{info.fields.map(field)}</Section>}

      {info.autoscale && (
        <Section title={t('autoscaling')}>
          <Toggle
            label={t('as_enabled')}
            value={p.autoscale.enabled}
            onChange={(v) => onChange({ autoscale: { ...p.autoscale, enabled: v } }, `${spec.id}:as`)}
          />
          {p.autoscale.enabled && (
            <>
              <NumberField
                label={t('as_min')}
                value={p.autoscale.min}
                min={1}
                max={64}
                integer
                onChange={(v) => onChange({ autoscale: { ...p.autoscale, min: v, max: Math.max(v, p.autoscale.max) } }, `${spec.id}:as-min`)}
              />
              <NumberField
                label={t('as_max')}
                value={p.autoscale.max}
                min={1}
                max={64}
                integer
                onChange={(v) => onChange({ autoscale: { ...p.autoscale, max: v, min: Math.min(v, p.autoscale.min) } }, `${spec.id}:as-max`)}
              />
              <NumberField
                label={t('as_target')}
                value={p.autoscale.target}
                min={0.1}
                max={0.95}
                percent
                unit="%"
                onChange={(v) => onChange({ autoscale: { ...p.autoscale, target: v } }, `${spec.id}:as-target`)}
              />
              <NumberField
                label={t('as_boot')}
                value={p.autoscale.bootMs}
                min={0}
                max={120000}
                unit="ms"
                step={500}
                onChange={(v) => onChange({ autoscale: { ...p.autoscale, bootMs: v } }, `${spec.id}:as-boot`)}
              />
            </>
          )}
        </Section>
      )}

      <Section title={t('chaos')}>
        <Toggle label={t('field_down')} value={p.down} danger onChange={(v) => onChange({ down: v }, `${spec.id}:down`)} />
        {spec.kind !== 'client' && (
          <>
            <NumberField
              label={t('field_slowdown')}
              value={p.slowdown}
              min={1}
              max={50}
              log
              unit="×"
              onChange={(v) => onChange({ slowdown: v }, `${spec.id}:slowdown`)}
            />
            <NumberField
              label={t('field_errorRate')}
              value={p.errorRate}
              min={0}
              max={1}
              percent
              unit="%"
              step={0.5}
              onChange={(v) => onChange({ errorRate: v }, `${spec.id}:errorRate`)}
            />
          </>
        )}
      </Section>
    </div>
  );
}

interface EdgeProps {
  spec: EdgeSpec;
  fromLabel: string;
  toLabel: string;
  snap: Snapshot | null;
  onChange: (patch: Partial<EdgePolicy>, key: string) => void;
  onDelete: () => void;
}

export function EdgeInspector({ spec, fromLabel, toLabel, snap, onChange, onDelete }: EdgeProps) {
  const { t } = useI18n();
  const e = snap?.edges[spec.id];
  const pol = spec.policy;
  const set = (key: keyof EdgePolicy) => (v: unknown) => onChange({ [key]: v } as Partial<EdgePolicy>, `${spec.id}:${key}`);
  return (
    <div className="inspector">
      <header className="insp-head">
        <div className="insp-title">
          <span className="edge-title">
            {fromLabel} <span className="arrow-glyph">→</span> {toLabel}
          </span>
          <span className="insp-kind">{t('call')}</span>
        </div>
        <button type="button" className="icon-btn danger" onClick={onDelete} title={`${t('deleteSel')} (Del)`} aria-label={t('deleteSel')}>
          <Trash2 size={16} />
        </button>
      </header>
      {e && (
        <Section title={t('live')}>
          <div className="stats">
            <Stat label={`${t('calls')} /s`} value={fmtRate(e.callRate)} />
            <Stat label={`${t('attempts')} /s`} value={fmtRate(e.rate)} />
            <Stat label={`${t('retries')} /s`} value={fmtRate(e.retryRate)} tone={e.retryRate > 0.5 ? 'warn' : ''} />
            <Stat label={`${t('timeouts')} /s`} value={fmtRate(e.timeoutRate)} tone={e.timeoutRate > 0.5 ? 'bad' : ''} />
            <Stat label={`${t('fail')} /s`} value={fmtRate(e.failRate)} tone={e.failRate > 0.5 ? 'bad' : ''} />
            <Stat label={`${t('fallback')} /s`} value={fmtRate(e.fallbackRate)} />
          </div>
        </Section>
      )}
      <Section title={t('settings')}>
        <NumberField label={t('field_timeoutMs')} value={pol.timeoutMs} min={0} max={60000} unit="ms" step={10} help={t('help_timeout')} onChange={set('timeoutMs')} />
        <NumberField label={t('field_retries')} value={pol.retries} min={0} max={10} integer onChange={set('retries')} />
        {pol.retries > 0 && (
          <>
            <SelectField<Backoff>
              label={t('field_backoff')}
              value={pol.backoff}
              onChange={set('backoff')}
              options={(['none', 'fixed', 'exponential'] as Backoff[]).map((b) => ({ value: b, label: t(`backoff_${b}` as Key) }))}
            />
            {pol.backoff !== 'none' && (
              <NumberField label={t('field_backoffMs')} value={pol.backoffMs} min={1} max={10000} log unit="ms" onChange={set('backoffMs')} />
            )}
            <Toggle label={t('field_jitter')} value={pol.jitter} onChange={set('jitter')} />
            <NumberField
              label={t('field_retryBudget')}
              value={pol.retryBudget}
              min={0}
              max={1}
              percent
              unit="%"
              help={t('help_retryBudget')}
              onChange={set('retryBudget')}
            />
          </>
        )}
        <NumberField label={t('field_probability')} value={pol.probability} min={0} max={1} percent unit="%" onChange={set('probability')} />
        <NumberField label={t('field_latencyMs')} value={pol.latencyMs} min={0} max={1000} log unit="ms" onChange={set('latencyMs')} />
        <Toggle label={t('field_optional')} value={pol.optional} help={t('help_optional')} onChange={set('optional')} />
      </Section>
      <Section title={t('chaos')}>
        <Toggle label={t('cut')} value={pol.cut} danger onChange={set('cut')} />
      </Section>
    </div>
  );
}
