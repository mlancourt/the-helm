/**
 * persona: "wren" (vault Wren-Tile-Spec WT7/WT8). An invented Wren folder in
 * the temp vault; no key, no model, no network, nothing of Matt's (rule 1).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeVault, fakeSdk, assistant, success, serve } from './helpers.js';
import { buildSystemPrompt, buildWrenSystem, sectionByHeading, newestBrief, BRAIN_PREAMBLE, WREN_PREAMBLE } from '../prompt.js';

const fixture = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

const SKILL = [
  '---',
  'name: invented',
  '---',
  '# Wren — SKILL',
  '',
  '## Mission',
  'MISSION LINE — not in her pin',
  '',
  '---',
  '',
  '## Persona & Voice (to Matt)',
  'PERSONA LINE',
  '### a subsection',
  'PERSONA SUB LINE',
  '',
  '---',
  '',
  '## The Four Loops',
  'LOOPS LINE — not in her pin',
  '## Staying Wren (Matt, 2026-10-25: "invented")',
  'STAYING LINE',
  '## Staying Wrenfield',
  'NOT A MATCH',
  '## Hard Rules (the lines that don\'t move)',
  'RULE LINE',
  '# Top heading ends it',
  'AFTER RULES — not in her pin',
].join('\n');

function wrenVault() {
  const V = makeVault();
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(V.vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(V.vault, rel), text);
  };
  w('06-AI-Stack/Wren/Framework/SKILL.md', SKILL);
  w('06-AI-Stack/Wren/State/Learnings.md', '---\nupdated: x\n---\n# Learnings\n- INVENTED RULING');
  w('06-AI-Stack/Wren/State/Matt-Comms-Profile.md', '---\nupdated: x\n---\n# Profile\nINVENTED PROFILE');
  w('06-AI-Stack/Wren/Briefs/2026-09/2026-09-30 0449 - Brief.md', 'OLD MONTH BRIEF');
  w('06-AI-Stack/Wren/Briefs/2026-10/2026-10-26 0449 - Brief.md', 'OLDER BRIEF');
  w('06-AI-Stack/Wren/Briefs/2026-10/2026-10-27 0449 - Brief.md', '---\ntags: [wren, brief]\n---\n# Wren — invented\n\nNEWEST BRIEF BODY');
  w('06-AI-Stack/Wren/State/People/pat-example.md', 'x');
  w('06-AI-Stack/Wren/State/People/aunt-example.md', 'x');
  w('06-AI-Stack/Wren/State/People/README.md', 'x');
  return V;
}

test('sectionByHeading: by heading prefix, to the next ##, subsections kept, rule dropped', () => {
  assert.equal(sectionByHeading(SKILL, 'Persona & Voice'), '## Persona & Voice (to Matt)\nPERSONA LINE\n### a subsection\nPERSONA SUB LINE');
  assert.equal(sectionByHeading(SKILL, 'Staying Wren'), '## Staying Wren (Matt, 2026-10-25: "invented")\nSTAYING LINE');
  assert.equal(sectionByHeading(SKILL, 'Hard Rules'), "## Hard Rules (the lines that don't move)\nRULE LINE");
  assert.equal(sectionByHeading(SKILL, 'Nope'), null);
  assert.equal(sectionByHeading(null, 'Hard Rules'), null);
});

test('newestBrief: newest month, then newest filename', async () => {
  const V = wrenVault();
  const b = await newestBrief(V.vault);
  assert.equal(b.rel, '06-AI-Stack/Wren/Briefs/2026-10/2026-10-27 0449 - Brief.md');
  assert.match(b.text, /NEWEST BRIEF BODY/);
});

test('the Wren pin: preamble first, her three sections, her State, the brief, dossier names, WT8 last', async () => {
  const V = wrenVault();
  const { system } = await buildWrenSystem(V.vault);
  assert.ok(system.startsWith(BRAIN_PREAMBLE), 'brain preamble first');
  assert.ok(system.endsWith(WREN_PREAMBLE), 'the WT8 preamble closes it');
  assert.match(WREN_PREAMBLE, /^You are Wren, speaking to Matt on his phone\./);
  assert.match(WREN_PREAMBLE, /No ship-talk, no roast, no emoji\.$/);
  for (const s of ['PERSONA LINE', 'PERSONA SUB LINE', 'STAYING LINE', 'RULE LINE', 'INVENTED RULING', 'INVENTED PROFILE', 'NEWEST BRIEF BODY']) assert.ok(system.includes(s), s);
  for (const s of ['MISSION LINE', 'LOOPS LINE', 'NOT A MATCH', 'AFTER RULES', 'OLDER BRIEF', 'OLD MONTH BRIEF', 'updated: x']) assert.ok(!system.includes(s), `not: ${s}`);
  assert.match(system, /dossiers[^\n]*: aunt-example\.md, pat-example\.md$/m);
  assert.ok(!system.includes('README.md'), 'README is not a person');
  assert.ok(system.indexOf('PERSONA LINE') < system.indexOf('STAYING LINE') && system.indexOf('STAYING LINE') < system.indexOf('RULE LINE'));
});

test('the Wren pin carries none of the four excluded blocks', async () => {
  const V = wrenVault();
  const { system } = await buildWrenSystem(V.vault);
  assert.ok(!system.includes('invented header'), 'no hub header');
  assert.ok(!system.includes('INVENTED ABOUT') && !/# About Matt/.test(system), 'no About-Matt');
  assert.ok(!system.includes('ROUTE LINE') && !/Crew Routing/.test(system), 'no Crew Routing');
  assert.ok(!system.includes('invented chili') && !/# Board snapshot/.test(system), 'no board snapshot');
  assert.ok(!system.includes('INVENTED ASK PROMPT'), 'not the Helm ask prompt');
});

test('a missing SKILL is no_system; missing State degrades to notes', async () => {
  const V = makeVault();
  assert.deepEqual(await buildWrenSystem(V.vault), { error: 'no_system' });
  const W = wrenVault();
  fs.rmSync(path.join(W.vault, '06-AI-Stack/Wren/State'), { recursive: true });
  fs.rmSync(path.join(W.vault, '06-AI-Stack/Wren/Briefs'), { recursive: true });
  const { system } = await buildWrenSystem(W.vault);
  assert.match(system, /could not be read/);
  assert.match(system, /\(no brief on file\)/);
  assert.match(system, /\(none yet\)/);
});

test('helm persona unchanged: buildSystemPrompt matches the pre-v1.39 fixture byte for byte', async () => {
  const V = wrenVault(); // her files on disk change nothing for the Helm
  assert.equal((await buildSystemPrompt(V.vault)).system, fixture('helm-system.txt'));
  assert.equal((await buildSystemPrompt(V.vault, { pinned: { tile_id: 'dinner', tile_data: { meal: 'invented chili' } } })).system, fixture('helm-system-pinned.txt'));
});

const sdkOk = () => fakeSdk(async function* () {
  yield assistant('m1', 'hi');
  yield success('hi');
});

test('POST /ask: persona absent and "helm" send the identical Helm system; "wren" sends hers', async () => {
  const V = wrenVault();
  const seen = {};
  for (const persona of [undefined, 'helm', 'wren']) {
    const sdk = sdkOk();
    const s = await serve({ env: V.env, loadSdk: async () => sdk });
    try {
      const r = await s.req('POST', '/ask', persona === undefined ? { q: 'hello' } : { q: 'hello', persona });
      assert.equal(r.status, 200);
      assert.equal(r.json.mode, 'vault');
      seen[String(persona)] = sdk.seen.options;
    } finally {
      await s.close();
    }
  }
  assert.equal(seen.undefined.systemPrompt, fixture('helm-system.txt'));
  assert.equal(seen.helm.systemPrompt, seen.undefined.systemPrompt);
  assert.ok(seen.wren.systemPrompt.endsWith(WREN_PREAMBLE));
  // Same door: same tools, same fence, same turn limit.
  assert.deepEqual(seen.wren.allowedTools, seen.helm.allowedTools);
  assert.deepEqual(seen.wren.tools, []);
  assert.equal(seen.wren.maxTurns, seen.helm.maxTurns);
  assert.equal(seen.wren.permissionMode, 'dontAsk');
});

test('POST /ask: an unknown persona is 400 bad_persona and the model is never called', async () => {
  const V = wrenVault();
  for (const persona of ['captain', '', 7, { x: 1 }, 'WREN']) {
    const sdk = sdkOk();
    const s = await serve({ env: V.env, loadSdk: async () => sdk });
    try {
      const r = await s.req('POST', '/ask', { q: 'hello', persona });
      assert.equal(r.status, 400, JSON.stringify(persona));
      assert.deepEqual(r.json, { reason: 'bad_persona' });
      assert.equal(sdk.seen.calls, 0);
    } finally {
      await s.close();
    }
  }
});

test('POST /ask persona wren with no SKILL on disk → 503 no_system', async () => {
  const V = makeVault();
  const sdk = sdkOk();
  const s = await serve({ env: V.env, loadSdk: async () => sdk });
  try {
    const r = await s.req('POST', '/ask', { q: 'hello', persona: 'wren' });
    assert.equal(r.status, 503);
    assert.equal(r.json.reason, 'no_system');
    assert.equal(sdk.seen.calls, 0);
  } finally {
    await s.close();
  }
});

test('the audit line says which persona answered, and still no question text', async () => {
  const V = wrenVault();
  for (const persona of ['wren', undefined]) {
    const s = await serve({ env: V.env, loadSdk: async () => sdkOk() });
    try {
      await s.req('POST', '/ask', { q: 'INVENTED-QUESTION-TEXT', persona });
    } finally {
      await s.close();
    }
  }
  const raw = fs.readFileSync(path.join(V.logs, 'ask-audit.jsonl'), 'utf8');
  const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.persona), ['wren', 'helm']);
  assert.ok(!raw.includes('INVENTED-QUESTION-TEXT'));
});
