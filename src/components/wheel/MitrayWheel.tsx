import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { WheelPrize } from '../../api/wheel';
import { iconKeyFor, iconSegments, isJackpot, shortLabel, type PrizeLike } from './prizeIcons';

/**
 * Колесо удачи в дизайне Mitray (порт прототипа design-lab/wheel.html).
 *
 * Контракт совместим с апстримным FortuneWheel: targetRotation — абсолютный угол
 * остановки (бэкенд отдаёт его в rotation_degrees), к которому добавляется 5 оборотов;
 * onSpinComplete зовётся по окончании прокрута.
 */

const SIZE = 560;
const C = SIZE / 2;
const R = 252;
const RING = 271;
const SPIN_MS = 5200;

export function PrizeIcon({ prize, size = 18 }: { prize: PrizeLike; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconSegments(iconKeyFor(prize)).map((seg, i) => (
        <path key={i} d={seg} />
      ))}
    </svg>
  );
}

const rad = (a: number) => ((a - 90) * Math.PI) / 180;
const px = (a: number, r: number) => C + r * Math.cos(rad(a));
const py = (a: number, r: number) => C + r * Math.sin(rad(a));

interface Confetto {
  id: number;
  left: number;
  color: string;
  dx: number;
  dur: number;
  delay: number;
  big: boolean;
  round: boolean;
}

interface MitrayWheelProps {
  prizes: WheelPrize[];
  isSpinning: boolean;
  targetRotation: number | null;
  onSpinComplete: () => void;
  /** Центральная кнопка */
  hubTitle: string;
  hubSub: string;
  hubDisabled?: boolean;
  onHubClick?: () => void;
  /** Сколько частиц сыпануть (меняй значение, чтобы запустить залп) */
  celebrate?: { id: number; big: boolean } | null;
}

const MitrayWheel = memo(function MitrayWheel({
  prizes,
  isSpinning,
  targetRotation,
  onSpinComplete,
  hubTitle,
  hubSub,
  hubDisabled,
  onHubClick,
  celebrate,
}: MitrayWheelProps) {
  const accumulated = useRef(0);
  const [rotation, setRotation] = useState(0);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [confetti, setConfetti] = useState<Confetto[]>([]);
  const doneRef = useRef(true);

  const sector = prizes.length > 0 ? 360 / prizes.length : 360;

  // Запуск прокрута: как в апстриме — 5 оборотов + доводка до целевого угла
  useEffect(() => {
    if (!isSpinning || targetRotation === null) return;
    const currentPos = accumulated.current % 360;
    let delta = targetRotation - currentPos;
    while (delta < 0) delta += 360;
    const next = accumulated.current + 1800 + delta;
    accumulated.current = next;
    doneRef.current = false;
    setHighlight(null);
    setRotation(next);

    // Страховка на случай, если transitionend не придёт (вкладка в фоне и т.п.)
    const timer = setTimeout(() => finish(next), SPIN_MS + 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpinning, targetRotation]);

  const finish = useCallback(
    (finalRotation: number) => {
      if (doneRef.current) return;
      doneRef.current = true;
      // Подсветка сектора, который встал под стрелку (считается из геометрии,
      // поэтому работает и когда приз неизвестен — например, после оплаты звёздами)
      if (prizes.length > 0) {
        const local = ((-finalRotation % 360) + 360) % 360;
        const idx = Math.floor(local / sector);
        let rot = (idx * sector + sector / 2 + finalRotation) % 360;
        if (rot > 180) rot -= 360;
        if (rot < -180) rot += 360;
        setHighlight(rot);
      }
      onSpinComplete();
    },
    [onSpinComplete, prizes.length, sector],
  );

  // Конфетти
  useEffect(() => {
    if (!celebrate) return;
    const colors = ['var(--w-accent)', 'var(--w-accent2)', 'var(--w-green)', 'var(--w-warn)'];
    const n = celebrate.big ? 64 : 22;
    const batch: Confetto[] = Array.from({ length: n }, (_, k) => ({
      id: celebrate.id * 1000 + k,
      left: Math.random() * 100,
      color: colors[k % colors.length],
      dx: Math.random() * 120 - 60,
      dur: (celebrate.big ? 1.6 : 1.3) + Math.random() * 0.9,
      delay: Math.random() * 0.35,
      big: celebrate.big && Math.random() < 0.3,
      round: Math.random() < 0.4,
    }));
    setConfetti((prev) => [...prev, ...batch]);
  }, [celebrate]);

  const dropConfetto = (id: number) => setConfetti((prev) => prev.filter((c) => c.id !== id));

  if (prizes.length === 0) {
    return <div className="wh-stage" />;
  }

  return (
    <div className={isSpinning ? 'wh-stage spinning' : 'wh-stage'}>
      {/* обод с лампами */}
      <svg className="wh-deco" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle className="wh-ring" cx={C} cy={C} r={RING} />
        {Array.from({ length: 20 }, (_, i) => (
          <circle
            key={i}
            className="wh-lamp"
            cx={px(i * 18, RING).toFixed(1)}
            cy={py(i * 18, RING).toFixed(1)}
            r={3.4}
            style={{ animationDelay: `${(i % 4) * 0.12}s` }}
          />
        ))}
      </svg>

      {/* само колесо */}
      <svg
        className="wh-wheel"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: isSpinning ? `transform ${SPIN_MS}ms cubic-bezier(.14,.72,.12,1)` : 'none',
        }}
        onTransitionEnd={() => finish(accumulated.current)}
      >
        <defs>
          <linearGradient id="mw-jack" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--w-accent)" />
            <stop offset="1" stopColor="var(--w-accent2)" />
          </linearGradient>
        </defs>
        {prizes.map((prize, i) => {
          const a0 = i * sector;
          const a1 = (i + 1) * sector;
          const ac = a0 + sector / 2;
          const isJack = isJackpot(prize);
          const isNothing = prize.prize_type === 'nothing';
          const segments = iconSegments(iconKeyFor(prize));
          return (
            <g key={prize.id}>
              <path
                className="wh-wedge"
                d={`M${C} ${C} L${px(a0, R).toFixed(1)} ${py(a0, R).toFixed(1)} A${R} ${R} 0 0 1 ${px(a1, R).toFixed(1)} ${py(a1, R).toFixed(1)} Z`}
                style={{
                  fill: isJack
                    ? 'url(#mw-jack)'
                    : `color-mix(in srgb, ${prize.color || 'var(--w-accent)'} ${isNothing ? 8 : 24}%, var(--w-bg2))`,
                }}
              />
              <g
                className={isJack ? 'wh-lab is-jack' : isNothing ? 'wh-lab is-none' : 'wh-lab'}
                transform={`rotate(${ac} ${C} ${C})`}
              >
                <g className="wh-ic" transform={`translate(${C - 17} ${C - R + 40}) scale(1.42)`}>
                  {segments.map((seg, k) => (
                    <path key={k} d={seg} />
                  ))}
                </g>
                <text className="wh-label" x={C} y={C - R + 98} textAnchor="middle">
                  {shortLabel(prize)}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      {/* подсветка выигрышного сектора */}
      <svg
        className={highlight !== null ? 'wh-hl show' : 'wh-hl'}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ transform: `rotate(${highlight ?? 0}deg)` }}
        aria-hidden="true"
      >
        <path
          className="wh-hl-wedge"
          d={`M${C} ${C} L${px(-sector / 2, R).toFixed(1)} ${py(-sector / 2, R).toFixed(1)} A${R} ${R} 0 0 1 ${px(sector / 2, R).toFixed(1)} ${py(sector / 2, R).toFixed(1)} Z`}
        />
      </svg>

      {/* стрелка */}
      <svg className="wh-pointer" width="46" height="52" viewBox="0 0 46 52" aria-hidden="true">
        <path
          d="M23 50 L5 14 Q3 8 9 6 L37 6 Q43 8 41 14 Z"
          fill="var(--w-accent)"
          stroke="var(--w-bg2)"
          strokeWidth="3"
        />
        <circle cx="23" cy="16" r="5" fill="var(--w-bg2)" />
      </svg>

      {/* центральная кнопка */}
      <button type="button" className="wh-hub" onClick={onHubClick} disabled={hubDisabled}>
        <b>{hubTitle}</b>
        <small>{hubSub}</small>
      </button>

      {/* конфетти */}
      <div className="wh-confetti" aria-hidden="true">
        {confetti.map((c) => (
          <span
            key={c.id}
            className={c.round ? 'wh-cf round' : 'wh-cf'}
            onAnimationEnd={() => dropConfetto(c.id)}
            style={
              {
                left: `${c.left}%`,
                background: c.color,
                width: c.big ? 12 : undefined,
                height: c.big ? 12 : undefined,
                '--cf-x': `${c.dx}px`,
                '--cf-dur': `${c.dur}s`,
                '--cf-delay': `${c.delay}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
});

export default MitrayWheel;
