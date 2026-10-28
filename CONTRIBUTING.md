# Contributing to Meltpoint

Thanks for helping. Meltpoint teaches people how systems behave under load, so the bar for any
change is that it keeps the numbers honest.

## Getting started

```bash
npm install
npm run dev        # the app on http://localhost:5173
npm test           # the test suite
npm run typecheck  # TypeScript, no emit
```

## How the code fits together

- `src/sim/engine.ts` is the discrete-event engine. It knows nothing about React or the DOM.
  Requests are plain objects; every metric is measured from them.
- `src/sim/catalog.ts` lists the components, their defaults and which settings the inspector shows.
- `src/sim/scenarios.ts` holds the guided scenarios and their experiments.
- `src/sim/sweep.ts` is the meltpoint finder; `src/sim/diagnose.ts` turns a snapshot into findings.
- `src/ui/` is the interface, `src/i18n.ts` every string in English and Spanish.

## Adding a scenario

1. Add it to `src/sim/scenarios.ts` with a title, tagline, lesson and experiments, in both
   languages.
2. Check that it teaches what it says: run it headless and read the numbers. The conservation and
   finiteness tests in `src/sim/engine.test.ts` run automatically for every scenario.
3. If it relies on a specific behaviour, add a test for that behaviour.

## Adding a component or a setting

Behaviour belongs in the engine, defaults and inspector fields in the catalog, labels in
`src/i18n.ts` (both languages). If a new mechanism has a known result from queueing theory or the
literature, add a test that holds the engine to it.

## Translations

Every key in `src/i18n.ts` exists in English and Spanish; TypeScript fails the build if one is
missing. New languages are welcome: add a dictionary and a way to choose it.

## Pull requests

Keep them focused, run `npm test` and `npm run typecheck`, and describe what changed and how you
checked it. If a number on screen changes, say why the new one is right.
