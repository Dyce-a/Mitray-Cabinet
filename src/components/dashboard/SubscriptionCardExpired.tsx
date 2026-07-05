import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useLocation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { Subscription } from '../../types';
import { subscriptionApi } from '../../api/subscription';
import { useCurrency } from '../../hooks/useCurrency';
import { useHapticFeedback } from '../../platform/hooks/useHaptic';
import { getInsufficientBalanceError } from '../../utils/subscriptionHelpers';
import { cn } from '@/lib/utils';
import { ExclamationIcon, LockIcon, PlusIcon, SubscriptionIcon } from '@/components/icons';

interface SubscriptionCardExpiredProps {
  subscription: Subscription;
  balanceKopeks?: number;
  balanceRubles?: number;
  className?: string;
}

export default function SubscriptionCardExpired({
  subscription,
  balanceKopeks = 0,
  balanceRubles = 0,
  className,
}: SubscriptionCardExpiredProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { formatAmount, currencySymbol } = useCurrency();
  const haptic = useHapticFeedback();

  const [isRenewing, setIsRenewing] = useState(false);
  const [renewError, setRenewError] = useState<string | null>(null);

  const formattedDate = new Date(subscription.end_date).toLocaleDateString();

  // Detect limited (traffic exhausted) state
  const isLimited = subscription.is_limited;

  // Detect daily subscription (disabled or expired)
  const isDaily = subscription.is_daily;
  const isDisabledDaily = subscription.status === 'disabled' && isDaily;
  const isTrial = subscription.is_trial;

  // For daily subs, check if balance covers daily price; otherwise 100 kopeks minimum
  const dailyPrice = subscription.daily_price_kopeks ?? 0;
  const hasBalance = isDaily ? balanceKopeks >= dailyPrice && dailyPrice > 0 : balanceKopeks >= 100;

  // Traffic top-up is a per-tariff feature — some tariffs forbid it, and then
  // "Докупить трафик" would dead-end / error (memory cabinet-addon-tariff-error).
  // Only in the limited (traffic exhausted) state do we need to know: fetch the
  // tariff and, if top-up is off, steer the CTA to the tariffs page instead.
  const { data: purchaseOptions } = useQuery({
    queryKey: ['purchase-options', subscription.id],
    queryFn: () => subscriptionApi.getPurchaseOptions(subscription.id),
    enabled: isLimited,
    staleTime: 60_000,
  });
  const trafficTopupAvailable =
    purchaseOptions?.sales_mode === 'tariffs'
      ? purchaseOptions.tariffs.find(
          (tf) => tf.is_current || tf.id === purchaseOptions.current_tariff_id,
        )?.traffic_topup_enabled === true
      : true; // classic mode or still loading → assume available (page re-gates)

  const handleQuickRenew = async () => {
    setIsRenewing(true);
    setRenewError(null);
    haptic.buttonPressHeavy();

    try {
      if (isDisabledDaily) {
        // Resume daily subscription via toggle pause endpoint
        await subscriptionApi.togglePause(subscription.id);
      } else if (isDaily && subscription.tariff_id) {
        // Expired daily tariff — purchase for 1 day. Pass subscription.id
        // so the backend resolves the EXACT row instead of doing a
        // (user_id, tariff_id) re-lookup that races with concurrent
        // panel webhooks (would surface as "Тариф уже активен" + refund).
        await subscriptionApi.purchaseTariff(subscription.tariff_id, 1, undefined, subscription.id);
      } else {
        await subscriptionApi.renewSubscription(30, subscription.id);
      }
      haptic.success();
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
      });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
    } catch (err: unknown) {
      haptic.error();
      const insufficientData = getInsufficientBalanceError(err);
      if (insufficientData) {
        setRenewError(t('dashboard.expired.insufficientFunds'));
      } else if (err instanceof AxiosError) {
        const detail = err.response?.data?.detail;
        if (typeof detail === 'string') {
          setRenewError(detail);
        } else {
          setRenewError(t('dashboard.expired.renewError'));
        }
      } else {
        setRenewError(t('dashboard.expired.renewError'));
      }
    } finally {
      setIsRenewing(false);
    }
  };

  const handleTopUp = () => {
    haptic.buttonPress();
    const params = new URLSearchParams();
    params.set('returnTo', location.pathname);
    navigate(`/balance/top-up?${params.toString()}`);
  };

  // Heading / description / status badge per state.
  const badgeText = isLimited
    ? t('dashboard.status.limited', 'Лимит трафика')
    : isDisabledDaily
      ? t('dashboard.status.suspended', 'Приостановлено')
      : t('dashboard.status.disconnected', 'Отключено');

  const title = isLimited
    ? t('subscription.trafficLimitedTitle')
    : isDisabledDaily
      ? t('dashboard.suspended.title')
      : isTrial
        ? t('dashboard.expired.trialTitle')
        : t('dashboard.expired.title');

  const desc = isLimited
    ? trafficTopupAvailable
      ? t('subscription.trafficLimitedDescription')
      : t(
          'subscription.trafficLimitedNoTopup',
          'Трафик по этому тарифу нельзя докупить — смени тариф, чтобы получить больше.',
        )
    : isTrial
      ? t('dashboard.expired.trialSubtitle')
      : t('dashboard.expired.paidSubtitle');

  const whenLabel = isLimited
    ? t('dashboard.expired.activeUntil')
    : t('dashboard.expired.expiredDate', { context: isTrial ? 'trial' : '' });

  return (
    <section
      className={cn('lk', isLimited ? 'lk--limited' : 'lk--expired', className)}
      style={{ boxShadow: '0 24px 60px -34px rgba(0,0,0,.55)' }}
    >
      <div className="lk-top">
        <span className="lk-badge">
          <span className="lk-dot" aria-hidden="true" />
          {badgeText}
        </span>
        <span className="lk-when">
          {whenLabel} · {formattedDate}
        </span>
      </div>

      {/* emblem: broken "signal lost" rings around a padlock (exclamation for limited) */}
      <div className="lk-emblem" aria-hidden="true">
        <span className="lk-ring r1" />
        <span className="lk-ring r2" />
        <span className="lk-ring r3" />
        <span className="lk-circle">
          {isLimited ? (
            <ExclamationIcon className="h-[30px] w-[30px]" />
          ) : (
            <LockIcon className="h-[30px] w-[30px]" />
          )}
        </span>
      </div>

      <h2 className="lk-title">{title}</h2>
      <p className="lk-desc">{desc}</p>

      {renewError && (
        <div className="lk-err" role="alert">
          {renewError}
        </div>
      )}

      <div className="lk-actions">
        {isLimited ? (
          trafficTopupAvailable ? (
            <Link to={`/subscriptions/${subscription.id}`} className="lk-cta">
              <PlusIcon className="h-4 w-4" />
              {t('subscription.buyTraffic')}
            </Link>
          ) : (
            <Link to="/subscription/purchase" className="lk-cta">
              <SubscriptionIcon className="h-4 w-4" />
              {t('dashboard.expired.tariffs')}
            </Link>
          )
        ) : isTrial ? (
          <Link to="/subscription/purchase" className="lk-cta">
            <SubscriptionIcon className="h-4 w-4" />
            {t('dashboard.expired.tariffs')}
          </Link>
        ) : (
          <>
            {hasBalance ? (
              <button
                type="button"
                onClick={handleQuickRenew}
                disabled={isRenewing}
                className="lk-cta"
              >
                {isRenewing ? (
                  <span className="lk-spin" aria-hidden="true" />
                ) : (
                  <SubscriptionIcon className="h-4 w-4" />
                )}
                {isRenewing
                  ? t('common.loading')
                  : isDisabledDaily
                    ? t('dashboard.suspended.resume')
                    : t('dashboard.expired.quickRenew')}
              </button>
            ) : (
              <button type="button" onClick={handleTopUp} className="lk-cta">
                <PlusIcon className="h-4 w-4" />
                {t('dashboard.expired.topUp')}
              </button>
            )}
            <Link to="/subscription/purchase" className="lk-alt">
              {t('dashboard.expired.tariffs')}
            </Link>
          </>
        )}
      </div>

      <div className="lk-bal">
        {t('dashboard.expired.balance')}{' '}
        <b className={hasBalance ? 'ok' : undefined}>
          {formatAmount(balanceRubles)} {currencySymbol}
        </b>
        {hasBalance &&
          !isLimited &&
          ` · ${t('dashboard.expired.fromBalance', 'спишется с баланса')}`}
      </div>
    </section>
  );
}
