// Theme color settings interface
export interface ThemeColors {
  // Main accent color
  accent: string;

  // Dark theme
  darkBackground: string;
  darkSurface: string;
  darkText: string;
  darkTextSecondary: string;

  // Light theme
  lightBackground: string;
  lightSurface: string;
  lightText: string;
  lightTextSecondary: string;

  // Status colors
  success: string;
  warning: string;
  error: string;
}

export interface ThemeSettings extends ThemeColors {
  id?: number;
  updated_at?: string;
}

// Enabled themes settings
export interface EnabledThemes {
  dark: boolean;
  light: boolean;
}

export const DEFAULT_ENABLED_THEMES: EnabledThemes = {
  dark: true,
  light: true,
};

// Default theme colors — Mitray VPN brand palette (redesign).
// applyThemeColors() generates the full token ramps from these base colors.
export const DEFAULT_THEME_COLORS: ThemeColors = {
  accent: '#9B9DFF', // iris / periwinkle

  darkBackground: '#0C0C12', // near-black canvas
  darkSurface: '#101019',
  darkText: '#F4F5FB',
  darkTextSecondary: '#888CA0',

  lightBackground: '#EBECF5', // lavender-grey
  lightSurface: '#F5F6FC',
  lightText: '#15151D',
  lightTextSecondary: '#565A6B',

  success: '#3CE382', // traffic / unlock green
  warning: '#f59e0b',
  error: '#ef4444',
};

// Legacy upstream default palette. Backends that have never had their colors
// customized in the admin ThemeTab serve exactly this set — treat it as
// "unset" and fall back to the Mitray brand palette instead of painting the
// cabinet upstream-blue. An admin saving ANY other palette still wins.
export const LEGACY_UPSTREAM_THEME_COLORS: ThemeColors = {
  accent: '#3b82f6',

  darkBackground: '#0a0f1a',
  darkSurface: '#0f172a',
  darkText: '#f1f5f9',
  darkTextSecondary: '#94a3b8',

  lightBackground: '#F7E7CE',
  lightSurface: '#FEF9F0',
  lightText: '#1F1A12',
  lightTextSecondary: '#7D6B48',

  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
};

export function isLegacyUpstreamColors(colors: ThemeColors): boolean {
  return (Object.keys(LEGACY_UPSTREAM_THEME_COLORS) as (keyof ThemeColors)[]).every(
    (key) => colors[key]?.toLowerCase() === LEGACY_UPSTREAM_THEME_COLORS[key].toLowerCase(),
  );
}

// Color shade levels for palette generation
export const SHADE_LEVELS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

// Extended shade levels including 850 for dark palette
export const EXTENDED_SHADE_LEVELS = [
  50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950,
] as const;

export type ShadeLevel = (typeof SHADE_LEVELS)[number];
export type ExtendedShadeLevel = (typeof EXTENDED_SHADE_LEVELS)[number];

export type ColorPalette = Record<ShadeLevel | 850, string>;

// Extended theme settings for user preferences
export type BorderRadiusPreset = 'none' | 'small' | 'medium' | 'large' | 'pill';
export type SpacingPreset = 'compact' | 'comfortable' | 'spacious';
export type ThemeMode = 'dark' | 'light' | 'system';

export interface UserThemePreferences {
  /**
   * Theme mode preference
   * @default 'system'
   */
  theme: ThemeMode;

  /**
   * Border radius preset
   * @default 'large'
   */
  borderRadius: BorderRadiusPreset;

  /**
   * Whether animations are enabled
   * @default true
   */
  animationsEnabled: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserThemePreferences = {
  theme: 'system',
  borderRadius: 'large',
  animationsEnabled: true,
};

// CSS variable values for each preset
export const BORDER_RADIUS_VALUES: Record<BorderRadiusPreset, string> = {
  none: '0px',
  small: '8px',
  medium: '16px',
  large: '24px',
  pill: '9999px',
};

export const SPACING_VALUES: Record<SpacingPreset, { padding: string; gap: string }> = {
  compact: { padding: '12px', gap: '12px' },
  comfortable: { padding: '16px', gap: '16px' },
  spacious: { padding: '24px', gap: '24px' },
};
