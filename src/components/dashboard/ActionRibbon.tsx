import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Subscription } from '../../types';

interface ActionRibbonProps {
  subscription: Subscription;
  wheelEnabled: boolean;
  referralEnabled: boolean;
}

/** Ghost action chips beneath the cockpit — shortcuts to the main flows. */
export default function ActionRibbon({
  subscription,
  wheelEnabled,
  referralEnabled,
}: ActionRibbonProps) {
  const { t } = useTranslation();

  return (
    <div className="ribbon reveal-up r3">
      {subscription.subscription_url && (
        <Link to={`/connection?sub=${subscription.id}`} className="chip">
          <span className="ci">
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
              <rect x="2" y="4" width="20" height="13" rx="2" />
              <path d="M8 20h8M12 17v3" />
            </svg>
          </span>
          {t('dashboard.connectDevice', 'Подключить устройство')}
        </Link>
      )}

      <Link to="/subscriptions" className="chip">
        <span className="ci">
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
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 10h18" />
          </svg>
        </span>
        {t('nav.subscription', 'Мои подписки')}
      </Link>

      {wheelEnabled && (
        <Link to="/wheel" className="chip">
          <span className="ci">
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
              <path d="M12 3v9l6 4" />
            </svg>
          </span>
          {t('wheel.banner.title', 'Колесо фортуны')}
        </Link>
      )}

      {referralEnabled && (
        <Link to="/referral" className="chip">
          <span className="ci">
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
              <circle cx="9" cy="8" r="3.4" />
              <path d="M2.5 20c0-3.3 2.9-5 6.5-5s6.5 1.7 6.5 5" />
              <circle cx="18" cy="9" r="2.6" />
            </svg>
          </span>
          {t('nav.referral', 'Рефералы')}
        </Link>
      )}

      <Link to="/support" className="chip">
        <span className="ci">
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
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        {t('nav.support', 'Поддержка')}
      </Link>
    </div>
  );
}
