// -----------------------------------------------------------------------------
// HTTP client of the OctoPrint REST API (https://docs.octoprint.org/en/master/api/).
//
// Every call carries the API key in the `X-Api-Key` header, never in the URL:
// URLs end up in logs. Errors are sorted into the few kinds the rest of the
// integration acts upon, and their messages never contain the key.
// -----------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;

// The snapshot proxy of OctoPrint >= 1.9: OctoPrint fetches the image from the
// webcam itself, so its address (often 127.0.0.1 on the Raspberry Pi) does not
// have to be reachable from Gladys.
export const SNAPSHOT_PATH = '/downloads/camera/current';

export class OctoPrintError extends Error {
  /**
   * @param {'unreachable' | 'unauthorized' | 'conflict' | 'not_found' | 'rate_limited' | 'http' | 'invalid'} kind
   * @param {string} message
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'OctoPrintError';
    this.kind = kind;
    this.status = status;
  }
}

function kindOfStatus(status) {
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 409) {
    return 'conflict';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  return 'http';
}

export class OctoPrintClient {
  /**
   * @param {object} options
   * @param {string} options.baseUrl normalized base URL (see normalizeUrl)
   * @param {string} [options.apiKey]
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeout] per-request timeout, in ms
   */
  constructor({ baseUrl, apiKey = '', fetch = globalThis.fetch, timeout = DEFAULT_TIMEOUT_MS }) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.fetch = fetch;
    this.timeout = timeout;
  }

  async #send(method, path, { body, auth = true, accept = 'json' } = {}) {
    const headers = {};
    if (auth && this.apiKey) {
      headers['X-Api-Key'] = this.apiKey;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
        redirect: 'manual',
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new OctoPrintError('unreachable', `OctoPrint unreachable (${reason})`);
    }
    if (response.status >= 300 && response.status < 400) {
      // Redirects are not followed: the API key would travel to wherever the
      // Location points. The user enters the final address instead.
      const location = response.headers.get('location') ?? '';
      throw new OctoPrintError(
        'http',
        `HTTP ${response.status}: OctoPrint redirects to ${location.split('?')[0] || 'another address'}, enter that address`.slice(
          0,
          300,
        ),
        response.status,
      );
    }
    if (response.status >= 400) {
      let detail = '';
      try {
        const data = await response.json();
        detail = typeof data?.error === 'string' ? `: ${data.error}` : '';
      } catch {
        // Not JSON (a reverse proxy page): the status says enough.
      }
      throw new OctoPrintError(
        kindOfStatus(response.status),
        `HTTP ${response.status} on ${method} ${path}${detail}`.slice(0, 300),
        response.status,
      );
    }
    if (accept === 'binary') {
      return {
        type: response.headers.get('content-type') ?? '',
        data: Buffer.from(await response.arrayBuffer()),
      };
    }
    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    if (text === '') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new OctoPrintError('invalid', `Not an OctoPrint answer on ${path}`, response.status);
    }
  }

  get(path, options) {
    return this.#send('GET', path, options);
  }

  post(path, body, options) {
    return this.#send('POST', path, { ...options, body });
  }

  /** `{ api, server, text }`; also checks the key (403 without a valid one). */
  getVersion() {
    return this.get('/api/version');
  }

  /** Printer state and temperatures; null while the printer is not connected (409). */
  async getPrinter() {
    try {
      return await this.get('/api/printer');
    } catch (err) {
      if (err.kind === 'conflict') {
        return null;
      }
      throw err;
    }
  }

  getJob() {
    return this.get('/api/job');
  }

  getProfiles() {
    return this.get('/api/printerprofiles');
  }

  getConnection() {
    return this.get('/api/connection');
  }

  /** Needs the SETTINGS_READ permission; null when the key lacks it. */
  async getSettings() {
    try {
      return await this.get('/api/settings');
    } catch (err) {
      if (err.kind === 'unauthorized') {
        return null;
      }
      throw err;
    }
  }

  /** A session for the push socket: `{ name, session }`. */
  login() {
    return this.post('/api/login', { passive: true });
  }

  // Job commands answer 409 when there is nothing to pause, resume or cancel.
  pause() {
    return this.post('/api/job', { command: 'pause', action: 'pause' });
  }

  resume() {
    return this.post('/api/job', { command: 'pause', action: 'resume' });
  }

  cancel() {
    return this.post('/api/job', { command: 'cancel' });
  }

  /** @param {Record<string, number>} targets e.g. `{ tool0: 210 }` */
  setToolTargets(targets) {
    return this.post('/api/printer/tool', { command: 'target', targets });
  }

  setBedTarget(target) {
    return this.post('/api/printer/bed', { command: 'target', target });
  }

  setChamberTarget(target) {
    return this.post('/api/printer/chamber', { command: 'target', target });
  }

  /** The current webcam image, through OctoPrint: `{ type, data }`. */
  snapshot() {
    return this.#send('GET', SNAPSHOT_PATH, { accept: 'binary' });
  }
}
