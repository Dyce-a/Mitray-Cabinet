import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';

import {
  ADMIN_MITRAY_REFERRAL_KEY,
  REWARD_STATUS_LABEL,
  REWARD_STATUS_TONE,
  adminMitrayReferralApi,
  formatDate,
  formatDays,
  personLabel,
  pluralRu,
  type MitrayAdminOverview,
  type MitrayAdminReward,
  type MitrayRewardStatus,
} from '../api/adminMitrayReferral';
import { AdminBackButton } from '../components/admin/AdminBackButton';
import {
  BanknotesIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  CogIcon,
  GiftIcon,
  PartnerIcon,
  TrophyIcon,
  UserPlusIcon,
  UsersIcon,
  XCircleIcon,
} from '../components/icons';
import { StatCard } from '../components/stats';
import { useCurrency } from '../hooks/useCurrency';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────────────
// Mitray: админка рефералки v3 «Кореша». Всё днями: сколько начислено,
// забрано, ждёт и сгорело, во что это обходится по цене Стандарта.
// Рубли старой схемы — только у партнёров на личном проценте.
// ──────────────────────────────────────────────────────────────────

type FeedFilter = 'all' | MitrayRewardStatus;

const FEED_FILTERS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'available', label: 'Можно забрать' },
  { key: 'pending', label: 'Ждут устройства' },
  { key: 'claimed', label: 'Забрано' },
  { key: 'expired', label: 'Сгорело' },
];

const PERIOD_TITLE: Record<string, string> = {
  today: 'Сегодня',
  week: '7 дней',
  month: '30 дней',
};

function Card({
  title,
  hint,
  icon,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-xl border border-dark-700 bg-dark-800/30 p-4 sm:p-5', className)}
    >
      <div className="mb-4 flex items-start gap-3">
        {icon && (
          <div className="rounded-lg bg-accent-500/15 p-2 text-accent-400 [&>svg]:h-5 [&>svg]:w-5">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-dark-100 sm:text-lg">{title}</h2>
          {hint && <p className="text-xs text-dark-400 sm:text-sm">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function StatusBadge({ status }: { status: MitrayRewardStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        REWARD_STATUS_TONE[status],
      )}
    >
      {REWARD_STATUS_LABEL[status]}
    </span>
  );
}

function rewardTitle(reward: MitrayAdminReward): string {
  if (reward.kind === 'milestone') {
    return reward.threshold ? `Веха: ${reward.threshold} корешей` : 'Веха';
  }
  return 'Треть оплаты';
}

function EconomyBar({ data, rub }: { data: MitrayAdminOverview; rub: (k: number) => string }) {
  const { economy, settings } = data;
  const revenue = economy.revenue_kopeks;
  if (revenue <= 0) {
    return (
      <p className="text-sm text-dark-400">
        Оплат корешей после запуска ещё не было — сравнивать пока не с чем.
      </p>
    );
  }
  const scale = Math.max(revenue, economy.delivered_value_kopeks + economy.liability_value_kopeks);
  const deliveredPct = (economy.delivered_value_kopeks / scale) * 100;
  const liabilityPct = (economy.liability_value_kopeks / scale) * 100;
  const target = 100 / Math.max(1, settings.share_denominator);
  const sharePct = Math.round((economy.delivered_value_kopeks / revenue) * 100);
  const liabilityShare = Math.round((economy.liability_value_kopeks / revenue) * 100);

  return (
    <div className="space-y-3">
      <div className="relative h-3 overflow-hidden rounded-full bg-dark-700/60">
        <div
          className="absolute inset-y-0 left-0 bg-success-500"
          style={{ width: `${deliveredPct}%` }}
        />
        <div
          className="absolute inset-y-0 bg-warning-500/70"
          style={{ left: `${deliveredPct}%`, width: `${liabilityPct}%` }}
        />
        <div
          className="absolute inset-y-[-2px] w-px bg-dark-100/70"
          style={{ left: `${(target * revenue) / scale}%` }}
          title={`1/${settings.share_denominator} оплат`}
        />
      </div>
      <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-dark-500" />
          <span className="text-dark-400">Оплаты корешей</span>
          <span className="ml-auto font-medium text-dark-100 sm:ml-0">{rub(revenue)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-success-500" />
          <span className="text-dark-400">Отдано днями</span>
          <span className="ml-auto font-medium text-dark-100 sm:ml-0">
            {rub(economy.delivered_value_kopeks)} · {sharePct}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-warning-500/70" />
          <span className="text-dark-400">Могут забрать</span>
          <span className="ml-auto font-medium text-dark-100 sm:ml-0">
            {rub(economy.liability_value_kopeks)} · {liabilityShare}%
          </span>
        </div>
      </div>
      <p className="text-xs text-dark-500">
        Дни посчитаны по цене Стандарта
        {settings.default_tariff
          ? ` (${rub(settings.default_tariff.price_kopeks)} за 30 дней)`
          : ''}
        . «Отдано» — забранные награды и подарки новичкам ({formatDays(economy.delivered_days)}).
        Черта — 1/{settings.share_denominator} от оплат корешей.
      </p>
    </div>
  );
}

function SettingsList({ data, rub }: { data: MitrayAdminOverview; rub: (k: number) => string }) {
  const s = data.settings;
  const rows: [string, string][] = [
    ['Доля с оплаты', `1/${s.share_denominator} каждой живой оплаты кореша`],
    [
      'Тариф для расчёта',
      s.default_tariff
        ? `${s.default_tariff.name}, ${rub(s.default_tariff.price_kopeks)} за 30 дней`
        : '—',
    ],
    ['Забрать награду', `за ${formatDays(s.claim_window_days)}, потом сгорает`],
    ['Копить подписку', `до ${formatDays(s.bank_cap_days)} вперёд, сверх — сгорает`],
    [
      'Подарок новичку',
      `+${formatDays(s.welcome_days)} к первой подписке от ${formatDays(s.welcome_min_period_days)}; ждём новое устройство ${formatDays(s.welcome_wait_days)}`,
    ],
    ['Вехи', s.milestones.map((m) => `${m.need} → +${formatDays(m.days)}`).join(', ') || 'нет'],
    [
      'Кореш для вехи',
      `от ${s.milestone_min_traffic_gb} ГБ трафика и ${formatDays(s.milestone_min_days)} с подключения`,
    ],
    ['Ввод кода кореша', `первые ${formatDays(s.code_window_days)} и до первой оплаты`],
    ['Живые оплаты', s.live_methods.join(', ') || '—'],
    ['Проверка оплат', `раз в ${Math.round(s.worker_interval_seconds / 60)} мин`],
  ];
  return (
    <dl className="divide-y divide-dark-700/60 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-dark-400 sm:w-44">{label}</dt>
          <dd className="min-w-0 text-dark-100">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AdminMitrayReferral() {
  const navigate = useNavigate();
  const { formatWithCurrency } = useCurrency();
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');

  const query = useQuery({
    queryKey: ADMIN_MITRAY_REFERRAL_KEY,
    queryFn: adminMitrayReferralApi.getOverview,
    refetchInterval: 60_000,
  });
  const data = query.data;
  const loading = query.isLoading;
  const rub = (kopeks: number) => formatWithCurrency(kopeks / 100, 0);
  const openUser = (id: number) => navigate(`/admin/users/${id}`);

  const feed = useMemo(
    () => (data?.feed ?? []).filter((item) => feedFilter === 'all' || item.status === feedFilter),
    [data, feedFilter],
  );
  const feedCounts = useMemo(() => {
    const counts: Partial<Record<FeedFilter, number>> = { all: data?.feed.length ?? 0 };
    for (const item of data?.feed ?? []) counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, [data]);

  const days = data?.days;
  const start = data?.settings.start_at;
  const enabled = data?.settings.enabled;

  return (
    <div className="animate-fade-in space-y-4 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AdminBackButton />
          <div>
            <h1 className="text-xl font-bold text-dark-100 sm:text-2xl">Рефералы v3</h1>
            <p className="text-sm text-dark-400">
              Кореша: пригласившему треть каждой оплаты кореша днями подписки
            </p>
          </div>
        </div>
        {data && (
          <span
            className={
              enabled
                ? 'rounded-full bg-success-500/15 px-3 py-1 text-xs font-medium text-success-400'
                : 'rounded-full bg-dark-700/60 px-3 py-1 text-xs font-medium text-dark-300'
            }
          >
            {enabled ? `Работает с ${formatDate(start)}` : 'Выключена'}
          </span>
        )}
      </div>

      {query.isError && (
        <div className="rounded-xl bg-error-500/10 px-4 py-3 text-sm text-error-400">
          Не удалось загрузить данные рефералки. Если бот ещё без админки v3 — её нужно выкатить.
        </div>
      )}

      {/* Главное */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Оплаты корешей"
          value={data ? rub(data.referee_revenue_kopeks) : '…'}
          subValue={
            data
              ? `${data.payments} ${pluralRu(data.payments, ['оплата', 'оплаты', 'оплат'])} с запуска`
              : undefined
          }
          icon={<BanknotesIcon />}
          tone="success"
          loading={loading}
        />
        <StatCard
          label="Начислено пригласившим"
          value={days ? formatDays(days.earned) : '…'}
          subValue={days ? `вехи +${days.milestone}` : undefined}
          icon={<CalendarIcon />}
          tone="accent"
          loading={loading}
        />
        <StatCard
          label="Забрано"
          value={days ? formatDays(days.claimed) : '…'}
          subValue="в подписки"
          icon={<CheckCircleIcon />}
          tone="neutral"
          loading={loading}
        />
        <StatCard
          label="Ждут"
          value={days ? formatDays(days.available + days.pending) : '…'}
          subValue={days ? `готовы ${days.available}` : undefined}
          icon={<ClockIcon />}
          tone="warning"
          loading={loading}
        />
        <StatCard
          label="Сгорело"
          value={days ? formatDays(days.expired + days.burned_over_cap) : '…'}
          subValue={
            days && days.burned_over_cap > 0 ? `${days.burned_over_cap} сверх года` : 'не забрали'
          }
          icon={<XCircleIcon />}
          tone="neutral"
          loading={loading}
        />
        <StatCard
          label="Подарки новичкам"
          value={data ? data.welcome.granted : '…'}
          subValue={
            data
              ? `${formatDays(data.welcome.granted_days)} · ждут ${data.welcome.waiting}`
              : undefined
          }
          icon={<GiftIcon />}
          tone="neutral"
          loading={loading}
        />
        <StatCard
          label="Кореша оплатили"
          value={data ? data.referees.paid : '…'}
          subValue={data ? `${data.referees.confirmed} с устройством` : undefined}
          icon={<UsersIcon />}
          tone="neutral"
          loading={loading}
        />
        <StatCard
          label="Новых по ссылкам"
          value={data ? data.referees.registered_since_start : '…'}
          subValue={start ? `с ${formatDate(start)}` : undefined}
          icon={<UserPlusIcon />}
          tone="neutral"
          loading={loading}
        />
      </div>

      {data && (
        <>
          {/* Сколько отдаём */}
          <Card
            title="Сколько отдаём"
            hint="Дни пригласившим и новичкам против денег, которые принесли кореша"
            icon={<BanknotesIcon />}
          >
            <EconomyBar data={data} rub={rub} />
          </Card>

          {/* Периоды */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {data.periods.map((period) => (
              <div key={period.key} className="rounded-xl bg-dark-800/30 p-3">
                <div className="text-xs text-dark-500 sm:text-sm">{PERIOD_TITLE[period.key]}</div>
                <div className="mt-1 text-base font-semibold text-dark-100 sm:text-xl">
                  +{formatDays(period.days_earned)}
                </div>
                <div className="text-xs text-dark-500">
                  забрано {period.days_claimed} · оплат {period.payments} на{' '}
                  {rub(period.amount_kopeks)}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
            {/* Топ */}
            <Card
              title="Топ пригласивших"
              hint={`По дням за всё время · всего пригласивших с наградами: ${data.referees.referrers}`}
              icon={<TrophyIcon />}
              className="lg:col-span-3"
            >
              {data.top.length === 0 ? (
                <p className="py-6 text-center text-sm text-dark-500">
                  Наград ещё никто не получил
                </p>
              ) : (
                <div className="space-y-2">
                  {data.top.map((row, index) => (
                    <button
                      key={row.user.id}
                      onClick={() => openUser(row.user.id)}
                      className="flex w-full items-center gap-3 rounded-lg bg-dark-900/50 p-2 text-left transition-colors hover:bg-dark-800/60 sm:p-3"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dark-700 text-xs font-bold text-dark-300">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-dark-100">
                            {row.user.name}
                            {row.user.username && (
                              <span className="font-normal text-dark-500">
                                {' '}
                                @{row.user.username}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-sm font-semibold text-accent-400">
                            {formatDays(row.days_earned)}
                          </span>
                        </div>
                        <div className="text-xs text-dark-500">
                          оплат {row.payments} · корешей {row.confirmed_referees} · забрал{' '}
                          {row.days_claimed} · ждут {row.days_available + row.days_pending}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <div className="space-y-4 lg:col-span-2">
              {/* Кореша */}
              <Card title="Кореша" hint="От регистрации до вех" icon={<UsersIcon />}>
                <Funnel
                  steps={[
                    ['Пришли по ссылкам', data.referees.registered_since_start],
                    ['Оплатили', data.referees.paid],
                    ['Подтвердили устройство', data.referees.confirmed],
                    ['Пользуются (для вех)', data.referees.active],
                  ]}
                />
                <p className="mt-3 text-xs text-dark-500">
                  «Пришли» — только с запуска; «оплатили» — все, кто платил после запуска, даже если
                  регистрировался раньше.
                </p>
              </Card>

              {/* Вехи и подарки */}
              <Card title="Вехи и подарки" icon={<GiftIcon />}>
                <div className="space-y-2">
                  {data.milestones.map((m) => (
                    <div
                      key={m.need}
                      className="flex items-center justify-between rounded-lg bg-dark-900/50 px-3 py-2 text-sm"
                    >
                      <span className="text-dark-300">
                        {m.need} корешей →{' '}
                        <span className="text-dark-100">+{formatDays(m.days)}</span>
                      </span>
                      <span
                        className={m.reached > 0 ? 'font-medium text-success-400' : 'text-dark-500'}
                      >
                        {m.reached > 0 ? `достигли ${m.reached}` : 'пока никто'}
                      </span>
                    </div>
                  ))}
                  <div className="flex flex-col gap-0.5 rounded-lg bg-dark-900/50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-dark-300">Подарок новичку</span>
                    <span className="text-dark-100 sm:text-right">
                      выдан {data.welcome.granted} · ждут {data.welcome.waiting} · не положен{' '}
                      {data.welcome.skipped}
                    </span>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* Лента */}
          <Card
            title="Лента наград"
            hint={`Последние ${data.feed.length}. Имя — к карточке пользователя`}
            icon={<ClockIcon />}
          >
            <div className="mb-3 flex flex-wrap gap-2">
              {FEED_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  onClick={() => setFeedFilter(filter.key)}
                  className={
                    feedFilter === filter.key
                      ? 'rounded-lg bg-accent-500/20 px-3 py-1.5 text-xs font-medium text-accent-400 sm:text-sm'
                      : 'rounded-lg bg-dark-700/50 px-3 py-1.5 text-xs font-medium text-dark-400 hover:text-dark-200 sm:text-sm'
                  }
                >
                  {filter.label}
                  {feedCounts[filter.key] ? ` · ${feedCounts[filter.key]}` : ''}
                </button>
              ))}
            </div>
            {feed.length === 0 ? (
              <p className="py-6 text-center text-sm text-dark-500">Пусто</p>
            ) : (
              <div className="space-y-2">
                {feed.map((reward) => (
                  <FeedRow key={reward.id} reward={reward} rub={rub} onOpen={openUser} />
                ))}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Партнёры на рублях */}
            <Card
              title="Партнёры на рублях"
              hint="Личный процент выводит человека из v3: ему идут рубли по старой схеме"
              icon={<PartnerIcon />}
            >
              {data.legacy_partners.length === 0 ? (
                <p className="text-sm text-dark-500">Таких нет</p>
              ) : (
                <div className="space-y-2">
                  {data.legacy_partners.map((partner) => (
                    <button
                      key={partner.user.id}
                      onClick={() => openUser(partner.user.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg bg-dark-900/50 p-3 text-left transition-colors hover:bg-dark-800/60"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-dark-100">
                          {personLabel(partner.user)}
                        </div>
                        <div className="text-xs text-dark-500">
                          {partner.percent}% · рефералов {partner.referrals}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold text-success-400">
                          {rub(partner.earnings_month_kopeks)}
                        </div>
                        <div className="text-[11px] text-dark-500">
                          за 30 дней · всего {rub(partner.earnings_total_kopeks)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-dark-500">
                Старые рублёвые начисления остальных в админке больше не показываются.
              </p>
            </Card>

            {/* Настройки */}
            <Card
              title="Правила v3"
              hint="Только просмотр: меняются в .env бота (MITRAY_REF_V3_*)"
              icon={<CogIcon />}
            >
              <SettingsList data={data} rub={rub} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Funnel({ steps }: { steps: [string, number][] }) {
  const max = Math.max(1, ...steps.map(([, value]) => value));
  return (
    <div className="space-y-2">
      {steps.map(([label, value]) => (
        <div key={label}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-dark-400">{label}</span>
            <span className="font-medium text-dark-100">{value}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-dark-700/60">
            <div
              className="h-full rounded-full bg-accent-500"
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedRow({
  reward,
  rub,
  onOpen,
}: {
  reward: MitrayAdminReward;
  rub: (k: number) => string;
  onOpen: (id: number) => void;
}) {
  const details: string[] = [];
  if (reward.kind === 'share' && reward.amount_kopeks > 0)
    details.push(`оплата ${rub(reward.amount_kopeks)}`);
  if (reward.status === 'claimed') {
    details.push(
      `забрал ${formatDays(reward.claimed_days)} ${formatDate(reward.claimed_at, true)}`,
    );
    if (reward.burned_days > 0) details.push(`сгорело ${reward.burned_days}`);
  } else if (reward.status === 'available' && reward.expires_at) {
    details.push(`до ${formatDate(reward.expires_at, true)}`);
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-dark-900/50 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 text-sm">
          {reward.referrer ? (
            <button
              onClick={() => onOpen(reward.referrer!.id)}
              className="font-medium text-dark-100 hover:text-accent-400"
            >
              {personLabel(reward.referrer)}
            </button>
          ) : (
            <span className="text-dark-500">—</span>
          )}
          {reward.referee && (
            <>
              <span className="text-dark-500">за</span>
              <button
                onClick={() => onOpen(reward.referee!.id)}
                className="text-dark-300 hover:text-accent-400"
              >
                {personLabel(reward.referee)}
              </button>
            </>
          )}
        </div>
        <div className="text-xs text-dark-500">
          {formatDate(reward.created_at, true)} · {rewardTitle(reward)}
          {details.length ? ` · ${details.join(' · ')}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-semibold text-dark-100">+{formatDays(reward.days)}</span>
        <StatusBadge status={reward.status} />
      </div>
    </div>
  );
}
