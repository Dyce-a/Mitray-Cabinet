import axios from 'axios';
import apiClient from './client';

/**
 * Mitray: рефералка v3 «Кореша» (бот: app/cabinet/routes/mitray_referral.py).
 * Награды только днями: треть каждой живой оплаты кореша в днях тарифа пригласившего.
 */

export type MitrayRefereeStatus = 'joined' | 'waiting' | 'paying' | 'gone';

export interface MitrayReferee {
  id: number;
  name: string;
  status: MitrayRefereeStatus;
  joined_at: string | null;
  paid_at: string | null;
  on_trial: boolean;
  tariff_name: string | null;
  subscription_end: string | null;
  payments: number;
  earned_days: number;
  pending_days: number;
}

export interface MitrayReward {
  id: number;
  kind: 'share' | 'milestone';
  status: 'pending' | 'available' | 'claimed' | 'expired' | 'revoked';
  days: number;
  amount_kopeks: number;
  referee_id: number | null;
  referee_name: string | null;
  tariff_name: string | null;
  threshold: number | null;
  created_at: string | null;
  expires_at: string | null;
}

export interface MitrayMilestone {
  need: number;
  days: number;
  reached: boolean;
  rewarded: boolean;
}

export interface MitrayPayingReferee {
  id: number;
  name: string;
  days_per_month: number;
  tariff_name: string | null;
}

export interface MitrayReferralSummary {
  enabled: boolean;
  share_denominator: number;
  claim_window_days: number;
  bank_cap_days: number;
  welcome_days: number;
  welcome_min_period_days: number;
  referral_code: string | null;
  short_code: string | null;
  bot_link: string;
  cabinet_link: string;
  subscription: {
    tariff_name: string | null;
    end_date: string | null;
    is_trial: boolean;
    is_daily: boolean;
  } | null;
  has_subscription: boolean;
  days_left: number;
  price_kopeks: number;
  standard_price_kopeks: number;
  need_count: number;
  month_days: number;
  paying: MitrayPayingReferee[];
  active_count: number;
  confirmed_count: number;
  milestones: MitrayMilestone[];
  available_days: number;
  available_until: string | null;
  claimable_days: number;
  over_cap_days: number;
  pending_days: number;
  claimed_days_total: number;
  saved_kopeks: number;
  referees_total: number;
  referees: MitrayReferee[];
  claims: MitrayReward[];
  can_enter_code: boolean;
  code_until: string | null;
}

export interface MitrayClaimResult {
  granted_days: number;
  burned_days: number;
  rewards: number;
  balance_kopeks: number;
  end_date: string | null;
  panel_synced: boolean;
}

export const MITRAY_REFERRAL_KEY = ['mitray-referral'] as const;

export const mitrayReferralApi = {
  getSummary: async (): Promise<MitrayReferralSummary> => {
    const response = await apiClient.get<MitrayReferralSummary>('/cabinet/mitray-referral');
    return response.data;
  },

  /** Без ids — забрать всё доступное. */
  claim: async (rewardIds?: number[]): Promise<MitrayClaimResult> => {
    const response = await apiClient.post<MitrayClaimResult>(
      '/cabinet/mitray-referral/claim',
      rewardIds?.length ? { reward_ids: rewardIds } : {},
    );
    return response.data;
  },

  applyCode: async (code: string): Promise<{ ok: boolean; referrer_name: string | null }> => {
    const response = await apiClient.post<{ ok: boolean; referrer_name: string | null }>(
      '/cabinet/mitray-referral/code',
      { code },
    );
    return response.data;
  },
};

/** Ошибки ручек приходят как detail: {code, message}. */
export function mitrayErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (detail && typeof detail === 'object' && typeof detail.message === 'string')
      return detail.message;
    if (typeof detail === 'string') return detail;
  }
  return fallback;
}

export function isNotFound(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}
