import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Twemoji from 'react-twemoji';
import { GlobeIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { serverFlagEmoji, splitServerName } from './serverLocations';
import type { CSSProperties } from 'react';
import type { TariffServer } from '../../../types';

// ──────────────────────────────────────────────────────────────────
// TariffLocationsPanel
//
// The locations reveal that slides over a tariff card when the
// "N локаций" spec is clicked (see .tc-locs in purchase.css). Purely
// presentational: the card owns the open/closing state, this renders
// the staggered list of squads with flags.
// ──────────────────────────────────────────────────────────────────

const TWEMOJI_OPTIONS = { className: 'twemoji', folder: 'svg', ext: '.svg' } as const;

export interface TariffLocationsPanelProps {
  servers: TariffServer[];
  /** allowed_squads length — may exceed servers.length on older backends. */
  totalCount: number;
  closing: boolean;
  onClose: () => void;
  id?: string;
}

export function TariffLocationsPanel({
  servers,
  totalCount,
  closing,
  onClose,
  id,
}: TariffLocationsPanelProps) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc closes; focus lands on the close button so keyboard users can
  // dismiss without hunting for it.
  useEffect(() => {
    if (closing) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closing, onClose]);

  const hidden = Math.max(0, totalCount - servers.length);

  return (
    <div
      id={id}
      className={cn('tc-locs', closing && 'out')}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="tl-head">
        <span className="tl-ico">
          <GlobeIcon className="h-[17px] w-[17px]" />
        </span>
        <span className="tl-title">{t('subscription.locationsLabel', 'Локации')}</span>
        <span className="tl-count">{totalCount || servers.length}</span>
        <button
          ref={closeRef}
          type="button"
          className="tl-x"
          onClick={onClose}
          aria-label={t('common.close', 'Закрыть')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* noWrapper: twemoji parses inside .tl-list itself, no extra DOM layer */}
      <Twemoji options={TWEMOJI_OPTIONS} noWrapper>
        <div className="tl-list">
          {servers.map((server, idx) => {
            const { name, note } = splitServerName(server.name);
            return (
              <div key={server.uuid} className="tl-row" style={{ '--i': idx } as CSSProperties}>
                <span className="tl-flag">{serverFlagEmoji(server)}</span>
                <span className="tl-name">
                  {name}
                  {note && <i>{note}</i>}
                </span>
                <span className="tl-live" aria-hidden="true" />
              </div>
            );
          })}
        </div>
      </Twemoji>

      {hidden > 0 && (
        <div className="tl-more">
          {t('subscription.tariff.locationsMore', {
            count: hidden,
            defaultValue: 'и ещё {{count}}',
          })}
        </div>
      )}
    </div>
  );
}
