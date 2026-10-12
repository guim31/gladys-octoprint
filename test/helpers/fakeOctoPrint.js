// -----------------------------------------------------------------------------
// An OctoPrint instance in memory: its REST API (a `fetch` implementation) and
// its push socket (a WebSocket stand-in), answering with the bodies recorded
// on OctoPrint 1.11.8 (test/fixtures/octoprint/). The tests drive it: change
// the printer state, emit OctoPrint events, take OctoPrint down, decide an
// access request.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

// Silent integration logs (LOG_LEVEL is read on every log call);
// LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export function fixture(name) {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/octoprint/${name}`, import.meta.url), 'utf8'),
  );
}

export const API_KEY = 'TEST-KEY-0123456789abcdefghijklmnopqrstuvwx';
export const GRANTED_KEY = fixture('appkeys-granted.json').api_key;

/** printer + job fixtures of each recorded state. */
export const STATES = {
  operational: () => [fixture('printer-operational.json'), fixture('job-idle.json')],
  printing: () => [fixture('printer-printing.json'), fixture('job-printing.json')],
  printingShort: () => [fixture('printer-printing-short.json'), fixture('job-printing-short.json')],
  pausing: () => [fixture('printer-pausing.json'), fixture('job-pausing.json')],
  paused: () => [fixture('printer-paused.json'), fixture('job-paused.json')],
  done: () => [fixture('printer-done.json'), fixture('job-done.json')],
  cancelled: () => [fixture('printer-cancelled.json'), fixture('job-cancelled.json')],
  offline: () => [null, fixture('job-offline.json')],
  // After an emergency stop (M112) during a print.
  error: () => [null, fixture('job-offline-error.json')],
};

const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

class FakeSocket {
  constructor(server, url) {
    this.server = server;
    this.url = url;
    this.sent = [];
    this.closed = false;
    this.authenticated = false;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    setImmediate(() => {
      if (this.closed) {
        return;
      }
      if (!server.websocket || server.down) {
        this.#close();
        return;
      }
      this.onopen?.();
    });
  }

  send(text) {
    const data = JSON.parse(text);
    this.sent.push(data);
    if (data.auth) {
      if (data.auth !== `admin:${this.server.session}`) {
        this.#close();
        return;
      }
      this.authenticated = true;
      this.deliver({ connected: fixture('push-session.json')[0].message.connected });
      this.deliver({ history: this.server.pushPayload() });
    }
  }

  deliver(message) {
    if (!this.closed && this.authenticated) {
      setImmediate(() => this.onmessage?.({ data: JSON.stringify(message) }));
    }
  }

  close() {
    this.#close();
  }

  #close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    setImmediate(() => this.onclose?.({ code: 1000 }));
  }
}

export function createOctoPrint({
  host = '192.0.2.10',
  apiKey = API_KEY,
  profiles = fixture('printerprofiles.json'),
  settings = fixture('settings-no-webcam.json'),
  state = 'operational',
  websocket = true,
  appkeys = true,
  image = null,
} = {}) {
  const server = {
    host,
    url: `http://${host}`,
    apiKey,
    profiles,
    settings,
    websocket,
    appkeys,
    image,
    down: false,
    session: 'session-1',
    requests: [],
    commands: [],
    sockets: [],
    appKeyRequests: 0,
    decision: 'pending', // pending | granted | denied
    printer: null,
    job: null,

    setState(name) {
      [server.printer, server.job] = STATES[name]();
      server.pushCurrent();
    },

    /** The `current` / `history` payload the socket would carry. */
    pushPayload() {
      const temps = server.printer?.temperature
        ? [
            {
              time: 1791832240,
              ...Object.fromEntries(
                Object.entries(server.printer.temperature).map(([heater, value]) => [
                  heater,
                  { actual: value.actual, target: value.target },
                ]),
              ),
            },
          ]
        : [];
      return {
        state: server.printer?.state ?? {
          text: server.job.state,
          flags: { closedOrError: true },
          error: '',
        },
        job: server.job.job,
        progress: server.job.progress,
        temps,
      };
    },

    liveSockets() {
      return server.sockets.filter((s) => !s.closed && s.authenticated);
    },

    pushCurrent() {
      for (const socket of server.liveSockets()) {
        socket.deliver({ current: server.pushPayload() });
      }
    },

    emitEvent(type, payload = {}) {
      for (const socket of server.liveSockets()) {
        socket.deliver({ event: { type, payload } });
      }
    },

    dropSockets() {
      for (const socket of server.sockets) {
        socket.close();
      }
    },

    createSocket(url) {
      const socket = new FakeSocket(server, url);
      server.sockets.push(socket);
      return socket;
    },

    async fetch(input, init = {}) {
      const url = new URL(input);
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : undefined;
      const key = init.headers?.['X-Api-Key'];
      server.requests.push({ method, path: url.pathname, body, key });
      if (server.down) {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      return route(method, url.pathname, body, key);
    },
  };

  function route(method, path, body, key) {
    // Application Keys: no key needed.
    if (path === '/plugin/appkeys/request' && method === 'POST') {
      if (!server.appkeys) {
        return json(404, { error: 'The requested URL was not found on the server.' });
      }
      server.appKeyRequests += 1;
      if (server.appKeyRequests > 3) {
        return json(429, fixture('appkeys-ratelimited.json'));
      }
      const answer = fixture('appkeys-request.json');
      answer.auth_dialog = answer.auth_dialog.replace('http://192.0.2.10', server.url);
      return json(201, answer);
    }
    if (path.startsWith('/plugin/appkeys/request/') && method === 'GET') {
      if (server.decision === 'pending') {
        return json(202, fixture('appkeys-pending.json'));
      }
      if (server.decision === 'granted') {
        server.decision = 'consumed';
        return json(200, fixture('appkeys-granted.json'));
      }
      return json(404, { error: 'The requested URL was not found on the server.' });
    }

    if (key !== server.apiKey) {
      return json(403, fixture('error-forbidden.json'));
    }
    if (method === 'GET') {
      switch (path) {
        case '/api/version':
          return json(200, fixture('version.json'));
        case '/api/printerprofiles':
          return json(200, server.profiles);
        case '/api/settings':
          return json(200, server.settings);
        case '/api/printer':
          return server.printer
            ? json(200, server.printer)
            : json(409, { error: 'Printer is not operational' });
        case '/api/job':
          return json(200, server.job);
        case '/downloads/camera/current':
          return server.image
            ? new Response(server.image, { status: 200, headers: { 'content-type': 'image/jpeg' } })
            : json(404, { error: 'No webcam' });
        default:
          return json(404, { error: 'Not found' });
      }
    }
    if (method === 'POST') {
      if (path === '/api/login') {
        return json(200, { name: 'admin', session: server.session, apikey: null });
      }
      server.commands.push({ path, body });
      const code = server.printer?.state?.text ?? 'Offline';
      if (path === '/api/job') {
        const printing = ['Printing', 'Pausing', 'Paused', 'Resuming'].includes(code);
        if (!printing) {
          return json(409, { error: 'Printer is not printing' });
        }
        return new Response(null, { status: 204 });
      }
      if (path === '/api/printer/chamber') {
        const hasChamber = Object.values(server.profiles.profiles).some(
          (p) => p.current && p.heatedChamber,
        );
        return hasChamber
          ? new Response(null, { status: 204 })
          : json(409, { error: 'Printer does not have a heated chamber' });
      }
      if (path === '/api/printer/tool' || path === '/api/printer/bed') {
        return server.printer
          ? new Response(null, { status: 204 })
          : json(409, { error: 'Printer is not operational' });
      }
    }
    return json(404, { error: 'Not found' });
  }

  [server.printer, server.job] = STATES[state]();
  return server;
}

/** One fetch / createSocket for several fake instances, routed by host. */
export function network(...servers) {
  const byHost = (url) => {
    const host = new URL(url).host;
    const server = servers.find((s) => s.host === host);
    if (!server) {
      throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
    }
    return server;
  };
  return {
    fetch: async (input, init) => byHost(input).fetch(input, init),
    createSocket: (url) => byHost(url.replace(/^ws/, 'http')).createSocket(url),
  };
}

/** Let the pending promises and setImmediate callbacks run. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
