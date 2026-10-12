import { z } from 'zod';
import { isValidVersion } from './version';

/** Stable application identifier, e.g. `auram.photo`. Never changes once published. */
export const AppIdSchema = z
  .string()
  .regex(/^auram\.[a-z0-9][a-z0-9-]{0,39}$/, 'Application id must look like "auram.photo"');
export type AppId = z.infer<typeof AppIdSchema>;

export const VersionSchema = z
  .string()
  .max(64)
  .refine(isValidVersion, 'Expected a semantic version such as 1.2.3');

export const PlatformSchema = z.enum(['win32', 'darwin', 'linux']);
export type Platform = z.infer<typeof PlatformSchema>;

export const ArchSchema = z.enum(['x64', 'arm64']);
export type Arch = z.infer<typeof ArchSchema>;

const HttpsUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Expected an https:// URL');

/**
 * A relative path that cannot escape the directory it is resolved against.
 * Forward slashes only; no drive letters, no `..` segments, no absolute paths.
 */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 260) return false;
  if (value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export const SafeRelativePathSchema = z
  .string()
  .refine(isSafeRelativePath, 'Expected a relative path using forward slashes, without ".."');

/* -------------------------------------------------------------------------- */
/* Catalog: the list of applications the launcher knows about.                 */
/* Bundled with the launcher; describes products, not installations.           */
/* -------------------------------------------------------------------------- */

export const AppCategorySchema = z.enum(['photo', 'video', 'motion', '3d']);
export type AppCategory = z.infer<typeof AppCategorySchema>;

/**
 * - `released`: release manifests are published and the app can be installed.
 * - `in-development`: the app is being built; releases may not exist yet.
 * - `planned`: part of the product direction, no code to install.
 */
export const AppAvailabilitySchema = z.enum(['released', 'in-development', 'planned']);
export type AppAvailability = z.infer<typeof AppAvailabilitySchema>;

export const GitHubReleaseSourceSchema = z.object({
  type: z.literal('github'),
  owner: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
  repo: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  /** Name of the release asset that contains the release manifest. */
  manifestAsset: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
});
export type GitHubReleaseSource = z.infer<typeof GitHubReleaseSourceSchema>;

export const ReleaseSourceSchema = GitHubReleaseSourceSchema;
export type ReleaseSource = z.infer<typeof ReleaseSourceSchema>;

export const CatalogEntrySchema = z.object({
  id: AppIdSchema,
  name: z.string().min(1).max(64),
  /** English description. */
  description: z.string().min(1).max(280),
  /** Translations of `description`, keyed by ISO 639-1 language code. */
  descriptionTranslations: z
    .record(z.string().regex(/^[a-z]{2}$/), z.string().min(1).max(280))
    .default({}),
  category: AppCategorySchema,
  availability: AppAvailabilitySchema,
  homepage: HttpsUrlSchema.optional(),
  releaseSource: ReleaseSourceSchema.nullable(),
  /** File extensions (including the dot) this application opens. */
  projectExtensions: z.array(z.string().regex(/^\.[a-z0-9]{1,16}$/)).default([]),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export const CatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    apps: z.array(CatalogEntrySchema),
  })
  .superRefine((catalog, ctx) => {
    const seen = new Set<string>();
    for (const app of catalog.apps) {
      if (seen.has(app.id)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate application id ${app.id}` });
      }
      seen.add(app.id);
    }
  });
export type Catalog = z.infer<typeof CatalogSchema>;

/* -------------------------------------------------------------------------- */
/* Release manifest: published by an application for every release.           */
/* -------------------------------------------------------------------------- */

export const ArtifactSchema = z.object({
  platform: PlatformSchema,
  arch: ArchSchema,
  format: z.literal('zip'),
  url: HttpsUrlSchema,
  /** Lowercase hex SHA-256 of the artifact. Downloads are rejected on mismatch. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase hex SHA-256 digest'),
  /** Size in bytes. Downloads exceeding this size are aborted. */
  size: z
    .number()
    .int()
    .positive()
    .max(8 * 1024 ** 3),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: AppIdSchema,
  name: z.string().min(1).max(64),
  version: VersionSchema,
  channel: z.enum(['stable', 'prerelease']),
  releasedAt: z.iso.datetime({ offset: true }),
  minLauncherVersion: VersionSchema,
  releaseNotes: z.object({
    summary: z.string().max(500).optional(),
    /** Plain text. The launcher never renders it as HTML. */
    body: z.string().max(20_000).optional(),
    url: HttpsUrlSchema.optional(),
  }),
  artifacts: z.array(ArtifactSchema).min(1),
  dependencies: z.array(z.object({ id: AppIdSchema, minVersion: VersionSchema })).default([]),
});
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

/* -------------------------------------------------------------------------- */
/* Installed application descriptor: `auram-app.json` at the root of every      */
/* installed version directory. Shipped inside the artifact by the app itself.  */
/* -------------------------------------------------------------------------- */

export const AppDescriptorSchema = z.object({
  schemaVersion: z.literal(1),
  id: AppIdSchema,
  name: z.string().min(1).max(64),
  version: VersionSchema,
  /** Executable path per platform, relative to the version directory. */
  executable: z
    .object({
      win32: SafeRelativePathSchema.optional(),
      darwin: SafeRelativePathSchema.optional(),
      linux: SafeRelativePathSchema.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, 'At least one executable is required'),
  /**
   * How a project file is passed to the application. Only a fixed flag or a bare
   * positional argument is allowed; arbitrary command lines are not supported.
   */
  openProjectArgument: z
    .union([z.literal('positional'), z.string().regex(/^--[a-z][a-z0-9-]{0,31}$/)])
    .default('positional'),
});
export type AppDescriptor = z.infer<typeof AppDescriptorSchema>;

/** `Apps/<id>/current.json`: which installed version is active. Written by the launcher. */
export const InstallationRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: AppIdSchema,
  version: VersionSchema,
  installedAt: z.iso.datetime({ offset: true }),
  source: z.enum(['release', 'manual']),
});
export type InstallationRecord = z.infer<typeof InstallationRecordSchema>;
