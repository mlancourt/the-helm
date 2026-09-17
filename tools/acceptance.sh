#!/usr/bin/env bash
# The Helm — M3 acceptance probe.
#
#   tools/acceptance.sh
#
# Reads the page token from token.local.txt (gitignored by *.local.*) so the
# token never appears in a command line, a shell history, or this repo.
#
# Prints SHAPE ONLY: counts, markets, leagues, event ids and grade outcomes.
# It deliberately does not print stakes, prices or bankroll — the real board is
# Matt's data and has no business scrolling through a build transcript, let
# alone landing on disk here.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${HELM_BASE:-https://the-helm.mlancourt.workers.dev}"
if [ ! -f token.local.txt ]; then
  echo "token.local.txt not found — see the runbook." >&2
  exit 1
fi
TOKEN="$(tr -d '[:space:]' < token.local.txt)"

curl -sS -m 25 "$BASE/api/data" -H "Authorization: Bearer $TOKEN" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j; try{ j=JSON.parse(s); }catch(e){ console.log("non-JSON response"); process.exit(1); }
  if (j.error) { console.log("ERROR:", j.reason, j.detail||""); process.exit(1); }
  const tiles=j.snapshot?.tiles||{};
  console.log("me:", j.me?.name, "| role:", j.me?.role);
  console.log("snapshot generated_at:", j.snapshot?.generated_at, "| schema", j.snapshot?.schema);
  console.log("tiles:", Object.keys(tiles).join(", "));
  console.log("pending events:", (j.pending||[]).length);
  const t=tiles.bets_live?.data?.tickets||[];
  console.log("\nbets_live: "+t.length+" tickets");
  const byMarket={}, byLeague={};
  for(const x of t){ byMarket[x.market]=(byMarket[x.market]||0)+1; byLeague[x.league]=(byLeague[x.league]||0)+1; }
  console.log("  markets:", JSON.stringify(byMarket));
  console.log("  leagues:", JSON.stringify(byLeague));
  console.log("  espn_event_ids:", [...new Set(t.map(x=>x.espn_event_id))].join(", "));
  const mk=tiles.mke_board?.data?.teams||[];
  console.log("mke_board:", mk.map(x=>x.league+":"+x.abbr).join(", "));
});
'
