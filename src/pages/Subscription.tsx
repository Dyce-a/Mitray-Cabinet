import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { subscriptionApi } from '../api/subscription';
import { DEVICE_ALIAS_MAX_LENGTH } from '../constants/devices';
import { WebBackButton } from '../components/WebBackButton';
import { useDestructiveConfirm } from '../platform/hooks/useNativeDialog';
import TrafficProgressBar from '../components/dashboard/TrafficProgressBar';
import { formatTraffic } from '../utils/formatTraffic';
import { copyToClipboard } from '../utils/clipboard';
import { useTheme } from '../hooks/useTheme';
import InsufficientBalancePrompt from '../components/InsufficientBalancePrompt';
import { useCurrency } from '../hooks/useCurrency';
import { useCloseOnSuccessNotification } from '../store/successNotification';
import {
  CopyIcon,
  CheckIcon,
  PauseIcon,
  RefreshIcon,
  DevicesIcon,
  DownloadIcon,
  TrashIcon,
} from '../components/icons';
import { useHaptic } from '../platform';
import { resolveConnectionUrlForUi } from '../utils/connectionLink';
import {
  getErrorMessage,
  getInsufficientBalanceError,
  getFlagEmoji,
} from '../utils/subscriptionHelpers';
import Twemoji from 'react-twemoji';
import { DeviceTopupSheet } from '../components/subscription/sheets/DeviceTopupSheet';
import { DeviceReductionSheet } from '../components/subscription/sheets/DeviceReductionSheet';
import { TrafficTopupSheet } from '../components/subscription/sheets/TrafficTopupSheet';
import { ServerManagementSheet } from '../components/subscription/sheets/ServerManagementSheet';
import { DeleteSubscriptionSheet } from '../components/subscription/sheets/DeleteSubscriptionSheet';
import { cn } from '@/lib/utils';
import '../styles/subscription.css';

const ChevronRight = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** Device icon picked from the reported platform string. */
const DeviceGlyph = ({ platform }: { platform: string }) => {
  const p = (platform || '').toLowerCase();
  const isMobile = /android|ios|iphone|ipad|mobile|phone/.test(p);
  return isMobile ? (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  ) : (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M2 20h20" />
    </svg>
  );
};

/** Isolated countdown so 1s interval doesn't re-render the whole page */
const CountdownTimer = memo(function CountdownTimer({
  endDate,
  isActive,
}: {
  endDate: string;
  isActive: boolean;
}) {
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const endTime = new Date(endDate).getTime();
    const tick = () => {
      const diff = Math.max(0, endTime - Date.now());
      setCountdown({
        days: Math.floor(diff / 86_400_000),
        hours: Math.floor((diff % 86_400_000) / 3_600_000),
        minutes: Math.floor((diff % 3_600_000) / 60_000),
        seconds: Math.floor((diff % 60_000) / 1_000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endDate]);

  const isExpired = !isActive;
  const isUrgent = countdown.days <= 3;

  const formattedDate = new Date(endDate).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  if (isExpired) {
    return (
      <div className="cd expired">
        <div className="days" style={{ color: 'var(--danger)' }}>
          {t('subscription.expired')}
        </div>
      </div>
    );
  }

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className={cn('cd', isUrgent && 'urgent')}>
      {countdown.days > 0 && (
        <div className="days">
          {countdown.days} <small>{t('subscription.daysShort')}</small>
        </div>
      )}
      <div className="clock">
        {pad(countdown.hours)}:{pad(countdown.minutes)}:{pad(countdown.seconds)}
      </div>
      <div className="exp">
        {t('subscription.expiresAt')}: {formattedDate}
      </div>
    </div>
  );
});

export default function Subscription() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { formatAmount, currencySymbol } = useCurrency();
  const navigate = useNavigate();
  const { subscriptionId: subIdParam } = useParams<{ subscriptionId?: string }>();
  const subscriptionId = subIdParam ? parseInt(subIdParam, 10) : undefined;
  const { isDark } = useTheme();
  const haptic = useHaptic();
  const [copied, setCopied] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const destructiveConfirm = useDestructiveConfirm();

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

  // Helper to format price from kopeks
  const formatPrice = (kopeks: number) =>
    kopeks === 0
      ? t('subscription.free', 'Бесплатно')
      : `${formatAmount(kopeks / 100)} ${currencySymbol}`;

  // Device/traffic topup state
  const [showDeviceTopup, setShowDeviceTopup] = useState(false);
  const [devicesToAdd, setDevicesToAdd] = useState(1);
  const [showDeviceReduction, setShowDeviceReduction] = useState(false);
  const [targetDeviceLimit, setTargetDeviceLimit] = useState<number>(1);
  const [showTrafficTopup, setShowTrafficTopup] = useState(false);
  const [selectedTrafficPackage, setSelectedTrafficPackage] = useState<number | null>(null);
  const [showServerManagement, setShowServerManagement] = useState(false);
  const [selectedServersToUpdate, setSelectedServersToUpdate] = useState<string[]>([]);

  // Traffic refresh state
  const [trafficRefreshCooldown, setTrafficRefreshCooldown] = useState(0);

  // Revoke (reissue) cooldown state
  const [revokeCooldown, setRevokeCooldown] = useState(0);
  const [trafficData, setTrafficData] = useState<{
    traffic_used_gb: number;
    traffic_used_percent: number;
    is_unlimited: boolean;
  } | null>(null);

  // Detect multi-tariff mode from cached subscriptions-list
  const { data: multiSubData } = useQuery({
    queryKey: ['subscriptions-list'],
    queryFn: () => subscriptionApi.getSubscriptions(),
    staleTime: 60_000,
  });
  const isMultiTariff = multiSubData?.multi_tariff_enabled ?? false;

  const { data: subscriptionResponse, isLoading } = useQuery({
    queryKey: ['subscription', subscriptionId],
    queryFn: () => subscriptionApi.getSubscription(subscriptionId),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { data: connectionLink, isLoading: isConnectionLinkLoading } = useQuery({
    queryKey: ['connection-link', subscriptionId],
    queryFn: () => subscriptionApi.getConnectionLink(subscriptionId),
    retry: false,
    staleTime: 0,
  });

  // Extract subscription from response (null if no subscription)
  const subscription = subscriptionResponse?.subscription ?? null;
  const displayedConnectionUrl = useMemo(
    () =>
      resolveConnectionUrlForUi({
        mode: connectionLink?.connect_mode,
        happSchemeLink: connectionLink?.happ_scheme_link,
        displayLink: connectionLink?.display_link,
        subscriptionUrl: connectionLink?.subscription_url,
        happCryptLink: connectionLink?.happ_cryptolink,
        happCryptoLink: connectionLink?.happ_crypto_link,
        happLink: connectionLink?.happ_link,
        fallbackUrl: isConnectionLinkLoading ? null : (subscription?.subscription_url ?? null),
      }),
    [
      connectionLink?.connect_mode,
      connectionLink?.display_link,
      connectionLink?.happ_cryptolink,
      connectionLink?.happ_crypto_link,
      connectionLink?.happ_link,
      connectionLink?.happ_scheme_link,
      connectionLink?.subscription_url,
      isConnectionLinkLoading,
      subscription?.subscription_url,
    ],
  );
  const shouldHideConnectionLink =
    subscription?.hide_subscription_link || connectionLink?.hide_link;

  const usedPercent = trafficData?.traffic_used_percent ?? subscription?.traffic_used_percent ?? 0;

  // Purchase options (needed for balance_kopeks in device/traffic/server management)
  const { data: purchaseOptions } = useQuery({
    queryKey: ['purchase-options', subscriptionId],
    queryFn: () => subscriptionApi.getPurchaseOptions(subscriptionId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const isTariffsMode = purchaseOptions?.sales_mode === 'tariffs';

  // Traffic top-up is a per-tariff feature (admin flag `traffic_topup_enabled`).
  // Some tariffs disable it — showing "Докупить трафик" there opens an empty
  // sheet / errors on purchase. Hide the option when the current tariff forbids
  // it (memory cabinet-addon-tariff-error). Classic mode keeps prior behaviour.
  const currentTariff =
    purchaseOptions?.sales_mode === 'tariffs'
      ? purchaseOptions.tariffs.find(
          (tf) => tf.is_current || tf.id === purchaseOptions.current_tariff_id,
        )
      : undefined;
  const trafficTopupAvailable = isTariffsMode
    ? currentTariff?.traffic_topup_enabled === true
    : true;

  const autopayMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      subscriptionApi.updateAutopay(enabled, undefined, subscriptionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription', subscriptionId] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
    },
  });

  // Devices query
  const { data: devicesData, isLoading: devicesLoading } = useQuery({
    queryKey: ['devices', subscriptionId],
    queryFn: () => subscriptionApi.getDevices(subscriptionId),
    enabled: !!subscription,
  });

  // Delete device mutation
  const deleteDeviceMutation = useMutation({
    mutationFn: (hwid: string) => subscriptionApi.deleteDevice(hwid, subscriptionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', subscriptionId] });
    },
  });

  // Delete all devices mutation
  const deleteAllDevicesMutation = useMutation({
    mutationFn: () => subscriptionApi.deleteAllDevices(subscriptionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices', subscriptionId] });
    },
  });

  // Local device alias (rename) state. Only one device can be in edit-mode
  // at a time — `editingDeviceHwid` doubles as both the toggle and the
  // identifier of the row being edited.
  const [editingDeviceHwid, setEditingDeviceHwid] = useState<string | null>(null);
  const [editingDeviceName, setEditingDeviceName] = useState('');

  const renameDeviceMutation = useMutation({
    mutationFn: ({ hwid, name }: { hwid: string; name: string | null }) =>
      subscriptionApi.renameDevice(hwid, name, subscriptionId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['devices', subscriptionId] });
      // Soft success-tap, like other mutations on this page.
      haptic.notification('success');
      // Не сбрасываем edit-state, если пользователь уже перешёл на другой
      // девайс пока шёл запрос — иначе теряем его новый input. Имя не чистим
      // безусловно: оно либо принадлежит уже другому девайсу (нужно сохранить),
      // либо инпут уже закрылся (значение не отображается).
      setEditingDeviceHwid((current) => (current === variables.hwid ? null : current));
    },
    onError: () => {
      haptic.notification('error');
    },
  });

  // Pause subscription mutation
  const pauseMutation = useMutation({
    mutationFn: () => subscriptionApi.togglePause(subscriptionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription', subscriptionId] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
    },
  });

  // Auto-close all modals/forms when success notification appears
  const handleCloseAllModals = useCallback(() => {
    setShowDeviceTopup(false);
    setShowDeviceReduction(false);
    setShowTrafficTopup(false);
    setShowServerManagement(false);
  }, []);
  useCloseOnSuccessNotification(handleCloseAllModals);

  // Traffic refresh mutation
  const refreshTrafficMutation = useMutation({
    mutationFn: () => subscriptionApi.refreshTraffic(subscriptionId),
    onSuccess: (data) => {
      setTrafficData({
        traffic_used_gb: data.traffic_used_gb,
        traffic_used_percent: data.traffic_used_percent,
        is_unlimited: data.is_unlimited,
      });
      localStorage.setItem(
        `traffic_refresh_ts_${subscriptionId ?? 'default'}`,
        Date.now().toString(),
      );
      if (data.rate_limited && data.retry_after_seconds) {
        setTrafficRefreshCooldown(data.retry_after_seconds);
      } else {
        setTrafficRefreshCooldown(30);
      }
      queryClient.invalidateQueries({ queryKey: ['subscription', subscriptionId] });
    },
    onError: (error: {
      response?: { status?: number; headers?: { get?: (key: string) => string } };
    }) => {
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers?.get?.('Retry-After');
        setTrafficRefreshCooldown(retryAfter ? parseInt(retryAfter, 10) : 30);
      }
    },
  });

  // Track if we've already triggered auto-refresh this session
  const hasAutoRefreshed = useRef(false);

  // Cooldown timer for traffic refresh
  useEffect(() => {
    if (trafficRefreshCooldown <= 0) return;
    const timer = setInterval(() => {
      setTrafficRefreshCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [trafficRefreshCooldown]);

  // Initialize revoke cooldown from localStorage on mount
  useEffect(() => {
    const ts = localStorage.getItem(`revoke_ts_${subscriptionId ?? 'default'}`);
    if (ts) {
      const elapsed = Math.floor((Date.now() - parseInt(ts, 10)) / 1000);
      const remaining = Math.max(0, 900 - elapsed);
      setRevokeCooldown(remaining);
    }
  }, [subscriptionId]);

  // Countdown timer for revoke cooldown
  useEffect(() => {
    if (revokeCooldown <= 0) return;
    const timer = setInterval(() => {
      setRevokeCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [revokeCooldown]);

  // Revoke (reissue) subscription mutation
  const revokeMutation = useMutation({
    mutationFn: () => subscriptionApi.revokeSubscription(subscriptionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['connection-link', subscriptionId] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      // Remnawave resets device HWIDs on revoke — make sure the cabinet
      // re-reads the now-empty device list instead of showing the stale cache.
      queryClient.invalidateQueries({ queryKey: ['devices', subscriptionId] });
      haptic.notification('success');
      localStorage.setItem(`revoke_ts_${subscriptionId ?? 'default'}`, Date.now().toString());
      setRevokeCooldown(900);
    },
    onError: () => {
      haptic.notification('error');
    },
  });

  // Auto-refresh traffic on mount (with 30s caching)
  useEffect(() => {
    if (!subscription) return;
    if (hasAutoRefreshed.current) return;
    hasAutoRefreshed.current = true;

    const lastRefresh = localStorage.getItem(`traffic_refresh_ts_${subscriptionId ?? 'default'}`);
    const now = Date.now();
    const cacheMs = 30 * 1000;

    if (lastRefresh && now - parseInt(lastRefresh, 10) < cacheMs) {
      const elapsed = now - parseInt(lastRefresh, 10);
      const remaining = Math.ceil((cacheMs - elapsed) / 1000);
      if (remaining > 0) {
        setTrafficRefreshCooldown(remaining);
      }
      return;
    }

    refreshTrafficMutation.mutate();
  }, [subscription, refreshTrafficMutation, subscriptionId]);

  const copyUrl = () => {
    if (displayedConnectionUrl) {
      void copyToClipboard(displayedConnectionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRevoke = async () => {
    const confirmed = await destructiveConfirm(
      t('subscription.revoke.warning'),
      t('subscription.revoke.confirmBtn'),
      t('subscription.revoke.title'),
    );
    if (!confirmed) return;
    revokeMutation.mutate();
  };

  // In multi-tariff mode without a specific subscription ID, redirect to list
  if (isMultiTariff && !subscriptionId && !isLoading) {
    return <Navigate to="/subscriptions" replace />;
  }

  if (isLoading) {
    return (
      <div className="mitray-sub">
        <div className="loader">
          <div className="spin" />
        </div>
      </div>
    );
  }

  if (!subscription && subscriptionId) {
    return (
      <div className="mitray-sub">
        <div className="empty">
          <div className="eic" style={{ fontSize: 30 }}>
            😕
          </div>
          <div className="et">{t('subscription.notFound', 'Подписка не найдена')}</div>
          <div className="ed">
            {t('subscription.notFoundDesc', 'Возможно, подписка была удалена или не существует')}
          </div>
          <button className="btn-primary" onClick={() => navigate('/subscriptions')}>
            {t('subscription.backToList', 'Мои подписки')}
          </button>
        </div>
      </div>
    );
  }

  const titleText =
    isMultiTariff && subscription?.tariff_name ? subscription.tariff_name : t('subscription.title');

  // ─── Renew / Get-subscription CTA (logic inlined from PurchaseCTAButton) ───
  const ctaIsExpired =
    !subscription ||
    (!subscription.is_active && !subscription.is_trial && !subscription.is_limited);
  const ctaIsTrial = subscription?.is_trial;
  const ctaIsDaily = subscription?.is_daily;
  const ctaHidden = isMultiTariff && ctaIsDaily && !ctaIsExpired;
  const ctaLink = ctaIsTrial
    ? '/subscription/purchase'
    : isMultiTariff && subscription?.id
      ? `/subscriptions/${subscription.id}/renew`
      : '/subscription/purchase';
  const ctaText = ctaIsExpired
    ? t('subscription.getSubscription')
    : ctaIsTrial
      ? t('subscription.trialUpgrade.title')
      : t('subscription.extend');
  const ctaHint = ctaIsExpired
    ? t('subscription.cta.expiredHint')
    : ctaIsTrial
      ? t('subscription.cta.trialHint')
      : isMultiTariff
        ? t('subscription.cta.renewHint', 'Продление подписки')
        : t('subscription.cta.activeHint');

  const renewCta = ctaHidden ? null : (
    <Link
      to={ctaLink}
      className={cn('card renew reveal d2', ctaIsExpired && 'danger')}
      style={{ padding: '20px 24px' }}
    >
      <div className="row">
        <span className="ic">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l2.2 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.8-.5z" />
          </svg>
        </span>
        <div className="tt">
          <b>{ctaText}</b>
          <p>{ctaHint}</p>
        </div>
        <span className="chev">
          <ChevronRight />
        </span>
      </div>
    </Link>
  );

  return (
    <div className={cn('mitray-sub flex flex-col gap-4', revealed && 'in')}>
      {/* Page head */}
      <div className="phead reveal d1">
        <div>
          <div className="crumb">
            {t('subscription.crumbHome', 'Главная')} · <b>{titleText}</b>
          </div>
          <h1>
            <WebBackButton to={isMultiTariff ? '/subscriptions' : '/'} />
            {titleText}
          </h1>
        </div>
      </div>

      {subscription ? (
        (() => {
          const usedGb = trafficData?.traffic_used_gb ?? subscription.traffic_used_gb;
          const isUnlimited =
            (trafficData?.is_unlimited ?? false) || subscription.traffic_limit_gb === 0;
          const connectedDevices = devicesData?.total ?? 0;
          const isAtDeviceLimit =
            subscription.device_limit > 0 && connectedDevices >= subscription.device_limit;

          const statusBadge = subscription.is_active
            ? subscription.is_trial
              ? { cls: 'norm', text: t('subscription.trialStatus') }
              : { cls: 'ok', text: t('subscription.active') }
            : subscription.is_limited
              ? { cls: 'warn', text: t('subscription.trafficLimited') }
              : subscription.status === 'disabled'
                ? { cls: 'warn', text: t('subscription.pause.suspended') }
                : { cls: 'danger', text: t('subscription.expired') };

          return (
            <div className="sub-grid">
              {/* ─────────── LEFT ─────────── */}
              <div className="col">
                {/* Overview */}
                <div className="card reveal d2">
                  <div className="ov-top">
                    <span className="ov-name">
                      {subscription.tariff_name || t('subscription.currentPlan')}
                    </span>
                    <span className={cn('badge', statusBadge.cls)}>{statusBadge.text}</span>
                  </div>

                  {/* Traffic-limited banner */}
                  {subscription.is_limited && (
                    <div className="banner warn">
                      <span className="bi">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      </span>
                      <div className="bt">
                        <b>{t('subscription.trafficLimitedTitle')}</b>
                        <p>{t('subscription.trafficLimitedDescription')}</p>
                      </div>
                    </div>
                  )}

                  {/* Trial banner */}
                  {subscription.is_trial && subscription.is_active && (
                    <div className="banner accent">
                      <span className="bi">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </span>
                      <div className="bt" style={{ flex: 1 }}>
                        <b>{t('subscription.trialInfo.title')}</b>
                        <p>{t('subscription.trialInfo.description')}</p>
                        <div className="chips">
                          <div className="c">
                            <b>
                              {subscription.days_left > 0
                                ? t('subscription.days', { count: subscription.days_left })
                                : `${subscription.hours_left}${t('subscription.hours')} ${subscription.minutes_left}${t('subscription.minutes')}`}
                            </b>
                            <span>{t('subscription.trialInfo.remaining')}</span>
                          </div>
                          <div className="c">
                            <b>
                              {subscription.traffic_limit_gb || '∞'} {t('common.units.gb')}
                            </b>
                            <span>{t('subscription.traffic')}</span>
                          </div>
                          <div className="c">
                            <b>
                              {subscription.device_limit === 0 ? '∞' : subscription.device_limit}
                            </b>
                            <span>{t('subscription.devices')}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Traffic */}
                  <div className="k-lbl">{t('subscription.traffic')}</div>
                  <div className="traffic-row">
                    <div className="big">
                      {isUnlimited ? (
                        formatTraffic(usedGb)
                      ) : (
                        <>
                          {formatTraffic(usedGb)}{' '}
                          <small>/ {formatTraffic(subscription.traffic_limit_gb)}</small>
                        </>
                      )}
                    </div>
                    <button
                      className="refresh"
                      onClick={() => refreshTrafficMutation.mutate()}
                      disabled={refreshTrafficMutation.isPending || trafficRefreshCooldown > 0}
                    >
                      <RefreshIcon
                        className="h-3 w-3"
                        spinning={refreshTrafficMutation.isPending}
                      />
                      {trafficRefreshCooldown > 0
                        ? `${trafficRefreshCooldown}s`
                        : t('common.refresh')}
                    </button>
                  </div>
                  {subscription.traffic_reset_mode &&
                    subscription.traffic_reset_mode !== 'NO_RESET' && (
                      <div className="reset" style={{ marginBottom: 8 }}>
                        {t(`subscription.trafficReset.${subscription.traffic_reset_mode}`)}
                      </div>
                    )}
                  <TrafficProgressBar
                    usedGb={usedGb}
                    limitGb={subscription.traffic_limit_gb}
                    percent={usedPercent}
                    isUnlimited={isUnlimited}
                    compact
                  />

                  <div className="divider" />

                  {/* Remaining */}
                  <div className="k-lbl">{t('dashboard.remaining')}</div>
                  <CountdownTimer
                    endDate={subscription.end_date}
                    isActive={subscription.is_active || subscription.is_limited}
                  />

                  {/* Autopay (not for trial / daily) */}
                  {!subscription.is_trial && !subscription.is_daily && (
                    <>
                      <div className="divider" />
                      <div className="autopay">
                        <div className="body">
                          <b>{t('subscription.autoRenewal')}</b>
                          <p>
                            {t('subscription.daysBeforeExpiry', {
                              count: subscription.autopay_days_before,
                            })}
                          </p>
                        </div>
                        <button
                          className={cn('switch', subscription.autopay_enabled && 'on')}
                          onClick={() => autopayMutation.mutate(!subscription.autopay_enabled)}
                          disabled={autopayMutation.isPending}
                          role="switch"
                          aria-checked={subscription.autopay_enabled}
                          aria-label={t('subscription.autopay', 'Auto-payment')}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Purchased traffic packages */}
                {subscription.traffic_purchases && subscription.traffic_purchases.length > 0 && (
                  <div className="card reveal d3">
                    <div className="card-h">
                      <div className="t">{t('subscription.purchasedTraffic')}</div>
                    </div>
                    {subscription.traffic_purchases.map((purchase) => (
                      <div key={purchase.id} className="tpack">
                        <div className="tpack-h">
                          <div className="l">
                            <span className="ic">
                              <DownloadIcon className="h-3.5 w-3.5" />
                            </span>
                            <b>
                              {purchase.traffic_gb} {t('common.units.gb')}
                            </b>
                          </div>
                          <div className={cn('r', purchase.days_remaining === 0 && 'expired')}>
                            {purchase.days_remaining === 0
                              ? t('subscription.expired')
                              : t('subscription.days', { count: purchase.days_remaining })}
                          </div>
                        </div>
                        <div className="tpack-bar">
                          <i style={{ transform: `scaleX(${purchase.progress_percent / 100})` }} />
                        </div>
                        <div className="tpack-dates">
                          <span>{new Date(purchase.created_at).toLocaleDateString()}</span>
                          <span>{new Date(purchase.expires_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Devices */}
                <div className="card reveal d4">
                  <div className="card-h dev-head">
                    <div className="t">
                      {t('subscription.myDevices')}
                      {devicesData && (
                        <span className="sub">
                          {' · '}
                          {devicesData.device_limit === 0
                            ? `${devicesData.total} · ∞`
                            : `${devicesData.total} / ${devicesData.device_limit}`}
                        </span>
                      )}
                    </div>
                    <div className="dev-h-acts">
                      {/* Reissue (revoke) — regenerate the Remnawave subscription link
                          and reset device HWIDs. Neat pill in the devices header.
                          NOTE: upstream gates this behind !is_trial; per product
                          decision we also show it on trial (revoke works for trials). */}
                      {(subscription.is_active || subscription.is_limited) && (
                        <button
                          type="button"
                          className="reissue"
                          onClick={handleRevoke}
                          disabled={revokeMutation.isPending || revokeCooldown > 0}
                          title={t('subscription.revoke.button')}
                          aria-label={t('subscription.revoke.button')}
                        >
                          {revokeMutation.isPending ? (
                            <span
                              className="spin"
                              style={{ width: 13, height: 13, borderTopColor: 'var(--accent)' }}
                            />
                          ) : (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                            </svg>
                          )}
                          {revokeCooldown > 0 ? (
                            <span className="tmr">
                              {Math.floor(revokeCooldown / 60)}:
                              {String(revokeCooldown % 60).padStart(2, '0')}
                            </span>
                          ) : (
                            <span>{t('subscription.revoke.confirmBtn')}</span>
                          )}
                        </button>
                      )}
                      {devicesData && devicesData.devices.length > 0 && (
                        <button
                          className="link-danger"
                          disabled={deleteAllDevicesMutation.isPending}
                          onClick={async () => {
                            const confirmed = await destructiveConfirm(
                              t('subscription.confirmDeleteAllDevices'),
                              t('subscription.deleteAllDevices'),
                              t('subscription.deleteAllDevices'),
                            );
                            if (confirmed) deleteAllDevicesMutation.mutate();
                          }}
                        >
                          {t('subscription.deleteAllDevices')}
                        </button>
                      )}
                    </div>
                  </div>
                  {revokeMutation.error && (
                    <p className="err-note" style={{ marginTop: 0, marginBottom: 14 }}>
                      {getErrorMessage(revokeMutation.error)}
                    </p>
                  )}

                  {/* Connection URL */}
                  {displayedConnectionUrl && !shouldHideConnectionLink && (
                    <div className="connect">
                      <span className="ic">
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <rect x="2" y="4" width="20" height="13" rx="2" />
                          <path d="M8 20h8M12 17v3" />
                        </svg>
                      </span>
                      <div className="u">
                        <b>{t('subscription.copyLink', 'Ссылка подключения')}</b>
                        <div className="url" title={displayedConnectionUrl}>
                          {displayedConnectionUrl}
                        </div>
                      </div>
                      <button
                        className={cn('copy', copied && 'done')}
                        onClick={copyUrl}
                        aria-label={t('subscription.copyLink')}
                        title={t('subscription.copyLink')}
                      >
                        {copied ? <CheckIcon /> : <CopyIcon />}
                      </button>
                    </div>
                  )}

                  {/* Connect a new device */}
                  {subscription.subscription_url && (
                    <div className="connect" style={{ marginBottom: 18 }}>
                      <span className="ic">
                        <DevicesIcon className="h-5 w-5" />
                      </span>
                      <div className="u">
                        <b>{t('dashboard.connectDevice')}</b>
                        <div className="url" style={{ fontFamily: 'inherit' }}>
                          {subscription.device_limit === 0
                            ? t('dashboard.devicesConnectedUnlimited', { used: connectedDevices })
                            : t('dashboard.devicesOfMax', {
                                used: connectedDevices,
                                max: subscription.device_limit,
                              })}
                          {isAtDeviceLimit && ` · ${t('dashboard.deviceLimitReached')}`}
                        </div>
                      </div>
                      <button
                        className="copy"
                        disabled={isAtDeviceLimit}
                        aria-label={t('dashboard.connectDevice')}
                        onClick={() => {
                          if (isAtDeviceLimit) {
                            haptic.notification('error');
                            return;
                          }
                          navigate(
                            subscriptionId ? `/connection?sub=${subscriptionId}` : '/connection',
                          );
                        }}
                      >
                        <ChevronRight />
                      </button>
                    </div>
                  )}

                  {/* Device list */}
                  {devicesLoading ? (
                    <div className="loader">
                      <div className="spin" />
                    </div>
                  ) : devicesData && devicesData.devices.length > 0 ? (
                    <div>
                      {devicesData.devices.map((device) => {
                        const isEditing = editingDeviceHwid === device.hwid;
                        const displayName =
                          (device.local_name && device.local_name.trim()) ||
                          device.device_model ||
                          device.platform;
                        return (
                          <div key={device.hwid} className="dev">
                            <span className="di">
                              <DeviceGlyph platform={device.platform} />
                            </span>
                            <div className="dn">
                              {isEditing ? (
                                <input
                                  type="text"
                                  className="dev-edit"
                                  autoFocus
                                  value={editingDeviceName}
                                  maxLength={DEVICE_ALIAS_MAX_LENGTH}
                                  placeholder={device.device_model || device.platform}
                                  onChange={(e) => setEditingDeviceName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const trimmed = editingDeviceName.trim();
                                      renameDeviceMutation.mutate({
                                        hwid: device.hwid,
                                        name: trimmed || null,
                                      });
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      setEditingDeviceHwid(null);
                                      setEditingDeviceName('');
                                    }
                                  }}
                                />
                              ) : (
                                <>
                                  <b>{displayName}</b>
                                  <p>
                                    {device.platform}{' '}
                                    <span className="hw">
                                      {device.hwid.slice(0, 8).toUpperCase()}
                                    </span>
                                  </p>
                                </>
                              )}
                            </div>
                            <div className="dev-acts">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    className="del ok"
                                    disabled={renameDeviceMutation.isPending}
                                    title={t('subscription.renameDeviceSave', 'Сохранить')}
                                    aria-label={t('subscription.renameDeviceSave', 'Сохранить')}
                                    onClick={() => {
                                      const trimmed = editingDeviceName.trim();
                                      renameDeviceMutation.mutate({
                                        hwid: device.hwid,
                                        name: trimmed || null,
                                      });
                                    }}
                                  >
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <path d="M5 13l4 4L19 7" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    className="del"
                                    disabled={renameDeviceMutation.isPending}
                                    title={t('subscription.renameDeviceCancel', 'Отмена')}
                                    aria-label={t('subscription.renameDeviceCancel', 'Отмена')}
                                    onClick={() => {
                                      setEditingDeviceHwid(null);
                                      setEditingDeviceName('');
                                    }}
                                  >
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <path d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="del accent"
                                    title={t('subscription.renameDevice', 'Переименовать')}
                                    aria-label={t('subscription.renameDevice', 'Переименовать')}
                                    onClick={() => {
                                      setEditingDeviceHwid(device.hwid);
                                      setEditingDeviceName(device.local_name || '');
                                    }}
                                  >
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    className="del"
                                    disabled={deleteDeviceMutation.isPending}
                                    title={t('subscription.deleteDevice')}
                                    aria-label={t('subscription.deleteDevice')}
                                    onClick={async () => {
                                      const confirmed = await destructiveConfirm(
                                        t('subscription.confirmDeleteDevice'),
                                        t('subscription.deleteDevice'),
                                        t('subscription.deleteDevice'),
                                      );
                                      if (confirmed) deleteDeviceMutation.mutate(device.hwid);
                                    }}
                                  >
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                    </svg>
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="reset" style={{ textAlign: 'center', padding: '24px 0' }}>
                      {t('subscription.noDevices')}
                    </div>
                  )}
                </div>
              </div>

              {/* ─────────── RIGHT ─────────── */}
              <div className="col">
                {renewCta}

                {/* Daily subscription pause */}
                {subscription.is_daily && !subscription.is_trial && (
                  <div className="card reveal d3">
                    <div className="rowline">
                      <div className="body">
                        <b>{t('subscription.pause.title')}</b>
                        <p>
                          {subscription.is_limited
                            ? t('subscription.trafficLimited')
                            : subscription.status === 'disabled'
                              ? t('subscription.pause.suspended')
                              : subscription.is_daily_paused
                                ? t('subscription.pause.paused')
                                : t('subscription.pause.active')}
                        </p>
                      </div>
                      <button
                        className={cn(
                          'btn-soft',
                          subscription.is_daily_paused || subscription.status === 'disabled'
                            ? 'accent'
                            : 'warn',
                        )}
                        onClick={() => pauseMutation.mutate()}
                        disabled={pauseMutation.isPending}
                      >
                        {pauseMutation.isPending
                          ? '…'
                          : subscription.is_daily_paused || subscription.status === 'disabled'
                            ? t('subscription.pause.resumeBtn')
                            : t('subscription.pause.pauseBtn')}
                      </button>
                    </div>

                    {pauseMutation.isError &&
                      (() => {
                        const balanceError = getInsufficientBalanceError(pauseMutation.error);
                        if (balanceError) {
                          const missingAmount = balanceError.required - balanceError.balance;
                          return (
                            <div style={{ marginTop: 16 }}>
                              <InsufficientBalancePrompt
                                missingAmountKopeks={missingAmount}
                                message={t('subscription.pause.insufficientBalance')}
                                compact
                              />
                            </div>
                          );
                        }
                        return (
                          <div className="err-note">{getErrorMessage(pauseMutation.error)}</div>
                        );
                      })()}

                    {subscription.is_daily_paused ? (
                      <div className="banner warn" style={{ marginTop: 16, marginBottom: 0 }}>
                        <span className="bi">
                          <PauseIcon className="h-4 w-4" />
                        </span>
                        <div className="bt">
                          <b>{t('subscription.pause.pausedInfo')}</b>
                          <p>
                            {t('subscription.pause.pausedDescription')}{' '}
                            {new Date(subscription.end_date).toLocaleDateString()} (
                            {t('subscription.pause.days', { count: subscription.days_left })})
                          </p>
                        </div>
                      </div>
                    ) : (
                      subscription.next_daily_charge_at &&
                      (() => {
                        const now = new Date();
                        const nextChargeStr = subscription.next_daily_charge_at.endsWith('Z')
                          ? subscription.next_daily_charge_at
                          : subscription.next_daily_charge_at + 'Z';
                        const nextCharge = new Date(nextChargeStr);
                        const totalMs = 24 * 60 * 60 * 1000;
                        const remainingMs = Math.max(0, nextCharge.getTime() - now.getTime());
                        const elapsedMs = totalMs - remainingMs;
                        const progress = Math.min(100, (elapsedMs / totalMs) * 100);
                        const hours = Math.floor(remainingMs / (1000 * 60 * 60));
                        const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
                        return (
                          <div style={{ marginTop: 16 }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginBottom: 8,
                              }}
                            >
                              <span className="k-lbl">{t('subscription.pause.nextCharge')}</span>
                              <span
                                style={{
                                  fontFamily: 'ui-monospace, monospace',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: 'var(--ink)',
                                }}
                              >
                                {hours > 0
                                  ? `${hours}${t('subscription.pause.hours')} ${minutes}${t('subscription.pause.minutes')}`
                                  : `${minutes}${t('subscription.pause.minutes')}`}
                              </span>
                            </div>
                            <div className="pbar">
                              <i style={{ transform: `scaleX(${progress / 100})` }} />
                            </div>
                            {subscription.daily_price_kopeks && (
                              <div className="reset" style={{ textAlign: 'center', marginTop: 8 }}>
                                {t('subscription.pause.willBeCharged')}:{' '}
                                {formatPrice(subscription.daily_price_kopeks)}
                              </div>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}

                {/* Additional options (device/traffic/server sheets kept as-is) */}
                {(subscription.is_active || subscription.is_limited) &&
                  !subscription.is_trial &&
                  subscription.device_limit !== 0 && (
                    <div className="card reveal d3">
                      <div className="card-h">
                        <div className="t">{t('subscription.additionalOptions.title')}</div>
                      </div>
                      <div className="opt-stack">
                        <DeviceTopupSheet
                          open={showDeviceTopup}
                          onOpen={() => setShowDeviceTopup(true)}
                          onClose={() => setShowDeviceTopup(false)}
                          subscription={subscription}
                          subscriptionId={subscriptionId}
                          devicesToAdd={devicesToAdd}
                          onDevicesToAddChange={setDevicesToAdd}
                          purchaseOptions={purchaseOptions}
                          isDark={isDark}
                        />
                        <DeviceReductionSheet
                          open={showDeviceReduction}
                          onOpen={() => setShowDeviceReduction(true)}
                          onClose={() => setShowDeviceReduction(false)}
                          subscriptionPresent={!!subscription}
                          subscriptionId={subscriptionId}
                          targetDeviceLimit={targetDeviceLimit}
                          onTargetDeviceLimitChange={setTargetDeviceLimit}
                          isDark={isDark}
                        />
                        {subscription.traffic_limit_gb > 0 && trafficTopupAvailable && (
                          <TrafficTopupSheet
                            open={showTrafficTopup}
                            onOpen={() => setShowTrafficTopup(true)}
                            onClose={() => setShowTrafficTopup(false)}
                            subscription={subscription}
                            subscriptionId={subscriptionId}
                            selectedTrafficPackage={selectedTrafficPackage}
                            onSelectedTrafficPackageChange={setSelectedTrafficPackage}
                            purchaseOptions={purchaseOptions}
                            isDark={isDark}
                          />
                        )}
                        {!isTariffsMode && (
                          <ServerManagementSheet
                            open={showServerManagement}
                            onOpen={() => setShowServerManagement(true)}
                            onClose={() => setShowServerManagement(false)}
                            subscription={subscription}
                            subscriptionId={subscriptionId}
                            selectedServers={selectedServersToUpdate}
                            onSelectedServersChange={setSelectedServersToUpdate}
                            purchaseOptions={purchaseOptions}
                            isDark={isDark}
                          />
                        )}
                      </div>
                    </div>
                  )}

                {/* Locations */}
                {subscription.servers && subscription.servers.length > 0 && (
                  <div className="card reveal d4">
                    <div className="card-h">
                      <div className="t">{t('subscription.locationsLabel')}</div>
                      <div className="sub">
                        {t('subscription.serversCount', {
                          count: subscription.servers.length,
                          defaultValue: `${subscription.servers.length}`,
                        })}
                      </div>
                    </div>
                    <div className="locs">
                      {subscription.servers.map((server) => (
                        <span key={server.uuid} className="loc">
                          <Twemoji options={{ className: 'twemoji', folder: 'svg', ext: '.svg' }}>
                            <span>
                              {server.country_code ? `${getFlagEmoji(server.country_code)} ` : ''}
                              {server.name}
                            </span>
                          </Twemoji>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Delete expired subscription (multi-tariff) */}
                {isMultiTariff &&
                  !subscription.is_active &&
                  !subscription.is_trial &&
                  !subscription.is_limited && (
                    <div className="card reveal d4">
                      <DeleteSubscriptionSheet
                        subscriptionId={subscription.id}
                        open={showDeleteSheet}
                        onOpen={() => setShowDeleteSheet(true)}
                        onClose={() => setShowDeleteSheet(false)}
                        textSecondary={isDark ? '#8A8EA3' : '#565A6B'}
                        onDeleted={() => {
                          queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
                          navigate('/subscriptions', { replace: true });
                        }}
                      />
                    </div>
                  )}
              </div>
            </div>
          );
        })()
      ) : (
        <>
          <div className="empty card">
            <div className="eic">
              <TrashIcon className="h-8 w-8" />
            </div>
            <div className="ed">{t('subscription.noSubscription')}</div>
          </div>
          {renewCta}
        </>
      )}
    </div>
  );
}
