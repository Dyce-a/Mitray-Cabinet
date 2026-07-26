/**
 * Иконки призов колеса — stroke-стиль кабинета (эмодзи в колесе не используем).
 * Номинала в WheelPrize нет, поэтому вид иконки выводим из типа приза и подписи
 * (подписи задаются в админке: «Джекпот · 300 ₽», «50 ₽ на баланс», «5 дней подписки»…).
 */

export const PRIZE_ICON_PATHS: Record<string, string> = {
  gem: 'M6 3h12l4 6-10 12L2 9z M2 9h20M12 21 8 9l4-6 4 6z',
  crown: 'M3 19h18M5 19 3 7l5.5 4L12 4l3.5 7L21 7l-2 12z',
  bill: 'M2 6h20v12H2z M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M6 12h.01M18 12h.01',
  calPlus: 'M3 5h18v16H3z M3 10h18M8 3v4M16 3v4M12 13.5v5M9.5 16h5',
  bars: 'M6 20v-6M12 20V7M18 20V10',
  coin: 'M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0 M10.2 16.5V8h3a2.5 2.5 0 0 1 0 5h-3M9 14.5h4.5',
  wind: 'M4 8h8.5a2.5 2.5 0 1 0-2.5-2.5M4 12h13a2.5 2.5 0 1 1-2.5 2.5M4 16h7',
  gift: 'M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7S9 2 6.5 4 9 7 12 7zM12 7s3-5 5.5-3S15 7 12 7z',
};

/** Минимум, по которому выбирается иконка (подходит и призу, и записи истории). */
export interface PrizeLike {
  prize_type: string;
  display_name: string;
}

const firstNumber = (s: string): number => {
  const m = s.replace(/\s+/g, '').match(/\d+/);
  return m ? Number(m[0]) : 0;
};

export function iconKeyFor(prize: PrizeLike): string {
  const type = prize.prize_type;
  const label = prize.display_name || '';
  const n = firstNumber(label);
  if (type === 'nothing') return 'wind';
  if (type === 'promocode') return 'gift';
  if (type === 'traffic_gb') {
    // у безлимитчиков бэкенд подменяет подпись на «+N дней» — показываем календарь
    return /ГБ|GB/i.test(label) ? 'bars' : 'calPlus';
  }
  if (type === 'subscription_days') return n >= 30 ? 'crown' : 'calPlus';
  if (type === 'balance_bonus') {
    if (/джекпот|jackpot/i.test(label) || n >= 300) return 'gem';
    if (n >= 50) return 'bill';
    return 'coin';
  }
  return 'gift';
}

export const isJackpot = (prize: PrizeLike): boolean => iconKeyFor(prize) === 'gem';

/**
 * Короткая подпись для сектора колеса. В админке имена длинные («30 дней подписки»,
 * «10 ₽ на баланс») — в дугу сектора они не влезают и налезают на соседей, поэтому
 * на самом колесе показываем суть («30 дней», «10 ₽»). В списках и истории
 * остаётся полное имя.
 */
export function shortLabel(prize: PrizeLike): string {
  let s = (prize.display_name || '').trim();
  s = s.replace(/^.*?\s[·—–-]\s+/, ''); // «Джекпот · 300 ₽» → «300 ₽»
  s = s.replace(/\s+(на|за)\s+.*$/i, ''); // «10 ₽ на баланс» → «10 ₽», «20 ГБ на месяц» → «20 ГБ»
  s = s.replace(/\s+подписки$/i, ''); // «5 дней подписки» → «5 дней»
  s = s.trim();
  if (!s) s = (prize.display_name || '').trim();
  return s.length > 12 ? `${s.slice(0, 11)}…` : s;
}

/** Путь иконки разбит на подпути (в записи через ' M'), чтобы рендерить <path> списком. */
export const iconSegments = (key: string): string[] => {
  const d = PRIZE_ICON_PATHS[key] ?? PRIZE_ICON_PATHS.gift;
  return d.split(' M').map((seg, i) => (i === 0 ? seg : `M${seg}`));
};
