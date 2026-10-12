# Releasing Auram Photo

1. Update `CHANGELOG.md` and set the version in `apps/photo/package.json` (SemVer; a prerelease
   such as `0.2.0-beta.1` is published as a prerelease and only offered by the launcher when the
   user enables prereleases). Merge the change into `main`.
2. Start the release, either way:
   - **Actions → Release → Run workflow** on `main` (no local tools needed), or
   - push a tag yourself: `git tag -a v0.1.0 -m "Auram Photo 0.1.0" && git push origin v0.1.0`.
3. The **Release** workflow checks the version, runs lint, typecheck and tests on Windows, builds
   `auram-photo-<version>-win32-x64.zip`, generates `auram-release.json`, and attaches both to a
   **draft** GitHub release. When started from the button it creates the `v<version>` tag only
   after the build succeeded, and refuses to run if that tag already exists.
4. Test the ZIP: extract it, run `Auram Photo.exe`, open and save a project.
5. Publish the draft. Auram Launcher only reads published releases, so the new version appears in
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
