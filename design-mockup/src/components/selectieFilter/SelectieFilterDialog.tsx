import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../Modal";
import LengthInput from "../LengthInput";
import { toonMm } from "../../lib/lengthInput";
import {
  filterCriteriumActief, filterElementen, filterKeuzes, filterTelling, FILTER_TYPEN,
  type FilterCriterium, type FilterElement, type FilterKenmerk, type FilterKeuze, type FilterModus,
} from "./selectieFilter";
import "./SelectieFilterDialog.css";

/** Een kenmerk met een keuzelijst (alles behalve de lengte). */
type LijstKenmerk = Exclude<FilterKenmerk, "length">;
type Waarde = string | number;

interface LijstStaat { mode: FilterModus; values: Waarde[] }
interface Staat {
  lijst: Partial<Record<LijstKenmerk, LijstStaat>>;
  lengte: { mode: FilterModus; fromMm?: number; toMm?: number };
}
const LEEG: Staat = { lijst: {}, lengte: { mode: "keep" } };

interface Props {
  open: boolean;
  onClose: () => void;
  /** De basis: de huidige selectie, of zonder selectie het hele model. */
  elementen: readonly FilterElement[];
  /** Er is niets geselecteerd: het filter werkt op het hele model. */
  heleModel: boolean;
  /** De levels (3D) van laag naar hoog, met hun naam. */
  levels?: readonly { id: string; naam: string }[];
  /** De naam van een belastinggeval; zonder naam "Belastinggeval <id>". */
  belastinggevalNaam?: (id: number) => string | undefined;
  /** De naam van een staaftype (2D). */
  rolNaam?: (rol: string) => string;
  /** Toepassen: de criteria; de aanroeper zet de selectie en sluit. */
  onToepassen: (criteria: FilterCriterium[]) => void;
}

/** De criteria uit de keuzes in het venster; een kenmerk zonder waarden doet niet mee. */
function criteriaVan(staat: Staat): FilterCriterium[] {
  const criteria: FilterCriterium[] = [];
  for (const [property, lijst] of Object.entries(staat.lijst) as [LijstKenmerk, LijstStaat][]) {
    if (lijst.values.length) criteria.push({ property, mode: lijst.mode, values: lijst.values } as FilterCriterium);
  }
  const lengte: FilterCriterium = { property: "length", ...staat.lengte };
  if (filterCriteriumActief(lengte)) criteria.push(lengte);
  return criteria;
}

/**
 * Het venster Selectiefilter (issue #94), in 2D en 3D: per kenmerk waarden
 * aanvinken en kiezen of je alleen die houdt of ze weghaalt. De telling van
 * wat overblijft staat ernaast en loopt mee; Toepassen zet de selectie,
 * Annuleren laat hem staan. De keuzelijsten tonen alleen wat in de basis
 * voorkomt. Het filteren zelf is de zuivere kern (`selectieFilter.ts`); de
 * adapters per dimensie staan in `SelectieFilterVenster.tsx`.
 */
export default function SelectieFilterDialog({
  open, onClose, elementen, heleModel, levels = [], belastinggevalNaam, rolNaam, onToepassen,
}: Props) {
  const { t } = useTranslation("common");
  const [staat, setStaat] = useState<Staat>(LEEG);
  // Elke keer dat het venster opengaat, begint het leeg: al tijdens het
  // tekenen bijgesteld (niet in een effect), anders flitst de vorige keuze.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setStaat(LEEG);
  }

  const keuzes = useMemo(() => filterKeuzes(elementen, levels.map((level) => level.id)), [elementen, levels]);
  const criteria = useMemo(() => criteriaVan(staat), [staat]);
  const basis = useMemo(() => filterTelling(elementen), [elementen]);
  const over = useMemo(() => filterTelling(filterElementen(elementen, criteria)), [elementen, criteria]);

  const zonder = (waarde: string) => (waarde === "" ? t("selectieFilter.zonder") : waarde);
  const levelNaam = (id: string) => levels.find((level) => level.id === id)?.naam ?? id;

  const wissel = (kenmerk: LijstKenmerk, waarde: Waarde) => setStaat((vorige) => {
    const huidig = vorige.lijst[kenmerk] ?? { mode: "keep" as FilterModus, values: [] };
    const values = huidig.values.includes(waarde) ? huidig.values.filter((v) => v !== waarde) : [...huidig.values, waarde];
    return { ...vorige, lijst: { ...vorige.lijst, [kenmerk]: { ...huidig, values } } };
  });
  const zetModus = (kenmerk: LijstKenmerk, mode: FilterModus) => setStaat((vorige) => ({
    ...vorige, lijst: { ...vorige.lijst, [kenmerk]: { values: [], ...vorige.lijst[kenmerk], mode } },
  }));

  const modusKeuze = (kenmerk: FilterKenmerk, mode: FilterModus, onChange: (mode: FilterModus) => void) => (
    <select className="selectiefilter-modus" value={mode} data-selectiefilter-modus={kenmerk}
      aria-label={t("selectieFilter.modusVoor", { kenmerk: t(`selectieFilter.kenmerk.${kenmerk}`) })}
      onChange={(event) => onChange(event.target.value as FilterModus)}>
      <option value="keep">{t("selectieFilter.modus.keep")}</option>
      <option value="remove">{t("selectieFilter.modus.remove")}</option>
    </select>
  );

  const rij = <T extends Waarde>(kenmerk: LijstKenmerk, lijst: FilterKeuze<T>[], label: (waarde: T) => string, hint?: string) => {
    if (lijst.length === 0) return null;
    const huidig = staat.lijst[kenmerk];
    const gekozen = huidig?.values ?? [];
    return (
      <div className={`selectiefilter-rij${gekozen.length ? " actief" : ""}`} data-selectiefilter-kenmerk={kenmerk}
        role="group" aria-label={t(`selectieFilter.kenmerk.${kenmerk}`)}>
        <div className="selectiefilter-kop">
          <span className="selectiefilter-naam">{t(`selectieFilter.kenmerk.${kenmerk}`)}</span>
          {modusKeuze(kenmerk, huidig?.mode ?? "keep", (mode) => zetModus(kenmerk, mode))}
        </div>
        <div className="selectiefilter-waarden">
          {lijst.map(({ value, count }) => {
            const aan = gekozen.includes(value);
            return (
              <label key={String(value)} className={`selectiefilter-keuze${aan ? " aan" : ""}`}>
                <input type="checkbox" checked={aan} data-waarde={String(value)} onChange={() => wissel(kenmerk, value)} />
                <span className="selectiefilter-label">{label(value)}</span>
                <span className="selectiefilter-aantal">{count}</span>
              </label>
            );
          })}
        </div>
        {hint && <p className="selectiefilter-hint">{hint}</p>}
      </div>
    );
  };

  const staven = keuzes.profile.length + keuzes.group.length + keuzes.role.length + keuzes.direction.length > 0
    || keuzes.lengthMm !== null;
  const lasten = keuzes.loadCase.length + keuzes.loadKind.length > 0;
  const lengteActief = filterCriteriumActief({ property: "length", ...staat.lengte });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("selectieFilter.title")}
      width={720}
      className="selectiefilter-dialog"
      footer={
        <>
          <span className="selectiefilter-voet" data-selectiefilter-over={over.total}>
            {over.total === 0 ? t("selectieFilter.niets") : t("selectieFilter.over", { over: over.total, count: basis.total })}
          </span>
          <button type="button" onClick={() => setStaat(LEEG)} disabled={criteria.length === 0}>{t("selectieFilter.wissen")}</button>
          <button type="button" onClick={onClose}>{t("cancel")}</button>
          <button type="button" className="primary" data-selectiefilter-toepassen
            onClick={() => onToepassen(criteria)}>{t("apply")}</button>
        </>
      }
    >
      <div className="selectiefilter-inhoud">
        <div className="selectiefilter-criteria">
          <p className="selectiefilter-basis" data-selectiefilter-basis={heleModel ? "model" : "selectie"}>
            {heleModel ? t("selectieFilter.basisModel", { count: basis.total }) : t("selectieFilter.basisSelectie", { count: basis.total })}
          </p>
          <p className="selectiefilter-uitleg">{t("selectieFilter.uitleg")}</p>

          <h3>{t("selectieFilter.groepAlgemeen")}</h3>
          {rij("type", keuzes.type, (type) => t(`selectieFilter.type.${type}`))}
          {rij("level", keuzes.level, levelNaam, t("selectieFilter.levelHint"))}
          {rij("material", keuzes.material, zonder)}

          {staven && <h3>{t("selectieFilter.groepStaven")}</h3>}
          {rij("profile", keuzes.profile, zonder)}
          {rij("group", keuzes.group, zonder)}
          {rij("role", keuzes.role, (rol) => rolNaam?.(rol) ?? rol)}
          {rij("direction", keuzes.direction, (richting) => t(`selectieFilter.richting.${richting}`), t("selectieFilter.richtingHint"))}
          {keuzes.lengthMm && (
            <div className={`selectiefilter-rij${lengteActief ? " actief" : ""}`} data-selectiefilter-kenmerk="length"
              role="group" aria-label={t("selectieFilter.kenmerk.length")}>
              <div className="selectiefilter-kop">
                <span className="selectiefilter-naam">{t("selectieFilter.kenmerk.length")}</span>
                {modusKeuze("length", staat.lengte.mode, (mode) => setStaat((vorige) => ({ ...vorige, lengte: { ...vorige.lengte, mode } })))}
              </div>
              <div className="selectiefilter-lengte">
                <label>
                  <span>{t("selectieFilter.van")}</span>
                  <LengthInput value={staat.lengte.fromMm} min={0} data-selectiefilter-lengte="van"
                    placeholder={toonMm(keuzes.lengthMm.min)} aria-label={t("selectieFilter.vanMm")}
                    onChange={(fromMm) => setStaat((vorige) => ({ ...vorige, lengte: { ...vorige.lengte, fromMm } }))} />
                </label>
                <label>
                  <span>{t("selectieFilter.tot")}</span>
                  <LengthInput value={staat.lengte.toMm} min={0} data-selectiefilter-lengte="tot"
                    placeholder={toonMm(keuzes.lengthMm.max)} aria-label={t("selectieFilter.totMm")}
                    onChange={(toMm) => setStaat((vorige) => ({ ...vorige, lengte: { ...vorige.lengte, toMm } }))} />
                </label>
                <span className="selectiefilter-eenheid">mm</span>
              </div>
              <p className="selectiefilter-hint">
                {t("selectieFilter.lengteBereik", { min: toonMm(keuzes.lengthMm.min), max: toonMm(keuzes.lengthMm.max) })}
              </p>
            </div>
          )}

          {lasten && <h3>{t("selectieFilter.groepLasten")}</h3>}
          {rij("loadCase", keuzes.loadCase, (id) => belastinggevalNaam?.(id) ?? t("selectieFilter.geval", { id }))}
          {rij("loadKind", keuzes.loadKind, (soort) => t(`selectieFilter.lastSoort.${soort}`))}
        </div>

        <section className="selectiefilter-telling" aria-live="polite" aria-label={t("selectieFilter.resultaat")}>
          <h3>{t("selectieFilter.resultaat")}</h3>
          <ul>
            {FILTER_TYPEN.filter((type) => basis[type] > 0).map((type) => (
              <li key={type} data-selectiefilter-telling={type} data-over={over[type]} data-basis={basis[type]}
                className={over[type] === 0 ? "nul" : undefined}>
                <span>{t(`selectieFilter.type.${type}`)}</span>
                <strong>{over[type]}</strong>
                <span className="selectiefilter-van">{t("selectieFilter.vanBasis", { basis: basis[type] })}</span>
              </li>
            ))}
          </ul>
          {criteria.length > 0 && <p className="selectiefilter-hint">{t("selectieFilter.criteriaActief", { count: criteria.length })}</p>}
        </section>
      </div>
    </Modal>
  );
}
