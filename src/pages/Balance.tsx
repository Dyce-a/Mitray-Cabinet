import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router';

import { useAuthStore } from '../store/auth';
import { balanceApi } from '../api/balance';
import { useCurrency } from '../hooks/useCurrency';
import { API } from '../config/constants';
import { cn } from '@/lib/utils';
import type { PaginatedResponse, Transaction } from '../types';
import { isPaidStatus, isFailedStatus } from '../utils/paymentStatus';
import '../styles/balance.css';

// Transaction category → icon path (matches the prototype's four tx types).
type TxCategory = 'dep' | 'com' | 'deb' | 'bon';
const TX_ICON: Record<TxCategory, string> = {
  dep: 'M12 5v14M5 12l7 7 7-7',
  deb: 'M12 19V5M5 12l7-7 7 7',
  com: 'M19 5L5 19M9 6.5A2.5 2.5 0 1 1 4 6.5a2.5 2.5 0 0 1 5 0zM20 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  bon: 'M12 3l2.2 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.8-.5z',
};

function txCategory(tx: Transaction): TxCategory {
  const type = (tx.type || '').toUpperCase();
  const amt = tx.amount_rubles;
  if (type === 'REFERRAL_REWARD') return 'com';
  if (amt > 0 && /BONUS|WHEEL|PROMO|GIFT|CASHBACK|LOTTERY/.test(type)) return 'bon';
  if (amt < 0) return 'deb';
  return 'dep';
}

const isCryptoMethod = (id: string) => /crypto|usdt|ton|btc|coin/i.test(id);

export default function Balance() {
  const { t } = useTranslation();
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const queryClient = useQueryClient();
  const { formatAmount, currencySymbol } = useCurrency();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const paymentHandledRef = useRef(false);

  // Reveal stagger (CSS-driven, see balance.css).
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

  // Fetch balance from API
  const { data: balanceData, refetch: refetchBalance } = useQuery({
    queryKey: ['balance'],
    queryFn: balanceApi.getBalance,
    staleTime: API.BALANCE_STALE_TIME_MS,
    refetchOnMount: 'always',
  });

  // Refresh user data on mount to sync balance in store
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Handle payment return from payment gateway
  useEffect(() => {
    if (paymentHandledRef.current) return;

    const paymentStatus = searchParams.get('payment') || searchParams.get('status');

    const normalised = paymentStatus?.toLowerCase() ?? '';
    const isSuccess = isPaidStatus(normalised) || searchParams.get('success') === 'true';
    const isFailed = isFailedStatus(normalised);

    if (isSuccess) {
      paymentHandledRef.current = true;
      navigate('/balance/top-up/result?status=success', { replace: true });
    } else if (isFailed) {
      paymentHandledRef.current = true;
      navigate('/balance/top-up/result?status=failed', { replace: true });
    }
  }, [searchParams, navigate]);

  const [promocode, setPromocode] = useState('');
  const [promocodeLoading, setPromocodeLoading] = useState(false);
  const [promocodeError, setPromocodeError] = useState<string | null>(null);
  const [promocodeSuccess, setPromocodeSuccess] = useState<{
    message: string;
    amount: number;
  } | null>(null);
  const [promoSelectSubs, setPromoSelectSubs] = useState<Array<{
    id: number;
    tariff_name: string;
    days_left: number;
  }> | null>(null);
  const [promoSelectCode, setPromoSelectCode] = useState<string | null>(null);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);

  const { data: transactions, isLoading } = useQuery<PaginatedResponse<Transaction>>({
    queryKey: ['transactions', transactionsPage],
    queryFn: () => balanceApi.getTransactions({ per_page: 20, page: transactionsPage }),
    placeholderData: (previousData) => previousData,
  });

  const { data: paymentMethods } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: balanceApi.getPaymentMethods,
  });

  // Deferred: only fetch saved cards after payment methods loaded to avoid extra request on first render.
  // The recurrent_enabled flag is cached for 5 min to prevent refetching on every Balance visit.
  const { data: savedCardsData } = useQuery({
    queryKey: ['saved-cards'],
    queryFn: balanceApi.getSavedCards,
    enabled: !!paymentMethods,
    staleTime: 5 * 60 * 1000,
  });

  const normalizeType = (type: string) => type?.toUpperCase?.() ?? type;

  const getTypeLabel = (type: string) => {
    switch (normalizeType(type)) {
      case 'DEPOSIT':
        return t('balance.deposit');
      case 'SUBSCRIPTION_PAYMENT':
        return t('balance.subscriptionPayment');
      case 'REFERRAL_REWARD':
        return t('balance.referralReward');
      case 'WITHDRAWAL':
        return t('balance.withdrawal');
      default:
        return type;
    }
  };

  const txTagLabel = (cat: TxCategory) => {
    switch (cat) {
      case 'dep':
        return t('balance.deposit');
      case 'deb':
        return t('balance.txDebit', 'Списание');
      case 'com':
        return t('balance.txCommission', 'Комиссия');
      case 'bon':
        return t('balance.txBonus', 'Бонус');
    }
  };

  const handlePromocodeActivate = async (subscriptionId?: number) => {
    const code = subscriptionId ? promoSelectCode || '' : promocode.trim();
    if (!code) return;

    setPromocodeLoading(true);
    setPromocodeError(null);
    setPromocodeSuccess(null);

    try {
      const result = await balanceApi.activatePromocode(code, subscriptionId);

      if (result.error === 'select_subscription' && result.eligible_subscriptions) {
        setPromoSelectSubs(result.eligible_subscriptions);
        setPromoSelectCode(result.code || code);
        return;
      }

      if (result.success) {
        const bonusAmount = (result.balance_after || 0) - (result.balance_before || 0);
        setPromocodeSuccess({
          message: result.bonus_description || t('balance.promocode.success'),
          amount: bonusAmount,
        });
        setTransactionsPage(1);
        setPromocode('');
        setPromoSelectSubs(null);
        setPromoSelectCode(null);
        await refetchBalance();
        await refreshUser();
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      }
    } catch (error: unknown) {
      // Backend returns a structured error: detail = { code, message }. We map
      // the stable machine code to a localized string. (The old contract
      // substring-matched English prose and silently degraded every unmapped
      // code — active_discount_exists, daily_limit, … — to "server error".)
      const axiosError = error as {
        response?: { data?: { detail?: { code?: string } | string } };
      };
      const detail = axiosError.response?.data?.detail;
      const code = typeof detail === 'object' && detail ? detail.code : undefined;
      const knownErrorKeys = [
        'not_found',
        'expired',
        'inactive',
        'not_yet_valid',
        'used',
        'already_used_by_user',
        'active_discount_exists',
        'no_subscription_for_days',
        'subscription_not_found',
        'not_first_purchase',
        'daily_limit',
        'trial_subscription_exists',
        'trial_provisioning_failed',
        'user_not_found',
        'server_error',
      ];
      const errorKey = code && knownErrorKeys.includes(code) ? code : 'server_error';
      setPromocodeError(t(`balance.promocode.errors.${errorKey}`));
      setPromoSelectSubs(null);
      setPromoSelectCode(null);
    } finally {
      setPromocodeLoading(false);
    }
  };

  return (
    <div className={cn('mitray-balance', revealed && 'in')}>
      <div className="phead">
        <h1>{t('balance.title')}</h1>
      </div>

      <div className="bal-grid">
        {/* LEFT */}
        <div className="col">
          {/* Balance hero */}
          <div className="card hero-bal reveal d1">
            <div className="k-lbl">{t('balance.currentBalance')}</div>
            <div className="amount">
              {formatAmount(balanceData?.balance_rubles || 0)}
              <span>{currencySymbol}</span>
            </div>
          </div>

          {/* Transaction history */}
          <div className={cn('card history reveal d3', !isHistoryOpen && 'collapsed')}>
            <div className="card-h">
              <div className="t">{t('balance.transactionHistory')}</div>
              <button
                className="collapse"
                onClick={() => setIsHistoryOpen((v) => !v)}
                aria-label={t('common.collapse', 'Свернуть')}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 15l6-6 6 6" />
                </svg>
              </button>
            </div>

            {isLoading ? (
              <div className="tx-loader">
                <div className="tx-spin" />
              </div>
            ) : transactions?.items && transactions.items.length > 0 ? (
              <>
                <div className="tx-list">
                  {transactions.items.map((tx) => {
                    const cat = txCategory(tx);
                    const isPositive = tx.amount_rubles > 0;
                    const displayAmount = Math.abs(tx.amount_rubles);
                    const sign = tx.amount_rubles === 0 ? '' : isPositive ? '+' : '−';
                    return (
                      <div className="tx" key={tx.id}>
                        <span className={`tx-ic ${cat}`}>
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
                            <path d={TX_ICON[cat]} />
                          </svg>
                        </span>
                        <div className="tx-main">
                          <b>{tx.description || getTypeLabel(tx.type)}</b>
                          <div className="tx-meta">
                            <span className={`tx-tag ${cat}`}>{txTagLabel(cat)}</span>
                            <span className="date">
                              {new Date(tx.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <span className={cn('tx-amt', !isPositive && 'neg')}>
                          {sign}
                          {formatAmount(displayAmount)} {currencySymbol}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {transactions && transactions.pages > 1 && (
                  <div className="pager">
                    <button
                      onClick={() => setTransactionsPage((prev) => Math.max(1, prev - 1))}
                      disabled={transactions.page <= 1}
                    >
                      {t('common.back')}
                    </button>
                    <div className="pg-info">
                      {t('balance.page', {
                        current: transactions.page,
                        total: transactions.pages,
                      })}
                    </div>
                    <button
                      onClick={() =>
                        setTransactionsPage((prev) =>
                          transactions.pages ? Math.min(transactions.pages, prev + 1) : prev + 1,
                        )
                      }
                      disabled={transactions.page >= transactions.pages}
                    >
                      {t('common.next')}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="tx-empty">{t('balance.noTransactions')}</div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div className="col">
          {/* Top-up methods */}
          {paymentMethods && paymentMethods.length > 0 && (
            <div className="card reveal d2 topup">
              <div className="card-h">
                <div className="t">{t('balance.topUpBalance')}</div>
              </div>
              {paymentMethods.map((method) => {
                const methodKey = method.id.toLowerCase().replace(/-/g, '_');
                const translatedName = t(`balance.paymentMethods.${methodKey}.name`, {
                  defaultValue: '',
                });
                const translatedDesc = t(`balance.paymentMethods.${methodKey}.description`, {
                  defaultValue: '',
                });
                const crypto = isCryptoMethod(method.id);
                return (
                  <div
                    key={method.id}
                    className={cn('method', !method.is_available && 'disabled')}
                    onClick={() => method.is_available && navigate(`/balance/top-up/${method.id}`)}
                    role="button"
                    tabIndex={method.is_available ? 0 : -1}
                    onKeyDown={(e) => {
                      if (method.is_available && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        navigate(`/balance/top-up/${method.id}`);
                      }
                    }}
                  >
                    <span className="mi">
                      {crypto ? (
                        <svg
                          width="22"
                          height="22"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="9" />
                          <path d="M9.5 9.2c.4-1 1.5-1.5 2.6-1.5 1.4 0 2.4.8 2.4 2 0 2.5-4.6 1.8-4.6 4.3 0 1.2 1.1 2 2.5 2 1.1 0 2.1-.5 2.5-1.5M12 6v1.7M12 16.3V18" />
                        </svg>
                      ) : (
                        <svg
                          width="22"
                          height="22"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="2" y="5" width="20" height="14" rx="2.5" />
                          <path d="M2 10h20" />
                        </svg>
                      )}
                    </span>
                    <div className="mt">
                      <b>{translatedName || method.name}</b>
                      <p>
                        {translatedDesc || method.description}
                        {(translatedDesc || method.description) && ' · '}
                        <span>
                          {formatAmount(method.min_amount_kopeks / 100, 0)}&nbsp;–&nbsp;
                          {formatAmount(method.max_amount_kopeks / 100, 0)} {currencySymbol}
                        </span>
                      </p>
                    </div>
                    <span className="chev">
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Promo code */}
          <div className="card reveal d4 promo-card">
            <div className="card-h">
              <div className="t">{t('balance.promocode.title')}</div>
            </div>
            <div className="promo-row">
              <input
                type="text"
                value={promocode}
                onChange={(e) => setPromocode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePromocodeActivate()}
                placeholder={t('balance.promocode.placeholder')}
                autoComplete="off"
                spellCheck={false}
                disabled={promocodeLoading}
              />
              <button
                className="promo-btn"
                onClick={() => handlePromocodeActivate()}
                disabled={!promocode.trim() || promocodeLoading}
              >
                {t('balance.promocode.activate')}
              </button>
            </div>

            {promocodeError && <div className="promo-msg err show">{promocodeError}</div>}
            {promocodeSuccess && (
              <div className="promo-msg show">
                <div>{promocodeSuccess.message}</div>
                {promocodeSuccess.amount > 0 && (
                  <div>
                    {t('balance.promocode.balanceAdded', {
                      amount: promocodeSuccess.amount.toFixed(2),
                    })}
                  </div>
                )}
              </div>
            )}

            {promoSelectSubs && promoSelectSubs.length > 0 && (
              <div className="promo-picker">
                <div className="pk-t">
                  {t(
                    'balance.promocode.selectSubscription',
                    'К какой подписке применить промокод?',
                  )}
                </div>
                {promoSelectSubs.map((sub) => (
                  <button
                    key={sub.id}
                    className="pk"
                    onClick={() => handlePromocodeActivate(sub.id)}
                    disabled={promocodeLoading}
                  >
                    <span className="truncate">{sub.tariff_name}</span>
                    <span className="pk-days">
                      {t('balance.promocode.daysLeft', '{{count}} дн.', { count: sub.days_left })}
                    </span>
                  </button>
                ))}
                <button
                  className="pk-cancel"
                  onClick={() => {
                    setPromoSelectSubs(null);
                    setPromoSelectCode(null);
                  }}
                >
                  {t('common.cancel', 'Отмена')}
                </button>
              </div>
            )}
          </div>

          {/* Saved cards */}
          {savedCardsData?.recurrent_enabled && (
            <div className="card reveal d5 saved-card">
              <div
                className="saved"
                role="button"
                tabIndex={0}
                onClick={() => navigate('/balance/saved-cards')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate('/balance/saved-cards');
                  }
                }}
              >
                <span className="sv-l">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="5" width="20" height="14" rx="2.5" />
                    <path d="M2 10h20" />
                  </svg>
                  {t('balance.savedCards.title')}
                </span>
                <span className="chev">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </span>
              </div>
            </div>
          )}

          {/* Info note */}
          <div className="card reveal d5 note-card">
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
                  'balance.topUpNote',
                  'Средства зачисляются автоматически в течение пары минут. Комиссия зависит от способа оплаты и отображается перед подтверждением.',
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
