import { KINDS, PALETTE_ORDER } from '../sim/catalog';
import { SCENARIOS } from '../sim/scenarios';
import type { NodeKind } from '../sim/types';
import { useI18n } from '../i18n';
import { DRAG_MIME } from './Canvas';
import { KIND_ICON } from './controls';

interface Props {
  tab: 'scenarios' | 'components';
  onTab: (t: 'scenarios' | 'components') => void;
  scenarioId: string | null;
  onScenario: (id: string) => void;
  onAdd: (kind: NodeKind) => void;
}

export function Sidebar({ tab, onTab, scenarioId, onScenario, onAdd }: Props) {
  const { t, l } = useI18n();
  return (
    <nav className="sidebar">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'scenarios'} className={tab === 'scenarios' ? 'active' : ''} onClick={() => onTab('scenarios')}>
          {t('scenarios')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'components'} className={tab === 'components' ? 'active' : ''} onClick={() => onTab('components')}>
          {t('components')}
        </button>
      </div>
      {tab === 'scenarios' ? (
        <ol className="scenario-list">
          {SCENARIOS.map((s, i) => (
            <li key={s.id}>
              <button type="button" className={s.id === scenarioId ? 'active' : ''} onClick={() => onScenario(s.id)}>
                <span className="sc-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="sc-text">
                  <span className="sc-title">{l(s.title)}</span>
                  <span className="sc-tag">{l(s.tagline)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="palette">
          <p className="muted small">{t('componentsHint')}</p>
          {PALETTE_ORDER.map((kind) => {
            const Icon = KIND_ICON[kind];
            return (
              <button
                key={kind}
                type="button"
                className="palette-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, kind);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onAdd(kind)}
                title={l(KINDS[kind].blurb)}
              >
                <span className={`node-icon kind-${kind}`}>
                  <Icon size={15} />
                </span>
                <span className="pi-text">
                  <span className="pi-name">{l(KINDS[kind].name)}</span>
                  <span className="pi-blurb">{l(KINDS[kind].blurb)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
}
