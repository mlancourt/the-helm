import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askSnapshotView, TILE_ID_RE, MAX_TILE_DATA_BYTES } from '../snapshot.js';
import { modelPrices, estimateUsd, priceModelUsage, ASK_PRICE_UNKNOWN } from '../prices.js';
import { hubHeaderLine, crewRoutingSection } from '../prompt.js';

test('askSnapshotView: header fields + tiles; run_id out; big tile → note', () => {
  const v = askSnapshotView({ schema: 1, generated_at: 'g', tz: 'America/Chicago', run_id: 'r', extra: 1, tiles: { a: { status: 'ok', data: { x: 1 } }, b: { data: 'y'.repeat(MAX_TILE_DATA_BYTES + 1) }, c: 'junk' } });
  assert.deepEqual(Object.keys(v), ['schema', 'generated_at', 'tz', 'tiles']);
  assert.deepEqual(v.tiles.a, { status: 'ok', data: { x: 1 } });
  assert.equal(v.tiles.b.data._truncated, true);
  assert.ok(!('c' in v.tiles));
  assert.deepEqual(askSnapshotView(null), { schema: null, generated_at: null, tz: null, tiles: {} });
});

test('TILE_ID_RE matches the Worker', () => {
  assert.ok(TILE_ID_RE.test('bets_live'));
  assert.ok(!TILE_ID_RE.test('../x'));
  assert.ok(!TILE_ID_RE.test('_x'));
});

test('prices: sonnet-5-5 has its own row at the /draft price; unknown is the top tier', () => {
  assert.deepEqual(modelPrices('claude-sonnet-5-5'), { in: 2, out: 10 });
  assert.deepEqual(modelPrices('claude-sonnet-5'), { in: 2, out: 10 });
  assert.deepEqual(modelPrices('mystery-model'), ASK_PRICE_UNKNOWN);
  assert.equal(estimateUsd('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e5 }), 3);
  assert.equal(estimateUsd('claude-sonnet-5-5', { cache_read_input_tokens: 1e6 }), 0.2);
  const p = priceModelUsage({ 'claude-sonnet-5-5': { inputTokens: 1e6, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } });
  assert.deepEqual(p, { usd: 2, tokens_in: 1e6, tokens_out: 0 });
});

test('hub header: first ** line after frontmatter; works with none', () => {
  assert.equal(hubHeaderLine('---\na: "**no"\n---\n# H\n**Last:** x\n**two**'), '**Last:** x');
  assert.equal(hubHeaderLine('# H\n> q\n**Last:** y'), '**Last:** y');
  assert.equal(hubHeaderLine(null), null);
});

test('crew routing: heading to next ###', () => {
  assert.equal(crewRoutingSection('### A\nx\n### Crew Routing (defer)\nr1\nr2\n### B\nno'), '### Crew Routing (defer)\nr1\nr2');
  assert.equal(crewRoutingSection('no section'), null);
});
