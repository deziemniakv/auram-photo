# Releasing Auram Photo

1. Update `CHANGELOG.md` and set the version in `apps/photo/package.json` (SemVer; a prerelease
   such as `0.2.0-beta.1` is published as a prerelease and only offered by the launcher when the
   user enables prereleases).
2. Run `pnpm check` and `pnpm test:e2e`.
3. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
4. The **Release** workflow checks the tag against the package version, runs lint, typecheck and
   tests on Windows, builds `auram-photo-<version>-win32-x64.zip`, generates `auram-release.json`
   and attaches both to a **draft** GitHub release.
5. Test the ZIP: extract it, run `Auram Photo.exe`, open and save a project.
6. Publish the draft. Auram Launcher only reads published releases, so the new version appears in
   the launcher after this step.

## What the launcher checks

Auram Launcher downloads `auram-release.json` from the newest published release, validates it, and
installs the ZIP only if its size and SHA-256 match the manifest and the archive contains a valid
`auram-app.json` whose id and version match. `minLauncherVersion` in the manifest
(`scripts/write-release-manifest.mjs`) must be raised when Photo starts relying on newer launcher
behaviour.

## Building locally

```sh
pnpm package:win                 # on Windows
pnpm --filter @auram/photo package:dir   # unpacked build for smoke tests on any OS
```

The packages are unsigned. Code signing will be configured together with Auram Launcher's.
