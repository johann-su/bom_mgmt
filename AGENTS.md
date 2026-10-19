<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Testing

Unit tests run on Node's built-in test runner (`node:test` + `node:assert/strict`)
via `tsx` — there is no Vitest/Jest. Run the whole suite with `npm test`, which
covers `src/**/*.test.ts` plus the slicer service's `slicer/*.test.mjs`.

## What the suite is for

This is a young, fast-moving project where most changes land through AI agents.
The suite exists to answer one question: **"did this change break a behaviour
that already worked?"** — and to double as executable documentation of the
tricky, non-obvious contracts (Onshape's meters-not-mm exports, Bambu's
double-escaped HTML, AMS extruder selection, the ZIP-tail ranged reads). Aim
for tests an agent can read to *learn the contract*, not tests that pin down an
implementation.

Write tests that:

- **Assert on observable behaviour**, not internal structure. Check the parsed
  result, the translated config, the round-tripped CSV — not which private
  helper ran or how many times. A refactor that preserves behaviour should keep
  the tests green; that's the whole point.
- **Cover the contract's edges**, since those are where regressions hide and
  where the documentation value is highest: the fallback branch, the hostile
  input that must be rejected, the multi-plate sum, the look-alike host. One
  crisp test per real behaviour beats ten that restate the same path.
- **Name the behaviour and its "why."** The test title and a one-line comment
  should tell an agent *why* the case exists ("percent is allowed only for
  fill_density", "objects on extruder 2 → second filament"), so a future change
  that trips it knows whether it broke something or changed a documented rule.

Avoid: snapshotting large blobs, asserting exact error strings (assert that it
*errored*, or match a stable substring), re-testing a third-party library's
behaviour, and duplicating one function's cases across several files.

## Conventions

- Co-locate tests next to the code as `*.test.ts` (e.g. `src/lib/format.ts` →
  `src/lib/format.test.ts`). Slicer-service tests are `*.test.mjs` next to
  `slicer/server.mjs`.
- Import from source with the `@/` alias; `tsx` resolves it from `tsconfig.json`.
- Prefer **pure logic** (URL parsers, formatters, BOM/CSV, crypto round-trips,
  the ZIP/config parsers). Do not import modules with load-time side effects
  into a test — e.g. `@/db` opens a pool. Extract the pure core and test that: `threemf-slice-info.ts` holds the
  parsing (unit-tested) while `threemf-remote.ts` only wires it to storage, and the
  slicer's `lib.mjs` holds the parsing/translation while `server.mjs` does I/O.
  Follow that split when a new feature mixes logic with a client.
- No DB or network in unit tests. If a function needs bytes, build them in
  memory (fflate's `zipSync` makes a `.3mf`/ZIP fixture) or inject the reader
  (see `RangeReader` in `threemf-slice-info.ts`); stub `fetch` for HTTP paths.
  The full import/estimate HTTP flows and DB actions stay manual/integration —
  use the `/verify` or `/run` skills to exercise them against a running app.

Example:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "@/lib/format";

test("formatDuration splits hours and minutes", () => {
  assert.equal(formatDuration(5460), "1 h 31 min");
});
```

# Code organization

Rules of thumb for keeping files comprehensible as features grow. These are
judgment calls, not hard limits — they follow the React docs' advice (don't
extract prematurely, but a long list of useState/useEffect serving separate
concerns is the signal to untangle) and Next.js's colocation conventions.

- **Keep the existing layout**: route-specific components sit next to their
  route under `src/app/…` (colocation is safe — only `page`/`route` files are
  routable), shared components in `src/components`, non-React logic in
  `src/lib`. Next.js is deliberately unopinionated here; the value is
  consistency, so don't introduce `_components`/`hooks` folder schemes.
- **Split on unrelated concerns, not on line count.** A long file whose state
  and handlers all serve one feature (`bom-editor.tsx`, `rule-builder.tsx`)
  is easier to work on than the same code spread across ten files — jumping
  between many small files costs comprehension too. The smell that warrants a
  split is *distance*: state declared hundreds of lines from its only use,
  several self-contained subtrees each with their own useState/useEffect
  cluster, or sub-components you must scroll past to reach the one you came
  to edit. When adding a feature would push a file past that point, split
  first, then add.
- **Cut along state boundaries.** A subtree that owns its own state and talks
  to its parent through a narrow prop interface moves out cleanly
  (`model-form-pickers.tsx`, `model-file-cards.tsx`); a subtree that reads
  half the parent's state should stay inline. Prefer moving the exported
  types with the components and re-exporting from the old module so
  consumers don't churn.
- **Pull non-trivial pure logic out of components** into a sibling module
  (`model-form-state.ts`) or `src/lib`, and unit-test it there — the same
  extract-the-pure-core rule as the Testing section. Dirty checks, ordering/
  diff bookkeeping and parsers don't need React to be understood or tested.
- **Never define a component inside another component** — it remounts (and
  drops state/focus) on every parent render. For markup that needs the
  parent's closure, use a plain render function (`renderCard` in
  `bom-editor.tsx`); promote it to a real component only when it can take
  props instead.
