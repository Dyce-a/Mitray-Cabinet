import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { isAxiosError } from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/auth';
import { usePlatform } from '../../platform';
import { getPendingCampaignSlug } from '../../utils/campaign';

/**
 * Compact Telegram login matching the redesign prototype: a "Login via Telegram"
 * pill + a QR button. Both drive the same backend deep-link web-auth flow used
 * by TelegramLoginButton's fallback (requestDeepLinkToken + loginWithDeepLink
 * polling): the pill opens the bot on the current device, the QR is for scanning
 * from a phone. Kept as a separate component so the redesign stays mergeable and
 * the heavy widget/iframe UI isn't pulled into the card.
 */
const POLL_MS = 2500;

const TgIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
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

export default function TelegramAuthCompact() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openTelegramLink } = usePlatform();
  const loginWithDeepLink = useAuthStore((s) => s.loginWithDeepLink);

  const [showQR, setShowQR] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const tokenRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expireRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const campaignRef = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
      if (expireRef.current) clearTimeout(expireRef.current);
    };
  }, []);

  const poll = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !mounted.current || inFlight.current) return;
    inFlight.current = true;
    try {
      await loginWithDeepLink(token, campaignRef.current);
      if (expireRef.current) clearTimeout(expireRef.current);
      if (mounted.current) navigate('/');
    } catch (err) {
      if (!mounted.current) return;
      if (isAxiosError(err)) {
        if (err.response?.status === 202) {
          pollRef.current = setTimeout(poll, POLL_MS);
          return;
        }
        if (err.response?.status === 410) {
          tokenRef.current = null;
          setUrl('');
          setError(t('auth.deepLinkExpired', 'Ссылка устарела, попробуйте ещё раз'));
          return;
        }
      }
      setError(t('common.error'));
    } finally {
      inFlight.current = false;
    }
  }, [loginWithDeepLink, navigate, t]);

  // Request a web-auth token (once) and start polling for confirmation.
  const ensureToken = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return url;
    setLoading(true);
    setError('');
    try {
      campaignRef.current = getPendingCampaignSlug();
      const res = await authApi.requestDeepLinkToken();
      tokenRef.current = res.token;
      const link = `https://t.me/${res.bot_username}?start=webauth_${res.token}`;
      setUrl(link);
      pollRef.current = setTimeout(poll, POLL_MS);
      expireRef.current = setTimeout(
        () => {
          if (!useAuthStore.getState().isAuthenticated) {
            tokenRef.current = null;
            setUrl('');
            setError(t('auth.deepLinkExpired', 'Ссылка устарела, попробуйте ещё раз'));
          }
        },
        (res.expires_in || 300) * 1000,
      );
      return link;
    } catch {
      setError(t('common.error'));
      return '';
    } finally {
      setLoading(false);
    }
  }, [poll, t, url]);

  // Resume polling immediately when the user returns to the tab.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (!tokenRef.current || inFlight.current) return;
      if (pollRef.current) clearTimeout(pollRef.current);
      poll();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [poll]);

  const onPill = async () => {
    const link = await ensureToken();
    if (link) openTelegramLink(link);
  };

  const onQR = async () => {
    if (!showQR) await ensureToken();
    setShowQR((v) => !v);
  };

  return (
    <>
      <div className="tg-row">
        <button className="fbtn fbtn-tg" type="button" onClick={onPill} disabled={loading}>
          <TgIcon />
          <span>{t('auth.loginWithTelegram', 'Войти через Telegram')}</span>
        </button>
        <div className="cqr-wrap">
          <button
            className={showQR ? 'cqr on' : 'cqr'}
            type="button"
            onClick={onQR}
            aria-label={t('auth.scanQrToLogin', 'QR-код для входа')}
          >
            <QrIcon />
          </button>
          <div className={showQR ? 'cqr-pop show' : 'cqr-pop'}>
            <div style={{ background: '#fff', padding: 10, borderRadius: 12, lineHeight: 0 }}>
              {url ? (
                <QRCodeSVG value={url} size={132} level="M" />
              ) : (
                <div
                  style={{
                    width: 132,
                    height: 132,
                    display: 'grid',
                    placeItems: 'center',
                    color: '#0c0c12',
                    fontSize: 12,
                  }}
                >
                  …
                </div>
              )}
            </div>
            <div className="qr-cap">Отсканируйте камерой Telegram</div>
          </div>
        </div>
      </div>
      {error && (
        <div className="err" style={{ marginTop: 10, marginBottom: 0 }}>
          {error}
        </div>
      )}
    </>
  );
}
