import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useAuthStore } from '../store/auth';
import { useShallow } from 'zustand/shallow';
import { authApi } from '../api/auth';
import { isValidEmail } from '../utils/validation';
import {
  brandingApi,
  getCachedBranding,
  setCachedBranding,
  type BrandingInfo,
  type EmailAuthEnabled,
} from '../api/branding';
import { getAndClearReturnUrl, tokenStorage } from '../utils/token';
import { isInTelegramWebApp, getTelegramInitData, useTelegramSDK } from '../hooks/useTelegramSDK';
import { closeMiniApp } from '@telegram-apps/sdk-react';
import { useTheme } from '../hooks/useTheme';
import LanguageSwitcher from '../components/LanguageSwitcher';
import TelegramAuthCompact from '../components/auth/TelegramAuthCompact';
import OAuthProviderIcon from '../components/OAuthProviderIcon';
import { saveOAuthState } from '../utils/oauth';
import { getPendingReferralCode } from '../utils/referral';
import { INTRO_FLAG, INTRO_FROM_KEY } from '../store/intro';
import { EmailIcon, UsersIcon } from '@/components/icons';
import worldMapSvg from '../components/auth/worldMap.svg?raw';
import russiaHubSvg from '../components/auth/russiaHub.svg?raw';
import '../styles/login.css';

const TgIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6.4 13.5l-4.9-1.5c-1.1-.3-1.1-1 .2-1.5L20.5 3c.9-.3 1.7.2 1.4 1.3z" />
  </svg>
);

const QrIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3M21 14v0M17 21h4M21 17v4" strokeLinecap="round" />
  </svg>
);

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { toggleTheme, isDark } = useTheme();
  const {
    isAuthenticated,
    isLoading: isAuthInitializing,
    loginWithTelegram,
    loginWithEmail,
    registerWithEmail,
  } = useAuthStore(
    useShallow((state) => ({
      isAuthenticated: state.isAuthenticated,
      isLoading: state.isLoading,
      loginWithTelegram: state.loginWithTelegram,
      loginWithEmail: state.loginWithEmail,
      registerWithEmail: state.registerWithEmail,
    })),
  );

  // Referral code captured from ?ref= at module level in auth store
  const referralCode = getPendingReferralCode() || '';

  // ── form state ──
  const [authMode, setAuthMode] = useState<'login' | 'register'>(() =>
    referralCode ? 'register' : 'login',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTelegramWebApp, setIsTelegramWebApp] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordSent, setForgotPasswordSent] = useState(false);
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordError, setForgotPasswordError] = useState('');

  // ── redesign shell state ──
  const [authOpen, setAuthOpen] = useState(false); // landing ⇄ auth card
  const [play, setPlay] = useState(false); // intro animation
  const [showLandingQR, setShowLandingQR] = useState(false);

  // Transient .auth-closing while the card closes: keeps the map's infinite
  // animations paused for the whole close transition too — resuming them
  // mid-transition burned paint every frame and stuttered on big (2K) screens.
  const [authClosing, setAuthClosing] = useState(false);
  const prevAuthOpen = useRef(authOpen);
  const closingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (prevAuthOpen.current && !authOpen) {
      setAuthClosing(true);
      clearTimeout(closingTimer.current);
      closingTimer.current = setTimeout(() => setAuthClosing(false), 950);
    }
    prevAuthOpen.current = authOpen;
  }, [authOpen]);

  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  // Telegram safe area insets
  const { safeAreaInset, contentSafeAreaInset } = useTelegramSDK();
  const safeTop = Math.max(safeAreaInset.top, contentSafeAreaInset.top);
  const safeBottom = Math.max(safeAreaInset.bottom, contentSafeAreaInset.bottom);

  // Return URL after auth
  const getReturnUrl = useCallback(() => {
    const stateFrom = (location.state as { from?: string })?.from;
    if (stateFrom && stateFrom !== '/login') return stateFrom;
    const savedUrl = getAndClearReturnUrl();
    if (savedUrl && savedUrl !== '/login') return savedUrl;
    return '/';
  }, [location.state]);

  // Branding (for document title)
  const cachedBranding = useMemo(() => getCachedBranding(), []);
  const { data: branding } = useQuery<BrandingInfo>({
    queryKey: ['branding'],
    queryFn: async () => {
      const data = await brandingApi.getBranding();
      setCachedBranding(data);
      return data;
    },
    staleTime: 60000,
    initialData: cachedBranding ?? undefined,
    initialDataUpdatedAt: 0,
  });
  const appName = branding?.name || import.meta.env.VITE_APP_NAME || 'Mitray VPN';

  // Email auth enabled?
  const { data: emailAuthConfig } = useQuery<EmailAuthEnabled>({
    queryKey: ['email-auth-enabled'],
    queryFn: brandingApi.getEmailAuthEnabled,
    staleTime: 60000,
  });
  const isEmailAuthEnabled = emailAuthConfig?.enabled ?? true;

  // OAuth providers
  const { data: oauthData } = useQuery({
    queryKey: ['oauth-providers'],
    queryFn: authApi.getOAuthProviders,
    staleTime: 60000,
  });
  const oauthProviders = Array.isArray(oauthData?.providers) ? oauthData.providers : [];

  // Telegram deep link for the landing "open in Telegram" action + QR
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '';
  const botLink = botUsername
    ? referralCode
      ? `https://t.me/${botUsername}?start=${encodeURIComponent(referralCode)}`
      : `https://t.me/${botUsername}`
    : '';

  const handleOAuthLogin = async (provider: string) => {
    setError('');
    setOauthLoading(provider);
    try {
      const { authorize_url, state } = await authApi.getOAuthAuthorizeUrl(provider);
      let parsed: URL;
      try {
        parsed = new URL(authorize_url);
      } catch {
        throw new Error('Invalid OAuth redirect URL');
      }
      if (parsed.protocol !== 'https:') throw new Error('Invalid OAuth redirect URL');
      saveOAuthState(state, provider);
      window.location.href = authorize_url;
    } catch {
      setError(t('auth.oauthError', 'Authorization was denied or failed'));
      setOauthLoading(null);
    }
  };

  // Document title
  useEffect(() => {
    document.title = appName || 'Mitray VPN';
  }, [appName]);

  // ── cinematic exit: fade the login shell, hand the wordmark to IntroLoader ──
  // On successful auth the visible logo's rect is stored so the dashboard intro
  // can FLIP-fly it from where the user last saw it into the loader position;
  // everything else fades out first (.leaving in login.css). Falls back to an
  // instant navigate when the intro won't play (already seen this session,
  // reduced motion, non-dashboard return URL).
  const leavingRef = useRef(false);
  const leaveWithIntro = useCallback(
    (to: string) => {
      if (leavingRef.current) return;
      leavingRef.current = true;

      let introPending = false;
      try {
        introPending = to === '/' && !sessionStorage.getItem(INTRO_FLAG);
      } catch {
        /* private mode */
      }
      const reduce =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const root = document.querySelector<HTMLElement>('.mitray-login');
      const logo = document.querySelector<SVGSVGElement>(
        authOpen ? '.mitray-login .logo-sm' : '.mitray-login .logo',
      );

      if (!introPending || reduce || !root || !logo) {
        navigate(to, { replace: true });
        return;
      }

      const r = logo.getBoundingClientRect();
      try {
        sessionStorage.setItem(
          INTRO_FROM_KEY,
          JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height }),
        );
      } catch {
        /* ignore — intro will just pop in from the centre */
      }
      root.classList.add('leaving');
      window.setTimeout(() => navigate(to, { replace: true }), 420);
    },
    [authOpen, navigate],
  );

  // Redirect once authenticated
  useEffect(() => {
    if (isAuthenticated) leaveWithIntro(getReturnUrl());
  }, [isAuthenticated, leaveWithIntro, getReturnUrl]);

  // Intro animation: start once fonts are ready (with a hard fallback)
  useEffect(() => {
    let done = false;
    const start = () => {
      if (!done) {
        done = true;
        setPlay(true);
      }
    };
    if (document.fonts?.ready) document.fonts.ready.then(() => setTimeout(start, 120));
    const fallback = setTimeout(start, 1500);
    return () => clearTimeout(fallback);
  }, []);

  // Close auth card on Escape
  useEffect(() => {
    if (!authOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAuthOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authOpen]);

  // Telegram WebApp auto-auth on mount (auto-retry on 401)
  useEffect(() => {
    if (isAuthInitializing) return;

    const tryTelegramAuth = async () => {
      const initData = getTelegramInitData();
      if (!isInTelegramWebApp() || !initData) return;

      setIsTelegramWebApp(true);
      setIsLoading(true);
      setAuthOpen(true);

      const MAX_RETRIES = 1;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          await loginWithTelegram(initData);
          leaveWithIntro(getReturnUrl());
          return;
        } catch (err) {
          const error = err as { response?: { status?: number; data?: { detail?: string } } };
          const status = error.response?.status;
          const detail = error.response?.data?.detail;
          if (import.meta.env.DEV)
            console.warn(`Telegram auth attempt ${attempt + 1} failed:`, status, detail);
          if (status === 401 && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          setError(detail || t('auth.telegramRequired'));
        }
      }
      setIsLoading(false);
    };

    tryTelegramAuth();
  }, [isAuthInitializing, loginWithTelegram, leaveWithIntro, t, getReturnUrl]);

  const handleRetryTelegramAuth = () => {
    tokenStorage.clearTokens();
    sessionStorage.removeItem('tapps/launchParams');
    sessionStorage.removeItem('telegram_init_data');
    localStorage.removeItem('cabinet-auth');
    localStorage.removeItem('tg_user_id');
    try {
      closeMiniApp();
    } catch {
      window.location.reload();
    }
  };

  const handleEmailSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !isValidEmail(email.trim())) {
      setError(t('auth.invalidEmail', 'Please enter a valid email address'));
      return;
    }

    if (authMode === 'register') {
      if (password !== confirmPassword) {
        setError(t('auth.passwordMismatch', 'Passwords do not match'));
        return;
      }
      if (password.length < 8) {
        setError(t('auth.passwordTooShort', 'Password must be at least 8 characters'));
        return;
      }
    }

    setIsLoading(true);
    try {
      if (authMode === 'login') {
        await loginWithEmail(email, password);
        leaveWithIntro(getReturnUrl());
      } else {
        const result = await registerWithEmail(
          email,
          password,
          firstName || undefined,
          referralCode || undefined,
        );
        setRegisteredEmail(result.email);
      }
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: { detail?: string } } };
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      if (status === 400 && detail?.includes('already registered')) {
        setError(t('auth.emailAlreadyRegistered', 'This email is already registered'));
      } else if (status === 401 || status === 403) {
        if (detail?.includes('verify your email')) {
          setError(t('auth.emailNotVerified', 'Please verify your email first'));
        } else {
          setError(t('auth.invalidCredentials', 'Invalid email or password'));
        }
      } else if (status === 429) {
        setError(t('auth.tooManyAttempts', 'Too many attempts. Please try again later'));
      } else {
        setError(detail || t('common.error'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setForgotPasswordError('');
    if (!forgotPasswordEmail.trim() || !isValidEmail(forgotPasswordEmail.trim())) {
      setForgotPasswordError(t('auth.invalidEmail', 'Please enter a valid email address'));
      return;
    }
    setForgotPasswordLoading(true);
    try {
      await authApi.forgotPassword(forgotPasswordEmail.trim());
      setForgotPasswordSent(true);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setForgotPasswordError(error.response?.data?.detail || t('common.error'));
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  const closeForgotPassword = () => {
    setShowForgotPassword(false);
    setForgotPasswordEmail('');
    setForgotPasswordSent(false);
    setForgotPasswordError('');
  };

  const replay = () => {
    setPlay(false);
    setTimeout(() => setPlay(true), 30);
  };

  const rootClass = [
    'mitray-login',
    authOpen ? 'auth' : '',
    authClosing ? 'auth-closing' : '',
    play ? 'play' : '',
    authMode === 'register' ? 'mode-register' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClass}
      style={{
        paddingTop: safeTop > 0 ? `${safeTop}px` : undefined,
        paddingBottom: safeBottom > 0 ? `${safeBottom}px` : undefined,
      }}
    >
      {/* ── background ── */}
      <div className="bg" aria-hidden="true">
        <div className="blob b1" />
        <div className="blob b2" />
        {/* Desktop map (EU+Russia) and mobile hub (full-Russia portrait) — CSS
            swaps them per breakpoint (see login.css @media). */}
        <div className="map" dangerouslySetInnerHTML={{ __html: worldMapSvg }} />
        {/* Static pre-blurred twin of the desktop map. Opening the auth card
            crossfades crisp ⇄ blurred via opacity (compositor-only) instead of
            animating filter: blur on the whole bg, which tanked FPS on PC. */}
        <div
          className="map-blur"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: worldMapSvg }}
        />
        <div className="map-hub" dangerouslySetInnerHTML={{ __html: russiaHubSvg }} />
        <div className="veil" />
        {/* Auth-state veil (stronger dim) — opacity crossfade with .veil instead
            of interpolating one gradient into another (full-screen repaint). */}
        <div className="veil-auth" />
      </div>

      {/* ── language switcher ── */}
      <div className="lang-slot">
        <LanguageSwitcher />
      </div>

      {/* ── tools ── */}
      <div className="tools">
        <button
          className="tool"
          onClick={replay}
          title={t('common.retry', 'Повторить')}
          aria-label={t('common.retry', 'Повторить')}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v5h-5" />
          </svg>
        </button>
        <button
          className="tool"
          onClick={toggleTheme}
          title={t('theme.toggle', 'Сменить тему')}
          aria-label={t('theme.toggle', 'Сменить тему')}
        >
          {isDark ? (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
            </svg>
          )}
        </button>
      </div>

      {/* ── stage ── */}
      <main className="stage">
        <svg className="logo" viewBox="0 0 600 320" aria-label="Mitray VPN">
          <text className="l1 stroke" x="300" y="148" textAnchor="middle" fontSize="150">
            Mitray
          </text>
          <text className="l1 fill" x="300" y="148" textAnchor="middle" fontSize="150">
            Mitray
          </text>
          <text className="l2 stroke" x="304" y="286" textAnchor="middle" fontSize="120">
            VPN
          </text>
          <text className="l2 fill" x="304" y="286" textAnchor="middle" fontSize="120">
            VPN
          </text>
        </svg>

        {/* landing */}
        <div className="landing">
          <div className="actions reveal a1">
            {botLink && (
              <a className="btn btn-tg" href={botLink} target="_blank" rel="noopener noreferrer">
                <TgIcon />
                {t('auth.openInTelegram', 'Открыть в Telegram')}
              </a>
            )}
            <div className="cqr-wrap" style={{ position: 'relative' }}>
              <button
                className={showLandingQR ? 'btn btn-qr on' : 'btn btn-qr'}
                onClick={() => setShowLandingQR((v) => !v)}
                aria-label={t('auth.scanQrToLogin', 'QR')}
                type="button"
              >
                <QrIcon />
              </button>
              <div className={showLandingQR ? 'qr-pop show' : 'qr-pop'}>
                <div style={{ background: '#fff', padding: 10, borderRadius: 12, lineHeight: 0 }}>
                  {botLink && <QRCodeSVG value={botLink} size={132} level="M" />}
                </div>
                <div className="qr-cap">Откройте камерой Telegram</div>
              </div>
            </div>
          </div>
          <button className="weblink reveal a2" type="button" onClick={() => setAuthOpen(true)}>
            <span>{t('auth.openWebVersion', 'Открыть веб-версию')}</span>
          </button>
        </div>
      </main>

      {/* auth card */}
      <div className="auth-wrap">
        <div className="auth-col">
          <svg className="logo-sm" viewBox="0 0 600 320" aria-hidden="true">
            <text className="ls1" x="300" y="148" textAnchor="middle" fontSize="150">
              Mitray
            </text>
            <text className="ls2" x="304" y="286" textAnchor="middle" fontSize="120">
              VPN
            </text>
          </svg>
          <section className="auth-card" aria-hidden={!authOpen}>
            <span className="ac-line" />
            <button
              className="back"
              type="button"
              onClick={() => setAuthOpen(false)}
              aria-label={t('common.back', 'Назад')}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>

            {referralCode && isEmailAuthEnabled && !registeredEmail && !showForgotPassword && (
              <div className="st" style={{ marginBottom: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 12,
                    border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                    background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                    color: 'var(--accent)',
                    fontSize: 12.5,
                    fontWeight: 500,
                  }}
                >
                  <UsersIcon className="h-4 w-4" />
                  <span>{t('auth.referralInvite')}</span>
                </div>
              </div>
            )}

            {registeredEmail ? (
              /* ── check email ── */
              <div className="st" style={{ textAlign: 'center' }}>
                <div
                  style={{
                    margin: '4px auto 14px',
                    width: 56,
                    height: 56,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 18,
                    background: 'color-mix(in srgb, var(--flow) 18%, transparent)',
                  }}
                >
                  <span style={{ color: 'var(--flow)', lineHeight: 0 }}>
                    <EmailIcon className="h-7 w-7" />
                  </span>
                </div>
                <h2 className="ac-title">{t('auth.checkEmail', 'Проверьте почту')}</h2>
                <p style={{ color: 'var(--muted)', fontSize: 13.5, marginBottom: 8 }}>
                  {t('auth.verificationSent', 'Мы отправили ссылку для подтверждения на:')}
                </p>
                <p
                  style={{
                    color: 'var(--accent)',
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 18,
                  }}
                >
                  {registeredEmail}
                </p>
                <button
                  className="submit"
                  type="button"
                  onClick={() => {
                    setRegisteredEmail(null);
                    setAuthMode('login');
                  }}
                >
                  {t('auth.backToLogin', 'Назад ко входу')}
                </button>
              </div>
            ) : showForgotPassword ? (
              /* ── forgot password ── */
              <div className="st">
                <h2 className="ac-title">{t('auth.forgotPassword', 'Восстановление пароля')}</h2>
                {forgotPasswordSent ? (
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ color: 'var(--muted)', fontSize: 13.5, marginBottom: 18 }}>
                      {t(
                        'auth.passwordResetSent',
                        'Если аккаунт с такой почтой существует, мы отправили инструкции по сбросу пароля.',
                      )}
                    </p>
                    <button className="submit" type="button" onClick={closeForgotPassword}>
                      {t('common.back', 'Назад')}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword}>
                    <div className="field">
                      <label className="lab">Email</label>
                      <input
                        className="inp"
                        type="email"
                        value={forgotPasswordEmail}
                        onChange={(e) => setForgotPasswordEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoFocus
                      />
                    </div>
                    {forgotPasswordError && <div className="err">{forgotPasswordError}</div>}
                    <button className="submit" type="submit" disabled={forgotPasswordLoading}>
                      {forgotPasswordLoading
                        ? t('common.loading')
                        : t('auth.sendResetLink', 'Отправить ссылку')}
                    </button>
                    <div className="forgot">
                      <button type="button" onClick={closeForgotPassword}>
                        {t('common.back', 'Назад')}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ) : (
              /* ── main auth ── */
              <>
                <h2 className="ac-title st">
                  {authMode === 'register'
                    ? t('auth.register', 'Создание аккаунта')
                    : t('auth.login')}
                </h2>

                {error && <div className="err st">{error}</div>}

                {/* Telegram */}
                <div className="st d1" style={{ marginBottom: 4 }}>
                  {isLoading && isTelegramWebApp ? (
                    <div style={{ textAlign: 'center', padding: '14px 0' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 30,
                          height: 30,
                          border: '2px solid var(--accent)',
                          borderTopColor: 'transparent',
                          borderRadius: '50%',
                          animation: 'ml-spin 0.8s linear infinite',
                        }}
                      />
                      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10 }}>
                        {t('auth.authenticating')}
                      </p>
                    </div>
                  ) : isTelegramWebApp && error ? (
                    <button
                      className="fbtn fbtn-google"
                      type="button"
                      onClick={handleRetryTelegramAuth}
                    >
                      {t('auth.tryAgain')}
                    </button>
                  ) : (
                    <TelegramAuthCompact />
                  )}
                </div>

                {/* OAuth */}
                {oauthProviders.length > 0 && (
                  <>
                    {oauthProviders.map((provider) => (
                      <button
                        key={provider.name}
                        type="button"
                        className="fbtn fbtn-google st d2"
                        onClick={() => handleOAuthLogin(provider.name)}
                        disabled={oauthLoading !== null}
                      >
                        <span className="gbadge">
                          {oauthLoading === provider.name ? (
                            <span
                              style={{
                                width: 14,
                                height: 14,
                                border: '2px solid #888',
                                borderTopColor: 'transparent',
                                borderRadius: '50%',
                                animation: 'ml-spin 0.8s linear infinite',
                              }}
                            />
                          ) : (
                            <OAuthProviderIcon provider={provider.name} className="h-4 w-4" />
                          )}
                        </span>
                        <span>{provider.display_name}</span>
                      </button>
                    ))}
                  </>
                )}

                {/* Email */}
                {isEmailAuthEnabled && (
                  <>
                    <div className="divider st d2">{t('auth.loginWithEmail', 'по почте')}</div>

                    <div className="tabs st d2">
                      <button
                        type="button"
                        className={authMode === 'login' ? 'tab on' : 'tab'}
                        onClick={() => setAuthMode('login')}
                      >
                        {t('auth.login')}
                      </button>
                      <button
                        type="button"
                        className={authMode === 'register' ? 'tab on' : 'tab'}
                        onClick={() => setAuthMode('register')}
                      >
                        {t('auth.register', 'Регистрация')}
                      </button>
                    </div>

                    <form className="st d3" onSubmit={handleEmailSubmit}>
                      <div className="reg-only">
                        <div className="reg-inner">
                          <div className="field">
                            <label className="lab">{t('auth.firstName', 'Имя')}</label>
                            <input
                              className="inp"
                              type="text"
                              autoComplete="given-name"
                              placeholder={t(
                                'auth.firstNamePlaceholder',
                                'Ваше имя (необязательно)',
                              )}
                              value={firstName}
                              onChange={(e) => setFirstName(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="field">
                        <label className="lab">{t('auth.email')}</label>
                        <input
                          className="inp"
                          type="email"
                          autoComplete="email"
                          required
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>

                      <div className="field">
                        <label className="lab">{t('auth.password')}</label>
                        <input
                          className="inp"
                          type="password"
                          autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                          required
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>

                      <div className="reg-only">
                        <div className="reg-inner">
                          <div className="field">
                            <label className="lab">
                              {t('auth.confirmPassword', 'Повторите пароль')}
                            </label>
                            <input
                              className="inp"
                              type="password"
                              autoComplete="new-password"
                              placeholder="••••••••"
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>

                      <button className="submit" type="submit" disabled={isLoading}>
                        {isLoading
                          ? t('common.loading')
                          : authMode === 'login'
                            ? t('auth.login')
                            : t('auth.register', 'Создать аккаунт')}
                      </button>
                    </form>

                    {authMode === 'login' && (
                      <div className="forgot st d4">
                        <button type="button" onClick={() => setShowForgotPassword(true)}>
                          {t('auth.forgotPassword', 'Забыли пароль?')}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
