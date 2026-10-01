/**
 * De twee vensters van "Rekenmodel importeren":
 *  - de keuze van het analysemodel, als het bestand er meer dan één heeft;
 *  - het verslag na de import: aantallen, trek-alleen, schijven en de
 *    meldingen van de import (toelichting, waarschuwingen, niet ingelezen).
 *
 * Alleen weergave: de import zelf is `io/ifcAnalyseImport.ts`. De regels van
 * het verslag zijn Nederlandse zinnen uit de import (zoals de meldingen van de
 * belastingvlakken en de stalen hal); de vaste teksten eromheen lopen via i18n.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../Modal";
import type { IfcAnalyseModelInfo, IfcImportVerslag } from "../../io/ifcAnalyseImport";
import "./IfcImportDialogen.css";

interface ModelKeuzeProps {
  open: boolean;
  bestandsnaam: string;
  modellen: readonly IfcAnalyseModelInfo[];
  onKies: (nummer: number) => void;
  onSluit: () => void;
}

export function IfcModelKeuze({ open, bestandsnaam, modellen, onKies, onSluit }: ModelKeuzeProps) {
  const { t } = useTranslation("common");
  const [gekozen, setGekozenState] = useState(1);
  // De knop Importeren leest de keuze uit een ref: een klik vlak na het kiezen
  // mag niet nog het vorige model importeren (de render met de nieuwe keuze
  // kan dan nog niet gecommit zijn).
  const gekozenRef = useRef(1);
  const setGekozen = (nummer: number) => {
    gekozenRef.current = nummer;
    setGekozenState(nummer);
  };
  // Bij het openen terug naar het eerste model, synchroon met het tekenen van
  // het venster. Als passief effect kon dat later lopen dan een snelle klik op
  // een ander model, en dan zette het die keuze terug.
  useLayoutEffect(() => {
    if (!open) return;
    gekozenRef.current = 1;
    setGekozenState(1);
  }, [open]);
  return (
    <Modal open={open} onClose={onSluit} title={t("ifcImport.titelKiezen")} width={560} className="ifci-modal"
      footer={
        <div className="ifci-voet">
          <button type="button" className="ifci-knop" onClick={onSluit}>{t("ifcImport.annuleren")}</button>
          <span className="ifci-ruimte" />
          <button type="button" className="ifci-knop primair" data-testid="ifc-importeren" onClick={() => onKies(gekozenRef.current)}>
            {t("ifcImport.importeren")}
          </button>
        </div>
      }>
      <div className="ifci-inhoud">
        <p className="ifci-intro">{t("ifcImport.intro", { bestand: bestandsnaam, aantal: modellen.length })}</p>
        <div className="ifci-modellen" role="radiogroup" aria-label={t("ifcImport.titelKiezen")}>
          {modellen.map((m) => (
            <label key={m.nummer} className={`ifci-model${gekozen === m.nummer ? " gekozen" : ""}`}
              onDoubleClick={() => onKies(m.nummer)}>
              <input type="radio" name="ifc-analysemodel" value={m.nummer} checked={gekozen === m.nummer}
                onChange={() => setGekozen(m.nummer)}
                onKeyDown={(e) => { if (e.key === "Enter") onKies(m.nummer); }} />
              <span className="ifci-model-tekst">
                <span className="ifci-model-naam">{m.naam}</span>
                {m.beschrijving && <span className="ifci-model-beschrijving">{m.beschrijving}</span>}
                <span className="ifci-model-aantallen">{t("ifcImport.aantallen", {
                  knopen: m.aantallen.knopen, staven: m.aantallen.staven, vlakken: m.aantallen.vlakken,
                  gevallen: m.aantallen.belastinggevallen, combinaties: m.aantallen.combinaties,
                })}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

interface VerslagProps {
  open: boolean;
  bestandsnaam: string;
  projectnaam: string;
  verslag: IfcImportVerslag | null;
  onSluit: () => void;
}

const TELLINGEN = [
  "knopen", "staven", "opleggingen", "stavenMetScharnieren", "belastingvlakken", "staaflasten",
  "staafpuntlasten", "knooplasten", "belastinggevallen", "combinaties", "levels", "schijven", "imperfectieGevallen",
] as const;

/** Het verslag als platte tekst, om te kopiëren (bijvoorbeeld naar een notitie of rapport). */
export function ifcVerslagAlsTekst(
  verslag: IfcImportVerslag, kop: string, labels: { toelichting: string; waarschuwingen: string; nietOndersteund: string },
): string {
  const blok = (titel: string, regels: readonly string[]) => regels.length ? [`${titel}:`, ...regels.map((r) => `- ${r}`), ""] : [];
  return [
    kop, "",
    ...blok(labels.toelichting, verslag.toelichting),
    ...blok(labels.waarschuwingen, verslag.waarschuwingen),
    ...blok(labels.nietOndersteund, verslag.nietOndersteund),
  ].join("\n").trim();
}

export function IfcImportVerslagVenster({ open, bestandsnaam, projectnaam, verslag, onSluit }: VerslagProps) {
  const { t } = useTranslation("common");
  const [gekopieerd, setGekopieerd] = useState(false);
  useEffect(() => { if (open) setGekopieerd(false); }, [open]);
  if (!verslag) return null;
  const kop = t("ifcImport.verslagKop", { model: verslag.model, bestand: bestandsnaam, project: projectnaam });
  const kopieer = async () => {
    try {
      await navigator.clipboard.writeText(ifcVerslagAlsTekst(verslag, kop, {
        toelichting: t("ifcImport.toelichting"), waarschuwingen: t("ifcImport.waarschuwingen"),
        nietOndersteund: t("ifcImport.nietOndersteund"),
      }));
      setGekopieerd(true);
    } catch {
      setGekopieerd(false);
    }
  };
  const lijst = (regels: readonly string[], soort: string) => regels.length === 0
    ? <p className="ifci-geen">{t("ifcImport.geen")}</p>
    : <ul className={`ifci-lijst ${soort}`}>{regels.map((r) => <li key={r}>{r}</li>)}</ul>;
  return (
    <Modal open={open} onClose={onSluit} title={t("ifcImport.titelVerslag")} width={720} className="ifci-modal"
      footer={
        <div className="ifci-voet">
          <button type="button" className="ifci-knop" onClick={() => { void kopieer(); }}>
            {gekopieerd ? t("ifcImport.gekopieerd") : t("ifcImport.kopieren")}
          </button>
          <span className="ifci-ruimte" />
          <button type="button" className="ifci-knop primair" data-testid="ifc-verslag-sluiten" onClick={onSluit}>
            {t("ifcImport.sluiten")}
          </button>
        </div>
      }>
      <div className="ifci-inhoud ifci-verslag" data-testid="ifc-verslag">
        <p className="ifci-intro">{kop}</p>
        <dl className="ifci-aantallen">
          {TELLINGEN.filter((k) => k !== "imperfectieGevallen" || verslag.aantallen.imperfectieGevallen > 0).map((k) => (
            <div key={k} className="ifci-telling">
              <dt>{t(`ifcImport.telling.${k}`)}</dt>
              <dd>{verslag.aantallen[k]}</dd>
            </div>
          ))}
          <div className="ifci-telling">
            <dt>{t("ifcImport.telling.trekAlleen")}</dt>
            <dd>{verslag.trekAlleen}</dd>
          </div>
        </dl>
        {verslag.schijven.length > 0 && <>
          <div className="ifci-kop">{t("ifcImport.schijven")}</div>
          <ul className="ifci-lijst">
            {verslag.schijven.map((s) => (
              <li key={s.id}>{t("ifcImport.schijf", { naam: s.naam, knopen: s.knopen, vlakken: s.vlakken.join(", ") })}</li>
            ))}
          </ul>
        </>}
        <div className="ifci-kop">{t("ifcImport.nietOndersteund")}</div>
        {lijst(verslag.nietOndersteund, "fout")}
        <div className="ifci-kop">{t("ifcImport.waarschuwingen")}</div>
        {lijst(verslag.waarschuwingen, "waarschuwing")}
        <div className="ifci-kop">{t("ifcImport.toelichting")}</div>
        {lijst(verslag.toelichting, "")}
      </div>
    </Modal>
  );
}
