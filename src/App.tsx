import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { KINDS, makeEdge, makeNode } from './sim/catalog';
import { diagnose, type Finding } from './sim/diagnose';
import { Engine, type HistoryPoint, type Incident, type Snapshot } from './sim/engine';
import { cloneTopology, scenarioById, type Experiment } from './sim/scenarios';
import type { EdgePolicy, NodeKind, NodeParams, Topology, TrafficShape } from './sim/types';
import { detectLang, I18nContext, makeI18n, type Lang } from './i18n';
import { localizeTopology } from './labels';
import { decodeDesign, downloadDesign, encodeDesign, loadLocal, normalize, saveLocal, type Design } from './share';
import { Canvas, type Selection } from './ui/Canvas';
import { EdgeInspector, NodeInspector } from './ui/Inspector';
import { Insights } from './ui/Insights';
import { Lesson } from './ui/Lesson';
import { MeltpointPanel } from './ui/MeltpointPanel';
import { NODE_H, NODE_W } from './ui/NodeCard';
import { Sidebar } from './ui/Sidebar';
import { Timeline } from './ui/Timeline';
import { TopBar } from './ui/TopBar';

const DEFAULT_SCENARIO = 'retry-storm';
const SEED = 42;

function structureKey(t: Topology): string {
  const nodes = t.nodes.map((n) => `${n.id}:${n.kind}`).sort();
  const edges = t.edges.map((e) => e.id).sort();
  return `${nodes.join('|')}#${edges.join('|')}`;
}

function scenarioDesign(id: string, lang: Lang): Design {
  const s = scenarioById(id) ?? scenarioById(DEFAULT_SCENARIO);
  if (!s) throw new Error('missing default scenario');
  return { v: 1, scenario: s.id, load: s.load, traffic: s.traffic, topology: localizeTopology(cloneTopology(s.topology), lang) };
}

function detectTheme(): 'dark' | 'light' {
  const param = new URLSearchParams(window.location.search).get('theme');
  if (param === 'dark' || param === 'light') return param;
  try {
    const saved = localStorage.getItem('meltpoint:theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Fall back to the system preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembering a preference is fine.
  }
}

interface Frame {
  snap: Snapshot;
  history: HistoryPoint[];
  incidents: Incident[];
  lagging: boolean;
}

export default function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const [theme, setTheme] = useState<'dark' | 'light'>(detectTheme);
  const [design, setDesign] = useState<Design>(() => {
    const local = loadLocal();
    return local ? { ...local, topology: localizeTopology(local.topology, detectLang()) } : scenarioDesign(DEFAULT_SCENARIO, detectLang());
  });
  const [past, setPast] = useState<Topology[]>([]);
  const [future, setFuture] = useState<Topology[]>([]);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [applied, setApplied] = useState<string[]>([]);
  const [meltOpen, setMeltOpen] = useState(() => new URLSearchParams(window.location.search).get('open') === 'meltpoint');
  const [helpOpen, setHelpOpen] = useState(false);
  const [tab, setTab] = useState<'scenarios' | 'components'>('scenarios');
  const [drawer, setDrawer] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const { t, l } = i18n;
  const designRef = useRef(design);
  designRef.current = design;
  const engineRef = useRef<Engine | null>(null);
  const structRef = useRef('');
  const resetRef = useRef(-1);
  const runningRef = useRef(running);
  runningRef.current = running;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const lastCommit = useRef<{ key: string; at: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scenario = design.scenario ? scenarioById(design.scenario) : undefined;

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 2600);
  }, []);

  // ---------------------------------------------------------------------------------
  // Engine

  useEffect(() => {
    const top = design.topology;
    const key = structureKey(top);
    const e = engineRef.current;
    if (!e || resetRef.current !== resetKey) {
      const fresh = new Engine(top, { seed: SEED, load: designRef.current.load, traffic: designRef.current.traffic });
      // ?t=30 on the first load fast-forwards the simulation, for links to a moment in a run.
      if (!e) {
        const t = Number(new URLSearchParams(window.location.search).get('t'));
        if (Number.isFinite(t) && t > 0) fresh.advance(Math.min(t, 600) * 1000);
      }
      engineRef.current = fresh;
      resetRef.current = resetKey;
    } else if (key !== structRef.current) {
      engineRef.current = e.continueWith(top);
    } else {
      e.updateParams(top);
    }
    structRef.current = key;
  }, [design.topology, resetKey]);

  useEffect(() => engineRef.current?.setLoad(design.load), [design.load]);
  useEffect(() => engineRef.current?.setTraffic(design.traffic), [design.traffic]);

  const publish = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    setFrame({ snap: e.snapshot(), history: e.history.slice(), incidents: e.incidents.slice(-60), lagging: e.lagging });
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastPublish = 0;
    const loop = () => {
      // performance.now() rather than the frame timestamp, which can run behind it.
      const now = performance.now();
      const dt = Math.max(0, Math.min(100, now - last));
      last = now;
      const e = engineRef.current;
      // About 10 ms of work per frame at most; past that the simulation runs slower than real time.
      if (e && runningRef.current && !document.hidden) e.advance(dt * speedRef.current, 120_000);
      if (now - lastPublish > 100) {
        lastPublish = now;
        publish();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [publish]);

  // ---------------------------------------------------------------------------------
  // Design edits, with undo

  const commit = useCallback((next: Topology, key?: string) => {
    const now = performance.now();
    const prev = designRef.current.topology;
    const coalesce = key !== undefined && lastCommit.current?.key === key && now - lastCommit.current.at < 1500;
    if (!coalesce) setPast((p) => [...p.slice(-99), prev]);
    lastCommit.current = key ? { key, at: now } : null;
    setFuture([]);
    setDesign((d) => ({ ...d, topology: next }));
  }, []);

  const histRef = useRef({ past, future });
  histRef.current = { past, future };

  const undo = useCallback(() => {
    const h = histRef.current;
    if (h.past.length === 0) return;
    const prev = h.past[h.past.length - 1];
    setPast(h.past.slice(0, -1));
    setFuture([designRef.current.topology, ...h.future]);
    setDesign((d) => ({ ...d, topology: prev }));
    lastCommit.current = null;
  }, []);

  const redo = useCallback(() => {
    const h = histRef.current;
    if (h.future.length === 0) return;
    const next = h.future[0];
    setFuture(h.future.slice(1));
    setPast([...h.past, designRef.current.topology]);
    setDesign((d) => ({ ...d, topology: next }));
    lastCommit.current = null;
  }, []);

  const updateNode = useCallback(
    (id: string, patch: Partial<NodeParams>, key: string) => {
      const top = designRef.current.topology;
      commit(
        {
          ...top,
          nodes: top.nodes.map((n) =>
            n.id === id ? { ...n, params: { ...n.params, ...patch, autoscale: { ...n.params.autoscale, ...(patch.autoscale ?? {}) } } } : n,
          ),
        },
        key,
      );
    },
    [commit],
  );

  const renameNode = useCallback(
    (id: string, label: string) => {
      const top = designRef.current.topology;
      commit({ ...top, nodes: top.nodes.map((n) => (n.id === id ? { ...n, label } : n)) }, `${id}:label`);
    },
    [commit],
  );

  const updateEdge = useCallback(
    (id: string, patch: Partial<EdgePolicy>, key: string) => {
      const top = designRef.current.topology;
      commit({ ...top, edges: top.edges.map((e) => (e.id === id ? { ...e, policy: { ...e.policy, ...patch } } : e)) }, key);
    },
    [commit],
  );

  const deleteSelection = useCallback(() => {
    const sel = selected;
    if (!sel) return;
    const top = designRef.current.topology;
    if (sel.type === 'node') {
      commit({ nodes: top.nodes.filter((n) => n.id !== sel.id), edges: top.edges.filter((e) => e.from !== sel.id && e.to !== sel.id) });
    } else {
      commit({ ...top, edges: top.edges.filter((e) => e.id !== sel.id) });
    }
    setSelected(null);
  }, [commit, selected]);

  const moveNode = useCallback(
    (id: string, x: number, y: number) => {
      const top = designRef.current.topology;
      commit({ ...top, nodes: top.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) });
    },
    [commit],
  );

  const connect = useCallback(
    (from: string, to: string) => {
      const top = designRef.current.topology;
      const target = top.nodes.find((n) => n.id === to);
      if (!target || target.kind === 'client') return;
      const existing = top.edges.find((e) => e.from === from && e.to === to);
      if (existing) {
        setSelected({ type: 'edge', id: existing.id });
        return;
      }
      const edge = makeEdge(from, to, target.kind === 'worker' && top.nodes.find((n) => n.id === from)?.kind === 'queue' ? { timeoutMs: 30000 } : {});
      commit({ ...top, edges: [...top.edges, edge] });
      setSelected({ type: 'edge', id: edge.id });
    },
    [commit],
  );

  const addNode = useCallback(
    (kind: NodeKind, x?: number, y?: number) => {
      const top = designRef.current.topology;
      let i = 1;
      while (top.nodes.some((n) => n.id === `${kind}-${i}`)) i += 1;
      const base = l(KINDS[kind].name);
      const count = top.nodes.filter((n) => n.kind === kind).length;
      let px = x;
      let py = y;
      if (px === undefined || py === undefined) {
        const anchor = (selected?.type === 'node' && top.nodes.find((n) => n.id === selected.id)) || top.nodes[top.nodes.length - 1];
        px = anchor ? anchor.x + NODE_W + 110 : 0;
        py = anchor ? anchor.y : 0;
        while (top.nodes.some((n) => Math.abs(n.x - (px as number)) < NODE_W && Math.abs(n.y - (py as number)) < NODE_H)) py += NODE_H + 40;
      }
      const node = makeNode(`${kind}-${i}`, kind, count > 0 ? `${base} ${count + 1}` : base, px, py);
      commit({ ...top, nodes: [...top.nodes, node] });
      setSelected({ type: 'node', id: node.id });
      setDrawer(false);
    },
    [commit, l, selected],
  );

  // ---------------------------------------------------------------------------------
  // Scenarios, experiments, fixes

  const loadDesign = useCallback((d: Design) => {
    setDesign(d);
    setPast([]);
    setFuture([]);
    setSelected(null);
    setApplied([]);
    setResetKey((k) => k + 1);
    setFitKey((k) => k + 1);
    setRunning(true);
  }, []);

  const loadScenario = useCallback(
    (id: string) => {
      loadDesign(scenarioDesign(id, lang));
      setDrawer(false);
      if (id === 'blank') setTab('components');
    },
    [lang, loadDesign],
  );

  const switchLang = useCallback(() => {
    const next: Lang = lang === 'en' ? 'es' : 'en';
    setLang(next);
    setDesign((d) => ({ ...d, topology: localizeTopology(d.topology, next) }));
  }, [lang]);

  const runExperiment = useCallback(
    (e: Experiment) => {
      if (e.apply) commit(localizeTopology(e.apply(designRef.current.topology), lang));
      if (e.load !== undefined || e.traffic !== undefined) {
        setDesign((d) => ({ ...d, load: e.load ?? d.load, traffic: e.traffic ?? d.traffic }));
      }
      setApplied((a) => (a.includes(e.id) ? a : [...a, e.id]));
      setRunning(true);
    },
    [commit, lang],
  );

  const applyFix = useCallback(
    (f: Finding) => {
      if (f.fix) commit(f.fix.apply(designRef.current.topology));
    },
    [commit],
  );

  const setLoad = useCallback((load: number) => setDesign((d) => ({ ...d, load })), []);
  const setTraffic = useCallback((traffic: TrafficShape) => setDesign((d) => ({ ...d, traffic })), []);

  const reset = useCallback(() => setResetKey((k) => k + 1), []);
  const step = useCallback(() => {
    setRunning(false);
    engineRef.current?.advance(1000);
    publish();
  }, [publish]);

  // ---------------------------------------------------------------------------------
  // Persistence and sharing

  useEffect(() => {
    const id = window.setTimeout(() => saveLocal(design), 400);
    return () => window.clearTimeout(id);
  }, [design]);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#d=')) return;
    decodeDesign(hash.slice(3)).then((d) => {
      if (!d) return;
      loadDesign(d);
      flash(makeI18n(detectLang()).t('sharedLoaded'));
    });
  }, [loadDesign, flash]);

  const share = useCallback(async () => {
    const code = await encodeDesign(designRef.current);
    const url = `${window.location.origin}${window.location.pathname}#d=${code}`;
    window.history.replaceState(null, '', `#d=${code}`);
    try {
      await navigator.clipboard.writeText(url);
      flash(t('linkCopied'));
    } catch {
      flash(url.length > 80 ? `${url.slice(0, 77)}…` : url);
    }
  }, [flash, t]);

  const exportDesign = useCallback(() => {
    downloadDesign(designRef.current, scenario ? scenario.title.en : 'design');
  }, [scenario]);

  const importFile = useCallback(
    async (file: File) => {
      try {
        const d = normalize(JSON.parse(await file.text()));
        if (!d) throw new Error('invalid');
        loadDesign(d);
        flash(t('imported'));
      } catch {
        flash(t('importFailed'));
      }
    },
    [flash, loadDesign, t],
  );

  // ---------------------------------------------------------------------------------
  // Preferences and keyboard

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store('meltpoint:theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    store('meltpoint:lang', lang);
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          setRunning((r) => !r);
          break;
        case '.':
          step();
          break;
        case 'r':
        case 'R':
          reset();
          break;
        case 'f':
        case 'F':
          setFitKey((k) => k + 1);
          break;
        case 'm':
        case 'M':
          setMeltOpen(true);
          break;
        case '?':
          setHelpOpen((h) => !h);
          break;
        case 'Delete':
        case 'Backspace':
          if (selected) {
            e.preventDefault();
            deleteSelection();
          }
          break;
        case 'Escape':
          setSelected(null);
          setHelpOpen(false);
          setDrawer(false);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelection, redo, reset, selected, step, undo]);

  // ---------------------------------------------------------------------------------

  const snap = frame?.snap ?? null;
  const findings = useMemo(() => (snap ? diagnose(design.topology, snap) : []), [snap, design.topology]);
  const selNode = selected?.type === 'node' ? design.topology.nodes.find((n) => n.id === selected.id) : undefined;
  const selEdge = selected?.type === 'edge' ? design.topology.edges.find((e) => e.id === selected.id) : undefined;
  const label = (id: string) => design.topology.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <I18nContext.Provider value={i18n}>
      <div className={`app ${drawer ? 'drawer-open' : ''}`}>
        <TopBar
          load={design.load}
          traffic={design.traffic}
          system={snap?.system ?? null}
          running={running}
          speed={speed}
          lang={lang}
          theme={theme}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          lagging={frame?.lagging ?? false}
          onLoad={setLoad}
          onTraffic={setTraffic}
          onPlay={() => setRunning((r) => !r)}
          onStep={step}
          onReset={reset}
          onSpeed={setSpeed}
          onMeltpoint={() => setMeltOpen(true)}
          onShare={share}
          onExport={exportDesign}
          onImport={() => fileRef.current?.click()}
          onUndo={undo}
          onRedo={redo}
          onLang={switchLang}
          onTheme={() => setTheme((x) => (x === 'dark' ? 'light' : 'dark'))}
          onShortcuts={() => setHelpOpen(true)}
          onSidebar={() => setDrawer((d) => !d)}
        />
        <div className="body">
          <Sidebar tab={tab} onTab={setTab} scenarioId={design.scenario} onScenario={loadScenario} onAdd={(k) => addNode(k)} />
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <main className="stage">
            <Canvas
              topology={design.topology}
              snap={snap}
              selected={selected}
              running={running}
              fitKey={fitKey}
              onSelect={setSelected}
              onMove={moveNode}
              onConnect={connect}
              onAdd={(k, x, y) => addNode(k, x, y)}
            >
              {scenario && (
                <div className="overlay-bl" onPointerDown={(e) => e.stopPropagation()}>
                  <Lesson
                    key={scenario.id}
                    scenario={scenario}
                    applied={applied}
                    onRun={runExperiment}
                    onReset={() => loadScenario(scenario.id)}
                  />
                </div>
              )}
            </Canvas>
            <Timeline history={frame?.history ?? []} incidents={frame?.incidents ?? []} topology={design.topology} now={snap?.system.t ?? 0} />
          </main>
          <aside className="panel">
            {selNode ? (
              <NodeInspector
                key={selNode.id}
                spec={selNode}
                snap={snap}
                onChange={(patch, key) => updateNode(selNode.id, patch, key)}
                onRename={(v) => renameNode(selNode.id, v)}
                onDelete={deleteSelection}
              />
            ) : selEdge ? (
              <EdgeInspector
                key={selEdge.id}
                spec={selEdge}
                fromLabel={label(selEdge.from)}
                toLabel={label(selEdge.to)}
                snap={snap}
                onChange={(patch, key) => updateEdge(selEdge.id, patch, key)}
                onDelete={deleteSelection}
              />
            ) : (
              <Insights findings={findings} snap={snap} onApply={applyFix} onFocus={setSelected} />
            )}
          </aside>
        </div>

        {meltOpen && (
          <MeltpointPanel
            topology={design.topology}
            load={design.load}
            title={scenario ? l(scenario.title) : t('customDesign')}
            onClose={() => setMeltOpen(false)}
            onSetLoad={(v) => {
              setLoad(v);
              setMeltOpen(false);
              setRunning(true);
            }}
          />
        )}

        {helpOpen && (
          <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setHelpOpen(false)}>
            <div className="modal small" role="dialog" aria-modal="true" aria-label={t('shortcuts')}>
              <header className="modal-head">
                <h2>{t('shortcuts')}</h2>
                <button type="button" className="icon-btn" onClick={() => setHelpOpen(false)} aria-label={t('close')}>
                  <X size={18} />
                </button>
              </header>
              <dl className="shortcuts">
                <dt>
                  <kbd>Space</kbd>
                </dt>
                <dd>{t('shortcutPlay')}</dd>
                <dt>
                  <kbd>.</kbd>
                </dt>
                <dd>{t('shortcutStep')}</dd>
                <dt>
                  <kbd>R</kbd>
                </dt>
                <dd>{t('shortcutReset')}</dd>
                <dt>
                  <kbd>M</kbd>
                </dt>
                <dd>{t('shortcutMelt')}</dd>
                <dt>
                  <kbd>F</kbd>
                </dt>
                <dd>{t('shortcutFit')}</dd>
                <dt>
                  <kbd>Del</kbd>
                </dt>
                <dd>{t('shortcutDelete')}</dd>
                <dt>
                  <kbd>Ctrl Z</kbd> <kbd>Ctrl ⇧ Z</kbd>
                </dt>
                <dd>{t('shortcutUndo')}</dd>
                <dt>
                  <kbd>?</kbd>
                </dt>
                <dd>{t('shortcutHelp')}</dd>
              </dl>
            </div>
          </div>
        )}

        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </I18nContext.Provider>
  );
}
