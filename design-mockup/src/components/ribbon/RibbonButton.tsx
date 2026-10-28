import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface RibbonButtonProps {
  icon: string;
  label: string;
  title?: string;
  size?: "large" | "small" | "medium";
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Sneltoets in de tooltip, bv. "Ctrl+S" (zie lib/sneltoetsen.ts). */
  shortcut?: string;
}

/** Wachttijd voor de tooltip, zodat hij niet opflitst bij het overbewegen. */
const TIP_VERTRAGING_MS = 450;

export default function RibbonButton({
  icon,
  label,
  title,
  size = "large",
  active,
  disabled,
  onClick,
  shortcut,
}: RibbonButtonProps) {
  // Tooltip in de stijl van ontwerp 0.4: naam, sneltoets en de uitleg uit
  // `title`. Via een portal, omdat het lint zijn inhoud afsnijdt.
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const uitleg = title && title !== label ? title : undefined;

  const toon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setTip({ x: r.left, y: r.bottom + 6 });
    }, TIP_VERTRAGING_MS);
  };
  const verberg = () => {
    window.clearTimeout(timer.current);
    setTip(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      ref={ref}
      className={`ribbon-btn${size === "small" ? " small" : ""}${size === "medium" ? " medium" : ""}${active ? " active" : ""}`}
      aria-label={uitleg ? `${label}. ${uitleg}` : label}
      aria-keyshortcuts={shortcut}
      disabled={disabled}
      onClick={() => { verberg(); onClick?.(); }}
      onMouseEnter={toon}
      onMouseLeave={verberg}
      onMouseDown={verberg}
    >
      <div
        className="ribbon-btn-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <span className="ribbon-btn-label">{label}</span>
      {tip && createPortal(
        <div className="ribbon-tip" role="tooltip" style={{ left: Math.min(tip.x, window.innerWidth - 300), top: tip.y }}>
          <div className="ribbon-tip-kop">
            <span>{label}</span>
            {shortcut && <kbd>{shortcut}</kbd>}
          </div>
          {uitleg && <div className="ribbon-tip-uitleg">{uitleg}</div>}
        </div>,
        document.body,
      )}
    </button>
  );
}
