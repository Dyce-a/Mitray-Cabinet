import { useQuery } from '@tanstack/react-query';

import { adminMitrayReferralApi } from '../../../api/adminMitrayReferral';
import type { UserDetailResponse } from '../../../api/adminUsers';

/**
 * Mitray: рефералка v3 в карточке пользователя.
 * Ключ зависит от процента, числа рефералов и пригласившего: правка в карточке сама
 * перезапросит блок.
 */
export function useAdminMitrayUser(user: UserDetailResponse) {
  return useQuery({
    queryKey: [
      'admin-mitray-referral',
      'user',
      user.id,
      user.referral.commission_percent,
      user.referral.referrals_count,
      user.referral.referred_by_id,
    ] as const,
    queryFn: () => adminMitrayReferralApi.getUser(user.id),
    retry: false,
  });
}
