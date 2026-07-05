import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCurrency } from '../../../hooks/useCurrency';
import { usePromoDiscount } from '../../../hooks/usePromoDiscount';
import { ArrowDownIcon, DevicesIcon, RestartIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { Tariff, Subscription, PurchaseOptions } from '../../../types';

// ──────────────────────────────────────────────────────────────────
// TariffPickerGrid
//
// The tariff selection surface inside SubscriptionPurchase (redesign
// .tcard grid — see purchase.css). Renders an optional promo-group
// banner, the "all tariffs purchased" empty state, and the grid with
// promo prices + per-tariff CTAs (extend / switch / purchase / legacy).
// Pure presentation — calls back for selection / switch.
// ──────────────────────────────────────────────────────────────────

export interface TariffPickerGridProps {
  tariffs: Tariff[];
  subscription: Subscription | null;
  purchaseOptions: PurchaseOptions | undefined;
  isTariffsMode: boolean;
  isMultiTariff: boolean;
  onSelectTariff: (tariff: Tariff) => void;
  onSwitchTariff: (tariffId: number) => void;
}

export function TariffPickerGrid({
  tariffs,
  subscription,
  purchaseOptions,
  isTariffsMode,
  isMultiTariff,
  onSelectTariff,
  onSwitchTariff,
}: TariffPickerGridProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatAmount, currencySymbol } = useCurrency();
  const { applyPromoDiscount } = usePromoDiscount();

  const formatPrice = (kopeks: number) =>
    kopeks === 0
      ? t('subscription.free', 'Бесплатно')
      : `${formatAmount(kopeks / 100)} ${currencySymbol}`;

  // Price line for a tariff card (daily rate or "from <min period>").
  const renderPrice = (tariff: Tariff) => {
    const dailyPrice = tariff.daily_price_kopeks ?? tariff.price_per_day_kopeks ?? 0;
    const originalDailyPrice = tariff.original_daily_price_kopeks || 0;
    if (dailyPrice > 0 || originalDailyPrice > 0) {
      const promo = applyPromoDiscount(
        dailyPrice,
        originalDailyPrice > dailyPrice ? originalDailyPrice : undefined,
      );
      return (
        <div className="tc-price">
          <span className="val">{formatPrice(promo.price)}</span>
          <span className="per">/ {t('subscription.tariff.perDay', 'день')}</span>
          {promo.original && promo.original > promo.price && (
            <span className="old">{formatPrice(promo.original)}</span>
          )}
          {promo.percent && promo.percent > 0 && (
            <span className={cn('disc', !promo.isPromoGroup && 'promo')}>-{promo.percent}%</span>
          )}
        </div>
      );
    }
    if (tariff.periods.length > 0) {
      const first = tariff.periods[0];
      const promo = applyPromoDiscount(first?.price_kopeks || 0, first?.original_price_kopeks);
      return (
        <div className="tc-price">
          <span className="from">{t('subscription.from')}</span>
          <span className="val">{formatPrice(promo.price)}</span>
          {promo.original && promo.original > promo.price && (
            <span className="old">{formatPrice(promo.original)}</span>
          )}
          {promo.percent && promo.percent > 0 && (
            <span className={cn('disc', !promo.isPromoGroup && 'promo')}>-{promo.percent}%</span>
          )}
        </div>
      );
    }
    return (
      <div className="tc-price">
        <span className="val" style={{ fontSize: 16 }}>
          {t('subscription.tariff.flexiblePayment')}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Promo group discount banner */}
      {tariffs.some((tariff) => tariff.promo_group_name) && (
        <div className="banner reveal d1 group">
          <span className="bi">
            <svg
              className="h-[22px] w-[22px]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
              />
            </svg>
          </span>
          <div>
            <b>
              {t('subscription.promoGroup.yourGroup', {
                name: tariffs.find((tariff) => tariff.promo_group_name)?.promo_group_name,
              })}
            </b>
            <p>{t('subscription.promoGroup.personalDiscountsApplied')}</p>
          </div>
        </div>
      )}

      {/* All tariffs purchased (multi-tariff) */}
      {isMultiTariff &&
        purchaseOptions &&
        'all_tariffs_purchased' in purchaseOptions &&
        purchaseOptions.all_tariffs_purchased && (
          <div className="card pstate reveal d1">
            <div className="em">✅</div>
            <h3>{t('subscription.allTariffsPurchased', 'Все тарифы подключены')}</h3>
            <p>
              {t(
                'subscription.allTariffsPurchasedDesc',
                'Вы уже приобрели все доступные тарифы. Продлить подписку можно на странице тарифа.',
              )}
            </p>
            <button className="p-btn" onClick={() => navigate('/subscriptions')}>
              {t('subscription.backToList', 'Мои подписки')}
            </button>
          </div>
        )}

      {/* Grid */}
      <div className="tgrid">
        {[...tariffs]
          .filter((tariff) => {
            if (isMultiTariff && tariff.is_purchased) return false;
            if (subscription?.is_trial && tariff.name.toLowerCase().includes('trial')) return false;
            return true;
          })
          .sort((a, b) => {
            const aIsCurrent = a.is_current || a.id === subscription?.tariff_id;
            const bIsCurrent = b.is_current || b.id === subscription?.tariff_id;
            if (aIsCurrent && !bIsCurrent) return -1;
            if (!aIsCurrent && bIsCurrent) return 1;
            return 0;
          })
          .map((tariff, idx) => {
            const isCurrentTariff = tariff.is_current || tariff.id === subscription?.tariff_id;
            const isSubscriptionExpired =
              isTariffsMode &&
              purchaseOptions &&
              'subscription_is_expired' in purchaseOptions &&
              purchaseOptions.subscription_is_expired === true;
            const canSwitch =
              !isMultiTariff &&
              subscription &&
              subscription.tariff_id &&
              !isCurrentTariff &&
              !subscription.is_trial &&
              !isSubscriptionExpired &&
              (subscription.is_active || subscription.is_limited);
            const isLegacySubscription =
              subscription && !subscription.is_trial && !subscription.tariff_id;

            return (
              <div
                key={tariff.id}
                className={cn(
                  'card tcard reveal',
                  `d${Math.min(idx + 1, 4)}`,
                  isCurrentTariff && 'current',
                )}
              >
                <div className="tc-top">
                  <div className="tc-name">{tariff.name}</div>
                  {isCurrentTariff && (
                    <span className="tc-badge">{t('subscription.currentTariff')}</span>
                  )}
                </div>
                {tariff.description && <div className="tc-desc">{tariff.description}</div>}

                <div className="tc-specs">
                  <div className="spec">
                    <ArrowDownIcon className="h-4 w-4" />
                    {tariff.traffic_limit_label}
                  </div>
                  <div className="spec">
                    <DevicesIcon className="h-4 w-4" />
                    {tariff.device_limit === 0
                      ? '∞'
                      : t('subscription.devices', { count: tariff.device_limit })}
                  </div>
                  {tariff.traffic_reset_mode && tariff.traffic_reset_mode !== 'NO_RESET' && (
                    <div className="spec">
                      <RestartIcon className="h-4 w-4" />
                      <span className="s-mut">
                        {t(`subscription.trafficReset.${tariff.traffic_reset_mode}`)}
                      </span>
                    </div>
                  )}
                </div>

                {renderPrice(tariff)}

                {/* CTA */}
                {isCurrentTariff ? (
                  subscription?.is_daily ? (
                    <div className="btn-current">{t('subscription.currentTariff')}</div>
                  ) : (
                    <button className="p-btn" onClick={() => onSelectTariff(tariff)}>
                      {t('subscription.extend')}
                    </button>
                  )
                ) : isLegacySubscription ? (
                  <button className="p-btn" onClick={() => onSelectTariff(tariff)}>
                    {t('subscription.tariff.selectForRenewal')}
                  </button>
                ) : canSwitch ? (
                  <button className="p-btn-soft" onClick={() => onSwitchTariff(tariff.id)}>
                    {t('subscription.switchTariff.switch')}
                  </button>
                ) : (
                  <button className="p-btn" onClick={() => onSelectTariff(tariff)}>
                    {t('subscription.purchase')}
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
