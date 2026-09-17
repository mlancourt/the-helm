# The Helm

A single-user personal homepage for Matt: a phone-first PWA that renders a JSON
snapshot as tiles, grades open sports bets live in the browser, and carries a
chat box answered by a Worker.

**This repo is the presentation + transport layer only.** The source of truth is
Matt's vault + engine, which lives elsewhere and talks to this Worker over the
admin endpoints. Nothing here generates real data. See `CLAUDE.md` for the
build brief and the hard rules.

Status: **M1 + M2 + M3 + M4 complete** — Worker, KV, token auth, events, admin
publish/drain; page shell, tile registry, all v1 render modules, PWA; LIVE band
with in-browser ESPN fetch and bet graders; `/ask` v1 answering from the
snapshot behind a daily spend cap, with long-press Explain on every tile.

---

## Layout

```
worker/worker.js        the whole API — one self-contained file, plain JS
worker/wrangler.toml    name, KV binding, compatibility date

docs/                   GitHub Pages root — serve this directory, nothing else
  index.html app.js style.css config.js
  lib/dom.js            safe DOM construction (no innerHTML, anywhere)
  lib/fmt.js            dates, units, odds — the rule-7 quarantine
  tiles/_registry.js    id -> {band, position, module, title}
  tiles/<id>.js         one file per tile: export function render(el, tile, ctx)
  live/espn.js          ESPN fetch + normalize
  live/graders.js       market -> grader, pure functions
  live/band.js          the polling loop and cadence
  manifest.webmanifest sw.js icons/
  mock/                 generated fake data, fake by construction

tools/make-mock-data.js fake snapshot generator
tools/make-icons.js     draws the PWA icons (zero deps, zlib only)
tools/make-live-mock.js builds a snapshot against TODAY'S REAL ESPN slate
tools/fixtures/         real ESPN payloads, captured for the grader tests
tools/test-fmt.js       date/format unit tests, run across four timezones
tools/test-sw.js        service worker caching-policy + precache-parity tests
tools/test-tiles.js     every render module, incl. hostile payloads (DOM shim)
tools/test-ask.js       the /ask route, against a fake KV and a stubbed model
tools/test-worker.js    Worker API tests (needs wrangler dev)
tools/ask-probe.sh      one real /ask against the deployed Worker, shape only
```

`wrangler` is the only dev dependency. The page itself has no build step: no
bundler, no framework, no npm at runtime. Open `docs/index.html` through any
static server and it runs.

---

## Local development

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars   # gitignored; edit the secret
npm run dev                                    # wrangler dev on :8787
```

Serve the page in a third terminal:

```bash
npm run serve
```

Then open one of:

| URL | What it does |
|---|---|
| `http://127.0.0.1:8080/?mock=1` | renders the fake snapshot, no Worker at all |
| `http://127.0.0.1:8080/?mock=drift` | the schema-drift fixture (see rule 9 below) |
| `http://127.0.0.1:8080/?mock=live.local` | real event ids — watch the graders work |
| `http://127.0.0.1:8080/?api=http://127.0.0.1:8787&t=<token>` | the real local Worker |

`?api=` is honoured **only when the page itself is on localhost**. On the real
origin it is ignored, because otherwise a crafted `?api=https://evil.example`
link would make the page post Matt's bearer token straight at an attacker.

### Tests

```bash
npm test            # 495 assertions, no server needed
npm run test:worker # 62 assertions, needs `npm run dev` running
```

- **`test:fmt`** (75) — every date helper, run under `America/Chicago`,
  `Asia/Tokyo`, `UTC` and `Pacific/Kiritimati`, asserting byte-identical output
  in all four. This is the rule-7 tripwire.
- **`test-graders`** (111) — every market across pre / in / post / push, run
  against **real ESPN payloads** captured in `tools/fixtures/`. Inventing
  fixtures would only prove the graders agree with my guess about ESPN's shape,
  which is the exact thing worth testing.
- **`test-band`** (44) — the LIVE loop's decisions rather than its arithmetic:
  cadence, one summary per game and only once it is under way, one scoreboard
  per league, event-id matching, and that a dead feed keeps the last good
  grades instead of blanking them.
- **`test:sw`** (38) — the service worker's routing policy: ESPN and `/ask` are
  never cached, `/api/data` is network-first with a cache fallback, the shell is
  stale-while-revalidate, and a 404 in the precache list cannot fail an install.
  It also asserts precache parity: every module the registry names is in `SHELL`.
- **`test:ask`** (82) — the whole `/ask` route, driven against a fake KV
  namespace and a stubbed model API: pricing and cost estimation, history
  trimming, the 8 KB per-tile truncation, the pinned tile, cap enforcement at
  the configured number, and every degradation path (no key, no system prompt,
  timeout, upstream error, corrupt snapshot, refusal, truncation). worker.js is
  a plain ES module, so the route runs in Node with no wrangler and no network.
  **No test ever calls a real model** — nothing here can spend money.
- **`test-tiles`** (145) — every render module, against the mock snapshot and
  against deliberately hostile payloads: empty, null, wrong-typed, all-fields-
  missing, and carrying fields no module has heard of. No module may throw at
  any of them, because a module that throws turns one card into "this tile
  failed to render" on a phone. The DOM is a 60-line shim, not a dependency.
  `HELM_SNAPSHOT=/path/to/snapshot.json node tools/test-tiles.js` runs the same
  suite against a real snapshot and prints pass/fail only, never content.
- **`test:worker`** (62) — token 401s, event shape rejection, per-event KV keys,
  the delete-event actor check, snapshot validation, ack scoping, CORS, routing.
  Its `/ask` checks are deliberately limited to the free paths (401, 400, and
  "answered or degraded with a documented reason"), so pointing `wrangler dev`
  at a live key cannot bill a model call on every test run.

Regenerate the fake data or the icons any time:

```bash
npm run mock
npm run icons
npm run mock:live   # rebuilds the real-slate fixture (gitignored)
```

`?mock=1` uses **invented** event ids, so the LIVE band correctly reports "no
ESPN event matched this ticket" for every one of them. That is the honest
degradation path, not a bug. To watch grading actually happen, run
`npm run mock:live` and open `?mock=live.local`.

---

## First deploy

### 1. KV namespace

```bash
npx wrangler kv namespace create HELM_KV
npx wrangler kv namespace create HELM_KV --preview
```

Paste both ids into `worker/wrangler.toml` (`id` and `preview_id`). They are not
secrets.

### 2. Secrets

```bash
cd worker
npx wrangler secret put ADMIN_SECRET          # required — long random string
npx wrangler secret put ANTHROPIC_API_KEY     # required for /ask — never reaches the page
npx wrangler secret put ASK_DAILY_CAP_USD     # optional — default 3.00
npx wrangler secret put ASK_MODEL             # optional — default claude-sonnet-5
```

### 3. Deploy the Worker

```bash
npm run deploy
```

Note the `*.workers.dev` URL and put it in `docs/config.js` as `WORKER_BASE`.
That constant is the only place the page learns where its API lives.

### 4. Publish the page

GitHub Pages serves from `/docs` on `main`, so a push deploys it. Then open

```
https://mlancourt.github.io/the-helm/?t=<token>
```

once on the phone. The token moves into localStorage and is stripped from the
address bar, so every later visit works from the bare URL — and the token stops
riding along in screenshots, history and referrers.

**Install to the home screen (iOS):** Share -> Add to Home Screen. It opens
standalone, with no Safari chrome. Bump `CACHE_VERSION` in `docs/sw.js` when
shipping shell changes, or installed clients keep the old files.

---

## Token issue and rotation

Identity is one opaque token in the URL (`?t=…`), stored to localStorage on
first load so the bare URL works afterward. No accounts, no passwords. The token
map is a **map**, so a second read-only token can be added later with no code
change.

Mint one:

```bash
openssl rand -hex 24
```

Install it (this **replaces** the whole map — always send every token you want
to keep):

```bash
curl -X POST "$HELM/api/admin/tokens" \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  -d '{"<token>":{"name":"Matt","role":"owner"}}'
```

Rotating = POSTing a new map without the old token. It stops working on the next
read, subject to KV's ~60s cross-edge lag. Tokens must be at least 16
characters; the Worker rejects anything shorter, and never logs or echoes a
token value.

The `/ask` system prompt comes from the vault owner and is **never committed**:

```bash
curl -X PUT "$HELM/api/admin/ask-system" \
  -H "X-Admin-Secret: $ADMIN_SECRET" \
  --data-binary @ask-system.txt      # gitignored
```

---

## API

Page endpoints take the token as `?t=` or `Authorization: Bearer`. Admin
endpoints take `X-Admin-Secret`. Anything unauthenticated gets a 401 JSON body.
CORS allows `https://mlancourt.github.io` and `http://localhost:*`.

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /api/data` | token | `{me, snapshot, pending}` |
| `POST /api/event` | token | validate, stamp `{id, ts, actor}`, store; returns 201 + the stored event |
| `DELETE /api/event/:id` | token | withdraw ONE still-pending event, only if `actor` matches. 404 once drained |
| `GET /api/health` | token | `{published_at, pending_count, ask_today_usd, ask_cap_usd}` |
| `POST /api/ask` | token | `{q, tile_id?, tile_data?, history?}` → `{answer, mode:"snapshot", usd}`. See [Ask](#ask) |
| `POST /api/admin/publish` | secret | body = full snapshot; must parse and carry `schema` |
| `GET /api/admin/events` | secret | every pending event, oldest first |
| `POST /api/admin/events/ack` | secret | `{ids:[…]}` — deletes exactly those keys |
| `POST /api/admin/tokens` | secret | replace the token map |
| `PUT /api/admin/ask-system` | secret | body = text → `ask:sys` |

Error bodies are always `{error:true, reason, detail?}`. Reasons in use:
`unauthorized`, `bad_json`, `bad_shape`, `bad_type`, `bad_payload`, `bad_id`,
`not_actor`, `not_found`, `no_route`, `no_schema`, `weak_token`, `too_large`,
`cap`, `no_key`, `no_system`, `timeout`, `upstream`, `internal`.

### Events — exactly these four

```json
{"type":"meal_verdict",  "payload":{"date":"YYYY-MM-DD","verdict":"HIT|MISS|MEH"}}
{"type":"build_request", "payload":{"text":"…"}}
{"type":"field_note",    "payload":{"text":"…"}}
{"type":"mileage",       "payload":{"odometer":74812,"kind":"business|personal","note":null}}
```

Anything else is a 400 with a reason. **Writes are proposals, not truth** — an
event is pending until the engine applies it and acks it. The UI badges them
pending and never renders a submitted write as applied.

---

## KV design

| Key | Value |
|---|---|
| `snapshot` | the full `helm-data.json` string, replaced atomically on publish |
| `tokens` | `{"<token>": {"name":…,"role":…}}` |
| `evt:<utc-iso>:<rand6>` | one event JSON |
| `ask:cap:<YYYY-MM-DD>` | `{usd, calls}` — UTC day, expires after 14 days |
| `ask:sys` | the `/ask` system prompt text |

**One KV key per event, never a single array key.** KV has no atomic append, so
an array would silently drop writes whenever two events raced. The test suite
fires six concurrent writes and asserts all six survive.

KV is **eventually consistent — roughly 60s across edges**. A publish or a token
rotation can take about a minute to be visible everywhere. Events written from
the phone may not appear in `/api/admin/events` instantly. This is expected and
is why the engine drains by explicit id rather than by wiping a prefix.

Event ids are the KV key minus the `evt:` prefix and are validated against a
strict pattern, so a caller can never aim a delete at `snapshot` or `tokens`.

---

## Engine loop (the other side)

The engine owns the data; this Worker is only a mailbox.

1. `POST /api/admin/publish` with the full snapshot — replaces `snapshot`.
2. `GET /api/admin/events` — read what Matt proposed from the phone.
3. Apply them to the vault.
4. `POST /api/admin/events/ack` with exactly those ids — drains them.

If real data ever looks wrong on the page, **report it — never "fix" it here.**
The vault wins all conflicts. Money never moves from this UI; dollar figures in
the snapshot are display-only.

---

## The page

Vanilla ES modules, one stylesheet, no build step. Phone-first single column;
two columns at 640px, three at 1040px.

### Adding a tile

1. Write `docs/tiles/<id>.js` exporting `render(el, tile, ctx)`.
2. Add one line to `docs/tiles/_registry.js`.
3. Add the file to `SHELL` in `docs/sw.js` and bump `CACHE_VERSION`.
4. Give it invented data in `tools/make-mock-data.js` and run `npm run mock`.

`npm test` enforces steps 2-4: `test-sw` fails if a registered module is not
precached (online it works and offline it silently vanishes — the worst kind of
bug to find on a phone), and `test-tiles` renders every registered module
against the mock snapshot and against empty, null, wrong-typed and
unknown-field payloads.

`tile` is the snapshot entry (`{band, updated_at, status, error, data}`). `ctx`
carries `{id, title, snapshot, pending, actions, live}`, where `actions` are
`submitEvent`, `withdrawEvent`, `ask`, `openAsk` and `openPanel`.

You never have to do step 2 for the page to survive: an unregistered tile
renders as a generic key/value card. Step 2 is what gives it a real layout.

**Ids are contracts, titles are labels.** The heading a tile wears comes from
`_registry.js` and nothing else — rename it there freely, and never rename the
id to match. `mke_board` reads "Local Team Scoreboard"; the id stays
`mke_board` because the engine, the snapshot and every event key speak it. A
snapshot that carries its own `data.title` is ignored for the same reason: the
card head already prints one, and two would say it twice.

### Newsstand category menu

The newsstand tile is a **menu, not a list**: its body is one button per
category, and the stories live in a sheet. That keeps the tile the same height
class as everything else on the board — the old inline list dwarfed it.

The buttons are **derived from the payload**, never from a list in the page.
Every distinct `category` present gets one, labelled `<emoji> <category>` with
the card's own emoji and a count, in the order the payload first mentions them.
A category the vault invents tomorrow appears on its own with no deploy; two
spellings of one category (`Tech`, `tech`) are one button. Cards that arrive
with no `category` at all collect under one trailing **Uncategorised** button
rather than falling off the board. Below the grid, one faint line carries the
`as_of` freshness and the `refresh_note`.

Tapping a button opens the **detail panel** — the second sheet, `#panel`. It
shares the ask sheet's scrim and transitions but has its own body, so Ask's
transcript is never touched. It closes on the scrim, the ×, or Escape. Nothing
is remembered: the sheet is transient, so there is no per-viewer state to keep.

Any tile can use it: `ctx.actions.openPanel(title, build)`, where `build(body)`
fills a cleared body. A builder that throws greys the panel, not the board.

### Rule 9 — drift in both directions

The engine and the page ship on different clocks, so the page treats schema
drift as normal, not as an error:

- a tile in the snapshot with **no render module** -> generic key/value card,
  titled by its id, including a band the registry has never heard of
- a tile in the registry **missing from the snapshot** -> empty grey card
- a tile whose module **throws** -> that one card greys with the message; the
  rest of the board renders

`?mock=drift` loads a fixture that does all of these at once. Use it after
touching the render path.

### Rule 8 — graceful degradation

| Failure | What Matt sees |
|---|---|
| tile `status: error` / `stale` | that card greys, keeps its `updated_at`, rest renders |
| Worker unreachable | last cached snapshot + "showing cached snapshot from …" |
| Worker unreachable, no cache | a plain "cannot reach the Worker" card |
| token rejected (401) | the stored token is dropped and Matt is told to re-open with `?t=` |
| ESPN down (M3) | LIVE tiles show "feed unavailable", never blank |
| `/ask` down | the chat says which way it failed; the mode chip reads `cap`, `slow`, `unset` or `offline` |

### Rule 10 — untrusted content is data

There is no `innerHTML` in this codebase and there must never be one. Every
string from the snapshot, from ESPN, or from `/ask` is placed with
`textContent` via `lib/dom.js`. `extLink()` additionally refuses any URL that
is not `http(s)`, so a snapshot carrying a `javascript:` URL renders as inert
text instead of a live link.

### Rule 7 — the disqualifying bug

Business dates are `YYYY-MM-DD` **Central** strings. `new Date("2026-09-17")`
parses as UTC midnight, which renders as *Sep 16* for anyone in Central.

All date handling is quarantined in `docs/lib/fmt.js`. Date-only strings are
split on `-` and rebuilt with `Date.UTC`, then read back with `getUTC*` only —
pure calendar arithmetic, no timezone involved. Full UTC ISO *instants* (the
`updated_at` fields, which carry a `Z`) are safe to parse and are displayed
through `Intl` with an explicit `America/Chicago` zone.

`npm test` runs those helpers under four timezones and requires identical
output. **Never add a function to `fmt.js` that passes a date-only string to
`new Date()`**, and never parse one anywhere else.

### Writes are proposals

The dinner HIT/MISS buttons are the only write affordance on the board. They
file a `meal_verdict` event and badge it **pending**; the tile keeps showing
the vault's own verdict underneath. A submitted write is never rendered as
applied. `withdraw` calls `DELETE /api/event/:id` — the undo valve, one event
at a time, and only the author's own.

### The LIVE band

`bets_live` and `mke_board` are graded **in the browser**, not by the engine.
The page calls `site.api.espn.com` directly (CORS-open, no key). With the
Worker, that is the only external origin the page touches.

```
live/espn.js     fetch + normalize      — returns facts, judges nothing
live/graders.js  market -> grader       — pure functions, no fetch, no DOM
live/band.js     the loop               — cadence, summaries, assembling ctx.live
```

**Cadence:** 45s while any relevant game is in progress, 5 min while everything
is still pre, and it stops once every relevant game is final. It also stops
when the tab is hidden — a phone in a pocket has no business polling ESPN — and
does an immediate pass when it comes back.

**Matching:** tickets match games by `espn_event_id` and **never** by team
name, because ESPN abbreviations drift. `mke_board` is the one exception: it
matches by abbreviation, because that is what the snapshot gives it.

**Summaries** (`/summary?event=`) are much heavier than the scoreboard, so one
is fetched only when a ticket's market needs scoring plays *and* that game is
already under way. A pre-game summary has no `scoringPlays` key at all.

**On failure** the last good grades are kept and the tile shows "feed
unavailable". It never blanks, and it never shows zeros as though they were
scores.

#### Three things ESPN does that will bite you

Verified against live payloads on 2026-09-17; all three are covered by tests.

1. **`score` is a string.** `"5"`, not `5`. Concatenating two of them makes a
   total of `"53"`, and `"10" < "9"` is true. Always `Number()`.
2. **`linescores` are objects** — `{value, displayValue, period}` — and the key
   is absent entirely pre-game and for soccer. Default to `[]`.
3. **Not every touchdown is abbreviated `TD`.** A defensive score arrives as
   `SFOP` ("Sack Opp Fumble Recovery"). Filtering on `type.abbreviation === 'TD'`
   silently turns a winning ticket into a LOSS. A play counts as a touchdown if
   the abbreviation says TD, *or* the type text says Touchdown, *or* the scoring
   team's score jumped by 6+.

#### anytime_td: the scorer is not everyone named in the play

ESPN writes a passing touchdown as:

```
Mike Gesicki 2 Yd pass from Joe Burrow (Evan McPherson Kick)
```

Gesicki scored it. Burrow threw it, McPherson kicked the extra point, and all
three surnames are in that one string. Matching the whole text — the obvious
implementation, and arguably what "player surname in a TD scoring play" asks
for — grades a **Joe Burrow anytime TD ticket as a WIN** for a touchdown he did
not score, and does the same for the kicker.

So `scorerText()` credits only the name before the yardage, and falls back to
the text before the first parenthesis. There are tests asserting Gesicki wins
while Burrow and McPherson both lose on that exact play.

This is a deliberate deviation from the literal brief, because a wrong call on
"did my guy score" is precisely the bug that makes a board untrustworthy.

#### anytime_goal is behind a flag, and off

`ANYTIME_GOAL_ENABLED = false` in `live/graders.js`. Tickets render "grading
unsupported" rather than a guess.

What has been verified: soccer carries **no `scoringPlays`** at all. Goals live
in `keyEvents[]` where `scoringPlay === true` and `type.text` is `"Goal - …"`.
The parser for that is written and tested, so enabling it is a one-line change.

What has **not**: the brief requires verification against a *live* summary, and
only a completed one has been checked. There is also real spelling drift
between a goal's `text` and its `shortText` (`Charalampos` vs `Charalambos`
in the captured fixture), which makes surname matching less safe here than it
looks. Watch one live match grade correctly before flipping it.

#### Grader states

`pre | lead | trail | even | win | lose | push | dead | unsupported`

`win` and `lose` appear **only** once ESPN calls the game final. While a game
is running a ticket is LEADING / TRAILING / COVERING, and the tile footer says
so: *this is a lean, not a settlement*. A different system settles bets.

`even` exists so a tied game and a spread sitting exactly on the number lean
nowhere, instead of being quietly rounded into a lead.

### PWA

`manifest.webmanifest` (standalone, dark, 192/512 + maskable) and a real PNG
`apple-touch-icon`, because iOS will not take an SVG. The icons are drawn
procedurally by `tools/make-icons.js` — a ship's wheel, no brand marks, no icon
font, no CDN.

`sw.js` caches the shell stale-while-revalidate and `/api/data` network-first.
It **never** caches ESPN or `/ask`: a cached score would show stale numbers as
live, and a cached answer would replay itself forever.

---

## Ask

`POST /api/ask` answers questions about the board. One user, one token, one
model call per question, and a hard dollar ceiling on the day.

### What the Worker builds

```
system  = ask:sys (the vault owner's prompt, verbatim, first)
        + the current snapshot — tiles only, plus schema/generated_at/tz
        + the pinned tile, when the question came from a tile's Explain
messages = the page's last ≤10 turns, then the question
```

The system block is sent with `cache_control: ephemeral`: it is byte-identical
for every question asked between two publishes, so the second and later asks in
a sitting read most of their input from cache at a tenth of the price.

A tile whose `data` serialises to more than **8 KB** is replaced by a note
naming its size and its keys. That keeps one fat tile — a long newsstand, a
busy calendar — from crowding the rest of the board out of the prompt.

`run_id` is dropped. `tz` and `generated_at` are kept, because a business date
is a plain `YYYY-MM-DD` string and is unreadable without the zone it belongs to.

### The backend seam

`askBackend()` is deliberately the only function that knows where answers come
from. Today it POSTs to the Anthropic Messages API with the key from the
`ANTHROPIC_API_KEY` secret; Phase 2 replaces that body with a fetch at a
Cloudflare Tunnel. Either way the page sees only `{answer, mode, usd}` and
renders `mode` as a chip — `snapshot` now, `vault` later.

It calls raw HTTP rather than the SDK on purpose: rule 3 keeps `worker.js` a
single self-contained file that can be pasted into the Cloudflare dashboard,
and a bundled npm dependency would end that.

Defaults: model `claude-sonnet-5` (override with the `ASK_MODEL` secret),
`max_tokens` 800, thinking off — an 800-token budget is for the answer, not for
reasoning. A model that rejects `thinking: disabled` (the ones that always
think) is retried once without the field rather than failing the question.

### The cap

`ASK_DAILY_CAP_USD` (default **$3.00**) is checked before the request body is
even read, against `ask:cap:<UTC day>`. At or over it, every ask returns
`429 {reason:"cap"}` and the chat says the day's budget is spent. Cost is
estimated from the `usage` block the API returns, at list prices, with cache
writes at 1.25x and cache reads at 0.1x of the input rate.

A model id nobody has priced in `worker.js` is costed at the **most expensive**
tier. An unpriced model must trip the cap early; it must never run free.

The counter is a guard rail, not a ledger — KV has no atomic increment, so two
asks racing can under-count by one call. On a one-user board that is fine.
`GET /api/health` reports `ask_today_usd` and `ask_cap_usd`.

### Failure, and what the chat says

| Status | `reason` | The chat |
|---|---|---|
| 429 | `cap` | "The day's ask budget is spent. It resets at 00:00 UTC." |
| 504 | `timeout` | "The model did not answer in time." (25s ceiling) |
| 502 | `upstream` | "The model API is not answering right now." |
| 503 | `no_key` | no `ANTHROPIC_API_KEY` on the Worker |
| 503 | `no_system` | nothing installed at `ask:sys` yet |

`no_system` is a refusal to improvise: the prompt's *content* belongs to the
vault owner, and this repo inventing a stand-in would be exactly the boundary
violation `CLAUDE.md` draws. Install it with `PUT /api/admin/ask-system`.

### On the page

The panel is a bottom sheet on the phone. The transcript lives in one closure,
in memory only — never localStorage, never an event, never the snapshot — so
closing the sheet keeps it and reloading drops it. Answers are placed with
`textContent` like any other untrusted string (rule 10).

Every tile carries **Explain**: long-press, right-click, or the `?` in its
header. That opens the sheet with the tile pinned and "Explain this tile."
already typed. The pin chip shows what is attached and unpins with one tap.

A message starting with `add a tile`, `build`, or `I want a tile` offers **File
as build request** instead of burning an ask on it — with "Ask anyway" right
beside it, because it stays Matt's call.

The mode chip doubles as the meter: after an answer its tooltip reads the cost
of that call, and on a failure it reads which reason came back.

### Checking it live

```bash
tools/ask-probe.sh "what is open on the board right now?"
```

Reads the token from `token.local.txt`, asks the deployed Worker one question,
and prints **shape only** — status, mode, answer length, cost, and the day's
running total before and after. The answer itself is Matt's data and stays on
Matt's screen, not in a build transcript. It bills one real model call.

---

## Snapshot contract (schema 1)

```jsonc
{
  "schema": 1, "generated_at": "<UTC ISO>", "run_id": "run-…", "tz": "America/Chicago",
  "tiles": {
    "<tile_id>": { "band": "LIVE|HOURLY|DAILY|WEEKLY", "updated_at": "<UTC ISO>",
                   "status": "ok|stale|error", "error": null, "data": { } }
  }
}
```

The Worker validates only that the body parses and carries `schema`. Everything
else is the page's problem, and the page tolerates schema growth: an unknown
tile id renders as a generic key/value card, a registered tile missing from the
snapshot renders as an empty grey card.

Tiles in the contract today: `bets_live`, `mke_board`, `newsstand`, `radar`,
`calendar`, `reminders`, `dinner`, `purser_due`, `ship_status`. The page reads their payloads
field by field and skips what the engine has not sent — a missing field is
never rendered as a zero, a `false`, or an `Invalid Date`.

**Timestamps the Worker generates are UTC ISO-8601.** Business dates inside the
snapshot are `YYYY-MM-DD` **Central** strings and must be rendered verbatim as
text — never `new Date("YYYY-MM-DD")`, which JS parses as UTC midnight and shows
Central users the day before.

---

## Never in this repo

No real bets, balances, names, feeds, calendar items, tokens, or secrets — not
in code, commits, or fixtures. All test data comes from
`tools/make-mock-data.js`. `.gitignore` covers `*.local.*`, `.dev.vars`,
`real-*`, and `ask-system*.txt`.
