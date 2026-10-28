/**
 * MetselwerkDialog — een metselwerkwand toetsen volgens NEN-EN 1996-1-1
 * (issue #98), eerste versie.
 *
 * Er is nog geen metselwerkwand als modelobject (#97): de wand en zijn
 * krachten worden hier ingetypt. De bouwer (`metselwerkCheckBuilder`) maakt
 * er de invoer van; de kern (`check_masonry_walls`) rekent langs dezelfde weg
 * als de andere toetsen (Tauri-command of de toetsbrug via `/api/toetsing`).
 * Nationaal te kiezen parameters hebben geen standaardwaarde en gaan met hun
 * bron naar de kern.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../Modal";
import { roepKern } from "../../stores/checkStore";
import {
  BREUKVLAKKEN, MORTELSOORTEN, NDP_VELDEN, STEENGROEPEN, STEENSOORTEN, STEUNRANDSOORTEN,
  bouwMetselwerkInvoer, leegMetselwerkFormulier, type MetselwerkFormulier, type NdpVeld,
} from "../../lib/metselwerkCheckBuilder";
import type { MetselwerkWandResult } from "../../lib/types/metselwerk/MetselwerkWandResult";
import { metselwerkUit3d } from "../../lib/metselwerkUit3d";
import type { OpenFem3DModel } from "../openFem3d/openFem3dModel";
import type { OpenFem3DSolveResult } from "../openFem3d/openFem3dSolver";
import "./WaterAccumulation2DDialog.css";

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Het 3D-model met het getoonde resultaat (#97): een metselwerkwand daaruit
   * vult geometrie, N/M per meter en de lateioplegging in (`metselwerkUit3d`).
   */
  uit3d?: { model: OpenFem3DModel; result: OpenFem3DSolveResult };
}

type TekstVeld = {
  [K in keyof MetselwerkFormulier]: MetselwerkFormulier[K] extends string ? K : never
}[keyof MetselwerkFormulier];
type VinkVeld = {
  [K in keyof MetselwerkFormulier]: MetselwerkFormulier[K] extends boolean ? K : never
}[keyof MetselwerkFormulier];

const NDP_SYMBOOL: Record<NdpVeld, string> = {
  k: "K", gammaM: "γ_M", kE: "K_E", phiInf: "φ_∞", fvk0: "f_vk0 [N/mm²]", fxk1: "f_xk1 [N/mm²]", fxk2: "f_xk2 [N/mm²]",
};

export default function MetselwerkDialog({ open, onClose, uit3d }: Props) {
  const { t } = useTranslation("check");
  const [f, setF] = useState<MetselwerkFormulier>(leegMetselwerkFormulier);
  const [fouten, setFouten] = useState<{ veld: string; melding: string }[]>([]);
  const [resultaat, setResultaat] = useState<MetselwerkWandResult | null>(null);
  const [kernFout, setKernFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const wanden3d = (uit3d?.model.plates ?? []).filter((plate) => plate.masonry);
  const [wand3d, setWand3d] = useState<number | null>(null);
  const [meldingen3d, setMeldingen3d] = useState<string[]>([]);
  const neemOver3d = () => {
    const plateId = wand3d ?? wanden3d[0]?.id;
    if (!uit3d || plateId === undefined) return;
    try {
      const uit = metselwerkUit3d(uit3d.model, plateId, uit3d.result);
      setF((o) => ({ ...o, ...uit.formulier }));
      setMeldingen3d(uit.meldingen);
      setResultaat(null);
    } catch (fout) {
      setMeldingen3d([fout instanceof Error ? fout.message : String(fout)]);
    }
  };

  const zet = <K extends keyof MetselwerkFormulier>(k: K, v: MetselwerkFormulier[K]) => {
    setF((o) => ({ ...o, [k]: v }));
    setResultaat(null);
  };
  const zetNdp = (veld: NdpVeld, deel: "waarde" | "bron", v: string) => {
    setF((o) => ({ ...o, ndp: { ...o.ndp, [veld]: { ...o.ndp[veld], [deel]: v } } }));
    setResultaat(null);
  };
  const foutVan = (veld: string) => fouten.find((x) => x.veld === veld)?.melding;

  const tekst = (veld: TekstVeld, label: string, eenheid = "") => (
    <label className="water2d-field" key={veld}>
      <span>{label}</span>
      <div>
        <input value={f[veld] as string} inputMode="decimal" onChange={(e) => zet(veld, e.target.value)}
          aria-invalid={foutVan(veld) ? true : undefined} />
        {eenheid && <small>{eenheid}</small>}
      </div>
      {foutVan(veld) && <em className="water2d-error">{foutVan(veld)}</em>}
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
  const keuze = <K extends keyof MetselwerkFormulier>(veld: K, label: string, opties: readonly string[]) => (
    <label className="water2d-field" key={String(veld)}>
      <span>{label}</span>
      <div>
        <select value={f[veld] as string} onChange={(e) => zet(veld, e.target.value as MetselwerkFormulier[K])}>
          {opties.map((o) => <option key={o} value={o}>{t(`masonry.optie.${o}`, o)}</option>)}
        </select>
      </div>
    </label>
  );

  const toetsen = async () => {
    const { invoer, fouten: nieuweFouten } = bouwMetselwerkInvoer(f);
    setFouten(nieuweFouten);
    setKernFout(null);
    setResultaat(null);
    if (!invoer) return;
    setBezig(true);
    try {
      const [r] = await roepKern<MetselwerkWandResult[]>("check_masonry_walls", [invoer]);
      setResultaat(r ?? null);
    } catch (e) {
      setKernFout(e instanceof Error ? e.message : String(e));
    } finally {
      setBezig(false);
    }
  };

  const statusTekst = (s: string) =>
    s === "Ok" ? t("statusOk") : s === "NotOk" ? t("statusNotOk") : t("masonry.nietVolledig");

  return (
    <Modal open={open} onClose={onClose} title={t("masonry.title")} width={760}
      footer={<>
        <button onClick={onClose}>{t("masonry.close")}</button>
        <button className="primary" onClick={toetsen} disabled={bezig}>{bezig ? t("running") : t("masonry.run")}</button>
      </>}>
      <div className="water2d-dialog">
        <p>{t("masonry.intro")}</p>
        {wanden3d.length > 0 && <div className="water2d-fields" data-testid="metselwerk-uit-3d">
          <label className="water2d-field">
            <span>{t("masonry.from3d.wall")}</span>
            <div>
              <select value={wand3d ?? wanden3d[0]!.id} onChange={(e) => setWand3d(Number(e.target.value))}>
                {wanden3d.map((plate) => <option key={plate.id} value={plate.id}>{t("masonry.from3d.wallOption", { id: plate.id })}</option>)}
              </select>
              <button type="button" onClick={neemOver3d}>{t("masonry.from3d.take")}</button>
            </div>
          </label>
          {meldingen3d.map((melding, index) => <p key={index} className="water2d-hint"><small>{melding}</small></p>)}
        </div>}

        <h4>{t("masonry.material")}</h4>
        <div className="water2d-fields">
          {tekst("naam", t("masonry.name"))}
          {keuze("steensoort", t("masonry.unit"), STEENSOORTEN)}
          {keuze("steengroep", t("masonry.group"), STEENGROEPEN)}
          {keuze("mortel", t("masonry.mortar"), MORTELSOORTEN)}
          {tekst("fb", "f_b", "N/mm²")}
          {tekst("fm", "f_m", "N/mm²")}
          {vink("langsvoeg", t("masonry.longitudinalJoint"))}
          {vink("stootvoegenGevuld", t("masonry.perpendsFilled"))}
        </div>

        <h4>{t("masonry.ndp")}</h4>
        <p className="water2d-note">{t("masonry.ndpHint")}</p>
        <div className="water2d-fields">
          {NDP_VELDEN.map((veld) => (
            <label className="water2d-field" key={veld}>
              <span>{NDP_SYMBOOL[veld]}{veld === "k" || veld === "gammaM" ? " *" : ""}</span>
              <div>
                <input value={f.ndp[veld].waarde} inputMode="decimal" style={{ maxWidth: 90 }}
                  onChange={(e) => zetNdp(veld, "waarde", e.target.value)} aria-label={`${NDP_SYMBOOL[veld]}`} />
                <input value={f.ndp[veld].bron} placeholder={t("masonry.source")}
                  onChange={(e) => zetNdp(veld, "bron", e.target.value)} aria-label={`${NDP_SYMBOOL[veld]} ${t("masonry.source")}`} />
              </div>
              {foutVan(veld) && <em className="water2d-error">{foutVan(veld)}</em>}
            </label>
          ))}
        </div>

        <h4>{t("masonry.geometry")}</h4>
        <div className="water2d-fields">
          {tekst("t", "t", "mm")}
          {tekst("h", "h", "m")}
          {tekst("l", t("masonry.length"), "m")}
          {keuze("steunranden", t("masonry.edges"), STEUNRANDSOORTEN)}
          {f.steunranden !== "BovenOnder" && tekst("lRand", t("masonry.edgeDistance"), "m")}
          {vink("betonvloeren", t("masonry.concreteFloors"))}
        </div>

        <h4>{t("masonry.loads")}</h4>
        <div className="water2d-fields">
          {vink("metVerticaal", t("masonry.vertical"))}
          <span />
          {f.metVerticaal && <>
            {tekst("nBoven", "N_Ed " + t("masonry.top"), "kN/m")}
            {tekst("mBoven", "M_Ed " + t("masonry.top"), "kNm/m")}
            {tekst("nMidden", "N_Ed " + t("masonry.mid"), "kN/m")}
            {tekst("mMidden", "M_Ed " + t("masonry.mid"), "kNm/m")}
            {tekst("nOnder", "N_Ed " + t("masonry.bottom"), "kN/m")}
            {tekst("mOnder", "M_Ed " + t("masonry.bottom"), "kNm/m")}
          </>}
          {vink("metGeconcentreerd", t("masonry.concentrated"))}
          <span />
          {f.metGeconcentreerd && <>
            {tekst("lastNaam", t("masonry.name"))}
            {tekst("nEdc", "N_Edc", "kN")}
            {tekst("lB", "l_b", "mm")}
            {tekst("b", "b", "mm")}
            {tekst("a1", "a_1", "mm")}
            {tekst("hC", "h_c", "m")}
            {tekst("e", "e", "mm")}
            <span />
          </>}
          {vink("metAfschuiving", t("masonry.shear"))}
          <span />
          {f.metAfschuiving && <>
            {tekst("vEd", "V_Ed", "kN")}
            {tekst("nEdV", "N_Ed", "kN")}
            {tekst("mEdV", "M_Ed", "kNm")}
            <span />
          </>}
          {vink("metBuiging", t("masonry.bending"))}
          <span />
          {f.metBuiging && <>
            {tekst("mEdUit", "M_Ed", "kNm/m")}
            {keuze("breukvlak", t("masonry.failurePlane"), BREUKVLAKKEN)}
          </>}
        </div>
        <p className="water2d-note">{t("masonry.signHint")}</p>

        {kernFout && <p className="water2d-error">{kernFout}</p>}
        {resultaat && (
          <div className="water2d-result" data-testid="metselwerk-resultaat">
            <strong className={resultaat.status === "Ok" ? "water2d-ok" : "water2d-error"}>
              {statusTekst(resultaat.status)}
            </strong>{" "}
            · UC<sub>max</sub> = {resultaat.uc_max.toFixed(3)}
            {resultaat.sterkte && (
              <p className="water2d-note">
                f_k = {resultaat.sterkte.f_k_mpa.toFixed(2)} N/mm² · f_d = {resultaat.sterkte.f_d_mpa.toFixed(2)} N/mm²
                {resultaat.slankheid !== null && resultaat.slankheid !== undefined && <> · h_ef/t_ef = {resultaat.slankheid.toFixed(2)}</>}
              </p>
            )}
            <div className="water2d-metrics">
              {resultaat.checks.map((c) => {
                const d = c.kind.data;
                const uc = d.uc?.uc;
                return (
                  <span key={c.id} title={d.notes.join("\n")}>
                    {d.title} ({d.article})
                    <b className={uc !== undefined && uc > 1 ? "water2d-error" : undefined}>
                      {uc !== undefined ? `UC ${uc.toFixed(3)}` : "–"}
                    </b>
                  </span>
                );
              })}
            </div>
            {resultaat.niet_getoetst.length > 0 && (
              <>
                <strong>{t("masonry.notChecked")}</strong>
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
