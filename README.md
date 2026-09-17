# The Helm

A single-user personal homepage for Matt: a phone-first PWA that renders a JSON
snapshot as tiles, grades open sports bets live in the browser, and carries a
chat box answered by a Worker.

**This repo is the presentation + transport layer only.** The source of truth is
Matt's vault + engine, which lives elsewhere and talks to this Worker over the
admin endpoints. Nothing here generates real data. See `CLAUDE.md` for the
build brief and the hard rules.

Status: **M1 + M2 + M3 complete** — Worker, KV, token auth, events, admin
publish/drain; page shell, tile registry, all v1 render modules, PWA; LIVE band
with in-browser ESPN fetch and bet graders. M4 (`/ask` v1) is not built yet.

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
tools/test-sw.js        service worker caching-policy tests
tools/test-worker.js    Worker API tests (needs wrangler dev)
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
npm test            # 221 assertions, no server needed
npm run test:worker # 61 assertions, needs `npm run dev` running
```

- **`test:fmt`** (49) — every date helper, run under `America/Chicago`,
  `Asia/Tokyo`, `UTC` and `Pacific/Kiritimati`, asserting byte-identical output
  in all four. This is the rule-7 tripwire.
- **`test-graders`** (101) — every market across pre / in / post / push, run
  against **real ESPN payloads** captured in `tools/fixtures/`. Inventing
  fixtures would only prove the graders agree with my guess about ESPN's shape,
  which is the exact thing worth testing.
- **`test-band`** (44) — the LIVE loop's decisions rather than its arithmetic:
  cadence, one summary per game and only once it is under way, one scoreboard
  per league, event-id matching, and that a dead feed keeps the last good
  grades instead of blanking them.
- **`test:sw`** (27) — the service worker's routing policy: ESPN and `/ask` are
  never cached, `/api/data` is network-first with a cache fallback, the shell is
  stale-while-revalidate, and a 404 in the precache list cannot fail an install.
- **`test:worker`** (61) — token 401s, event shape rejection, per-event KV keys,
  the delete-event actor check, snapshot validation, ack scoping, CORS, routing.

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
npx wrangler secret put ASK_DAILY_CAP_USD     # optional — default 3.00 (M4)
npx wrangler secret put ANTHROPIC_API_KEY     # M4 — never reaches the page
npx wrangler secret put ASK_MODEL             # M4, optional
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
| `POST /api/ask` | token | **M4.** Returns `503 {reason:"not_implemented"}` today |
| `POST /api/admin/publish` | secret | body = full snapshot; must parse and carry `schema` |
| `GET /api/admin/events` | secret | every pending event, oldest first |
| `POST /api/admin/events/ack` | secret | `{ids:[…]}` — deletes exactly those keys |
| `POST /api/admin/tokens` | secret | replace the token map |
| `PUT /api/admin/ask-system` | secret | body = text → `ask:sys` |

Error bodies are always `{error:true, reason, detail?}`. Reasons in use:
`unauthorized`, `bad_json`, `bad_shape`, `bad_type`, `bad_payload`, `bad_id`,
`not_actor`, `not_found`, `no_route`, `no_schema`, `weak_token`, `too_large`,
`cap`, `not_implemented`, `internal`.

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
| `ask:cap:<YYYY-MM-DD>` | `{usd, calls}` — UTC day |
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

`tile` is the snapshot entry (`{band, updated_at, status, error, data}`). `ctx`
carries `{id, title, snapshot, pending, actions, live}`, where `actions` are
`submitEvent`, `withdrawEvent`, `ask` and `openAsk`.

You never have to do step 2 for the page to survive: an unregistered tile
renders as a generic key/value card. Step 2 is what gives it a real layout.

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
| `/ask` down | the chat says so and the mode chip flips to `offline` |

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
