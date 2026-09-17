// Phase 0 spike graders (2026-09-17) — PROVEN against live ESPN shapes. Reference for M3: same
// return contract {state: pre|lead|trail|win|lose|push, label, why}. Port to docs/live/graders.js
// as pure functions with fixtures; do not import this file from the page. Contains NO real data.
// ---------- graders: (game) -> {state, label, why}   state ∈ pre|lead|trail|win|lose|push ----------
function gUnder(line){ return g=>{
  const t=g.home.score+g.away.score;
  if(g.state==='pre') return {state:'pre',label:'PRE',why:`needs ≤ ${Math.floor(line)} goals`};
  if(t>line) return {state:'lose',label:'DEAD',why:`${t} goals — over ${line}`};
  if(g.state==='post') return {state:'win',label:'WIN',why:`${t} goals — under ${line}`};
  return {state:'lead',label:'ALIVE',why:`${t} goals · room for ${Math.floor(line)-t} · ${g.detail}`};
};}
function gML(side){ return g=>{
  const me=g[side].score, them=g[side==='home'?'away':'home'].score;
  if(g.state==='pre') return {state:'pre',label:'PRE',why:'kickoff pending'};
  const d=me-them, w=d>0?'lead':d<0?'trail':'push';
  if(g.state==='post') return d>0?{state:'win',label:'WIN',why:`${me}–${them} FT`}:{state:'lose',label:'LOSS',why:d<0?`${me}–${them} FT`:`${me}–${them} draw — ML loses`};
  return {state:w,label:w==='lead'?'LEADING':w==='trail'?'TRAILING':'LEVEL',why:`${me}–${them} · ${g.detail}`};
};}
function gHalfSpread(side,line){ return g=>{
  const ls=x=>(x.linescores||[]).slice(0,2).reduce((a,b)=>a+(+b.value||0),0);
  const me=ls(g[side]), them=ls(g[side==='home'?'away':'home']);
  if(g.state==='pre') return {state:'pre',label:'PRE',why:`BUF needs 1H margin > ${line}`};
  const done = g.state==='post' || g.period>=3;
  const m=me-them, cover=m>line;
  if(done) return cover?{state:'win',label:'WIN',why:`1H ${me}–${them} · covered by ${(m-line).toFixed(1)}`}:{state:'lose',label:'LOSS',why:`1H ${me}–${them} · short by ${(line-m).toFixed(1)}`};
  return cover?{state:'lead',label:'COVERING',why:`1H ${me}–${them} · Q${g.period} ${g.clock}`}:{state:'trail',label:'NOT YET',why:`1H ${me}–${them} · needs ${(line-m+0.5).toFixed(1)} more · Q${g.period} ${g.clock}`};
};}
function gAnytimeTD(name){ return g=>{
  if(g.state==='pre') return {state:'pre',label:'PRE',why:'kickoff pending'};
  const hit=(g.scoringPlays||[]).find(p=>/TD|touchdown/i.test(p.type||'')&&(p.text||'').includes(name));
  if(hit) return {state:'win',label:'WIN',why:hit.text.slice(0,70)};
  if(g.state==='post') return {state:'lose',label:'LOSS',why:'no TD'};
  return {state:'trail',label:'WAITING',why:`no TD yet · Q${g.period} ${g.clock}`};
};}

