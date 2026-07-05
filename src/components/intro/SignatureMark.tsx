/**
 * The Mitray / VPN signature wordmark (stroke + fill layers), shared by the
 * cinematic intro overlay and the branded page/bootstrap loader. All animation
 * and colours live in intro.css — this is just the static markup.
 */
export function SignatureMark({ className = 'mi-logo' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 600 320" aria-label="Mitray VPN">
      <g className="mi-l1">
        <text className="mi-stroke" x="300" y="148" textAnchor="middle" fontSize="150">
          Mitray
        </text>
        <text className="mi-fill" x="300" y="148" textAnchor="middle" fontSize="150">
          Mitray
        </text>
      </g>
      <g className="mi-l2">
        <text className="mi-stroke mi-t2" x="304" y="286" textAnchor="middle" fontSize="120">
          VPN
        </text>
        <text className="mi-fill mi-t2" x="304" y="286" textAnchor="middle" fontSize="120">
          VPN
        </text>
      </g>
    </svg>
  );
}

export default SignatureMark;
