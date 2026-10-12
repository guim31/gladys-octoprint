# OctoPrint fixtures

Real answers of OctoPrint, used by the tests through `test/helpers/fakeOctoPrint.js`.

- Recorded on 2026-10-12 on the official Docker image `octoprint/octoprint`
  (OctoPrint 1.11.8) with its bundled virtual printer, during real prints of a
  small G-code file (pause, resume, cancellation, end of print, printer
  disconnection), and with a second printer profile (two nozzles, heated
  chamber). Anonymized: addresses replaced by `192.0.2.x`, tokens and keys by
  placeholders, the `logs` / `messages` / `markings` of the push messages
  removed, `settings*.json` reduced to the appearance and webcam sections.
- `push-session.json`: the push socket during those prints (`connected`,
  `history`, `current`, and the print events), with the time in ms since the
  connection.
- `*-pyoctoprintapi.json`: from the test suite of
  [pyoctoprintapi](https://github.com/rfleming71/pyoctoprintapi) (MIT).
