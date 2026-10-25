# BOM & inventory management

A management app that allows to keep track of inventory of components. It should be organized hierarchically - a shelf, box, bin. Say Shelf A, Box 1, I contains heat set inserts M3x5. The labeling in the previous example is just an example: the real example should ideally be freely configurable (eg alpha for shelfs, numeric for boxes, roman for bins, but could also be alpha-numeric for shelfs, alpha-numeric for boxes, numeric for bins etc - maybe configurable via a regex like syntax).

For auth, oauth2 should be supported alongside password login. 

## Tech stack

- Nextjs
- shadcn
- BetterAuth
- S3-compatible or local-filesystem file storage
- postgres db (through drizzle orm)

---

## What's implemented

**Bin Vault** — the app built from the spec above, styled after Print Vault
(`~/code/stl_proj_mgmt`: same shadcn `radix-nova` components, palette and
sidebar shell).

- **Storage hierarchy** — a tree of locations of any depth. Each location has
  a *type* (Shelf, Box, Bin, Drawer, …) and types carry the **label pattern**
  their members are named by. Any type can sit inside any other.
- **Label patterns** (Settings → Location types), regex-like:

  | Token | Meaning | Example labels |
  | --- | --- | --- |
  | `{A}` / `{a}` | letters | A … Z, AA, AB |
  | `{N}` | numbers | 1, 2, … 10 |
  | `{NN}` | zero-padded (width = number of Ns) | 01 … 99 |
  | `{R}` / `{r}` | roman numerals | I, II, III, IV |
  | `{N:0-9}`, `{A:A-F}` | bounded range — counters roll over like an odometer | |
  | literal text | anything outside braces; `{{` / `}}` for braces | `S-{NN}` → S-01 |

  So the README example is Shelf `{A}`, Box `{N}`, Bin `{R}` (one of the
  presets in the first-run setup wizard), and an alpha-numeric grid is `{A}{N:1-6}` → A1 … A6, B1 ….
  Adding a location suggests the next free label; "Several" creates N at once.
  A location's code joins the labels: **A/1/IV**, and search finds it from
  `a1iv` or `A-1-IV` too. The separator is configurable (Settings → Location
  types), including none at all — box `A`'s bin `1` is then just **A1**.
- **Parts** with category, manufacturer/MPN, unit, minimum stock, free-form
  attributes, notes, images and datasheets.
- **Stock** per (part, location): add, remove, count (stock-take), move.
  Every change is logged with user, note and the location code at the time.
- **BOMs** — lines with quantity per unit and reference designators; shows
  how many units the stock covers and a shopping list for N units; **Build**
  takes the parts out of stock (emptiest bins first, all-or-nothing). CSV
  import (matches by MPN, then name; can create missing parts; accepts
  KiCad/JLC-style headers and `;` files) and export.
- **Auth** — email/password plus OAuth2: generic OIDC (Authentik, Keycloak,
  …), GitHub and Google, each enabled by env vars. The first account (or
  `INITIAL_ADMIN_EMAIL`) is admin and manages users; the inventory itself is
  shared by all users.
- **Files** on S3-compatible storage (MinIO in compose) or the local
  filesystem (`STORAGE_BACKEND=filesystem`).

## Running it

```sh
cp .env.example .env            # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d            # Postgres (host port 5433) + MinIO (9000, console 9001)
npm install
npm run db:migrate              # applies ./drizzle
npm run dev                     # http://localhost:3000 — sign up; first account is admin
```

On a fresh database the first sign-in lands in a setup wizard (`/setup`): pick
or build the location hierarchy and its label patterns, choose a printable
label per level, and optionally create the first shelves/boxes/bins.

Full stack in Docker (app included): `docker compose --profile app up -d --build`.

After changing `src/db/schema.ts`: `npm run db:generate`, then `npm run db:migrate`.

Checks: `npm test` (node:test, pure logic), `npm run lint`, `npm run typecheck`,
`npm run build`.
- **Labels** — print labels for shelves, boxes and bins from a location's
  *Labels* button (or Locations → Labels): pick the locations (a whole box
  of bins at once) and a template, then download a vector **PDF** at exact
  label size, **SVG** or 300 dpi **PNG** (several pages as a ZIP), or a
  **CSV** of the variables for mail merge in another designer. Templates are
  designed under Settings → Label templates: drag text, codes (Data Matrix,
  QR, Code 128, Code 39) and frames on the label, with `{{code}}`,
  `{{label}}`, `{{name}}`, `{{path}}`, `{{url}}`, … filled per location.
  Layouts cover label printers (one label per page) and label sheets
  (Avery presets or a custom grid, with "skip used labels"). Rendering is
  in-browser (bwip-js, jsPDF + svg2pdf.js).
- **NIIMBOT printing** — the print page connects to a NIIMBOT label printer
  (D11, D110, B1, B21, …) over Bluetooth or USB and prints directly, via
  [niimbluelib](https://github.com/MultiMote/niimbluelib). Needs Chrome/Edge
  on desktop or Android (no Firefox, no iOS) and the app on **HTTPS** or
  localhost — Web Bluetooth is unavailable on plain `http://<lan-ip>`. Use a
  one-label-per-page template sized to the roll (built-ins for D11/D110
  40×12 and B1 50×30); codes are snapped to the printer's dot grid.
