# Auram Photo document format

Auram Photo saves documents as Auram project containers (`.cproj`): ZIP archives following the
shared format in Auram Launcher's `docs/project-format.md`.

| Entry             | Contents                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`   | Shared project manifest (`format: "auram.project"`, `formatVersion: 1`, `appId: "auram.photo"`, name, id, timestamps). Read by Auram Launcher. |
| `thumbnail.png`   | Flattened preview, longest side at most 512 px. Shown by Auram Launcher.                                                                       |
| `document.json`   | Auram Photo document structure (below).                                                                                                        |
| `layers/<id>.png` | One RGBA, 8-bit, straight-alpha PNG per layer at full document size.                                                                           |

## `document.json`, version 1

```json
{
  "format": "auram.photo.document",
  "formatVersion": 1,
  "width": 1920,
  "height": 1080,
  "activeLayerId": "6b0c…",
  "layers": [
    { "id": "1f2e…", "name": "Background", "visible": true, "opacity": 1, "blendMode": "normal" },
    { "id": "6b0c…", "name": "Ink", "visible": true, "opacity": 0.8, "blendMode": "multiply" }
  ]
}
```

- `layers` are listed bottom to top.
- `blendMode` is one of: normal, multiply, screen, overlay, darken, lighten, color-dodge,
  color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity
  (W3C Compositing and Blending Level 1).
- Sizes are limited to 16384 px per side and 256 layers; the editor additionally refuses documents
  larger than the GPU's maximum texture size.

## Guarantees

- Pixels round-trip exactly, including semi-transparent ones (layers are encoded with an exact PNG
  encoder, not via the browser canvas, which would premultiply alpha).
- Files are written atomically: a failed save never leaves a half-written project.
- Opening validates the manifest, `document.json`, every layer's presence and size, and rejects
  projects that belong to another application.

Breaking changes require a new `formatVersion`; readers must reject versions they do not know.
