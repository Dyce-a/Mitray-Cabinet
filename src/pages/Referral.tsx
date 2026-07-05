import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { referralApi } from '../api/referral';
import { usePlatform } from '../platform';
import { copyToClipboard } from '../utils/clipboard';
import { brandingApi } from '../api/branding';
import { partnerApi } from '../api/partners';
import { withdrawalApi } from '../api/withdrawals';
import { CampaignCard } from '../components/partner/CampaignCard';
import { useCurrency } from '../hooks/useCurrency';
import { cn } from '@/lib/utils';
import '../styles/referral.css';

const initial = (name?: string | null) => (name?.trim()?.[0] ?? '?').toUpperCase();

function withdrawalStClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'st green';
    case 'approved':
      return 'st info';
    case 'rejected':
    case 'cancelled':
      return 'st danger';
    default:
      return 'st'; // pending → warn
  }
}

// Inline icons (match the prototype's line style)
const IcCopy = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const IcCheck = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12l5 5 9-11" />
  </svg>
);
const IcShare = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);

export default function Referral() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { formatAmount, currencySymbol, formatPositive, formatWithCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const [copiedLink, setCopiedLink] = useState<'cabinet' | 'bot' | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reveal stagger (CSS-driven, see referral.css).
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    // Double rAF: with a warm query cache the page renders in its first frame
    // and a single rAF fires BEFORE that frame paints — .in would land in the
    // initial paint and the stagger would have nothing to animate from.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setRevealed(true));
    });
    const fallback = setTimeout(() => setRevealed(true), 90);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const { data: info, isLoading } = useQuery({
    queryKey: ['referral-info'],
    queryFn: referralApi.getReferralInfo,
  });

  // Build referral link for cabinet registration
  const referralLink = info?.referral_code
    ? `${window.location.origin}/login?ref=${info.referral_code}`
    : '';
  const botReferralLink = info?.bot_referral_link || '';

  const { data: terms } = useQuery({
    queryKey: ['referral-terms'],
    queryFn: referralApi.getReferralTerms,
  });

  const { data: referralList } = useQuery({
    queryKey: ['referral-list'],
    queryFn: () => referralApi.getReferralList({ per_page: 10 }),
  });

  const { data: earnings } = useQuery({
    queryKey: ['referral-earnings'],
    queryFn: () => referralApi.getReferralEarnings({ per_page: 10 }),
  });

  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: brandingApi.getBranding,
    staleTime: 60000,
  });

  // Partner status query
  const { data: partnerStatus } = useQuery({
    queryKey: ['partner-status'],
    queryFn: partnerApi.getStatus,
  });

  const isPartner = partnerStatus?.partner_status === 'approved';

  // Withdrawal queries (only when partner is approved)
  const { data: withdrawalBalance } = useQuery({
    queryKey: ['withdrawal-balance'],
    queryFn: withdrawalApi.getBalance,
    enabled: isPartner,
  });

  const { data: withdrawalHistory } = useQuery({
    queryKey: ['withdrawal-history'],
    queryFn: withdrawalApi.getHistory,
    enabled: isPartner,
  });

  // Withdrawal cancel mutation
  const cancelWithdrawalMutation = useMutation({
    mutationFn: withdrawalApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['withdrawal-balance'] });
      queryClient.invalidateQueries({ queryKey: ['withdrawal-history'] });
    },
  });

  const copyLink = async (link: string, type: 'cabinet' | 'bot') => {
    if (!link) return;
    try {
      await copyToClipboard(link);
      setCopiedLink(type);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedLink(null), 2000);
    } catch {
      // clipboard write failed silently
    }
  };

  const { openTelegramLink } = usePlatform();

  const shareLink = () => {
    if (!referralLink) return;
    const shareText = t('referral.shareMessage', {
      percent: info?.commission_percent || 0,
      botName: branding?.name || import.meta.env.VITE_APP_NAME || 'Cabinet',
    });

    if (navigator.share) {
      navigator
        .share({
          title: t('referral.title'),
          text: shareText,
          url: referralLink,
        })
        .catch(() => {});
      return;
    }

    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
      referralLink,
    )}&text=${encodeURIComponent(shareText)}`;
    openTelegramLink(telegramUrl);
  };

  if (isLoading) {
    return (
      <div className="mitray-ref">
        <div className="ref-loader">
          <div className="ref-spin" />
        </div>
      </div>
    );
  }

  // Show disabled state if referral program is disabled
  if (terms && !terms.is_enabled) {
    return (
      <div className="mitray-ref">
        <div className="phead">
          <h1>{t('referral.title')}</h1>
        </div>
        <div className="card">
          <div className="rr-empty">{t('referral.disabled')}</div>
        </div>
      </div>
    );
  }

  const partnerStatusValue = partnerStatus?.partner_status ?? 'none';
  const partnerVisible = terms?.partner_section_visible !== false;
  const showNewUserBonus = (terms?.first_topup_bonus_kopeks ?? 0) > 0;
  const showInviterBonus = (terms?.inviter_bonus_kopeks ?? 0) > 0;

  return (
    <div className={cn('mitray-ref', revealed && 'in')}>
      <div className="phead reveal d1">
        <h1>{t('referral.title')}</h1>
      </div>

      {/* Top stats */}
      <div className="rstats reveal d1">
        <div className="rstat">
          <span className="ic">
            <svg
              width="20"
              height="20"
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
          <div className="v">{info?.total_referrals || 0}</div>
          <div className="sub">
            {t('referral.stats.totalReferrals').toLowerCase()} · {info?.active_referrals || 0}{' '}
            {t('referral.stats.activeReferrals').toLowerCase()}
          </div>
        </div>
        <div className="rstat">
          <span className="ic">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </span>
          <div className="v green">{formatPositive(info?.total_earnings_rubles || 0)}</div>
          <div className="sub">{t('referral.stats.totalEarnings').toLowerCase()}</div>
        </div>
        <div className="rstat">
          <span className="ic">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 5L5 19M6.5 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
            </svg>
          </span>
          <div className="v acc">{info?.commission_percent || 0}%</div>
          <div className="sub">{t('referral.stats.commissionRate').toLowerCase()}</div>
        </div>
      </div>

      <div className="ref-grid">
        {/* LEFT */}
        <div className="col">
          {/* Referral links */}
          <div className="card ref-links reveal d2">
            <div className="card-h">
              <div className="t">{t('referral.yourLink')}</div>
            </div>
            {botReferralLink && (
              <div className="lrow">
                <span className="ic">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6.4 13.5l-4.9-1.5c-1.1-.3-1.1-1 .2-1.5L20.5 3c.9-.3 1.7.2 1.4 1.3z" />
                  </svg>
                </span>
                <div className="u">
                  <b>{t('referral.botLink')}</b>
                  <div className="url">{botReferralLink}</div>
                </div>
                <button
                  className={cn('sbtn', copiedLink === 'bot' && 'done')}
                  onClick={() => copyLink(botReferralLink, 'bot')}
                >
                  {copiedLink === 'bot' ? <IcCheck /> : <IcCopy />}
                  <span className="sbtn-label">
                    {copiedLink === 'bot' ? t('referral.copied') : t('referral.copyLink')}
                  </span>
                </button>
              </div>
            )}
            <div className="lrow">
              <span className="ic">
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
                  <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
                  <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
                </svg>
              </span>
              <div className="u">
                <b>{t('referral.cabinetLink')}</b>
                <div className="url">{referralLink || '—'}</div>
              </div>
              <button
                className={cn('sbtn', copiedLink === 'cabinet' && 'done')}
                onClick={() => copyLink(referralLink, 'cabinet')}
                disabled={!referralLink}
              >
                {copiedLink === 'cabinet' ? <IcCheck /> : <IcCopy />}
                <span className="sbtn-label">
                  {copiedLink === 'cabinet' ? t('referral.copied') : t('referral.copyLink')}
                </span>
              </button>
              <button className="sbtn" onClick={shareLink} disabled={!referralLink}>
                <IcShare />
                <span className="sbtn-label">{t('referral.shareButton')}</span>
              </button>
            </div>
            <p className="note">
              {t('referral.shareHint', { percent: info?.commission_percent || 0 })}
            </p>
          </div>

          {/* Referrals list */}
          <div className="card ref-list reveal d3">
            <div className="card-h">
              <div className="t">{t('referral.yourReferrals')}</div>
              {referralList?.items && referralList.items.length > 0 && (
                <div className="sub">
                  {t('referral.stats.totalReferrals').toLowerCase()}: {info?.total_referrals || 0}
                </div>
              )}
            </div>
            {referralList?.items && referralList.items.length > 0 ? (
              referralList.items.map((ref) => {
                const name =
                  ref.first_name || ref.username || t('referral.anonymousUser', { id: ref.id });
                return (
                  <div className="rr" key={ref.id}>
                    <span className="ava">{initial(name)}</span>
                    <div className="nm">
                      <b>{name}</b>
                      <p>{new Date(ref.created_at).toLocaleDateString(i18n.language)}</p>
                    </div>
                    <span className={cn('st', ref.has_paid && 'green')}>
                      {ref.has_paid ? t('referral.status.paid') : t('referral.status.pending')}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="rr-empty">{t('referral.noReferrals')}</div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div className="col">
          {/* Program terms */}
          {terms && (
            <div className="card ref-terms reveal d2">
              <div className="card-h">
                <div className="t">{t('referral.terms.title')}</div>
              </div>
              <div className="cond-grid">
                <div className="cond">
                  <div className="k">{t('referral.terms.commission')}</div>
                  <div className="v acc">{terms.commission_percent}%</div>
                </div>
                <div className="cond">
                  <div className="k">{t('referral.terms.minTopup')}</div>
                  <div className="v">
                    {formatAmount(terms.minimum_topup_rubles)} {currencySymbol}
                  </div>
                </div>
                {showNewUserBonus && (
                  <div className="cond">
                    <div className="k">{t('referral.terms.newUserBonus')}</div>
                    <div className="v green">{formatPositive(terms.first_topup_bonus_rubles)}</div>
                  </div>
                )}
                {showInviterBonus && (
                  <div className="cond">
                    <div className="k">{t('referral.terms.inviterBonus')}</div>
                    <div className="v green">{formatPositive(terms.inviter_bonus_rubles)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Earnings history */}
          {earnings?.items && earnings.items.length > 0 && (
            <div className="card ref-earn reveal d3">
              <div className="card-h">
                <div className="t">{t('referral.earningsHistory')}</div>
              </div>
              {earnings.items.map((earning) => {
                const name =
                  earning.referral_first_name ||
                  earning.referral_username ||
                  t('referral.anonymousReferral');
                const isZero = earning.amount_rubles === 0;
                return (
                  <div className="rr" key={earning.id}>
                    <span className="ava">{initial(name)}</span>
                    <div className="nm">
                      <b>{name}</b>
                      <p>
                        {t(`referral.reasons.${earning.reason}`, earning.reason)} ·{' '}
                        {new Date(earning.created_at).toLocaleDateString(i18n.language)}
                      </p>
                    </div>
                    <span className={cn('amt', isZero && 'zero')}>
                      {formatPositive(earning.amount_rubles)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Partner CTA / status */}
          {partnerVisible && partnerStatusValue === 'none' && (
            <div className="card partner reveal d4">
              <span className="ic">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </span>
              <b>{t('referral.partner.becomePartner')}</b>
              <p>{t('referral.partner.becomePartnerDesc')}</p>
              <button onClick={() => navigate('/referral/partner/apply')}>
                {t('referral.partner.applyButton')}
              </button>
            </div>
          )}

          {partnerVisible && partnerStatusValue === 'pending' && (
            <div className="card partner warn reveal d4">
              <span className="ic">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" />
                </svg>
              </span>
              <b>{t('referral.partner.underReview')}</b>
              <p>{t('referral.partner.underReviewDesc')}</p>
              {partnerStatus?.latest_application?.created_at && (
                <p>
                  {t('referral.partner.submittedAt', {
                    date: new Date(partnerStatus.latest_application.created_at).toLocaleDateString(
                      i18n.language,
                    ),
                  })}
                </p>
              )}
            </div>
          )}

          {partnerVisible && partnerStatusValue === 'approved' && (
            <div className="card partner reveal d4">
              <span className="ic">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </span>
              <b>
                {t('referral.partner.partnerStatus')}
                <span className="st green">{t('referral.partner.active')}</span>
              </b>
              <p>
                {t('referral.partner.commissionInfo', {
                  percent: partnerStatus?.commission_percent ?? 0,
                })}
              </p>
            </div>
          )}

          {partnerVisible && partnerStatusValue === 'rejected' && (
            <div className="card partner danger reveal d4">
              <span className="ic">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5M12 16h.01" />
                </svg>
              </span>
              <b>{t('referral.partner.rejected')}</b>
              {partnerStatus?.latest_application?.admin_comment && (
                <p>{partnerStatus.latest_application.admin_comment}</p>
              )}
              <button onClick={() => navigate('/referral/partner/apply')}>
                {t('referral.partner.reapplyButton')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Partner campaigns (approved partners) */}
      {partnerVisible &&
        isPartner &&
        partnerStatus?.campaigns &&
        partnerStatus.campaigns.length > 0 && (
          <div className="card reveal d2" style={{ marginTop: '18px' }}>
            <div className="card-h">
              <div className="t">{t('referral.partner.yourCampaigns')}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {partnerStatus.campaigns.map((campaign) => (
                <CampaignCard key={campaign.id} campaign={campaign} />
              ))}
            </div>
          </div>
        )}

      {/* Withdrawal section (approved partners) */}
      {partnerVisible && isPartner && (
        <div id="withdrawal-section" className="ref-grid" style={{ marginTop: '18px' }}>
          {withdrawalBalance && (
            <div className="card reveal d2">
              <div className="card-h">
                <div className="t">{t('referral.withdrawal.title')}</div>
              </div>
              <div className="cond-grid">
                <div className="cond">
                  <div className="k">{t('referral.withdrawal.available')}</div>
                  <div className="v green">
                    {formatWithCurrency(withdrawalBalance.available_total / 100)}
                  </div>
                </div>
                <div className="cond">
                  <div className="k">{t('referral.withdrawal.totalEarned')}</div>
                  <div className="v">
                    {formatWithCurrency(withdrawalBalance.total_earned / 100)}
                  </div>
                </div>
                <div className="cond">
                  <div className="k">{t('referral.withdrawal.withdrawn')}</div>
                  <div className="v">{formatWithCurrency(withdrawalBalance.withdrawn / 100)}</div>
                </div>
                <div className="cond">
                  <div className="k">{t('referral.withdrawal.pending')}</div>
                  <div className="v">{formatWithCurrency(withdrawalBalance.pending / 100)}</div>
                </div>
              </div>
              <div style={{ marginTop: '16px' }}>
                <button
                  className="rbtn primary"
                  onClick={() => navigate('/referral/withdrawal/request')}
                  disabled={!withdrawalBalance.can_request}
                >
                  {t('referral.withdrawal.requestButton')}
                </button>
                {!withdrawalBalance.can_request && withdrawalBalance.cannot_request_reason ? (
                  <p className="note" style={{ marginTop: '10px' }}>
                    {withdrawalBalance.cannot_request_reason}
                  </p>
                ) : (
                  withdrawalBalance.min_amount_kopeks > 0 && (
                    <p className="note" style={{ marginTop: '10px' }}>
                      {t('referral.withdrawal.minAmount', {
                        amount: formatWithCurrency(withdrawalBalance.min_amount_kopeks / 100),
                      })}
                    </p>
                  )
                )}
              </div>
            </div>
          )}

          <div className="card reveal d3">
            <div className="card-h">
              <div className="t">{t('referral.withdrawal.history')}</div>
            </div>
            {withdrawalHistory?.items && withdrawalHistory.items.length > 0 ? (
              withdrawalHistory.items.map((item) => (
                <div className="rr" key={item.id}>
                  <div className="nm">
                    <b>
                      {formatWithCurrency(item.amount_rubles)}{' '}
                      <span className={withdrawalStClass(item.status)}>
                        {t(`referral.withdrawal.status.${item.status}`, item.status)}
                      </span>
                    </b>
                    <p>
                      {new Date(item.created_at).toLocaleDateString(i18n.language)}
                      {item.payment_details &&
                        ` · ${
                          item.payment_details.length > 40
                            ? `${item.payment_details.slice(0, 40)}...`
                            : item.payment_details
                        }`}
                    </p>
                  </div>
                  {item.status === 'pending' && (
                    <button
                      className="link-cancel"
                      onClick={() => cancelWithdrawalMutation.mutate(item.id)}
                      disabled={cancelWithdrawalMutation.isPending}
                    >
                      {t('common.cancel')}
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="rr-empty">{t('referral.withdrawal.noHistory')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
