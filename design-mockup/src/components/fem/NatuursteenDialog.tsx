/**
 * NatuursteenDialog — een natuurstenen element toetsen (issue #99), eerste
 * versie: latei, dorpel, consoleplaat, vloerplaat, traptrede of gevelplaat.
 *
 * Er is nog geen natuurstenen staaf of plaat als modelobject: het element en
 * zijn belasting worden hier ingevuld. De bouwer (`natuursteenCheckBuilder`)
 * maakt er de invoer van; de kern (`check_natural_stone_elements`) rekent
 * langs dezelfde weg als de andere toetsen (Tauri-command of de toetsbrug via
 * `/api/toetsing`). γ_M en de reductiefactoren hebben geen standaardwaarde en
 * gaan met hun bron naar de kern.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../Modal";
import { roepKern } from "../../stores/checkStore";
import {
  BELASTINGSOORTEN, BUIGPROEVEN, ELEMENTSOORTEN, LIGGERSCHEMAS, REDUCTIEFACTOREN, STERKTEWIJZEN, VERDELINGEN,
  bouwNatuursteenInvoer, leegNatuursteenFormulier,
  type NatuursteenFormulier, type OpgaveVeld, type SterkteVeld, type SterkteWijze,
} from "../../lib/natuursteenCheckBuilder";
import type { NatuursteenElementResult } from "../../lib/types/natuursteen/NatuursteenElementResult";
import "./WaterAccumulation2DDialog.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

type TekstVeld = {
  [K in keyof NatuursteenFormulier]: NatuursteenFormulier[K] extends string ? K : never
}[keyof NatuursteenFormulier];
type VinkVeld = {
  [K in keyof NatuursteenFormulier]: NatuursteenFormulier[K] extends boolean ? K : never
}[keyof NatuursteenFormulier];
type SterkteSleutel = "buig" | "druk" | "anker";

const OPGAVE_SYMBOOL: Record<OpgaveVeld, string> = {
  gammaM: "γ_M", kVocht: "k_vocht", kVorst: "k_vorst", kDuur: "k_duur", fvk: "f_vk [N/mm²]", e: "E [N/mm²]",
  rho: "ρ [kN/m³]", gammaG: "γ_G", grens: "l / …", gammaAnker: "γ_anker",
};

export default function NatuursteenDialog({ open, onClose }: Props) {
  const { t } = useTranslation("check");
  const [f, setF] = useState<NatuursteenFormulier>(leegNatuursteenFormulier);
  const [fouten, setFouten] = useState<{ veld: string; melding: string }[]>([]);
  const [resultaat, setResultaat] = useState<NatuursteenElementResult | null>(null);
  const [kernFout, setKernFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const zet = <K extends keyof NatuursteenFormulier>(k: K, v: NatuursteenFormulier[K]) => {
    setF((o) => ({ ...o, [k]: v }));
    setResultaat(null);
  };
  const zetOpgave = (veld: OpgaveVeld, deel: "waarde" | "bron", v: string) => {
    setF((o) => ({ ...o, opgave: { ...o.opgave, [veld]: { ...o.opgave[veld], [deel]: v } } }));
    setResultaat(null);
  };
  const zetSterkte = <K extends keyof SterkteVeld>(s: SterkteSleutel, k: K, v: SterkteVeld[K]) => {
    setF((o) => ({ ...o, [s]: { ...o[s], [k]: v } }));
    setResultaat(null);
  };
  const foutVan = (veld: string) => fouten.find((x) => x.veld === veld)?.melding;
  const fout = (veld: string) => foutVan(veld) && <em className="water2d-error">{foutVan(veld)}</em>;

  const tekst = (veld: TekstVeld, label: string, eenheid = "") => (
    <label className="water2d-field" key={veld}>
      <span>{label}</span>
      <div>
        <input value={f[veld] as string} inputMode="decimal" onChange={(e) => zet(veld, e.target.value)}
          aria-invalid={foutVan(veld) ? true : undefined} />
        {eenheid && <small>{eenheid}</small>}
      </div>
      {fout(veld)}
    </label>
  );
  const vink = (veld: VinkVeld, label: string) => (
    <label className="water2d-field" key={veld}>
      <div>
        <input type="checkbox" style={{ width: "auto" }} checked={f[veld] as boolean} onChange={(e) => zet(veld, e.target.checked)} />
        <span>{label}</span>
      </div>
    </label>
  );
  const keuze = <K extends keyof NatuursteenFormulier>(veld: K, label: string, opties: readonly string[]) => (
    <label className="water2d-field" key={String(veld)}>
      <span>{label}</span>
      <div>
        <select value={f[veld] as string} onChange={(e) => zet(veld, e.target.value as NatuursteenFormulier[K])}>
          {opties.map((o) => <option key={o} value={o}>{t(`naturalStone.optie.${o}`, o)}</option>)}
        </select>
      </div>
    </label>
  );
  const opgaveVeld = (veld: OpgaveVeld, verplicht = false) => (
    <label className="water2d-field" key={veld}>
      <span>{OPGAVE_SYMBOOL[veld]}{verplicht ? " *" : ""}</span>
      <div>
        <input value={f.opgave[veld].waarde} inputMode="decimal" style={{ maxWidth: 90 }}
          onChange={(e) => zetOpgave(veld, "waarde", e.target.value)} aria-label={OPGAVE_SYMBOOL[veld]} />
        <input value={f.opgave[veld].bron} placeholder={t("naturalStone.source")}
          onChange={(e) => zetOpgave(veld, "bron", e.target.value)} aria-label={`${OPGAVE_SYMBOOL[veld]} ${t("naturalStone.source")}`} />
      </div>
      {fout(veld)}
    </label>
  );
  const sterkteVeld = (s: SterkteSleutel, label: string, eenheid: string, metGeen: boolean) => {
    const v = f[s];
    const wijzen: readonly SterkteWijze[] = metGeen ? ["Geen", ...STERKTEWIJZEN] : STERKTEWIJZEN;
    return (
      <div className="water2d-fields" key={s}>
        <label className="water2d-field">
          <span>{label}</span>
          <div>
            <select value={v.wijze} onChange={(e) => zetSterkte(s, "wijze", e.target.value as SterkteWijze)}>
              {wijzen.map((o) => <option key={o} value={o}>{t(`naturalStone.optie.${o}`, o)}</option>)}
            </select>
          </div>
          {fout(s)}
        </label>
        {v.wijze === "Proefresultaten" && <>
          <label className="water2d-field">
            <span>{t("naturalStone.testValues")}</span>
            <div>
              <input value={v.waarden} placeholder="14,2; 15,8; 13,5" onChange={(e) => zetSterkte(s, "waarden", e.target.value)} />
              <small>{eenheid}</small>
            </div>
          </label>
          <label className="water2d-field">
            <span>{t("naturalStone.distribution")}</span>
            <div>
              <select value={v.verdeling} onChange={(e) => zetSterkte(s, "verdeling", e.target.value as SterkteVeld["verdeling"])}>
                {VERDELINGEN.map((o) => <option key={o} value={o}>{t(`naturalStone.optie.${o}`, o)}</option>)}
              </select>
            </div>
          </label>
        </>}
        {v.wijze === "Karakteristiek" && (
          <label className="water2d-field">
            <span>{t("naturalStone.characteristic")}</span>
            <div>
              <input value={v.karakteristiek} inputMode="decimal" onChange={(e) => zetSterkte(s, "karakteristiek", e.target.value)} />
              <small>{eenheid}</small>
            </div>
          </label>
        )}
        {v.wijze !== "Geen" && (
          <label className="water2d-field">
            <span>{t("naturalStone.source")}</span>
            <div><input value={v.bron} onChange={(e) => zetSterkte(s, "bron", e.target.value)} /></div>
          </label>
        )}
      </div>
    );
  };

  const toetsen = async () => {
    const { invoer, fouten: nieuweFouten } = bouwNatuursteenInvoer(f);
    setFouten(nieuweFouten);
    setKernFout(null);
    setResultaat(null);
    if (!invoer) return;
    setBezig(true);
    try {
      const [r] = await roepKern<NatuursteenElementResult[]>("check_natural_stone_elements", [invoer]);
      setResultaat(r ?? null);
    } catch (e) {
      setKernFout(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  };

  const statusTekst = (s: string) =>
    s === "Ok" ? t("statusOk") : s === "NotOk" ? t("statusNotOk") : t("naturalStone.nietVolledig");

  return (
    <Modal open={open} onClose={onClose} title={t("naturalStone.title")} width={780}
      footer={<>
        <button onClick={onClose}>{t("naturalStone.close")}</button>
        <button className="primary" onClick={toetsen} disabled={bezig}>{bezig ? t("running") : t("naturalStone.run")}</button>
      </>}>
      <div className="water2d-dialog">
        <p>{t("naturalStone.intro")}</p>

        <h4>{t("naturalStone.element")}</h4>
        <div className="water2d-fields">
          {tekst("naam", t("naturalStone.name"))}
          {keuze("soort", t("naturalStone.kind"), ELEMENTSOORTEN)}
          {tekst("b", "b", "mm")}
          {tekst("h", "h", "mm")}
          {vink("zijdelingsGesteund", t("naturalStone.laterallySupported"))}
        </div>

        <h4>{t("naturalStone.material")}</h4>
        <div className="water2d-fields">
          <label className="water2d-field">
            <span>{t("naturalStone.stone")}</span>
            <div><input value={f.steensoort} onChange={(e) => zet("steensoort", e.target.value)} /></div>
            {fout("steensoort")}
          </label>
          {keuze("buigproef", t("naturalStone.flexuralTest"), BUIGPROEVEN)}
        </div>
        {sterkteVeld("buig", t("naturalStone.flexuralStrength"), "N/mm²", false)}
        {sterkteVeld("druk", t("naturalStone.compressiveStrength"), "N/mm²", true)}
        <p className="water2d-note">{t("naturalStone.statsHint")}</p>

        <h4>{t("naturalStone.factors")}</h4>
        <p className="water2d-note">{t("naturalStone.factorsHint")}</p>
        <div className="water2d-fields">
          {opgaveVeld("gammaM", true)}
          {REDUCTIEFACTOREN.map(({ veld }) => opgaveVeld(veld))}
          {opgaveVeld("fvk")}
          {opgaveVeld("e", f.metDoorbuiging)}
          {opgaveVeld("rho", f.metEigenGewicht && f.belasting === "Ligger")}
        </div>

        <h4>{t("naturalStone.loads")}</h4>
        <div className="water2d-fields">
          {keuze("belasting", t("naturalStone.loadType"), BELASTINGSOORTEN)}
          <span />
          {f.belasting === "Ligger" ? <>
            {keuze("schema", t("naturalStone.scheme"), LIGGERSCHEMAS)}
            {tekst("l", "l", "m")}
            {tekst("q", "q_Ed", "kN/m")}
            {tekst("f", "F_Ed", "kN")}
            {vink("metEigenGewicht", t("naturalStone.selfWeight"))}
            {f.metEigenGewicht ? opgaveVeld("gammaG", true) : <span />}
          </> : <>
            {tekst("mEd", "M_Ed", "kNm")}
            {tekst("vEd", "V_Ed", "kN")}
            {tekst("nEd", "N_Ed", "kN")}
            <span />
          </>}
          {vink("metOplegging", t("naturalStone.bearing"))}
          <span />
          {f.metOplegging && <>
            {tekst("fOpl", "F_Ed", "kN")}
            {tekst("aOpl", "a", "mm")}
          </>}
          {vink("metDoorbuiging", t("naturalStone.deflection"))}
          <span />
          {f.metDoorbuiging && <>
            {tekst("qSer", "q_ser", "kN/m")}
            {tekst("fSer", "F_ser", "kN")}
            {opgaveVeld("grens", true)}
            <span />
          </>}
          {vink("metVerankering", t("naturalStone.anchorage"))}
          <span />
        </div>
        {f.metVerankering && <>
          {sterkteVeld("anker", t("naturalStone.breakingLoad"), "kN", false)}
          <div className="water2d-fields">
            {opgaveVeld("gammaAnker", true)}
            {tekst("fAnker", "F_Ed", "kN")}
          </div>
        </>}
        <p className="water2d-note">{t("naturalStone.signHint")}</p>

        {kernFout && <p className="water2d-error">{kernFout}</p>}
        {resultaat && (
          <div className="water2d-result" data-testid="natuursteen-resultaat">
            <strong className={resultaat.status === "Ok" ? "water2d-ok" : "water2d-error"}>
              {statusTekst(resultaat.status)}
            </strong>{" "}
            · UC<sub>max</sub> = {resultaat.uc_max.toFixed(3)}
            {resultaat.sterkte && (
              <p className="water2d-note">
                f_f,k = {resultaat.sterkte.buig.karakteristiek.toFixed(2)} N/mm² · f_f,d = {resultaat.sterkte.f_fd_mpa.toFixed(2)} N/mm²
                {resultaat.sterkte.f_cd_mpa !== null && resultaat.sterkte.f_cd_mpa !== undefined &&
                  <> · f_c,d = {resultaat.sterkte.f_cd_mpa.toFixed(2)} N/mm²</>}
                {resultaat.sterkte.buig.statistiek && <> · n = {resultaat.sterkte.buig.statistiek.n}, k_n = {resultaat.sterkte.buig.statistiek.k_n.toFixed(3)}</>}
              </p>
            )}
            <div className="water2d-metrics">
              {resultaat.checks.map((c) => {
                const d = c.kind.data;
                const uc = d.uc?.uc;
                return (
                  <span key={c.id} title={d.notes.join("\n")}>
                    {d.title}
                    <b className={uc !== undefined && uc > 1 ? "water2d-error" : undefined}>
                      {uc !== undefined ? `UC ${uc.toFixed(3)}` : "–"}
                    </b>
                  </span>
                );
              })}
            </div>
            {resultaat.niet_getoetst.length > 0 && (
              <>
                <strong>{t("naturalStone.notChecked")}</strong>
                <ul>{resultaat.niet_getoetst.map((n) => <li key={n}>{n}</li>)}</ul>
              </>
            )}
            <ul className="water2d-note">{resultaat.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            <p className="water2d-source">{resultaat.norm}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
