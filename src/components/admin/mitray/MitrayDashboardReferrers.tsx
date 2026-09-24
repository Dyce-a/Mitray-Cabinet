import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import {
  ADMIN_MITRAY_REFERRAL_KEY,
  adminMitrayReferralApi,
  formatDays,
} from '../../../api/adminMitrayReferral';
import { StatCard } from '@/components/stats';
import {
  CalendarBlankIcon,
  CalendarIcon,
  ChevronRightIcon,
  ClockIcon,
  UsersIcon,
} from '@/components/icons';

// Mitray: на дашборде вместо рублёвого «Топа рефереров» — рефералка v3 днями.

const PERIOD_ICON = {
  today: <ClockIcon className="h-5 w-5" />,
  week: <CalendarBlankIcon className="h-5 w-5" />,
  month: <CalendarIcon className="h-5 w-5" />,
} as const;

const PERIOD_TITLE = { today: 'Сегодня', week: 'Неделя', month: '30 дней' } as const;

export function MitrayDashboardReferrers() {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ADMIN_MITRAY_REFERRAL_KEY,
    queryFn: adminMitrayReferralApi.getOverview,
    refetchInterval: 60_000,
  });
  const data = query.data;
  if (!data) return null;

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800/30 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="rounded-lg bg-accent-500/20 p-2 text-accent-400 sm:p-2.5">
            <UsersIcon />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-dark-100 sm:text-lg">Рефералы v3</h2>
            <p className="truncate text-xs text-dark-400 sm:text-sm">
              {data.referees.paid} корешей оплатили · начислено {formatDays(data.days.earned)}
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/admin/mitray-referral')}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-dark-700/50 px-2 py-1.5 text-xs font-medium text-dark-300 transition-colors hover:text-dark-100 sm:px-3 sm:text-sm"
        >
          Подробнее
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      {data.top.length === 0 ? (
        <p className="rounded-lg bg-dark-900/50 p-4 text-center text-sm text-dark-500">
          Наград ещё никто не получил — ждём первых оплат корешей
        </p>
      ) : (
        <div className="space-y-2">
          {data.top.slice(0, 5).map((row, idx) => (
            <button
              key={row.user.id}
              onClick={() => navigate(`/admin/users/${row.user.id}`)}
              className="flex w-full items-center justify-between gap-2 rounded-lg bg-dark-900/50 p-2 text-left transition-colors hover:bg-dark-800/50 sm:p-3"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-dark-700 text-[10px] font-bold text-dark-300 sm:h-6 sm:w-6 sm:text-xs">
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-dark-100 sm:text-sm">
                    {row.user.name}
                  </div>
                  {row.user.username && (
                    <div className="truncate text-[10px] text-dark-500 sm:text-xs">
                      @{row.user.username}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 text-right">
                <div className="text-xs font-semibold text-accent-400 sm:text-sm">
                  {formatDays(row.days_earned)}
                </div>
                <div className="text-[10px] text-dark-500 sm:text-xs">
                  оплат {row.payments} · забрал {row.days_claimed}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-dark-700 pt-4 sm:gap-3">
        {data.periods.map((period) => (
          <StatCard
            key={period.key}
            label={PERIOD_TITLE[period.key]}
            value={`+${period.days_earned} дн.`}
            subValue={`оплат ${period.payments}`}
            icon={PERIOD_ICON[period.key]}
            tone="neutral"
          />
        ))}
      </div>
    </div>
  );
}
