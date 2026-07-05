import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCurrency } from '../../hooks/useCurrency';
import type { Subscription } from '../../types';

interface CockpitSideGridProps {
  subscription: Subscription;
  connectedDevices: number;
  balanceRubles: number;
  referralCount: number;
  earningsRubles: number;
  referralEnabled: boolean;
}

/** Right-hand vertical stat cards of the cockpit: Tariff / Days left / Devices /
 *  Balance / Referrals. Values are wired to the same data the classic dashboard
 *  cards used. */
export default function CockpitSideGrid({
  subscription,
  connectedDevices,
  balanceRubles,
  referralCount,
  earningsRubles,
  referralEnabled,
}: CockpitSideGridProps) {
  const { t } = useTranslation();
  const { formatAmount, currencySymbol } = useCurrency();

  const endDate = new Date(subscription.end_date).toLocaleDateString();
  const daysLeft = subscription.days_left;
  // Sub-day subscriptions (e.g. a trial with hours left) floor days_left to 0 →
  // "0 дн." reads as expired. Show hours instead when under a day but still live.
  const hoursLeft = Math.max(
    0,
    Math.ceil((new Date(subscription.end_date).getTime() - Date.now()) / 3_600_000),
  );
  const showHours = daysLeft <= 0 && hoursLeft > 0;
  const unlimitedDevices = subscription.device_limit === 0;
  const atDeviceLimit = !unlimitedDevices && connectedDevices >= subscription.device_limit;

  return (
    <div className="side-grid">
      {/* Tariff */}
      <Link to={`/subscriptions/${subscription.id}`} className="scard click">
        <div className="sc-head">
          <span className="sc-ic">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 3l2.2 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.8-.5z" />
            </svg>
          </span>
          <span className="sc-sub">{t('dashboard.validUntil', { date: endDate })}</span>
        </div>
        <div>
          <div className="sc-k">{t('dashboard.tariff', 'Тариф')}</div>
          <div className="sc-v">{subscription.tariff_name || t('subscription.currentPlan')}</div>
        </div>
      </Link>

      {/* Days left */}
      <div className="scard">
        <div className="sc-head">
          <span className="sc-ic">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="4" width="18" height="17" rx="2" />
              <path d="M3 9h18M8 2v4M16 2v4" />
            </svg>
          </span>
          <span className={`sc-sub ${daysLeft <= 3 ? 'warn' : 'green'}`}>
            {daysLeft <= 3
              ? t('dashboard.hero.endingSoon', 'скоро истечёт')
              : t('subscription.statusActive', 'активна')}
          </span>
        </div>
        <div>
          <div className="sc-k">{t('dashboard.remaining', 'Осталось')}</div>
          <div className="sc-v">
            {showHours ? hoursLeft : daysLeft}{' '}
            <small>
              {showHours ? t('subscription.hoursShort', 'ч') : t('subscription.daysShort', 'дн.')}
            </small>
          </div>
        </div>
      </div>

      {/* Devices */}
      <div className="scard">
        <div className="sc-head">
          <span className="sc-ic">
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
              <rect x="2" y="4" width="20" height="13" rx="2" />
              <path d="M8 20h8M12 17v3" />
            </svg>
          </span>
          {atDeviceLimit && (
            <span className="sc-sub warn">{t('dashboard.hero.limit', 'лимит')}</span>
          )}
        </div>
        <div>
          <div className="sc-k">{t('dashboard.devices', 'Устройства')}</div>
          <div className="sc-v">
            {connectedDevices} <small>/ {unlimitedDevices ? '∞' : subscription.device_limit}</small>
          </div>
        </div>
      </div>

      {/* Balance */}
      <Link to="/balance" className="scard click" data-onboarding="balance">
        <div className="sc-head">
          <span className="sc-ic">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M2 10h20" />
            </svg>
          </span>
          <span className="sc-sub">{t('dashboard.hero.topUp', 'пополнить')} →</span>
        </div>
        <div>
          <div className="sc-k">{t('dashboard.stats.balance', 'Баланс')}</div>
          <div className="sc-v acc">
            {formatAmount(balanceRubles)} {currencySymbol}
          </div>
        </div>
      </Link>

      {/* Referrals (wide) */}
      {referralEnabled && (
        <Link to="/referral" className="scard click wide">
          <div className="sc-head">
            <span className="sc-ic">
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="9" cy="8" r="3.4" />
                <path d="M2.5 20c0-3.3 2.9-5 6.5-5s6.5 1.7 6.5 5" />
                <circle cx="18" cy="9" r="2.6" />
              </svg>
            </span>
            <span className="sc-sub green">
              +{formatAmount(earningsRubles)} {currencySymbol}
            </span>
          </div>
          <div>
            <div className="sc-k">{t('dashboard.stats.referrals', 'Рефералы')}</div>
            <div className="sc-v">{referralCount}</div>
          </div>
        </Link>
      )}
    </div>
  );
}
