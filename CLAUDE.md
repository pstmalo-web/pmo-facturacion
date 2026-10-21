# PMO · Módulo de facturación

Read `README.md` first: setup, the non-negotiable rules, HKA quirks and the
pending phases are all there.

- This repo is an isolated copy of ONE module of a larger private app. The
  files listed under «Archivos que NO son del módulo» are stand-ins: do not
  edit them; if the module needs something from them, say so in the PR.
- Totals only through `calcularTotales` / `itbmsLinea` in `lib/calc.ts`.
- Never deduce or auto-correct a RUC/DV.
- Never use HKA production credentials; demo only.
- Before any PR: `npm run typecheck && npm test && npm run lint && npm run build`.
