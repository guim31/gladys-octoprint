// -----------------------------------------------------------------------------
// The push link of OctoPrint: the raw WebSocket endpoint of its SockJS server
// (`/sockjs/websocket`), one JSON object per frame.
//
// Handshake checked on OctoPrint 1.11.8: POST /api/login { passive: true }
// with the API key gives `{ name, session }`; the socket is authenticated by
// sending `{ auth: "name:session" }`, then OctoPrint sends `connected`, a
// `history` snapshot, then `current` updates (state, job, progress,
// temperatures) every `throttle` x 500 ms, and every `event` as it happens
// (PrintStarted, PrintDone, PrintFailed...), unthrottled.
//
// Node 22+ ships WebSocket as a global: no dependency needed.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'octoprint-push' });

export const DEFAULT_SOCKET_TIMINGS = {
  // `current` every 5 s: the temperatures move every second while heating,
  // and Gladys accepts 300 states a minute for the whole integration.
  throttle: 10,
  // OctoPrint sends `current` even when idle: silence means a dead link.
  idleTimeout: 60_000,
  reconnectMin: 2_000,
  reconnectMax: 60_000,
};

export function socketUrl(baseUrl) {
  return `${baseUrl.replace(/^http/i, 'ws')}/sockjs/websocket`;
}

/**
 * Emits `message` (each parsed frame), `open` (authenticated and receiving)
 * and `close`. Reconnects by itself until stop().
 */
export class PushLink extends EventEmitter {
  constructor({ client, createSocket = (url) => new WebSocket(url), timings = {} }) {
    super();
    this.client = client;
    this.createSocket = createSocket;
    this.timings = { ...DEFAULT_SOCKET_TIMINGS, ...timings };
    this.socket = null;
    this.running = false;
    this.live = false;
    this.failures = 0;
    this.retryTimer = null;
    this.idleTimer = null;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.#open();
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.idleTimer);
    this.retryTimer = null;
    this.idleTimer = null;
    this.#drop();
  }

  async #open() {
    let session;
    try {
      session = await this.client.login();
    } catch (err) {
      this.#scheduleRetry(`login refused (${err.message})`);
      return;
    }
    if (!this.running) {
      return;
    }
    if (typeof session?.name !== 'string' || typeof session?.session !== 'string') {
      this.#scheduleRetry('no session in the login answer');
      return;
    }
    let socket;
    try {
      socket = this.createSocket(socketUrl(this.client.baseUrl));
    } catch (err) {
      this.#scheduleRetry(err.message);
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ auth: `${session.name}:${session.session}` }));
      socket.send(JSON.stringify({ throttle: this.timings.throttle }));
      this.#armIdle();
    };
    socket.onmessage = (event) => this.#receive(socket, event.data);
    socket.onerror = () => {
      // The close event follows and carries the retry.
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.#setLive(false);
      this.#scheduleRetry('socket closed');
    };
  }

  #receive(socket, raw) {
    if (this.socket !== socket) {
      return;
    }
    let data;
    try {
      data = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') {
      return;
    }
    this.#armIdle();
    if (!this.live && (data.history || data.current)) {
      this.failures = 0;
      this.#setLive(true);
    }
    this.emit('message', data);
  }

  #armIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      logger.warn(`No message from ${this.client.baseUrl} for a while, reconnecting`);
      this.#drop();
      this.#setLive(false);
      this.#scheduleRetry('idle');
    }, this.timings.idleTimeout);
    this.idleTimer.unref?.();
  }

  #setLive(live) {
    if (this.live !== live) {
      this.live = live;
      this.emit(live ? 'open' : 'close');
    }
  }

  #drop() {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
    if (!this.running) {
      this.#setLive(false);
    }
  }

  #scheduleRetry(reason) {
    clearTimeout(this.idleTimer);
    if (!this.running) {
      return;
    }
    this.failures += 1;
    const delay = Math.min(
      this.timings.reconnectMax,
      this.timings.reconnectMin * 2 ** Math.min(this.failures - 1, 10),
    );
    if (this.failures === 1 || this.failures % 10 === 0) {
      logger.info(`Push link to ${this.client.baseUrl} down (${reason}), retrying in ${delay} ms`);
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running) {
        this.#open();
      }
    }, delay);
    this.retryTimer.unref?.();
  }
}
