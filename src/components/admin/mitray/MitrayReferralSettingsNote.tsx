import { useNavigate } from 'react-router';

import { ChevronRightIcon } from '@/components/icons';

// Mitray: над настройками REFERRAL — что они теперь значат при рефералке v3.

export function MitrayReferralSettingsNote() {
  const navigate = useNavigate();
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-warning-500/30 bg-warning-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-dark-300">
        Бонусы, комиссии, уровни и вывод здесь — старая рублёвая схема. Сейчас она действует только
        для партнёров на личном проценте. Рефералка v3 настраивается в .env бота (MITRAY_REF_V3_*).
      </p>
      <button
        onClick={() => navigate('/admin/mitray-referral')}
        className="flex shrink-0 items-center gap-1 self-start rounded-lg bg-dark-700/60 px-3 py-1.5 text-sm font-medium text-dark-200 transition-colors hover:text-dark-100 sm:self-auto"
      >
        Правила v3
        <ChevronRightIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
