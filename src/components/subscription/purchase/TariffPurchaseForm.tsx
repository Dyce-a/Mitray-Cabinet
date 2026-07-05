import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionApi } from '../../../api/subscription';
import { getErrorMessage, getInsufficientBalanceError } from '../../../utils/subscriptionHelpers';
import { useCurrency } from '../../../hooks/useCurrency';
import { usePromoDiscount } from '../../../hooks/usePromoDiscount';
import InsufficientBalancePrompt from '../../InsufficientBalancePrompt';
import { ArrowDownIcon, DevicesIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { Tariff, TariffPeriod } from '../../../types';

// ──────────────────────────────────────────────────────────────────
// TariffPurchaseForm (redesign — see purchase.css .pv-grid)
//
// Per-tariff purchase: period picker (or daily-tariff activate), custom-days
// toggle + slider, custom-traffic toggle + slider, a live summary panel, and the
// confirm CTA. Restyled to the prototype's picker + summary layout; ALL purchase
// logic (mutation, promo pricing, custom options, balance checks) is unchanged.
// Form-internal state resets via key={tariff.id} on the parent's render.
// ──────────────────────────────────────────────────────────────────

export interface TariffPurchaseFormProps {
  tariff: Tariff;
  subscriptionId: number | undefined;
  balanceKopeks: number | undefined;
  onBack: () => void;
}

export function TariffPurchaseForm({
  tariff,
  subscriptionId,
  balanceKopeks,
  onBack,
}: TariffPurchaseFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { formatAmount, currencySymbol } = useCurrency();
  const { applyPromoDiscount } = usePromoDiscount();
  const ref = useRef<HTMLDivElement>(null);

  const formatPrice = (kopeks: number) =>
    kopeks === 0
      ? t('subscription.free', 'Бесплатно')
      : `${formatAmount(kopeks / 100)} ${currencySymbol}`;

  const [selectedTariffPeriod, setSelectedTariffPeriod] = useState<TariffPeriod | null>(
    tariff.periods[0] || null,
  );
  const [customDays, setCustomDays] = useState<number>(30);
  const [customTrafficGb, setCustomTrafficGb] = useState<number>(50);
  const [useCustomDays, setUseCustomDays] = useState(false);
  const [useCustomTraffic, setUseCustomTraffic] = useState(false);

  const isDailyTariff = Boolean(
    tariff.is_daily || (tariff.daily_price_kopeks && tariff.daily_price_kopeks > 0),
  );

  const purchaseMutation = useMutation({
    mutationFn: () => {
      const days = isDailyTariff
        ? 1
        : useCustomDays
          ? customDays
          : selectedTariffPeriod?.days || 30;
      const trafficGb =
        useCustomTraffic && tariff.custom_traffic_enabled ? customTrafficGb : undefined;
      return subscriptionApi.purchaseTariff(
        tariff.id,
        days,
        trafficGb,
        subscriptionId ?? undefined,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      navigate('/subscriptions', { replace: true });
    },
  });

  // Smooth scroll the form into view when first mounted.
  useEffect(() => {
    if (ref.current) {
      const timer = setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  const specs = (
    <div className="pv-specs">
      <div className="ps">
        <ArrowDownIcon className="h-4 w-4" />
        <span className="s-mut">{t('subscription.traffic')}:</span>&nbsp;
        <b>{tariff.traffic_limit_label}</b>
      </div>
      <div className="ps">
        <DevicesIcon className="h-4 w-4" />
        <span className="s-mut">{t('subscription.devices')}:</span>&nbsp;
        <b>
          {tariff.device_limit === 0 ? '∞' : tariff.device_limit}
          {tariff.extra_devices_count > 0 && (
            <span style={{ color: 'var(--accent)' }}> (+{tariff.extra_devices_count})</span>
          )}
        </b>
      </div>
    </div>
  );

  const spinner = (
    <span
      style={{
        display: 'inline-block',
        width: 16,
        height: 16,
        border: '2px solid rgba(255,255,255,0.5)',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'p-spin 0.8s linear infinite',
      }}
    />
  );

  // ── Daily tariff: activate (single day, auto-charged) ──
  if (isDailyTariff) {
    const dailyPrice = tariff.daily_price_kopeks || 0;
    const hasEnoughBalance = balanceKopeks !== undefined && dailyPrice <= balanceKopeks;
    return (
      <div ref={ref} className="space-y-4">
        <div className="back-row">
          <button className="back-link" onClick={onBack}>
            ← {t('common.back')}
          </button>
        </div>
        <div className="card">
          <div className="pv-name">{tariff.name}</div>
          {specs}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div className="pv-label" style={{ marginBottom: 6 }}>
              {t('subscription.dailyPurchase.costPerDay')}
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>
              {formatPrice(dailyPrice)}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              t('subscription.dailyPurchase.chargedDaily'),
              t('subscription.dailyPurchase.canPause'),
              t('subscription.dailyPurchase.pausedOnLowBalance'),
            ].map((line, i) => (
              <div key={i} className="pv-note" style={{ marginTop: 0 }}>
                <span style={{ color: 'var(--accent)' }}>•</span>
                {line}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20 }}>
            {balanceKopeks !== undefined && !hasEnoughBalance && (
              <InsufficientBalancePrompt
                missingAmountKopeks={dailyPrice - balanceKopeks}
                compact
                className="mb-4"
              />
            )}
            <button
              className="p-btn"
              onClick={() => purchaseMutation.mutate()}
              disabled={purchaseMutation.isPending}
            >
              {purchaseMutation.isPending
                ? spinner
                : t('subscription.dailyPurchase.activate', { price: formatPrice(dailyPrice) })}
            </button>
            {purchaseMutation.isError && !getInsufficientBalanceError(purchaseMutation.error) && (
              <div className="pv-err">{getErrorMessage(purchaseMutation.error)}</div>
            )}
            {purchaseMutation.isError && getInsufficientBalanceError(purchaseMutation.error) && (
              <div style={{ marginTop: 12 }}>
                <InsufficientBalancePrompt
                  missingAmountKopeks={
                    getInsufficientBalanceError(purchaseMutation.error)?.missingAmount ||
                    dailyPrice - (balanceKopeks || 0)
                  }
                  compact
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Non-daily: period picker + custom options + summary ──
  const hasSelection = Boolean(selectedTariffPeriod || useCustomDays);

  // Summary pricing (mirrors the original bottom-of-form calc).
  const basePeriodPrice = useCustomDays
    ? customDays * (tariff.price_per_day_kopeks ?? 0)
    : selectedTariffPeriod?.price_kopeks || 0;
  const existingPeriodOriginal = useCustomDays
    ? tariff.original_price_per_day_kopeks &&
      tariff.original_price_per_day_kopeks > (tariff.price_per_day_kopeks ?? 0)
      ? customDays * tariff.original_price_per_day_kopeks
      : undefined
    : selectedTariffPeriod?.original_price_kopeks &&
        selectedTariffPeriod.original_price_kopeks > selectedTariffPeriod.price_kopeks
      ? selectedTariffPeriod.original_price_kopeks
      : undefined;
  const promoPeriod = applyPromoDiscount(basePeriodPrice, existingPeriodOriginal);
  const trafficPrice =
    useCustomTraffic && tariff.custom_traffic_enabled
      ? customTrafficGb * (tariff.traffic_price_per_gb_kopeks ?? 0)
      : 0;
  const totalPrice = promoPeriod.price + trafficPrice;
  const originalTotal = promoPeriod.original ? promoPeriod.original + trafficPrice : null;
  const notEnough = balanceKopeks !== undefined && totalPrice > balanceKopeks;

  const noPeriods =
    tariff.periods.length === 0 &&
    !useCustomDays &&
    !(tariff.custom_days_enabled && (tariff.price_per_day_kopeks ?? 0) > 0);

  return (
    <div ref={ref} className="space-y-4">
      <div className="back-row">
        <button className="back-link" onClick={onBack}>
          ← {t('subscription.backToTariffs', 'Назад к тарифам')}
        </button>
      </div>

      <div className="pv-grid">
        {/* Left: picker */}
        <div className="card">
          <div className="pv-name">{tariff.name}</div>
          {specs}

          {/* Period selection */}
          {tariff.periods.length > 0 && !useCustomDays && (
            <>
              <div className="pv-label">{t('subscription.selectPeriod')}</div>
              <div className="periods">
                {tariff.periods.map((period) => {
                  const promo = applyPromoDiscount(
                    period.price_kopeks,
                    period.original_price_kopeks,
                  );
                  const perMonth =
                    promo.price !== period.price_kopeks
                      ? Math.round(promo.price / Math.max(1, period.days / 30))
                      : period.price_per_month_kopeks;
                  const selected = selectedTariffPeriod?.days === period.days && !useCustomDays;
                  return (
                    <button
                      key={period.days}
                      className={cn('period', selected && 'on')}
                      onClick={() => {
                        setSelectedTariffPeriod(period);
                        setUseCustomDays(false);
                      }}
                    >
                      {promo.percent && promo.percent > 0 && (
                        <span className={cn('save', !promo.isPromoGroup && 'promo')}>
                          -{promo.percent}%
                        </span>
                      )}
                      <div className="pd">{period.label}</div>
                      <div className="pp">
                        {formatPrice(promo.price)}
                        {promo.original && promo.original > promo.price && (
                          <span className="old">{formatPrice(promo.original)}</span>
                        )}
                      </div>
                      <div className="pm">
                        {formatPrice(perMonth)}/{t('subscription.month')}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* No periods fallback */}
          {noPeriods && (
            <div className="pv-opt" style={{ marginTop: 0 }}>
              <div className="pv-opt-h">
                <span className="lbl" style={{ color: 'var(--warn)' }}>
                  {t('subscription.noPeriodsAvailable')}
                </span>
              </div>
              <p className="pv-calc" style={{ marginTop: 8 }}>
                {t('subscription.noPeriodsAvailableHint')}
              </p>
              <button className="p-btn-soft" style={{ marginTop: 12 }} onClick={onBack}>
                {t('subscription.chooseDifferentTariff')}
              </button>
            </div>
          )}

          {/* Custom days */}
          {tariff.custom_days_enabled && (tariff.price_per_day_kopeks ?? 0) > 0 && (
            <div className="pv-opt">
              <div className="pv-opt-h">
                <span className="lbl">{t('subscription.customDays.title')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={useCustomDays}
                  aria-label={t('subscription.customDays.title')}
                  className={cn('pv-sw', useCustomDays && 'on')}
                  onClick={() => setUseCustomDays(!useCustomDays)}
                />
              </div>
              {useCustomDays && (
                <div className="pv-opt-body">
                  <div className="pv-range-row">
                    <input
                      type="range"
                      min={tariff.min_days ?? 1}
                      max={tariff.max_days ?? 365}
                      value={customDays}
                      onChange={(e) => setCustomDays(parseInt(e.target.value))}
                    />
                    <input
                      type="number"
                      className="pv-num"
                      value={customDays}
                      min={tariff.min_days ?? 1}
                      max={tariff.max_days ?? 365}
                      onChange={(e) =>
                        setCustomDays(
                          Math.max(
                            tariff.min_days ?? 1,
                            Math.min(
                              tariff.max_days ?? 365,
                              parseInt(e.target.value) || (tariff.min_days ?? 1),
                            ),
                          ),
                        )
                      }
                    />
                  </div>
                  {(() => {
                    const basePrice = customDays * (tariff.price_per_day_kopeks ?? 0);
                    const existingOriginal =
                      tariff.original_price_per_day_kopeks &&
                      tariff.original_price_per_day_kopeks > (tariff.price_per_day_kopeks ?? 0)
                        ? customDays * tariff.original_price_per_day_kopeks
                        : undefined;
                    const promo = applyPromoDiscount(basePrice, existingOriginal);
                    return (
                      <div className="pv-calc">
                        <span>
                          {t('subscription.days', { count: customDays })} ×{' '}
                          {formatPrice(tariff.price_per_day_kopeks ?? 0)}
                        </span>
                        <span className="amt">
                          {formatPrice(promo.price)}
                          {promo.original && promo.original > promo.price && (
                            <span className="old">{formatPrice(promo.original)}</span>
                          )}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Custom traffic */}
          {tariff.custom_traffic_enabled && (tariff.traffic_price_per_gb_kopeks ?? 0) > 0 && (
            <div className="pv-opt">
              <div className="pv-opt-h">
                <span className="lbl">{t('subscription.customTraffic.selectVolume')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={useCustomTraffic}
                  aria-label={t('subscription.customTraffic.selectVolume')}
                  className={cn('pv-sw', useCustomTraffic && 'on')}
                  onClick={() => setUseCustomTraffic(!useCustomTraffic)}
                />
              </div>
              {!useCustomTraffic ? (
                <p className="pv-calc" style={{ marginTop: 12 }}>
                  {t('subscription.customTraffic.default', { label: tariff.traffic_limit_label })}
                </p>
              ) : (
                <div className="pv-opt-body">
                  <div className="pv-range-row">
                    <input
                      type="range"
                      min={tariff.min_traffic_gb ?? 1}
                      max={tariff.max_traffic_gb ?? 1000}
                      value={customTrafficGb}
                      onChange={(e) => setCustomTrafficGb(parseInt(e.target.value))}
                    />
                    <input
                      type="number"
                      className="pv-num"
                      value={customTrafficGb}
                      min={tariff.min_traffic_gb ?? 1}
                      max={tariff.max_traffic_gb ?? 1000}
                      onChange={(e) =>
                        setCustomTrafficGb(
                          Math.max(
                            tariff.min_traffic_gb ?? 1,
                            Math.min(
                              tariff.max_traffic_gb ?? 1000,
                              parseInt(e.target.value) || (tariff.min_traffic_gb ?? 1),
                            ),
                          ),
                        )
                      }
                    />
                    <span className="s-mut">{t('common.units.gb')}</span>
                  </div>
                  <div className="pv-calc">
                    <span>
                      {customTrafficGb} {t('common.units.gb')} ×{' '}
                      {formatPrice(tariff.traffic_price_per_gb_kopeks ?? 0)}
                    </span>
                    <span className="amt">
                      +{formatPrice(customTrafficGb * (tariff.traffic_price_per_gb_kopeks ?? 0))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: summary */}
        {hasSelection && (
          <div className="card summary">
            <div className="sum-row">
              <span>{t('subscription.tariff', 'Тариф')}</span>
              <b>{tariff.name}</b>
            </div>

            {useCustomDays ? (
              <div className="sum-row">
                <span>{t('subscription.stepPeriod')}</span>
                <b>
                  {t('subscription.days', { count: customDays })}
                  {promoPeriod.original && promoPeriod.original > promoPeriod.price && (
                    <span className="old">{formatPrice(promoPeriod.original)}</span>
                  )}
                </b>
              </div>
            ) : (
              selectedTariffPeriod &&
              ((selectedTariffPeriod.extra_devices_count ?? 0) > 0 &&
              selectedTariffPeriod.base_tariff_price_kopeks ? (
                <>
                  <div className="sum-row">
                    <span>{t('subscription.baseTariff')}</span>
                    <b>{formatPrice(selectedTariffPeriod.base_tariff_price_kopeks)}</b>
                  </div>
                  <div className="sum-row">
                    <span>
                      {t('subscription.extraDevices')} ({selectedTariffPeriod.extra_devices_count})
                    </span>
                    <b>+{formatPrice(selectedTariffPeriod.extra_devices_cost_kopeks ?? 0)}</b>
                  </div>
                </>
              ) : (
                <div className="sum-row">
                  <span>{selectedTariffPeriod.label}</span>
                  <b>
                    {formatPrice(promoPeriod.price)}
                    {promoPeriod.original && promoPeriod.original > promoPeriod.price && (
                      <span className="old">{formatPrice(promoPeriod.original)}</span>
                    )}
                  </b>
                </div>
              ))
            )}

            {useCustomTraffic && tariff.custom_traffic_enabled && (
              <div className="sum-row">
                <span>{t('subscription.summary.traffic', { gb: customTrafficGb })}</span>
                <b>+{formatPrice(trafficPrice)}</b>
              </div>
            )}

            {promoPeriod.percent && (
              <div className="promo-chip">
                {t('promo.discountApplied')} -{promoPeriod.percent}%
              </div>
            )}

            <div className="sum-total">
              <span className="lab">{t('subscription.total')}</span>
              <span className="tv">
                <span className="val">{formatPrice(totalPrice)}</span>
                {originalTotal && <span className="old">{formatPrice(originalTotal)}</span>}
              </span>
            </div>

            {balanceKopeks !== undefined && (
              <div className="bal-line">
                <span>{t('balance.current', 'На балансе')}</span>
                <span className="bv">{formatPrice(balanceKopeks)}</span>
              </div>
            )}

            {notEnough && (
              <InsufficientBalancePrompt
                missingAmountKopeks={totalPrice - (balanceKopeks ?? 0)}
                compact
                className="mb-3"
              />
            )}

            <button
              className="p-btn"
              onClick={() => purchaseMutation.mutate()}
              disabled={purchaseMutation.isPending}
            >
              {purchaseMutation.isPending ? spinner : t('subscription.purchase')}
            </button>

            {purchaseMutation.isError && !getInsufficientBalanceError(purchaseMutation.error) && (
              <div className="pv-err">{getErrorMessage(purchaseMutation.error)}</div>
            )}
            {purchaseMutation.isError && getInsufficientBalanceError(purchaseMutation.error) && (
              <div style={{ marginTop: 12 }}>
                <InsufficientBalancePrompt
                  missingAmountKopeks={
                    getInsufficientBalanceError(purchaseMutation.error)?.missingAmount || 0
                  }
                  compact
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
