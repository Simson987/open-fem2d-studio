/**
 * StaalhalWizard — "Stalen hal…": een complete stalen hal als 3D-raamwerk in
 * zes stappen (afmetingen, profielen, verbanden, fundering, belastingen,
 * overzicht), met een levend schematisch voorbeeld en de aantallen.
 *
 * De wizard rekent en bouwt niets zelf: hij houdt de invoer bij, geeft die
 * bij elke wijziging aan de generator (`probeerStaalhal`, dezelfde functie als
 * de MCP-tool en de bedieningsopdracht) en toont wat die teruggeeft — het
 * model of de problemen, vertaald op hun code. "Maken" geeft het resultaat
 * aan de app, die de vraag over niet-opgeslagen werk stelt en het model als
 * één undo-stap vervangt.
 *
 * Alle lengtes in mm (`LengthInput`); lasten in kN/m², paalstijfheden in kN/mm.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../../Modal";
import LengthInput from "../../LengthInput";
import ProfielKiezer from "../../fem/ProfielKiezer";
import { toonMm } from "../../../lib/lengthInput";
import { CONCRETE_E_CM } from "../../../lib/sectionResolver";
import { TERREIN_CATEGORIEEN, WINDGEBIEDEN } from "../../../lib/wind/windEurocode";
import { NEDERLANDSE_WINDROUTE } from "../../../lib/wind/windCodeRoute";
import {
  probeerStaalhal,
  staalhalProfielUitKeuze,
  STAALHAL_GEVAL,
  STAALHAL_PROFIEL_GROEPEN,
  STAALHAL_STANDAARD_SPANTAFSTAND_MM,
  STAALHAL_WIZARD_BEGINSTAND,
  type StaalhalDaktype,
  type StaalhalParameters,
  type StaalhalProbleem,
  type StaalhalProfielGroep,
  type StaalhalResultaat,
} from "./staalhal";
import "./StaalhalWizard.css";
import { doorsnedeNaamVertaald } from "../../../lib/verloopKeuze";

const STAPPEN = ["afmetingen", "profielen", "verbanden", "fundering", "belastingen", "overzicht"] as const;
type Stap = (typeof STAPPEN)[number];

/** De toestand van het formulier; `naarInvoer` maakt er de generatorinvoer van. */
interface Toestand {
  lengteMm: number;
  breedteMm: number;
  aantalOverspanningen: number;
  goothoogteMm: number;
  vakMaat: "spantafstand" | "aantal";
  spantafstandMm: number;
  aantalVakken: number;
  daktype: StaalhalDaktype;
  nokMaat: "nokhoogte" | "helling";
  nokhoogteMm: number;
  hellingGraden: number;
  gordingafstandMm: number;
  profielen: StaalhalParameters["profielen"];
  kolomvoet: StaalhalParameters["kolomvoet"];
  verbandKeuze: "kopvakken" | "alle" | "geen" | "eigen";
  eigenVakken: string;
  verbandDak: boolean;
  verbandWanden: boolean;
  verbandKopgevels: boolean;
  verbandTrekAlleen: boolean;
  fundering: StaalhalParameters["fundering"];
  lasten: StaalhalParameters["lasten"];
  eigenGewicht: boolean;
}

function standaardToestand(): Toestand {
  // Issue #199: de wizard begint met trek-alleen verbanden (zie
  // `STAALHAL_WIZARD_BEGINSTAND`); de rest is het voorbeeldmodel.
  const s = STAALHAL_WIZARD_BEGINSTAND;
  return {
    lengteMm: s.lengteMm,
    breedteMm: s.breedteMm,
    aantalOverspanningen: s.aantalOverspanningen,
    goothoogteMm: s.goothoogteMm,
    vakMaat: "spantafstand",
    spantafstandMm: STAALHAL_STANDAARD_SPANTAFSTAND_MM,
    aantalVakken: s.aantalVakken,
    daktype: s.dak.type,
    nokMaat: "nokhoogte",
    nokhoogteMm: s.dak.nokhoogteMm,
    hellingGraden: 5,
    gordingafstandMm: s.gordingafstandMm,
    profielen: Object.fromEntries(STAALHAL_PROFIEL_GROEPEN.map((g) => [g, { ...s.profielen[g] }])) as Toestand["profielen"],
    kolomvoet: s.kolomvoet,
    verbandKeuze: "kopvakken",
    eigenVakken: "1",
    verbandDak: s.verbanden.dak,
    verbandWanden: s.verbanden.wanden,
    verbandKopgevels: s.verbanden.kopgevels,
    verbandTrekAlleen: s.verbanden.trekAlleen,
    fundering: { ...s.fundering },
    lasten: { ...s.lasten, wind: { ...s.lasten.wind } },
    eigenGewicht: s.eigenGewicht,
  };
}

/** Vaknummers uit "1, 3 5"; een onleesbaar deel wordt NaN en dan door de generator geweigerd. */
function leesVakken(tekst: string): number[] {
  return tekst.split(/[\s,;]+/).filter(Boolean).map((deel) => (/^\d+$/.test(deel) ? Number(deel) : Number.NaN));
}

export function naarInvoer(t: Toestand): Record<string, unknown> {
  return {
    lengteMm: t.lengteMm,
    breedteMm: t.breedteMm,
    aantalOverspanningen: t.aantalOverspanningen,
    goothoogteMm: t.goothoogteMm,
    ...(t.vakMaat === "aantal" ? { aantalVakken: t.aantalVakken } : { spantafstandMm: t.spantafstandMm }),
    dak: t.daktype === "platdak"
      ? { type: "platdak" }
      : t.nokMaat === "helling"
        ? { type: t.daktype, hellingGraden: t.hellingGraden }
        : { type: t.daktype, nokhoogteMm: t.nokhoogteMm },
    gordingafstandMm: t.gordingafstandMm,
    profielen: t.profielen,
    kolomvoet: t.kolomvoet,
    verbanden: {
      vakken: t.verbandKeuze === "eigen" ? leesVakken(t.eigenVakken) : t.verbandKeuze,
      dak: t.verbandDak,
      wanden: t.verbandWanden,
      kopgevels: t.verbandKopgevels,
      trekAlleen: t.verbandTrekAlleen,
    },
    fundering: t.fundering,
    lasten: t.lasten,
    eigenGewicht: t.eigenGewicht,
  };
}

const getal = (waarde: number, decimalen = 1) =>
  (Math.round(waarde * 10 ** decimalen) / 10 ** decimalen).toLocaleString("nl-NL", { maximumFractionDigits: decimalen });

// ── Kleine bouwstenen ───────────────────────────────────────────────────────

function Veld({ label, eenheid, children, hint }: { label: string; eenheid?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="shw-veld" title={hint}>
      <span className="shw-veld-label">{label}</span>
      <span className="shw-veld-invoer">{children}{eenheid && <span className="shw-eenheid">{eenheid}</span>}</span>
    </label>
  );
}

/** Een verplichte, positieve lengte in mm; ongeldige invoer zet de oude waarde terug. */
function Mm({ waarde, onChange }: { waarde: number; onChange: (mm: number) => void }) {
  return <LengthInput value={waarde} storedUnit="mm" positive required
    onChange={(v) => { if (v !== undefined) onChange(v); }} />;
}

function Getal({ waarde, onChange, min = 0 }: { waarde: number; onChange: (v: number) => void; min?: number }) {
  const [tekst, setTekst] = useState(String(waarde));
  const [vorige, setVorige] = useState(waarde);
  if (vorige !== waarde) { setVorige(waarde); setTekst(String(waarde)); }
  const bevestig = () => {
    const v = Number(tekst.trim().replace(",", "."));
    if (tekst.trim() !== "" && Number.isFinite(v) && v >= min) onChange(v);
    else setTekst(String(waarde));
  };
  return <input type="text" inputMode="decimal" value={tekst}
    onChange={(e) => setTekst(e.target.value)} onBlur={bevestig}
    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}

function Keuze<T extends string>({ waarde, opties, onChange }: {
  waarde: T; opties: readonly { waarde: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <select value={waarde} onChange={(e) => onChange(e.target.value as T)}>
      {opties.map((o) => <option key={o.waarde} value={o.waarde}>{o.label}</option>)}
    </select>
  );
}

// ── Het schematische voorbeeld ──────────────────────────────────────────────

function Voorbeeld({ resultaat }: { resultaat: StaalhalResultaat }) {
  const { t } = useTranslation("ribbon");
  const p = resultaat.parameters;
  const m = resultaat.samenvatting.maten;
  const rooster = p.fundering.type === "balkrooster";
  const diepte = rooster ? p.fundering.diepteMm : 0;
  // Spant (y–z)
  const W = 260, H = 150, rand = 14;
  const hoogte = Math.max(m.nokhoogteMm, m.goothoogteMm) + diepte;
  const schaalS = Math.min((W - 2 * rand) / p.breedteMm, (H - 2 * rand) / hoogte);
  const sx = (y: number) => rand + y * schaalS;
  const sz = (z: number) => H - rand - (z + diepte) * schaalS;
  const nok = p.dak.type === "zadeldak"
    ? [[0, m.goothoogteMm], [p.breedteMm / 2, m.nokhoogteMm], [p.breedteMm, m.goothoogteMm]]
    : [[0, m.goothoogteMm], [p.breedteMm, m.nokhoogteMm]];
  const hoogteBij = (y: number) => p.dak.type === "zadeldak"
    ? m.goothoogteMm + (m.nokhoogteMm - m.goothoogteMm) * Math.min(y, p.breedteMm - y) / (p.breedteMm / 2)
    : m.goothoogteMm + (m.nokhoogteMm - m.goothoogteMm) * y / p.breedteMm;
  const gordingen = Array.from({ length: m.aantalGordingvelden + 1 }, (_, j) => j * m.gordingafstandMm);
  const kolomlijnen = Array.from({ length: p.aantalOverspanningen + 1 }, (_, j) => j * m.overspanningMm);
  // Plattegrond (x–y)
  const schaalP = Math.min((W - 2 * rand) / p.lengteMm, (H - 2 * rand) / p.breedteMm);
  const px = (x: number) => rand + x * schaalP;
  const py = (y: number) => rand + y * schaalP;
  const spanten = Array.from({ length: m.aantalSpanten }, (_, i) => i * m.spantafstandMm);
  const paalknopen = new Set(resultaat.samenvatting.paalknopen);
  const palen = resultaat.model.nodes.filter((n) => paalknopen.has(n.id));
  return (
    <div className="shw-voorbeeld">
      <div className="shw-voorbeeld-kop">{t("staalhal.voorbeeld.doorsnede")}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="shw-svg" role="img" aria-label={t("staalhal.voorbeeld.doorsnede")}>
        <line className="shw-peil" x1={2} x2={W - 2} y1={sz(0)} y2={sz(0)} />
        {rooster && <line className="shw-beton" x1={sx(0)} x2={sx(p.breedteMm)} y1={sz(-diepte)} y2={sz(-diepte)} />}
        {rooster && diepte > 0 && kolomlijnen.map((y) =>
          <line key={`poer-${y}`} className="shw-beton" x1={sx(y)} x2={sx(y)} y1={sz(-diepte)} y2={sz(0)} />)}
        {rooster && palen.filter((n) => n.x === 0).map((n) =>
          <path key={`paal-${n.id}`} className="shw-paal" d={`M${sx(n.y * 1000)} ${sz(-diepte)} l-3 7 h6 z`} />)}
        {kolomlijnen.map((y) => <line key={`kolom-${y}`} className="shw-staal" x1={sx(y)} x2={sx(y)} y1={sz(0)} y2={sz(hoogteBij(y))} />)}
        {p.verbanden.kopgevels && kolomlijnen.slice(0, -1).map((y, index) => {
          const volgende = kolomlijnen[index + 1];
          return <g key={`kopverband-${y}`} className="shw-verband">
            <line x1={sx(y)} y1={sz(0)} x2={sx(volgende)} y2={sz(hoogteBij(volgende))} />
            <line x1={sx(volgende)} y1={sz(0)} x2={sx(y)} y2={sz(hoogteBij(y))} />
          </g>;
        })}
        <polyline className="shw-staal" points={nok.map(([y, z]) => `${sx(y)},${sz(z)}`).join(" ")} />
        {gordingen.map((y) => <circle key={y} className="shw-gording" cx={sx(y)} cy={sz(hoogteBij(y)) - 2} r={1.6} />)}
        {!rooster && kolomlijnen.map((y) => p.kolomvoet === "ingeklemd"
          ? <rect key={`opl-${y}`} className="shw-oplegging" x={sx(y) - 5} y={sz(0)} width={10} height={4} />
          : <path key={`opl-${y}`} className="shw-oplegging" d={`M${sx(y)} ${sz(0)} l-4 6 h8 z`} />)}
        <text className="shw-maat" x={sx(p.breedteMm / 2)} y={H - 2} textAnchor="middle">{toonMm(p.breedteMm)}</text>
      </svg>
      <div className="shw-voorbeeld-kop">{t("staalhal.voorbeeld.plattegrond")}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="shw-svg" role="img" aria-label={t("staalhal.voorbeeld.plattegrond")}>
        {rooster && <rect className="shw-rooster" x={px(0)} y={py(0)} width={p.lengteMm * schaalP} height={p.breedteMm * schaalP} />}
        {spanten.map((x) => <line key={x} className="shw-staal" x1={px(x)} x2={px(x)} y1={py(0)} y2={py(p.breedteMm)} />)}
        {kolomlijnen.map((y, index) => <line key={`kolomlijn-${y}`}
          className={index === 0 || index === p.aantalOverspanningen ? "shw-rand" : "shw-staal"}
          x1={px(0)} x2={px(p.lengteMm)} y1={py(y)} y2={py(y)} />)}
        {p.verbanden.dak && m.verbandvakken.map((vak) => {
          const a = (vak - 1) * m.spantafstandMm, b = vak * m.spantafstandMm;
          return <g key={vak} className="shw-verband">
            <line x1={px(a)} y1={py(0)} x2={px(b)} y2={py(p.breedteMm)} />
            <line x1={px(b)} y1={py(0)} x2={px(a)} y2={py(p.breedteMm)} />
          </g>;
        })}
        {rooster && palen.map((n) => <circle key={n.id} className="shw-paal" cx={px(n.x * 1000)} cy={py(n.y * 1000)} r={1.8} />)}
        <text className="shw-maat" x={px(p.lengteMm / 2)} y={H - 2} textAnchor="middle">{toonMm(p.lengteMm)}</text>
      </svg>
    </div>
  );
}

// ── De wizard ───────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  windCodeId: string;
  /** Het gemaakte model; de app vraagt naar niet-opgeslagen werk en past het toe. */
  onMaken: (hal: StaalhalResultaat) => void | Promise<void>;
}

export default function StaalhalWizard({ open, onClose, onMaken, windCodeId }: Props) {
  const { t } = useTranslation("ribbon");
  const [toestand, setToestand] = useState<Toestand>(standaardToestand);
  const [stap, setStap] = useState<Stap>("afmetingen");
  const [kiezer, setKiezer] = useState<StaalhalProfielGroep | null>(null);
  const [bezig, setBezig] = useState(false);
  const zet = (patch: Partial<Toestand>) => setToestand((vorige) => ({ ...vorige, ...patch }));
  const zetFundering = (patch: Partial<Toestand["fundering"]>) =>
    setToestand((v) => ({ ...v, fundering: { ...v.fundering, ...patch } }));
  const zetWind = (patch: Partial<Toestand["lasten"]["wind"]>) =>
    setToestand((v) => ({ ...v, lasten: { ...v.lasten, wind: { ...v.lasten.wind, ...patch } } }));
  const uitkomst = useMemo(() => probeerStaalhal(naarInvoer(toestand)), [toestand]);
  const index = STAPPEN.indexOf(stap);

  const groepLabel = (groep: string) => t(`staalhal.profielen.${groep}`, groep);
  const probleemTekst = (p: StaalhalProbleem) => t(`staalhal.fout.${p.code}`, {
    defaultValue: p.melding,
    ...(p.waarden ?? {}),
    ...(p.waarden?.groep ? { groep: groepLabel(String(p.waarden.groep)) } : {}),
  });

  const maken = async () => {
    if (!uitkomst.ok || bezig || windCodeId !== NEDERLANDSE_WINDROUTE) return;
    setBezig(true);
    try {
      await onMaken(uitkomst.resultaat);
    } finally {
      setBezig(false);
    }
  };

  const r = uitkomst.ok ? uitkomst.resultaat : null;
  const aantallen = r?.samenvatting.aantallen;
  const nokLabel = toestand.daktype === "lessenaarsdak" ? t("staalhal.afmetingen.hogeZijde") : t("staalhal.afmetingen.nokhoogte");

  const inhoud: Record<Stap, ReactNode> = {
    afmetingen: (
      <>
        <Veld label={t("staalhal.afmetingen.lengte")} eenheid="mm"><Mm waarde={toestand.lengteMm} onChange={(v) => zet({ lengteMm: v })} /></Veld>
        <Veld label={t("staalhal.afmetingen.breedte")} eenheid="mm"><Mm waarde={toestand.breedteMm} onChange={(v) => zet({ breedteMm: v })} /></Veld>
        <Veld label={t("staalhal.afmetingen.aantalOverspanningen")}><Getal waarde={toestand.aantalOverspanningen} min={1} onChange={(v) => zet({ aantalOverspanningen: v })} /></Veld>
        <Veld label={t("staalhal.afmetingen.vakindeling")}>
          <Keuze waarde={toestand.vakMaat} onChange={(v) => zet({ vakMaat: v })} opties={[
            { waarde: "spantafstand", label: t("staalhal.afmetingen.perSpantafstand") },
            { waarde: "aantal", label: t("staalhal.afmetingen.perAantal") },
          ]} />
        </Veld>
        {toestand.vakMaat === "spantafstand"
          ? <Veld label={t("staalhal.afmetingen.spantafstand")} eenheid="mm"><Mm waarde={toestand.spantafstandMm} onChange={(v) => zet({ spantafstandMm: v })} /></Veld>
          : <Veld label={t("staalhal.afmetingen.aantalVakken")}><Getal waarde={toestand.aantalVakken} min={1} onChange={(v) => zet({ aantalVakken: v })} /></Veld>}
        <Veld label={t("staalhal.afmetingen.goothoogte")} eenheid="mm"><Mm waarde={toestand.goothoogteMm} onChange={(v) => zet({ goothoogteMm: v })} /></Veld>
        <Veld label={t("staalhal.afmetingen.daktype")}>
          <Keuze waarde={toestand.daktype} onChange={(v) => zet({ daktype: v })} opties={[
            { waarde: "zadeldak", label: t("staalhal.afmetingen.zadeldak") },
            { waarde: "lessenaarsdak", label: t("staalhal.afmetingen.lessenaarsdak") },
            { waarde: "platdak", label: t("staalhal.afmetingen.platdak") },
          ]} />
        </Veld>
        {toestand.daktype !== "platdak" && <>
          <Veld label={t("staalhal.afmetingen.nokMaat")}>
            <Keuze waarde={toestand.nokMaat} onChange={(v) => zet({ nokMaat: v })} opties={[
              { waarde: "nokhoogte", label: nokLabel },
              { waarde: "helling", label: t("staalhal.afmetingen.helling") },
            ]} />
          </Veld>
          {toestand.nokMaat === "nokhoogte"
            ? <Veld label={nokLabel} eenheid="mm"><Mm waarde={toestand.nokhoogteMm} onChange={(v) => zet({ nokhoogteMm: v })} /></Veld>
            : <Veld label={t("staalhal.afmetingen.helling")} eenheid="°"><Getal waarde={toestand.hellingGraden} onChange={(v) => zet({ hellingGraden: v })} /></Veld>}
        </>}
        <Veld label={t("staalhal.afmetingen.gordingafstand")} eenheid="mm"><Mm waarde={toestand.gordingafstandMm} onChange={(v) => zet({ gordingafstandMm: v })} /></Veld>
        <p className="shw-hint">{t("staalhal.afmetingen.hint")}</p>
      </>
    ),
    profielen: (
      <>
        {STAALHAL_PROFIEL_GROEPEN.map((groep) => (
          <Veld key={groep} label={groepLabel(groep)}>
            <button type="button" className="shw-profielknop" data-staalhal-profiel={groep} onClick={() => setKiezer(groep)}>
              {/* Verlopend profiel (#73): "IPE 600 → IPE 400 (verlopend)", zoals overal. */}
              <code>{doorsnedeNaamVertaald({
                material: toestand.profielen[groep].materiaal, profile: toestand.profielen[groep].profiel,
                profileEnd: toestand.profielen[groep].profielEind,
              }, t)}</code> — {toestand.profielen[groep].materiaal}
            </button>
          </Veld>
        ))}
        <Veld label={t("staalhal.profielen.kolomvoet")}>
          <Keuze waarde={toestand.kolomvoet} onChange={(v) => zet({ kolomvoet: v })} opties={[
            { waarde: "ingeklemd", label: t("staalhal.profielen.ingeklemd") },
            { waarde: "scharnierend", label: t("staalhal.profielen.scharnierend") },
          ]} />
        </Veld>
        <p className="shw-hint">{t("staalhal.profielen.hint")}</p>
      </>
    ),
    verbanden: (
      <>
        <Veld label={t("staalhal.verbanden.vakken")}>
          <Keuze waarde={toestand.verbandKeuze} onChange={(v) => zet({ verbandKeuze: v })} opties={[
            { waarde: "kopvakken", label: t("staalhal.verbanden.kopvakken") },
            { waarde: "alle", label: t("staalhal.verbanden.alle") },
            { waarde: "geen", label: t("staalhal.verbanden.geen") },
            { waarde: "eigen", label: t("staalhal.verbanden.eigen") },
          ]} />
        </Veld>
        {toestand.verbandKeuze === "eigen" &&
          <Veld label={t("staalhal.verbanden.eigenLijst")}>
            <input type="text" value={toestand.eigenVakken} onChange={(e) => zet({ eigenVakken: e.target.value })} />
          </Veld>}
        <label className="shw-vink"><input type="checkbox" checked={toestand.verbandDak} onChange={(e) => zet({ verbandDak: e.target.checked })} />{t("staalhal.verbanden.dak")}</label>
        <label className="shw-vink"><input type="checkbox" checked={toestand.verbandWanden} onChange={(e) => zet({ verbandWanden: e.target.checked })} />{t("staalhal.verbanden.wanden")}</label>
        <label className="shw-vink"><input type="checkbox" checked={toestand.verbandKopgevels} onChange={(e) => zet({ verbandKopgevels: e.target.checked })} />{t("staalhal.verbanden.kopgevels")}</label>
        <label className="shw-vink"><input type="checkbox" checked={toestand.verbandTrekAlleen} onChange={(e) => zet({ verbandTrekAlleen: e.target.checked })} />{t("staalhal.verbanden.trekAlleen")}</label>
        <p className="shw-hint">{t("staalhal.verbanden.hint")}</p>
      </>
    ),
    fundering: (
      <>
        <Veld label={t("staalhal.fundering.type")}>
          <Keuze waarde={toestand.fundering.type} onChange={(v) => zetFundering({ type: v })} opties={[
            { waarde: "opleggingen", label: t("staalhal.fundering.opleggingen") },
            { waarde: "balkrooster", label: t("staalhal.fundering.balkrooster") },
          ]} />
        </Veld>
        {toestand.fundering.type === "balkrooster" && <>
          <Veld label={t("staalhal.fundering.balkBreedte")} eenheid="mm"><Mm waarde={toestand.fundering.balkBreedteMm} onChange={(v) => zetFundering({ balkBreedteMm: v })} /></Veld>
          <Veld label={t("staalhal.fundering.balkHoogte")} eenheid="mm"><Mm waarde={toestand.fundering.balkHoogteMm} onChange={(v) => zetFundering({ balkHoogteMm: v })} /></Veld>
          <Veld label={t("staalhal.fundering.betonklasse")}>
            <Keuze waarde={toestand.fundering.betonklasse} onChange={(v) => zetFundering({ betonklasse: v })}
              opties={Object.keys(CONCRETE_E_CM).map((k) => ({ waarde: k, label: k }))} />
          </Veld>
          <Veld label={t("staalhal.fundering.dwarsbalken")}>
            <Keuze waarde={toestand.fundering.dwarsbalken} onChange={(v) => zetFundering({ dwarsbalken: v })} opties={[
              { waarde: "elkSpant", label: t("staalhal.fundering.elkSpant") },
              { waarde: "kopspanten", label: t("staalhal.fundering.kopspanten") },
            ]} />
          </Veld>
          <Veld label={t("staalhal.fundering.diepte")} eenheid="mm">
            <LengthInput value={toestand.fundering.diepteMm} storedUnit="mm" min={0} required
              onChange={(v) => { if (v !== undefined) zetFundering({ diepteMm: v }); }} />
          </Veld>
          <Veld label={t("staalhal.fundering.paalKz")} eenheid="kN/mm"><Getal waarde={toestand.fundering.paalKzKnPerMm} onChange={(v) => zetFundering({ paalKzKnPerMm: v })} /></Veld>
          <Veld label={t("staalhal.fundering.paalHorizontaal")}>
            <Keuze waarde={toestand.fundering.paalHorizontaal} onChange={(v) => zetFundering({ paalHorizontaal: v })} opties={[
              { waarde: "veren", label: t("staalhal.fundering.veren") },
              { waarde: "statischBepaald", label: t("staalhal.fundering.statischBepaald") },
            ]} />
          </Veld>
          {toestand.fundering.paalHorizontaal === "veren" &&
            <Veld label={t("staalhal.fundering.paalKh")} eenheid="kN/mm"><Getal waarde={toestand.fundering.paalKhKnPerMm} onChange={(v) => zetFundering({ paalKhKnPerMm: v })} /></Veld>}
          <Veld label={t("staalhal.fundering.paalAfstand")} eenheid="mm"><Mm waarde={toestand.fundering.paalAfstandMm} onChange={(v) => zetFundering({ paalAfstandMm: v })} /></Veld>
          <p className="shw-hint">{t("staalhal.fundering.hint")}</p>
        </>}
      </>
    ),
    belastingen: (
      <>
        <Veld label={t("staalhal.belastingen.dakafwerking")} eenheid="kN/m²">
          <Getal waarde={toestand.lasten.dakafwerkingKnM2} onChange={(v) => zet({ lasten: { ...toestand.lasten, dakafwerkingKnM2: v } })} />
        </Veld>
        <Veld label={t("staalhal.belastingen.sneeuw")} eenheid="kN/m²">
          <Getal waarde={toestand.lasten.sneeuwKnM2} onChange={(v) => zet({ lasten: { ...toestand.lasten, sneeuwKnM2: v } })} />
        </Veld>
        <Veld label={t("staalhal.belastingen.dakgebruik")} eenheid="kN/m²">
          <Getal waarde={toestand.lasten.dakgebruikKnM2} onChange={(v) => zet({ lasten: { ...toestand.lasten, dakgebruikKnM2: v } })} />
        </Veld>
        <Veld label={t("staalhal.belastingen.windBron")}>
          <Keuze waarde={toestand.lasten.wind.bron} onChange={(v) => zetWind({ bron: v })} opties={[
            { waarde: "handmatig", label: t("staalhal.belastingen.handmatig") },
            { waarde: "stuwdruk", label: t("staalhal.belastingen.stuwdruk") },
          ]} />
        </Veld>
        {toestand.lasten.wind.bron === "handmatig" ? <>
          <Veld label={t("staalhal.belastingen.windDruk")} eenheid="kN/m²"><Getal waarde={toestand.lasten.wind.drukKnM2} onChange={(v) => zetWind({ drukKnM2: v })} /></Veld>
          <Veld label={t("staalhal.belastingen.windZuiging")} eenheid="kN/m²"><Getal waarde={toestand.lasten.wind.zuigingKnM2} onChange={(v) => zetWind({ zuigingKnM2: v })} /></Veld>
          <Veld label={t("staalhal.belastingen.windDak")} eenheid="kN/m²"><Getal waarde={toestand.lasten.wind.dakZuigingKnM2} onChange={(v) => zetWind({ dakZuigingKnM2: v })} /></Veld>
        </> : <>
          <Veld label={t("staalhal.belastingen.windgebied")}>
            <Keuze waarde={toestand.lasten.wind.windgebied} onChange={(v) => zetWind({ windgebied: v })}
              opties={(Object.keys(WINDGEBIEDEN) as (keyof typeof WINDGEBIEDEN)[]).map((k) => ({ waarde: k, label: k }))} />
          </Veld>
          <Veld label={t("staalhal.belastingen.terrein")}>
            <Keuze waarde={toestand.lasten.wind.terreincategorie} onChange={(v) => zetWind({ terreincategorie: v })}
              opties={(Object.keys(TERREIN_CATEGORIEEN) as (keyof typeof TERREIN_CATEGORIEEN)[]).map((k) => ({ waarde: k, label: k }))} />
          </Veld>
          <Veld label={t("staalhal.belastingen.cDak")}><Getal waarde={toestand.lasten.wind.cDak} onChange={(v) => zetWind({ cDak: v })} /></Veld>
          {r?.samenvatting.lasten.stuwdruk && <p className="shw-hint">{t("staalhal.belastingen.afgeleid", {
            qp: getal(r.samenvatting.lasten.stuwdruk.qpKnM2, 3), ze: getal(r.samenvatting.lasten.stuwdruk.zeM, 2),
            druk: getal(r.samenvatting.lasten.windDwarsDrukKnM2, 3), zuiging: getal(r.samenvatting.lasten.windDwarsZuigingKnM2, 3),
            langs: getal(r.samenvatting.lasten.windLangsDrukKnM2, 3), dak: getal(r.samenvatting.lasten.dakZuigingKnM2, 3),
          })}</p>}
        </>}
        <label className="shw-vink"><input type="checkbox" checked={toestand.eigenGewicht} onChange={(e) => zet({ eigenGewicht: e.target.checked })} />{t("staalhal.belastingen.eigenGewicht")}</label>
        <p className="shw-hint">{t("staalhal.belastingen.hint")}</p>
      </>
    ),
    overzicht: r ? (
      <>
        <div className="shw-kop">{t("staalhal.overzicht.maten")}</div>
        <ul className="shw-lijst">
          <li>{t("staalhal.overzicht.spanten", { aantal: r.samenvatting.maten.aantalSpanten, afstand: toonMm(r.samenvatting.maten.spantafstandMm) })}</li>
          {r.samenvatting.maten.aantalOverspanningen > 1 && <li>{t("staalhal.overzicht.overspanningen", {
            aantal: r.samenvatting.maten.aantalOverspanningen, breedte: toonMm(r.samenvatting.maten.overspanningMm),
          })}</li>}
          <li>{t("staalhal.overzicht.gordingen", { aantal: r.samenvatting.maten.aantalGordingvelden, afstand: toonMm(r.samenvatting.maten.gordingafstandMm) })}</li>
          <li>{t("staalhal.overzicht.hoogtes", { goot: toonMm(r.samenvatting.maten.goothoogteMm), nok: toonMm(r.samenvatting.maten.nokhoogteMm), helling: getal(r.samenvatting.maten.hellingGraden, 2) })}</li>
        </ul>
        <div className="shw-kop">{t("staalhal.overzicht.belastingsom")}</div>
        <table className="shw-tabel">
          <tbody>
            {r.loadCases.filter((c) => c.id !== STAALHAL_GEVAL.eigenGewicht).map((c) => {
              const s = r.samenvatting.belastingsom[c.id];
              return <tr key={c.id}><td>{c.name}</td><td>{s ? `${getal(s.fx)} / ${getal(s.fy)} / ${getal(s.fz)} kN` : "—"}</td></tr>;
            })}
            {r.selfWeightEnabled && <tr><td>{r.loadCases.find((c) => c.id === STAALHAL_GEVAL.eigenGewicht)?.name}</td>
              <td>{`${getal(-(r.samenvatting.eigenGewichtKn.staal + r.samenvatting.eigenGewichtKn.hout + r.samenvatting.eigenGewichtKn.beton))} kN (z)`}</td></tr>}
          </tbody>
        </table>
        {r.waarschuwingen.length > 0 && <>
          <div className="shw-kop">{t("staalhal.overzicht.waarschuwingen")}</div>
          <ul className="shw-lijst shw-waarschuwing">{r.waarschuwingen.map((w) => <li key={w}>{w}</li>)}</ul>
        </>}
        <p className="shw-hint">{t("staalhal.overzicht.vervangt")}</p>
      </>
    ) : null,
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title={t("staalhal.titel")} width={860} className="shw-modal"
        footer={
          <div className="shw-voet">
            <button type="button" className="shw-knop" onClick={onClose}>{t("staalhal.annuleren")}</button>
            <span className="shw-ruimte" />
            <button type="button" className="shw-knop" disabled={index === 0} onClick={() => setStap(STAPPEN[index - 1])}>{t("staalhal.vorige")}</button>
            {index < STAPPEN.length - 1 &&
              <button type="button" className="shw-knop" onClick={() => setStap(STAPPEN[index + 1])}>{t("staalhal.volgende")}</button>}
            <button type="button" className="shw-knop primair" disabled={!uitkomst.ok || bezig || windCodeId !== NEDERLANDSE_WINDROUTE}
              onClick={() => { void maken(); }}>{t("staalhal.maken")}</button>
          </div>
        }>
        <div className="shw-inhoud">
          {windCodeId !== NEDERLANDSE_WINDROUTE && <div className="shw-problemen" role="alert">
            {t("openFem3d.envelopeLoads.windCodeUnavailable", { code: windCodeId })}
          </div>}
          <nav className="shw-stappen">
            {STAPPEN.map((s, i) => (
              <button key={s} type="button" className={`shw-stap${s === stap ? " actief" : ""}`} onClick={() => setStap(s)}>
                <span className="shw-stapnummer">{i + 1}</span>{t(`staalhal.stappen.${s}`)}
              </button>
            ))}
          </nav>
          <div className="shw-kolommen">
            <div className="shw-formulier">{inhoud[stap]}</div>
            <aside className="shw-zijkant">
              {r ? <Voorbeeld resultaat={r} /> : null}
              {aantallen && <dl className="shw-aantallen">
                <dt>{t("staalhal.overzicht.knopen")}</dt><dd>{aantallen.knopen}</dd>
                <dt>{t("staalhal.overzicht.staven")}</dt><dd>{aantallen.staven}</dd>
                <dt>{t("staalhal.overzicht.opleggingen")}</dt><dd>{aantallen.opleggingen}</dd>
                {aantallen.palen > 0 && <><dt>{t("staalhal.overzicht.palen")}</dt><dd>{aantallen.palen}</dd></>}
                <dt>{t("staalhal.overzicht.lasten")}</dt><dd>{aantallen.knoopbelastingen + aantallen.staafbelastingen}</dd>
              </dl>}
              {!uitkomst.ok && <div className="shw-problemen" role="alert">
                <div className="shw-kop">{t("staalhal.fout.titel")}</div>
                <ul className="shw-lijst">{uitkomst.problemen.map((p, i) => <li key={`${p.veld}-${i}`}>{probleemTekst(p)}</li>)}</ul>
              </div>}
            </aside>
          </div>
        </div>
      </Modal>
      {kiezer && <ProfielKiezer
        open
        onClose={() => setKiezer(null)}
        huidig={{
          material: toestand.profielen[kiezer].materiaal, profile: toestand.profielen[kiezer].profiel,
          ...(toestand.profielen[kiezer].profielEind ? { profileEnd: toestand.profielen[kiezer].profielEind } : {}),
        }}
        onApply={(keuze) => {
          // Het eindprofiel (verlopend, #73) gaat mee; een prismatische keuze
          // haalt een eerder eindprofiel weg. De generator keurt het verloop.
          setToestand((v) => ({ ...v, profielen: { ...v.profielen, [kiezer]: staalhalProfielUitKeuze(keuze) } }));
          setKiezer(null);
        }}
      />}
    </>
  );
}
