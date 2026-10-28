import { useEffect, useRef, useState } from 'react';
import {
  Download,
  Flame,
  Keyboard,
  Languages,
  Menu,
  Moon,
  PanelLeft,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Share2,
  StepForward,
  Sun,
  Undo2,
  Upload,
} from 'lucide-react';
import type { SystemSnap } from '../sim/engine';
import { fmtMs, fmtPct, fmtRate } from '../sim/format';
import { TRAFFIC_INFO, TRAFFIC_SHAPES } from '../sim/traffic';
import type { TrafficShape } from '../sim/types';
import { useI18n } from '../i18n';
import { GithubMark, Tip } from './controls';
import { fmtTime } from './Timeline';

export const REPO_URL = 'https://github.com/morningstar-code/meltpoint';

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <defs>
        <linearGradient id="mp-logo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc53d" />
          <stop offset="0.55" stopColor="#ff5a2b" />
          <stop offset="1" stopColor="#ff2d55" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5c7.4 0 12.5 5.4 12.5 12 0 4-1.7 6.6-3.6 8.1-1 .8-1.4 1.8-1.4 3.1v.6a2.4 2.4 0 0 1-4.8 0v-1.5c0-.9-.7-1.6-1.6-1.6s-1.6.7-1.6 1.6v3.7a2.6 2.6 0 0 1-5.2 0v-4.3c0-1-.5-1.8-1.3-2.4C6 20.1 3.5 17.4 3.5 14.5c0-6.6 5.1-12 12.5-12Z"
        fill="url(#mp-logo)"
      />
      <circle cx="16" cy="13.4" r="3.4" className="logo-dot" />
    </svg>
  );
}

const LOAD_MIN = 1;
const LOAD_MAX = 20000;
const toSlider = (v: number) => Math.log(Math.max(LOAD_MIN, v) / LOAD_MIN) / Math.log(LOAD_MAX / LOAD_MIN);
const fromSlider = (s: number) => {
  const v = LOAD_MIN * Math.pow(LOAD_MAX / LOAD_MIN, s);
  if (v < 20) return Math.round(v);
  if (v < 200) return Math.round(v / 5) * 5;
  if (v < 2000) return Math.round(v / 10) * 10;
  return Math.round(v / 100) * 100;
};

interface Props {
  load: number;
  traffic: TrafficShape;
  system: SystemSnap | null;
  running: boolean;
  speed: number;
  lang: 'en' | 'es';
  theme: 'dark' | 'light';
  canUndo: boolean;
  canRedo: boolean;
  lagging: boolean;
  onLoad: (v: number) => void;
  onTraffic: (v: TrafficShape) => void;
  onPlay: () => void;
  onStep: () => void;
  onReset: () => void;
  onSpeed: (v: number) => void;
  onMeltpoint: () => void;
  onShare: () => void;
  onExport: () => void;
  onImport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onLang: () => void;
  onTheme: () => void;
  onShortcuts: () => void;
  onSidebar: () => void;
}

export function TopBar(p: Props) {
  const { t, l } = useI18n();
  const [text, setText] = useState(String(p.load));
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => setText(String(p.load)), [p.load]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const s = p.system;
  const errTone = !s ? '' : s.errorRatio > 0.2 ? 'bad' : s.errorRatio > 0.01 ? 'warn' : 'good';
  const goodTone = !s || s.offered < 0.5 ? '' : s.goodput < s.offered * 0.5 ? 'bad' : s.goodput < s.offered * 0.95 ? 'warn' : 'good';

  return (
    <header className="topbar">
      <div className="tb-brand">
        <button type="button" className="icon-btn sidebar-toggle" onClick={p.onSidebar} aria-label={t('scenarios')}>
          <PanelLeft size={18} />
        </button>
        <Logo />
        <div className="brand-text">
          <span className="brand-name">Meltpoint</span>
          <span className="brand-tag">{t('tagline')}</span>
        </div>
      </div>

      <div className="tb-load">
        <div className="load-head">
          <span className="eyebrow">{t('offeredLoad')}</span>
          <span className="load-value">
            <input
              className="num big"
              inputMode="numeric"
              aria-label={t('offeredLoad')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                const v = parseFloat(text);
                if (Number.isFinite(v)) p.onLoad(Math.max(0, Math.min(LOAD_MAX, Math.round(v))));
                else setText(String(p.load));
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <span className="unit">{t('reqPerSec')}</span>
          </span>
          {p.traffic !== 'steady' && s && (
            <span className="load-now">
              {t('now')} {fmtRate(s.target)}
            </span>
          )}
        </div>
        <div className="load-slider">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={toSlider(p.load)}
            onChange={(e) => p.onLoad(fromSlider(parseFloat(e.target.value)))}
            aria-label={t('offeredLoad')}
            style={{ '--fill': `${toSlider(p.load) * 100}%` } as React.CSSProperties}
          />
          <div className="ticks" aria-hidden="true">
            {[1, 10, 100, 1000, 10000].map((v) => (
              <span key={v} style={{ left: `${toSlider(v) * 100}%` }}>
                {fmtRate(v)}
              </span>
            ))}
          </div>
        </div>
        <label className="traffic">
          <span className="eyebrow">{t('traffic')}</span>
          <select value={p.traffic} onChange={(e) => p.onTraffic(e.target.value as TrafficShape)} title={l(TRAFFIC_INFO[p.traffic].blurb)}>
            {TRAFFIC_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {l(TRAFFIC_INFO[shape].name)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tb-kpis">
        <Tip tip={t('goodputTip')}>
          <div className={`kpi ${goodTone}`}>
            <span className="eyebrow">{t('goodput')}</span>
            <span className="kpi-value">
              {s ? fmtRate(s.goodput) : '–'}
              <small>/s</small>
            </span>
          </div>
        </Tip>
        <Tip tip={t('p99Tip')}>
          <div className="kpi">
            <span className="eyebrow">{t('p99')}</span>
            <span className="kpi-value">{s && s.p99 !== null ? fmtMs(s.p99) : 'n/a'}</span>
          </div>
        </Tip>
        <Tip tip={t('errorsTip')}>
          <div className={`kpi ${errTone}`}>
            <span className="eyebrow">{t('errors')}</span>
            <span className="kpi-value">{s ? fmtPct(s.errorRatio) : '–'}</span>
          </div>
        </Tip>
        <Tip tip={t('amplificationTip')}>
          <div className={`kpi ${s && s.amplification > 1.5 ? 'bad' : s && s.amplification > 1.1 ? 'warn' : ''}`}>
            <span className="eyebrow">{t('amplification')}</span>
            <span className="kpi-value">×{s ? s.amplification.toFixed(1) : '1.0'}</span>
          </div>
        </Tip>
        <Tip tip={t('wastedTip')}>
          <div className={`kpi ${s && s.wasted > 0.3 ? 'bad' : s && s.wasted > 0.05 ? 'warn' : ''}`}>
            <span className="eyebrow">{t('wasted')}</span>
            <span className="kpi-value">{s ? fmtPct(s.wasted) : '–'}</span>
          </div>
        </Tip>
      </div>

      <div className="tb-controls">
        <div className="transport">
          <button type="button" className="icon-btn primary-soft" onClick={p.onPlay} title={`${p.running ? t('pause') : t('play')} (Space)`} aria-label={p.running ? t('pause') : t('play')}>
            {p.running ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button type="button" className="icon-btn" onClick={p.onStep} title={`${t('step')} (.)`} aria-label={t('step')}>
            <StepForward size={17} />
          </button>
          <button type="button" className="icon-btn" onClick={p.onReset} title={`${t('reset')} (R)`} aria-label={t('reset')}>
            <RotateCcw size={16} />
          </button>
          <select className="speed" value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))} aria-label={t('speed')} title={t('speed')}>
            {[0.25, 0.5, 1, 2, 5, 10].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
          <span className={`clock ${p.lagging ? 'lagging' : ''}`} title={p.lagging ? t('lagging') : t('sim')}>
            {fmtTime(s?.t ?? 0)}
          </span>
        </div>
        <button type="button" className="btn melt-btn" onClick={p.onMeltpoint} title={`${t('findMeltpoint')} (M)`}>
          <Flame size={16} /> <span>{t('findMeltpoint')}</span>
        </button>
        <div className="tb-menu" ref={menuRef}>
          <button type="button" className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label={t('menu')} aria-expanded={menu} title={t('menu')}>
            <Menu size={18} />
          </button>
          {menu && (
            <div className="dropdown" role="menu" onClick={() => setMenu(false)}>
              <button type="button" role="menuitem" onClick={p.onUndo} disabled={!p.canUndo}>
                <Undo2 size={15} /> {t('undo')} <kbd>Ctrl Z</kbd>
              </button>
              <button type="button" role="menuitem" onClick={p.onRedo} disabled={!p.canRedo}>
                <Redo2 size={15} /> {t('redo')} <kbd>Ctrl ⇧ Z</kbd>
              </button>
              <hr />
              <button type="button" role="menuitem" onClick={p.onShare}>
                <Share2 size={15} /> {t('share')}
              </button>
              <button type="button" role="menuitem" onClick={p.onExport}>
                <Download size={15} /> {t('exportDesign')}
              </button>
              <button type="button" role="menuitem" onClick={p.onImport}>
                <Upload size={15} /> {t('importDesign')}
              </button>
              <hr />
              <button type="button" role="menuitem" onClick={p.onLang}>
                <Languages size={15} /> {p.lang === 'es' ? 'English' : 'Español'}
              </button>
              <button type="button" role="menuitem" onClick={p.onTheme}>
                {p.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} {t('theme')}
              </button>
              <button type="button" role="menuitem" onClick={p.onShortcuts}>
                <Keyboard size={15} /> {t('shortcuts')} <kbd>?</kbd>
              </button>
              <a role="menuitem" href={REPO_URL} target="_blank" rel="noreferrer">
                <GithubMark size={15} /> {t('source')}
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
