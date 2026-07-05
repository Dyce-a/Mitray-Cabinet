import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';

import { useAuthStore } from '@/store/auth';
import { useHaptic } from '@/platform';
import { useTelegramSDK } from '@/hooks/useTelegramSDK';
import { useHeaderHeight } from '@/hooks/useHeaderHeight';
import { useTheme } from '@/hooks/useTheme';
import { useBranding } from '@/hooks/useBranding';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useScrollRestoration } from '@/hooks/useScrollRestoration';
import { themeColorsApi } from '@/api/themeColors';
import { cn } from '@/lib/utils';

import WebSocketNotifications from '@/components/WebSocketNotifications';
import CampaignBonusNotifier from '@/components/CampaignBonusNotifier';
import SuccessNotificationModal from '@/components/SuccessNotificationModal';
import { PromptDialogHost } from '@/components/PromptDialogHost';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import TicketNotificationBell from '@/components/TicketNotificationBell';
import {
  SubscriptionIcon,
  GiftIcon,
  HomeIcon,
  CreditCardIcon,
  ChatIcon,
  UserIcon,
  UsersIcon,
  ShieldIcon,
  InfoIcon,
  LogoutIcon,
  SunIcon,
  MoonIcon,
} from '@/components/icons';

import { MobileBottomNav } from './MobileBottomNav';
import { AppHeader } from './AppHeader';
import { BrandBackground } from '@/components/backgrounds/BrandBackground';
import { IntroLoader } from '@/components/intro/IntroLoader';
import '@/styles/app-shell.css';
import '@/styles/mobile-shell.css';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const logout = useAuthStore((state) => state.logout);
  const { isFullscreen, safeAreaInset, contentSafeAreaInset, platform, isMobile } =
    useTelegramSDK();
  const { mobile: headerHeight } = useHeaderHeight();
  const haptic = useHaptic();
  const { toggleTheme, isDark } = useTheme();

  // Extracted hooks
  const { appName } = useBranding();
  const { referralEnabled, wheelEnabled, hasContests, hasPolls, giftEnabled } = useFeatureFlags();
  useScrollRestoration();

  // Theme toggle visibility
  const { data: enabledThemes } = useQuery({
    queryKey: ['enabled-themes'],
    queryFn: themeColorsApi.getEnabledThemes,
    staleTime: 1000 * 60 * 5,
  });
  const canToggleTheme = enabledThemes?.dark && enabledThemes?.light;

  // Only apply fullscreen UI adjustments on mobile Telegram (iOS/Android)
  const isMobileFullscreen = isFullscreen && isMobile;

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  // Reset keyboard state on route change — prevents bottom nav staying hidden after navigation
  useEffect(() => {
    setIsKeyboardOpen(false);
  }, [location.pathname]);

  // Keyboard detection for hiding bottom nav
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        setIsKeyboardOpen(true);
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (
        !relatedTarget ||
        (relatedTarget.tagName !== 'INPUT' &&
          relatedTarget.tagName !== 'TEXTAREA' &&
          !relatedTarget.isContentEditable)
      ) {
        setIsKeyboardOpen(false);
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // Desktop navigation — labels always visible (no hover-reveal gimmick)
  const desktopNav = [
    { path: '/', label: t('nav.dashboard'), icon: HomeIcon },
    { path: '/subscriptions', label: t('nav.subscription'), icon: SubscriptionIcon },
    { path: '/balance', label: t('nav.balance'), icon: CreditCardIcon },
    ...(referralEnabled ? [{ path: '/referral', label: t('nav.referral'), icon: UsersIcon }] : []),
    ...(giftEnabled ? [{ path: '/gift', label: t('nav.gift'), icon: GiftIcon }] : []),
    { path: '/support', label: t('nav.support'), icon: ChatIcon },
    { path: '/info', label: t('nav.info'), icon: InfoIcon },
    { path: '/profile', label: t('nav.profile'), icon: UserIcon },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleNavClick = () => {
    haptic.impact('light');
  };

  // A single elegant nav link: icon + label always visible, with a shared
  // framer-motion pill that slides to the active item on navigation.
  const renderNavLink = (
    path: string,
    label: string,
    Icon: React.ComponentType<{ className?: string }>,
    admin = false,
  ) => {
    const active = admin ? location.pathname.startsWith('/admin') : isActive(path);
    return (
      <Link
        key={path}
        to={path}
        onClick={handleNavClick}
        aria-label={label}
        className={cn('nav-item shrink-0', active && 'on', admin && 'nav-admin')}
      >
        {active && (
          <motion.span
            layoutId="desktop-nav-active"
            className="nav-pill absolute inset-0"
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          />
        )}
        <Icon className="relative h-4 w-4 shrink-0" />
        <span className="relative whitespace-nowrap">{label}</span>
      </Link>
    );
  };

  // headerHeight comes from useHeaderHeight() — accounts for TG safe area in fullscreen

  return (
    <div className="min-h-viewport">
      {/* Login → dashboard intro: signature loader that flies into the header
          brand slot on first cabinet entry (see IntroLoader / intro.css). */}
      <IntroLoader />

      {/* Brand background (dark canvas + soft blobs) — portal on document.body,
          matches the design-lab prototypes; replaces the animated aurora/beams. */}
      <BrandBackground />

      {/* Global components */}
      <WebSocketNotifications />
      <CampaignBonusNotifier />
      <SuccessNotificationModal />
      <PromptDialogHost />

      {/* Desktop Header — redesign shell (see app-shell.css). Layout: brand |
          nav capsule | spacer | actions. Nav logic + the framer-motion active
          pill are unchanged; only the look is the Mitray prototype. */}
      <header className="mitray-shell fixed left-0 right-0 top-0 z-50 hidden lg:block">
        <div className="hbar">
          {/* Logo (Mitray / VPN wordmark) */}
          <Link
            to="/"
            className="flex-none"
            onClick={handleNavClick}
            aria-label={appName || 'Mitray VPN'}
          >
            <svg className="brand-logo" viewBox="0 0 600 320" aria-label="Mitray VPN">
              <text className="bl1" x="300" y="150" textAnchor="middle" fontSize="150">
                Mitray
              </text>
              <text className="bl2" x="304" y="286" textAnchor="middle" fontSize="120">
                VPN
              </text>
            </svg>
          </Link>

          {/* Navigation capsule */}
          <nav className="nav">
            {desktopNav.map((item) => renderNavLink(item.path, item.label, item.icon))}
            {isAdmin && renderNavLink('/admin', t('admin.nav.title'), ShieldIcon, true)}
          </nav>

          <div className="spacer" />

          {/* Actions */}
          <div className="hact">
            <button
              onClick={() => {
                haptic.impact('light');
                toggleTheme();
              }}
              className={cn('iconbtn', !canToggleTheme && 'hidden')}
              aria-label={
                isDark ? t('theme.light') || 'Light mode' : t('theme.dark') || 'Dark mode'
              }
              title={isDark ? t('theme.light') || 'Light mode' : t('theme.dark') || 'Dark mode'}
            >
              {isDark ? <MoonIcon className="h-5 w-5" /> : <SunIcon className="h-5 w-5" />}
            </button>
            <TicketNotificationBell isAdmin={location.pathname.startsWith('/admin')} />
            <LanguageSwitcher />
            <button
              onClick={() => {
                haptic.impact('light');
                logout();
              }}
              className="iconbtn"
              title={t('nav.logout')}
            >
              <LogoutIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Header */}
      <AppHeader
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
        onCommandPaletteOpen={() => {}}
        headerHeight={headerHeight}
        isFullscreen={isMobileFullscreen}
        safeAreaInset={safeAreaInset}
        contentSafeAreaInset={contentSafeAreaInset}
        telegramPlatform={platform}
        wheelEnabled={wheelEnabled}
        referralEnabled={referralEnabled}
        hasContests={hasContests}
        hasPolls={hasPolls}
        giftEnabled={giftEnabled}
      />

      {/* Desktop spacer (mobile header is sticky — occupies flow, no spacer needed) */}
      <div className="hidden h-[66px] lg:block" />

      {/* Main content — 1200px matches the redesign prototypes' .wrap width
          (was max-w-6xl / 1152px, which rendered the ported screens ~4% narrow).
          Mobile bottom padding clears the floating tab-bar + safe area. */}
      <main className="mx-auto max-w-[1200px] px-4 py-6 pb-[calc(104px+env(safe-area-inset-bottom,0px))] lg:px-6 lg:pb-8">
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        isKeyboardOpen={isKeyboardOpen}
        referralEnabled={referralEnabled}
        wheelEnabled={wheelEnabled}
      />
    </div>
  );
}
