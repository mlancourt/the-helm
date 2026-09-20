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
4. **No external CDNs, fonts, analytics, or trackers.** Self-contained assets. Must load on one bar of LTE. The **only** external calls the page makes are to the Worker, to `site.api.espn.com`, and to the two NWS origins below — **plus one carve-out (Matt, 2026-09-18): listing images whose URLs arrive in the snapshot** (e.g. eBay thumbnails on `cards`). Rules for that carve-out: `<img>` only, never script/style/fetch; `http(s)` URLs only; `referrerpolicy="no-referrer"`, `loading="lazy"`; never cached by the service worker; a same-size placeholder when absent. Content the user will judge by eye is data, not a dependency.
   - **`api.weather.gov` (fetch)** — amended in by Matt 2026-09-19 (Weather spec, W3). Alerts, forecast, hourly, observations. No key, and **no custom header**: a header makes the request non-simple and triggers a CORS preflight the NWS need not answer. (The *engine's* Python client does need a `User-Agent`; the browser does not. Do not "fix" the page by adding one.) `live/nws.js` is the only file that may call it.
   - **`radar.weather.gov` (`<img>` only)** — same amendment. Never fetch, script, style or `link`; `referrerpolicy="no-referrer"`, `loading="lazy"`, **never cached by the service worker**, loaded only when the tile reaches the viewport, and a tap-to-load placeholder on a metered connection (it is a ~1 MB GIF). It is not CORS-open, so JS could not read those pixels if it wanted to — which is exactly why rule 3 still holds here: **no Leaflet, no tile library, no WMS client.**
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
  live/nws.js               ← NWS fetch + normalize (alerts, forecast, hourly, obs, radar url)
  live/band.js              ← the clocks: one controller for ESPN, one for the NWS
  manifest.webmanifest  sw.js  icons/
/worker/
  worker.js  wrangler.toml
/tools/
  make-mock-data.js         ← fake snapshot generator (node, no deps)
  dom-shim.js               ← the 60-line DOM the tile tests render into (rule 3, not jsdom)
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
| `bets_live` | DAILY publish, **LIVE grade** | `{bankroll_u, open_u, record, tickets:[{id, league, espn_event_id, game, kick_ct, market, side, line, player, label, stake_u, price, class, sport, to_win_u}], form:{window_days, since, record, wins, losses, net_u, win_pct, streak, last:[{r:"W"|"L", u, d, s, label}]}\|null}` | v1.6.0 "the facelift" (vault spec `06-AI-Stack/The-Helm/Bets-Live-Tile-Spec.md`, rulings B1–B9). Header: bankroll / open / lean-now / closed / record, then the 7-day form line — `7d {record} · {±net_u}u · {win_pct}%` + streak chip (`🔥 W5` / `🧊 L3`) + 10 dots newest-left, each row in its tooltip; hidden entirely when `form` is null. One card per game, **in-play first, then upcoming by `kick_ct`, then decided**, matchup prefixed with `ticket.sport`; tickets keep snapshot order. One row per ticket: stripe + label + why + pill (PRE/LEADING/TRAILING/COVERING/WIN/LOSS/DEAD) + **its units figure** (`+to_win_u` green leading/won, `−stake_u` red trailing/lost/dead, `0.00u` push, plain stake grey pre — and the plain stake in every state when `to_win_u` is null) + stake@price. **Lean-now is the signed sum of exactly those row figures** — header and rows reconcile by construction. **The page never does odds math**: `to_win_u` is the engine's, and there is no payout helper in the repo. Early locks (B3): WIN/LOSS the moment the maths is final — over/under on clearing the line, `spread_1h` at halftime or `period >= 3`, anytime TD/goal on the scoring play, `btts` when both score; `ml`/`spread` stay LEADING/TRAILING to the whistle; a locked state never regresses. State-flip pulse (B8): one ~600 ms glow, green toward WIN / red toward LOSS, previous states in module memory only. Bankroll is a plain number — no colour, no commentary (B9). Grades in-browser every 45 s while any ticket's game is `in`. Footer: "lean, not settlement." |
| `bets_ledger` | DAILY | `{as_of, slate_day, bankroll_u, streak, windows:{7d,30d,slate:{n,wins,losses,record,net_u,staked_u,roi_pct,win_pct,since}}, curve:[{d,u}], hwm:{d,u}, lwm:{d,u}, by_sport:[{s,…rec}], by_class:[{tag,…rec}], class_min_n, class_other:{classes,…rec}, price:{dog,fav,even}, receipts:{best_ticket,worst_ticket,best_day,worst_day,longest_w,longest_l,biggest_stake}, passes:{7d,30d,slate}, reconcile:{rows_record,rows_net_u,ledger_record,ledger_net_u,gap_u}, voids, rows}` — **every sub-block optional** | v1.14.0 "The Ledger" (vault spec `06-AI-Stack/The-Helm/Bets-Ledger-Tile-Spec.md`, rulings L1–L10). The look-back to `bets_live`'s sweat: settled W/L rows only, since the slate. Face: bankroll (one decimal, plain) + the streak chip shared with `bets_live` via `lib/bets.js` → **hand-drawn inline-SVG sparkline** from `curve` (no chart library — rule 3; dotted 100u baseline, 12% fill, ⬆ HWM / ⬇ LWM dots, and a last dot **labelled with `bankroll_u`, not the curve's last point** — L2: the rows are a sum, the Bookie's ledger is truth) → three window cells `7d · 30d · slate` (record, ±net_u by sign, ROI, omitted when null; **not tappable in v1**) → chips `🤚 {passes.7d} passes this week` · `{rows} tickets since {slate_day}`. Sheet (tap the body): by sport with signed proportional bars → angle leaderboard (🏆 first / 💀 last when ≥2, monospace tags, `class_other` muted, section hidden when `by_class` is empty) → 🐕 dog vs 🏦 favorite (+ ⚖️ even only when `n > 0`) → six receipts (💰🩸📈📉🔥🧊, streak rows `W6 · from → to`) → footer `settled rows only · voids {voids}`, with the reconcile half **only when `gap_u ≠ 0`**. **Colour is the sign of the printed number and nothing else (L9)** — one `tone()` in the module, no drawdown shading, no pace, no threshold, no `--warn` anywhere in its stylesheet block; held by a class scan, a `cls:` source scan and a CSS scan. Passes are a count: no units, no "would have", ever (L8). Every date rendered verbatim; the module contains no `new Date` and no clock. **Nothing here is a lean** — the `bets_live` footer wording is deliberately absent. |
| `today_games` | LIVE | `{title, date_ct, leagues:[{id, slug, label, emoji}], services:[…], watch_map:{<broadcast>: <service>}, local_teams:{<slug>: [abbr]}}` | menu tile: one button per league with a `{n} games` chip and a live-dot; tap → sheet with today's slate, chronological by kick, showing kick time (Central) / live score + clock / Final, plus watch chips — `✓ <service>` when `watch_map` has the broadcast name, the raw name when it does not, `regional — not yours` for a `Home`/`Away` feed whose team is not in `local_teams`. Page fetches ESPN `scoreboard?dates=<date_ct>` per league, shared with `bets_live`. Replaced `mke_board` (retired 2026-09-17). |
| `weather` | LIVE | `{title, place, point, grid:{office,x,y,forecast,hourly}, alerts_url, station:{id,name,obs}, radar:{site,label,loop,w,h,behind_min}, sun:{date,sunrise_ct,sunset_ct}, glyphs:{<token>:<emoji>}, warn_events:[…], mute:[…], clock:{normal_s,warned_s,forecast_s}, fallback:{as_of, now, days, alerts}\|null}` | v1.9.0 (vault spec `06-AI-Stack/The-Helm/Weather-Tile-Spec.md`, rulings W1–W15). **The engine publishes configuration and one offline copy only; the page fetches `api.weather.gov` itself** on the weather band's clock — alerts + observation every `normal_s` (dropping to `warned_s` while any un-muted alert is in `warn_events`), forecast + hourly every `forecast_s`, paused while the tab is hidden and fetched immediately on its return. Face: alert row (red `warn` / amber `watch` / grey `advisory`, `{event} · until {h:mm}`, `+N` for the rest) → now-line (glyph, big temp, `shortForecast`, then wind · RH · dew and **the source label**, `KUES · 6:45 AM` or `forecast` — an observation older than 75 min or with an empty `textDescription` is never presented as "now") → lazy radar GIF in a fixed `w/h` box → seven-day strip (`{day} {glyph} {hi}/{lo} {pop}%`, pop hidden under 15%, and after 6 PM the first row is tonight's low with **no invented high**). A **Warning** also paints a board-level banner above the tile grid — dismissible in memory only, and it **never auto-opens anything**. Sheet: radar full width → the alerts in full → the seven days with `detailedForecast` → sunrise/sunset → `KMKX · KUES · fetched {h:mm}`. Glyphs come from parsing the `icon` token (incl. the dual `tsra,90/tsra,80` form); an unknown token is `•` and the text carries the meaning. **Prefer live; fall back to `data.fallback` greyed with its `as_of`; say "feed unavailable" only when both are gone.** The tile files nothing — no events, no writes, the only link out is the NWS's own alert page. Replaced `radar` (retired 2026-09-19). |
| `calendar` | DAILY | `{days:[{date, events:[{time_ct, title, cal}]}]}` | today + tomorrow, two-tone by `cal` (family / wss) |
| `local_events` | DAILY | `{title, window:{from,to}, count, days:[{date, label, events:[{date, time, title, venue, address, link, source, blurb, multi_day}]}], sources:[…], errors:[…]}` | "Lake Country" (vault spec `06-AI-Stack/The-Helm/Local-Tile-Spec.md`, L1–L6). Day groups: header = `label`, rows = `time · title · venue`, whole row an external link. Today + tomorrow **by date** inline, capped at the menu tiles' height; everything else behind "+N more" → the shared sheet with the full week, plus `blurb` and `source`. `multi_day` after the first appearance wears a "cont." mark. `stale` → rows + a ⚠︎ whose tooltip is `error`; `error` → the rule-9 generic card. No localStorage, no badges. |
| `dinner` | DAILY | `{date, meal, vibe, notes, verdict, week_of}` | **read-only** (v1.5.1, Matt 2026-09-18): meal + notes, plus the vault's `verdict` when it carries one. **No HIT / MISS buttons** — new-recipe verdicts are ruled in the Meal Planner's approval pass, not on the board. Don't re-add a write affordance here; `meal_verdict` stays a valid event type but nothing files one. |
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

**v1.15.0 (2026-09-20):** the board is **one flat grid in Matt's order** — band headers gone. `position` is now the whole of the layout authority (renumbered in tens so an insert needs no renumber); `band` stays in the registry because it never described layout in the first place — it says how often the engine refreshes a tile, and it is what keeps `ask` off the board and out of module preloading. Safe by construction: the fetch clocks in `live/band.js` key off the SNAPSHOT payloads (`tiles.bets_live`, `tiles.today_games`, `tiles.weather`), never off `REGISTRY.band`, so grouping was cosmetic and removing it touches nothing that fetches. `BAND_ORDER` / `BAND_LABEL` deleted rather than left behind — nothing imported them after `bandRank()` went, and a dead export rots. Rule 9 is unchanged in both directions: an unregistered snapshot tile has no position, sorts to the end at 500 and still renders its generic card; a registered tile the snapshot has dropped keeps its slot, greyed. Two older tests froze one tile's position number each (`weather` at 14, `today_games` at 20) and both were loosened to assert what they were actually about — band and title — because the ORDER is now asserted whole, once, in `tools/test-shell.js`, which runs the shipped `renderAll` and `tileCard` against stubs and reads the fourteen card titles back in sequence.

**v1.14.0 (2026-09-20):** tile `bets_ledger` ("The Ledger") added — registry #2, DAILY, directly under `bets_live`; vault spec `Bets-Ledger-Tile-Spec.md`, L1–L10. The board's **first drawing**: a hand-built inline-SVG sparkline, which needed `svgEl()` in `lib/dom.js` (`createElement('svg')` makes an HTMLUnknownElement that renders nothing, and an SVG element's `className` is a read-only `SVGAnimatedString`) and `createElementNS` in `tools/dom-shim.js`. `streakChip()` moved out of `bets_live.js` into the new `lib/bets.js` and is now shared by both bet tiles — 🔥 W5 means one thing on one board. **The ruling with teeth is L9:** colour is the sign of the number being printed, never a drawdown, a pace or a threshold, so the module has exactly one `tone()`, every `cls:` in it is a bare literal or a `${tone(…)}` template, and the tile's stylesheet block never names `var(--warn)` — a bankroll 40u under water renders the identical class set to a winning one, asserted by diffing the two. **L2's small, deliberate disagreement:** the sparkline's last dot sits where the settled rows put it and its label reads `bankroll_u`, because the curve is a row sum and the Bookie's ledger line is truth; the gap between them is the sheet footer's reconcile line and closing it is a Bookie task, never page math. Second tile to make its whole face a tap target — a `role="button"` div rather than a `<button>`, so the shell's long-press-to-Explain still reaches it.

**v1.0 (2026-09-17):** initial brief — schema 1, nine v1 tiles, four event types, ESPN LIVE band as proven by the spike, `/ask` v1 with cap.

**v1.3 (2026-09-17):** `local_events` ("Lake Country") added — vault spec `Local-Tile-Spec.md`, rulings L1–L6. First tile to read its own `status`, so `renderGeneric` moved out of `app.js` into `lib/dom.js` as `genericCard()` and both paths now share one definition of what rule 9's card looks like.

**v1.1 (2026-09-17):** `mke_board` retired and replaced by `today_games` (vault spec `06-AI-Stack/The-Helm/Todays-Games-Tile-Spec.md`). One ESPN scoreboard call per league per tick now serves both LIVE tiles — `live/band.js` builds a single deduped `(league, date)` plan; a tile module still never fetches. `live/espn.js` gained `broadcasts` (the `broadcasts[]`/`geoBroadcasts[]` merge), `venue`, `short` team names, and `compactCtDate()` — `date_ct` → `dates=` by string ops only.

**v1.13.0 (2026-09-20):** `cards` gains its last face — 🏷️ **Shop**, Matt's OWN eBay storefront (`tiles.cards.data.shop`, engine live 2026-09-20). Active listings and what has dropped off the board since the last sweep — and **not** watchers or pending best offers: both need user OAuth and the legacy Trading API, eBay's own app already pushes them to his phone, so they are out of scope by ruling with no "coming soon" stub left behind. Like PC it is not a gate (no FMV, no percentage, no ✓, no MAX); unlike PC it has no serial or grade badges either, because these are his listings, not finds. **`days_listed` is a plain neutral number at every value** — no red, no amber, no "stale" badge, no sorting that implies judgement, no "N days and no offers" line: Matt owns this board and has a standing ruling against the tile narrating it back at him, so the number is information and a colour would be an opinion. Enforced by a class scan across every age including 365 days, a source scan proving every class the Shop region emits is a bare string literal (no branch can pick a tone), and a stylesheet check that `.shop-days` has exactly one rule. The dropped-off section is headed **`No longer active`**, never "Sold" — eBay's public data cannot tell a sale from an expiry, so the header does not claim to, a muted line says so out loud, and those rows are plain `<div>`s because the listing is gone and its URL 404s. `shop: null` keeps the greyed "soon" button exactly as before. Third tile region with its own row builder: `genericFaceBody` is deleted, since all three faces now answer for themselves.

**v1.12.0 (2026-09-20):** `cards` gains a third face — 🎖️ **PC**, the personal-collection bookend net (`tiles.cards.data.pc`, engine live since 2026-09-20). **PC is not a gate.** Watch asks "is this under 65% of book"; PC asks "does this exist" — a bookend is one of one by definition, so there is no matched-grade tape, no FMV, no percentage and no MAX, and price is Matt's to judge. The sheet therefore shares only the thumbnail, title clamp, price line, seller line and countdown with Watch, and builds its own rows: a PC row that looked like a cleared flag would claim an opinion the engine has never had. Badges are the SERIAL (violet, the anchor, `serial` verbatim) and the GRADE (secondary, verbatim); `one_of_one` wears the serial badge in gold. **Amber now means one thing per sheet** — "ending inside two hours" on Watch, "one of one" on PC — so the 1/1 gold is its own token (`--pc-one`, never `--warn`) and PC auction rows never go amber, though they reuse the v1.6.0 countdown otherwise unchanged. `ship: null` renders `+ ship?` and omits the all-in clause entirely rather than printing a dangling arrow or an invented total. `pc: null` greys the button to "soon" exactly as `shop` does. Enforced by class scans, a `--pc-one` vs `--warn` token comparison, and a source scan asserting the PC region never reaches for `listingRow` or the gate chip.

**v1.11.1 (2026-09-20):** `cards` auction end time — **`ends_utc` is now the source of truth for the displayed time as well as the countdown** (Matt, overturning v1.11.0's verbatim call). The secondary line reads `ends 7:48 PM`, formatted by `ctTime()`, which pins `America/Chicago` in the formatter and never reads the device: this is a Central board, and a phone in another zone must not shift it. `ends_ct` is **no longer a display field** — the only row that prints it is one whose `ends_utc` is missing, printed raw. The old "`ends_ct` appears in the DOM exactly as delivered" test encoded the wrong invariant and is gone; the invariant that stands is **`ends_ct` is never handed to Date / Date.parse / msUntil**, held by a source scan, a Date spy, and a check that a row with an instant renders no raw ISO string. `msUntil()`'s offsetless guard is unchanged and remains the enforcement point.

**v1.11.0 (2026-09-20):** `cards` tile v1.6.0 — live auction countdowns. Auction rows in `watch.auctions[]` gain `ends_utc`, a real UTC instant beside the wall-clock `ends_ct`, and every countdown is counted from it: **rule 7 is satisfied here, not relaxed** — the rule forbids `new Date(ends_ct)` because an offsetless string makes the browser guess a zone, and `ends_utc` leaves nothing to guess. `ends_ct` is still printed verbatim and is still never parsed. The maths lives in `lib/fmt.js` as `msUntil()` + `countdown()`, so `new Date` does not appear in `cards.js` at all, and `msUntil()` **refuses any string without an offset** — handed `ends_ct` it returns null and the row falls back to the pre-v1.6 line rather than answering confidently wrong. `ctNowStamp()`/`minutesUntilCt()`, the wall-text workaround that existed only because there was no instant, are deleted. First tile to run a clock inside the detail sheet: `app.js`'s `openPanel` now takes a teardown back from a body builder and runs it on close, on a second open, and when Ask takes the scrim — one interval per sheet, 1 s inside the hour and 30 s outside, repainting on `visibilitychange`. A lot at zero greys and reads `ended`; it leaves the board on the engine's next pass, never mid-scroll.

**v1.9.0 (2026-09-19):** tile `weather` added (registry #14, LIVE) and `radar` **retired outright** — its producer had been publishing since 9/17 into a page module that was never built, so deleting `radar()` from the engine shipped in the same batch. Second tile on the "engine publishes config, page fetches" pattern after `today_games`, and the first to bring new origins with it: hard rule 4 gains `api.weather.gov` (fetch, no header) and `radar.weather.gov` (`<img>` only, never SW-cached). `live/nws.js` joins `live/espn.js` as a second fetch-and-normalize module; `live/band.js` gains a second controller on its own clock. The DOM shim the tile tests run on moved out of `tools/test-tiles.js` into `tools/dom-shim.js` so `tools/test-weather.js` could share one definition of what a DOM is.

**v1.8.0 (2026-09-18):** Entertainment Listening sheet body — upcoming Audible releases per series; all four faces have bodies.

**v1.7.0 (2026-09-18):** Entertainment Top 5 sheet body — ranked rows, provider chip, rating, 2-line overview, TMDB footer.

**v1.6.1 (2026-09-18):** card nameplates — brass condensed uppercase titles + rule + diamond, CSS only, spec `Card-Nameplate-Spec.md`.
