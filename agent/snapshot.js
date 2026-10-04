/**
 * The board as the brain sees it — copied from worker/worker.js
 * (askSnapshotView + tileDataForModel + TILE_ID_RE), NOT imported: agent/ is
 * standalone and worker.js is a Cloudflare module. Keep the two in step by
 * hand; agent/test/snapshot.test.js holds the shape.
 */

/** Per the brief: a tile bigger than this is sent as a note, not as data. */
export const MAX_TILE_DATA_BYTES = 8 * 1024;

export const TILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function byteLen(s) {
  return Buffer.byteLength(s, 'utf8');
}

/** A tile's data, or a note standing in for it when it is too big to send. */
export function tileDataForModel(data, where) {
  const bytes = byteLen(JSON.stringify(data ?? null));
  if (bytes <= MAX_TILE_DATA_BYTES) return data ?? null;
  return {
    _truncated: true,
    _note: `${where} omitted: ${bytes} bytes exceeds the ${MAX_TILE_DATA_BYTES}-byte per-tile limit`,
    _keys: isObj(data) ? Object.keys(data) : undefined,
  };
}

/**
 * The snapshot as the model sees it: tiles, plus the three header fields that
 * make them readable (`schema`, `generated_at`, `tz`). `run_id` and anything
 * else the engine adds stays out — it is provenance, not board state.
 */
export function askSnapshotView(snapshot) {
  const tiles = {};
  const src = isObj(snapshot) && isObj(snapshot.tiles) ? snapshot.tiles : {};
  for (const [id, tile] of Object.entries(src)) {
    if (!isObj(tile)) continue;
    tiles[id] = { ...tile, data: tileDataForModel(tile.data, `tile \`${id}\` data`) };
  }
  return {
    schema: isObj(snapshot) ? (snapshot.schema ?? null) : null,
    generated_at: isObj(snapshot) ? (snapshot.generated_at ?? null) : null,
    tz: isObj(snapshot) ? (snapshot.tz ?? null) : null,
    tiles,
  };
}
