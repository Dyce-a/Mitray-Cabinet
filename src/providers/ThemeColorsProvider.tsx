import { useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { themeColorsApi } from '../api/themeColors';
import { DEFAULT_THEME_COLORS } from '../types/theme';
import { applyThemeColors } from '../hooks/useThemeColors';
import { usePlatform } from '@/platform';
import { useTheme } from '../hooks/useTheme';

interface ThemeColorsProviderProps {
  children: React.ReactNode;
}

export function ThemeColorsProvider({ children }: ThemeColorsProviderProps) {
  const { data: colors } = useQuery({
    queryKey: ['theme-colors'],
    queryFn: themeColorsApi.getColors,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const { theme: platformTheme, capabilities } = usePlatform();
  const { isDark } = useTheme();

  // VITE_FORCE_BRAND_THEME=true (local .env) ignores backend colors entirely;
  // otherwise backend colors win (themeColorsApi.getColors already maps the
  // untouched legacy upstream palette to the brand defaults).
  const forceBrand = import.meta.env.VITE_FORCE_BRAND_THEME === 'true';
  const activeColors = forceBrand ? DEFAULT_THEME_COLORS : colors || DEFAULT_THEME_COLORS;

  // Apply colors on mount and when they change
  useEffect(() => {
    applyThemeColors(activeColors);
  }, [activeColors]);

  // Sync Telegram header and bottom bar colors with theme
  const syncTelegramColors = useCallback(() => {
    if (!capabilities.hasThemeSync) return;

    // Use surface color for header/bottom bar to match app UI
    const headerColor = isDark ? activeColors.darkSurface : activeColors.lightSurface;

    platformTheme.setHeaderColor(headerColor);
    platformTheme.setBottomBarColor(headerColor);
  }, [capabilities.hasThemeSync, activeColors, isDark, platformTheme]);

  // Apply Telegram colors when theme or colors change
  useEffect(() => {
    syncTelegramColors();
  }, [syncTelegramColors]);

  return <>{children}</>;
}
