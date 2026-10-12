// -----------------------------------------------------------------------------
// One OctoPrint instance: connection, live state, print events and commands.
//
// The push link is the main path: exact events from OctoPrint (PrintDone with
// its duration, PrintFailed with its reason) and states every few seconds.
// When it cannot be opened (a reverse proxy without WebSocket, an old
// OctoPrint), the REST API is polled instead and the events are derived from
// the state transitions.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger } from '@gladysassistant/integration-sdk';
import { OctoPrintClient } from './octoprint/client.js';
import { ACTIVE_STATES, fromPush, fromRest, readCapabilities } from './octoprint/model.js';
import { PushLink } from './octoprint/socket.js';

const logger = createLogger({ name: 'octoprint-printer' });

export const DEFAULT_TIMINGS = {
  // REST polling while the push link is down.
  pollInterval: 10_000,
  // Next attempt after OctoPrint did not answer, or refused the key.
  retryDelay: 30_000,
  // Webcam image pushed to Gladys (the dashboard camera box shows the last one).
  cameraInterval: 60_000,
};

// OctoPrint events turned into Gladys scene events.
const PUSH_EVENTS = {
  PrintStarted: 'started',
  PrintDone: 'done',
  PrintFailed: 'failed',
  PrintPaused: 'paused',
};

const EMPTY_SNAPSHOT = {
  state: 'unreachable',
  error: '',
  temperatures: {},
  file: null,
  progress: null,
  printTime: null,
  printTimeLeft: null,
  estimatedPrintTime: null,
};

/**
 * Events: `update` (snapshot or status changed), `capabilities` (what the
 * printer has, read on each connection), `print` ({ type, file, seconds,
 * reason }).
 */
export class PrinterLink extends EventEmitter {
  /**
   * @param {object} options
   * @param {number} options.slot
   * @param {string} options.url
   * @param {string} options.apiKey
   * @param {typeof fetch} [options.fetch]
   * @param {Function} [options.createSocket]
   * @param {object} [options.timings]
   * @param {object} [options.socketTimings]
   */
  constructor({ slot, url, apiKey, fetch, createSocket, timings = {}, socketTimings = {} }) {
    super();
    this.slot = slot;
    this.url = url;
    this.apiKey = apiKey;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.client = new OctoPrintClient({ baseUrl: url, apiKey, fetch });
    this.push = new PushLink({ client: this.client, createSocket, timings: socketTimings });
    this.push.on('message', (message) => this.#onPush(message));
    this.push.on('open', () => logger.info(`Printer ${slot}: live link open`));
    this.push.on('close', () => {
      if (this.running && this.connected) {
        logger.info(`Printer ${slot}: live link closed, polling the REST API`);
      }
    });
    this.snapshot = { ...EMPTY_SNAPSHOT };
    this.capabilities = null;
    this.version = '';
    this.connected = false;
    this.lastError = '';
    this.running = false;
    this.timers = new Set();
    this.pollTimer = null;
    this.cameraTimer = null;
    this.polling = false;
  }

  /** The key is set: OctoPrint can be reached with it. */
  get configured() {
    return this.apiKey !== '';
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    if (!this.configured) {
      this.#setSnapshot({ ...this.snapshot, state: 'unauthorized' });
      return;
    }
    this.connecting = this.#connect();
  }

  stop() {
    this.running = false;
    this.push.stop();
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    clearInterval(this.pollTimer);
    clearInterval(this.cameraTimer);
    this.pollTimer = null;
    this.cameraTimer = null;
  }

  #later(fn, ms) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    timer.unref?.();
    this.timers.add(timer);
  }

  async #connect() {
    if (!this.running) {
      return;
    }
    try {
      const version = await this.client.getVersion();
      this.version = typeof version?.server === 'string' ? version.server : '';
      const [profiles, settings] = await Promise.all([
        this.client.getProfiles().catch(() => null),
        this.client.getSettings().catch(() => null),
      ]);
      const [printer, job] = await Promise.all([this.client.getPrinter(), this.client.getJob()]);
      if (!this.running) {
        return;
      }
      this.capabilities = readCapabilities(profiles, settings);
      this.connected = true;
      this.lastError = '';
      this.emit('capabilities', this.capabilities);
      this.#setSnapshot(fromRest(printer, job));
      logger.info(`Printer ${this.slot}: connected to OctoPrint ${this.version}`);
    } catch (err) {
      this.#fail(err);
      return;
    }
    this.push.start();
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.#poll(), this.timings.pollInterval);
    this.pollTimer.unref?.();
    clearInterval(this.cameraTimer);
    if (this.capabilities.camera) {
      this.cameraTimer = setInterval(() => this.emit('camera'), this.timings.cameraInterval);
      this.cameraTimer.unref?.();
    }
  }

  #fail(err) {
    const state = err?.kind === 'unauthorized' ? 'unauthorized' : 'unreachable';
    if (this.lastError !== err.message) {
      logger.warn(`Printer ${this.slot}: ${err.message}`);
    }
    this.lastError = err.message;
    this.connected = false;
    this.push.stop();
    clearInterval(this.pollTimer);
    clearInterval(this.cameraTimer);
    this.pollTimer = null;
    this.cameraTimer = null;
    this.#setSnapshot({ ...this.snapshot, state });
    if (this.running) {
      this.#later(() => {
        this.connecting = this.#connect();
      }, this.timings.retryDelay);
    }
  }

  /** Read the REST API now (the fallback path, and Gladys' onPoll). */
  async refresh() {
    if (!this.connected) {
      return;
    }
    const [printer, job] = await Promise.all([this.client.getPrinter(), this.client.getJob()]);
    this.#setSnapshot(fromRest(printer, job), { deriveEvents: !this.push.live });
  }

  async #poll() {
    if (!this.running || this.push.live || this.polling) {
      return;
    }
    this.polling = true;
    try {
      await this.refresh();
    } catch (err) {
      this.#fail(err);
    } finally {
      this.polling = false;
    }
  }

  #onPush(message) {
    const data = message.current ?? message.history;
    if (data) {
      const next = fromPush(data);
      if (next.temperatures === undefined) {
        next.temperatures = this.snapshot.temperatures;
      }
      this.#setSnapshot(next);
      return;
    }
    const type = PUSH_EVENTS[message.event?.type];
    if (type) {
      const payload = message.event.payload ?? {};
      const seconds =
        typeof payload.time === 'number' && Number.isFinite(payload.time)
          ? payload.time
          : this.snapshot.printTime;
      this.emit('print', {
        type,
        file: payload.name ?? this.snapshot.file,
        seconds: seconds ?? null,
        reason: type === 'failed' ? (payload.reason === 'cancelled' ? 'cancelled' : 'error') : null,
      });
    }
  }

  #setSnapshot(next, { deriveEvents = false } = {}) {
    const previous = this.snapshot;
    this.snapshot = next;
    if (deriveEvents) {
      for (const event of deriveEventsFromStates(previous, next)) {
        this.emit('print', event);
      }
    }
    this.emit('update', this.snapshot, previous);
  }

  /**
   * Run a printer command. Throws an Error whose `code` the callers turn into
   * a message: `not_printing`, `not_paused`, `printing`, `unreachable`.
   */
  async command(name, value) {
    if (!this.connected) {
      throw codedError('unreachable', `Printer ${this.slot} is not connected`);
    }
    const state = this.snapshot.state;
    try {
      switch (name) {
        case 'pause':
          if (!['printing', 'resuming'].includes(state)) {
            throw codedError('not_printing', 'No print in progress');
          }
          await this.client.pause();
          break;
        case 'resume':
          if (!['paused', 'pausing'].includes(state)) {
            throw codedError('not_paused', 'The print is not paused');
          }
          await this.client.resume();
          break;
        case 'cancel':
          if (!ACTIVE_STATES.has(state)) {
            throw codedError('not_printing', 'No print in progress');
          }
          await this.client.cancel();
          break;
        case 'targets':
          await this.#setTargets(value);
          break;
        default:
          throw new Error(`Unknown command ${name}`);
      }
    } catch (err) {
      if (err.kind === 'conflict') {
        // OctoPrint knows better than our last snapshot.
        throw codedError(name === 'resume' ? 'not_paused' : 'not_printing', err.message);
      }
      if (err.kind === 'unreachable' || err.kind === 'unauthorized') {
        throw codedError('unreachable', err.message);
      }
      throw err;
    }
    // Let the next push message, or a REST read, show the result.
    if (!this.push.live) {
      this.refresh().catch(() => {});
    }
  }

  /** @param {Record<string, number>} targets heater -> °C, e.g. { tool0: 210, bed: 60 } */
  async #setTargets(targets) {
    const tools = {};
    for (const [heater, value] of Object.entries(targets)) {
      if (heater.startsWith('tool')) {
        tools[heater] = value;
      }
    }
    if (Object.keys(tools).length > 0) {
      await this.client.setToolTargets(tools);
    }
    if (targets.bed !== undefined) {
      await this.client.setBedTarget(targets.bed);
    }
    if (targets.chamber !== undefined) {
      await this.client.setChamberTarget(targets.chamber);
    }
  }

  /** The webcam image as Gladys wants it, or throws. */
  async cameraImage(maxBytes) {
    const { type, data } = await this.client.snapshot();
    const isJpeg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    if (!isJpeg) {
      throw codedError('camera_format', `The webcam image is not a JPEG (${type || 'unknown'})`);
    }
    const encoded = `image/jpg;base64,${data.toString('base64')}`;
    if (encoded.length > maxBytes) {
      throw codedError(
        'camera_size',
        `The webcam image is too large (${Math.round(data.length / 1024)} KB): lower its resolution`,
      );
    }
    return encoded;
  }
}

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Print events from two consecutive REST snapshots, when the push link (and
 * its exact events) is unavailable. After a cancellation OctoPrint clears the
 * job progress; after a finished print it keeps 100 %.
 */
export function deriveEventsFromStates(previous, next) {
  const events = [];
  const wasActive = ACTIVE_STATES.has(previous.state);
  const isActive = ACTIVE_STATES.has(next.state);
  const file = next.file ?? previous.file;
  if (!wasActive && isActive && previous.state !== 'unreachable') {
    events.push({ type: 'started', file, seconds: null, reason: null });
  }
  if (next.state === 'paused' && !['paused', 'pausing'].includes(previous.state) && wasActive) {
    events.push({
      type: 'paused',
      file,
      seconds: next.printTime ?? previous.printTime,
      reason: null,
    });
  }
  if (next.state === 'pausing' && wasActive && previous.state !== 'pausing') {
    events.push({
      type: 'paused',
      file,
      seconds: next.printTime ?? previous.printTime,
      reason: null,
    });
  }
  // A whole print between two reads (shorter than the poll interval): idle on
  // both sides, but a new finished job in /api/job.
  const idle = (state) => ['operational', 'offline'].includes(state);
  if (
    idle(previous.state) &&
    idle(next.state) &&
    next.progress === 100 &&
    next.printTime !== null &&
    (previous.progress !== 100 ||
      previous.printTime !== next.printTime ||
      previous.file !== next.file)
  ) {
    events.push({ type: 'done', file, seconds: next.printTime, reason: null });
  }
  if (wasActive && !isActive && !['unreachable', 'unauthorized'].includes(next.state)) {
    const seconds = next.printTime ?? previous.printTime;
    if (next.state === 'error' || next.state === 'offline') {
      events.push({ type: 'failed', file, seconds, reason: 'error' });
    } else if (previous.state === 'finishing' || (next.progress ?? 0) >= 100) {
      events.push({ type: 'done', file, seconds, reason: null });
    } else {
      events.push({ type: 'failed', file, seconds, reason: 'cancelled' });
    }
  }
  return events;
}
