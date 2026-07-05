import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { usePlatform } from '@/platform';

// Icons — match the desktop nav (Sparkle=subscription, CreditCard=balance)
import {
  HomeIcon,
  SubscriptionIcon,
  CreditCardIcon,
  UsersIcon,
  ChatIcon,
  WheelIcon,
} from '@/components/icons';

interface MobileBottomNavProps {
  isKeyboardOpen: boolean;
  referralEnabled?: boolean;
  wheelEnabled?: boolean;
}

export function MobileBottomNav({
  isKeyboardOpen,
  referralEnabled,
  wheelEnabled,
}: MobileBottomNavProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { haptic } = usePlatform();

  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const placedRef = useRef(false);

  // Place the liquid pill over the active tab. offsetLeft/offsetWidth are layout
  // coords — unaffected by the bar's shrink `scale()` — so alignment holds at any
  // scale (same trick as the prototype). `animate=false` snaps instantly.
  const placePill = useCallback((animate: boolean) => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) return;
    const active = nav.querySelector<HTMLElement>('.tab.on');
    if (!active) {
      pill.style.opacity = '0';
      return;
    }
    if (!animate) pill.style.transition = 'none';
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translateX(${active.offsetLeft - pill.offsetLeft}px)`;
    pill.style.opacity = '1';
    if (!animate) {
      void pill.offsetWidth; // flush the instant placement before re-enabling transition
      pill.style.transition = '';
    }
  }, []);

  // Re-place on active-tab change: first placement snaps, later ones slide.
  useLayoutEffect(() => {
    placePill(placedRef.current);
    placedRef.current = true;
  }, [location.pathname, placePill]);

  // Re-place after fonts load (tab widths shift) and on real viewport-width change
  // (mobile URL-bar scroll fires resize with the same width — ignore those).
  useEffect(() => {
    let lastVW = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastVW) return;
      lastVW = window.innerWidth;
      placePill(false);
    };
    window.addEventListener('resize', onResize);
    // fonts.ready alone is not enough: the Google Fonts stylesheet loads async,
    // so on a cold first visit the promise resolves BEFORE Space Grotesk is even
    // registered — the pill gets measured against fallback-font tab widths and
    // sits slightly off until the next navigation. `loadingdone` fires for every
    // font that finishes loading, including late-registered ones.
    const onFontsDone = () => placePill(false);
    if (document.fonts?.ready) document.fonts.ready.then(() => placePill(false));
    document.fonts?.addEventListener?.('loadingdone', onFontsDone);
    return () => {
      window.removeEventListener('resize', onResize);
      document.fonts?.removeEventListener?.('loadingdone', onFontsDone);
    };
  }, [placePill]);

  // Shrink the whole bar when scrolling down, expand near top / on scroll up
  // (mirrors the mobile prototype chassis). rAF-throttled; transform-only.
  const [shrunk, setShrunk] = useState(false);
  const lastY = useRef(0);
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      if (y > 48 && y > lastY.current + 2) setShrunk(true);
      else if (y < lastY.current - 2 || y < 12) setShrunk(false);
      lastY.current = y;
      ticking = false;
    };
    const handler = () => {
      if (!ticking) {
        requestAnimationFrame(onScroll);
        ticking = true;
      }
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  // Core navigation items for bottom bar.
  //
  // Support is ALWAYS present — frustrated paying customers must find help
  // in the primary nav, not in the hamburger drawer. Previously Wheel
  // (a brand-moment surface) displaced Support (a critical-path surface)
  // when the wheel feature flag was on; that trade is hostile to the
  // support-user persona and was flagged by the /impeccable critique.
  //
  // Slot priority when both Wheel and Referral are enabled and only
  // four slots remain after Dashboard / Subscriptions / Balance / Support:
  //   - Wheel wins (operator opted in as a deliberate brand moment)
  //   - Referral falls back to the hamburger drawer
  // When only one of them is enabled, that one fills the slot.
  const coreItems = [
    { path: '/', label: t('nav.dashboard'), icon: HomeIcon },
    { path: '/subscriptions', label: t('nav.subscription'), icon: SubscriptionIcon },
    { path: '/balance', label: t('nav.balance'), icon: CreditCardIcon },
    ...(wheelEnabled
      ? [{ path: '/wheel', label: t('nav.wheel'), icon: WheelIcon }]
      : referralEnabled
        ? [{ path: '/referral', label: t('nav.referral'), icon: UsersIcon }]
        : []),
    { path: '/support', label: t('nav.support'), icon: ChatIcon },
  ];

  const handleNavClick = () => {
    haptic.impact('light');
  };

  return (
    <nav
      ref={navRef}
      className={cn('m-tabbar lg:hidden', shrunk && 'shrink', isKeyboardOpen && 'hide')}
      aria-label={t('nav.dashboard')}
    >
      <span ref={pillRef} className="tab-pill" aria-hidden="true" />
      {coreItems.map((item) => {
        const active = isActive(item.path);
        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={handleNavClick}
            className={cn('tab', active && 'on')}
            aria-label={item.label}
          >
            <item.icon className="relative z-[1] h-[23px] w-[23px]" />
            <span className="tl relative z-[1]">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
