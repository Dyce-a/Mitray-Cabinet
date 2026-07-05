import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { subscriptionApi } from '../../api/subscription';
import { formatTraffic } from '../../utils/formatTraffic';
import { getFlagEmoji } from '../../utils/subscriptionHelpers';
import type { Subscription } from '../../types';
import worldMapSvg from '../auth/worldMap.svg?raw';

interface ConnectionHeroProps {
  subscription: Subscription;
  trafficData: {
    traffic_used_gb: number;
    traffic_used_percent: number;
    is_unlimited: boolean;
  } | null;
}

/**
 * Connection cockpit hero — the reused world map (worldMap.svg) as a live
 * backdrop with a status overlay. Data is real where the cabinet provides it:
 * subscription status, traffic usage, the last connected Remnawave node (via
 * the fork-only /subscription/connection-info endpoint, falling back to the
 * granted location list when absent). Live tunnel telemetry (ping/speed) is
 * client-side VPN state the backend cannot see, so it is not fabricated here.
 */
export default function ConnectionHero({ subscription, trafficData }: ConnectionHeroProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);

  // Perf: pause the map's infinite animations (arcs / breathing / rings) while
  // the hero is scrolled out of view — they'd keep repainting for nothing.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => el.classList.toggle('map-idle', !entry.isIntersecting),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The node the user's VPN client last connected to (Remnawave panel data via
  // a fork-only bot endpoint). Errors (e.g. unpatched backend → 404) simply
  // fall back to the subscription's location list below.
  const { data: connInfo } = useQuery({
    queryKey: ['connection-info', subscription.id],
    queryFn: () => subscriptionApi.getConnectionInfo(subscription.id),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const usedPercent = trafficData?.traffic_used_percent ?? subscription.traffic_used_percent;
  const usedGb = trafficData?.traffic_used_gb ?? subscription.traffic_used_gb;
  const isUnlimited = trafficData?.is_unlimited ?? subscription.traffic_limit_gb === 0;

  const servers = subscription.servers ?? [];
  const primary = servers[0];
  const locationsCount = servers.length || subscription.connected_squads?.length || 0;

  const connectedNode = connInfo?.found ? connInfo.last_connected_node_name : null;
  const flag =
    getFlagEmoji(connectedNode ? connInfo?.last_connected_node_country : primary?.country_code) ||
    '🌍';
  const name = connectedNode || primary?.name || t('dashboard.hero.vpnActive', 'VPN активен');
  const sub = connectedNode
    ? t('dashboard.hero.currentServer', 'Твой сервер')
    : locationsCount > 1
      ? t('dashboard.hero.locationsAvailable', {
          count: locationsCount,
          defaultValue: '{{count}} локаций доступно',
        })
      : t('dashboard.hero.subscriptionLocation', 'Локация подписки');

  return (
    <div className="conn" ref={rootRef}>
      <div className="conn-map" dangerouslySetInnerHTML={{ __html: worldMapSvg }} />
      <div className="conn-scrim" />
      <div className="conn-overlay">
        <div className="conn-top">
          <span className="conn-badge">
            <span className="cdot" />
            {t('dashboard.hero.active', 'Активна')}
          </span>
          <span className="conn-secure">
            {t('dashboard.hero.encrypted', 'Шифрование включено')}
          </span>
        </div>

        <div className="conn-bottom">
          <div className="conn-srv">
            <span className="conn-flag" aria-hidden="true">
              {flag}
            </span>
            <div>
              <div className="conn-name">{name}</div>
              <div className="conn-sub">{sub}</div>
            </div>
          </div>

          <div className="conn-metrics">
            <div className="m">
              {isUnlimited ? (
                <b>&#8734;</b>
              ) : (
                <b>
                  {Math.round(usedPercent)}
                  <small>%</small>
                </b>
              )}
              <span>
                {isUnlimited
                  ? t('dashboard.usedTraffic', { amount: formatTraffic(usedGb) })
                  : `${t('dashboard.hero.traffic', 'трафик')} · ${formatTraffic(usedGb)} / ${formatTraffic(subscription.traffic_limit_gb)}`}
              </span>
            </div>
            {locationsCount > 0 && (
              <div className="m">
                <b>{locationsCount}</b>
                <span>{t('dashboard.hero.locations', 'локаций')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
