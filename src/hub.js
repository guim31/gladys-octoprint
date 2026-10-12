// -----------------------------------------------------------------------------
// The hub: one PrinterLink per configured OctoPrint, and everything Gladys
// sees of them — devices, states, connection status, scene events, commands,
// the "Connect" (Application Keys) flow.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { apiKeyKey, linkKey, SLOTS } from './config.js';
import {
  buildDevice,
  buildStates,
  deviceIds,
  featureKeyOf,
  heaterLimit,
  heatersOf,
  slotOf,
} from './devices.js';
import { requestAppKey, waitForAppKey } from './octoprint/appkeys.js';
import { ACTIVE_STATES, sameStructure } from './octoprint/model.js';
import { PrinterLink } from './printer.js';
import { STATE_LABELS, STATUS_TEXT, TEST_TEXT, commandMessage, formatDuration } from './texts.js';

const logger = createLogger({ name: 'octoprint-hub' });

export const WIDGET_KEY = 'printer';

// Scene trigger keys (manifest `scene_triggers`), by print event type.
export const TRIGGERS = {
  started: 'print_started',
  done: 'print_done',
  failed: 'print_failed',
  paused: 'print_paused',
};

// The core refuses camera images over 150 KB (the data URI included).
export const MAX_IMAGE_BYTES = 150 * 1024;

// requestWidgetRefresh is dropped by the core beyond one call per 10 s.
const WIDGET_REFRESH_GAP_MS = 10_500;

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language, ...args) {
    const message = commandMessage(code, ...args);
    super(message[language] ?? message.en);
    this.code = code;
    this.messages = message;
  }
}

export class Hub {
  constructor({
    gladys,
    store,
    fetch,
    createSocket,
    timings,
    socketTimings,
    appKeyTimings,
    now = Date.now,
  }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.createSocket = createSocket;
    this.timings = timings;
    this.socketTimings = socketTimings;
    this.appKeyTimings = appKeyTimings ?? {};
    this.now = now;
    this.config = { printers: [], invalidSlots: [], language: 'fr' };
    // slot -> { slot, url, apiKey, link, capabilities }
    this.printers = new Map();
    // slot -> capabilities known from a previous run (store)
    this.known = {};
    // slot -> 'waiting' | 'denied' | 'failed' (the Connect flow)
    this.linking = new Map();
    this.linkAborts = new Map();
    this.lastStatus = '';
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.stopped = false;
  }

  get language() {
    return this.config.language;
  }

  async start(config) {
    const saved = await this.store.load();
    this.known = saved && typeof saved.printers === 'object' ? saved.printers : {};
    await this.reconfigure(config);
  }

  /** New configuration: restart the printers whose address or key changed. */
  async reconfigure(config) {
    const languageChanged = config.language !== this.config.language;
    this.config = config;
    const wanted = new Map(config.printers.map((p) => [p.slot, p]));
    for (const [slot, printer] of this.printers) {
      const next = wanted.get(slot);
      if (!next || next.url !== printer.url || next.apiKey !== printer.apiKey) {
        printer.link.stop();
        this.printers.delete(slot);
        if (this.linking.get(slot) !== 'waiting') {
          this.linking.delete(slot);
        }
      }
    }
    for (const [slot, settings] of wanted) {
      if (!this.printers.has(slot)) {
        this.#addPrinter(settings);
      }
    }
    await this.publishDevices();
    if (languageChanged) {
      await this.publishAllStates();
    }
    await this.updateConnectionStatus();
    this.refreshWidget();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    await this.reconfigure(config);
    await this.publishAllStates();
    this.lastStatus = '';
    await this.updateConnectionStatus();
  }

  stop() {
    this.stopped = true;
    for (const printer of this.printers.values()) {
      printer.link.stop();
    }
    for (const abort of this.linkAborts.values()) {
      abort.abort();
    }
    clearTimeout(this.widgetTimer);
    return this.store.flush();
  }

  #addPrinter(settings) {
    const { slot, url, apiKey } = settings;
    const link = new PrinterLink({
      slot,
      url,
      apiKey,
      fetch: this.fetch,
      createSocket: this.createSocket,
      timings: this.timings,
      socketTimings: this.socketTimings,
    });
    const known = this.known[slot];
    const printer = {
      slot,
      url,
      apiKey,
      link,
      capabilities: known?.capabilities ?? null,
    };
    this.printers.set(slot, printer);
    link.on('capabilities', (capabilities) => this.#onCapabilities(printer, capabilities));
    link.on('update', (snapshot, previous) => this.#onUpdate(printer, snapshot, previous));
    link.on('print', (event) => this.#onPrint(printer, event));
    link.on('camera', () => this.#pushCamera(printer));
    link.start();
  }

  // --- Devices and states -------------------------------------------------

  /** Every printer whose structure is known, as Gladys devices. */
  buildDevices() {
    return [...this.printers.values()]
      .filter((printer) => printer.capabilities)
      .sort((a, b) => a.slot - b.slot)
      .map((printer) => buildDevice(this.gladys, printer, this.language));
  }

  async publishDevices() {
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      logger.error('Cannot publish the devices', err);
    }
  }

  async #onCapabilities(printer, capabilities) {
    const changed = !sameStructure(printer.capabilities, capabilities);
    const renamed = printer.capabilities?.name !== capabilities.name;
    printer.capabilities = capabilities;
    this.known[printer.slot] = { capabilities };
    if (changed || renamed) {
      this.store.save({ printers: this.known });
      await this.publishDevices();
    }
  }

  async #onUpdate(printer, snapshot, previous) {
    if (printer.capabilities) {
      await this.#publishStates(printer);
    }
    if (snapshot.state !== previous.state || snapshot.file !== previous.file) {
      this.refreshWidget();
    }
    if (snapshot.state !== previous.state || printer.link.lastError !== printer.lastError) {
      // Deduplicated: only a change of the status reaches Gladys.
      printer.lastError = printer.link.lastError;
      await this.updateConnectionStatus();
    }
  }

  async #publishStates(printer) {
    if (!printer.capabilities || this.stopped) {
      return;
    }
    const states = buildStates(this.gladys, printer, printer.link.snapshot, this.language);
    try {
      await this.gladys.publishChangedStates(states);
    } catch (err) {
      logger.warn(`Cannot publish the states of printer ${printer.slot}: ${err.message}`);
    }
  }

  async publishAllStates() {
    for (const printer of this.printers.values()) {
      await this.#publishStates(printer);
    }
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const slot = slotOf(this.gladys, device?.external_id);
    const printer = this.printers.get(slot);
    if (!printer) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    await this.#publishStates(printer);
    if (printer.capabilities?.camera) {
      this.#pushCamera(printer);
    }
    this.refreshWidget();
  }

  // --- Scene events ---------------------------------------------------------

  async #onPrint(printer, event) {
    const key = TRIGGERS[event.type];
    if (!key || !printer.capabilities) {
      return;
    }
    const data = {
      device: deviceIds(this.gladys, printer.slot).device,
      printer: this.#deviceName(printer),
      file: event.file ?? '',
      duration: formatDuration(event.seconds, this.language),
      duration_minutes: typeof event.seconds === 'number' ? Math.round(event.seconds / 60) : null,
    };
    if (event.type === 'failed') {
      data.reason = event.reason ?? 'error';
    }
    logger.info(`Printer ${printer.slot}: print ${event.type} (${data.file})`);
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Cannot fire ${key}: ${err.message}`);
    }
    this.refreshWidget();
  }

  #deviceName(printer) {
    const created = (this.gladys.devices ?? []).find(
      (device) => device.external_id === deviceIds(this.gladys, printer.slot).device,
    );
    return created?.name ?? buildDevice(this.gladys, printer, this.language).name;
  }

  // --- Widget ---------------------------------------------------------------

  /** Nudge the open dashboards, with a trailing call inside the core's 10 s gap. */
  refreshWidget() {
    if (this.stopped) {
      return;
    }
    const wait = this.widgetRefreshAt + WIDGET_REFRESH_GAP_MS - this.now();
    if (wait <= 0) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  // --- Connection status ----------------------------------------------------

  statusMessage() {
    const lines = Object.fromEntries(Object.keys(STATUS_TEXT).map((language) => [language, []]));
    const add = (key, slot) => {
      for (const [language, table] of Object.entries(STATUS_TEXT)) {
        lines[language].push(table[key](slot));
      }
    };
    for (const slot of this.config.invalidSlots) {
      add('invalid', slot);
    }
    for (const slot of SLOTS) {
      const printer = this.printers.get(slot);
      const linking = this.linking.get(slot);
      if (linking) {
        add(linking, slot);
        continue;
      }
      if (!printer) {
        continue;
      }
      if (!printer.link.configured) {
        add('noKey', slot);
      } else if (printer.link.snapshot.state === 'unauthorized') {
        add('unauthorized', slot);
      } else if (printer.link.snapshot.state === 'unreachable' && printer.link.lastError) {
        // Only once an attempt failed (a fresh start says nothing yet).
        add('unreachable', slot);
      }
    }
    if (this.printers.size === 0 && this.config.invalidSlots.length === 0) {
      for (const [language, table] of Object.entries(STATUS_TEXT)) {
        lines[language].push(table.none);
      }
    }
    if (lines.en.length === 0) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(lines).map(([language, list]) => [language, list.join(' ').slice(0, 500)]),
    );
  }

  async updateConnectionStatus() {
    if (this.stopped) {
      return;
    }
    const message = this.statusMessage();
    const links = [...this.printers.values()].map((p) => p.link);
    const connected = message === null && links.some((link) => link.connected);
    // A printer still on its first attempt: nothing to say yet.
    if (!connected && message === null && links.some((l) => !l.connected && !l.lastError)) {
      return;
    }
    const fingerprint = JSON.stringify({ connected, message });
    if (fingerprint === this.lastStatus) {
      return;
    }
    this.lastStatus = fingerprint;
    try {
      await this.gladys.setConnectionStatus(connected, message ?? undefined);
    } catch (err) {
      logger.warn(`Cannot set the connection status: ${err.message}`);
    }
  }

  // --- Commands -----------------------------------------------------------

  #printerOf(externalId) {
    const printer = this.printers.get(slotOf(this.gladys, externalId));
    if (!printer) {
      throw new CommandError('unknown_device', this.language);
    }
    return printer;
  }

  /**
   * Run a command on the printer of a device external id. Throws a
   * CommandError (coded, multi-language) when the printer refuses it.
   */
  async command(externalId, name, value) {
    const printer = this.#printerOf(externalId);
    try {
      await printer.link.command(name, value);
    } catch (err) {
      if (err.code) {
        throw new CommandError(err.code, this.language);
      }
      throw err;
    }
    return printer;
  }

  /** Heaters of a printer to the given °C (preheat), or 0 (cool down). */
  async setHeaters(externalId, { tool, bed, chamber }, { refuseWhilePrinting = false } = {}) {
    const printer = this.#printerOf(externalId);
    if (refuseWhilePrinting && ACTIVE_STATES.has(printer.link.snapshot.state)) {
      throw new CommandError('printing', this.language);
    }
    const capabilities = printer.capabilities ?? { tools: ['tool0'], bed: true, chamber: false };
    const targets = {};
    for (const heater of heatersOf(capabilities)) {
      const value = heater.startsWith('tool') ? tool : heater === 'bed' ? bed : chamber;
      if (value === undefined || value === null) {
        continue;
      }
      targets[heater] = checkTemperature(heater, value, this.language);
    }
    if (Object.keys(targets).length === 0) {
      return printer;
    }
    return this.command(externalId, 'targets', targets);
  }

  /** onSetValue: a setpoint or a button of the device box. */
  async setValue(device, feature, value) {
    const key = featureKeyOf(feature?.external_id);
    if (key === 'pause' || key === 'resume') {
      await this.command(device.external_id, key);
      return;
    }
    const match = key.match(/^(tool\d+|bed|chamber)_target$/);
    if (!match) {
      throw new Error(`Feature ${key} cannot be controlled`);
    }
    const target = checkTemperature(match[1], Number(value), this.language);
    await this.command(device.external_id, 'targets', { [match[1]]: target });
  }

  /** onPoll (the devices are not polled; this only serves a Gladys that would). */
  async poll(device) {
    const printer = this.printers.get(slotOf(this.gladys, device?.external_id));
    await printer?.link.refresh();
  }

  /** onGetImage: a fresh webcam image. */
  async getImage(device) {
    const printer = this.#printerOf(device?.external_id);
    if (!printer.capabilities?.camera) {
      throw new CommandError('no_camera', this.language);
    }
    try {
      return await printer.link.cameraImage(MAX_IMAGE_BYTES);
    } catch (err) {
      if (err.code === 'camera_format' || err.code === 'camera_size') {
        throw new CommandError(err.code, this.language);
      }
      throw new CommandError('unreachable', this.language);
    }
  }

  async #pushCamera(printer) {
    const ids = deviceIds(this.gladys, printer.slot);
    const created = (this.gladys.devices ?? []).some((d) => d.external_id === ids.device);
    if (!created || !printer.link.connected || !printer.capabilities?.camera) {
      return;
    }
    try {
      const image = await printer.link.cameraImage(MAX_IMAGE_BYTES);
      await this.gladys.publishCameraImage(ids.feature('camera'), image);
    } catch (err) {
      if (printer.cameraError !== err.message) {
        logger.warn(`Printer ${printer.slot}: no webcam image (${err.message})`);
      }
      printer.cameraError = err.message;
      return;
    }
    printer.cameraError = null;
  }

  // --- "Connect": the Application Keys flow ---------------------------------

  /**
   * The user clicked Connect on `link_<slot>`: open an access request in
   * OctoPrint and return its approval page. The decision is awaited in the
   * background; the key is then saved in `api_key_<slot>`.
   */
  async startLink(key) {
    const slot = SLOTS.find((s) => linkKey(s) === key);
    const printer = slot ? this.config.printers.find((p) => p.slot === slot) : null;
    if (!printer) {
      throw new Error(
        `Printer ${slot ?? '?'}: enter and save the address of OctoPrint before connecting.`,
      );
    }
    this.linkAborts.get(slot)?.abort();
    const { appToken, approvalUrl } = await requestAppKey({
      baseUrl: printer.url,
      fetch: this.fetch,
    });
    const abort = new AbortController();
    this.linkAborts.set(slot, abort);
    this.linking.set(slot, 'waiting');
    await this.updateConnectionStatus();
    this.linkDone = this.#awaitDecision(slot, printer.url, appToken, abort.signal);
    return approvalUrl;
  }

  async #awaitDecision(slot, url, appToken, signal) {
    let apiKey = null;
    try {
      apiKey = await waitForAppKey({
        baseUrl: url,
        appToken,
        fetch: this.fetch,
        signal,
        ...this.appKeyTimings,
      });
    } catch (err) {
      logger.warn(`Printer ${slot}: access request failed (${err.message})`);
      this.linking.set(slot, 'failed');
      await this.updateConnectionStatus();
      return;
    }
    if (signal.aborted || this.stopped) {
      return;
    }
    this.linkAborts.delete(slot);
    if (!apiKey) {
      this.linking.set(slot, 'denied');
      await this.updateConnectionStatus();
      return;
    }
    try {
      // Validated by Gladys against the `secret` field; no config-updated echo.
      await this.gladys.setConfig({ [apiKeyKey(slot)]: apiKey });
    } catch (err) {
      logger.error(`Printer ${slot}: cannot save the API key`, err);
      this.linking.set(slot, 'failed');
      await this.updateConnectionStatus();
      return;
    }
    logger.info(`Printer ${slot}: access granted in OctoPrint, API key saved`);
    this.linking.delete(slot);
    const printers = this.config.printers.map((p) => (p.slot === slot ? { ...p, apiKey } : p));
    await this.reconfigure({ ...this.config, printers });
  }

  // --- "Test the connection" ---------------------------------------------------

  async testReport() {
    const lines = Object.fromEntries(Object.keys(TEST_TEXT).map((language) => [language, []]));
    if (this.printers.size === 0) {
      return Object.fromEntries(Object.entries(TEST_TEXT).map(([lang, t]) => [lang, t.none]));
    }
    for (const printer of [...this.printers.values()].sort((a, b) => a.slot - b.slot)) {
      if (printer.link.connected) {
        await printer.link.refresh().catch(() => {});
      }
      const { state } = printer.link.snapshot;
      for (const [language, table] of Object.entries(TEST_TEXT)) {
        const label = STATE_LABELS[language][state];
        lines[language].push(
          printer.link.connected
            ? table.ok(printer.slot, printer.link.version || '?', label)
            : table.failed(printer.slot, label),
        );
      }
    }
    return Object.fromEntries(
      Object.entries(lines).map(([language, list]) => [language, list.join(' ')]),
    );
  }
}

function checkTemperature(heater, value, language) {
  const max = heaterLimit(heater);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new CommandError('out_of_range', language, max);
  }
  return Math.round(value);
}
