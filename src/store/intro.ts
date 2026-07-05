import { create } from 'zustand';

/**
 * Coordinates the cinematic login → dashboard intro (see IntroLoader + intro.css,
 * ported from design-lab/dashboard.html). The overlay plays the signature
 * (draw → fill loop) then flies the logo into the header brand slot; at the
 * moment the flight starts it flips `revealed` so the dashboard cockpit rises in
 * staggered sync with the landing logo (Dashboard reads this).
 */
interface IntroState {
  /** Flipped true by the intro overlay when the logo begins flying to the header. */
  revealed: boolean;
  /**
   * Flipped true by the Dashboard once its primary data has resolved. The
   * signature loops as a genuine loader until this is set (min 1 cycle), so an
   * instant load plays the signature exactly once, and a slow backend keeps it
   * spinning until the dashboard is actually ready.
   */
  dataReady: boolean;
  triggerReveal: () => void;
  setDataReady: () => void;
}

export const useIntroStore = create<IntroState>((set) => ({
  revealed: false,
  dataReady: false,
  triggerReveal: () => set({ revealed: true }),
  setDataReady: () => set({ dataReady: true }),
}));

/** sessionStorage flag — the heavy intro plays only on the FIRST cabinet entry. */
export const INTRO_FLAG = 'mitray-intro';

/**
 * One-shot per-page-load claim for the intro sequence. Module-scoped (survives
 * React StrictMode's dev mount → unmount → mount, which must not replay the
 * intro) but resettable — logout calls resetIntroPlayback() so the NEXT login
 * gets the full cinematic entry again.
 */
let sequenceClaimed = false;
export function claimIntroSequence(): boolean {
  if (sequenceClaimed) return false;
  sequenceClaimed = true;
  return true;
}

/**
 * Called on logout: clears the session flag, the login-handoff rect and the
 * page-load claim, and rewinds the store, so logging straight back in replays
 * the logo flight + signature loader instead of cutting to the dashboard.
 */
export function resetIntroPlayback() {
  sequenceClaimed = false;
  try {
    sessionStorage.removeItem(INTRO_FLAG);
    sessionStorage.removeItem(INTRO_FROM_KEY);
  } catch {
    /* private mode — nothing persisted anyway */
  }
  useIntroStore.setState({ revealed: false, dataReady: false });
}

/**
 * sessionStorage key with the login wordmark's viewport rect (JSON), written by
 * Login right before navigating on successful auth. IntroLoader reads (and
 * clears) it to FLIP-fly the logo from where the user last saw it into the
 * loader position — instead of popping in from nowhere.
 */
export const INTRO_FROM_KEY = 'mitray-intro-from';

/**
 * Pure read (does not consume the flag): whether the intro is pending for THIS
 * dashboard entry. Both the Dashboard (to hold its reveal) and the IntroLoader
 * (to play) call this; because it only reads sessionStorage they agree until the
 * loader sets the flag in its effect, which runs after the dashboard has already
 * rendered — so the two never disagree within a page load.
 */
export function introWillPlay(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.location.pathname === '/' &&
      !sessionStorage.getItem(INTRO_FLAG)
    );
  } catch {
    return false;
  }
}
