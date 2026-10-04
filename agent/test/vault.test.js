import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { guardPath, readFile, grepVault, grepArgv, listDir, READ_CAP_BYTES } from '../vault.js';
import { makeVault } from './helpers.js';

const V = makeVault();

test('path guard: a vault-relative path resolves inside', () => {
  const g = guardPath(V.vault, 'Notes/hello.md');
  assert.equal(g.rel, path.join('Notes', 'hello.md'));
});

test('path guard: ../ cannot climb out', () => {
  assert.match(guardPath(V.vault, '../outside.txt').error, /outside the vault/);
  assert.match(guardPath(V.vault, 'Notes/../../outside.txt').error, /outside the vault/);
});

test('path guard: a leading slash is vault-relative, never absolute', () => {
  assert.equal(guardPath(V.vault, '/etc/passwd').error, 'not found');
  assert.equal(guardPath(V.vault, '/Notes/hello.md').rel, path.join('Notes', 'hello.md'));
});

test('path guard: a symlink inside the vault pointing out is refused', () => {
  assert.ok(fs.lstatSync(path.join(V.vault, 'Notes', 'escape.md')).isSymbolicLink());
  assert.match(guardPath(V.vault, 'Notes/escape.md').error, /outside the vault/);
});

test('path guard: .git / .obsidian / .trash are denied', () => {
  assert.match(guardPath(V.vault, '.git/config').error, /excluded/);
  assert.match(guardPath(V.vault, 'Notes/../.git/config').error, /excluded/);
  assert.match(guardPath(V.vault, '.obsidian/app.json').error, /excluded/);
  assert.match(guardPath(V.vault, '.trash').error, /excluded/);
});

test('path guard: the root itself only for list_dir', () => {
  assert.match(guardPath(V.vault, '').error, /outside/);
  assert.equal(guardPath(V.vault, '', { allowRoot: true }).rel, '');
});

test('path guard: a symlinked dir into .git is denied after resolving', () => {
  const link = path.join(V.vault, 'Notes', 'gitlink');
  fs.symlinkSync(path.join(V.vault, '.git'), link);
  try {
    assert.match(guardPath(V.vault, 'Notes/gitlink/config').error, /excluded/);
  } finally {
    fs.unlinkSync(link);
  }
});

test('read_file: errors are strings, never throws', async () => {
  assert.deepEqual(await readFile(V.vault, '../outside.txt'), { error: 'path refused (outside the vault)' });
  assert.equal((await readFile(V.vault, 'Notes')).error, 'not a file');
  assert.equal((await readFile(V.vault, 42)).error, 'path must be a string');
});

test('read_file: 200 KB cap, tail truncated with a note', async () => {
  const big = 'a'.repeat(READ_CAP_BYTES + 5000);
  fs.writeFileSync(path.join(V.vault, 'Notes', 'big.md'), big);
  const r = await readFile(V.vault, 'Notes/big.md');
  assert.ok(r.text.endsWith('\n[truncated at 200 KB]'));
  assert.equal(r.text.length, READ_CAP_BYTES + '\n[truncated at 200 KB]'.length);
  const small = await readFile(V.vault, 'Notes/hello.md');
  assert.equal(small.text, 'hello from an invented note');
});

test('read_file: binary refused', async () => {
  fs.writeFileSync(path.join(V.vault, 'Notes', 'img.png'), Buffer.from([0x89, 0x50, 0, 0, 1]));
  assert.match((await readFile(V.vault, 'Notes/img.png')).error, /binary/);
});

function fakeSpawn(stdout, code = 0) {
  const calls = [];
  const spawn = (bin, argv, opts) => {
    calls.push({ bin, argv, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      child.emit('close', code);
    });
    return child;
  };
  return { spawn, calls };
}

test('grep argv: an array, fixed flags, deny globs, pattern after --', async () => {
  const real = fs.realpathSync(V.vault);
  const f = fakeSpawn('');
  await grepVault(V.vault, { pattern: '-rf --pre=sh', glob: '*.md' }, { spawn: f.spawn });
  assert.equal(f.calls.length, 1);
  const { bin, argv, opts } = f.calls[0];
  assert.equal(bin, '/opt/homebrew/bin/rg');
  assert.ok(Array.isArray(argv));
  assert.ok(!opts || !opts.shell, 'never a shell');
  assert.deepEqual(argv, [
    '-n', '-C', '1', '--max-count', '5', '--color', 'never',
    '-g', '!.git', '-g', '!.obsidian', '-g', '!.trash',
    '-g', '*.md',
    '--', '-rf --pre=sh', real,
  ]);
  const dd = argv.indexOf('--');
  assert.equal(argv[dd + 1], '-rf --pre=sh', 'the pattern sits right after --');
  assert.deepEqual(grepArgv(real, 'x').slice(-3), ['--', 'x', real], 'no glob → no -g for it');
});

test('grep: paths come back vault-relative; match cap holds; context rides free', async () => {
  const real = fs.realpathSync(V.vault);
  const out = [
    `${real}/Daily/2026-10-04 - Note.md-1-context before`,
    `${real}/Daily/2026-10-04 - Note.md:2:first hit`,
    `${real}/Daily/2026-10-04 - Note.md-3-context after`,
    '--',
    `${real}/A.md:7:second hit`,
    `${real}/B.md:9:third hit`,
  ].join('\n');
  const f = fakeSpawn(out);
  const r = await grepVault(V.vault, { pattern: 'hit', max: 2 }, { spawn: f.spawn });
  assert.equal(r.matches, 2);
  assert.ok(!r.text.includes(real), 'no absolute paths');
  assert.ok(r.text.includes('Daily/2026-10-04 - Note.md:2:first hit'));
  assert.ok(r.text.includes('A.md:7:second hit'));
  assert.ok(!r.text.includes('third hit'));
  assert.ok(r.text.endsWith('[stopped at 2 matches]'));
});

test('grep: no matches and failures are strings', async () => {
  assert.equal((await grepVault(V.vault, { pattern: 'x' }, { spawn: fakeSpawn('', 1).spawn })).text, 'no matches');
  assert.ok((await grepVault(V.vault, { pattern: '' })).error);
  const boom = () => {
    throw new Error('ENOENT');
  };
  assert.equal((await grepVault(V.vault, { pattern: 'x' }, { spawn: boom })).error, 'ripgrep unavailable');
});

test('list_dir: names, sizes, mtimes; deny list hidden; root allowed', async () => {
  const r = await listDir(V.vault, '');
  const j = JSON.parse(r.text);
  const names = j.entries.map((e) => e.name);
  assert.ok(names.includes('Notes/'));
  assert.ok(!names.some((n) => n.startsWith('.git') || n.startsWith('.obsidian')));
  const notes = JSON.parse((await listDir(V.vault, 'Notes')).text);
  const hello = notes.entries.find((e) => e.name === 'hello.md');
  assert.equal(hello.size, 'hello from an invented note'.length);
  assert.match(hello.mtime, /^\d{4}-\d\d-\d\dT/);
  assert.match((await listDir(V.vault, '../')).error, /outside/);
});

test('list_dir: 500-entry cap', async () => {
  const dir = path.join(V.vault, 'Many');
  fs.mkdirSync(dir);
  for (let i = 0; i < 510; i++) fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, '0')}.md`), '');
  const r = await listDir(V.vault, 'Many');
  const [jsonPart, note] = r.text.split('\n');
  assert.equal(JSON.parse(jsonPart).entries.length, 500);
  assert.match(note, /10 more entries/);
});
