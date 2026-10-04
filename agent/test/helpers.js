/**
 * Shared test kit: an invented vault in a temp dir, a fake Agent SDK that
 * drives the real tool handlers, and an http harness around createApp().
 * No key, no model, no network, nothing of Matt's (rule 1).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server.js';

export function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-vault-'));
  const vault = path.join(root, 'Vault');
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
    fs.writeFileSync(path.join(vault, rel), text);
  };
  w('06-AI-Stack/The-Helm/Ask-System-Prompt-v1.md', 'INVENTED ASK PROMPT');
  w('06-AI-Stack/_LannyAI-Hub.md', '---\ntags: [x]\n---\n# Hub\n\n> intro\n\n**Last updated:** invented header\n\n**later bold**\n');
  w('06-AI-Stack/The-Captain/About-Matt.md', '---\na: b\n---\nINVENTED ABOUT');
  w(
    '06-AI-Stack/Architecture/LannyAI-Architect-Charter.md',
    '# Charter\n### Before\nx\n### Crew Routing (defer, then discuss)\nROUTE LINE\n\nmore routing\n### Cadence\nnot this\n'
  );
  w(
    '06-AI-Stack/The-Helm/_runtime/helm-data.json',
    JSON.stringify({ schema: 1, generated_at: '2026-10-04T12:00:00Z', run_id: 'run-x', tz: 'America/Chicago', tiles: { dinner: { band: 'DAILY', status: 'ok', data: { meal: 'invented chili' } } } })
  );
  w('Notes/hello.md', 'hello from an invented note');
  w('.git/config', 'secret');
  w('.obsidian/app.json', '{}');
  fs.writeFileSync(path.join(root, 'outside.txt'), 'outside the vault');
  fs.symlinkSync(path.join(root, 'outside.txt'), path.join(vault, 'Notes', 'escape.md'));
  const logs = path.join(root, 'logs');
  const config = path.join(root, 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'anthropic-key'), 'test-key-not-real\n');
  return { root, vault, logs, config, env: { HELM_VAULT: vault, HELM_LOG_DIR: logs, HELM_CONFIG_DIR: config, PATH: process.env.PATH } };
}

/**
 * A stand-in for @anthropic-ai/claude-agent-sdk. `script(ctx)` is an async
 * generator body: it may call ctx.call(toolName, args) to run a REAL tool
 * handler, and yields SDK messages.
 */
export function fakeSdk(script) {
  const seen = { options: null, prompt: null, calls: 0 };
  const sdk = {
    seen,
    tool: (name, description, schema, handler) => ({ name, description, schema, handler }),
    createSdkMcpServer: (o) => ({ type: 'sdk', name: o.name, instance: { tools: o.tools } }),
    query({ prompt, options }) {
      seen.calls++;
      seen.options = options;
      seen.prompt = prompt;
      const tools = Object.fromEntries(options.mcpServers.vault.instance.tools.map((t) => [t.name, t]));
      const call = async (name, args) => tools[name].handler(args, {});
      return script({ call, options });
    },
  };
  return sdk;
}

export const assistant = (id, text, usage = { input_tokens: 100, output_tokens: 10 }) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id, model: 'claude-sonnet-5-5', content: text ? [{ type: 'text', text }] : [], usage },
});

export const success = (text, extra = {}) => ({
  type: 'result',
  subtype: 'success',
  result: text,
  num_turns: 2,
  modelUsage: { 'claude-sonnet-5-5': { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
  ...extra,
});

export async function serve(deps) {
  const server = http.createServer(createApp({ log: () => {}, ...deps }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { base, req, close: () => new Promise((r) => server.close(r)) };
}
