import { useState } from 'react';
import { useNavigate } from 'react-router';

import {
  REWARD_STATUS_LABEL,
  REWARD_STATUS_TONE,
  activeSummary,
  formatDate,
  formatDays,
  personLabel,
  type MitrayAdminUser,
} from '../../../api/adminMitrayReferral';
import type { MitrayReferee } from '../../../api/mitrayReferral';
import type { UserDetailResponse } from '../../../api/adminUsers';
import { useAdminMitrayUser } from './useAdminMitrayUser';
import { useCurrency } from '../../../hooks/useCurrency';
import { StatCard } from '@/components/stats';
import {
  BanknotesIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  TrophyIcon,
  UsersIcon,
} from '@/components/icons';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────────────
// Mitray: рефералка v3 в карточке пользователя. Участнику — дни, код,
// кореша и история наград; партнёру на личном проценте — его рубли.
// ──────────────────────────────────────────────────────────────────

const REFEREE_STATUS: Record<MitrayReferee['status'], { label: string; tone: string }> = {
  paying: { label: 'Платит', tone: 'bg-success-500/15 text-success-400' },
  waiting: { label: 'Ждём устройство', tone: 'bg-warning-500/15 text-warning-400' },
  gone: { label: 'Не продлил', tone: 'bg-dark-700/60 text-dark-400' },
  joined: { label: 'Не платил', tone: 'bg-dark-700/60 text-dark-500' },
};

/** Статус кореша в списке рефералов: платит ли и сколько дней принёс. */
export function MitrayRefereeBadge({ referee }: { referee: MitrayReferee | undefined }) {
  if (!referee) return null;
  const status = REFEREE_STATUS[referee.status];
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {referee.earned_days + referee.pending_days > 0 && (
        <span className="text-xs text-dark-400">
          +{formatDays(referee.earned_days + referee.pending_days)}
        </span>
      )}
      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', status.tone)}>
        {status.label}
      </span>
    </span>
  );
}

const WELCOME_LABEL: Record<string, string> = {
  waiting: 'ждёт подключения с нового устройства',
  granted: 'выдан',
  skipped: 'не положен',
};

function AsReferee({ data }: { data: MitrayAdminUser }) {
  const navigate = useNavigate();
  const info = data.as_referee;
  if (!info) return null;
  const parts = [
    info.first_live_payment_at ? `оплатил ${formatDate(info.first_live_payment_at)}` : null,
    info.status === 'confirmed'
      ? `устройство подтверждено ${formatDate(info.confirmed_at)}`
      : 'ждём подключения со своего устройства',
  ].filter(Boolean);
  const welcome = info.welcome_status ? WELCOME_LABEL[info.welcome_status] : null;
  return (
    <div className="rounded-xl bg-dark-900/50 px-4 py-3 text-sm">
      <div className="text-dark-300">
        Сам пришёл как кореш от{' '}
        {info.referrer ? (
          <button
            onClick={() => navigate(`/admin/users/${info.referrer!.id}`)}
            className="font-medium text-dark-100 hover:text-accent-400"
          >
            {personLabel(info.referrer)}
          </button>
        ) : (
          '—'
        )}
        {parts.length ? ` · ${parts.join(' · ')}` : ''}
      </div>
      {welcome && (
        <div className="mt-1 text-xs text-dark-500">
          Подарок новичку:{' '}
          {info.welcome_status === 'granted' && info.welcome_days
            ? `+${formatDays(info.welcome_days)} ${welcome} ${formatDate(info.welcome_granted_at)}`
            : welcome}
          {info.welcome_note ? ` (${info.welcome_note})` : ''}
        </div>
      )}
    </div>
  );
}

function LegacyBlock({ data }: { data: MitrayAdminUser }) {
  const { formatWithCurrency } = useCurrency();
  const stats = data.legacy_stats;
  return (
    <div className="space-y-4 rounded-2xl border border-warning-500/30 bg-warning-500/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-dark-100">Партнёр на рублях</h3>
        <span className="rounded-full bg-warning-500/15 px-3 py-1 text-xs font-medium text-warning-400">
          {data.commission_percent}% с оплат рефералов
        </span>
      </div>
      <p className="text-sm text-dark-400">
        Личный процент выводит из рефералки v3: начисления идут рублями по старой схеме. Вернуть в
        v3 — очистить процент во вкладке «Инфо».
      </p>
      {stats && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Рефералов" value={stats.referrals} icon={<UsersIcon />} tone="neutral" />
          <StatCard
            label="За 30 дней"
            value={formatWithCurrency(stats.earnings_month_kopeks / 100, 0)}
            icon={<CalendarIcon />}
            tone="success"
          />
          <StatCard
            label="Всего начислено"
            value={formatWithCurrency(stats.earnings_total_kopeks / 100, 0)}
            icon={<BanknotesIcon />}
            tone="neutral"
          />
        </div>
      )}
      <AsReferee data={data} />
    </div>
  );
}

function History({ data }: { data: MitrayAdminUser }) {
  const [open, setOpen] = useState(false);
  const { formatWithCurrency } = useCurrency();
  const history = data.history ?? [];
  if (history.length === 0) return null;
  const shown = open ? history : history.slice(0, 5);
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-dark-200">
        История наград ({history.length})
      </div>
      <div className="space-y-2">
        {shown.map((reward) => (
          <div
            key={reward.id}
            className="flex flex-col gap-1 rounded-lg bg-dark-900/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 text-sm">
              <span className="text-dark-100">
                {reward.kind === 'milestone'
                  ? `Веха: ${reward.threshold ?? '?'} корешей`
                  : `За ${personLabel(reward.referee)}`}
              </span>
              <span className="text-xs text-dark-500">
                {' '}
                · {formatDate(reward.created_at, true)}
                {reward.kind === 'share' && reward.amount_kopeks > 0
                  ? ` · оплата ${formatWithCurrency(reward.amount_kopeks / 100, 0)}`
                  : ''}
                {reward.status === 'claimed' && reward.burned_days > 0
                  ? ` · сгорело ${reward.burned_days}`
                  : ''}
                {reward.status === 'available' && reward.expires_at
                  ? ` · до ${formatDate(reward.expires_at, true)}`
                  : ''}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-sm font-semibold text-dark-100">
                +{formatDays(reward.days)}
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  REWARD_STATUS_TONE[reward.status],
                )}
              >
                {REWARD_STATUS_LABEL[reward.status]}
              </span>
            </div>
          </div>
        ))}
      </div>
      {history.length > 5 && (
        <button
          onClick={() => setOpen(!open)}
          className="mt-2 flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300"
        >
          {open ? 'Свернуть' : `Показать все ${history.length}`}
          <ChevronDownIcon className={open ? 'h-3.5 w-3.5 rotate-180' : 'h-3.5 w-3.5'} />
        </button>
      )}
    </div>
  );
}

export function MitrayReferralSection({ user }: { user: UserDetailResponse }) {
  const query = useAdminMitrayUser(user);
  const data = query.data;

  if (query.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <StatCard key={i} label=" " value="" loading tone="neutral" />
        ))}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-2xl border border-dark-700/30 bg-dark-800/40 p-5 text-sm text-dark-500">
        Данные рефералки v3 недоступны.
      </div>
    );
  }
  if (data.legacy) return <LegacyBlock data={data} />;

  const summary = activeSummary(data);
  const days = data.days;
  const nextMilestone = summary?.milestones.find((m) => !m.reached);

  return (
    <div className="space-y-4 rounded-2xl border border-dark-700/30 bg-dark-800/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-dark-100">Рефералка v3</h3>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-dark-700/60 px-3 py-1 text-dark-300">
            Код:{' '}
            <span className="font-mono text-dark-100">{data.short_code ?? 'ещё не выдан'}</span>
          </span>
          {data.referral_code && (
            <span className="rounded-full bg-dark-700/60 px-3 py-1 text-dark-300">
              Ссылка: <span className="font-mono text-dark-100">{data.referral_code}</span>
            </span>
          )}
        </div>
      </div>

      {!data.program_enabled && (
        <p className="rounded-lg bg-dark-900/50 px-3 py-2 text-sm text-dark-400">
          Программа выключена — ниже только то, что успело начислиться.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Платят сейчас"
          value={summary ? `${summary.paying.length} из ${summary.need_count}` : '—'}
          subValue={summary ? `${summary.month_days} дн. в месяц` : undefined}
          icon={<UsersIcon />}
          tone={summary && summary.month_days >= 30 ? 'success' : 'neutral'}
        />
        <StatCard
          label="Ждут"
          value={days ? formatDays(days.available + days.pending) : '—'}
          subValue={days ? `готовы ${days.available}` : undefined}
          icon={<ClockIcon />}
          tone={days && days.available > 0 ? 'accent' : 'neutral'}
        />
        <StatCard
          label="Забрано"
          value={days ? formatDays(days.claimed) : '—'}
          subValue={days ? `из ${days.earned}` : undefined}
          icon={<CheckCircleIcon />}
          tone="neutral"
        />
        <StatCard
          label="Активных корешей"
          value={summary ? summary.active_count : '—'}
          subValue={
            nextMilestone && summary
              ? `ещё ${Math.max(0, nextMilestone.need - summary.active_count)} до +${nextMilestone.days}`
              : summary?.milestones.length
                ? 'вехи пройдены'
                : undefined
          }
          icon={<TrophyIcon />}
          tone="neutral"
        />
      </div>

      {summary && summary.price_kopeks > 0 && (
        <p className="text-xs text-dark-500">
          {summary.has_subscription && summary.subscription?.tariff_name
            ? `Тариф «${summary.subscription.tariff_name}»`
            : 'Без платной подписки — считаем по Стандарту'}
          : кореш на Стандарте даёт{' '}
          {formatDays(
            Math.round(
              (summary.standard_price_kopeks * 30) /
                (summary.share_denominator * summary.price_kopeks),
            ),
          )}{' '}
          в месяц, для бесплатного нужно {summary.need_count}.
          {summary.available_days > 0
            ? ` Сейчас влезет в подписку ${formatDays(summary.claimable_days)}${summary.over_cap_days > 0 ? `, сверх года сгорит ${summary.over_cap_days}` : ''}.`
            : ''}
        </p>
      )}

      <AsReferee data={data} />
      <History data={data} />
    </div>
  );
}
