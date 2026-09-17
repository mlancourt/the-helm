#!/usr/bin/env bash
# The Helm — M4 acceptance probe. ONE real /ask call against the deployed Worker.
#
#   tools/ask-probe.sh "what is open on the board right now?"
#
# Reads the page token from token.local.txt (gitignored by *.local.*) so the
# token never appears in a command line, a shell history, or this repo.
#
# Prints SHAPE ONLY: http status, mode, answer length, the cost of this call,
# and the day's running total before and after. It deliberately does not print
# the answer — the answer is about Matt's real board, and that has no business
# scrolling through a build transcript or landing on disk here. Read the answer
# on the phone, which is the point of the thing.
#
# This costs money: one model call, billed to the Worker's ANTHROPIC_API_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${HELM_BASE:-https://the-helm.mlancourt.workers.dev}"
Q="${1:-what is open on the board right now?}"

if [ ! -f token.local.txt ]; then
  echo "token.local.txt not found — see the runbook." >&2
  exit 1
fi
TOKEN="$(tr -d '[:space:]' < token.local.txt)"
AUTH="Authorization: Bearer $TOKEN"

echo "before: $(curl -sS -m 15 "$BASE/api/health" -H "$AUTH")"

BODY="$(Q="$Q" node -e 'process.stdout.write(JSON.stringify({q: process.env.Q}))')"
OUT="$(curl -sS -m 40 -w '\n%{http_code}' -X POST "$BASE/api/ask" \
  -H "$AUTH" -H 'Content-Type: application/json' --data-binary "$BODY")"

CODE="$(printf '%s' "$OUT" | tail -n1)"
printf '%s' "$OUT" | sed '$d' | CODE="$CODE" node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j; try{ j=JSON.parse(s); }catch(e){ console.log("http "+process.env.CODE+" — non-JSON response"); process.exit(1); }
  if (j.error) { console.log("http "+process.env.CODE+" — "+j.reason+": "+(j.detail||"")); process.exit(1); }
  console.log("http "+process.env.CODE+" | mode: "+j.mode+" | answer: "+String(j.answer||"").length+" chars | this call: $"+j.usd);
});
'

echo "after:  $(curl -sS -m 15 "$BASE/api/health" -H "$AUTH")"
