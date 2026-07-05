import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { subscriptionApi } from '../api/subscription';
import type { Tariff, ClassicPurchaseOptions } from '../types';
import { useCloseOnSuccessNotification } from '../store/successNotification';
import { SwitchTariffSheet } from '../components/subscription/sheets/SwitchTariffSheet';
import { TariffPurchaseForm } from '../components/subscription/purchase/TariffPurchaseForm';
import { TariffPickerGrid } from '../components/subscription/purchase/TariffPickerGrid';
import { ClassicPurchaseWizard } from '../components/subscription/purchase/ClassicPurchaseWizard';
import { ExclamationIcon, SparklesIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import '../styles/purchase.css';

export default function SubscriptionPurchase() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const subscriptionId = searchParams.get('subscriptionId')
    ? parseInt(searchParams.get('subscriptionId')!, 10)
    : undefined;

  // Reveal stagger — add `.in` to the root after first paint (see purchase.css).
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

  // Subscription query (shares cache with /subscription page)
  const { data: subscriptionResponse, isLoading } = useQuery({
    queryKey: ['subscription', subscriptionId],
    queryFn: () => subscriptionApi.getSubscription(subscriptionId),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const subscription = subscriptionResponse?.subscription ?? null;

  // Purchase options
  const {
    data: purchaseOptions,
    isLoading: optionsLoading,
    isError: optionsError,
    refetch: refetchOptions,
  } = useQuery({
    queryKey: ['purchase-options', subscriptionId],
    queryFn: () => subscriptionApi.getPurchaseOptions(subscriptionId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Sales mode detection
  const isTariffsMode = purchaseOptions?.sales_mode === 'tariffs';
  const classicOptions = !isTariffsMode ? (purchaseOptions as ClassicPurchaseOptions) : null;
  const tariffs =
    isTariffsMode && purchaseOptions && 'tariffs' in purchaseOptions ? purchaseOptions.tariffs : [];

  // Multi-tariff: check via subscriptions list query
  const { data: multiSubData } = useQuery({
    queryKey: ['subscriptions-list'],
    queryFn: () => subscriptionApi.getSubscriptions(),
    staleTime: 60_000,
  });
  const isMultiTariff = multiSubData?.multi_tariff_enabled ?? false;

  // Tariffs mode state
  const [selectedTariff, setSelectedTariff] = useState<Tariff | null>(null);
  const [showTariffPurchase, setShowTariffPurchase] = useState(false);

  // Tariff switch
  const [switchTariffId, setSwitchTariffId] = useState<number | null>(null);

  // Auto-close all modals on success notification
  const handleCloseAllModals = () => {
    setShowTariffPurchase(false);
    setSwitchTariffId(null);
    setSelectedTariff(null);
  };
  useCloseOnSuccessNotification(handleCloseAllModals);

  const pageTitle =
    isMultiTariff && !subscriptionId
      ? t('subscription.newTariff', 'Новый тариф')
      : !isMultiTariff && subscription?.is_daily && !subscription?.is_trial
        ? t('subscription.switchTariff.title')
        : subscription && !subscription.is_trial
          ? t('subscription.extend')
          : t('subscription.getSubscription');

  if (isLoading || optionsLoading) {
    return (
      <div className="mitray-purchase">
        <div className="p-loader">
          <span className="p-spin" />
        </div>
      </div>
    );
  }

  if (optionsError || (!purchaseOptions && !optionsLoading)) {
    return (
      <div className={cn('mitray-purchase', revealed && 'in')}>
        <div className="phead">
          <h1>{t('subscription.extend')}</h1>
        </div>
        <div className="card pstate reveal d1" style={{ marginTop: 18 }}>
          <p>{t('subscription.loadError', 'Не удалось загрузить варианты подписки')}</p>
          <button className="p-btn" onClick={() => refetchOptions()}>
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  const subscriptionIsExpired =
    isTariffsMode &&
    purchaseOptions &&
    'subscription_is_expired' in purchaseOptions &&
    purchaseOptions.subscription_is_expired === true;

  return (
    <div className={cn('mitray-purchase space-y-4', revealed && 'in')}>
      {/* Head */}
      <div className="phead reveal d1">
        <div className="crumb">
          {t('nav.cabinet', 'Кабинет')} ·{' '}
          <Link to="/subscriptions" style={{ color: 'inherit' }}>
            {t('nav.subscription', 'Подписки')}
          </Link>{' '}
          · <b>{pageTitle}</b>
        </div>
        <h1>{pageTitle}</h1>
      </div>

      {/* Tariffs mode */}
      {isTariffsMode && tariffs.length > 0 && (
        <div className="space-y-4">
          {/* Trial upgrade prompt — hidden when the expired banner is active */}
          {subscription?.is_trial && !subscriptionIsExpired && (
            <div className="banner warn reveal d1">
              <span className="bi">
                <SparklesIcon className="h-[22px] w-[22px]" />
              </span>
              <div>
                <b>{t('subscription.trialUpgrade.title')}</b>
                <p>{t('subscription.trialUpgrade.description')}</p>
              </div>
            </div>
          )}

          {/* Expired subscription notice */}
          {subscriptionIsExpired && (
            <div className="banner expired reveal d1">
              <span className="bi">
                <ExclamationIcon className="h-[22px] w-[22px]" />
              </span>
              <div>
                <b>{t('subscription.expiredBanner.title')}</b>
                <p>{t('subscription.expiredBanner.selectTariff')}</p>
              </div>
            </div>
          )}

          {/* Legacy subscription notice */}
          {subscription && !subscription.is_trial && !subscription.tariff_id && (
            <div className="banner info reveal d1">
              <span className="bi">
                <SparklesIcon className="h-[22px] w-[22px]" />
              </span>
              <div>
                <b>{t('subscription.legacy.selectTariffTitle')}</b>
                <p>
                  {t('subscription.legacy.selectTariffDescription')}{' '}
                  {t('subscription.legacy.currentSubContinues')}
                </p>
              </div>
            </div>
          )}

          {/* Switch Tariff Preview Modal */}
          <SwitchTariffSheet
            open={switchTariffId !== null}
            tariffId={switchTariffId}
            subscriptionId={subscriptionId}
            tariffs={tariffs}
            onClose={() => setSwitchTariffId(null)}
            onExpiredFallback={(tariff) => {
              setSelectedTariff(tariff);
              setShowTariffPurchase(true);
            }}
          />

          {/* Keyed .view-swap wrappers replay a rise-in animation on every
              list ⇄ period-form switch (the prototype's animateIn) — without
              them the other view popped in instantly because the page-level
              `.in` reveal had already fired. */}
          {!showTariffPurchase ? (
            <div key="tariff-grid" className="view-swap">
              <TariffPickerGrid
                tariffs={tariffs}
                subscription={subscription}
                purchaseOptions={purchaseOptions}
                isTariffsMode={isTariffsMode}
                isMultiTariff={isMultiTariff}
                onSelectTariff={(tariff) => {
                  setSelectedTariff(tariff);
                  setShowTariffPurchase(true);
                }}
                onSwitchTariff={(tariffId) => setSwitchTariffId(tariffId)}
              />
            </div>
          ) : (
            selectedTariff && (
              <div key={`tariff-form-${selectedTariff.id}`} className="view-swap">
                <TariffPurchaseForm
                  key={selectedTariff.id}
                  tariff={selectedTariff}
                  subscriptionId={subscriptionId}
                  balanceKopeks={purchaseOptions?.balance_kopeks}
                  onBack={() => {
                    setShowTariffPurchase(false);
                    setSelectedTariff(null);
                  }}
                />
              </div>
            )
          )}
        </div>
      )}

      {/* Classic mode */}
      {classicOptions && classicOptions.periods.length > 0 && (
        <ClassicPurchaseWizard
          classicOptions={classicOptions}
          subscription={subscription}
          subscriptionId={subscriptionId}
        />
      )}

      {/* No options available fallback */}
      {purchaseOptions &&
        !optionsLoading &&
        !(isTariffsMode && tariffs.length > 0) &&
        !(classicOptions && classicOptions.periods.length > 0) && (
          <div className="card pstate reveal d1">
            <p>{t('subscription.noOptionsAvailable', 'Нет доступных вариантов подписки')}</p>
            <button className="p-btn" onClick={() => refetchOptions()}>
              {t('common.retry')}
            </button>
          </div>
        )}
    </div>
  );
}
