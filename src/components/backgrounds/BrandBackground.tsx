import { createPortal } from 'react-dom';
import '@/styles/brand-bg.css';

/**
 * Brand background: dark canvas + two soft blurred corner blobs (iris + cyan),
 * ported from the design-lab prototypes. Replaces the configurable animated
 * background (BackgroundRenderer / aurora / beams) on the redesign shell so the
 * app matches the prototypes on every screen. Rendered via portal to <body>.
 */
export function BrandBackground() {
  return createPortal(
    <div className="brand-bg" aria-hidden="true">
      <div className="blob b1" />
      <div className="blob b2" />
    </div>,
    document.body,
  );
}
