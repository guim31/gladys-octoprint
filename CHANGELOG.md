# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]

### Fixed

- The webcam image is now sent to the Gladys camera device: it was sent under
  the feature id, which Gladys refused (404), so the dashboard camera never
  updated from the pushed images.

` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-13

### Changed

- Quieter logs: when the live link to OctoPrint cannot be opened (a reverse
  proxy without WebSocket, an OctoPrint that stays silent), one line is written
  when the problem starts instead of one every few attempts, and none every
  minute. A refusal of Gladys to take the states or the connection status of a
  printer is written once, then once more when it works again, instead of at
  every update.

### Fixed

- A connection status refused once by Gladys is sent again at the next update,
  instead of waiting for the status to change.

## [1.0.0] - 2026-10-12

### Added

- One Gladys device per OctoPrint instance, up to three: state, file, progress,
  elapsed and remaining time, nozzle, bed and chamber temperatures with their
  setpoints (read only, kept out of the room temperature; heating goes
  through the widget and the scene actions), pause and resume buttons, and the
  webcam image through OctoPrint.
- Real-time values through the push socket of OctoPrint, with a REST polling
  fallback when it is unavailable.
- **Connect with OctoPrint** button: the access request is approved in
  OctoPrint and the API key is saved by itself. A key can also be pasted.
- "3D print" dashboard widget: progress gauge, time left, temperatures, state,
  file, end time, setpoints, and pause / resume / cancel (with confirmation) /
  preheat / cool down buttons depending on the state.
- Scene triggers: print started, print finished, print failed or cancelled
  (filter by reason), print paused, with the file and the print time.
- Scene actions: pause, resume or cancel a print; preheat (refused during a
  print); turn the heaters off.
- "Test the connection" action, and a connection status that says which
  printer needs attention.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-octoprint/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-octoprint/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-octoprint/releases/tag/v1.0.0
