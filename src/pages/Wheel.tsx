import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { wheelApi } from '../api/wheel';
import type { SpinResult, SpinHistoryItem, WheelPrize } from '../api/wheel';
import MitrayWheel, { PrizeIcon } from '../components/wheel/MitrayWheel';
import { isJackpot } from '../components/wheel/prizeIcons';
import { usePlatform, useHaptic, useNotify } from '../platform';
import '../styles/wheel.css';

type PaymentType = 'telegram_stars' | 'subscription_days' | 'free';

/** Угол остановки на конкретном секторе (совместим с формулой бэкенда). */
function rotationForIndex(prizes: WheelPrize[], prizeIndex: number): number {
  const sectorAngle = 360 / prizes.length;
  const baseAngle = prizeIndex * sectorAngle + sectorAngle / 2;
  const offset = (Math.random() - 0.5) * sectorAngle * 0.6; // ±30% внутри сектора
  return (360 - baseAngle + offset + 360) % 360;
}

/** Нейтральный сектор («Пусто», иначе последний) — куда вставать, если приз неизвестен. */
function neutralIndex(prizes: WheelPrize[]): number {
  const idx = prizes.findIndex((p) => p.prize_type === 'nothing');
  return idx >= 0 ? idx : prizes.length - 1;
}

function calculateRotationForPrize(prizes: WheelPrize[], result: SpinResult): number {
  if (prizes.length === 0) return 0;
  const idx = result.prize_id != null ? prizes.findIndex((p) => p.id === result.prize_id) : -1;
  return rotationForIndex(prizes, idx >= 0 ? idx : neutralIndex(prizes));
}

function neutralRotation(prizes: WheelPrize[]): number {
  if (prizes.length === 0) return 0;
  return rotationForIndex(prizes, neutralIndex(prizes));
}

const fmtLeft = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
};

const GiftIcon = ({ size = 15 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7S9 2 6.5 4 9 7 12 7zM12 7s3-5 5.5-3S15 7 12 7z" />
  </svg>
);

export default function Wheel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { openInvoice, capabilities } = usePlatform();
  const haptic = useHaptic();
  const notify = useNotify();

  const [isSpinning, setIsSpinning] = useState(false);
  const [targetRotation, setTargetRotation] = useState<number | null>(null);
  const [spinResult, setSpinResult] = useState<SpinResult | null>(null);
  const [paymentType, setPaymentType] = useState<PaymentType>('telegram_stars');
  const [isPayingStars, setIsPayingStars] = useState(false);
  const [showStarsConfirm, setShowStarsConfirm] = useState(false);
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<number | null>(null);
  const [celebrate, setCelebrate] = useState<{ id: number; big: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const paymentTypeInitialized = useRef(false);

  const {
    data: config,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['wheel-config'],
    queryFn: wheelApi.getConfig,
  });

  const { data: history } = useQuery({
    queryKey: ['wheel-history'],
    queryFn: () => wheelApi.getHistory(1, 10),
  });

  // Тик для каунтдауна фриспина
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const freeNextMs = config?.free_spin_next_at ? new Date(config.free_spin_next_at).getTime() : 0;
  const freeReady = !!config?.free_spin_available;
  const freeOffered = freeReady || freeNextMs > 0;

  // Автовыбор способа оплаты (только при первой загрузке)
  useEffect(() => {
    if (!config || paymentTypeInitialized.current) return;
    paymentTypeInitialized.current = true;

    const starsEnabled = config.spin_cost_stars_enabled && config.spin_cost_stars;
    const daysEnabled = config.spin_cost_days_enabled && config.spin_cost_days;

    if (config.free_spin_available) {
      setPaymentType('free');
    } else if (starsEnabled) {
      setPaymentType('telegram_stars');
    } else if (daysEnabled) {
      setPaymentType('subscription_days');
    }

    if (config.eligible_subscriptions?.length === 1) {
      setSelectedSubscriptionId(config.eligible_subscriptions[0].id);
    }
  }, [config]);

  // Фриспин истрачен -> апселл: переключаемся на платный способ
  useEffect(() => {
    if (paymentType === 'free' && config && !config.free_spin_available && !isSpinning) {
      setPaymentType(config.spin_cost_stars_enabled ? 'telegram_stars' : 'subscription_days');
    }
  }, [config, paymentType, isSpinning]);

  // Поллинг результата после оплаты звёздами
  const pollForSpinResult = useCallback(
    async (signal: AbortSignal, maxAttempts = 15, delayMs = 800) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (signal.aborted) return null;

      let historyBefore;
      try {
        historyBefore = await wheelApi.getHistory(1, 1);
      } catch {
        historyBefore = { items: [], total: 0 };
      }
      const lastSpinIdBefore = historyBefore.items.length > 0 ? historyBefore.items[0].id : 0;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (signal.aborted) return null;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (signal.aborted) return null;

        try {
          const historyAfter = await wheelApi.getHistory(1, 1);
          if (historyAfter.items.length > 0) {
            const latestSpin = historyAfter.items[0];
            if (lastSpinIdBefore === 0 || latestSpin.id > lastSpinIdBefore) {
              return {
                success: true,
                // WheelPrize id — чтобы колесо встало ровно на выигранный сектор
                prize_id: latestSpin.prize_id,
                prize_type: latestSpin.prize_type,
                prize_value: latestSpin.prize_value,
                prize_display_name: latestSpin.prize_display_name,
                emoji: latestSpin.emoji,
                color: latestSpin.color,
                rotation_degrees: 0,
                message:
                  latestSpin.prize_type === 'nothing'
                    ? t('wheel.noPrize')
                    : `${t('wheel.youWon')} ${latestSpin.prize_display_name}!`,
                promocode: null, // промокод уходит в чат бота
                error: null,
              } as SpinResult;
            }
          }
        } catch {
          // продолжаем поллинг
        }
      }
      return null;
    },
    [t],
  );

  const pendingStarsResultRef = useRef<SpinResult | null>(null);
  const isStarsSpinRef = useRef(false);
  const pollingAbortRef = useRef<AbortController | null>(null);
  const preOpenedWindowRef = useRef<Window | null>(null);

  useEffect(() => {
    return () => {
      if (pollingAbortRef.current) pollingAbortRef.current.abort();
    };
  }, []);

  const starsFallbackResult = useCallback(
    (message: string): SpinResult => ({
      success: true,
      prize_id: null,
      prize_type: null,
      prize_value: 0,
      prize_display_name: '',
      emoji: '🎰',
      color: '#8B5CF6',
      rotation_degrees: 0,
      message,
      promocode: null,
      error: null,
    }),
    [],
  );

  const starsInvoiceMutation = useMutation({
    mutationFn: wheelApi.createStarsInvoice,
    onSuccess: async (data) => {
      if (capabilities.hasInvoice) {
        const status = await openInvoice(data.invoice_url);

        if (status === 'paid') {
          isStarsSpinRef.current = true;
          pendingStarsResultRef.current = null;

          if (pollingAbortRef.current) pollingAbortRef.current.abort();
          pollingAbortRef.current = new AbortController();

          // Сначала узнаём приз поллингом, потом считаем угол — чтобы колесо
          // визуально встало на реально выигранный сектор.
          const abortSignal = pollingAbortRef.current.signal;
          pollForSpinResult(abortSignal)
            .then((result) => {
              if (abortSignal.aborted) return;

              queryClient.invalidateQueries({ queryKey: ['wheel-config'] });
              queryClient.invalidateQueries({ queryKey: ['wheel-history'] });
              setIsPayingStars(false);

              if (result) {
                pendingStarsResultRef.current = result;
                setTargetRotation(calculateRotationForPrize(config?.prizes ?? [], result));
              } else {
                // Результат не пришёл — встаём на нейтральный сектор (никогда не
                // на случайный/выигрышный) и просим посмотреть историю.
                pendingStarsResultRef.current = starsFallbackResult(
                  t('wheel.starsPaymentSuccessCheckHistory'),
                );
                setTargetRotation(neutralRotation(config?.prizes ?? []));
              }
              setIsSpinning(true);
            })
            .catch(() => {
              if (abortSignal.aborted) return;
              setIsPayingStars(false);
              pendingStarsResultRef.current = starsFallbackResult(
                t('wheel.starsPaymentSuccessCheckHistory'),
              );
              setTargetRotation(neutralRotation(config?.prizes ?? []));
              setIsSpinning(true);
            });
        } else if (status !== 'cancelled') {
          setIsPayingStars(false);
          setSpinResult({
            success: false,
            prize_id: null,
            prize_type: null,
            prize_value: 0,
            prize_display_name: '',
            emoji: '😔',
            color: '#EF4444',
            rotation_degrees: 0,
            message: t('wheel.starsPaymentFailed'),
            promocode: null,
            error: 'payment_failed',
          });
        } else {
          setIsPayingStars(false);
        }
      } else {
        // Веб: уводим заранее открытую вкладку на инвойс
        setIsPayingStars(false);
        if (preOpenedWindowRef.current) {
          preOpenedWindowRef.current.location.href = data.invoice_url;
          preOpenedWindowRef.current = null;
        }
        setSpinResult(starsFallbackResult(t('wheel.starsPaymentRedirected')));
      }
    },
    onError: () => {
      setIsPayingStars(false);
      if (preOpenedWindowRef.current) {
        preOpenedWindowRef.current.close();
        preOpenedWindowRef.current = null;
      }
      setSpinResult({
        success: false,
        prize_id: null,
        prize_type: null,
        prize_value: 0,
        prize_display_name: '',
        emoji: '😔',
        color: '#EF4444',
        rotation_degrees: 0,
        message: t('wheel.errors.networkError'),
        promocode: null,
        error: 'network_error',
      });
    },
  });

  const handleDirectStarsPay = () => {
    setShowStarsConfirm(false);
    setIsPayingStars(true);
    if (!capabilities.hasInvoice) {
      // Веб: синхронно открываем вкладку в жесте пользователя, чтобы не словить
      // блокировщик попапов, пока резолвится ссылка на инвойс.
      // eslint-disable-next-line no-restricted-properties
      preOpenedWindowRef.current = window.open('about:blank', '_blank') || null;
    }
    starsInvoiceMutation.mutate();
  };

  const spinMutation = useMutation({
    mutationFn: () => wheelApi.spin(paymentType, selectedSubscriptionId ?? undefined),
    onSuccess: (result) => {
      if (result.success) {
        setTargetRotation(result.rotation_degrees);
        setSpinResult(result);
      } else {
        setIsSpinning(false);
        setSpinResult(result);
      }
    },
    onError: () => {
      setIsSpinning(false);
      setSpinResult({
        success: false,
        message: t('wheel.errors.networkError'),
        error: 'network_error',
        prize_id: null,
        prize_type: null,
        prize_value: 0,
        prize_display_name: '',
        emoji: '',
        color: '',
        rotation_degrees: 0,
        promocode: null,
      });
    },
  });

  const handleSpin = () => {
    if (isSpinning) return;
    if (paymentType !== 'free' && !config?.can_spin) return;
    setSpinResult(null);
    setIsSpinning(true);
    spinMutation.mutate();
  };

  const handleUnifiedSpin = () => {
    if (noSubscription) return;
    if (paymentType === 'free') {
      handleSpin();
      return;
    }
    if (paymentType === 'telegram_stars') {
      if (!config?.spin_cost_stars_enabled || !config?.spin_cost_stars) {
        notify.warning(t('wheel.starsNotAvailable'));
        return;
      }
      setShowStarsConfirm(true);
    } else {
      handleSpin();
    }
  };

  const handleSpinComplete = useCallback(() => {
    setIsSpinning(false);

    let landed: SpinResult | null = null;

    if (isStarsSpinRef.current) {
      isStarsSpinRef.current = false;
      landed =
        pendingStarsResultRef.current ??
        starsFallbackResult(t('wheel.starsPaymentSuccessCheckHistory'));
      setSpinResult(landed);
      pendingStarsResultRef.current = null;
      haptic.notification(landed.prize_type === 'nothing' ? 'warning' : 'success');
    } else if (spinResult) {
      landed = spinResult;
      haptic.notification(
        spinResult.success && spinResult.prize_type !== 'nothing' ? 'success' : 'warning',
      );
    }

    // Конфетти: большой сноп на крупный приз, малый — на любой выигрыш
    if (landed?.success && landed.prize_type && landed.prize_type !== 'nothing') {
      const big =
        landed.prize_type === 'balance_bonus'
          ? landed.prize_value >= 5000
          : landed.prize_type === 'subscription_days' && landed.prize_value >= 7;
      setCelebrate({ id: Date.now(), big });
    }

    queryClient.invalidateQueries({ queryKey: ['wheel-config'] });
    queryClient.invalidateQueries({ queryKey: ['wheel-history'] });
  }, [queryClient, t, haptic, spinResult, starsFallbackResult]);

  const closeResult = () => {
    setSpinResult(null);
    setTargetRotation(null);
  };

  /* ── состояния экрана ── */
  if (isLoading) {
    return (
      <div className="mitray-wheel">
        <div className="screen-state">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (error || !config) {
    return (
      <div className="mitray-wheel">
        <div className="screen-state">
          <span className="si">
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
          </span>
          <p>{t('wheel.errors.loadFailed')}</p>
        </div>
      </div>
    );
  }

  if (!config.is_enabled) {
    return (
      <div className="mitray-wheel">
        <div className="screen-state">
          <span className="si">
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="2.5" />
              <path d="M12 3v6.5M12 14.5V21M3 12h6.5M14.5 12H21" />
            </svg>
          </span>
          <h1>{t('wheel.title')}</h1>
          <p>{t('wheel.disabled')}</p>
        </div>
      </div>
    );
  }

  const starsEnabled = !!(config.spin_cost_stars_enabled && config.spin_cost_stars);
  const daysEnabled = !!(config.spin_cost_days_enabled && config.spin_cost_days);
  const dailyLimitReached = config.daily_limit > 0 && config.user_spins_today >= config.daily_limit;
  const noSubscription = !config.has_subscription;
  const needsSubscriptionPick =
    paymentType === 'subscription_days' &&
    !!config.eligible_subscriptions &&
    config.eligible_subscriptions.length > 1 &&
    !selectedSubscriptionId;

  const spinsLeft =
    config.daily_limit > 0 ? Math.max(0, config.daily_limit - config.user_spins_today) : 0;
  const jackpot = config.prizes.find((p) => isJackpot(p));

  const spinDisabled =
    isSpinning ||
    isPayingStars ||
    noSubscription ||
    (paymentType === 'free'
      ? !freeReady
      : dailyLimitReached ||
        needsSubscriptionPick ||
        (paymentType === 'telegram_stars' ? !starsEnabled : !config.can_spin));

  const hubTitle = isSpinning
    ? t('wheel.spinning')
    : paymentType === 'free' && !freeReady
      ? fmtLeft(freeNextMs - now)
      : dailyLimitReached && paymentType !== 'free'
        ? t('wheel.errors.dailyLimitReached')
        : t('wheel.spin');

  const hubSub = isSpinning
    ? ''
    : paymentType === 'free'
      ? freeReady
        ? t('wheel.freeSpinFree', 'бесплатно!')
        : t('wheel.freeSpinSoon', 'до фриспина')
      : paymentType === 'telegram_stars'
        ? `${config.spin_cost_stars} ⭐`
        : t('wheel.days', { count: config.spin_cost_days ?? 0 });

  return (
    <div className="mitray-wheel animate-fade-in">
      <div className="phead">
        <div className="crumb">
          <Link to="/dashboard">{t('nav.dashboard', 'Кабинет')}</Link> · <b>{t('wheel.title')}</b>
        </div>
        <h1>{t('wheel.title')}</h1>
      </div>

      <div className="wl-grid">
        {/* ЛЕВО: колесо */}
        <div className="col">
          <div className="card hero-wheel">
            <div className="card-h">
              <div className="t">{t('wheel.tryLuck', 'Испытай удачу')}</div>
              {jackpot && (
                <span className="jack-chip">
                  <PrizeIcon prize={jackpot} size={14} />
                  {jackpot.display_name}
                </span>
              )}
            </div>

            <MitrayWheel
              prizes={config.prizes}
              isSpinning={isSpinning}
              targetRotation={targetRotation}
              onSpinComplete={handleSpinComplete}
              hubTitle={hubTitle}
              hubSub={hubSub}
              hubDisabled={spinDisabled}
              onHubClick={handleUnifiedSpin}
              celebrate={celebrate}
            />

            <div className="wh-controls">
              <div className="payseg">
                {freeOffered && (
                  <button
                    type="button"
                    className={freeReady && paymentType === 'free' ? 'seg-free on' : 'seg-free'}
                    disabled={!freeReady || isSpinning}
                    onClick={() => setPaymentType('free')}
                  >
                    <GiftIcon />
                    {freeReady ? t('wheel.freeSpin', 'Фриспин') : fmtLeft(freeNextMs - now)}
                  </button>
                )}
                {starsEnabled && (
                  <button
                    type="button"
                    className={paymentType === 'telegram_stars' ? 'on' : ''}
                    disabled={isSpinning}
                    onClick={() => setPaymentType('telegram_stars')}
                  >
                    ⭐ {config.spin_cost_stars}
                  </button>
                )}
                {daysEnabled && (
                  <button
                    type="button"
                    className={paymentType === 'subscription_days' ? 'on' : ''}
                    disabled={isSpinning}
                    onClick={() => setPaymentType('subscription_days')}
                  >
                    {t('wheel.days', { count: config.spin_cost_days ?? 0 })}
                  </button>
                )}
              </div>

              <div className="wh-meta">
                <span className="balchip">
                  {t('balance.title', 'Баланс')}:{' '}
                  <b>{(config.user_balance_kopeks / 100).toFixed(2)} ₽</b>
                </span>
                {config.daily_limit > 0 && (
                  <div className="spins">
                    <span className="lbl">{t('wheel.today', 'Сегодня')}:</span>
                    <div className="dots">
                      {Array.from({ length: config.daily_limit }, (_, i) => (
                        <span key={i} className={i < spinsLeft ? 'dot' : 'dot off'} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* выбор подписки для оплаты днями (мульти-тариф) */}
            {paymentType === 'subscription_days' &&
              config.eligible_subscriptions &&
              config.eligible_subscriptions.length > 1 && (
                <div className="sub-pick">
                  <span className="lbl">{t('wheel.selectSubscription', 'Выберите подписку')}</span>
                  {config.eligible_subscriptions.map((sub) => (
                    <button
                      type="button"
                      key={sub.id}
                      className={selectedSubscriptionId === sub.id ? 'on' : ''}
                      disabled={isSpinning}
                      onClick={() => setSelectedSubscriptionId(sub.id)}
                    >
                      <span>{sub.tariff_name || t('subscription.defaultName', 'Подписка')}</span>
                      <span>
                        {sub.days_left} {t('common.units.days', 'дней')}
                      </span>
                    </button>
                  ))}
                </div>
              )}

            {/* подтверждение оплаты звёздами */}
            {showStarsConfirm && !isSpinning && !isPayingStars && (
              <div className="confirm">
                <p>{t('wheel.confirmStarsPayment')}</p>
                <div className="confirm-row">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setShowStarsConfirm(false)}
                  >
                    {t('common.cancel')}
                  </button>
                  <button type="button" className="btn-pay" onClick={handleDirectStarsPay}>
                    {t('wheel.payStars', { count: config.spin_cost_stars ?? 0 })}
                  </button>
                </div>
              </div>
            )}

            {/* результат */}
            {spinResult && !isSpinning && (
              <div
                className={
                  !spinResult.success
                    ? 'res-in err'
                    : spinResult.prize_type === 'nothing'
                      ? 'res-in lose'
                      : 'res-in'
                }
              >
                <span className="res-ic">
                  <PrizeIcon
                    prize={{
                      prize_type: spinResult.prize_type ?? 'nothing',
                      display_name: spinResult.prize_display_name || '',
                    }}
                    size={36}
                  />
                </span>
                <div className="res-txt">
                  <b>
                    {spinResult.success && spinResult.prize_display_name
                      ? spinResult.prize_display_name
                      : spinResult.success
                        ? spinResult.prize_type === 'nothing'
                          ? t('wheel.noLuck')
                          : t('wheel.congratulations')
                        : t('wheel.oops')}
                  </b>
                  <p>{spinResult.message}</p>
                </div>
                <button
                  type="button"
                  className="res-x"
                  onClick={closeResult}
                  aria-label={t('common.close', 'Закрыть')}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            {spinResult?.promocode && !isSpinning && (
              <div className="res-promo">
                <span>{t('wheel.yourPromoCode')}</span>
                <b>{spinResult.promocode}</b>
              </div>
            )}

            {/* подсказки */}
            {!isSpinning && noSubscription && (
              <div className="hint warn">{t('wheel.errors.noSubscription')}</div>
            )}
            {!isSpinning && !noSubscription && needsSubscriptionPick && (
              <div className="hint warn">
                {t('wheel.errors.selectSubscription', 'Выберите подписку для списания дней')}
              </div>
            )}
            {!isSpinning && !noSubscription && paymentType !== 'free' && dailyLimitReached && (
              <div className="hint">
                {t('wheel.errors.dailyLimitReached')}
                {freeOffered && !freeReady
                  ? ` · ${t('wheel.freeSpinIn', 'фриспин через')} ${fmtLeft(freeNextMs - now)}`
                  : ''}
              </div>
            )}
            {!isSpinning &&
              !noSubscription &&
              paymentType === 'subscription_days' &&
              !dailyLimitReached &&
              !config.can_spin && <div className="hint">{t('wheel.errors.cannotSpin')}</div>}
          </div>
        </div>

        {/* ПРАВО */}
        <div className="col">
          <div className="card prizes-card">
            <div className="card-h">
              <div className="t">{t('wheel.prizes', 'Призы на колесе')}</div>
            </div>
            {config.prizes.map((prize) => {
              const jack = isJackpot(prize);
              const none = prize.prize_type === 'nothing';
              return (
                <div
                  key={prize.id}
                  className={jack ? 'prize-row hot' : none ? 'prize-row dim' : 'prize-row'}
                >
                  <span className="pr-ic">
                    <PrizeIcon prize={prize} size={19} />
                  </span>
                  <b>{prize.display_name}</b>
                </div>
              );
            })}
          </div>

          <div className="card wins-card">
            <div className="card-h">
              <div className="t">{t('wheel.recentSpins', 'Мои выигрыши')}</div>
            </div>
            {history && history.items.length > 0 ? (
              <div className="win-list">
                {history.items.map((item: SpinHistoryItem) => (
                  <div key={item.id} className={item.prize_type === 'nothing' ? 'win zero' : 'win'}>
                    <span className="wi">
                      <PrizeIcon
                        prize={{
                          prize_type: item.prize_type,
                          display_name: item.prize_display_name,
                        }}
                        size={17}
                      />
                    </span>
                    <div className="wt">
                      <b>{item.prize_display_name}</b>
                      <span>
                        {new Date(item.created_at).toLocaleDateString()}
                        {item.payment_type === 'free' ? ` · ${t('wheel.freeSpin', 'фриспин')}` : ''}
                      </span>
                    </div>
                    <span className="wv">
                      {item.payment_type === 'free'
                        ? '—'
                        : item.payment_type === 'telegram_stars'
                          ? `${item.payment_amount} ⭐`
                          : `${item.payment_amount} ${t('common.units.days', 'дн')}`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">{t('wheel.noHistory')}</div>
            )}
          </div>

          <div className="card note-card">
            <div className="note">
              <span className="ni">
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
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8h.01M11 12h1v4h1" />
                </svg>
              </span>
              <span>
                {t(
                  'wheel.note',
                  'Выигрыши начисляются мгновенно: рубли — на баланс, дни — к подписке, гигабайты — к трафику.',
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
