import { z } from 'zod';
import { AppIdSchema, VersionSchema } from '@auram/app-manifest';

/**
 * Auram project container (`.cproj`), format version 1.
 *
 * A `.cproj` file is a ZIP archive. The launcher only ever reads two entries:
 *
 * - `manifest.json`   (required) metadata described by {@link ProjectManifestSchema}
 * - `thumbnail.png`   (optional) preview image, also accepted as .jpg / .webp
 *
 * Everything else inside the container belongs to the application that owns the
 * project and is never interpreted by the launcher. See docs/project-format.md.
 */

export const PROJECT_EXTENSION = '.cproj';
export const PROJECT_MANIFEST_ENTRY = 'manifest.json';
export const PROJECT_THUMBNAIL_ENTRIES = {
  'thumbnail.png': 'image/png',
  'thumbnail.jpg': 'image/jpeg',
  'thumbnail.webp': 'image/webp',
} as const;
export type ThumbnailEntry = keyof typeof PROJECT_THUMBNAIL_ENTRIES;

/** Upper bounds that keep a malformed or hostile file from exhausting memory. */
export const MAX_PROJECT_MANIFEST_BYTES = 256 * 1024;
export const MAX_PROJECT_THUMBNAIL_BYTES = 4 * 1024 * 1024;

export const ProjectManifestSchema = z.looseObject({
  format: z.literal('auram.project'),
  formatVersion: z.literal(1),
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  /** The application that created and owns the project, e.g. `auram.photo`. */
  appId: AppIdSchema,
  appVersion: VersionSchema.optional(),
  createdAt: z.iso.datetime({ offset: true }),
  modifiedAt: z.iso.datetime({ offset: true }),
});
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

export function isProjectFileName(fileName: string): boolean {
  return (
    fileName.toLowerCase().endsWith(PROJECT_EXTENSION) && fileName.length > PROJECT_EXTENSION.length
  );
}

export type ParseProjectManifestResult =
  { ok: true; manifest: ProjectManifest } | { ok: false; error: string };

export function parseProjectManifest(raw: string): ParseProjectManifestResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'manifest.json is not valid JSON' };
  }
  const result = ProjectManifestSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      error: issue ? `${issue.path.join('.') || 'manifest'}: ${issue.message}` : 'Invalid manifest',
    };
  }
  return { ok: true, manifest: result.data };
}
