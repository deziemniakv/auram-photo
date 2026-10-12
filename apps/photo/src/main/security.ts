import { app, session, shell, type WebContents } from 'electron';
import type { Logger } from './services/logger';

/** Hosts the launcher may open in the user's browser. */
const EXTERNAL_HOSTS = new Set(['github.com', 'www.github.com']);

export function isAllowedExternalUrl(
  raw: string,
  extraHosts: ReadonlySet<string> = new Set(),
): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      (EXTERNAL_HOSTS.has(url.hostname) || extraHosts.has(url.hostname))
    );
  } catch {
    return false;
  }
}

/** The renderer origin: the dev server in development, the packaged file otherwise. */
export function isTrustedRendererUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  if (devUrl) {
    try {
      return new URL(raw).origin === new URL(devUrl).origin;
    } catch {
      return false;
    }
  }
  return raw.startsWith('file://') && /\/renderer\/index\.html(?:[?#].*)?$/.test(raw);
}

/**
 * Process-wide hardening, applied before any window exists:
 * no navigation away from the app, no new windows, no <webview>,
 * no permission grants, and external links only to allowlisted https hosts.
 */
export function applySecurityPolicies(
  logger: Logger,
  getExtraHosts: () => ReadonlySet<string>,
): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    logger.warn('security', `Denied permission request: ${permission}`);
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererUrl(url)) {
        event.preventDefault();
        logger.warn('security', 'Blocked navigation', { url });
      }
    });
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedRendererUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url, getExtraHosts())) {
        void shell.openExternal(url);
      } else {
        logger.warn('security', 'Blocked window.open', { url });
      }
      return { action: 'deny' };
    });
  });
}
