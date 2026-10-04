/**
 * The vault, read-only — the three tools the brain has and the one guard they
 * share (Brain-Service-Spec §3, A5).
 *
 * By construction: this file can read a file, run ripgrep with fixed flags and
 * list a directory. It has no write, no delete, no fetch and no shell. Every
 * failure is a short string handed back to the model as a tool error — never
 * a throw that would take the whole /ask down with it.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn as realSpawn } from 'node:child_process';

export const DEFAULT_VAULT = '/Users/mattlancourt/Library/Mobile Documents/com~apple~CloudDocs/LannyAI-Vault';
export const RG_BIN = '/opt/homebrew/bin/rg';

export const READ_CAP_BYTES = 200 * 1024;
export const LIST_CAP = 500;
export const GREP_TIMEOUT_MS = 10_000;
export const GREP_MAX_DEFAULT = 40;
/** A grep that matches every line of a big vault must not buffer it all. */
const GREP_STDOUT_CAP = 512 * 1024;

const DENY = new Set(['.git', '.obsidian', '.trash']);

export function vaultRoot(env = process.env) {
  const v = typeof env.HELM_VAULT === 'string' && env.HELM_VAULT.trim() ? env.HELM_VAULT.trim() : DEFAULT_VAULT;
  return path.resolve(v);
}

/**
 * Resolve a model-supplied path against the vault and prove it stays there.
 *
 * The path is ALWAYS vault-relative — a leading "/" is stripped, not honoured,
 * so "/etc/passwd" means "<vault>/etc/passwd" (which does not exist). Then the
 * real path is taken, so a symlink inside the vault that points out of it is
 * caught by the prefix check rather than followed. Any segment on the deny
 * list, before or after resolving, is refused.
 *
 * Returns {abs, rel} or {error}. `allowRoot` lets list_dir show the vault's
 * top level; nothing else may name the root itself.
 */
export function guardPath(vault, input, { allowRoot = false } = {}) {
  if (typeof input !== 'string') return { error: 'path must be a string' };
  if (input.includes('\0')) return { error: 'path refused' };
  const cleaned = input.replace(/^[/\\]+/, '');
  if (cleaned.split(/[/\\]+/).some((s) => DENY.has(s))) return { error: 'path refused (excluded folder)' };

  let realVault;
  try {
    realVault = fs.realpathSync(vault);
  } catch {
    return { error: 'vault not reachable' };
  }

  const candidate = path.resolve(realVault, cleaned || '.');
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return { error: 'not found' };
  }

  const inside = real.startsWith(realVault + path.sep) || (allowRoot && real === realVault);
  if (!inside) return { error: 'path refused (outside the vault)' };

  const rel = real === realVault ? '' : real.slice(realVault.length + 1);
  if (rel.split(path.sep).some((s) => DENY.has(s))) return { error: 'path refused (excluded folder)' };
  return { abs: real, rel };
}

/** read_file — utf-8 text, 200 KB, tail truncated with a note. */
export async function readFile(vault, p) {
  const g = guardPath(vault, p);
  if (g.error) return { error: g.error };
  let st;
  try {
    st = await fsp.stat(g.abs);
  } catch {
    return { error: 'not found' };
  }
  if (!st.isFile()) return { error: 'not a file' };

  const fh = await fsp.open(g.abs, 'r');
  try {
    const n = Math.min(st.size, READ_CAP_BYTES);
    const buf = Buffer.alloc(n);
    await fh.read(buf, 0, n, 0);
    if (buf.subarray(0, 8192).includes(0)) return { error: 'binary file — not read' };
    let text = buf.toString('utf8');
    if (st.size > READ_CAP_BYTES) text += '\n[truncated at 200 KB]';
    return { text, rel: g.rel };
  } catch {
    return { error: 'could not read' };
  } finally {
    await fh.close();
  }
}

/**
 * The exact argv ripgrep is spawned with. Exported so a test can hold the
 * shape: fixed flags, deny globs, the optional glob, then `--`, then the
 * pattern — a pattern beginning "-" is a pattern, never a flag.
 */
export function grepArgv(vault, pattern, glob) {
  return [
    '-n', '-C', '1', '--max-count', '5', '--color', 'never',
    '-g', '!.git', '-g', '!.obsidian', '-g', '!.trash',
    ...(glob ? ['-g', glob] : []),
    '--', pattern, vault,
  ];
}

/**
 * grep_vault — ripgrep over the vault. argv array, no shell, 10 s, at most
 * `max` matching lines (context lines ride free), paths made vault-relative.
 */
export function grepVault(vault, { pattern, glob, max } = {}, { spawn = realSpawn, rgBin = RG_BIN } = {}) {
  if (typeof pattern !== 'string' || !pattern.length) return Promise.resolve({ error: 'pattern must be a non-empty string' });
  if (glob !== undefined && glob !== null && typeof glob !== 'string') return Promise.resolve({ error: 'glob must be a string' });
  const cap = Math.max(1, Math.min(Number.isFinite(Number(max)) ? Math.floor(Number(max)) : GREP_MAX_DEFAULT, 200));

  let realVault;
  try {
    realVault = fs.realpathSync(vault);
  } catch {
    return Promise.resolve({ error: 'vault not reachable' });
  }

  return new Promise((resolve) => {
    let out = '';
    let errText = '';
    let done = false;
    let child;
    let timer = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    try {
      child = spawn(rgBin, grepArgv(realVault, pattern, glob || undefined), { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return finish({ error: 'ripgrep unavailable' });
    }
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ error: 'grep timed out after 10 s' });
    }, GREP_TIMEOUT_MS);

    child.stdout?.on('data', (d) => {
      if (out.length < GREP_STDOUT_CAP) out += d.toString('utf8');
      else try { child.kill('SIGKILL'); } catch { /* gone */ }
    });
    child.stderr?.on('data', (d) => {
      if (errText.length < 4096) errText += d.toString('utf8');
    });
    child.on('error', () => finish({ error: 'ripgrep unavailable' }));
    child.on('close', (code) => {
      if (code === 1 && !out) return finish({ text: 'no matches', matches: 0 });
      if (code !== 0 && code !== null && !out) return finish({ error: `grep failed: ${errText.trim().split('\n')[0] || `exit ${code}`}` });
      finish(shapeGrep(out, realVault, cap));
    });
  });
}

/** Strip the vault prefix and stop after `cap` match lines. */
export function shapeGrep(raw, realVault, cap) {
  const prefix = realVault + path.sep;
  const lines = [];
  let matches = 0;
  let clipped = false;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const rel = line.startsWith(prefix) ? line.slice(prefix.length) : line;
    // ripgrep marks a match `path:N:` and a context line `path-N-`. Vault
    // names are full of dates ("2026-10-04 - …md"), so anchor on the file
    // extension first and only fall back to the leftmost marker.
    const m = rel.match(/^.*?\.[A-Za-z0-9]{1,8}([:-])\d+\1/) || rel.match(/([:-])\d+\1/);
    const isMatch = !!m && m[1] === ':';
    if (isMatch) {
      if (matches >= cap) {
        clipped = true;
        break;
      }
      matches++;
    }
    lines.push(rel);
  }
  if (clipped) lines.push(`[stopped at ${cap} matches]`);
  return { text: lines.join('\n') || 'no matches', matches };
}

/** list_dir — names, sizes, mtimes; 500 entries; the deny list hidden. */
export async function listDir(vault, p) {
  const g = guardPath(vault, p || '', { allowRoot: true });
  if (g.error) return { error: g.error };
  let entries;
  try {
    entries = await fsp.readdir(g.abs, { withFileTypes: true });
  } catch {
    return { error: 'not a directory' };
  }
  const visible = entries.filter((e) => !DENY.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  const rows = [];
  for (const e of visible.slice(0, LIST_CAP)) {
    let size = null;
    let mtime = null;
    try {
      const st = await fsp.lstat(path.join(g.abs, e.name));
      size = e.isDirectory() ? null : st.size;
      mtime = st.mtime.toISOString();
    } catch {
      /* vanished mid-listing (iCloud) — list it bare */
    }
    rows.push({ name: e.isDirectory() ? `${e.name}/` : e.name, size, mtime });
  }
  const more = visible.length > LIST_CAP ? `\n[${visible.length - LIST_CAP} more entries not shown]` : '';
  return { text: JSON.stringify({ dir: g.rel || '.', entries: rows }) + more, rel: g.rel };
}
