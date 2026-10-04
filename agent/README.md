# agent/ — the Helm brain (Phase 2, vault-smart `/ask`)

The Node service on the Mac mini that answers the Ask panel from Matt's whole
vault. Spec: vault `06-AI-Stack/The-Helm/Brain-Service-Spec.md` (A1–A10).

```
page (helm.lannyai.com) → brain.lannyai.com → Cloudflare Access (OTP) → cloudflared → 127.0.0.1:8787 → this
```

Listens on **127.0.0.1:8787 only**. Standalone: its own `package.json`, its own
`node_modules`, nothing imported from `worker/` or `docs/`.

## Run / stop

```bash
cd ~/Projects/the-helm/agent && npm ci && npm test
```

launchd runs it as `com.lannyai.helm-agent` (RunAtLoad + KeepAlive; stdout →
`~/Library/Logs/the-helm/helm-agent.log`). By hand:

```bash
node ~/Projects/the-helm/agent/server.js
```

```bash
launchctl kickstart -k gui/$(id -u)/com.lannyai.helm-agent
```

## Kill switch (A9)

| Lever | Command | Effect |
|---|---|---|
| soft | `touch ~/.config/the-helm/brain-off` | every route answers `503 {reason:"brain_off"}`; the page falls back to the Worker's snapshot `/ask`. `rm` the file to undo — no restart. |
| hard | `launchctl bootout gui/$(id -u)/com.lannyai.helm-tunnel` | the door is gone; the board keeps rendering |
| dashboard | Access policy → *Block* | no ssh needed |

Wrapped as vault `06-AI-Stack/Scripts/brain.sh on|off|status`.

## Routes

- `GET /health` → `{ok, mode:"vault", host, ts, spend_today_usd, cap_usd}`
- `POST /ask` `{q, history?, tile_id?, tile_data?}` → `{answer, mode:"vault", usd, files_read[], ms}`
- Failures are `{reason}`: `brain_off` / `busy` / `no_key` / `no_system` (503) · `cap` (429) · `timeout` (504, 90 s wall clock) · `upstream` (502) · `bad_json` / `bad_shape` (400) · `too_large` (413, 128 KB body) · `not_found` (404).
- One ask at a time; a second waits up to 20 s, then `503 busy`. A 12-turn run returns its partial answer + `(stopped at the 12-turn limit.)`.

## Environment

| Var | Default | |
|---|---|---|
| `ASK_MODEL` | `claude-sonnet-5-5` | A4. Fable is one env var away. |
| `ASK_DAILY_CAP_USD` | `3.00` | the brain's OWN rail (A7), separate from the Worker's |
| `HELM_VAULT` | `~/Library/Mobile Documents/com~apple~CloudDocs/LannyAI-Vault` | |
| `HELM_LOG_DIR` | `~/Library/Logs/the-helm` | tests only |
| `HELM_CONFIG_DIR` | `~/.config/the-helm` | tests only |

**Secrets never enter the repo.** The model key is read per request from
`~/.config/the-helm/anthropic-key` (so a rotation needs no restart) and passed
to the SDK as `ANTHROPIC_API_KEY`.

## Files it writes — exactly two, both under `~/Library/Logs/the-helm/`

- `ask-spend.json` `{day (Central), usd, n}` — checked before every model call; `429 cap` once `usd ≥ cap`. Priced with the Worker's table (copied into `prices.js`); an unpriced model costs at the top tier, so it trips the cap early.
- `ask-audit.jsonl` — one line per ask: `{ts, question_hash, files_read[], grep_count, list_count, turns, tokens_in, tokens_out, usd, ms, outcome}`. **Never the question, the answer or a grep pattern.**

## By construction, not by prompt

`query()` runs with `tools: []` (every built-in off — no Bash, Read, Write,
Edit, WebFetch), `settingSources: []`, `permissionMode: 'dontAsk'`,
`maxTurns: 12`, `cwd` = the OS temp dir, and `allowedTools` naming exactly the
three in-process tools on one SDK MCP server (`vault`):

| Tool | Does | Guard |
|---|---|---|
| `read_file(path)` | one utf-8 file | realpath inside the vault; `.git` `.obsidian` `.trash` denied; 200 KB cap; binary refused |
| `grep_vault(pattern, glob?, max=40)` | `/opt/homebrew/bin/rg -n -C 1 --max-count 5 …  -- <pattern> <vault>` | argv array, never a shell; 10 s; match cap; vault-relative paths |
| `list_dir(path)` | names, sizes, mtimes | same guard; 500 entries |

**The vault is read-only to this process.** There is no fetch tool, no write
tool, no shell tool — and none is to be added. Writes arrive in v1b as
`propose_event`, typed and pending, through the engine (A5).
