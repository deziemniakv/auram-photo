# Releasing Auram Photo

1. Update `CHANGELOG.md` and set the version in `apps/photo/package.json` (SemVer; a prerelease
   such as `0.2.0-beta.1` is published as a prerelease and only offered by the launcher when the
   user enables prereleases). Merge the change into `main`.
2. Start the release, either way:
   - **Actions → Release → Run workflow** on `main` (no local tools needed), or
   - push a tag yourself: `git tag -a v0.1.0 -m "Auram Photo 0.1.0" && git push origin v0.1.0`.
3. The **Release** workflow inspects the tag and release, then:
   - **no tag yet:** runs lint, typecheck and tests on Windows, builds
     `auram-photo-<version>-win32-x64.zip` and `auram-release.json`, creates the `v<version>` tag
     (only after the build succeeded) and a **draft** release with both files;
   - **tag exists, no release:** does the same for exactly the tagged commit (which must be on
     `main` and carry the same version), without touching the tag;
   - **release already exists:** builds nothing and lists its files in the run summary.
4. Test the ZIP from the draft: extract it, run `Auram Photo.exe`, open and save a project.
5. Run the workflow again with **Publish the draft release** ticked. It downloads the draft's ZIP and
   manifest, checks that both are attached and that the manifest's version, download URL, size and
   SHA-256 match the ZIP (`scripts/verify-release.mjs`), and only then publishes the draft. Auram
   Launcher only reads published releases, so the new version appears in the launcher after this.

The workflow never deletes, moves or overwrites a tag or release. If a draft is missing a file,
upload the missing file to the draft (or delete the draft yourself) and run the workflow again.

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
