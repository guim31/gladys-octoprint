// -----------------------------------------------------------------------------
// The "Application Keys" workflow of OctoPrint (bundled plugin `appkeys`):
// the integration asks for a key, the user approves the request in OctoPrint,
// and the integration receives the key — nothing to copy by hand.
//
// Facts checked on OctoPrint 1.11.8 (test/fixtures/octoprint/appkeys-*.json):
// - POST /plugin/appkeys/request { app } -> 201 { app_token, auth_dialog }, no
//   key needed; `auth_dialog` (1.10+) is the approval page, built from the
//   address the integration used. Rate limited: 3 per minute (429).
// - GET /plugin/appkeys/request/<app_token> -> 202 while pending, 200
//   { api_key } once approved (a single time), 404 when denied or expired.
// - A request nobody polls for 5 seconds expires: poll every second.
// - The request itself lives 10 minutes at most.
// -----------------------------------------------------------------------------

import { OctoPrintClient, OctoPrintError } from './client.js';

export const APP_NAME = 'Gladys Assistant';
export const POLL_INTERVAL_MS = 1000;
export const REQUEST_LIFETIME_MS = 10 * 60 * 1000;

/**
 * Open an access request.
 * @returns {Promise<{ appToken: string, approvalUrl: string }>}
 */
export async function requestAppKey({ baseUrl, fetch }) {
  const client = new OctoPrintClient({ baseUrl, fetch });
  let answer;
  try {
    answer = await client.post('/plugin/appkeys/request', { app: APP_NAME }, { auth: false });
  } catch (err) {
    if (err.kind === 'not_found') {
      throw new OctoPrintError(
        'not_found',
        'The Application Keys plugin of OctoPrint is disabled: paste an API key instead',
        404,
      );
    }
    throw err;
  }
  if (typeof answer?.app_token !== 'string' || answer.app_token === '') {
    throw new OctoPrintError('invalid', 'OctoPrint did not open the access request');
  }
  // Before 1.10 there is no approval page: the request pops up in the
  // OctoPrint interface for every logged-in administrator.
  const approvalUrl =
    typeof answer.auth_dialog === 'string' && /^https?:\/\//.test(answer.auth_dialog)
      ? answer.auth_dialog
      : `${baseUrl}/`;
  return { appToken: answer.app_token, approvalUrl };
}

/**
 * Wait for the decision of the user.
 * @returns {Promise<string | null>} the key, or null when denied, expired or aborted
 */
export async function waitForAppKey({
  baseUrl,
  appToken,
  fetch,
  signal,
  interval = POLL_INTERVAL_MS,
  lifetime = REQUEST_LIFETIME_MS,
  sleep = defaultSleep,
  now = Date.now,
}) {
  const client = new OctoPrintClient({ baseUrl, fetch });
  const deadline = now() + lifetime;
  let failures = 0;
  while (!signal?.aborted && now() < deadline) {
    try {
      const answer = await client.get(`/plugin/appkeys/request/${encodeURIComponent(appToken)}`, {
        auth: false,
      });
      failures = 0;
      if (typeof answer?.api_key === 'string' && answer.api_key !== '') {
        return answer.api_key;
      }
    } catch (err) {
      if (err.kind === 'not_found') {
        return null; // denied, or expired
      }
      // A network hiccup: keep polling, but not forever.
      failures += 1;
      if (failures >= 5) {
        throw err;
      }
    }
    await sleep(interval, signal);
  }
  return null;
}

function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
