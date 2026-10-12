# Shared packages

| Package                                                 | Source of truth                                                             |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `engine`                                                | This repository                                                             |
| `design-tokens`, `ui`, `project-format`, `app-manifest` | [Auram-Launcher](https://github.com/deziemniakv/Auram-Launcher) `packages/` |

The four shared packages are vendored copies taken from Auram-Launcher at commit
`5db026a` (recorded in `.vendored-from`). They are kept identical so both
applications look the same and agree on the project and release formats, with one local change:
`design-tokens/src/tokens.test.ts` scans every `apps/*/src/renderer` folder instead of only the
launcher's.

To change a shared package, change it in Auram-Launcher first, then copy it here and update
`.vendored-from`. When a third application joins the ecosystem, publish these packages (for
example to GitHub Packages) instead of copying them.
