import apiClient from './client';
import {
  ThemeSettings,
  DEFAULT_THEME_COLORS,
  EnabledThemes,
  DEFAULT_ENABLED_THEMES,
  isLegacyUpstreamColors,
} from '../types/theme';

export const themeColorsApi = {
  // Get current theme colors (public, no auth required)
  getColors: async (): Promise<ThemeSettings> => {
    try {
      const response = await apiClient.get<ThemeSettings>('/cabinet/branding/colors');
      // A backend whose colors were never customized in the admin serves the
      // untouched legacy upstream palette — treat that as "unset" so the
      // Mitray brand palette applies everywhere instead of upstream-blue.
      return isLegacyUpstreamColors(response.data) ? DEFAULT_THEME_COLORS : response.data;
    } catch {
      // Return default colors if endpoint not available
      return DEFAULT_THEME_COLORS;
    }
  },

  // Update theme colors (admin only)
  updateColors: async (colors: Partial<ThemeSettings>): Promise<ThemeSettings> => {
    const response = await apiClient.patch<ThemeSettings>('/cabinet/branding/colors', colors);
    return response.data;
  },

  // Reset to default colors (admin only)
  resetColors: async (): Promise<ThemeSettings> => {
    const response = await apiClient.post<ThemeSettings>('/cabinet/branding/colors/reset');
    return response.data;
  },

  // Get enabled themes (public, no auth required)
  getEnabledThemes: async (): Promise<EnabledThemes> => {
    try {
      const response = await apiClient.get<EnabledThemes>('/cabinet/branding/themes');
      return response.data;
    } catch {
      return DEFAULT_ENABLED_THEMES;
    }
  },

  // Update enabled themes (admin only)
  updateEnabledThemes: async (themes: Partial<EnabledThemes>): Promise<EnabledThemes> => {
    const response = await apiClient.patch<EnabledThemes>('/cabinet/branding/themes', themes);
    return response.data;
  },
};
