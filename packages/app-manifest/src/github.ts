import { z } from 'zod';
import type { GitHubReleaseSource } from './schemas';

/** The subset of the GitHub REST "list releases" response the launcher relies on. */
export const GitHubReleaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.string(),
      size: z.number(),
    }),
  ),
});
export type GitHubRelease = z.infer<typeof GitHubReleaseSchema>;

export const GitHubReleaseListSchema = z.array(GitHubReleaseSchema);

export function githubReleasesApiUrl(source: Pick<GitHubReleaseSource, 'owner' | 'repo'>): string {
  return `https://api.github.com/repos/${source.owner}/${source.repo}/releases?per_page=20`;
}

export interface PickedRelease {
  release: GitHubRelease;
  manifestUrl: string;
}

/**
 * Picks the newest published release that carries the manifest asset.
 * GitHub returns releases newest first; drafts are never considered.
 */
export function pickRelease(
  releases: GitHubRelease[],
  manifestAsset: string,
  includePrerelease: boolean,
): PickedRelease | null {
  for (const release of releases) {
    if (release.draft) continue;
    if (release.prerelease && !includePrerelease) continue;
    const asset = release.assets.find((candidate) => candidate.name === manifestAsset);
    if (asset) return { release, manifestUrl: asset.browser_download_url };
  }
  return null;
}
