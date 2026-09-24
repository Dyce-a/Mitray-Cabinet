import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MITRAY_REFERRAL_KEY,
  mitrayErrorMessage,
  mitrayReferralApi,
  type MitrayReferee,
  type MitrayReferralSummary,
  type MitrayReward,
} from '../api/mitrayReferral';
import { partnerApi } from '../api/partners';
import { referralApi } from '../api/referral';
import { useToast } from '../components/Toast';
import { usePlatform } from '../platform';
import { copyToClipboard } from '../utils/clipboard';
import '../styles/mitray-referral.css';

/*
 * Mitray: страница «Кореша» — рефералка v3 (порт design-lab/referrals-v3.html).
 * Награды только днями: треть каждой живой оплаты кореша, вехи за подтверждённых
 * корешей, +N дней корешу к первой подписке. Сезон и неделя ×2 из прототипа
 * появятся, когда под них будет бэкенд. Тексты — по-русски, как весь продукт.
 */

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30;
const FRIENDS_SHOWN = 6;
const LADDER_COUNTS = [1, 5, 10, 25];
/** без 0/O и 1/I/L: код читают вслух и переписывают с экрана */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

// ── мелочи ───────────────────────────────────────────────────────────────────
function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
const daysWord = (n: number) => plural(n, 'день', 'дня', 'дней');
const days = (n: number) => `${n} ${daysWord(n)}`;
const friendsWord = (n: number) => plural(n, 'кореш', 'кореша', 'корешей');

const NUM_WORDS = [
  '',
  'Один',
  'Два',
  'Три',
  'Четыре',
  'Пять',
  'Шесть',
  'Семь',
  'Восемь',
  'Девять',
  'Десять',
];
const COLLECTIVE: Record<number, string> = {
  2: 'Двое',
  3: 'Трое',
  4: 'Четверо',
  5: 'Пятеро',
  6: 'Шестеро',
  7: 'Семеро',
};
const friendsTitle = (n: number) => `${NUM_WORDS[n] ?? n} ${friendsWord(n)}`;
const payingWord = (n: number) =>
  n === 1
    ? 'один платящий кореш'
    : n === 2
      ? 'два платящих кореша'
      : `${n} платящих ${friendsWord(n)}`;

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';
const fmtShort = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '';
const daysUntil = (iso: string | null | undefined) =>
  iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / DAY_MS)) : 0;
const rubles = (kopeks: number) => `${Math.round(kopeks / 100).toLocaleString('ru-RU')} ₽`;
/** треть оплаты в днях тарифа — та же формула, что в боте (rules.share_days) */
const shareDays = (amountKopeks: number, priceKopeks: number, denominator: number) =>
  priceKopeks > 0 ? Math.round((amountKopeks * MONTH_DAYS) / (denominator * priceKopeks)) : 0;
const initial = (name: string) => (Array.from(name.trim())[0] ?? '?').toUpperCase();
const shortUrl = (url: string) => url.replace(/^https?:\/\//, '');

// ── иконки в линейном стиле прототипа ────────────────────────────────────────
const ICONS: Record<string, ReactNode> = {
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.5 20c0-3.3 2.9-5 6.5-5s6.5 1.7 6.5 5" />
      <circle cx="18" cy="9" r="2.6" />
    </>
  ),
  cal: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.2 4.5L17 13H5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  ruble: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 17V7h3.5a2.5 2.5 0 0 1 0 5H8.5M8.5 14.5h5" />
    </>
  ),
  gift: (
    <>
      <path d="M20 12v9H4v-9" />
      <rect x="2.5" y="7" width="19" height="5" rx="1" />
      <path d="M12 21V7M12 7H8a2.5 2.5 0 1 1 0-5c3 0 4 5 4 5zM12 7h4a2.5 2.5 0 1 0 0-5c-3 0-4 5-4 5z" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  check: <path d="M5 12l5 5 9-11" />,
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.8 12.2L20 3M17 6l3 3M14.5 8.5l2.5 2.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  star: <path d="M12 2l2.6 6.3 6.4.5-4.9 4.2 1.5 6.5L12 16l-5.6 3.5 1.5-6.5L3 8.8l6.4-.5z" />,
};

function Icon({
  name,
  size,
  strokeWidth = 2,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

function TelegramIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6.4 13.5l-4.9-1.5c-1.1-.3-1.1-1 .2-1.5L20.5 3c.9-.3 1.7.2 1.4 1.3z" />
    </svg>
  );
}

// ── вехи: где на дорожке стоят точки и докуда закрашено ──────────────────────
/** Точки стоят по центрам равных колонок; дорожка тянется от края до последней. */
function roadGeometry(count: number) {
  const trackWidth = count > 0 ? ((2 * count - 1) / (2 * count)) * 100 : 100;
  const positions = Array.from({ length: count }, (_, i) =>
    count > 1 ? ((2 * i + 1) / (2 * count - 1)) * 100 : 100,
  );
  return { trackWidth, positions };
}

function roadPercent(confirmed: number, needs: number[], positions: number[]): number {
  let prevNeed = 0;
  let prevPos = 0;
  for (let i = 0; i < needs.length; i++) {
    if (confirmed <= needs[i]) {
      return prevPos + ((confirmed - prevNeed) / (needs[i] - prevNeed)) * (positions[i] - prevPos);
    }
    prevNeed = needs[i];
    prevPos = positions[i];
  }
  return 100;
}

// ── кореша ───────────────────────────────────────────────────────────────────
const FRIEND_STATUS: Record<MitrayReferee['status'], [string, string]> = {
  paying: ['st green', 'Платит'],
  waiting: ['st acc', 'Ждём подключения'],
  gone: ['st', 'Слетел'],
  joined: ['st grey', 'Не платил'],
};

function friendLine(f: MitrayReferee): string {
  const earned = f.earned_days > 0 ? `+${days(f.earned_days)} тебе` : '';
  switch (f.status) {
    case 'paying':
      return [f.tariff_name, f.subscription_end && `до ${fmtShort(f.subscription_end)}`, earned]
        .filter(Boolean)
        .join(' · ');
    case 'waiting':
      return [
        f.paid_at ? `оплатил ${fmtShort(f.paid_at)}` : 'оплатил',
        f.pending_days > 0 ? `награда +${days(f.pending_days)} ждёт` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'gone':
      return [
        f.subscription_end ? `подписка кончилась ${fmtShort(f.subscription_end)}` : 'подписки нет',
        earned,
      ]
        .filter(Boolean)
        .join(' · ');
    default:
      return f.on_trial
        ? `пробный период · с ${fmtShort(f.joined_at)}`
        : `зарегистрировался ${fmtShort(f.joined_at)}`;
  }
}

// ── награды ──────────────────────────────────────────────────────────────────
function rewardLine(r: MitrayReward, pending: boolean): string {
  if (r.kind === 'milestone') {
    const n = r.threshold ?? 0;
    return `Веха: ${n} подтверждённых ${friendsWord(n)}`;
  }
  const who = r.referee_name ?? 'Кореш';
  const paid =
    r.amount_kopeks > 0 ? `${who} оплатил · ${rubles(r.amount_kopeks)}` : `${who} оплатил`;
  return pending ? `${paid}. Откроется, когда он подключится со своего устройства` : paid;
}

export default function MitrayReferral() {
  const { data } = useQuery({
    queryKey: MITRAY_REFERRAL_KEY,
    queryFn: mitrayReferralApi.getSummary,
    staleTime: 30_000,
  });
  if (!data?.enabled) return null;
  return <Koresha data={data} />;
}

function Koresha({ data }: { data: MitrayReferralSummary }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { openTelegramLink } = usePlatform();

  const [taken, setTaken] = useState<Record<number, MitrayReward>>({});
  const [showAllFriends, setShowAllFriends] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkCard = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const { data: partnerStatus } = useQuery({
    queryKey: ['partner-status'],
    queryFn: partnerApi.getStatus,
  });
  const { data: terms } = useQuery({
    queryKey: ['referral-terms'],
    queryFn: referralApi.getReferralTerms,
  });

  // ── расчёты ────────────────────────────────────────────────────────────────
  const need = Math.max(1, data.need_count);
  const paying = data.paying;
  const monthDays = data.month_days;
  const free = monthDays >= MONTH_DAYS;
  const many = free && paying.length >= need * 2;
  const perStandard =
    shareDays(data.standard_price_kopeks, data.price_kopeks, data.share_denominator) || 10;
  const sub = data.subscription;
  const capped = data.has_subscription && data.days_left >= data.bank_cap_days - 7;
  const waitingCount = data.referees.filter((r) => r.status === 'waiting').length;

  // ── награды к получению ──────────────────────────────────────────────────
  const claimMutation = useMutation({
    mutationFn: (ids?: number[]) => mitrayReferralApi.claim(ids),
    onSuccess: (result, ids) => {
      const claimedNow = data.claims.filter(
        (c) => c.status === 'available' && (!ids || ids.includes(c.id)),
      );
      setTaken((prev) => {
        const next = { ...prev };
        claimedNow.forEach((c) => {
          next[c.id] = c;
        });
        return next;
      });
      const parts: string[] = [];
      if (result.balance_kopeks > 0) {
        parts.push(`+${rubles(result.balance_kopeks)} на баланс — по цене дня твоего тарифа`);
      } else if (result.granted_days > 0) {
        parts.push(
          `+${days(result.granted_days)} к подписке — теперь до ${fmtDate(result.end_date)}`,
        );
        setFlashKey((k) => k + 1);
      }
      if (result.burned_days > 0) parts.push(`${days(result.burned_days)} сверх года сгорели`);
      showToast({
        type: result.panel_synced ? 'success' : 'warning',
        message: result.panel_synced
          ? parts.join(' · ')
          : `${parts.join(' · ')}. VPN обновится в течение пары минут — если нет, напиши в поддержку.`,
      });
      queryClient.invalidateQueries({ queryKey: MITRAY_REFERRAL_KEY });
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
    },
    onError: (err) => {
      showToast({
        type: 'error',
        message: mitrayErrorMessage(err, 'Не получилось забрать — попробуй ещё раз'),
      });
      queryClient.invalidateQueries({ queryKey: MITRAY_REFERRAL_KEY });
    },
  });

  const serverIds = new Set(data.claims.map((c) => c.id));
  const takenRows = Object.values(taken).filter((c) => !serverIds.has(c.id));
  const openClaims = data.claims.filter((c) => c.status === 'available' && !taken[c.id]);
  const canClaim = data.has_subscription && !claimMutation.isPending;
  const claimRows = [...data.claims, ...takenRows];

  // ── код кореша ────────────────────────────────────────────────────────────
  const CODE_HINT = `${CODE_LENGTH} символов — кореш найдёт свой код на этой же странице.`;
  const [code, setCode] = useState('');
  const [codeMsg, setCodeMsg] = useState<{ kind: 'hint' | 'ok' | 'err'; text: string }>({
    kind: 'hint',
    text: CODE_HINT,
  });
  const [codeApplied, setCodeApplied] = useState(false);
  const codeMutation = useMutation({
    mutationFn: (value: string) => mitrayReferralApi.applyCode(value),
    onSuccess: (result, value) => {
      setCodeApplied(true);
      const from = result.referrer_name ? `, кореш — ${result.referrer_name}` : '';
      setCodeMsg({
        kind: 'ok',
        text: `Код ${value} принят${from}. Оплати подписку от ${days(data.welcome_min_period_days)} — сверху добавим +${days(data.welcome_days)}.`,
      });
    },
    onError: (err) => {
      setCodeMsg({
        kind: 'err',
        text: mitrayErrorMessage(err, 'Не получилось применить код — попробуй ещё раз'),
      });
    },
  });
  const onCodeInput = (raw: string) => {
    const upper = raw.toUpperCase();
    const value = Array.from(upper)
      .filter((ch) => CODE_ALPHABET.includes(ch))
      .join('')
      .slice(0, CODE_LENGTH);
    setCode(value);
    setCodeMsg({
      kind: 'hint',
      text: /[01OIL]/.test(upper)
        ? 'В кодах нет букв O, I, L и цифр 0, 1 — их легко спутать.'
        : CODE_HINT,
    });
  };
  const onCodeSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== CODE_LENGTH || codeMutation.isPending || codeApplied) return;
    if (code === data.short_code) {
      setCodeMsg({
        kind: 'err',
        text: 'Это твой код — его отправляют корешам. Нужен код того, кто тебя позвал.',
      });
      return;
    }
    codeMutation.mutate(code);
  };
  const showCodeInput = data.can_enter_code || codeApplied;

  // ── ссылка и сообщение ────────────────────────────────────────────────────
  const shareLink = data.bot_link || data.cabinet_link;
  const message =
    `Го в Mitray VPN. По моей ссылке к первой подписке +${days(data.welcome_days)} сверху: ` +
    `платишь за месяц — сидишь два.` +
    (shareLink ? ` ${shareLink}` : '') +
    (data.short_code ? ` · код ${data.short_code}` : '');

  const copy = async (text: string, key: string) => {
    try {
      await copyToClipboard(text);
      setCopied(key);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1400);
    } catch {
      showToast({ type: 'info', message: text });
    }
  };
  const sendToTelegram = () => {
    if (!shareLink) return;
    const text = message.replace(` ${shareLink}`, '');
    openTelegramLink(
      `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(text)}`,
    );
  };
  const callFriend = () => {
    const card = linkCard.current;
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('ping');
    void card.offsetWidth; // перезапуск анимации
    card.classList.add('ping');
  };

  // ── герой ──────────────────────────────────────────────────────────────────
  const kicker = sub?.is_trial ? (
    <>
      Сейчас · <b>пробный период</b>
    </>
  ) : data.has_subscription ? (
    <>
      Твой тариф · <b>{sub?.tariff_name ?? 'подписка'}</b>
    </>
  ) : (
    <>
      Сейчас · <b>без подписки</b>
    </>
  );
  const heroTitle = many ? (
    <>
      <span className="num">{paying.length}</span>
      <span>{plural(paying.length, 'кореш платит', 'кореша платят', 'корешей платят')}</span>
    </>
  ) : free ? (
    <>
      <span>VPN за тебя оплачивают</span>
      <span className="acc">кореша</span>
    </>
  ) : (
    <>
      <span className="num">{paying.length}</span>
      <span className="of">из {need}</span>
      <span>{plural(need, 'кореша платят', 'корешей платят', 'корешей платят')}</span>
    </>
  );
  const untilSub = sub?.is_trial
    ? 'пробный период'
    : capped
      ? 'подписка уже на год вперёд'
      : monthDays > 0
        ? `+${days(monthDays)} в месяц от корешей`
        : data.has_subscription
          ? 'позови корешей — продлим днями'
          : 'подписки пока нет';
  const stillNeeded = Math.max(1, Math.ceil(((MONTH_DAYS - monthDays) * need) / MONTH_DAYS));
  const heroText = free ? (
    <>
      Кореша приносят <b>~{days(monthDays)} в месяц</b> — больше, чем ты тратишь. Лишнее копится на
      подписке — до года вперёд.
    </>
  ) : paying.length === 0 ? (
    <>
      Каждый кореш платит за свой VPN, а <b>треть его оплаты</b> падает тебе днями подписки.{' '}
      {friendsTitle(need)} на Стандарте — и твой месяц закрыт.
    </>
  ) : (
    <>
      Ещё <b>{payingWord(stillNeeded)}</b> — и VPN для тебя бесплатный. Сейчас кореша приносят{' '}
      {days(monthDays)} в месяц, нужно {MONTH_DAYS}.
    </>
  );

  type Segment = { name: string; days: number; extra?: boolean; agg?: number } | null;
  const baseCount = free ? Math.min(need, paying.length) : need;
  const extra = paying.slice(baseCount);
  const segments: Segment[] = Array.from({ length: baseCount }, (_, i) =>
    paying[i] ? { name: paying[i].name, days: paying[i].days_per_month } : null,
  );
  if (extra.length === 1)
    segments.push({ name: extra[0].name, days: extra[0].days_per_month, extra: true });
  if (extra.length > 1) {
    segments.push({
      name: `+${extra.length} ${friendsWord(extra.length)}`,
      days: extra.reduce((sum, f) => sum + f.days_per_month, 0),
      extra: true,
      agg: extra.length,
    });
  }
  const slotsStyle = {
    '--n': segments.length,
    gridTemplateColumns:
      extra.length > 1 ? `repeat(${baseCount},minmax(0,1fr)) minmax(0,1.6fr)` : undefined,
  } as CSSProperties;

  // ── «Сколько получишь» ────────────────────────────────────────────────────
  const freeAt = Math.max(1, Math.ceil(MONTH_DAYS / perStandard));
  const ladderCounts = Array.from(new Set([...LADDER_COUNTS, freeAt])).sort((a, b) => a - b);
  const milestoneByNeed = new Map(data.milestones.map((m) => [m.need, m.days]));
  const ladder = ladderCounts.map((n) => {
    const total = n * perStandard;
    let title: string;
    let text: string;
    if (n === freeAt) {
      title = 'VPN бесплатный';
      text = `${days(total)} в месяц — твой месяц закрыт.`;
    } else if (total < MONTH_DAYS) {
      title = `+${days(total)} в месяц`;
      text =
        n === 1
          ? 'Каждый месяц, пока кореш платит, а не разово.'
          : 'Ещё не весь месяц, но платишь заметно меньше.';
    } else if (total >= 180) {
      title = 'Год VPN за пару месяцев';
      text = `~${days(total)} в месяц — подписка быстро упирается в годовой потолок.`;
    } else {
      title = `+${days(total - MONTH_DAYS)} в месяц впрок`;
      text = 'Сверх бесплатного копится на подписке — до года вперёд.';
    }
    return { n, title, text, milestone: milestoneByNeed.get(n) };
  });
  let here = -1;
  ladder.forEach((row, i) => {
    if (paying.length >= row.n) here = i;
  });

  // ── вехи ───────────────────────────────────────────────────────────────────
  const stops = data.milestones;
  const confirmed = data.active_count;
  const nextStop = stops.find((s) => s.need > confirmed);
  const { trackWidth, positions } = roadGeometry(stops.length);
  const roadFill = roadPercent(
    confirmed,
    stops.map((s) => s.need),
    positions,
  );
  const milestoneWaiting = (need: number) =>
    data.claims.some(
      (c) =>
        c.kind === 'milestone' && c.threshold === need && c.status === 'available' && !taken[c.id],
    );

  // ── кореша ─────────────────────────────────────────────────────────────────
  const friends = showAllFriends ? data.referees : data.referees.slice(0, FRIENDS_SHOWN);
  const hiddenFriends = data.referees.length - friends.length;

  // ── партнёрка ──────────────────────────────────────────────────────────────
  const partnerState = partnerStatus?.partner_status ?? 'none';
  const partnerVisible = terms?.partner_section_visible !== false && partnerState !== 'approved';

  const exampleDays = shareDays(
    data.standard_price_kopeks,
    data.price_kopeks,
    data.share_denominator,
  );
  const exampleRub = rubles(data.standard_price_kopeks);

  return (
    <div className="mitray-kor">
      <div className="phead">
        <h1>{friendsTitle(need)} — и VPN бесплатный</h1>
      </div>

      <section className={free ? 'hero free rv' : 'hero rv'} aria-label="Прогресс">
        <div className="hero-top">
          <div className="hero-main">
            <div className="kick">{kicker}</div>
            <div className="hero-title">{heroTitle}</div>
          </div>
          <div className="hero-until">
            <div className="kick">Подписка до</div>
            <div key={flashKey} className={flashKey ? 'd flash' : 'd'}>
              {fmtDate(sub?.end_date)}
            </div>
            <div className="s">{untilSub}</div>
          </div>
        </div>
        <div className={segments.length > 5 ? 'slots dense' : 'slots'} style={slotsStyle}>
          {segments.map((seg, i) =>
            seg ? (
              <div
                key={i}
                className={seg.extra ? 'slot on extra' : 'slot on'}
                style={{ '--i': i } as CSSProperties}
              >
                <div className="bar">
                  <i />
                </div>
                <div className="lb">
                  <b>{seg.name}</b>
                  <span>
                    +{seg.days} дн/мес{seg.extra && !seg.agg ? ' · сверху' : ''}
                  </span>
                </div>
              </div>
            ) : (
              <div key={i} className="slot vacant">
                <div className="bar" />
                <div className="lb">
                  <b>Свободно</b>
                  <span>позови кореша</span>
                </div>
              </div>
            ),
          )}
        </div>
        <div className="hero-goal">
          <p>{heroText}</p>
          <button className="cta" type="button" onClick={callFriend}>
            <Icon name="plus" size={17} strokeWidth={2.2} />
            <span>{paying.length ? 'Позвать ещё' : 'Позвать кореша'}</span>
          </button>
        </div>
      </section>

      <div className="ref-grid">
        {data.referees_total > 0 && (
          <section
            className="rstats o-stats rv"
            style={{ '--d': '.04s' } as CSSProperties}
            aria-label="Итоги"
          >
            <div className="rstat">
              <span className="ic">
                <Icon name="users" size={20} />
              </span>
              <div className="v">{data.referees_total}</div>
              <div className="sub">
                {plural(data.referees_total, 'кореша привёл', 'кореша привёл', 'корешей привёл')} ·{' '}
                {waitingCount > 0
                  ? `${waitingCount} ${plural(waitingCount, 'ждёт', 'ждут', 'ждут')} подключения`
                  : `${paying.length} ${plural(paying.length, 'платит', 'платят', 'платят')}`}
              </div>
            </div>
            <div className="rstat">
              <span className="ic">
                <Icon name="clock" size={20} />
              </span>
              <div className="v acc">+{data.claimed_days_total}</div>
              <div className="sub">{daysWord(data.claimed_days_total)} подписки от корешей</div>
            </div>
            <div className="rstat">
              <span className="ic">
                <Icon name="ruble" size={20} />
              </span>
              <div className="v green">{rubles(data.saved_kopeks)}</div>
              <div className="sub">сэкономлено на подписке</div>
            </div>
          </section>
        )}

        <section
          className="steps o-steps rv"
          style={{ '--d': '.06s' } as CSSProperties}
          aria-label="Как это работает"
        >
          <div className="stp">
            <span className="n">1</span>
            <b>Кореш приходит по ссылке или с кодом</b>
            <p>
              К его первой подписке от {days(data.welcome_min_period_days)} —{' '}
              <em>+{days(data.welcome_days)}</em> сверху. Заплатил за месяц — сидит два.
            </p>
            <span className="f">30 дней + {data.welcome_days} в подарок</span>
          </div>
          <div className="stp">
            <span className="n">2</span>
            <b>Платит он — получаешь ты</b>
            <p>Треть каждой его оплаты — днями твоего тарифа. Не разово, а пока он с нами.</p>
            <span className="f">
              {exampleRub} кореша → {days(exampleDays)} тебе
            </span>
          </div>
          <div className="stp">
            <span className="n">3</span>
            <b>{COLLECTIVE[need] ?? friendsTitle(need)} платят — ты нет</b>
            <p>
              {friendsTitle(need)} на Стандарте закрывают твой месяц
              {sub?.tariff_name &&
              data.has_subscription &&
              data.price_kopeks !== data.standard_price_kopeks
                ? ` на тарифе «${sub.tariff_name}»`
                : ''}
              .
            </p>
            <span className="f">
              {need} × {perStandard} = {days(need * perStandard)}
            </span>
          </div>
        </section>

        {/* ЛЕВАЯ КОЛОНКА */}
        <div className="col">
          {showCodeInput && (
            <div className="card codein o-codein rv" style={{ '--d': '.06s' } as CSSProperties}>
              <div className="card-h">
                <div className="t">
                  <Icon name="key" />
                  Пришёл от кореша?
                </div>
              </div>
              <p className="cin-t">
                Введи его код — и к первой подписке от {days(data.welcome_min_period_days)} добавим{' '}
                <b>+{days(data.welcome_days)}</b>.
              </p>
              <form className="cin" autoComplete="off" noValidate onSubmit={onCodeSubmit}>
                <label className="sr" htmlFor="kor-code">
                  Код кореша
                </label>
                <input
                  id="kor-code"
                  name="code"
                  maxLength={12}
                  placeholder="H4TR9D"
                  spellCheck={false}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  value={code}
                  disabled={codeApplied}
                  onChange={(e) => onCodeInput(e.target.value)}
                />
                <button
                  className="cta"
                  type="submit"
                  disabled={code.length !== CODE_LENGTH || codeMutation.isPending || codeApplied}
                >
                  {codeApplied ? 'Принят' : codeMutation.isPending ? 'Проверяем…' : 'Применить'}
                </button>
              </form>
              <p
                className={
                  codeMsg.kind === 'ok'
                    ? 'cin-msg ok'
                    : codeMsg.kind === 'err'
                      ? 'cin-msg err'
                      : 'cin-msg'
                }
              >
                {codeMsg.text}
              </p>
            </div>
          )}

          {claimRows.length > 0 && (
            <div className="card claim o-claim rv" style={{ '--d': '.08s' } as CSSProperties}>
              <div className="card-h">
                <div className="t">
                  Забери награды
                  {openClaims.length > 0 && <span className="cbadge">{openClaims.length}</span>}
                </div>
                {openClaims.length > 1 && (
                  <button
                    className="sbtn"
                    type="button"
                    disabled={!canClaim}
                    onClick={() => claimMutation.mutate(undefined)}
                  >
                    Забрать всё
                  </button>
                )}
              </div>
              {data.over_cap_days > 0 && openClaims.length > 0 && (
                <div className="capnote">
                  <Icon name="gift" />
                  <span>
                    Подписка почти на год вперёд — влезет ещё <b>{days(data.claimable_days)}</b>,
                    остальные {days(data.over_cap_days)} сгорят. Год — потолок.
                  </span>
                </div>
              )}
              {!data.has_subscription && openClaims.length > 0 && (
                <div className="capnote">
                  <Icon name="cal" />
                  <span>
                    Дни ложатся в оплаченную подписку — оформи её, и награды можно будет забрать.
                    Ближайшая ждёт до <b>{fmtShort(data.available_until)}</b>.
                  </span>
                </div>
              )}
              <div>
                {claimRows.map((r) => {
                  const isTaken = Boolean(taken[r.id]);
                  const pending = r.status === 'pending';
                  const left = daysUntil(r.expires_at);
                  const rowClass = isTaken
                    ? 'claim-row taken'
                    : pending
                      ? 'claim-row pending'
                      : 'claim-row';
                  return (
                    <div key={r.id} className={rowClass}>
                      <span className={r.kind === 'milestone' ? 'ic gold' : 'ic'}>
                        <Icon name={r.kind === 'milestone' ? 'flag' : 'cal'} />
                      </span>
                      <div className="u">
                        <b>
                          +{days(r.days)}
                          {r.kind === 'milestone' ? ' за веху' : ' к подписке'}
                        </b>
                        <p>{rewardLine(r, pending)}</p>
                      </div>
                      <div className="act">
                        <button
                          className="take"
                          type="button"
                          disabled={pending || isTaken || !canClaim}
                          onClick={() => claimMutation.mutate([r.id])}
                        >
                          {pending ? 'Ждём' : isTaken ? 'Забрано' : 'Забрать'}
                        </button>
                        {!pending && !isTaken && (
                          <span className={left <= 3 ? 'left hot' : 'left'}>
                            <Icon name="clock" />
                            ещё {days(left)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="note mt">
                Награда ждёт <b>{days(data.claim_window_days)}</b>, потом сгорает.{' '}
                {sub?.is_daily
                  ? 'Ты на подневном тарифе — дни придут на баланс по цене дня.'
                  : 'Дни сразу добавляются к подписке.'}
              </p>
            </div>
          )}

          <div className="card o-link rv" ref={linkCard} style={{ '--d': '.12s' } as CSSProperties}>
            <div className="card-h">
              <div className="t">Твоя ссылка</div>
              <div className="sub">кидай куда хочешь</div>
            </div>
            {data.short_code && (
              <div className="codebox">
                <div className="kick">Твой код</div>
                <div className="top">
                  <div className="cells" role="img" aria-label={`Код ${data.short_code}`}>
                    {Array.from(data.short_code).map((ch, i) => (
                      <span key={i}>{ch}</span>
                    ))}
                  </div>
                  <button
                    className={copied === 'code' ? 'sbtn done' : 'sbtn'}
                    type="button"
                    aria-label="Скопировать код"
                    onClick={() => copy(data.short_code ?? '', 'code')}
                  >
                    <Icon name={copied === 'code' ? 'check' : 'copy'} size={15} />
                    <span>{copied === 'code' ? 'Скопировано' : 'Копировать'}</span>
                  </button>
                </div>
                <p className="note">
                  Если ссылка не открывается — кореш вводит код руками в поле «Пришёл от кореша?».
                </p>
              </div>
            )}
            {data.bot_link && (
              <div className="lrow">
                <span className="ic">
                  <TelegramIcon size={18} />
                </span>
                <div className="u">
                  <b>Телеграм-бот</b>
                  <div className="url">{shortUrl(data.bot_link)}</div>
                </div>
                <button
                  className={copied === 'bot' ? 'sbtn done' : 'sbtn'}
                  type="button"
                  aria-label="Скопировать ссылку на бота"
                  onClick={() => copy(data.bot_link, 'bot')}
                >
                  <Icon name={copied === 'bot' ? 'check' : 'copy'} size={15} />
                  <span>{copied === 'bot' ? 'Скопировано' : 'Копировать'}</span>
                </button>
              </div>
            )}
            {data.cabinet_link && (
              <div className="lrow">
                <span className="ic">
                  <Icon name="link" size={18} />
                </span>
                <div className="u">
                  <b>Сайт</b>
                  <div className="url">{shortUrl(data.cabinet_link)}</div>
                </div>
                <button
                  className={copied === 'site' ? 'sbtn done' : 'sbtn'}
                  type="button"
                  aria-label="Скопировать ссылку на сайт"
                  onClick={() => copy(data.cabinet_link, 'site')}
                >
                  <Icon name={copied === 'site' ? 'check' : 'copy'} size={15} />
                  <span>{copied === 'site' ? 'Скопировано' : 'Копировать'}</span>
                </button>
              </div>
            )}
            <div className="msg">
              <div className="k">Готовое сообщение</div>
              <p className="mtxt">{message}</p>
              <div className="acts">
                {shareLink && (
                  <button className="btn-tg" type="button" onClick={sendToTelegram}>
                    <TelegramIcon size={15} />
                    Отправить в Телеграм
                  </button>
                )}
                <button
                  className={copied === 'msg' ? 'sbtn done' : 'sbtn'}
                  type="button"
                  onClick={() => copy(message, 'msg')}
                >
                  <Icon name={copied === 'msg' ? 'check' : 'copy'} size={15} />
                  <span>{copied === 'msg' ? 'Скопировано' : 'Скопировать текст'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="card o-friends rv" style={{ '--d': '.16s' } as CSSProperties}>
            <div className="card-h">
              <div className="t">Твои кореша</div>
              {data.referees_total > 0 && (
                <div className="sub">
                  {data.referees_total}{' '}
                  {plural(data.referees_total, 'человек', 'человека', 'человек')}
                </div>
              )}
            </div>
            {data.referees.length === 0 ? (
              <div className="empty">
                <span className="ic">
                  <Icon name="users" size={22} />
                </span>
                <b>Пока никого</b>
                <p>
                  Скинь ссылку в чат, где сидите с друзьями, — кореша появятся здесь сразу после
                  регистрации.
                </p>
              </div>
            ) : (
              <>
                {friends.map((f) => {
                  const [stClass, stLabel] = FRIEND_STATUS[f.status];
                  const off = f.status !== 'paying' && f.status !== 'waiting';
                  return (
                    <div key={f.id} className={off ? 'rr off' : 'rr'}>
                      <span className="ava">{initial(f.name)}</span>
                      <div className="nm">
                        <b>{f.name}</b>
                        <p>{friendLine(f)}</p>
                      </div>
                      <span className={stClass}>{stLabel}</span>
                    </div>
                  );
                })}
                {hiddenFriends > 0 && (
                  <button className="more" type="button" onClick={() => setShowAllFriends(true)}>
                    Показать ещё {hiddenFriends}
                  </button>
                )}
              </>
            )}
          </div>

          {partnerVisible && partnerStatus && (
            <div className="card partner o-partner rv" style={{ '--d': '.22s' } as CSSProperties}>
              <span className="ic">
                <Icon name="star" size={22} />
              </span>
              {partnerState === 'pending' ? (
                <>
                  <b>Заявка на партнёрку у нас</b>
                  <p>
                    Смотрим вручную и ответим в боте. Пока ждёшь — кореша по ссылке считаются как
                    обычно.
                  </p>
                </>
              ) : (
                <>
                  <b>Ведёшь канал или чат?</b>
                  <p>
                    {partnerState === 'rejected'
                      ? partnerStatus.latest_application?.admin_comment ||
                        'Прошлую заявку не одобрили — можно подать новую.'
                      : 'Для блогеров и админов — партнёрская программа с отдельными условиями. Заявки смотрим вручную.'}
                  </p>
                  <button
                    className="sbtn"
                    type="button"
                    onClick={() => navigate('/referral/partner/apply')}
                  >
                    {partnerState === 'rejected' ? 'Подать заново' : 'Подать заявку'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ПРАВАЯ КОЛОНКА */}
        <div className="col">
          <div className="card o-ladder rv" style={{ '--d': '.08s' } as CSSProperties}>
            <div className="card-h">
              <div className="t">Сколько получишь</div>
            </div>
            <p className="lad-intro">
              Цифра слева — сколько корешей сейчас платят. Считаем, что они на Стандарте.
            </p>
            <div className="lad">
              {ladder.map((row, i) => (
                <div
                  key={row.n}
                  className={i === here ? 'lad-row here' : i < here ? 'lad-row passed' : 'lad-row'}
                >
                  <span className="cnt">{row.n}</span>
                  <div className="tx">
                    <b>
                      {row.title}
                      {i === here && <span className="here-tag">ты здесь</span>}
                    </b>
                    <p>{row.text}</p>
                    {row.milestone && (
                      <span className="ms">
                        <Icon name="flag" />
                        веха: +{days(row.milestone)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="note mt">
              Кореш на тарифе дороже приносит больше дней — треть его оплаты.
            </p>
          </div>

          {stops.length > 0 && (
            <div className="card o-road rv" style={{ '--d': '.1s' } as CSSProperties}>
              <div className="card-h">
                <div className="t">Вехи</div>
                <div className="sub">разовые бонусы, днями</div>
              </div>
              <div className="road">
                <div className="track" style={{ width: `${trackWidth}%` }}>
                  <i style={{ '--p': `${roadFill.toFixed(2)}%` } as CSSProperties} />
                </div>
                <div
                  className="stops"
                  style={{ gridTemplateColumns: `repeat(${stops.length},minmax(0,1fr))` }}
                >
                  {stops.map((s) => {
                    const isNext = s === nextStop;
                    const small = s.reached
                      ? milestoneWaiting(s.need)
                        ? 'в наградах'
                        : s.rewarded
                          ? 'получено'
                          : 'скоро в наградах'
                      : isNext
                        ? `ещё ${s.need - confirmed}`
                        : '';
                    return (
                      <div
                        key={s.need}
                        className={s.reached ? 'stop done' : isNext ? 'stop next' : 'stop locked'}
                      >
                        <span className="dot">{s.need}</span>
                        <b>+{days(s.days)}</b>
                        <small>{small}</small>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="road-sum">
                {!confirmed ? (
                  <>
                    Подтверждённых корешей пока нет. Первая веха —{' '}
                    <b>{friendsTitle(stops[0].need).toLowerCase()}</b>, за неё +
                    {days(stops[0].days)}.
                  </>
                ) : nextStop ? (
                  <>
                    Подтверждённых корешей: <b>{confirmed}</b>. До вехи {nextStop.need} — ещё{' '}
                    {nextStop.need - confirmed}, за неё +{days(nextStop.days)}.
                  </>
                ) : (
                  <>
                    Подтверждённых корешей: <b>{confirmed}</b>. Все вехи пройдены.
                  </>
                )}
              </div>
              <p className="note mt">
                Подтверждённый кореш — оплатил, подключился со своего устройства и пользуется VPN:
                от 1 ГБ за 3 дня.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
