// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three OctoPrint instances, one "slot" each (`url_1`, `api_key_1`,
// `link_1`...). The slot number is the identity of the Gladys device: changing
// the address of an instance (new IP) keeps its device and its history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

export const DEFAULT_CONFIG = {
  url_1: '',
  api_key_1: '',
  url_2: '',
  api_key_2: '',
  url_3: '',
  api_key_3: '',
  language: 'fr',
};

export const urlKey = (slot) => `url_${slot}`;
export const apiKeyKey = (slot) => `api_key_${slot}`;
export const linkKey = (slot) => `link_${slot}`;

/**
 * Turn what the user typed into the base URL of the OctoPrint instance:
 * `192.0.2.10`, `192.0.2.10:5000`, `octopi.home` or a full URL with a path
 * (OctoPrint behind a reverse proxy). Returns null when it is not usable.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    return null;
  }
  if (url.username || url.password) {
    // Credentials in the URL would end up in logs and error messages.
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const printers = [];
  const invalid = [];
  for (const slot of SLOTS) {
    const text = typeof source[urlKey(slot)] === 'string' ? source[urlKey(slot)].trim() : '';
    if (text === '') {
      continue;
    }
    const url = normalizeUrl(text);
    if (!url) {
      invalid.push(slot);
      continue;
    }
    const key = source[apiKeyKey(slot)];
    printers.push({ slot, url, apiKey: typeof key === 'string' ? key.trim() : '' });
  }
  return {
    printers,
    invalidSlots: invalid,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
