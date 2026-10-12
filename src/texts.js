// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js).
// A device integration never receives the user's language: the `language`
// field of the configuration picks one (default: French).
// -----------------------------------------------------------------------------

/** Feature names, frozen when the device is added to Gladys. */
export const NAMES = {
  en: {
    state: 'State',
    file: 'File',
    progress: 'Progress',
    elapsed: 'Elapsed time',
    left: 'Time left',
    tool: 'Nozzle',
    bed: 'Bed',
    chamber: 'Chamber',
    target: 'target',
    pause: 'Pause',
    resume: 'Resume',
    camera: 'Webcam',
  },
  fr: {
    state: 'État',
    file: 'Fichier',
    progress: 'Progression',
    elapsed: 'Temps écoulé',
    left: 'Temps restant',
    tool: 'Buse',
    bed: 'Plateau',
    chamber: 'Caisson',
    target: 'consigne',
    pause: 'Pause',
    resume: 'Reprise',
    camera: 'Webcam',
  },
  de: {
    state: 'Status',
    file: 'Datei',
    progress: 'Fortschritt',
    elapsed: 'Verstrichene Zeit',
    left: 'Restzeit',
    tool: 'Düse',
    bed: 'Druckbett',
    chamber: 'Bauraum',
    target: 'Soll',
    pause: 'Pausieren',
    resume: 'Fortsetzen',
    camera: 'Webcam',
  },
  es: {
    state: 'Estado',
    file: 'Archivo',
    progress: 'Progreso',
    elapsed: 'Tiempo transcurrido',
    left: 'Tiempo restante',
    tool: 'Boquilla',
    bed: 'Cama',
    chamber: 'Recinto',
    target: 'consigna',
    pause: 'Pausar',
    resume: 'Reanudar',
    camera: 'Webcam',
  },
};

/** The `state` feature (text), one label per state of src/octoprint/model.js. */
export const STATE_LABELS = {
  en: {
    unreachable: 'OctoPrint unreachable',
    unauthorized: 'API key missing or refused',
    offline: 'Printer disconnected',
    connecting: 'Connecting',
    operational: 'Operational',
    printing: 'Printing',
    pausing: 'Pausing',
    paused: 'Paused',
    resuming: 'Resuming',
    cancelling: 'Cancelling',
    finishing: 'Finishing',
    error: 'Error',
  },
  fr: {
    unreachable: 'OctoPrint injoignable',
    unauthorized: "Clé d'API absente ou refusée",
    offline: 'Imprimante déconnectée',
    connecting: 'Connexion',
    operational: 'Opérationnelle',
    printing: 'Impression',
    pausing: 'Mise en pause',
    paused: 'En pause',
    resuming: 'Reprise',
    cancelling: 'Annulation',
    finishing: 'Finalisation',
    error: 'Erreur',
  },
  de: {
    unreachable: 'OctoPrint nicht erreichbar',
    unauthorized: 'API-Schlüssel fehlt oder abgelehnt',
    offline: 'Drucker getrennt',
    connecting: 'Verbinde',
    operational: 'Betriebsbereit',
    printing: 'Druckt',
    pausing: 'Wird pausiert',
    paused: 'Pausiert',
    resuming: 'Wird fortgesetzt',
    cancelling: 'Wird abgebrochen',
    finishing: 'Wird abgeschlossen',
    error: 'Fehler',
  },
  es: {
    unreachable: 'OctoPrint inaccesible',
    unauthorized: 'Clave de API ausente o rechazada',
    offline: 'Impresora desconectada',
    connecting: 'Conectando',
    operational: 'Operativa',
    printing: 'Imprimiendo',
    pausing: 'Pausando',
    paused: 'En pausa',
    resuming: 'Reanudando',
    cancelling: 'Cancelando',
    finishing: 'Finalizando',
    error: 'Error',
  },
};

/** The `file` feature when no job is selected (a text state is never empty). */
export const NO_FILE = {
  en: 'No file',
  fr: 'Aucun fichier',
  de: 'Keine Datei',
  es: 'Ningún archivo',
};

const pad = (minutes) => String(minutes).padStart(2, '0');

/** Durations: "1 h 05 min" and its translations. */
export const DURATION = {
  en: { hours: (h, m) => `${h} h ${pad(m)} min`, minutes: (m) => `${m} min` },
  fr: { hours: (h, m) => `${h} h ${pad(m)} min`, minutes: (m) => `${m} min` },
  de: { hours: (h, m) => `${h} Std. ${pad(m)} Min.`, minutes: (m) => `${m} Min.` },
  es: { hours: (h, m) => `${h} h ${pad(m)} min`, minutes: (m) => `${m} min` },
};

export function formatDuration(seconds, language) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const table = DURATION[language] ?? DURATION.en;
  const total = Math.round(seconds / 60);
  if (total < 60) {
    return table.minutes(total);
  }
  return table.hours(Math.floor(total / 60), total % 60);
}

/** Why a command was refused; thrown to Gladys or shown as a widget toast. */
export const COMMAND_ERRORS = {
  en: {
    offline: 'The printer is not connected to OctoPrint.',
    not_printing: 'No print in progress.',
    not_paused: 'The print is not paused.',
    printing: 'A print is in progress: temperatures left unchanged.',
    unreachable: 'OctoPrint does not answer.',
    unknown_device: 'This printer is not configured in the integration anymore.',
    out_of_range: (max) => `Temperature out of range (0 to ${max} °C).`,
    camera_format: 'The webcam image is not a JPEG.',
    camera_size: 'The webcam image is larger than 150 KB: lower its resolution in OctoPrint.',
    no_camera: 'No webcam with snapshots in OctoPrint.',
  },
  fr: {
    offline: "L'imprimante n'est pas connectée à OctoPrint.",
    not_printing: 'Aucune impression en cours.',
    not_paused: "L'impression n'est pas en pause.",
    printing: 'Une impression est en cours : températures inchangées.',
    unreachable: 'OctoPrint ne répond pas.',
    unknown_device: "Cette imprimante n'est plus configurée dans l'intégration.",
    out_of_range: (max) => `Température hors limites (0 à ${max} °C).`,
    camera_format: "L'image de la webcam n'est pas un JPEG.",
    camera_size: "L'image de la webcam dépasse 150 Ko : baissez sa résolution dans OctoPrint.",
    no_camera: 'Aucune webcam avec capture dans OctoPrint.',
  },
  de: {
    offline: 'Der Drucker ist nicht mit OctoPrint verbunden.',
    not_printing: 'Kein Druck aktiv.',
    not_paused: 'Der Druck ist nicht pausiert.',
    printing: 'Ein Druck läuft: Temperaturen unverändert.',
    unreachable: 'OctoPrint antwortet nicht.',
    unknown_device: 'Dieser Drucker ist in der Integration nicht mehr eingerichtet.',
    out_of_range: (max) => `Temperatur außerhalb des Bereichs (0 bis ${max} °C).`,
    camera_format: 'Das Webcam-Bild ist kein JPEG.',
    camera_size: 'Das Webcam-Bild ist größer als 150 KB: Verringere seine Auflösung in OctoPrint.',
    no_camera: 'Keine Webcam mit Schnappschuss in OctoPrint.',
  },
  es: {
    offline: 'La impresora no está conectada a OctoPrint.',
    not_printing: 'No hay ninguna impresión en curso.',
    not_paused: 'La impresión no está en pausa.',
    printing: 'Hay una impresión en curso: temperaturas sin cambios.',
    unreachable: 'OctoPrint no responde.',
    unknown_device: 'Esta impresora ya no está configurada en la integración.',
    out_of_range: (max) => `Temperatura fuera de rango (0 a ${max} °C).`,
    camera_format: 'La imagen de la webcam no es un JPEG.',
    camera_size: 'La imagen de la webcam supera los 150 KB: reduzca su resolución en OctoPrint.',
    no_camera: 'No hay ninguna webcam con captura en OctoPrint.',
  },
};

/** One multi-language object for a coded command error. */
export function commandMessage(code, ...args) {
  return Object.fromEntries(
    Object.entries(COMMAND_ERRORS).map(([language, table]) => {
      const text = table[code] ?? table.unreachable;
      return [language, typeof text === 'function' ? text(...args) : text];
    }),
  );
}

/** The connection status of the Configuration screen. */
export const STATUS_TEXT = {
  en: {
    none: 'Enter the address of your OctoPrint, save, then click Connect.',
    invalid: (n) => `Printer ${n}: invalid address.`,
    noKey: (n) => `Printer ${n}: click Connect, or paste an API key.`,
    unauthorized: (n) => `Printer ${n}: API key refused.`,
    unreachable: (n) => `Printer ${n}: OctoPrint does not answer.`,
    waiting: (n) => `Printer ${n}: approve the access request in OctoPrint.`,
    denied: (n) => `Printer ${n}: access request denied or expired.`,
    linkFailed: (n) => `Printer ${n}: the access request failed, see the logs.`,
  },
  fr: {
    none: "Saisissez l'adresse de votre OctoPrint, enregistrez, puis cliquez sur Connecter.",
    invalid: (n) => `Imprimante ${n} : adresse invalide.`,
    noKey: (n) => `Imprimante ${n} : cliquez sur Connecter, ou collez une clé d'API.`,
    unauthorized: (n) => `Imprimante ${n} : clé d'API refusée.`,
    unreachable: (n) => `Imprimante ${n} : OctoPrint ne répond pas.`,
    waiting: (n) => `Imprimante ${n} : acceptez la demande d'accès dans OctoPrint.`,
    denied: (n) => `Imprimante ${n} : demande d'accès refusée ou expirée.`,
    linkFailed: (n) => `Imprimante ${n} : la demande d'accès a échoué, voir les logs.`,
  },
  de: {
    none: 'Gib die Adresse deines OctoPrint ein, speichere und klicke dann auf Verbinden.',
    invalid: (n) => `Drucker ${n}: ungültige Adresse.`,
    noKey: (n) => `Drucker ${n}: Klicke auf Verbinden oder füge einen API-Schlüssel ein.`,
    unauthorized: (n) => `Drucker ${n}: API-Schlüssel abgelehnt.`,
    unreachable: (n) => `Drucker ${n}: OctoPrint antwortet nicht.`,
    waiting: (n) => `Drucker ${n}: Bestätige die Zugriffsanfrage in OctoPrint.`,
    denied: (n) => `Drucker ${n}: Zugriffsanfrage abgelehnt oder abgelaufen.`,
    linkFailed: (n) => `Drucker ${n}: Die Zugriffsanfrage ist fehlgeschlagen, siehe Protokolle.`,
  },
  es: {
    none: 'Introduzca la dirección de su OctoPrint, guarde y haga clic en Conectar.',
    invalid: (n) => `Impresora ${n}: dirección no válida.`,
    noKey: (n) => `Impresora ${n}: haga clic en Conectar o pegue una clave de API.`,
    unauthorized: (n) => `Impresora ${n}: clave de API rechazada.`,
    unreachable: (n) => `Impresora ${n}: OctoPrint no responde.`,
    waiting: (n) => `Impresora ${n}: acepte la solicitud de acceso en OctoPrint.`,
    denied: (n) => `Impresora ${n}: solicitud de acceso rechazada o caducada.`,
    linkFailed: (n) => `Impresora ${n}: la solicitud de acceso ha fallado, consulte los registros.`,
  },
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

/** The report of the "Test the connection" action. */
export const TEST_TEXT = {
  en: {
    none: 'No OctoPrint configured.',
    ok: (n, version, state) => `Printer ${n}: OctoPrint ${version}, ${state}.`,
    failed: (n, state) => `Printer ${n}: ${state}.`,
  },
  fr: {
    none: 'Aucun OctoPrint configuré.',
    ok: (n, version, state) => `Imprimante ${n} : OctoPrint ${version}, ${state}.`,
    failed: (n, state) => `Imprimante ${n} : ${state}.`,
  },
  de: {
    none: 'Kein OctoPrint eingerichtet.',
    ok: (n, version, state) => `Drucker ${n}: OctoPrint ${version}, ${state}.`,
    failed: (n, state) => `Drucker ${n}: ${state}.`,
  },
  es: {
    none: 'No hay ningún OctoPrint configurado.',
    ok: (n, version, state) => `Impresora ${n}: OctoPrint ${version}, ${state}.`,
    failed: (n, state) => `Impresora ${n}: ${state}.`,
  },
};

/** Toasts of the widget buttons (the widget action receives no language). */
export const DONE_TEXT = {
  pause: {
    en: 'Pause requested.',
    fr: 'Pause demandée.',
    de: 'Pause angefordert.',
    es: 'Pausa solicitada.',
  },
  resume: {
    en: 'Resume requested.',
    fr: 'Reprise demandée.',
    de: 'Fortsetzen angefordert.',
    es: 'Reanudación solicitada.',
  },
  cancel: {
    en: 'Cancellation requested.',
    fr: 'Annulation demandée.',
    de: 'Abbruch angefordert.',
    es: 'Cancelación solicitada.',
  },
  preheat: {
    en: 'Preheating.',
    fr: 'Préchauffage lancé.',
    de: 'Vorheizen gestartet.',
    es: 'Precalentamiento iniciado.',
  },
  cool_down: {
    en: 'Heaters off.',
    fr: 'Chauffes coupées.',
    de: 'Heizungen aus.',
    es: 'Calentadores apagados.',
  },
};
