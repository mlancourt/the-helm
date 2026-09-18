---
tags: [the-helm, claude-md, site-repo, build-brief]
created: 2026-09-17
version: v1.0
status: READY — copy to `~/Projects/the-helm/CLAUDE.md` at Phase 1 kickoff; the repo copy is canonical after that, this is the vault mirror
related: ["[[_The-Helm-Index]]", "[[Schema-v1]]", "[[Tile-Registry]]", "[[The-Helm-Kickoff-Brief]]"]
---

# The Helm — CLAUDE.md

You are building **The Helm**: a single-user personal homepage for **Matt** — a phone-first PWA that renders a JSON snapshot as **tiles**, grades his open sports bets live in the browser, and carries a chat box (`/ask`) answered by a Worker. One user, one token. It is the third instance of a pattern he already runs (the Newsstand, the WSS Fleet Dashboard) — build to the contracts here, never redesign the pattern.

**This repo is the presentation + transport layer ONLY.** A separate system (Matt's Obsidian vault + a Python engine, owned elsewhere) is the source of truth. It publishes `helm-data.json` to your Worker and drains pending write-events from it. You never see that system; you build to the contracts in this file.

## Division of labor — hard boundary

| Yours (this repo) | NOT yours |
|---|---|
| Cloudflare Worker (API + KV + `/ask` proxy) | The engine, the vault, any real data |
| Static PWA (GitHub Pages) + tile render modules | Generating real `helm-data.json` |
| In-browser LIVE band (ESPN fetch + bet graders) | Settling bets (a separate system does; you show a *lean*) |
| Mock/sample snapshot generator (fake data) | Applying events to the source of truth |
| The `/ask` system prompt file's *plumbing* | Its *content* — the vault owner supplies `ask-system.txt`; you load it as a Worker secret/KV value, never commit it |

If real data ever looks wrong, **report it — never "fix" data**. The vault wins all conflicts.

## Architecture (locked — do not redesign)

```
 Matt's phone/desk ──token URL──► mlancourt.github.io/the-helm  (GitHub Pages: static shell, ZERO data in repo)
                                   │
                                   ├─► GET  /api/data        ─┐
                                   ├─► POST /api/event       ─┤  Cloudflare Worker (workers.dev)
                                   ├─► DELETE /api/event/:id ─┤   • token auth (KV)
                                   ├─► POST /api/ask         ─┤   • KV: snapshot + event inbox
                                   │                          │   • /ask → Anthropic API (v1) — key lives in the Worker
                                   └─► site.api.espn.com  (LIVE band: page fetches ESPN DIRECTLY — verified CORS-open from a GitHub Pages origin 2026-09-17)
 Engine (elsewhere) ◄── GET /api/admin/events ── Worker
                    ── POST /api/admin/publish ►
```

Later (Phase 2, not this build): `/ask` forwards to a Cloudflare Tunnel instead of Anthropic directly. Design `/ask` so the *backend* is one swappable function; the page never knows which.

**Hosting:** GitHub `mlancourt` (Pages from `/docs` on `main`) · Matt's existing Cloudflare account (Workers + KV; he has deployed both before). Prefer `wrangler`; keep the Worker a single self-contained `worker.js` so dashboard-paste stays a fallback.

## Hard rules

1. **No real data in this repo, ever.** Public repo. No bets, balances, names, feeds, calendar items, tokens, secrets, or real `helm-data.json` — not in code, commits, or fixtures. All test data comes from the fake-data generator. `.gitignore` `*.local.*`, `.dev.vars`, `real-*`, `ask-system*.txt`.
2. **No accounts, no passwords, no auth frameworks.** Identity = one opaque token in the URL (`?t=`), stored to localStorage on first load so the bare URL works afterward. No login page. (A second read-only token may come later — build the token map as a map, not a constant.)
3. **No build step, no frameworks.** Vanilla HTML/CSS/JS, ES modules. No React/Vite/npm-for-the-page. Worker is plain JS; `wrangler` is the only dev dependency. Future Claude sessions must be able to work here with zero toolchain archaeology.
4. **No external CDNs, fonts, analytics, or trackers.** Self-contained assets. Must load on one bar of LTE. The **only** external calls the page makes are to the Worker and to `site.api.espn.com` — **plus one carve-out (Matt, 2026-09-18): listing images whose URLs arrive in the snapshot** (e.g. eBay thumbnails on `cards`). Rules for that carve-out: `<img>` only, never script/style/fetch; `http(s)` URLs only; `referrerpolicy="no-referrer"`, `loading="lazy"`; never cached by the service worker; a same-size placeholder when absent. Content the user will judge by eye is data, not a dependency.
5. **Writes are proposals, not truth.** Every event is *pending* until the engine applies it. Badge it "pending"; never render a submitted write as applied.
6. **Money never moves from here.** Any dollar figure in the snapshot is display-only. No payment, invoice, or bet-placing actions exist in this UI.
7. **All timestamps you generate are UTC ISO-8601.** Business dates in the snapshot are `YYYY-MM-DD` Central strings — **render verbatim as text. NEVER `new Date("YYYY-MM-DD")`** (JS parses date-only as UTC midnight; Central users see yesterday). Disqualifying bug.
8. **Graceful degradation.** A tile with `status: error|stale` greys with its `updated_at`; the rest renders. Worker down → render the last cached snapshot from localStorage with a "stale since …" banner. ESPN down → LIVE tiles show "feed unavailable," never blank. `/ask` down → chat says so.
9. **Tolerate unknown tiles.** A tile id in the snapshot with no render module renders as a generic key/value card titled by its id. A registered tile missing from the snapshot renders as an empty grey card. The page never throws on schema growth.
10. **Untrusted content is data.** Snapshot strings, ESPN text, and `/ask` answers are rendered as text (`textContent`), never as HTML. No `innerHTML` with data in it.
11. **The `/ask` key never reaches the page.** It's a Worker secret. The Worker enforces a **daily spend cap** (KV counter, UTC day, default $3.00 — configurable via secret `ASK_DAILY_CAP_USD`) and returns `429 {reason:"cap"}` past it.

## Repo layout

```
/CLAUDE.md
/docs/                      ← GitHub Pages root (the app shell)
  index.html  app.js  style.css
  tiles/_registry.js        ← id → {band, position, module, title}
  tiles/<id>.js             ← one file per tile: export function render(el, tile, ctx)
  live/espn.js              ← ESPN fetch + normalize (scoreboard, summary)
  live/graders.js           ← market → grader (see LIVE band)
  manifest.webmanifest  sw.js  icons/
/worker/
  worker.js  wrangler.toml
/tools/
  make-mock-data.js         ← fake snapshot generator (node, no deps)
/README.md                  ← ops runbook (deploy, secrets, token issue/rotate, cap)
```

## KV design (namespace binding: `HELM_KV`)

| Key | Value | Notes |
|---|---|---|
| `snapshot` | the full `helm-data.json` string | replaced atomically on publish |
| `tokens` | `{"<token>": {"name":"Matt","role":"owner"}}` | set via admin endpoint; **never in repo** |
| `evt:<utc-iso>:<rand6>` | one event JSON | **one key per event — never a single array key** (no atomic append in KV) |
| `ask:cap:<YYYY-MM-DD>` | `{usd: 0.42, calls: 7}` | daily spend counter, UTC day |
| `ask:sys` | the `/ask` system prompt text | loaded by admin endpoint from the vault owner's file; never committed |

KV is eventually consistent (~60s cross-edge) — acceptable; note it in README.

## Worker API

Auth: page endpoints take the token (`?t=` or `Authorization: Bearer`); admin endpoints take `X-Admin-Secret` (Worker secret `ADMIN_SECRET`). Unknown → 401 JSON. Never log token values or `/ask` bodies beyond length + cost.

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /api/data` | token | `{me:{name,role}, snapshot:<JSON>, pending:[events]}` |
| `POST /api/event` | token | validate `type` ∈ the event list below + shape; stamp `{id, ts, actor}`; write `evt:` key; return stored event |
| `DELETE /api/event/:id` | token | delete ONE still-pending event, only if `actor` matches caller; 404 once drained. The undo valve — never bulk |
| `GET /api/health` | token | `{published_at, pending_count, ask_today_usd}` |
| `POST /api/ask` | token | body `{q, tile_id?, tile_data?, history?: [{role, content}] (≤ 10)}` → `{answer, mode:"snapshot", usd}`. See §Ask |
| `POST /api/admin/publish` | secret | body = full snapshot → validate parses + `schema` present → write `snapshot` |
| `GET /api/admin/events` | secret | list all `evt:*` |
| `POST /api/admin/events/ack` | secret | `{ids:[…]}` → delete those keys only |
| `POST /api/admin/tokens` | secret | replace token map |
| `PUT /api/admin/ask-system` | secret | body = text → `ask:sys` |

CORS: allow `https://mlancourt.github.io` and `http://localhost:*` (dev). Handle preflight.

## Snapshot contract — `helm-data.json` (schema 1)

```jsonc
{
  "schema": 1, "generated_at": "<UTC ISO>", "run_id": "run-…", "tz": "America/Chicago",
  "tiles": {
    "<tile_id>": { "band": "LIVE|HOURLY|DAILY|WEEKLY", "updated_at": "<UTC ISO>",
                   "status": "ok|stale|error", "error": null, "data": { /* per tile */ } }
  }
}
```
`pending` comes from the Worker, not the snapshot. Never require fields beyond this; tolerate extras.

### v1 tile payloads (render modules to build)

| id | band | `data` | render |
|---|---|---|---|
| `bets_live` | DAILY publish, **LIVE grade** | `{bankroll_u, open_u, record, tickets:[{id, league, espn_event_id, game, kick_ct, market, side, line, player, label, stake_u, price, class}]}` | header: open / lean-now / closed units · one card per game (score, clock) · one row per ticket: stripe + label + why + pill (PRE/LEADING/TRAILING/COVERING/WIN/LOSS/DEAD) + stake@price. Grades in-browser every 45 s while any ticket's game is `in`. Footer: "lean, not settlement." |
| `today_games` | LIVE | `{title, date_ct, leagues:[{id, slug, label, emoji}], services:[…], watch_map:{<broadcast>: <service>}, local_teams:{<slug>: [abbr]}}` | menu tile: one button per league with a `{n} games` chip and a live-dot; tap → sheet with today's slate, chronological by kick, showing kick time (Central) / live score + clock / Final, plus watch chips — `✓ <service>` when `watch_map` has the broadcast name, the raw name when it does not, `regional — not yours` for a `Home`/`Away` feed whose team is not in `local_teams`. Page fetches ESPN `scoreboard?dates=<date_ct>` per league, shared with `bets_live`. Replaced `mke_board` (retired 2026-09-17). |
| `radar` | DAILY | `{date, lines:[…], source}` | plain list, verbatim, date in header |
| `calendar` | DAILY | `{days:[{date, events:[{time_ct, title, cal}]}]}` | today + tomorrow, two-tone by `cal` (family / wss) |
| `local_events` | DAILY | `{title, window:{from,to}, count, days:[{date, label, events:[{date, time, title, venue, address, link, source, blurb, multi_day}]}], sources:[…], errors:[…]}` | "Lake Country" (vault spec `06-AI-Stack/The-Helm/Local-Tile-Spec.md`, L1–L6). Day groups: header = `label`, rows = `time · title · venue`, whole row an external link. Today + tomorrow **by date** inline, capped at the menu tiles' height; everything else behind "+N more" → the shared sheet with the full week, plus `blurb` and `source`. `multi_day` after the first appearance wears a "cont." mark. `stale` → rows + a ⚠︎ whose tooltip is `error`; `error` → the rule-9 generic card. No localStorage, no badges. |
| `dinner` | DAILY | `{date, meal, notes, verdict}` | meal + two buttons **HIT / MISS** → `meal_verdict` event; badge pending |
| `purser_due` | DAILY | `{items:[{card, due, amount, amount_display, autopay, reminder_armed}]}` | rows, days-to-due chip, amount only if `amount_display` |
| `newsstand` | HOURLY | `{cards:[{title, source, url, lens}], as_of}` | compact card list, external links open new tab |
| `ask` | ASK | — | chat panel, bottom sheet on phone; `q` + optional pinned tile context; history kept in memory only |

Every tile supports **long-press / right-click → "Explain"** → opens `ask` with `tile_id` + that tile's `data` pinned.

## Event types (`POST /api/event`) — exactly these

```json
{"type":"meal_verdict",  "payload":{"date":"YYYY-MM-DD","verdict":"HIT|MISS|MEH"}}
{"type":"build_request", "payload":{"text":"…"}}
{"type":"field_note",    "payload":{"text":"…"}}
{"type":"mileage",       "payload":{"odometer":74812,"kind":"business|personal","note":null}}
```
Reject anything else with 400 + reason. `build_request` also has a UI entry: in the ask panel, a message starting with `add a tile` / `build` / `I want a tile` offers a one-tap "File as build request" instead of answering.

## LIVE band — ESPN + graders (proven in the Phase 0 spike, 2026-09-17)

- Base `https://site.api.espn.com/apis/site/v2/sports/<league>/scoreboard?dates=YYYYMMDD&limit=60` — **always pass `dates=`** (the default view is not "today"). Match games by **`event.id` = ticket.espn_event_id**, never by team name (ESPN abbreviations drift: `OLM`, `BES`, `LEVS`).
- Normalize: `{home:{abbr,score,linescores}, away:{…}, state:"pre|in|post", detail, period, clock}` from `competitions[0]`. `linescores` is **null pre-game**, per-period once live.
- NFL scoring plays: `…/football/nfl/summary?event=<id>` → `scoringPlays[]` (`type.abbreviation`, `text`). **Key absent pre-game — default `[]`.** Fetch summary only when the game is `in|post` and a ticket needs it.
- Graders (`live/graders.js`) return `{state:"pre|lead|trail|win|lose|push", label, why}`:
  - `ml` (side) · `spread` (side, line; full game uses final score, `spread_1h` sums linescores[0..1] and is decided at `period >= 3`) · `total_over`/`total_under` (line) · `anytime_td` (player surname in a TD scoring play) · `btts` (both > 0).
  - `anytime_goal` for soccer: **shape not yet verified** — implement behind a feature flag, verify against a live summary before enabling, otherwise render "grading unsupported."
- Refresh: 45 s while any relevant game is `in`; 5 min when all `pre`; stop at `post`. Show the last-fetch time (Central) in the tile header; on fetch error keep the last good grade and show "feed unavailable."
- **Wording rule (non-negotiable):** the tile says *lean*, never *settled*. A different system settles bets; this page is the scoreboard's opinion.

## Ask (v1 — snapshot-smart)

`POST /api/ask` → Worker builds: system = `ask:sys` text + the current snapshot (JSON, tiles only, minus any tile whose `data` exceeds 8 KB — truncate with a note) + pinned tile if given; messages = `history` + `q`. Calls the Anthropic Messages API (model id via secret `ASK_MODEL`, default the newest Sonnet-class; `max_tokens` 800). Record cost estimate to `ask:cap:<day>`; enforce the cap before calling. Return `{answer, mode:"snapshot", usd}`. Timeout 25 s → `504 {reason:"timeout"}`. Never stream in v1.

The page's ask panel: shows `mode` as a small chip ("snapshot" now; "vault" later), keeps ≤ 10 turns in memory, has "Explain this tile" prefill, and the build-request affordance above.

## PWA

`manifest.webmanifest` (standalone, dark theme color, icons 192/512 — generic helm/compass glyph you draw, no brand marks), `sw.js` caches the shell + last `/api/data` response (stale-while-revalidate for the shell; network-first for data; **never cache ESPN or `/ask`**). Home-screen install on iOS must work.

## Mock data (`tools/make-mock-data.js`)

Generates a valid schema-1 snapshot with all v1 tiles populated from **invented** content (fake teams allowed but use real ESPN league slugs and a real-looking `espn_event_id` format), plus 2 pending events. `node tools/make-mock-data.js > docs/mock/helm-data.json`; `?mock=1` on the page loads it instead of the Worker (dev only; strip nothing — the mock path stays in the repo, the mock file is fake by construction).

## Milestones

| M | Deliverable | Done when |
|---|---|---|
| M1 | Worker + KV + token + `/api/data` + `/api/event` + admin publish/events/ack; README runbook | `curl` round-trip: publish mock → data → event → admin events → ack |
| M2 | Page shell + tile registry + all v1 render modules on mock data; PWA installable | opens on an iPhone from the home screen, every tile renders, unknown-tile card works |
| M3 | LIVE band: ESPN fetch + graders + `bets_live` / `mke_board` live | a real-schedule mock ticket grades against a real live game |
| M4 | `/ask` v1 with cap + Explain long-press | one answer from the snapshot on the phone; cap trips at the configured number |

Tests (Worker, `wrangler dev` + node): token 401s; event shape rejection; per-event KV keys; delete-event actor check; cap enforcement; snapshot validation. Page: graders are pure functions — unit-test every market with fixture game objects (pre / in / post / push).

## Change log

**v1.0 (2026-09-17):** initial brief — schema 1, nine v1 tiles, four event types, ESPN LIVE band as proven by the spike, `/ask` v1 with cap.

**v1.3 (2026-09-17):** `local_events` ("Lake Country") added — vault spec `Local-Tile-Spec.md`, rulings L1–L6. First tile to read its own `status`, so `renderGeneric` moved out of `app.js` into `lib/dom.js` as `genericCard()` and both paths now share one definition of what rule 9's card looks like.

**v1.1 (2026-09-17):** `mke_board` retired and replaced by `today_games` (vault spec `06-AI-Stack/The-Helm/Todays-Games-Tile-Spec.md`). One ESPN scoreboard call per league per tick now serves both LIVE tiles — `live/band.js` builds a single deduped `(league, date)` plan; a tile module still never fetches. `live/espn.js` gained `broadcasts` (the `broadcasts[]`/`geoBroadcasts[]` merge), `venue`, `short` team names, and `compactCtDate()` — `date_ct` → `dates=` by string ops only.
