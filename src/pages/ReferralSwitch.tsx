import { useQuery } from '@tanstack/react-query';
import { MITRAY_REFERRAL_KEY, isNotFound, mitrayReferralApi } from '../api/mitrayReferral';
import MitrayReferral from './MitrayReferral';
import Referral from './Referral';
import '../styles/referral.css';

/**
 * Mitray: /referral показывает «Кореша» (рефералка v3), когда программа включена.
 * Выключена, партнёр на личном проценте или бот ещё без ручки — старая страница.
 */
export default function ReferralSwitch() {
  const { data, isLoading } = useQuery({
    queryKey: MITRAY_REFERRAL_KEY,
    queryFn: mitrayReferralApi.getSummary,
    retry: (count, err) => count < 1 && !isNotFound(err),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="mitray-ref">
        <div className="ref-loader">
          <div className="ref-spin" />
        </div>
      </div>
    );
  }
  return data?.enabled ? <MitrayReferral /> : <Referral />;
}
