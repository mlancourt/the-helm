# The Helm

A single-user personal homepage for Matt: a phone-first PWA that renders a JSON
snapshot as tiles, grades open sports bets live in the browser, and carries a
chat box answered by a Worker.

**This repo is the presentation + transport layer only.** The source of truth is
Matt's vault + engine, which lives elsewhere and talks to this Worker over the
admin endpoints. Nothing here generates real data. See `CLAUDE.md` for the
build brief and the hard rules.

Status: **M1 complete** — Worker, KV, token auth, events, admin publish/drain.
M2 (page shell + tiles), M3 (LIVE band), M4 (`/ask`) are not built yet.

---

## Layout

```
worker/worker.js        the whole API — one self-contained file, plain JS
worker/wrangler.toml    name, KV binding, compatibility date
tools/make-mock-data.js fake snapshot generator (node, no deps)
tools/test-worker.js    Worker test suite (node, no deps, needs wrangler dev)
docs/                   GitHub Pages root — the app shell (M2)
docs/mock/              generated fake snapshot, fake by construction
```

`wrangler` is the only dev dependency. The page itself has no build step.

---

## Local development

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars   # gitignored; edit the secret
npm run dev                                    # wrangler dev on :8787
```

In a second terminal:

```bash
npm test
```

61 assertions covering token 401s, event shape rejection, per-event KV keys,
the delete-event actor check, snapshot validation, ack scoping, CORS, and
routing. The suite installs its own throwaway tokens and drains what it wrote.

Regenerate the mock snapshot any time:

```bash
npm run mock
```

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

### 3. Deploy

```bash
npm run deploy
```

Note the `*.workers.dev` URL. The page (M2) will point at it.

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
