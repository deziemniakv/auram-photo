/**
 * Token values needed outside of CSS (e.g. by the Electron main process for the
 * native window background and title bar overlay). Must match tokens.css.
 */
export const colors = {
  bg: '#0b0b0c',
  surface0: '#0f0f10',
  surface1: '#141416',
  border: '#2a2a2e',
  textPrimary: '#ececed',
  textSecondary: '#a3a3a8',
} as const;

export const layout = {
  topbarHeight: 40,
  sidebarWidth: 232,
} as const;

/** Maps exported token names to the CSS custom properties they mirror. */
export const cssVariableMap = {
  'colors.bg': '--color-bg',
  'colors.surface0': '--color-surface-0',
  'colors.surface1': '--color-surface-1',
  'colors.border': '--color-border',
  'colors.textPrimary': '--color-text-primary',
  'colors.textSecondary': '--color-text-secondary',
  'layout.topbarHeight': '--topbar-height',
  'layout.sidebarWidth': '--sidebar-width',
} as const;
