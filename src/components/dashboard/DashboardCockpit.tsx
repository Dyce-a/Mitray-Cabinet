import type { Subscription } from '../../types';
import ConnectionHero from './ConnectionHero';
import CockpitSideGrid from './CockpitSideGrid';
import ActionRibbon from './ActionRibbon';

interface DashboardCockpitProps {
  subscription: Subscription;
  trafficData: {
    traffic_used_gb: number;
    traffic_used_percent: number;
    is_unlimited: boolean;
  } | null;
  connectedDevices: number;
  balanceRubles: number;
  referralCount: number;
  earningsRubles: number;
  wheelEnabled: boolean;
  referralEnabled: boolean;
}

/**
 * The "cockpit" happy-path view for an active single subscription — the world-map
 * connection hero + vertical stat cards + action ribbon. Ported from
 * design-lab/dashboard.html. The reveal stagger is triggered by the `.in` class
 * that Dashboard adds to the `.mitray-dash` root after mount.
 */
export default function DashboardCockpit({
  subscription,
  trafficData,
  connectedDevices,
  balanceRubles,
  referralCount,
  earningsRubles,
  wheelEnabled,
  referralEnabled,
}: DashboardCockpitProps) {
  return (
    <section className="cockpit">
      <div className="top-row reveal-up r1">
        <ConnectionHero subscription={subscription} trafficData={trafficData} />
        <CockpitSideGrid
          subscription={subscription}
          connectedDevices={connectedDevices}
          balanceRubles={balanceRubles}
          referralCount={referralCount}
          earningsRubles={earningsRubles}
          referralEnabled={referralEnabled}
        />
      </div>
      <ActionRibbon
        subscription={subscription}
        wheelEnabled={wheelEnabled}
        referralEnabled={referralEnabled}
      />
    </section>
  );
}
