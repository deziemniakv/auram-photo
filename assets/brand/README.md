# Brand assets

| File                     | Purpose                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `source/auram-logo.png`  | The official Auram logo as supplied by the project owner. **Never edited.** |
| `auram-mark.png`         | The logo cropped to the mark (original colours, for light backgrounds).     |
| `auram-mark-inverse.png` | Tone-inverted mark for dark interfaces. Shape and alpha are unchanged.      |

Auram Photo uses the same files as Auram Launcher (`apps/photo/src/renderer/src/assets/auram-mark-inverse.png`,
`apps/photo/build/icon.png`, `icon.ico`). They are generated in the Auram-Launcher repository
from the source file by:

```sh
python3 scripts/generate-brand-assets.py   # requires Pillow
```

If an official light-on-dark variant or a vector (SVG) version of the logo becomes available,
place it in `source/` and update the script rather than editing the derived files by hand.

## Usage

The Auram name and logo identify the Auram project. They are **not** covered by the Apache
License 2.0 that applies to the source code (see `NOTICE`). Forks and redistributions should
replace them with their own branding. A formal trademark and brand-usage policy is pending.
