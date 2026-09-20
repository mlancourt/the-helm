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
  live/nws.js           NWS fetch + normalize (alerts, forecast, now-line, radar)
  live/band.js          the polling loops and their cadences (ESPN, NWS)
  manifest.webmanifest sw.js icons/
  mock/                 generated fake data, fake by construction

tools/make-mock-data.js fake snapshot generator
tools/mock-espn.js      the invented ESPN slate behind ?mock=1, + its watch map
tools/make-icons.js     draws the PWA icons (zero deps, zlib only)
tools/make-live-mock.js builds a snapshot against TODAY'S REAL ESPN slate
tools/fixtures/         real ESPN payloads, captured for the grader tests
tools/test-fmt.js       date/format unit tests, run across four timezones
tools/test-sw.js        service worker caching-policy + precache-parity tests
tools/test-tiles.js     every render module, incl. hostile payloads (DOM shim)
tools/test-weather.js   the weather tile: fold, tiers, clock, radar, fallback
tools/dom-shim.js       the 60-line DOM both tile test files render into
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
| `http://127.0.0.1:8080/?mock=cards-stale` | the card desk half rate-limited (rule 8's grey treatment) |
| `http://127.0.0.1:8080/?mock=weather-warn` | a Tornado Warning — red row **and** the board banner |
| `http://127.0.0.1:8080/?mock=weather-clear` | the weather tile with nothing to shout about |
| `http://127.0.0.1:8080/?mock=weather-down` | no live feed **and** no offline copy: "feed unavailable" |
| `http://127.0.0.1:8080/?mock=live.local` | real event ids — watch the graders work |
| `http://127.0.0.1:8080/?api=http://127.0.0.1:8787&t=<token>` | the real local Worker |

`?api=` is honoured **only when the page itself is on localhost**. On the real
origin it is ignored, because otherwise a crafted `?api=https://evil.example`
link would make the page post Matt's bearer token straight at an attacker.

### Tests

```bash
npm test            # 1140 assertions, no server needed
npm run test:worker # 62 assertions, needs `npm run dev` running
```

- **`test:fmt`** (148) — every date helper, run under `America/Chicago`,
  `Asia/Tokyo`, `UTC` and `Pacific/Kiritimati`, asserting byte-identical output
  in all four. This is the rule-7 tripwire.
- **`test-graders`** (141) — every market across pre / in / post / push, run
  against **real ESPN payloads** captured in `tools/fixtures/`. Inventing
  fixtures would only prove the graders agree with my guess about ESPN's shape,
  which is the exact thing worth testing.
- **`test-band`** (56) — the LIVE loop's decisions rather than its arithmetic:
  cadence, one summary per game and only once it is under way, one scoreboard
  per league, event-id matching, and that a dead feed keeps the last good
  grades instead of blanking them.
- **`test-shell`** (81) — the header and the two sheets, which are the only
  part of the page with no other coverage because `app.js` cannot be imported
  outside a browser. It asserts the version comes from one constant, that the
  subhead cannot print `me.name`, that the phone sheets carry no fixed height,
  and that `style.css` reaches nowhere off this origin. Its sharpest assertion
  is a **cascade-order** check: a desktop override written above the phone rule
  it overrides loses silently, and only on a wide screen. That bug was real.
- **`test:sw`** (42) — the service worker's routing policy: ESPN and `/ask` are
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
- **`test-tiles`** (590) — every render module, against the mock snapshot and
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

`?mock=1` also gets a **fake ESPN slate** (`docs/mock/espn-today.json`, from
`tools/mock-espn.js`): four leagues with invented teams covering pre, in
progress and final, and broadcast names chosen to hit the watch map, miss it,
and trip the "regional — not yours" rule. Without it, `today_games` could only
be seen working on a day the real world happened to supply those cases.
`app.js` injects that slate into the band; `live/band.js` itself has no mock
branch.

`?mock=1` reaches **api.weather.gov not at all**. The mock's gridpoint and
station ids are invented, so those URLs would 404, and a mock that fires four
requests at a federal endpoint to render fake data is not a mock. `app.js`
hands the weather band a client that refuses, which lands the tile on exactly
the path worth looking at by eye: `data.fallback`, greyed, with its own `as of`.
The radar box points at `docs/mock/radar-placeholder.svg`, a local asset —
**never** the live NWS URL. The live normalizers are covered by
`tools/test-weather.js` instead, against real NWS shapes.

`bets_live`'s mock tickets still carry **invented event ids**, so the band
correctly reports "no ESPN event matched this ticket" for every one of them.
That is the honest degradation path, not a bug. To watch grading actually
happen — and to see the watch map against real broadcast names — run
`npm run mock:live` and open `?mock=live.local`, which keeps the **real** feed.

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

### The wordmark, and the version

The wordmark is set in **Helm Display** — a subset of Big Shoulders Display
(SIL OFL 1.1), inlined as base64 in `style.css`. Rule 4 allows the page exactly
two external calls, the Worker and ESPN, so the face is carried rather than
fetched: 1.8 KB, arriving with the stylesheet, no flash of a substituted
wordmark on one bar of LTE. Provenance, licence and the rebuild command are in
`docs/fonts/`. The subset has **nineteen characters** — enough for "The Helm"
and a version string — so adding a character to the wordmark means rebuilding
it; anything outside the set falls through to the system stack mid-word.

The version lives in **one place**: `APP_VERSION` in `docs/config.js`. The chip
beside the wordmark prints `v` + major.minor; the Ship Status footer prints the
whole thing. `test-shell` fails if either is ever typed out by hand.

**Bump `APP_VERSION` and `CACHE_VERSION` together, each ruling batch.** A
version bump with a stale cache version ships a chip that says v1.2 over a v1.1
shell, which is worse than no chip at all.

The chip is set in mono, not the display face, on purpose: Big Shoulders draws
its `1` as a bare condensed stem, so `v1.0` sets as `vl.0` at chip size. The
digits stay in the subset so that is one line away from changing back.

The subhead reads **`LannyAI · snapshot 49m ago`**. `/api/data` still returns
`me` and the page still reads it, but the board never prints it — the header
speaks for the machine, not the operator. That is enforced by `subheadText()`
in `docs/lib/header.js` having no parameter that could carry a name.

### The sheets, and the keyboard

Both sheets — Ask and the detail panel — ride one set of rails, so they feel
identical. Nothing sets `height`. A sheet is as tall as its header plus
whatever its body has to say; an empty Ask is one line of hint, and the caps
only ever stop it growing.

The hard part is the on-screen keyboard. `position: fixed` anchors to the
**layout** viewport, which the keyboard does not shrink — so left alone, iOS
draws the keyboard over the composer and then scrolls the page to chase the
focused input. That is the mostly-empty panel with the input floating
mid-screen.

So `app.js` publishes two custom properties off `window.visualViewport`:

| property | what it is |
|---|---|
| `--kb` | how much of the bottom edge the keyboard covers, right now |
| `--vvh` | how much height is actually visible |

The sheets sit on `bottom: var(--kb)` and cap their scrollers against `--vvh`.
Nothing scrolls, nothing jumps: the sheet stops where the keyboard starts.

Three details that are not optional:

- **`--kb` rides `bottom`, not `transform`.** `transform` is already spoken for
  by the open/close slide, and a 200 ms transition on it would make the sheet
  lag the keyboard by a fifth of a second on every resize.
- **`vv.offsetTop` is subtracted.** If iOS has already scrolled the page, the
  naive `innerHeight - vv.height` reports a keyboard taller than it is and the
  sheet lifts clean off the screen. This is also what makes the layout
  self-correcting when iOS scrolls anyway.
- **Desktop overrides live in a *second* `@media (min-width: 720px)` block at
  the end of the sheet section**, because `.sheet-body`, `.ask-transcript` and
  `.panel-body` are defined below the first one. Media queries add no
  specificity, so an override written above the rule it overrides loses.
  `test-shell` asserts the source order for exactly this reason.

Desktop is unchanged by all of it: the docked panel has no keyboard to dodge,
and its body fills it as it always did.

### Adding a tile

1. Write `docs/tiles/<id>.js` exporting `render(el, tile, ctx)`.
2. Add one line to `docs/tiles/_registry.js`.
3. Add the file to `SHELL` in `docs/sw.js` and bump `CACHE_VERSION`.
4. Give it invented data in `tools/make-mock-data.js` and run `npm run mock`.
5. If it is a LIVE tile, say what it needs from ESPN in `requirements()` in
   `docs/live/band.js` — never fetch from a tile module.

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
id to match, because the engine, the snapshot and every event key speak the id.
A snapshot that carries its own `data.title` is ignored for the same reason: the
card head already prints one, and two would say it twice.

**Retiring a tile** is two deletions and nothing else: drop its line from
`_registry.js` and delete its module (and its entry in `sw.js`'s `SHELL`). An
old snapshot that still carries the id renders as a generic key/value card by
rule 9 and harms nothing, so the engine and the page can be retired out of step.
`mke_board` — "Local Team Scoreboard" — went this way on 2026-09-17, replaced by
`today_games`.

### Today's Games

`today_games` is a **menu tile** at position 20: one button per league Matt
follows, and the day's slate in a sheet.

The engine publishes only the league list, the watch map, the services he has,
his local teams, and `date_ct` — it never fetches a schedule. Every game, and
every score on it, comes from ESPN in the browser on the LIVE band's clock,
shared with `bets_live` (see below).

A button shows `{n} games` and a pulsing green dot when one of them is under
way. A league with nothing on greys and says "no games today" — and still opens,
so the sheet can say which league and which date. Before the band's first pass
a button says "awaiting feed", because "no games today" is a claim and the page
does not yet have the standing to make it.

**How to watch** is the one judgement the tile makes, and it is three-way:

| Case | Chip |
|---|---|
| the broadcast name is a key in `watch_map` | `✓ <service>` |
| it is not | the raw name, unmarked — a hand-kept map missing an entry is not the same as him not having the channel |
| it is a `Home`/`Away` market feed for a team not in `local_teams[slug]` | `regional — not yours` |

Mapped wins over regional on purpose: the map is how the vault says "this
particular RSN *is* mine" (`"Brewers.TV": "Brewers.TV (regional, yours)"`), and
that statement outranks the geography. **When a ✓ is wrong, fix the map in the
vault** — `watch_map` is a hand-kept list, not truth, and YouTube TV's lineup
moves.

Adding a league is one line in the vault's `today-games.json`; the page needs
nothing, and a league it has never heard of gets a button labelled from the tail
of its slug.

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

### Entertainment — a menu that remembers

The entertainment tile is the newsstand's menu pattern with one thing added:
it remembers. Four faces — Watching, Podcasts, Top 5, Listening — each a
button, each opening the same detail panel.

Two differences from the newsstand are deliberate:

**The faces are fixed in the module, not derived from the payload.** A face
the engine has not built yet arrives as `null`, and a `null` face is still a
button — greyed, dashed, wearing "soon". Deriving the menu from the data would
silently drop it, and "coming" is information. (A face the engine *invents*
and populates still gets a button anyway, via rule 9; payload metadata such as
`sources` and `attribution` is not mistaken for one.)

**The count chip is per device, not per snapshot.** Each face's chip counts
items that arrived since that face was last opened *on this phone* — a
timestamp per face under `helm.entertainment.lastOpened` in localStorage. That
is a property of the device, not of the vault, so it is the one piece of tile
state the snapshot does not own. The rules around it:

- storage that is missing, blocked (Safari private mode) or corrupt means the
  face has never been opened here, so **everything counts as new**. Never zero:
  a tile gone silent because private mode ate a key is the worse failure.
- nothing new means **no chip at all**, not a "0". The tile is quiet by default.
- opening a face stamps it and the chip disappears on the spot, rather than
  waiting for the next snapshot.

What counts as "arrived" is per face, and only two faces have a real answer: a
podcast episode has `published_at`, and a show has `last.air_date`. Anything
with no per-item arrival stamp falls back to the face's own `updated_at`. A
`release_date` is deliberately **not** treated as an arrival — it is in the
future, and every item would read new forever.

Under the grid, one faint line carries the **oldest** `updated_at` among the
populated faces: the tile is only as current as its stalest face, and a fresh
podcast list must not make a three-day-old episode schedule look fresh too.

The days-out chip is **`airLabel()`**, not `dueLabel()`: same tone ladder —
today red, the next few days amber, the rest neutral, so a thing three days
out looks equally urgent wherever it sits on the board — but entertainment's
words. "Due" is a bill's word and an episode is not owed, so it reads *airs
today* / *tomorrow* / *in 6d*. `dueLabel` is untouched; Purser and Reminders
are talking about obligations and should keep saying so. The tests assert the
two helpers' tones against **each other** rather than against literals, so
they cannot drift apart, and assert that their wording differs.

Rule 7 lives in the sheets. `air_date`, `published` and `release_date` are
date-only Central strings rendered from their parts by `prettyDate`. Where one
has to be compared against a `lastOpened` *instant*, the instant is brought
down to its Central date with `ctDate()` and the two date strings are compared
as text — the date-only side is never handed to `new Date()`.

The podcast sheet's footer says what the badge actually promises, once: *"New
means published since you last opened this, not unheard."* The page can see a
publish date; it cannot see a play. The watching sheet's footer carries TMDB's
attribution string verbatim, from `data.attribution`.

### Cards — the desk, and who does the arithmetic

`cards` is a two-button menu in Entertainment's mould — 🎯 **Watch** · 🏷️
**Shop** — because a shopping list is never urgent enough to earn board height.
`shop` is `null` until that face ships, which the payload says out loud: a null
face is still a button, greyed and wearing *soon*, so a face that is coming is
visible as coming rather than silently absent.

**The engine does every piece of judgement.** It sets the FMV, picks the gate,
computes the all-in, decides the MAX bid, ages the comp book, marks a listing
`OVER BAND`, and sorts both lists before publishing (flags by `pct_fmv`
ascending, auctions by end time). The page recomputes none of it — in
particular `all_in` is never derived from `price + ship` and `MAX` is never
derived from `fmv × gate`. A number this page invented would look exactly like
a real one on the screen and be wrong; the tests pin that by shipping a fixture
whose `all_in` deliberately does not equal `price + ship`, and asserting the
payload's figure is what renders.

**The badge counts fresh flags only.** A 30-day-old comp book is a 30-day-old
opinion about what a card is worth, so "51% of FMV" resting on one is a guess
wearing a number's clothes: an `aging` flag still renders and still shows its
percentage, but loses the green tick, loses the badge, and says `book 30d old`
beside the chip. Auctions never count either — a current bid is not a price and
has hours left to move, so an auction's chip is never green. Nothing under the
gate means **no chip at all**, not a zero.

**Auction rows count down live (v1.6.0).** Each auction row reads

```
⏱ 1h 42m     ends 2026-09-20T19:48
```

— the countdown in front, the wall stamp muted behind it. The ladder is
`2d 4h` over a day, `3h 07m` inside one, `42m` inside the hour, `12m 30s`
inside the last quarter-hour, and `ended` at zero. The seconds appear in
exactly one window, and that is the point: a ticking second on a lot that
closes on Thursday is noise; a lot closing in nine minutes is the only moment
on this page where a second is a fact Matt can act on.

**Rule 7 is satisfied here, not bent.** An auction carries two end times and
they do different jobs:

| field | example | what it is | what the page does |
|---|---|---|---|
| `ends_ct` | `2026-09-20T19:48` | Central **wall-clock text**, no offset | printed character for character, **never parsed** |
| `ends_utc` | `2026-09-21T00:48:00.000Z` | a real **instant** | all countdown arithmetic |

The reason rule 7 forbids `new Date(ends_ct)` is that a string with no offset
makes the browser guess a zone, and it guesses the phone's — wrong by five
hours in Central and by fourteen on a plane. `ends_utc` carries the offset, so
there is nothing left to guess. The arithmetic lives in `msUntil()` and
`countdown()` in `lib/fmt.js`, so `new Date` does not appear in `cards.js` at
all, and `msUntil()` **refuses any string without an offset** — hand it
`ends_ct` by mistake and you get no countdown, which is the correct answer,
never a confidently wrong one. The tests prove both: a source scan, and a Date
spy that asserts no `ends_ct` value ever reached a constructor.

A row whose `ends_utc` is missing or unreadable — an older snapshot still in
the service worker's cache — falls back to the pre-v1.6.0 line: `ends` plus
the wall stamp, no countdown, no amber, no error.

**One interval for the whole sheet**, never one per row: 1000 ms while
anything is inside the hour, 30000 ms otherwise, re-armed only when the
cadence itself has to change, so at every instant exactly one timer exists.
The builder hands a teardown back to the shell, which runs it when the sheet
closes or another opens — a countdown left beating against detached nodes is
the classic version of this bug. A phone that slept comes back to a repaint on
`visibilitychange` rather than up to thirty seconds of a visibly wrong figure.

**The amber dot means one thing: an auction inside two hours.** That is the
last window in which Matt can actually get to a desk and decide, which is all a
dot on a homepage is good for. Amber is *you can still do something about
this*, so at zero the row stops being amber and goes grey, reading `ended` —
and it stays exactly where it is until the engine's next pass removes it,
because a row vanishing under Matt's thumb mid-scroll is the worse bug. The
dot on the board stays up while such a row is still listed: a snapshot
published ten minutes late must not drop the alarm at the moment it matters
most.

One deliberate exception to rule 4 is worth knowing about: the 40px thumbnails
are `<img>` tags pointing at the listing host's own CDN, which is a **third
external origin** the hard rules do not list. A card you cannot see is a card
you cannot judge, so it is here on purpose — kept as narrow as it goes. http(s)
only through `safeUrl`, `referrerpolicy="no-referrer"` so the homepage's URL
never reaches the host, `loading="lazy"` so nothing is fetched until the sheet
is open, a grey box of the same size whenever there is no usable image, and the
service worker never caches them. If that trade ever stops being worth it,
deleting `thumb()` is a five-line change.

`?mock=cards-stale` is the tile half-broken — `status: stale` with the engine's
reason and a `watch.errors` entry. The rows Matt does have are still real, so
they render and the tile wears a ⚠︎ whose tooltip is the reason (rule 8);
`status: error` falls all the way back to rule 9's generic card.

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

There is no write affordance on the board today: the dinner tile went
read-only in v1.5.1 (verdicts are ruled in the Meal Planner's approval pass,
not here), so every event now arrives through the ask panel's build-request
offer. The machinery is unchanged and still the rule for anything that files
one — a submitted write is badged **pending** and never rendered as applied,
and `withdraw` calls `DELETE /api/event/:id`, the undo valve, one event at a
time and only the author's own.

### Bets Live — form, units, and who does the arithmetic

v1.6.0, the facelift (vault spec `Bets-Live-Tile-Spec.md`, rulings B1–B9). The
board was a grader demo; it is now a tile Matt checks.

**The page does no odds math.** The Bookie logs the price and publishes
`ticket.to_win_u` — units returned on a winner — and the page renders that
number. There is no payout helper in this codebase any more, and a test asserts
there is not one. The Bet-Log is what this board is read against, and two
implementations of the same sum eventually disagree by a cent; at that point the
board is the thing that stops being trusted.

**One number per row, summed in the header.** `ticketUnits()` decides what a
ticket is worth right now, the row prints it, and "lean now" is the sum of
exactly those values — `+to_win_u` leading or won, `−stake_u` trailing, lost or
dead, `0.00u` on a push or a tie, the plain stake before kickoff. Header and
rows reconcile *by construction*, and the test adds up what the DOM actually
prints rather than calling the function the tile called.

A ticket the Bookie could not price (`to_win_u: null`) shows its plain stake in
every state and contributes **zero** in either direction. Half a figure is
worse than none: a `−0.50u` in the header that no row accounts for makes the sum
look broken, which is the one thing the design above exists to prevent.

**The 7-day form is the engine's, entirely.** `data.form` comes from the
Bookie's § Settled rows — W/L only, voids and pushes excluded — and the page's
own live leans never feed it, because the tile leans and the Bookie settles.
The line reads `7d 14-9 · +4.71u · 61%` with a streak chip (`🔥 W5` / `🧊 L3`)
and ten dots, newest left, each carrying its row in its tooltip. `form: null`
hides the whole line rather than showing zeros, which would read as a losing
week instead of a missing one. A streak spelling this page cannot colour gets
no chip — green is a claim.

**Board order** is live first, then upcoming by kick, then decided (a postponed
game sorts with the decided ones). Kick times arrive in two spellings —
`15:25` from the mock and `6:05 PM` from the engine — so ordering goes through
`kickKey()`, which reads the parts and counts them on a flat calendar. Sorting
them as text puts a 6:05 PM game before a 7:30 AM one. Ties keep the snapshot's
order, which is the Bet-Log's order, and tickets within a card never move.

**The pulse** is one beat, ~600 ms, when a pill changes state between grader
passes: green toward the money, red away from it, nothing kept. Previous states
live in module memory only — persisting them would mean a phone unlocked hours
later flashing at a bet that turned in the meantime, which is a notification,
and this tile is not one. A ticket seen for the first time never pulses.

**The bankroll is a plain number** (B9). No colour, no drawdown, no "slow
down": the Bookie's charter says scoreboard, not a leash, and the tile does not
editorialise either.

### The LIVE band

`bets_live` is graded, `today_games` is filled and `weather` is fetched **in the
browser**, not by the engine. The page calls `site.api.espn.com` and
`api.weather.gov` directly (both CORS-open, neither needs a key), and displays
`radar.weather.gov`'s pre-rendered loop as an `<img>`. With the Worker, those
are the only external origins the page touches.

```
live/espn.js     fetch + normalize      — returns facts, judges nothing
live/graders.js  market -> grader       — pure functions, no fetch, no DOM
live/nws.js      fetch + normalize      — alerts, forecast fold, now-line, radar url
live/band.js     the loops              — two controllers, two clocks
```

**No custom header on the NWS calls, ever.** A header makes the request
non-simple and triggers a CORS preflight the NWS is under no obligation to
answer. The engine's Python client *does* need a `User-Agent`; the browser does
not. If a weather fetch starts failing, that is the first thing to check and
the last thing to "fix".

**Cadence:** 45s while any relevant game is in progress, 5 min while everything
is still pre, and it stops once every relevant game is final. It also stops
when the tab is hidden — a phone in a pocket has no business polling ESPN — and
does an immediate pass when it comes back.

**Matching:** tickets match games by `espn_event_id` and **never** by team
name, because ESPN abbreviations drift (`OLM`, `BES`, `LEVS`). `today_games`
does not match at all — it takes the whole league slate.

**One tick serves both tiles.** `band.js` does not ask per tile. `requirements()`
builds one deduped plan of `(league, date)` pairs — the leagues the tickets name
dated today, plus the board's leagues dated by the snapshot's `date_ct` — and
fetches each exactly once; `espn.js` coalesces any identical request still in
flight. The two dates are the same string on an ordinary day, which is why an
ordinary day costs one call per league. `date_ct` becomes ESPN's `dates=` by
**removing two dashes from a string** — never `new Date(date_ct)`, which would
send yesterday (rule 7).

A league whose call fails keeps the slate it had and is flagged `ok: false`, so
its sheet says "feed unavailable" over the last good slate. "No games today" is
never something the network gets to say.

**Summaries** (`/summary?event=`) are much heavier than the scoreboard, so one
is fetched only when a ticket's market needs scoring plays *and* that game is
already under way. A pre-game summary has no `scoringPlays` key at all.

**On failure** the last good grades are kept and the tile shows "feed
unavailable". It never blanks, and it never shows zeros as though they were
scores.

#### Four things ESPN does that will bite you

Verified against live payloads on 2026-09-17; all four are covered by tests.

1. **`score` is a string.** `"5"`, not `5`. Concatenating two of them makes a
   total of `"53"`, and `"10" < "9"` is true. Always `Number()`.
2. **`linescores` are objects** — `{value, displayValue, period}` — and the key
   is absent entirely pre-game and for soccer. Default to `[]`.
3. **Not every touchdown is abbreviated `TD`.** A defensive score arrives as
   `SFOP` ("Sack Opp Fumble Recovery"). Filtering on `type.abbreviation === 'TD'`
   silently turns a winning ticket into a LOSS. A play counts as a touchdown if
   the abbreviation says TD, *or* the type text says Touchdown, *or* the scoring
   team's score jumped by 6+.
4. **How-to-watch is told twice, and neither telling is complete.**
   `broadcasts[].names` carries the names with a **lower-case** market
   (`"national"`, `"away"`); `geoBroadcasts[]` carries the same names with a
   **title-case** market (`"National"`, `"Away"`) plus a type whose casing is
   not even self-consistent (`"Streaming"` in MLB, `"STREAMING"` in soccer).
   Both keys are missing entirely for plenty of games. `espn.js` merges the two
   into one deduped `[{name, type, market}]`, normalises the market to title
   case, and decides nothing on `type`.

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

A pill stops moving the moment the **maths** is final — not when ESPN calls the
game (B3, Matt 2026-09-18). Every lock below is one-way by arithmetic, because
a score cannot go down, which is also why the two markets that are *not* locked
are not locked: a lead is not a result.

| market | locks | still a lean |
|---|---|---|
| `total_over` | WIN the moment the total clears the line | below or level with it |
| `total_under` | LOSS the moment the total clears the line | below or level with it |
| `spread_1h` | at halftime, or once the third period starts | during the first half |
| `anytime_td` / `anytime_goal` | WIN on the scoring play | LOSS waits for the final — there is always another drive |
| `btts` | WIN once both sides are on the board | LOSS waits for the final |
| `ml`, `spread` | nothing — LEADING / TRAILING to the whistle | always |

Halftime is read from **both** `STATUS_HALFTIME` and a "Halftime" detail line,
because neither is guaranteed and ESPN spends the interval on `period: 2` — a
bet whose first-half maths is finished must not read as a lean for fifteen
minutes.

Even a locked WIN is the scoreboard's opinion, not the book's, and the footer
still says *this is a lean, not a settlement*. A different system settles bets.

`even` exists so a tied game and a spread sitting exactly on the number lean
nowhere, instead of being quietly rounded into a lead.

The tests pin both halves of every lock: one case mid-game (the game still
running) and one that the locked state survives a later pass and the whistle. A
pill that says WIN and later says LEADING is worse than one that never locked.

### PWA

`manifest.webmanifest` (standalone, dark, 192/512 + maskable) and a real PNG
`apple-touch-icon`, because iOS will not take an SVG. The icons are drawn
procedurally by `tools/make-icons.js` — a ship's wheel, no brand marks, no icon
font, no CDN.

`sw.js` caches the shell stale-while-revalidate and `/api/data` network-first.
It **never** caches ESPN, `*.weather.gov` or `/ask`: a cached score or forecast
would show stale numbers as live, a cached answer would replay itself forever,
and the RIDGE radar loop is a ~1 MB GIF that would evict the shell inside a
week.

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

Tiles in the contract today: `bets_live`, `today_games`, `weather`, `cards`,
`newsstand`, `entertainment`, `calendar`, `local_events`, `reminders`, `dinner`,
`purser_due`, `wss_tape`, `ship_status`. (`radar` was retired 2026-09-19 and
replaced by `weather`; an old snapshot still carrying it renders as rule 9's
generic card and harms nothing.) The page reads their payloads
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
