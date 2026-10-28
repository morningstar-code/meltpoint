import { useState } from 'react';
import { BookOpen, Bomb, Check, ChevronDown, ChevronUp, FlaskConical, RotateCcw, Wrench } from 'lucide-react';
import type { Experiment, ExperimentKind, Scenario } from '../sim/scenarios';
import { useI18n } from '../i18n';

const KIND_ICON: Record<ExperimentKind, typeof Bomb> = { try: FlaskConical, break: Bomb, fix: Wrench };

interface Props {
  scenario: Scenario;
  applied: string[];
  onRun: (e: Experiment) => void;
  onReset: () => void;
}

export function Lesson({ scenario, applied, onRun, onReset }: Props) {
  const { t, l } = useI18n();
  // Folded on phones and short windows, where it would cover the design.
  const [open, setOpen] = useState(() => window.innerWidth > 820 && window.innerHeight > 860);
  const [more, setMore] = useState(false);

  if (!open) {
    return (
      <button type="button" className="lesson-pill" onClick={() => setOpen(true)}>
        <BookOpen size={14} /> {l(scenario.title)} <ChevronUp size={14} />
      </button>
    );
  }

  return (
    <aside className="lesson" aria-label={t('lesson')}>
      <header>
        <span className="eyebrow">
          <BookOpen size={13} /> {t('lesson')}
        </span>
        <button type="button" className="icon-btn small" onClick={() => setOpen(false)} aria-label={t('hide')} title={t('hide')}>
          <ChevronDown size={15} />
        </button>
      </header>
      <h2>{l(scenario.title)}</h2>
      <p className="lesson-tagline">{l(scenario.tagline)}</p>
      <p className={`lesson-text ${more ? 'open' : ''}`}>{l(scenario.lesson)}</p>
      <button type="button" className="link-btn" onClick={() => setMore((m) => !m)}>
        {more ? t('hide') : t('show')} {more ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {scenario.experiments.length > 0 && (
        <>
          <h3>{t('experiments')}</h3>
          <div className="experiments">
            {scenario.experiments.map((e) => {
              const Icon = applied.includes(e.id) ? Check : KIND_ICON[e.kind];
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`exp exp-${e.kind} ${applied.includes(e.id) ? 'applied' : ''}`}
                  onClick={() => onRun(e)}
                  title={`${t(e.kind)}: ${l(e.label)}`}
                >
                  <Icon size={13} /> {l(e.label)}
                </button>
              );
            })}
          </div>
        </>
      )}
      {applied.length > 0 && (
        <button type="button" className="link-btn reset" onClick={onReset}>
          <RotateCcw size={13} /> {t('resetScenario')}
        </button>
      )}
    </aside>
  );
}
