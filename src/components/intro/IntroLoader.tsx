import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useIntroStore, claimIntroSequence, INTRO_FLAG, INTRO_FROM_KEY } from '@/store/intro';
import { SignatureMark } from './SignatureMark';
import '@/styles/intro.css';

/**
 * Cinematic login → dashboard intro. On the FIRST cabinet entry of a session the
 * signature logo pops into the centre, plays a draw → fill loop as a loader, then
 * FLIP-flies into the header brand slot while the dashboard cockpit rises in.
 * Ported from the loader in design-lab/dashboard.html.
 *
 * Lives in AppShell so it can measure the real header brand (.mitray-shell
 * .brand-logo) and its overlay sits above the fixed header. Plays once per page
 * load (module guard, survives React StrictMode's double-invoke) and once per
 * session (sessionStorage flag, survives reloads).
 */

// Timing (ms). The signature is a genuine loader: it loops until the dashboard
// signals `dataReady` (min 1 cycle so an instant load still plays once cleanly),
// capped so a dead backend can't loop forever.
const CYCLE_MS = 2600; // one draw→fill→fade signature cycle
const MIN_CYCLES = 1; // always play at least one full signature
const MAX_CYCLES = 3; // hard cap if data never arrives
const SETTLE_MS = 260; // freeze solid before flight
const FLY_MS = 1050; // flight into the header
const LAND_MS = 400; // crossfade flying logo → header brand
const ARRIVE_MS = 1000; // login-wordmark glide into the loader position
const DISSOLVE_MS = 420; // solid wordmark fades before the draw loop takes over

// The one-shot page-load claim lives in store/intro.ts (claimIntroSequence):
// module-scoped there so StrictMode's mount → unmount → mount can't replay it,
// yet logout can reset it for a fresh cinematic entry on re-login.

export function IntroLoader() {
  const location = useLocation();
  const rootRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Layout effect (not useEffect): the overlay must be visible in the SAME
  // frame the route swaps, otherwise the login→intro logo handoff drops the
  // logo for one frame between Login unmounting and the overlay painting.
  useLayoutEffect(() => {
    if (location.pathname !== '/') return;
    try {
      if (sessionStorage.getItem(INTRO_FLAG)) return; // already played this session
    } catch {
      return;
    }
    if (!claimIntroSequence()) return; // already claimed this page load (StrictMode)
    try {
      sessionStorage.setItem(INTRO_FLAG, '1');
    } catch {
      /* private mode — still play, just don't persist */
    }

    const root = rootRef.current;
    if (!root) return;

    const html = document.documentElement;
    const push = (fn: () => void, ms: number) => {
      timers.current.push(setTimeout(fn, ms));
    };
    const reveal = () => useIntroStore.getState().triggerReveal();

    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      // No motion: skip straight to the loaded dashboard.
      reveal();
      return;
    }

    const logo = root.querySelector<SVGSVGElement>('.mi-logo');
    html.classList.add('mi-intro'); // hide header brand until the flight lands
    root.hidden = false;

    // Handoff rect from the login screen (one-shot). When present, the wordmark
    // glides from where the user last saw it into the loader position instead
    // of popping in from nowhere (see Login.leaveWithIntro).
    let fromRect: { left: number; top: number; width: number; height: number } | null = null;
    try {
      const raw = sessionStorage.getItem(INTRO_FROM_KEY);
      if (raw) {
        sessionStorage.removeItem(INTRO_FROM_KEY);
        fromRect = JSON.parse(raw);
      }
    } catch {
      /* ignore */
    }

    const teardown = () => {
      root.hidden = true;
      html.classList.remove('mi-intro', 'mi-logo-landed');
    };

    const finish = () => {
      html.classList.add('mi-logo-landed'); // header brand crossfades in
      root.classList.add('done'); // flying logo fades out
      push(teardown, LAND_MS);
    };

    const fly = () => {
      // Land in whichever header brand is actually visible: the desktop shell
      // (lg+) or the mobile sticky header. Both are hidden by html.mi-intro
      // until the flight lands (intro.css).
      const dst = ['.mitray-shell .brand-logo', '.m-header .brand-logo']
        .map((sel) => document.querySelector<SVGSVGElement>(sel)?.getBoundingClientRect())
        .find((r) => r && r.width > 0);

      root.classList.remove('settle');
      root.classList.add('fly'); // fades the canvas fill
      reveal(); // dashboard cockpit rises in sync with the flight

      if (logo && dst && dst.width > 0) {
        const src = logo.getBoundingClientRect();
        const dx = dst.left + dst.width / 2 - (src.left + src.width / 2);
        const dy = dst.top + dst.height / 2 - (src.top + src.height / 2);
        const s = dst.width / src.width;
        // Trigger the transition without rAF (paused in hidden tabs): set
        // identity, force reflow, then the target transform.
        logo.style.transform = 'translate(0px, 0px) scale(1)';
        void logo.getBoundingClientRect(); // force reflow (SVG has no offsetWidth)
        logo.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
        push(finish, FLY_MS);
      } else {
        // No visible header brand at all (edge case) — just fade out in place.
        root.classList.add('done');
        push(teardown, 800);
      }
    };

    const settle = () => {
      root.classList.remove('loading', 'intro-in');
      root.classList.add('settle');
      push(fly, SETTLE_MS);
    };

    // Loop the signature in whole cycles until the dashboard reports it's ready
    // (min 1 cycle, hard cap), then settle → fly. This makes it a real loader.
    let cycles = 0;
    const tick = () => {
      cycles += 1;
      const ready = useIntroStore.getState().dataReady;
      if ((ready && cycles >= MIN_CYCLES) || cycles >= MAX_CYCLES) {
        settle();
      } else {
        push(tick, CYCLE_MS);
      }
    };
    const startLoop = () => {
      root.classList.add('loading');
      push(tick, CYCLE_MS);
    };

    if (fromRect && logo) {
      // Login handoff: arrive solid (fills on, strokes off), glide to centre,
      // dissolve, then enter the draw loop — the loop begins with an empty
      // stroke, so picking it up right after the dissolve is seamless.
      root.classList.add('mi-solid');
      const dst = logo.getBoundingClientRect();
      if (dst.width > 0) {
        const dx = fromRect.left + fromRect.width / 2 - (dst.left + dst.width / 2);
        const dy = fromRect.top + fromRect.height / 2 - (dst.top + dst.height / 2);
        const s = fromRect.width / dst.width;
        // Same no-rAF transition trick as fly(): place instantly, reflow, glide.
        logo.style.transition = 'none';
        logo.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
        void logo.getBoundingClientRect(); // force reflow (SVG has no offsetWidth)
        logo.style.transition = '';
        logo.style.transform = 'translate(0px, 0px) scale(1)';
      }
      push(() => {
        root.classList.remove('mi-solid');
        root.classList.add('mi-dissolve');
      }, ARRIVE_MS);
      push(() => {
        root.classList.remove('mi-dissolve');
        startLoop();
      }, ARRIVE_MS + DISSOLVE_MS);
    } else {
      // Cold entry (no login screen behind us): grow-into-centre (intro-in) and
      // the contour draw (loading) run together, so the logo flies in AS it
      // draws itself, then keeps looping as a loader.
      root.classList.add('intro-in');
      void root.offsetWidth; // reflow so the entrance animation runs
      startLoop();
    }

    // No cleanup on purpose: the sequence is a one-shot that only toggles
    // classes / opacity and self-tears-down. Cancelling timers here would let
    // React StrictMode's dev mount → cleanup → mount kill the intro before it
    // plays. On a real unmount the leftover timers just finish against a
    // detached node (harmless) and teardown still clears the <html> classes.
  }, [location.pathname]);

  return (
    <div ref={rootRef} className="mi-root" hidden aria-hidden="true">
      <div className="mi-bg" />
      <div className="mi-stage">
        <SignatureMark />
      </div>
    </div>
  );
}

export default IntroLoader;
