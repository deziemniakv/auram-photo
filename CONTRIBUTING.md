# Contributing to Auram Photo

Thank you for helping build Auram Photo. The [Code of Conduct](CODE_OF_CONDUCT.md) applies
everywhere; report vulnerabilities privately ([SECURITY.md](SECURITY.md)).

## Setup

```sh
corepack enable
pnpm install
pnpm dev
```

## Before opening a pull request

```sh
pnpm format
pnpm check
pnpm build && pnpm test:e2e     # Linux: xvfb-run -a pnpm test:e2e
```

## Expectations

- **Engine first.** Image operations belong in `packages/engine` as pure, unit-tested functions
  that return undoable commands. The UI only calls them.
- **One reference for pixels.** `FloatCanvas` / `blendColors` in `packages/engine/src/blend.ts`
  define compositing. The GLSL compositor must match it; the end-to-end suite compares both for
  every blend mode. Change both together.
- **Never lose user data.** Saving is atomic; opening validates everything; failures are shown,
  not swallowed. New file features need round-trip tests.
- **Security boundary.** The renderer is sandboxed. File access goes through typed, validated IPC
  handlers in `apps/photo/src/main`, and a window may only write to files it opened, saved or
  chose in a dialog.
- **Design system.** Use the tokens and `@auram/ui`; square corners; visible keyboard focus. A test
  rejects hard-coded colours and radii in stylesheets.
- **Translations.** Every string goes through `apps/photo/src/renderer/src/i18n` in English and
  Polish.
- **Shared packages.** `packages/design-tokens`, `ui`, `project-format` and `app-manifest` are
  vendored from Auram Launcher. Change them there first (see `packages/README.md`).
