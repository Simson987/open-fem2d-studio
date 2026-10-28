import { ReactNode, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

/**
 * Hoeveel groepen, van rechts geteld, ingeklapt worden omdat het lint niet in
 * het venster past. Ribbon.tsx meet dat en geeft het door; de eerste groep
 * klapt nooit in.
 */
export const RibbonInklapContext = createContext(0);

interface RibbonGroupProps {
  label: string;
  children: ReactNode;
}

export default function RibbonGroup({ label, children }: RibbonGroupProps) {
  const { t } = useTranslation();
  const inklappen = useContext(RibbonInklapContext);
  const ref = useRef<HTMLDivElement>(null);
  const knopRef = useRef<HTMLButtonElement>(null);
  const verborgenRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [plek, setPlek] = useState<{ index: number; vanRechts: number } | null>(null);
  const [icoon, setIcoon] = useState("");
  const [heeftActief, setHeeftActief] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // De plek van deze groep in de rij; wordt na elke render bijgewerkt.
  useLayoutEffect(() => {
    const el = ref.current;
    const ouder = el?.parentElement;
    if (!el || !ouder) return;
    const groepen = Array.from(ouder.children).filter((c) => c.classList.contains("ribbon-group"));
    const index = groepen.indexOf(el);
    const vanRechts = groepen.length - 1 - index;
    setPlek((p) => (p && p.index === index && p.vanRechts === vanRechts ? p : { index, vanRechts }));
  });

  const ingeklapt = !!plek && plek.index > 0 && plek.vanRechts < inklappen;

  // Het icoon van de ingeklapte groep is dat van haar eerste knop; ze licht
  // op als een van haar knoppen actief is (bv. de gekozen tool).
  useLayoutEffect(() => {
    if (!ingeklapt) return;
    const verborgen = verborgenRef.current;
    const html = verborgen?.querySelector(".ribbon-btn-icon")?.innerHTML;
    if (html) setIcoon(html);
    if (verborgen && verborgen.childElementCount > 0) setHeeftActief(!!verborgen.querySelector(".ribbon-btn.active"));
  });

  useEffect(() => {
    if (!ingeklapt) setMenu(null);
  }, [ingeklapt]);

  useEffect(() => {
    if (!menu) return;
    const sluitBuiten = (e: MouseEvent) => {
      const doel = e.target as Node;
      if (menuRef.current?.contains(doel) || knopRef.current?.contains(doel)) return;
      setMenu(null);
    };
    const sluitEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const sluit = () => setMenu(null);
    document.addEventListener("mousedown", sluitBuiten);
    window.addEventListener("keydown", sluitEsc);
    window.addEventListener("resize", sluit);
    return () => {
      document.removeEventListener("mousedown", sluitBuiten);
      window.removeEventListener("keydown", sluitEsc);
      window.removeEventListener("resize", sluit);
    };
  }, [menu]);

  if (!ingeklapt) {
    return (
      <div className="ribbon-group" ref={ref}>
        <div className="ribbon-group-content">{children}</div>
        <div className="ribbon-group-label">{label}</div>
      </div>
    );
  }

  const open = () => {
    if (menu) { setMenu(null); return; }
    const r = knopRef.current?.getBoundingClientRect();
    if (r) setMenu({ x: Math.min(r.left, window.innerWidth - 240), y: r.bottom + 2 });
  };

  return (
    <div className="ribbon-group ribbon-group-ingeklapt" ref={ref}>
      <div className="ribbon-group-content">
        <button
          ref={knopRef}
          className={`ribbon-btn${menu || heeftActief ? " active" : ""}`}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          aria-label={t("common:ribbonCollapsed.open", { groep: label })}
          onClick={open}
        >
          <div className="ribbon-btn-icon" dangerouslySetInnerHTML={{ __html: icoon }} />
          <span className="ribbon-btn-label">{label}</span>
          <span className="ribbon-group-pijl" aria-hidden="true">▾</span>
        </button>
        {/* De knoppen blijven gemonteerd (voor het icoon) en verhuizen bij
            openen naar het menu. */}
        <div ref={verborgenRef} hidden>{!menu && children}</div>
      </div>
      <div className="ribbon-group-label">{label}</div>
      {menu && createPortal(
        <div
          ref={menuRef}
          className="ribbon-group-menu"
          role="menu"
          aria-label={label}
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => { if ((e.target as HTMLElement).closest(".ribbon-btn")) setMenu(null); }}
        >
          <div className="ribbon-group-menu-kop">{label}</div>
          <div className="ribbon-group-content">{children}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
