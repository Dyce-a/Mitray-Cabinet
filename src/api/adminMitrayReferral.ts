import apiClient from './client';
import type { MitrayReferralSummary } from './mitrayReferral';

/**
 * Mitray: админка рефералки v3 (бот: app/cabinet/routes/admin_mitray_referral.py).
 * Программа живёт днями; рубли старой схемы — только у партнёров на личном проценте.
 */

export type MitrayRewardStatus = 'pending' | 'available' | 'claimed' | 'expired' | 'revoked';

export interface MitrayPerson {
  id: number;
  name: string;
  username: string | null;
  telegram_id: number | null;
}

export interface MitrayDays {
  earned: number;
  share: number;
  milestone: number;
  claimed: number;
  burned_over_cap: number;
  expired: number;
  available: number;
  pending: number;
  revoked: number;
}

export interface MitrayAdminReward {
  id: number;
  kind: 'share' | 'milestone';
  status: MitrayRewardStatus;
  days: number;
  claimed_days: number;
  burned_days: number;
  amount_kopeks: number;
  threshold: number | null;
  tariff_name: string | null;
  referrer: MitrayPerson | null;
  referee: MitrayPerson | null;
  created_at: string | null;
  available_at: string | null;
  expires_at: string | null;
  claimed_at: string | null;
}

export interface MitrayProgramSettings {
  enabled: boolean;
  start_at: string | null;
  share_denominator: number;
  claim_window_days: number;
  bank_cap_days: number;
  welcome_days: number;
  welcome_min_period_days: number;
  welcome_wait_days: number;
  milestones: { need: number; days: number }[];
  milestone_min_traffic_gb: number;
  milestone_min_days: number;
  code_window_days: number;
  live_methods: string[];
  worker_interval_seconds: number;
  default_tariff: { id: number; name: string; price_kopeks: number } | null;
}

export interface MitrayLegacyPartner {
  user: MitrayPerson;
  percent: number;
  referrals: number;
  earnings_total_kopeks: number;
  earnings_month_kopeks: number;
}

export interface MitrayAdminOverview {
  generated_at: string;
  settings: MitrayProgramSettings;
  standard_price_kopeks: number;
  days: MitrayDays;
  counts: Partial<Record<MitrayRewardStatus, number>>;
  payments: number;
  referee_revenue_kopeks: number;
  welcome: { granted: number; granted_days: number; waiting: number; skipped: number };
  referees: {
    registered_since_start: number;
    paid: number;
    confirmed: number;
    active: number;
    referrers: number;
  };
  milestones: { need: number; days: number; reached: number }[];
  economy: {
    revenue_kopeks: number;
    delivered_days: number;
    delivered_value_kopeks: number;
    liability_days: number;
    liability_value_kopeks: number;
  };
  periods: {
    key: 'today' | 'week' | 'month';
    payments: number;
    amount_kopeks: number;
    days_earned: number;
    days_claimed: number;
  }[];
  top: {
    user: MitrayPerson;
    days_earned: number;
    days_claimed: number;
    days_available: number;
    days_pending: number;
    payments: number;
    amount_kopeks: number;
    confirmed_referees: number;
  }[];
  feed: MitrayAdminReward[];
  legacy_partners: MitrayLegacyPartner[];
}

export interface MitrayAdminUser {
  user_id: number;
  program_enabled: boolean;
  legacy: boolean;
  commission_percent: number | null;
  short_code: string | null;
  referral_code: string | null;
  as_referee: {
    referrer: MitrayPerson | null;
    status: 'pending' | 'confirmed';
    first_live_payment_at: string | null;
    confirmed_at: string | null;
    usage_ok_at: string | null;
    welcome_status: 'waiting' | 'granted' | 'skipped' | null;
    welcome_days: number | null;
    welcome_granted_at: string | null;
    welcome_note: string | null;
  } | null;
  /** Только у партнёра на личном проценте. */
  legacy_stats?: MitrayLegacyPartner;
  /** Только у участника v3. */
  days?: MitrayDays;
  history?: MitrayAdminReward[];
  summary?: MitrayReferralSummary | { enabled: false };
}

export const ADMIN_MITRAY_REFERRAL_KEY = ['admin-mitray-referral'] as const;

export const adminMitrayUserKey = (userId: number) =>
  ['admin-mitray-referral', 'user', userId] as const;

export const adminMitrayReferralApi = {
  getOverview: async (): Promise<MitrayAdminOverview> => {
    const response = await apiClient.get<MitrayAdminOverview>('/cabinet/admin/mitray-referral');
    return response.data;
  },

  getUser: async (userId: number): Promise<MitrayAdminUser> => {
    const response = await apiClient.get<MitrayAdminUser>(
      `/cabinet/admin/mitray-referral/users/${userId}`,
    );
    return response.data;
  },
};

/** Сводка человека из ответа админки, если он участник v3 и программа включена. */
export function activeSummary(data: MitrayAdminUser | undefined): MitrayReferralSummary | null {
  const summary = data?.summary;
  return summary && summary.enabled ? (summary as MitrayReferralSummary) : null;
}

export const REWARD_STATUS_LABEL: Record<MitrayRewardStatus, string> = {
  pending: 'Ждёт устройства',
  available: 'Можно забрать',
  claimed: 'Забрано',
  expired: 'Сгорело',
  revoked: 'Отменено',
};

export const REWARD_STATUS_TONE: Record<MitrayRewardStatus, string> = {
  pending: 'bg-warning-500/15 text-warning-400',
  available: 'bg-accent-500/15 text-accent-400',
  claimed: 'bg-success-500/15 text-success-400',
  expired: 'bg-dark-700/60 text-dark-400',
  revoked: 'bg-error-500/15 text-error-400',
};

export function personLabel(person: MitrayPerson | null | undefined): string {
  if (!person) return '—';
  return person.username ? `@${person.username}` : person.name;
}

export function kopeksToRubles(kopeks: number): number {
  return Math.round(kopeks) / 100;
}

/** «1 день», «3 дня», «5 дней». */
export function pluralRu(value: number, forms: [string, string, string]): string {
  const n = Math.abs(value) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export function daysWord(value: number): string {
  return pluralRu(value, ['день', 'дня', 'дней']);
}

export function formatDays(value: number): string {
  return `${value.toLocaleString('ru-RU')} ${daysWord(value)}`;
}

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  return withTime
    ? date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
