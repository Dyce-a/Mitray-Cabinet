import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePlatform } from '@/platform';
import { copyToClipboard } from '@/utils/clipboard';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth';
import { displayName } from '../utils/displayName';
import { authApi } from '../api/auth';
import { isValidEmail } from '../utils/validation';
import {
  notificationsApi,
  NotificationSettings,
  NotificationSettingsUpdate,
} from '../api/notifications';
import { referralApi } from '../api/referral';
import { brandingApi, type EmailAuthEnabled } from '../api/branding';
import { UI } from '../config/constants';
import { cn } from '@/lib/utils';
import '../styles/profile.css';

// Prototype-style pill toggle (replaces the Radix Switch).
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn('switch', checked && 'on')}
      onClick={() => onChange(!checked)}
    />
  );
}

const IcCheck = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12l5 5 9-11" />
  </svg>
);

export default function Profile() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const queryClient = useQueryClient();

  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    // Double rAF: with a warm query cache the page renders in its first frame
    // and a single rAF fires BEFORE that frame paints — .in would land in the
    // initial paint and the stagger would have nothing to animate from.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setRevealed(true));
    });
    const fallback = setTimeout(() => setRevealed(true), 90);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(fallback);
    };
  }, []);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<'bot' | 'cabinet' | null>(null);

  // Inline email change flow
  const [changeEmailStep, setChangeEmailStep] = useState<'email' | 'code' | 'success' | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [changeCode, setChangeCode] = useState('');
  const [changeError, setChangeError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [verificationResendCooldown, setVerificationResendCooldown] = useState(0);
  const newEmailInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Referral data
  const { data: referralInfo } = useQuery({
    queryKey: ['referral-info'],
    queryFn: referralApi.getReferralInfo,
  });

  const { data: referralTerms } = useQuery({
    queryKey: ['referral-terms'],
    queryFn: referralApi.getReferralTerms,
  });

  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: brandingApi.getBranding,
    staleTime: 60000,
  });

  // Check if email auth is enabled
  const { data: emailAuthConfig } = useQuery<EmailAuthEnabled>({
    queryKey: ['email-auth-enabled'],
    queryFn: brandingApi.getEmailAuthEnabled,
    staleTime: 60000,
  });
  const isEmailAuthEnabled = emailAuthConfig?.enabled ?? true;
  const isEmailVerificationEnabled = emailAuthConfig?.verification_enabled ?? true;

  // Referral links: bot deep-link + cabinet registration link
  const referralLink = referralInfo?.referral_code
    ? `${window.location.origin}/login?ref=${referralInfo.referral_code}`
    : '';
  const botReferralLink = referralInfo?.bot_referral_link || '';

  const copyLink = (link: string, type: 'bot' | 'cabinet') => {
    if (!link) return;
    void copyToClipboard(link);
    setCopiedLink(type);
    setTimeout(() => setCopiedLink((cur) => (cur === type ? null : cur)), 2000);
  };

  const shareLink = (link: string) => {
    if (!link) return;
    const shareText = t('referral.shareMessage', {
      percent: referralInfo?.commission_percent || 0,
      botName: branding?.name || import.meta.env.VITE_APP_NAME || 'Cabinet',
    });

    if (navigator.share) {
      navigator
        .share({
          title: t('referral.title'),
          text: shareText,
          url: link,
        })
        .catch(() => {});
      return;
    }

    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;
    openTelegramLink(telegramUrl);
  };

  const resendVerificationMutation = useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: () => {
      setSuccess(t('profile.verificationResent'));
      setError(null);
      setVerificationResendCooldown(UI.RESEND_COOLDOWN_SEC);
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      setError(err.response?.data?.detail || t('common.error'));
      setSuccess(null);
    },
  });

  // Email change mutations
  const requestEmailChangeMutation = useMutation({
    mutationFn: (emailAddr: string) => authApi.requestEmailChange(emailAddr),
    onSuccess: async (data) => {
      setChangeError(null);
      if (data.expires_in_minutes === 0) {
        // Unverified email was replaced directly
        setChangeEmailStep('success');
        const updatedUser = await authApi.getMe();
        setUser(updatedUser);
      } else {
        setChangeEmailStep('code');
        setResendCooldown(UI.RESEND_COOLDOWN_SEC);
      }
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      const detail = err.response?.data?.detail;
      if (detail?.includes('already registered') || detail?.includes('already in use')) {
        setChangeError(t('profile.changeEmail.emailAlreadyUsed'));
      } else if (detail?.includes('same as current')) {
        setChangeError(t('profile.changeEmail.sameEmail'));
      } else if (detail?.includes('rate limit') || detail?.includes('too many')) {
        setChangeError(t('profile.changeEmail.tooManyRequests'));
      } else {
        setChangeError(detail || t('common.error'));
      }
    },
  });

  const verifyEmailChangeMutation = useMutation({
    mutationFn: (verificationCode: string) => authApi.verifyEmailChange(verificationCode),
    onSuccess: async () => {
      setChangeError(null);
      setChangeEmailStep('success');
      const updatedUser = await authApi.getMe();
      setUser(updatedUser);
      // Note: auth user lives in the zustand store, not in React Query —
      // the explicit setUser above IS the refresh. No ['user'] query exists.
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      const detail = err.response?.data?.detail;
      if (detail?.includes('invalid') || detail?.includes('wrong')) {
        setChangeError(t('profile.changeEmail.invalidCode'));
      } else if (detail?.includes('expired')) {
        setChangeError(t('profile.changeEmail.codeExpired'));
      } else {
        setChangeError(detail || t('common.error'));
      }
    },
  });

  // Resend cooldown timers
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (verificationResendCooldown <= 0) return;
    const timer = setInterval(() => {
      setVerificationResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [verificationResendCooldown]);

  // Auto-focus inputs on step change (skip on Telegram — keyboard hides bottom nav)
  const { platform: profilePlatform, openTelegramLink } = usePlatform();
  useEffect(() => {
    if (profilePlatform === 'telegram') return;
    const timer = setTimeout(() => {
      if (changeEmailStep === 'email') newEmailInputRef.current?.focus();
      else if (changeEmailStep === 'code') codeInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [changeEmailStep, profilePlatform]);

  // Auto-close success after 3s
  useEffect(() => {
    if (changeEmailStep !== 'success') return;
    const timer = setTimeout(() => resetChangeEmail(), 3000);
    return () => clearTimeout(timer);
  }, [changeEmailStep]);

  const resetChangeEmail = () => {
    setChangeEmailStep(null);
    setNewEmail('');
    setChangeCode('');
    setChangeError(null);
    setResendCooldown(0);
  };

  const handleSendChangeCode = () => {
    setChangeError(null);
    if (!newEmail.trim()) {
      setChangeError(t('profile.emailRequired'));
      return;
    }
    if (!isValidEmail(newEmail.trim())) {
      setChangeError(t('profile.invalidEmail'));
      return;
    }
    if (user?.email && newEmail.toLowerCase().trim() === user.email.toLowerCase()) {
      setChangeError(t('profile.changeEmail.sameEmail'));
      return;
    }
    requestEmailChangeMutation.mutate(newEmail.trim());
  };

  const handleVerifyChangeCode = () => {
    setChangeError(null);
    if (!changeCode.trim()) {
      setChangeError(t('profile.changeEmail.enterCode'));
      return;
    }
    if (changeCode.trim().length < 4) {
      setChangeError(t('profile.changeEmail.invalidCode'));
      return;
    }
    verifyEmailChangeMutation.mutate(changeCode.trim());
  };

  const handleResendChangeCode = () => {
    if (resendCooldown > 0) return;
    requestEmailChangeMutation.mutate(newEmail.trim());
  };

  const { data: notificationSettings, isLoading: notificationsLoading } = useQuery({
    queryKey: ['notification-settings'],
    queryFn: notificationsApi.getSettings,
  });

  const updateNotificationsMutation = useMutation({
    mutationFn: notificationsApi.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-settings'] });
    },
  });

  const handleNotificationToggle = (key: keyof NotificationSettings, value: boolean) => {
    const update: NotificationSettingsUpdate = { [key]: value };
    updateNotificationsMutation.mutate(update);
  };

  const handleNotificationValue = (key: keyof NotificationSettings, value: number) => {
    const update: NotificationSettingsUpdate = { [key]: value };
    updateNotificationsMutation.mutate(update);
  };

  const registeredAt = user?.created_at ? new Date(user.created_at).toLocaleDateString() : '-';

  return (
    <div className={cn('mitray-profile', revealed && 'in')}>
      <div className="phead reveal d1">
        <h1>{t('profile.title')}</h1>
      </div>

      <div className="prof-grid">
        {/* LEFT */}
        <div className="col">
          {/* Account info */}
          <div className="card reveal d1">
            <div className="card-h">
              <div className="t">{t('profile.accountInfo')}</div>
            </div>
            {user?.telegram_id != null && (
              <div className="info-row">
                <span className="k">{t('profile.telegramId')}</span>
                <span className="v">{user.telegram_id}</span>
              </div>
            )}
            {user?.username && (
              <div className="info-row">
                <span className="k">{t('profile.username')}</span>
                <span className="v">@{user.username}</span>
              </div>
            )}
            <div className="info-row">
              <span className="k">{t('profile.name')}</span>
              <span className="v">{displayName(user)}</span>
            </div>
            <div className="info-row">
              <span className="k">{t('profile.registeredAt')}</span>
              <span className="v">{registeredAt}</span>
            </div>
          </div>

          {/* Linked accounts */}
          <div className="card reveal d2">
            <div className="card-h">
              <div className="t">{t('profile.accounts.goToAccounts')}</div>
              <Link to="/profile/accounts" className="lnk">
                {t('profile.accounts.manageAll', 'Все аккаунты')}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </div>

            {/* Telegram */}
            <div className="acc">
              <span className="ai">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="11" fill="#229ED9" />
                  <path
                    d="M5.5 11.8l11-4.3c.5-.18.95.12.78.9l-1.87 8.8c-.13.6-.5.74-1 .46l-2.77-2.04-1.34 1.29c-.15.15-.27.27-.55.27l.2-2.83 5.16-4.66c.22-.2-.05-.31-.35-.11l-6.38 4.02-2.75-.86c-.6-.19-.6-.6.13-.89z"
                    fill="#fff"
                  />
                </svg>
              </span>
              <div className="an">
                <b>Telegram</b>
                <p>{user?.telegram_id ?? t('profile.notLinked', 'не привязан')}</p>
              </div>
              {user?.telegram_id != null ? (
                <span className="linked">
                  <IcCheck />
                  {t('profile.linked', 'Привязан')}
                </span>
              ) : (
                <button className="bind" onClick={() => navigate('/profile/accounts')}>
                  {t('profile.link', 'Привязать')}
                </button>
              )}
            </div>

            {/* Email */}
            <div className="acc">
              <span className="ai">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--muted)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M3 7l9 6 9-6" />
                </svg>
              </span>
              <div className="an">
                <b>Email</b>
                <p>{user?.email || t('profile.notLinked', 'не привязан')}</p>
              </div>
              {user?.email ? (
                user.email_verified || !isEmailVerificationEnabled ? (
                  <span className="linked">
                    <IcCheck />
                    {t('profile.linked', 'Привязан')}
                  </span>
                ) : (
                  <span className="linked warn">{t('profile.notVerified')}</span>
                )
              ) : (
                <button className="bind" onClick={() => navigate('/profile/accounts')}>
                  {t('profile.link', 'Привязать')}
                </button>
              )}
            </div>
          </div>

          {/* Email management (verify / change) */}
          {isEmailAuthEnabled && (
            <div className="card reveal d3">
              <div className="card-h">
                <div className="t">{t('profile.emailAuth')}</div>
              </div>

              {user?.email ? (
                <>
                  <div className="info-row">
                    <span className="k">Email</span>
                    <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {user.email}
                      {user.email_verified ? (
                        <span className="badge-v ok">{t('profile.verified')}</span>
                      ) : isEmailVerificationEnabled ? (
                        <span className="badge-v warn">{t('profile.notVerified')}</span>
                      ) : null}
                    </span>
                  </div>

                  {!user.email_verified && isEmailVerificationEnabled && (
                    <div className="pf-box warn">
                      <p style={{ marginBottom: 12 }}>{t('profile.verificationRequired')}</p>
                      <div className="pf-actions" style={{ marginTop: 0 }}>
                        <button
                          className="pf-btn"
                          onClick={() => resendVerificationMutation.mutate()}
                          disabled={
                            resendVerificationMutation.isPending || verificationResendCooldown > 0
                          }
                        >
                          {verificationResendCooldown > 0
                            ? t('profile.resendIn', { seconds: verificationResendCooldown })
                            : t('profile.resendVerification')}
                        </button>
                        <button className="pf-link" onClick={() => setChangeEmailStep('email')}>
                          {t('profile.changeEmail.button')}
                        </button>
                      </div>
                    </div>
                  )}

                  {user.email_verified && changeEmailStep === null && (
                    <div className="pf-actions">
                      <span className="pf-hint">{t('profile.canLoginWithEmail')}</span>
                      <button className="pf-link" onClick={() => setChangeEmailStep('email')}>
                        {t('profile.changeEmail.button')}
                      </button>
                    </div>
                  )}

                  {/* Inline change flow */}
                  {changeEmailStep === 'email' && (
                    <div className="pf-field">
                      <label className="pf-label">{t('profile.changeEmail.newEmail')}</label>
                      <input
                        ref={newEmailInputRef}
                        type="email"
                        className="pf-input"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSendChangeCode();
                          }
                        }}
                        placeholder="new@email.com"
                        autoComplete="email"
                      />
                      {changeError && <p className="pf-err">{changeError}</p>}
                      <div className="pf-actions">
                        <button
                          className="pf-btn"
                          onClick={handleSendChangeCode}
                          disabled={!newEmail.trim() || requestEmailChangeMutation.isPending}
                        >
                          {t('profile.changeEmail.sendCode')}
                        </button>
                        <button className="pf-link muted" onClick={resetChangeEmail}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  )}

                  {changeEmailStep === 'code' && (
                    <div className="pf-field">
                      <div className="pf-box accent" style={{ marginTop: 0, marginBottom: 12 }}>
                        {t('profile.changeEmail.codeSentTo', { email: newEmail })}
                      </div>
                      <label className="pf-label">
                        {t('profile.changeEmail.verificationCode')}
                      </label>
                      <input
                        ref={codeInputRef}
                        type="text"
                        inputMode="numeric"
                        className="pf-input code"
                        value={changeCode}
                        onChange={(e) => setChangeCode(e.target.value.replace(/\D/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleVerifyChangeCode();
                          }
                        }}
                        placeholder="000000"
                        maxLength={6}
                        autoComplete="one-time-code"
                      />
                      {changeError && <p className="pf-err">{changeError}</p>}
                      <div className="pf-actions" style={{ justifyContent: 'space-between' }}>
                        <div className="pf-actions" style={{ marginTop: 0 }}>
                          <button
                            className="pf-btn"
                            onClick={handleVerifyChangeCode}
                            disabled={!changeCode.trim() || verifyEmailChangeMutation.isPending}
                          >
                            {t('profile.changeEmail.verify')}
                          </button>
                          <button
                            className="pf-link muted"
                            onClick={() => {
                              setChangeEmailStep('email');
                              setChangeCode('');
                              setChangeError(null);
                            }}
                          >
                            {t('common.back')}
                          </button>
                        </div>
                        <button
                          className="pf-link"
                          onClick={handleResendChangeCode}
                          disabled={resendCooldown > 0 || requestEmailChangeMutation.isPending}
                        >
                          {resendCooldown > 0
                            ? t('profile.changeEmail.resendIn', { seconds: resendCooldown })
                            : t('profile.changeEmail.resendCode')}
                        </button>
                      </div>
                    </div>
                  )}

                  {changeEmailStep === 'success' && (
                    <div
                      className="pf-box ok"
                      style={{ display: 'flex', gap: 12, alignItems: 'center' }}
                    >
                      <IcCheck />
                      <div>
                        <p style={{ fontWeight: 600 }}>{t('profile.changeEmail.success')}</p>
                        <p style={{ color: 'var(--muted)' }}>{newEmail}</p>
                      </div>
                    </div>
                  )}

                  {error && <div className="pf-box err">{error}</div>}
                  {success && <div className="pf-box ok">{success}</div>}
                </>
              ) : (
                <>
                  <p className="pf-hint">{t('profile.linkEmailDescription')}</p>
                  <div className="pf-actions">
                    <button className="pf-btn" onClick={() => navigate('/profile/accounts')}>
                      {t('profile.linkEmail')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div className="col">
          {/* Referral links — bot deep-link + web cabinet */}
          {referralTerms?.is_enabled && (referralLink || botReferralLink) && (
            <div className="card reveal d3">
              <div className="card-h">
                <div className="t">{t('referral.yourLink')}</div>
                <Link to="/referral" className="lnk">
                  {t('referral.title')}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Link>
              </div>

              {botReferralLink && (
                <div className="ref-block">
                  <span className="ref-cap">{t('referral.botLink', 'Телеграм-бот')}</span>
                  <div className="ref-row">
                    <div className="lnk-field">{botReferralLink}</div>
                    <button
                      className={cn('copy-btn', copiedLink === 'bot' && 'ok')}
                      onClick={() => copyLink(botReferralLink, 'bot')}
                    >
                      {copiedLink === 'bot' ? (
                        <IcCheck />
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="9" y="9" width="11" height="11" rx="2.2" />
                          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                        </svg>
                      )}
                      <span className="copy-label">
                        {copiedLink === 'bot' ? t('referral.copied') : t('referral.copyLink')}
                      </span>
                    </button>
                    <button
                      className="ico-btn"
                      onClick={() => shareLink(botReferralLink)}
                      title={t('referral.shareButton')}
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 16V4M8 8l4-4 4 4M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {referralLink && (
                <div className="ref-block">
                  <span className="ref-cap">{t('referral.cabinetLink', 'Веб-кабинет')}</span>
                  <div className="ref-row">
                    <div className="lnk-field">{referralLink}</div>
                    <button
                      className={cn('copy-btn', copiedLink === 'cabinet' && 'ok')}
                      onClick={() => copyLink(referralLink, 'cabinet')}
                    >
                      {copiedLink === 'cabinet' ? (
                        <IcCheck />
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="9" y="9" width="11" height="11" rx="2.2" />
                          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                        </svg>
                      )}
                      <span className="copy-label">
                        {copiedLink === 'cabinet' ? t('referral.copied') : t('referral.copyLink')}
                      </span>
                    </button>
                    <button
                      className="ico-btn"
                      onClick={() => shareLink(referralLink)}
                      title={t('referral.shareButton')}
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 16V4M8 8l4-4 4 4M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              <p className="ref-note">
                {t('referral.shareHint', { percent: referralInfo?.commission_percent || 0 })}
              </p>
            </div>
          )}

          {/* Notification settings */}
          <div className="card reveal d4">
            <div className="card-h">
              <div className="t">{t('profile.notifications.title')}</div>
            </div>

            {notificationsLoading ? (
              <div className="pf-loader">
                <div className="pf-spin" />
              </div>
            ) : notificationSettings ? (
              <>
                {/* Subscription expiry */}
                <div className="nset">
                  <div className="nt">
                    <b>{t('profile.notifications.subscriptionExpiry')}</b>
                    <p>{t('profile.notifications.subscriptionExpiryDesc')}</p>
                  </div>
                  <div className="nright">
                    {notificationSettings.subscription_expiry_enabled && (
                      <select
                        className="sel"
                        value={notificationSettings.subscription_expiry_days}
                        onChange={(e) =>
                          handleNotificationValue(
                            'subscription_expiry_days',
                            Number(e.target.value),
                          )
                        }
                      >
                        {[1, 2, 3, 5, 7, 14].map((d) => (
                          <option key={d} value={d}>
                            {t('profile.notifications.daysValue', '{{count}} дн.', { count: d })}
                          </option>
                        ))}
                      </select>
                    )}
                    <Toggle
                      checked={notificationSettings.subscription_expiry_enabled}
                      onChange={(v) => handleNotificationToggle('subscription_expiry_enabled', v)}
                    />
                  </div>
                </div>

                {/* Traffic warning */}
                <div className="nset">
                  <div className="nt">
                    <b>{t('profile.notifications.trafficWarning')}</b>
                    <p>{t('profile.notifications.trafficWarningDesc')}</p>
                  </div>
                  <div className="nright">
                    {notificationSettings.traffic_warning_enabled && (
                      <select
                        className="sel"
                        value={notificationSettings.traffic_warning_percent}
                        onChange={(e) =>
                          handleNotificationValue('traffic_warning_percent', Number(e.target.value))
                        }
                      >
                        {[50, 70, 80, 90, 95].map((p) => (
                          <option key={p} value={p}>
                            {p}%
                          </option>
                        ))}
                      </select>
                    )}
                    <Toggle
                      checked={notificationSettings.traffic_warning_enabled}
                      onChange={(v) => handleNotificationToggle('traffic_warning_enabled', v)}
                    />
                  </div>
                </div>

                {/* Balance low */}
                <div className="nset">
                  <div className="nt">
                    <b>{t('profile.notifications.balanceLow')}</b>
                    <p>{t('profile.notifications.balanceLowDesc')}</p>
                  </div>
                  <div className="nright">
                    {notificationSettings.balance_low_enabled && (
                      <input
                        type="number"
                        className="sel"
                        style={{ backgroundImage: 'none', paddingRight: 12, width: 96 }}
                        value={notificationSettings.balance_low_threshold}
                        min={0}
                        onChange={(e) =>
                          handleNotificationValue('balance_low_threshold', Number(e.target.value))
                        }
                      />
                    )}
                    <Toggle
                      checked={notificationSettings.balance_low_enabled}
                      onChange={(v) => handleNotificationToggle('balance_low_enabled', v)}
                    />
                  </div>
                </div>

                {/* News */}
                <div className="nset">
                  <div className="nt">
                    <b>{t('profile.notifications.news')}</b>
                    <p>{t('profile.notifications.newsDesc')}</p>
                  </div>
                  <div className="nright">
                    <Toggle
                      checked={notificationSettings.news_enabled}
                      onChange={(v) => handleNotificationToggle('news_enabled', v)}
                    />
                  </div>
                </div>

                {/* Promo offers */}
                <div className="nset">
                  <div className="nt">
                    <b>{t('profile.notifications.promoOffers')}</b>
                    <p>{t('profile.notifications.promoOffersDesc')}</p>
                  </div>
                  <div className="nright">
                    <Toggle
                      checked={notificationSettings.promo_offers_enabled}
                      onChange={(v) => handleNotificationToggle('promo_offers_enabled', v)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <p className="pf-hint">{t('profile.notifications.unavailable')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
