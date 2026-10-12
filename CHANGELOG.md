# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One Gladys device per OctoPrint instance, up to three: state, file, progress,
  elapsed and remaining time, nozzle, bed and chamber temperatures with their
  setpoints (adjustable from the dashboard), pause and resume buttons, and the
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

[Unreleased]: https://github.com/guim31/gladys-octoprint/commits/main
