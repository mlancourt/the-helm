/**
 * /ask, brain first (Brain-Service-Spec A10).
 *
 * The vault-smart brain on the mini answers when it can; the Worker's
 * snapshot-only /api/ask answers when it cannot. The page never holds a brain
 * token — the Cloudflare Access cookie on brain.<domain> is the credential,
 * which is why this one fetch, to this one origin, carries
 * `credentials: 'include'` (rule 4).
 *
 *   brain 200 JSON              → that answer, mode "vault"
 *   401 / 403 / Access redirect → throw {reason:'signin', login}
 *   429                         → throw {reason:'cap'} (no fallback: the
 *                                 brain's rail is spent, and quietly spending
 *                                 the Worker's instead would defeat A7)
 *   5xx / network / timeout     → the Worker, mode "snapshot"
 *
 * Pure: fetch and the Worker call are injected, so tools/test-brain.js drives
 * every branch with no browser and no network.
 */

export const BRAIN_TIMEOUT_MS = 95_000;

/** Access's login pages live on the team domain. */
const ACCESS_LOGIN_RE = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\//i;

function fail(reason, extra = {}) {
  const e = new Error(reason);
  e.reason = reason;
  Object.assign(e, extra);
  return e;
}

export async function askBrainFirst(payload, { brainBase, workerAsk, fetchImpl = fetch, timeoutMs = BRAIN_TIMEOUT_MS }) {
  const login = `${brainBase}/health`;
  const fallback = async () => {
    const r = await workerAsk(payload);
    return { ...r, mode: 'snapshot' };
  };

  let res;
  try {
    res = await fetchImpl(`${brainBase}/ask`, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // TypeError (unreachable, CORS refused) or the 95 s timeout.
    return fallback();
  }

  // Access answers an unsigned request with a redirect to its login page;
  // `redirect: 'manual'` turns that into an opaque redirect we can see.
  if (
    res.type === 'opaqueredirect' ||
    (res.status >= 300 && res.status < 400) ||
    res.status === 401 ||
    res.status === 403 ||
    ACCESS_LOGIN_RE.test(res.url || '')
  ) {
    throw fail('signin', { login });
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* an HTML error page from the tunnel */
  }

  if (res.status === 429) throw fail('cap');
  if (res.status >= 500 || res.status === 0) return fallback();
  if (!res.ok) throw fail(data?.reason || `http ${res.status}`);
  if (!data || typeof data.answer !== 'string') return fallback();

  return {
    answer: data.answer,
    mode: 'vault',
    usd: typeof data.usd === 'number' ? data.usd : undefined,
    files_read: Array.isArray(data.files_read) ? data.files_read.filter((f) => typeof f === 'string') : [],
    ms: typeof data.ms === 'number' ? data.ms : undefined,
  };
}
