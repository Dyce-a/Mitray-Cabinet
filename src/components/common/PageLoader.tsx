import { SignatureMark } from '@/components/intro/SignatureMark';
import '@/styles/intro.css';

interface PageLoaderProps {
  // Kept for call-site compatibility; the branded loader adapts to the active
  // theme via tokens, so the variant no longer needs to pick a colour.
  variant?: 'dark' | 'light';
}

/**
 * Branded loading screen — a living Mitray signature (faint wordmark with the
 * contour sweeping over it). Replaces the old generic spinner so the auth
 * bootstrap on reload, and lazy-route fallbacks, stay on-brand. See intro.css
 * (.mi-loader).
 */
export default function PageLoader(_props: PageLoaderProps) {
  return (
    <div className="mi-loader min-h-viewport">
      <SignatureMark />
    </div>
  );
}
