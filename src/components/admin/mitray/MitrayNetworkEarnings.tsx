import { useQuery } from '@tanstack/react-query';

import { adminMitrayReferralApi, formatDays } from '../../../api/adminMitrayReferral';

// Mitray: в панели графа вместо рублёвого «заработка с рефералов» — дни v3;
// рубли только у партнёра на личном проценте.

export function MitrayNetworkEarnings({ userId }: { userId: number }) {
  const { data } = useQuery({
    queryKey: ['admin-mitray-referral', 'user', userId, 'network'] as const,
    queryFn: () => adminMitrayReferralApi.getUser(userId),
    staleTime: 60_000,
    retry: false,
  });
  if (!data) return null;

  const legacy = data.legacy && data.legacy_stats;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-dark-400">
        {legacy ? 'Заработок партнёра' : 'Дней по рефералке v3'}
      </span>
      <span className="font-mono text-accent-400">
        {legacy
          ? `${(data.legacy_stats!.earnings_total_kopeks / 100).toLocaleString('ru-RU')} ₽`
          : formatDays(data.days?.earned ?? 0)}
      </span>
    </div>
  );
}
