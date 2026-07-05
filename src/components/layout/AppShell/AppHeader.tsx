import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { initDataUser } from '@telegram-apps/sdk-react';

import { useAuthStore } from '@/store/auth';
import { displayName } from '@/utils/displayName';
import { useShallow } from 'zustand/shallow';
import { useTheme } from '@/hooks/useTheme';
import { useBranding } from '@/hooks/useBranding';
import { usePlatform } from '@/platform';
import { themeColorsApi } from '@/api/themeColors';
import { cn } from '@/lib/utils';

import LanguageSwitcher from '@/components/LanguageSwitcher';
import TicketNotificationBell from '@/components/TicketNotificationBell';

// Icons
import {
  HomeIcon,
  SubscriptionIcon,
  CreditCardIcon,
  UsersIcon,
  ChatIcon,
  UserIcon,
  LogoutIcon,
  GamepadIcon,
  ClipboardIcon,
  InfoIcon,
  ShieldIcon,
  WheelIcon,
  GiftIcon,
  MenuIcon,
  CloseIcon,
  SunIcon,
  MoonIcon,
} from '@/components/icons';

import type { TelegramPlatform } from '@/hooks/useTelegramSDK';

interface AppHeaderProps {
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  onCommandPaletteOpen: () => void;
  headerHeight: number;
  isFullscreen: boolean;
  safeAreaInset: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset: { top: number; bottom: number; left: number; right: number };
  telegramPlatform?: TelegramPlatform;
  wheelEnabled?: boolean;
  referralEnabled?: boolean;
  hasContests?: boolean;
  hasPolls?: boolean;
  giftEnabled?: boolean;
}

export function AppHeader({
  mobileMenuOpen,
  setMobileMenuOpen,
  isFullscreen,
  safeAreaInset,
  contentSafeAreaInset,
  telegramPlatform,
  wheelEnabled,
  referralEnabled,
  hasContests,
  hasPolls,
  giftEnabled,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, logout, isAdmin } = useAuthStore(
    useShallow((state) => ({ user: state.user, logout: state.logout, isAdmin: state.isAdmin })),
  );
  const { toggleTheme, isDark } = useTheme();
  const { haptic } = usePlatform();
  const { appName } = useBranding();
  const [userPhotoUrl, setUserPhotoUrl] = useState<string | null>(null);

  // Theme toggle visibility
  const { data: enabledThemes } = useQuery({
    queryKey: ['enabled-themes'],
    queryFn: themeColorsApi.getEnabledThemes,
    staleTime: 1000 * 60 * 5,
  });
  const canToggle = enabledThemes?.dark && enabledThemes?.light;

  // Get user photo from Telegram
  useEffect(() => {
    try {
      const tgUser = initDataUser();
      if (tgUser?.photo_url) setUserPhotoUrl(tgUser.photo_url);
    } catch {
      // Not in Telegram or init data not available
    }
  }, []);

  // Lock scroll when drawer is open (works in iframe/Telegram Mini App)
  useEffect(() => {
    if (!mobileMenuOpen) return;

    const preventDefault = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.m-drawer')) return; // allow scrolling inside the drawer
      e.preventDefault();
    };

    document.addEventListener('touchmove', preventDefault, { passive: false });
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('touchmove', preventDefault);
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };
  const isAdminActive = () => location.pathname.startsWith('/admin');
  const closeMenu = () => setMobileMenuOpen(false);

  // Telegram fullscreen top inset — the drawer covers the full height, so its
  // top row must clear the native TG header too (env() insets are 0 in TG).
  const tgTopPad = isFullscreen
    ? Math.max(safeAreaInset.top, contentSafeAreaInset.top) +
      (telegramPlatform === 'android' ? 48 : 45)
    : 0;

  // Primary drawer nav — feature-flagged extras follow the core six.
  const primaryNav = [
    { path: '/', label: t('nav.dashboard'), icon: HomeIcon },
    { path: '/subscriptions', label: t('nav.subscription'), icon: SubscriptionIcon },
    { path: '/balance', label: t('nav.balance'), icon: CreditCardIcon },
    ...(referralEnabled ? [{ path: '/referral', label: t('nav.referral'), icon: UsersIcon }] : []),
    { path: '/support', label: t('nav.support'), icon: ChatIcon },
    { path: '/info', label: t('nav.info'), icon: InfoIcon },
    ...(wheelEnabled ? [{ path: '/wheel', label: t('nav.wheel'), icon: WheelIcon }] : []),
    ...(giftEnabled ? [{ path: '/gift', label: t('nav.gift'), icon: GiftIcon }] : []),
    ...(hasContests ? [{ path: '/contests', label: t('nav.contests'), icon: GamepadIcon }] : []),
    ...(hasPolls ? [{ path: '/polls', label: t('nav.polls'), icon: ClipboardIcon }] : []),
  ];

  const userInitial = (displayName(user) || 'U').trim().charAt(0).toUpperCase();

  return (
    <>
      {/* Mobile header — sticky logo + burger. Everything secondary lives in
          the drawer (see mobile-shell.css). */}
      <header className="m-header lg:hidden" style={{ paddingTop: tgTopPad || undefined }}>
        <div className="hbar">
          <Link to="/" onClick={closeMenu} aria-label={appName || 'Mitray VPN'}>
            <svg className="brand-logo" viewBox="0 0 600 320" aria-label="Mitray VPN">
              <text className="bl1" x="300" y="150" textAnchor="middle" fontSize="150">
                Mitray
              </text>
              <text className="bl2" x="304" y="286" textAnchor="middle" fontSize="120">
                VPN
              </text>
            </svg>
          </Link>
          <div className="hsp" />
          <button
            onClick={() => {
              haptic.impact('light');
              setMobileMenuOpen(!mobileMenuOpen);
            }}
            className="burger"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Scrim */}
      <div
        className={cn('m-scrim lg:hidden', mobileMenuOpen && 'open')}
        onClick={closeMenu}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={cn('m-drawer lg:hidden', mobileMenuOpen && 'open')}
        style={tgTopPad ? { paddingTop: tgTopPad + 14 } : undefined}
        aria-hidden={!mobileMenuOpen}
      >
        {/* Utilities row */}
        <div className="dr-top">
          {canToggle && (
            <button
              className="dr-util"
              onClick={() => {
                haptic.impact('light');
                toggleTheme();
              }}
              title={isDark ? t('theme.light') || 'Light mode' : t('theme.dark') || 'Dark mode'}
              aria-label={
                isDark ? t('theme.light') || 'Light mode' : t('theme.dark') || 'Dark mode'
              }
            >
              {isDark ? (
                <MoonIcon className="h-[17px] w-[17px]" />
              ) : (
                <SunIcon className="h-[17px] w-[17px]" />
              )}
            </button>
          )}
          <TicketNotificationBell isAdmin={isAdminActive()} />
          <LanguageSwitcher />
          <button className="dr-close" onClick={closeMenu} aria-label="Close menu">
            <CloseIcon className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* User */}
        <div className="dr-user">
          {userPhotoUrl ? (
            <img className="av" src={userPhotoUrl} alt="" onError={() => setUserPhotoUrl(null)} />
          ) : (
            <span className="av">{userInitial}</span>
          )}
          <div className="min-w-0">
            <b className="block truncate">{displayName(user)}</b>
            <p className="truncate">@{user?.username || `ID: ${user?.telegram_id}`}</p>
          </div>
        </div>

        {/* Primary nav */}
        <nav className="dr-nav">
          {primaryNav.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={closeMenu}
              className={cn('dr-link', isActive(item.path) && 'on')}
            >
              <item.icon />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Admin */}
        {isAdmin && (
          <>
            <div className="dr-sec">{t('admin.nav.title')}</div>
            <nav className="dr-nav">
              <Link
                to="/admin"
                onClick={closeMenu}
                className={cn('dr-link admin', isAdminActive() && 'on')}
              >
                <ShieldIcon />
                {t('admin.nav.title')}
              </Link>
            </nav>
          </>
        )}

        <div className="dr-div" />

        {/* Profile + logout */}
        <nav className="dr-nav">
          <Link
            to="/profile"
            onClick={closeMenu}
            className={cn('dr-link', isActive('/profile') && 'on')}
          >
            <UserIcon />
            {t('nav.profile')}
          </Link>
          <button
            className="dr-link danger"
            onClick={() => {
              closeMenu();
              logout();
            }}
          >
            <LogoutIcon />
            {t('nav.logout')}
          </button>
        </nav>
      </aside>
    </>
  );
}
