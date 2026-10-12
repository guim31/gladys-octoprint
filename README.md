# OctoPrint for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows and controls 3D printers driven by [OctoPrint](https://octoprint.org),
over the local network, through the OctoPrint REST API and its push socket. No
cloud, no account.

> **Tested against a real OctoPrint, not yet on a physical printer: feedback
> welcome.** Everything was exercised on OctoPrint 1.11.8 (Docker image
> `octoprint/octoprint`) with its built-in virtual printer: real prints, pause,
> resume, cancellation, end of print, temperatures, the Application Keys flow
> and the webcam snapshot. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-octoprint/issues).

## Features

- **One device per OctoPrint instance** (up to three): state, file, progress,
  elapsed and remaining time, nozzle / bed / chamber temperatures and their
  setpoints (adjustable from the dashboard), pause and resume buttons, and the
  webcam image through OctoPrint. Real time through OctoPrint's push socket,
  with a REST polling fallback.
- **Connect button**: the OctoPrint Application Keys workflow, through a Gladys
  `account_link` field. The user approves the request in OctoPrint, the key is
  saved by itself. Pasting a key by hand works too.
- **Dashboard widget "3D print"**: progress gauge, time left, temperatures,
  state, file, end time, setpoints, and the buttons that fit the moment (pause
  or resume, cancel with a confirmation, preheat, cool down).
- **Scene triggers**: print started, print finished, print failed or cancelled
  (filter by reason), print paused — with the file and the print time as
  variables.
- **Scene actions**: pause / resume / cancel a print, preheat (refused during a
  print), turn the heaters off.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- OctoPrint 1.5 or later reachable from Gladys (1.10+ for the approval page of
  the Connect button, 1.9+ for the webcam image).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-octoprint` (or find **OctoPrint** in the
   catalog).
2. In **Configuration**, enter the address of OctoPrint (an IP address), save,
   click **Connect with OctoPrint** and allow Gladys Assistant in OctoPrint.
3. Add the printer from the **Discover** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- On connection, the integration reads `/api/version` (checks the key),
  `/api/printerprofiles` (nozzles, heated bed and chamber), `/api/settings`
  (instance name, webcam) and the current `/api/printer` and `/api/job`.
- It then opens the push socket (`/sockjs/websocket`, authenticated by a passive
  login) with a throttle of 5 s. States come from its `current` messages, scene
  events from OctoPrint's own events (`PrintStarted`, `PrintDone`,
  `PrintFailed` with its reason, `PrintPaused`).
- Without the socket (a reverse proxy without WebSocket), the REST API is read
  every 10 s and the events are derived from the state changes.
- Only changed states are published (whole degrees, whole minutes), and
  everything is published again when a device is added. The devices are not
  polled by Gladys.
- What each printer has is kept in `/data/octoprint-state.json`, so a Gladys
  restart while OctoPrint is off still publishes the same device.

## Limitations

- Up to three OctoPrint instances.
- No file upload, print start, G-code or time-lapse from Gladys.
- The webcam image is a JPEG snapshot of 150 KB at most (a Gladys limit),
  refreshed every minute and on demand — not a video stream.
- No cancel button on the device itself (one tap would ruin a print): the
  widget (with a confirmation) and the scenes offer it.
- `octopi.local` names do not resolve in the integration container: use an IP
  address.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + simulated OctoPrint instances
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
```

```
index.js                  SDK wiring (src/app.js registers the handlers)
src/hub.js                printers, states, connection status, scene events, Connect flow
src/printer.js            one OctoPrint instance: push link, REST fallback, events, commands
src/devices.js            OctoPrint -> Gladys device, snapshot -> states
src/octoprint/client.js   REST client
src/octoprint/socket.js   push socket with reconnection and idle watchdog
src/octoprint/appkeys.js  Application Keys workflow
src/octoprint/model.js    reading the REST and push answers
src/widgets.js            "3D print" dashboard widget
src/scenes.js             scene actions
src/texts.js              every text, in four languages
test/                     node --test; the SDK's fake Gladys, simulated OctoPrint
test/fixtures/octoprint/  real OctoPrint 1.11.8 answers, anonymized
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

To run it outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="octoprint" \
OCTOPRINT_DATA_DIR=./data \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. A hand-pushed `vX.Y.Z` tag also builds the image and the
GitHub Release, but then `version` in `package.json` and in the manifest (with
the `docker_image` tag) must be bumped and committed before tagging. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- Home Assistant's
  [`octoprint`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/octoprint)
  integration (Apache-2.0): the set of sensors and buttons, the Application
  Keys flow, the handling of a disconnected printer (409).
- [pyoctoprintapi](https://github.com/rfleming71/pyoctoprintapi) by Ryan
  Fleming (MIT): `test/fixtures/octoprint/*-pyoctoprintapi.json` come from its
  test suite.
- [OctoPrint](https://github.com/OctoPrint/OctoPrint) by Gina Häußge and
  contributors (AGPL-3.0), and its [REST API documentation](https://docs.octoprint.org/en/master/api/).
  The other fixtures were recorded on the official `octoprint/octoprint` image
  with its virtual printer.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the OctoPrint
project. "OctoPrint" is the name of its owners' project.

## License

Apache-2.0
