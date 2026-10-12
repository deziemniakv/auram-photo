# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/deziemniakv/auram-photo/security/advisories/new).
Please do not open public issues for security problems. We aim to acknowledge reports within
seven days.

## Supported versions

Early development: fixes land on `main` and ship in the next release.

## Security model

- The editor UI runs with `contextIsolation`, `sandbox` and no Node.js integration under a strict
  Content Security Policy; it reaches the system only through the typed preload API.
- Every IPC call is checked against the sending frame and validated with Zod.
- A window can read only files the user chose (dialog, recent list, or the path Auram Launcher
  passed) and write only to files it opened, saved or chose in a save dialog. Writes are atomic.
- Opened files are size-limited before reading; project archives are validated (manifest,
  document schema, layer sizes) before use; nothing inside a file is ever executed.
- Navigation, new windows, `<webview>` and permission requests are blocked.
- Packaged builds disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and inspector flags via Electron
  fuses and validate `app.asar` integrity.
- On machines without a usable GPU, Chromium's software WebGL renderer is allowed
  (`enable-unsafe-swiftshader`). That switch exists to protect browsers from untrusted web pages;
  Auram Photo only runs its own bundled code, so it does not widen the attack surface in the same
  way.
