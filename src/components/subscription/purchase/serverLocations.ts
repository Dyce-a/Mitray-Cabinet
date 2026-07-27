// ──────────────────────────────────────────────────────────────────
// Helpers for the tariff locations reveal (TariffPickerGrid).
//
// Squad display names come from the admin panel and are free-form
// ("Германия | 2", "Латвия | Белые списки", "Финляндия"), and the
// purchase-options payload may ship them without a country_code.
// These helpers make them presentable: split the qualifier off the
// country, and fall back to guessing the flag from the name.
// ──────────────────────────────────────────────────────────────────

import { getFlagEmoji } from '../../../utils/subscriptionHelpers';
import type { TariffServer } from '../../../types';

/** "Германия | 2" → { name: 'Германия', note: '2' } */
export function splitServerName(raw: string): { name: string; note: string | null } {
  const value = (raw || '').trim();
  const parts = value.split(/\s*[|·]\s*/).filter(Boolean);
  if (parts.length < 2) return { name: value, note: null };
  return { name: parts[0] as string, note: parts.slice(1).join(' · ') };
}

// Name stems → ISO-3166 alpha-2. Used only when the backend has no
// country_code for a squad; matched against the lowercased name.
const NAME_STEMS: ReadonlyArray<readonly [string, string]> = [
  ['финлянд', 'FI'],
  ['finland', 'FI'],
  ['герман', 'DE'],
  ['germany', 'DE'],
  ['польш', 'PL'],
  ['poland', 'PL'],
  ['латв', 'LV'],
  ['latvia', 'LV'],
  ['литв', 'LT'],
  ['lithuania', 'LT'],
  ['эстон', 'EE'],
  ['estonia', 'EE'],
  ['франц', 'FR'],
  ['france', 'FR'],
  ['нидерланд', 'NL'],
  ['голланд', 'NL'],
  ['netherlands', 'NL'],
  ['швейцар', 'CH'],
  ['switzerland', 'CH'],
  ['швец', 'SE'],
  ['sweden', 'SE'],
  ['норвег', 'NO'],
  ['norway', 'NO'],
  ['дани', 'DK'],
  ['denmark', 'DK'],
  ['великобритан', 'GB'],
  ['британ', 'GB'],
  ['англи', 'GB'],
  ['сша', 'US'],
  ['америк', 'US'],
  ['турц', 'TR'],
  ['turkey', 'TR'],
  ['казахст', 'KZ'],
  ['армен', 'AM'],
  ['грузи', 'GE'],
  ['молдов', 'MD'],
  ['молдав', 'MD'],
  ['украин', 'UA'],
  ['беларус', 'BY'],
  ['белорус', 'BY'],
  ['австри', 'AT'],
  ['austria', 'AT'],
  ['австрал', 'AU'],
  ['испан', 'ES'],
  ['spain', 'ES'],
  ['итали', 'IT'],
  ['italy', 'IT'],
  ['чехи', 'CZ'],
  ['czech', 'CZ'],
  ['румын', 'RO'],
  ['болгар', 'BG'],
  ['серби', 'RS'],
  ['венгр', 'HU'],
  ['япон', 'JP'],
  ['japan', 'JP'],
  ['сингапур', 'SG'],
  ['singapore', 'SG'],
  ['гонконг', 'HK'],
  ['кита', 'CN'],
  ['инди', 'IN'],
  ['эмират', 'AE'],
  ['оаэ', 'AE'],
  ['дубай', 'AE'],
  ['канад', 'CA'],
  ['canada', 'CA'],
  ['бразил', 'BR'],
  ['кипр', 'CY'],
  ['греци', 'GR'],
  ['португал', 'PT'],
  ['ирланд', 'IE'],
  ['исланд', 'IS'],
  ['люксембург', 'LU'],
  ['бельги', 'BE'],
  ['словак', 'SK'],
  ['словени', 'SI'],
  ['хорват', 'HR'],
  ['росси', 'RU'],
  ['russia', 'RU'],
];

/** Best-effort flag for a squad: country_code first, then the name. */
export function serverFlagEmoji(server: TariffServer): string {
  const byCode = getFlagEmoji(server.country_code);
  if (byCode) return byCode;
  const haystack = (server.name || '').toLowerCase();
  for (const [stem, code] of NAME_STEMS) {
    if (haystack.includes(stem)) return getFlagEmoji(code);
  }
  return '🌍';
}
