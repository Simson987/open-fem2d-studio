#!/usr/bin/env node
/**
 * Synthetisch IFC4-analysemodel (Structural Analysis View) voor de import
 * `design-mockup/src/io/ifcAnalyseImport.ts` en zijn test
 * `design-mockup/test-ifc-analyse-import.mjs`. Gemaakt voor dit project; er
 * zit geen gegeven van een echt project of een extern bestand in.
 *
 * Twee analysemodellen in één bestand, zonder gedeelde knopen:
 *
 *  1. "Hal" — een staalframe 6 × 5 m met een verdieping op +3,6 m en een dak
 *     op +7,2 m:
 *     - vier doorgaande kolommen (twee delen, star verbonden op +3,6), HEA 200;
 *       de kolommen op y = 0 met Axis X (rol 0), op y = 5 met Axis Y (rol π/2);
 *     - het portaal y = 0: ingeklemde voet K1, scharnierende voet K2 en een
 *       dakligger met scharnieren aan beide einden;
 *     - voet K4 op veren (k_z 50 000 kN/m, k_ry 2 000 kNm/rad);
 *     - vloerliggers: in x-richting star (IPE 300, alleen op afmetingen
 *       herkenbaar), in y-richting scharnierend (IPE 330);
 *     - X-verband van rond staal (RD 20) in de wand x = 0 (trek-alleen), een
 *       kokerschoor "K80/4" in de wand x = 6 (pendelstaaf, ook druk) en een
 *       vloerdiagonaal RD 16 in het eerste vloerveld (trek-alleen, in het vlak);
 *     - twee KPV-vlakken (membraan) op +3,6 die knopen delen → één schijf; een
 *       dakschijf (membraan) op +7,2 → tweede schijf; een lastverdeelvlak op het
 *       dak met overspanningsrichting "globaal Y";
 *     - gevallen G1 (eigen gewicht, SelfWeightCoefficients (0, 0, −1)),
 *       G2 afbouw (vloer −3,0 en dak −0,3 − 0,2 kN/m²), Q vloer (−2,5 kN/m²),
 *       W wind +X (1,2 kN/m op de kolommen x = 0, 2 kN op K13, dakzuiging
 *       +0,4 kN/m²) en "Imp G +X", de initiële scheefstand als knooplasten
 *       (ActionSource SYSTEM_IMPERFECTION: 0,5 kN op K5 en 0,25 kN op K11 in +X);
 *     - combinaties "UGT 1" (1,2·G1 + 1,2·G2 + 1,5·Q + 0,9·W, Purpose ULS),
 *       "BGT kar" (G1 + G2 + Q + Imp met factor 1 via een gewone toewijzing,
 *       0,6·W, Purpose SLS) en "BGT kar -X" (hetzelfde met −1·Imp).
 *  2. "Luifel" — een ingeklemde kolom (HEA 160) met een schuin aflopende
 *     buisligger (CHS 88,9 × 4) als uitkrager. Het model heeft een eigen
 *     SharedPlacement op (20, 0, 0); de items staan in een plaatsing die 90°
 *     om z gedraaid is en (1, 2, 0) verschoven: de import moet de keten
 *     terugrekenen. Gevallen G (lijnlast per geprojecteerde lengte), S (per
 *     ware lengte), Q (knooplast en staafpuntlast) en W (lokale lijnlast op
 *     de kolom); combinaties "Luifel UGT" en "Luifel BGT" (type uit de naam).
 *
 * Met `afwijkingen: true` komt er een derde model "Afwijkingen" bij met
 * alles wat de import moet melden in plaats van stil te vertalen. Met
 * `doorgaand: true` een model "Doorgaande ligger": één staaf over twee velden
 * van 4 m, met het tussensteunpunt alleen via een aansluiting
 * (IfcRelConnectsStructuralMember) eraan; de import moet de staaf daar knippen.
 * Met `varianten: true` een model "Varianten": vlaklasten met een eigen face
 * (gelijk aan het vlak, ook met een ander beginpunt en de andere draairichting;
 * een kleinere face; een face met een opening) en pendelstaven van een massieve
 * rechthoek (platte stalen strips, een gedrongen rechthoek, een rechthoek van hout).
 *
 * Eenheden: "m-N" (METRE, NEWTON, PASCAL) of "mm-kN" (MILLI METRE, KILO
 * NEWTON, KILO PASCAL en een afgeleide LINEARFORCEUNIT kN/m). De inhoud is
 * dezelfde; de import hoort beide tot op afrondingsruis gelijk te lezen.
 *
 * Gebruik: node docs/verificatie/ifc-analyse/genereer-ifc-analyse.mjs
 * schrijft ifc-analyse-m-n.ifc en ifc-analyse-mm-kn.ifc naast dit script.
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Omrekening van modelgrootheden (m, kN, kN/m, kN/m², kNm, kN/m, kNm/rad) naar de bestandseenheden. */
const EENHEDEN = {
  "m-N": {
    lengte: (m) => m, kracht: (kn) => kn * 1000, lijnlast: (q) => q * 1000, vlaklast: (q) => q * 1000,
    moment: (m) => m * 1000, veerT: (k) => k * 1000, veerR: (k) => k * 1000, lijnmoment: (m) => m * 1000,
  },
  "mm-kN": {
    lengte: (m) => m * 1000, kracht: (kn) => kn, lijnlast: (q) => q, vlaklast: (q) => q,
    moment: (m) => m * 1000, veerT: (k) => k / 1000, veerR: (k) => k * 1000, lijnmoment: (m) => m,
  },
};

const IFC_BASE64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** STEP-getal: altijd met een punt, exponent als E. */
function r(x) {
  let v = Math.round(x * 1e10) / 1e10;
  if (Object.is(v, -0)) v = 0;
  let s = String(v);
  if (s.includes("e")) {
    const [m, e] = s.split("e");
    s = `${m.includes(".") ? m : `${m}.`}E${e}`;
  } else if (!s.includes(".")) s += ".";
  return s;
}

const t = (s) => (s === undefined || s === null ? "$" : `'${String(s).replace(/'/g, "''")}'`);
const lijst = (ids) => `(${ids.map((id) => `#${id}`).join(",")})`;
const ja = (b) => `IFCBOOLEAN(${b ? ".T." : ".F."})`;

class Schrijver {
  constructor() {
    this.regels = [];
    this.guids = 0;
  }
  ent(type, ...args) {
    const id = this.regels.length + 1;
    this.regels.push(`#${id}=${type}(${args.join(",")});`);
    return id;
  }
  guid() {
    let n = ++this.guids;
    let s = "";
    for (let i = 0; i < 21; i += 1) {
      s = IFC_BASE64[n % 64] + s;
      n = Math.floor(n / 64);
    }
    return `'3${s}'`;
  }
}

/** Draai om z over 90° en terug: model 2 staat in een gedraaide plaatsing. */
const draaiZ90 = ([x, y, z]) => [-y, x, z];
const draaiZmin90 = ([x, y, z]) => [y, -x, z];

export function maakIfcAnalyseBestand({ eenheden = "m-N", afwijkingen = false, doorgaand = false, varianten = false } = {}) {
  const u = EENHEDEN[eenheden];
  if (!u) throw new Error(`onbekende eenheden ${eenheden}`);
  const w = new Schrijver();
  const punt = (p) => w.ent("IFCCARTESIANPOINT", `(${p.map((c) => r(u.lengte(c))).join(",")})`);
  const richting = (d) => w.ent("IFCDIRECTION", `(${d.map((c) => r(c)).join(",")})`);
  const assen = (p, z, x) => w.ent("IFCAXIS2PLACEMENT3D", `#${punt(p)}`, z ? `#${richting(z)}` : "$", x ? `#${richting(x)}` : "$");
  const plaatsing = (ouder, p = [0, 0, 0], z, x) => w.ent("IFCLOCALPLACEMENT", ouder ? `#${ouder}` : "$", `#${assen(p, z, x)}`);

  // ── Project, eenheden, context ──
  const eenheidIds = [];
  if (eenheden === "m-N") {
    eenheidIds.push(w.ent("IFCSIUNIT", "*", ".LENGTHUNIT.", "$", ".METRE."));
    eenheidIds.push(w.ent("IFCSIUNIT", "*", ".FORCEUNIT.", "$", ".NEWTON."));
    eenheidIds.push(w.ent("IFCSIUNIT", "*", ".PRESSUREUNIT.", "$", ".PASCAL."));
  } else {
    eenheidIds.push(w.ent("IFCSIUNIT", "*", ".LENGTHUNIT.", ".MILLI.", ".METRE."));
    const kn = w.ent("IFCSIUNIT", "*", ".FORCEUNIT.", ".KILO.", ".NEWTON.");
    eenheidIds.push(kn);
    eenheidIds.push(w.ent("IFCSIUNIT", "*", ".PRESSUREUNIT.", ".KILO.", ".PASCAL."));
    const meter = w.ent("IFCSIUNIT", "*", ".LENGTHUNIT.", "$", ".METRE.");
    const teller = w.ent("IFCDERIVEDUNITELEMENT", `#${kn}`, "1");
    const noemer = w.ent("IFCDERIVEDUNITELEMENT", `#${meter}`, "-1");
    eenheidIds.push(w.ent("IFCDERIVEDUNIT", lijst([teller, noemer]), ".LINEARFORCEUNIT.", "$"));
  }
  eenheidIds.push(w.ent("IFCSIUNIT", "*", ".PLANEANGLEUNIT.", "$", ".RADIAN."));
  const eenheidToekenning = w.ent("IFCUNITASSIGNMENT", lijst(eenheidIds));
  const wcs = assen([0, 0, 0]);
  const context = w.ent("IFCGEOMETRICREPRESENTATIONCONTEXT", "$", "'Model'", "3", "1.E-05", `#${wcs}`, "$");
  const project = w.ent("IFCPROJECT", w.guid(), "$", "'Voorbeeldhal'", "'Synthetisch analysemodel voor de importtest'",
    "$", "$", "$", lijst([context]), `#${eenheidToekenning}`);
  const pTerrein = plaatsing(null);
  const terrein = w.ent("IFCSITE", w.guid(), "$", "'Terrein'", "$", "$", `#${pTerrein}`, "$", "$", ".ELEMENT.", "$", "$", "$", "$", "$");
  const pGebouw = plaatsing(pTerrein);
  const gebouw = w.ent("IFCBUILDING", w.guid(), "$", "'Hal'", "$", "$", `#${pGebouw}`, "$", "$", ".ELEMENT.", "$", "$", "$");
  const verdiepingen = [["Begane grond", 0], ["Verdieping", 3.6], ["Dak", 7.2]].map(([naam, z]) =>
    w.ent("IFCBUILDINGSTOREY", w.guid(), "$", t(naam), "$", "$", `#${plaatsing(pGebouw, [0, 0, z])}`, "$", "$", ".ELEMENT.", r(u.lengte(z))));
  w.ent("IFCRELAGGREGATES", w.guid(), "$", "$", "$", `#${project}`, lijst([terrein]));
  w.ent("IFCRELAGGREGATES", w.guid(), "$", "$", "$", `#${terrein}`, lijst([gebouw]));
  w.ent("IFCRELAGGREGATES", w.guid(), "$", "$", "$", `#${gebouw}`, lijst(verdiepingen));

  // ── Gedeelde bouwstenen ──
  const materialen = new Map();
  const materiaal = (naam) => {
    if (!materialen.has(naam)) materialen.set(naam, w.ent("IFCMATERIAL", t(naam), "$", "'Staal'"));
    return materialen.get(naam);
  };
  const mm = (x) => r(u.lengte(x / 1000));
  const profielen = {
    I: (naam, h, b, tw, tf) => w.ent("IFCISHAPEPROFILEDEF", ".AREA.", t(naam), "$", mm(b), mm(h), mm(tw), mm(tf), mm(15), "$", "$"),
    U: (naam, h, b, tw, tf) => w.ent("IFCUSHAPEPROFILEDEF", ".AREA.", t(naam), "$", mm(h), mm(b), mm(tw), mm(tf), mm(11.5), "$", "$"),
    koker: (naam, x, y, tt) => w.ent("IFCRECTANGLEHOLLOWPROFILEDEF", ".AREA.", t(naam), "$", mm(x), mm(y), mm(tt), "$", "$"),
    buis: (naam, d, tt) => w.ent("IFCCIRCLEHOLLOWPROFILEDEF", ".AREA.", t(naam), "$", mm(d / 2), mm(tt)),
    rond: (naam, d) => w.ent("IFCCIRCLEPROFILEDEF", ".AREA.", t(naam), "$", mm(d / 2)),
    L: (naam, h, b, tt) => w.ent("IFCLSHAPEPROFILEDEF", ".AREA.", t(naam), "$", mm(h), mm(b), mm(tt), "$", "$", "$"),
    rechthoek: (naam, x, y) => w.ent("IFCRECTANGLEPROFILEDEF", ".AREA.", t(naam), "$", mm(x), mm(y)),
  };
  const conditie = (naam, waarden) => w.ent("IFCBOUNDARYNODECONDITION", t(naam), ...waarden.map((v, i) => {
    if (v === null) return "$";
    if (typeof v === "boolean") return ja(v);
    return i < 3 ? `IFCLINEARSTIFFNESSMEASURE(${r(u.veerT(v))})` : `IFCROTATIONALSTIFFNESSMEASURE(${r(u.veerR(v))})`;
  }));
  const scharnier = conditie("Scharnier My Mz", [true, true, true, true, false, false]);
  const kogelscharnier = conditie("Scharnier alle rotaties", [true, true, true, false, false, false]);
  const toekennen = (groep, leden) => w.ent("IFCRELASSIGNSTOGROUP", w.guid(), "$", "$", "$", lijst(leden), "$", `#${groep}`);
  const toekennenMetFactor = (groep, leden, factor) =>
    w.ent("IFCRELASSIGNSTOGROUPBYFACTOR", w.guid(), "$", "$", "$", lijst(leden), "$", `#${groep}`, r(factor));
  const eigenschappen = (object, psetNaam, waarden) => {
    const props = Object.entries(waarden).map(([naam, waarde]) =>
      w.ent("IFCPROPERTYSINGLEVALUE", t(naam), "$", `IFCLABEL(${t(waarde)})`, "$"));
    const pset = w.ent("IFCPROPERTYSET", w.guid(), "$", t(psetNaam), "$", lijst(props));
    w.ent("IFCRELDEFINESBYPROPERTIES", w.guid(), "$", "$", "$", lijst([object]), `#${pset}`);
  };

  /**
   * Eén analysemodel. `lokaal` rekent een modelcoördinaat om naar het stelsel
   * van de itemplaatsing; `lokaleRichting` doet dat voor een richting.
   */
  const analysemodel = ({ naam, beschrijving, gedeeld, items, lokaal, lokaleRichting }) => {
    const leden = [];
    const knopen = new Map();
    const knoop = (label, p, opties = {}) => {
      const vertex = w.ent("IFCVERTEXPOINT", `#${punt(lokaal(p))}`);
      const topo = w.ent("IFCTOPOLOGYREPRESENTATION", `#${context}`, "'Reference'", "'Vertex'", lijst([vertex]));
      const vorm = w.ent("IFCPRODUCTDEFINITIONSHAPE", "$", "$", lijst([topo]));
      const stelsel = opties.stelsel ? `#${assen([0, 0, 0], opties.stelsel.z, opties.stelsel.x)}` : "$";
      const id = w.ent("IFCSTRUCTURALPOINTCONNECTION", w.guid(), "$", t(label), "$", "$", `#${items}`, `#${vorm}`,
        opties.oplegging ? `#${conditie(`Oplegging ${label}`, opties.oplegging)}` : "$", stelsel);
      knopen.set(label, { id, vertex, p });
      leden.push(id);
      return id;
    };
    const profielSets = new Map();
    const staafMateriaal = (staaf, profiel, materiaalNaam, cardinalPoint = 5) => {
      const sleutel = `${profiel}|${materiaalNaam}|${cardinalPoint}`;
      if (!profielSets.has(sleutel)) {
        const mp = w.ent("IFCMATERIALPROFILE", "$", "$", `#${materiaal(materiaalNaam)}`, `#${profiel}`, "$", "$");
        const set = w.ent("IFCMATERIALPROFILESET", "$", "$", lijst([mp]), "$");
        const gebruik = w.ent("IFCMATERIALPROFILESETUSAGE", `#${set}`, String(cardinalPoint), "$");
        profielSets.set(sleutel, { gebruik, objecten: [] });
      }
      profielSets.get(sleutel).objecten.push(staaf);
    };
    const staaf = (label, van, naar, { profiel, materiaal: mat, axis, soort = "RIGID_JOINED_MEMBER", objectType, scharnieren, cardinalPoint }) => {
      const a = knopen.get(van), b = knopen.get(naar);
      const rand = w.ent("IFCEDGE", `#${a.vertex}`, `#${b.vertex}`);
      const topo = w.ent("IFCTOPOLOGYREPRESENTATION", `#${context}`, "'Reference'", "'Edge'", lijst([rand]));
      const vorm = w.ent("IFCPRODUCTDEFINITIONSHAPE", "$", "$", lijst([topo]));
      const id = w.ent("IFCSTRUCTURALCURVEMEMBER", w.guid(), "$", t(label), "$", t(objectType), `#${items}`, `#${vorm}`,
        `.${soort}.`, `#${richting(lokaleRichting(axis))}`);
      leden.push(id);
      staafMateriaal(id, profiel, mat, cardinalPoint);
      for (const [kant, knoopLabel] of [["begin", van], ["eind", naar]]) {
        const s = scharnieren?.[kant];
        w.ent("IFCRELCONNECTSSTRUCTURALMEMBER", w.guid(), "$", "$", "$", `#${id}`, `#${knopen.get(knoopLabel).id}`,
          s ? `#${s}` : "$", "$", "$", "$");
      }
      return id;
    };
    const vlak = (label, hoeken, { soort, objectType, dikte, span }) => {
      const vertices = hoeken.map((h) => knopen.get(h).vertex);
      const randen = vertices.map((v, i) => {
        const rand = w.ent("IFCEDGE", `#${v}`, `#${vertices[(i + 1) % vertices.length]}`);
        return w.ent("IFCORIENTEDEDGE", "*", "*", `#${rand}`, ".T.");
      });
      const lus = w.ent("IFCEDGELOOP", lijst(randen));
      const buiten = w.ent("IFCFACEOUTERBOUND", `#${lus}`, ".T.");
      // IfcPlane: oorsprong in de eerste hoek, x langs de eerste rand, z de normaal van de lus.
      const [p0, p1, p2] = hoeken.slice(0, 3).map((h) => knopen.get(h).p);
      const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const eenheid = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
      const vlakDrager = w.ent("IFCPLANE", `#${assen(lokaal(p0), lokaleRichting(eenheid(n)), lokaleRichting(eenheid(e1)))}`);
      const face = w.ent("IFCFACESURFACE", lijst([buiten]), `#${vlakDrager}`, ".T.");
      const topo = w.ent("IFCTOPOLOGYREPRESENTATION", `#${context}`, "'Reference'", "'Face'", lijst([face]));
      const vorm = w.ent("IFCPRODUCTDEFINITIONSHAPE", "$", "$", lijst([topo]));
      const id = w.ent("IFCSTRUCTURALSURFACEMEMBER", w.guid(), "$", t(label), "$", t(objectType), `#${items}`, `#${vorm}`,
        `.${soort}.`, dikte === undefined ? "$" : r(u.lengte(dikte)));
      leden.push(id);
      if (span) eigenschappen(id, "Pset_Vlak", { Overspanningsrichting: span });
      return id;
    };
    const gevallen = [];
    const geval = (label, { actie, bron, eigenGewicht, coefficient }) => {
      const id = w.ent("IFCSTRUCTURALLOADCASE", w.guid(), "$", t(label), "$", "$", ".LOAD_CASE.", `.${actie}.`, `.${bron}.`,
        coefficient === undefined ? "$" : r(coefficient), "$", eigenGewicht ? `(${eigenGewicht.map(r).join(",")})` : "$");
      gevallen.push(id);
      return { id, acties: [] };
    };
    /**
     * Een eigen face voor een vlaklast (IfcTopologyRepresentation 'Face'). Een
     * hoek is een knooplabel (dezelfde IfcVertexPoint als de knoop) of een punt;
     * `poly`: een IfcPolyLoop in plaats van een IfcEdgeLoop; `gaten`: openingen.
     */
    const lastFace = (hoeken, { poly = false, gaten = [] } = {}) => {
      const p = (h) => (typeof h === "string" ? knopen.get(h).p : h);
      const lus = (punten) => {
        if (poly) return w.ent("IFCPOLYLOOP", lijst(punten.map((h) => punt(lokaal(p(h))))));
        const vs = punten.map((h) => (typeof h === "string" ? knopen.get(h).vertex : w.ent("IFCVERTEXPOINT", `#${punt(lokaal(h))}`)));
        return w.ent("IFCEDGELOOP", lijst(vs.map((v, i) =>
          w.ent("IFCORIENTEDEDGE", "*", "*", `#${w.ent("IFCEDGE", `#${v}`, `#${vs[(i + 1) % vs.length]}`)}`, ".T."))));
      };
      const randen = [w.ent("IFCFACEOUTERBOUND", `#${lus(hoeken)}`, ".T."), ...gaten.map((g) => w.ent("IFCFACEBOUND", `#${lus(g)}`, ".F."))];
      const topo = w.ent("IFCTOPOLOGYREPRESENTATION", `#${context}`, "'Reference'", "'Face'", lijst([w.ent("IFCFACE", lijst(randen))]));
      return w.ent("IFCPRODUCTDEFINITIONSHAPE", "$", "$", lijst([topo]));
    };
    const vlaklast = (g, vlakId, label, pz, opties = {}) => {
      const last = w.ent("IFCSTRUCTURALLOADPLANARFORCE", t(label),
        r(u.vlaklast(opties.px ?? 0)), r(u.vlaklast(opties.py ?? 0)), r(u.vlaklast(pz)));
      const id = w.ent("IFCSTRUCTURALPLANARACTION", w.guid(), "$", t(label), "$", "$",
        opties.plaatsing ? `#${opties.plaatsing}` : "$",
        opties.face ? `#${lastFace(opties.face.hoeken, opties.face)}` : opties.vorm ? `#${opties.vorm}` : "$", `#${last}`,
        opties.lokaal ? ".LOCAL_COORDS." : ".GLOBAL_COORDS.", "$", `.${opties.lengte ?? "TRUE_LENGTH"}.`, ".CONST.");
      w.ent("IFCRELCONNECTSSTRUCTURALACTIVITY", w.guid(), "$", "$", "$", `#${vlakId}`, `#${id}`);
      g.acties.push(id);
    };
    const lijnlast = (g, staafId, label, q, opties = {}) => {
      const m = opties.moment ?? [0, 0, 0];
      const last = w.ent("IFCSTRUCTURALLOADLINEARFORCE", t(label), ...q.map((c) => r(u.lijnlast(c))), ...m.map((c) => r(u.lijnmoment(c))));
      const id = w.ent("IFCSTRUCTURALLINEARACTION", w.guid(), "$", t(label), "$", "$", "$", "$", `#${last}`,
        opties.lokaal ? ".LOCAL_COORDS." : ".GLOBAL_COORDS.", "$", `.${opties.lengte ?? "TRUE_LENGTH"}.`, `.${opties.verloop ?? "CONST"}.`);
      w.ent("IFCRELCONNECTSSTRUCTURALACTIVITY", w.guid(), "$", "$", "$", `#${staafId}`, `#${id}`);
      g.acties.push(id);
    };
    const puntlast = (g, elementId, label, f, opties = {}) => {
      const m = opties.moment ?? [0, 0, 0];
      const last = w.ent("IFCSTRUCTURALLOADSINGLEFORCE", t(label), ...f.map((c) => r(u.kracht(c))), ...m.map((c) => r(u.moment(c))));
      const plek = opties.op ? `#${plaatsing(items, lokaal(opties.op))}` : "$";
      const id = w.ent("IFCSTRUCTURALPOINTACTION", w.guid(), "$", t(label), "$", "$", plek, "$", `#${last}`, ".GLOBAL_COORDS.",
        opties.destabiliserend ? ".T." : "$");
      w.ent("IFCRELCONNECTSSTRUCTURALACTIVITY", w.guid(), "$", "$", "$", `#${elementId}`, `#${id}`);
      g.acties.push(id);
    };
    const combinaties = [];
    const combinatie = (label, doel, factoren) => {
      const id = w.ent("IFCSTRUCTURALLOADGROUP", w.guid(), "$", t(label), "$", "$", ".LOAD_COMBINATION.",
        ".NOTDEFINED.", ".NOTDEFINED.", "$", t(doel));
      for (const [factor, gevalIds] of factoren) {
        if (factor === null) toekennen(id, gevalIds);
        else toekennenMetFactor(id, gevalIds, factor);
      }
      combinaties.push(id);
      return id;
    };
    const afronden = () => {
      for (const { gebruik, objecten } of profielSets.values()) {
        w.ent("IFCRELASSOCIATESMATERIAL", w.guid(), "$", "$", "$", lijst(objecten), `#${gebruik}`);
      }
      const model = w.ent("IFCSTRUCTURALANALYSISMODEL", w.guid(), "$", t(naam), t(beschrijving), "$", ".LOADING_3D.", "$",
        lijst([...gevallen, ...combinaties]), "$", `#${gedeeld}`);
      w.ent("IFCRELSERVICESBUILDINGS", w.guid(), "$", "$", "$", `#${model}`, lijst([gebouw]));
      toekennen(model, leden);
      return model;
    };
    return { knoop, staaf, vlak, geval, vlaklast, lijnlast, puntlast, combinatie, toekennen, afronden, knopen, leden };
  };

  // ── Model 1: Hal ──
  {
    const gedeeld = plaatsing(pGebouw);
    const m = analysemodel({
      naam: "Hal", beschrijving: "Portaal met verdieping, verbanden en schijven",
      gedeeld, items: gedeeld, lokaal: (p) => p, lokaleRichting: (d) => d,
    });
    const K = [
      ["K1", [0, 0, 0], { oplegging: [true, true, true, true, true, true] }],
      ["K2", [6, 0, 0], { oplegging: [true, true, true, false, false, false] }],
      ["K3", [0, 5, 0], { oplegging: [true, true, true, false, false, false] }],
      ["K4", [6, 5, 0], { oplegging: [true, true, 50000, false, 2000, false] }],
      ["K5", [0, 0, 3.6]], ["K6", [3, 0, 3.6]], ["K7", [6, 0, 3.6]],
      ["K8", [0, 5, 3.6]], ["K9", [3, 5, 3.6]], ["K10", [6, 5, 3.6]],
      ["K11", [0, 0, 7.2]], ["K12", [6, 0, 7.2]], ["K13", [0, 5, 7.2]], ["K14", [6, 5, 7.2]],
    ];
    for (const [label, p, opties] of K) m.knoop(label, p, opties);
    const hea200 = profielen.I("HEA200", 190, 200, 6.5, 10);
    const hea200b = profielen.I("HE 200 A", 190, 200, 6.5, 10);
    const ligger = profielen.I("Ligger-X", 300, 150, 7.1, 10.7);
    const ipe330 = profielen.I("IPE330", 330, 160, 7.5, 11.5);
    const ipe240 = profielen.I("IPE 240", 240, 120, 6.2, 9.8);
    const unp = profielen.U("UPN200", 200, 75, 8.5, 11.5);
    const rd20 = profielen.rond("RD20", 20);
    const rd16 = profielen.rond("RD16", 16);
    const koker = profielen.koker("K80/4", 80, 80, 4);
    const kolom = (label, van, naar, profiel, axis) =>
      m.staaf(label, van, naar, { profiel, materiaal: "S235JR", axis, objectType: "Kolom" });
    const c1a = kolom("C1a", "K1", "K5", hea200, [1, 0, 0]);
    const c1b = kolom("C1b", "K5", "K11", hea200, [1, 0, 0]);
    kolom("C2a", "K2", "K7", hea200, [1, 0, 0]);
    kolom("C2b", "K7", "K12", hea200, [1, 0, 0]);
    const c3a = kolom("C3a", "K3", "K8", hea200b, [0, 1, 0]);
    const c3b = kolom("C3b", "K8", "K13", hea200b, [0, 1, 0]);
    kolom("C4a", "K4", "K10", hea200b, [0, 1, 0]);
    kolom("C4b", "K10", "K14", hea200b, [0, 1, 0]);
    eigenschappen(c1a, "Pset_Onderdeel", { Onderdeel: "Kolom as A" });
    eigenschappen(c1b, "Pset_Onderdeel", { Onderdeel: "Kolom as A" });
    const vloerligger = (label, van, naar, profiel, mat, scharnierend) => m.staaf(label, van, naar, {
      profiel, materiaal: mat, axis: [0, 0, 1], objectType: "Vloerligger",
      ...(scharnierend ? { scharnieren: { begin: scharnier, eind: scharnier } } : {}),
    });
    vloerligger("L1", "K5", "K6", ligger, "S355J2");
    vloerligger("L2", "K6", "K7", ligger, "S355J2");
    vloerligger("L3", "K8", "K9", ligger, "S355J2");
    vloerligger("L4", "K9", "K10", ligger, "S355J2");
    vloerligger("L5", "K5", "K8", ipe330, "S235", true);
    vloerligger("L6", "K6", "K9", ipe330, "S235", true);
    vloerligger("L7", "K7", "K10", ipe330, "S235", true);
    const dakligger = (label, van, naar, profiel) => m.staaf(label, van, naar, {
      profiel, materiaal: "S235", axis: [0, 0, 1], objectType: "Dakligger", scharnieren: { begin: scharnier, eind: scharnier },
    });
    dakligger("R1", "K11", "K12", ipe240);
    dakligger("R2", "K13", "K14", ipe240);
    dakligger("R3", "K11", "K13", unp);
    dakligger("R4", "K12", "K14", unp);
    const verband = (label, van, naar, profiel, axis, objectType, conditieId) => m.staaf(label, van, naar, {
      profiel, materiaal: "S235", axis, soort: "PIN_JOINED_MEMBER", objectType,
      scharnieren: { begin: conditieId, eind: conditieId },
    });
    verband("V1", "K1", "K8", rd20, [1, 0, 0], "Wandverband", kogelscharnier);
    verband("V2", "K3", "K5", rd20, [1, 0, 0], "Wandverband", kogelscharnier);
    verband("S1", "K2", "K10", koker, [1, 0, 0], "Schoor", scharnier);
    verband("F1", "K5", "K9", rd16, [0, 0, 1], "Vloerverband", kogelscharnier);

    const kpv1 = m.vlak("KPV-1", ["K5", "K6", "K9", "K8"], { soort: "MEMBRANE_ELEMENT", objectType: "Kanaalplaatvloer", dikte: 0.2 });
    const kpv2 = m.vlak("KPV-2", ["K6", "K7", "K10", "K9"], { soort: "MEMBRANE_ELEMENT", objectType: "Kanaalplaatvloer", dikte: 0.2, span: "globaal X" });
    m.vlak("Dakschijf", ["K11", "K12", "K14", "K13"], { soort: "MEMBRANE_ELEMENT", objectType: "Dakschijf", dikte: 0.1 });
    const dak = m.vlak("Dakvlak", ["K11", "K12", "K14", "K13"], { soort: "USERDEFINED", objectType: "Lastverdeelvlak", span: "globaal Y" });

    const g1 = m.geval("G1 eigen gewicht", { actie: "PERMANENT_G", bron: "DEAD_LOAD_G", eigenGewicht: [0, 0, -1] });
    const g2 = m.geval("G2 afbouw", { actie: "PERMANENT_G", bron: "COMPLETION_G1" });
    const q = m.geval("Q vloer", { actie: "VARIABLE_Q", bron: "LIVE_LOAD_Q" });
    const wind = m.geval("W wind X", { actie: "VARIABLE_Q", bron: "WIND_W" });
    // Initiële scheefstand als eigen geval: knooplasten, ActionType van het verticale geval.
    const imp = m.geval("Imp G +X", { actie: "PERMANENT_G", bron: "SYSTEM_IMPERFECTION" });
    m.vlaklast(g2, kpv1, "Afbouw vloer", -3.0);
    m.vlaklast(g2, kpv2, "Afbouw vloer", -3.0);
    m.vlaklast(g2, dak, "Dakafwerking", -0.3);
    m.vlaklast(g2, dak, "Installaties", -0.2);
    m.vlaklast(q, kpv1, "Vloer", -2.5);
    m.vlaklast(q, kpv2, "Vloer", -2.5);
    for (const staafId of [c1a, c1b, c3a, c3b]) m.lijnlast(wind, staafId, "Wind op gevel", [1.2, 0, 0]);
    m.puntlast(wind, m.knopen.get("K13").id, "Wind kopgevel", [2.0, 0, 0]);
    m.vlaklast(wind, dak, "Dakzuiging", 0.4);
    m.puntlast(imp, m.knopen.get("K5").id, "Scheefstand verdieping", [0.5, 0, 0], { destabiliserend: true });
    m.puntlast(imp, m.knopen.get("K11").id, "Scheefstand dak", [0.25, 0, 0], { destabiliserend: true });
    for (const g of [g1, g2, q, wind, imp]) if (g.acties.length > 0) m.toekennen(g.id, g.acties);
    m.combinatie("UGT 1", "ULS", [[1.2, [g1.id, g2.id]], [1.5, [q.id]], [0.9, [wind.id]]]);
    // De scheefstand in beide richtingen: factor +1 en −1, met dezelfde factor als het verticale geval.
    m.combinatie("BGT kar", "SLS", [[null, [g1.id, g2.id, q.id, imp.id]], [0.6, [wind.id]]]);
    m.combinatie("BGT kar -X", "SLS", [[null, [g1.id, g2.id, q.id]], [-1, [imp.id]], [0.6, [wind.id]]]);
    m.afronden();
  }

  // ── Model 2: Luifel, in een gedraaide en verschoven plaatsing ──
  {
    const gedeeld = plaatsing(pGebouw, [20, 0, 0]);
    const items = plaatsing(gedeeld, [1, 2, 0], [0, 0, 1], [0, 1, 0]);
    const m = analysemodel({
      naam: "Luifel", beschrijving: "Ingeklemde kolom met schuine uitkrager",
      gedeeld, items,
      lokaal: (p) => draaiZmin90([p[0] - 1, p[1] - 2, p[2]]),
      lokaleRichting: (d) => draaiZmin90(d),
    });
    m.knoop("P1", [0, 0, 0], { oplegging: [true, true, true, true, true, true] });
    m.knoop("P2", [0, 0, 3]);
    m.knoop("P3", [3, 0, 2.5]);
    const kolom = m.staaf("Luifelkolom", "P1", "P2", { profiel: profielen.I("HEA160", 152, 160, 6, 9), materiaal: "S235", axis: [1, 0, 0], objectType: "Kolom" });
    const ligger = m.staaf("Luifelligger", "P2", "P3", { profiel: profielen.buis("Buis 88,9x4", 88.9, 4), materiaal: "S355", axis: [0, 0, 1], objectType: "Luifelligger" });
    const g = m.geval("G luifel", { actie: "PERMANENT_G", bron: "DEAD_LOAD_G" });
    const s = m.geval("S luifel", { actie: "VARIABLE_Q", bron: "SNOW_S" });
    const q = m.geval("Q luifel", { actie: "VARIABLE_Q", bron: "LIVE_LOAD_Q" });
    const wind = m.geval("W luifel", { actie: "VARIABLE_Q", bron: "WIND_W" });
    m.lijnlast(g, ligger, "Dakbedekking", [0, 0, -2.0], { lengte: "PROJECTED_LENGTH" });
    m.lijnlast(s, ligger, "Sneeuw", [0, 0, -0.8]);
    m.puntlast(q, m.knopen.get("P3").id, "Onderhoud punt", [0, 0, -5]);
    m.puntlast(q, ligger, "Bord", [0, 0, -3], { op: [1.5, 0, 2.75] });
    m.lijnlast(wind, kolom, "Wind lokaal", [0, 0, 0.5], { lokaal: true });
    for (const geval of [g, s, q, wind]) m.toekennen(geval.id, geval.acties);
    m.combinatie("Luifel UGT", "UGT", [[1.35, [g.id]], [1.5, [s.id]]]);
    m.combinatie("Luifel BGT", null, [[null, [g.id, q.id]]]);
    m.afronden();
  }

  // ── Model 3 (optioneel): alles wat de import moet melden ──
  if (afwijkingen) {
    const gedeeld = plaatsing(pGebouw, [0, 20, 0]);
    const m = analysemodel({
      naam: "Afwijkingen", beschrijving: "Niet ondersteunde onderdelen",
      gedeeld, items: gedeeld, lokaal: (p) => p, lokaleRichting: (d) => d,
    });
    const s30 = Math.sin(Math.PI / 6), c30 = Math.cos(Math.PI / 6);
    m.knoop("A1", [0, 0, 0], { oplegging: [true, true, true, true, true, true] });
    m.knoop("A2", [0, 0, 3]);
    m.knoop("A3", [4, 0, 3]);
    m.knoop("A4", [4, 0, 0], { oplegging: [true, false, true, false, false, false], stelsel: { z: [0, 0, 1], x: [c30, s30, 0] } });
    m.knoop("A5", [0, 4, 4]);
    m.knoop("A6", [4, 4, 4]);
    m.knoop("A7", [0, 4, 0], { oplegging: [true, true, true, true, true, true] });
    m.knoop("A8", [8, 0, 3]);
    m.knoop("A9", [8, 4, 3]);
    m.knoop("A10", [4, 4, 3]);
    m.knoop("A11", [9, 9, 9]);
    // Een knoop midden op staaf X8 (A3 → A8), aangesloten zonder dat de staaf
    // in het bestand gesplitst is: de import splitst hem daar.
    m.knoop("A12", [6, 0, 3]);
    const hea = profielen.I("HEA200", 190, 200, 6.5, 10);
    const ipe = profielen.I("IPE 200", 200, 100, 5.6, 8.5);
    const hoek = profielen.L("L 80x80x8", 80, 80, 8);
    const rhs = profielen.koker("Koker 200x100x8", 200, 100, 8);
    const veerscharnier = conditie("Veer", [true, true, true, true, 500, false]);
    const schuifeinde = conditie("Schuivend", [false, true, true, true, false, false]);
    const alleenRy = conditie("Alleen Ry", [true, true, true, true, false, true]);
    const x1 = m.staaf("X1", "A1", "A2", { profiel: hea, materiaal: "S235", axis: [1, 0, 0], cardinalPoint: 1 });
    const x2 = m.staaf("X2", "A2", "A3", { profiel: hoek, materiaal: "S235", axis: [0, 0, 1] });
    m.staaf("X3", "A4", "A3", { profiel: ipe, materiaal: "C24", axis: [1, 0, 0] });
    m.staaf("X4", "A2", "A5", { profiel: ipe, materiaal: "S235", axis: [1, 0, 0], soort: "COMPRESSION_MEMBER" });
    m.staaf("X5", "A3", "A6", { profiel: ipe, materiaal: "S235", axis: [1, 0, 0], scharnieren: { begin: veerscharnier, eind: schuifeinde } });
    const x6 = m.staaf("X6", "A5", "A6", { profiel: ipe, materiaal: "S235", axis: [0, 0, 1] });
    m.staaf("X7", "A7", "A5", { profiel: rhs, materiaal: "S235", axis: [1, 0, 0] });
    const x8 = m.staaf("X8", "A3", "A8", { profiel: ipe, materiaal: "S235", axis: [0, 0, 1] });
    for (const knoopLabel of ["A12", "A10"]) {
      // A12 ligt op de staaf (tussenknoop); A10 niet (melding, genegeerd).
      w.ent("IFCRELCONNECTSSTRUCTURALMEMBER", w.guid(), "$", "$", "$", `#${x8}`, `#${m.knopen.get(knoopLabel).id}`,
        "$", "$", "$", "$");
    }
    m.staaf("X9", "A8", "A9", { profiel: ipe, materiaal: "S235", axis: [0, 0, 1] });
    m.staaf("X10", "A9", "A10", { profiel: ipe, materiaal: "S235", axis: [0, 0, 1] });
    // Een aansluiting in een 30° om de staafas gedraaid stelsel, alleen R_y vrij:
    // de vrije as ligt voor 75 % langs lokaal y en voor 25 % langs lokaal z.
    w.ent("IFCRELCONNECTSSTRUCTURALMEMBER", w.guid(), "$", "$", "$", `#${x6}`, `#${m.knopen.get("A6").id}`,
      `#${alleenRy}`, "$", "$", `#${assen([0, 0, 0], [0, -s30, c30], [1, 0, 0])}`);
    // Excentrische aansluiting.
    const excentrisch = w.ent("IFCCONNECTIONPOINTECCENTRICITY", `#${punt([0, 0, 3])}`, "$", r(u.lengte(0.1)), "$", "$");
    w.ent("IFCRELCONNECTSWITHECCENTRICITY", w.guid(), "$", "$", "$", `#${x1}`, `#${m.knopen.get("A2").id}`,
      "$", "$", "$", "$", `#${excentrisch}`);
    // Een hellend lastvlak, een wand met buigstijfheid en een vlak met een opening.
    const hellend = m.vlak("Hellend dak", ["A2", "A3", "A6", "A5"], { soort: "USERDEFINED", objectType: "Lastverdeelvlak" });
    const wand = m.vlak("Wand", ["A1", "A4", "A3", "A2"], { soort: "SHELL", objectType: "Wand", dikte: 0.25 });
    // Vlak met opening: buitenrand A3-A8-A9-A10 met een binnenrand.
    {
      const buitenRand = ["A3", "A8", "A9", "A10"].map((h) => m.knopen.get(h).vertex);
      const orient = (vs) => vs.map((v, i) => w.ent("IFCORIENTEDEDGE", "*", "*", `#${w.ent("IFCEDGE", `#${v}`, `#${vs[(i + 1) % vs.length]}`)}`, ".T."));
      const buiten = w.ent("IFCFACEOUTERBOUND", `#${w.ent("IFCEDGELOOP", lijst(orient(buitenRand)))}`, ".T.");
      const gat = [[5, 1, 3], [7, 1, 3], [7, 3, 3], [5, 3, 3]].map((p) => w.ent("IFCVERTEXPOINT", `#${punt(p)}`));
      const binnen = w.ent("IFCFACEBOUND", `#${w.ent("IFCEDGELOOP", lijst(orient(gat)))}`, ".F.");
      const face = w.ent("IFCFACESURFACE", lijst([buiten, binnen]), `#${w.ent("IFCPLANE", `#${assen([4, 0, 3], [0, 0, 1], [1, 0, 0])}`)}`, ".T.");
      const topo = w.ent("IFCTOPOLOGYREPRESENTATION", `#${context}`, "'Reference'", "'Face'", lijst([face]));
      const vorm = w.ent("IFCPRODUCTDEFINITIONSHAPE", "$", "$", lijst([topo]));
      const id = w.ent("IFCSTRUCTURALSURFACEMEMBER", w.guid(), "$", "'Vloer met sparing'", "$", "'Lastverdeelvlak'",
        `#${gedeeld}`, `#${vorm}`, ".USERDEFINED.", "$");
      m.leden.push(id);
      m.opening = id;
    }
    // Een lijnoplegging.
    {
      const rand = w.ent("IFCEDGE", `#${m.knopen.get("A1").vertex}`, `#${m.knopen.get("A4").vertex}`);
      const topo = w.ent("IFCTOPOLOGYREPRESENTATION", `#${context}`, "'Reference'", "'Edge'", lijst([rand]));
      const vorm = w.ent("IFCPRODUCTDEFINITIONSHAPE", "$", "$", lijst([topo]));
      m.leden.push(w.ent("IFCSTRUCTURALCURVECONNECTION", w.guid(), "$", "'Strookfundering'", "$", "$", `#${gedeeld}`, `#${vorm}`, "$", `#${richting([0, 0, 1])}`));
    }
    const g = m.geval("Afw G", { actie: "PERMANENT_G", bron: "DEAD_LOAD_G", eigenGewicht: [0, 0, -0.5], coefficient: 1.2 });
    const onbekend = m.geval("Afw onbekend", { actie: "NOTDEFINED", bron: "NOTDEFINED" });
    m.lijnlast(g, x1, "Verlopend", [1, 0, 0], { verloop: "LINEAR" });
    m.lijnlast(g, x2, "Met moment", [0, 0, -1], { moment: [0.5, 0, 0] });
    m.puntlast(g, x2, "Puntmoment", [0, 0, -2], { moment: [0, 1, 0], op: [2, 0, 3] });
    m.vlaklast(g, hellend, "Hellend per ware lengte", -1.0);
    m.vlaklast(onbekend, hellend, "Schuine last", -1.0, { px: 0.3 });
    m.vlaklast(g, wand, "Wind op wand", 0, { py: 0.8 });
    m.vlaklast(g, m.opening, "Vloer", -2.0);
    // Op de gesplitste staaf X8 (4 m, tussenknoop op 2 m): een lijnlast over de
    // hele lengte en een puntlast op 3 m van het begin, dus op het tweede deel.
    m.lijnlast(g, x8, "Lijnlast op X8", [0, 0, -1.5]);
    m.puntlast(g, x8, "Puntlast op X8", [0, 0, -4], { op: [7, 0, 3] });
    m.toekennen(g.id, g.acties);
    m.toekennen(onbekend.id, onbekend.acties);
    m.combinatie("Afw combinatie", null, [[1.0, [g.id]]]);
    m.afronden();
  }

  // ── Model 4 (optioneel): één staaf over twee velden met een tussensteunpunt ──
  if (doorgaand) {
    const gedeeld = plaatsing(pGebouw, [0, 40, 0]);
    const m = analysemodel({
      naam: "Doorgaande ligger", beschrijving: "Eén staaf over twee velden van 4 m",
      gedeeld, items: gedeeld, lokaal: (p) => p, lokaleRichting: (d) => d,
    });
    m.knoop("D1", [0, 0, 0], { oplegging: [true, true, true, true, false, false] });
    m.knoop("D2", [4, 0, 0], { oplegging: [false, true, true, false, false, false] });
    m.knoop("D3", [8, 0, 0], { oplegging: [false, true, true, false, false, false] });
    const ipe = profielen.I("IPE 200", 200, 100, 5.6, 8.5);
    // De staaf loopt van D1 naar D3; D2 hangt er alleen via een aansluiting aan.
    const ligger = m.staaf("Ligger", "D1", "D3", { profiel: ipe, materiaal: "S235", axis: [0, 0, 1] });
    w.ent("IFCRELCONNECTSSTRUCTURALMEMBER", w.guid(), "$", "$", "$", `#${ligger}`, `#${m.knopen.get("D2").id}`,
      "$", "$", "$", "$");
    const g = m.geval("G", { actie: "PERMANENT_G", bron: "DEAD_LOAD_G" });
    m.lijnlast(g, ligger, "Gelijkmatig", [0, 0, -2]);
    m.puntlast(g, ligger, "Midden tweede veld", [0, 0, -4], { op: [6, 0, 0] });
    m.toekennen(g.id, g.acties);
    m.afronden();
  }

  // ── Model 5 (optioneel): vlaklasten met een eigen face en pendelstaven van strip ──
  if (varianten) {
    const gedeeld = plaatsing(pGebouw, [0, 60, 0]);
    const m = analysemodel({
      naam: "Varianten", beschrijving: "Vlaklasten met een eigen face en pendelstaven van strip",
      gedeeld, items: gedeeld, lokaal: (p) => p, lokaleRichting: (d) => d,
    });
    const vast = [true, true, true, true, true, true];
    for (const [label, p] of [["V1", [0, 0, 0]], ["V2", [6, 0, 0]], ["V3", [6, 4, 0]], ["V4", [0, 4, 0]]]) {
      m.knoop(label, p, { oplegging: vast });
    }
    // Vloer 6 × 4 m op +3,6; W5 ligt midden op de rand W1–W2.
    for (const [label, p] of [["W1", [0, 0, 3.6]], ["W5", [3, 0, 3.6]], ["W2", [6, 0, 3.6]], ["W3", [6, 4, 3.6]], ["W4", [0, 4, 3.6]]]) {
      m.knoop(label, p);
    }
    const hea = profielen.I("HEA 200", 190, 200, 6.5, 10);
    const ipe = profielen.I("IPE 200", 200, 100, 5.6, 8.5);
    for (const [label, van, naar] of [["VK1", "V1", "W1"], ["VK2", "V2", "W2"], ["VK3", "V3", "W3"], ["VK4", "V4", "W4"]]) {
      m.staaf(label, van, naar, { profiel: hea, materiaal: "S235", axis: [1, 0, 0] });
    }
    for (const [label, van, naar] of [["VL1", "W1", "W5"], ["VL2", "W5", "W2"], ["VL3", "W2", "W3"], ["VL4", "W3", "W4"], ["VL5", "W4", "W1"]]) {
      m.staaf(label, van, naar, { profiel: ipe, materiaal: "S235", axis: [0, 0, 1] });
    }
    // De rand van het vlak begint in W5 (drie niet-collineaire eerste hoeken voor het IfcPlane).
    const vloer = m.vlak("Vloer", ["W5", "W2", "W3", "W4", "W1"], { soort: "USERDEFINED", objectType: "Lastverdeelvlak" });
    // (a) Een face gelijk aan het vlak: dezelfde vertices zonder het tussenpunt W5 en met een ander beginpunt.
    const g = m.geval("G vloer", { actie: "PERMANENT_G", bron: "DEAD_LOAD_G" });
    m.vlaklast(g, vloer, "Vlak gelijk", -2.0, { face: { hoeken: ["W1", "W2", "W3", "W4"] } });
    // (a) Dezelfde veelhoek als IfcPolyLoop met eigen punten, beginpunt W3, de andere draairichting,
    // het tussenpunt (3, 0) erin, een afwijking van 0,5 mm en een eigen plaatsing.
    const q = m.geval("Q vloer", { actie: "VARIABLE_Q", bron: "LIVE_LOAD_Q" });
    m.vlaklast(q, vloer, "Vlak gedraaid", -3.0, {
      plaatsing: gedeeld,
      face: { poly: true, hoeken: [[6, 4.0005, 3.6], [6, 0, 3.6], [3, 0, 3.6], [0, 0, 3.6], [0, 4, 3.6]] },
    });
    // (b) Een kleinere face (de linkerhelft) en een face met een opening die het vlak niet heeft.
    const deel = m.geval("Q deel", { actie: "VARIABLE_Q", bron: "LIVE_LOAD_Q" });
    m.vlaklast(deel, vloer, "Vlak deel", -4.0, { face: { hoeken: [[0, 0, 3.6], [3, 0, 3.6], [3, 4, 3.6], [0, 4, 3.6]] } });
    m.vlaklast(deel, vloer, "Vlak met gat", -5.0, {
      face: { hoeken: ["W1", "W2", "W3", "W4"], gaten: [[[2, 1, 3.6], [4, 1, 3.6], [4, 3, 3.6], [2, 3, 3.6]]] },
    });
    // Een eigen topologie zonder face (alleen een vertex): niet te lezen als vlaklast.
    const alleenVertex = w.ent("IFCPRODUCTDEFINITIONSHAPE", "$", "$", lijst([
      w.ent("IFCTOPOLOGYREPRESENTATION", `#${context}`, "'Reference'", "'Vertex'", lijst([m.knopen.get("W3").vertex]))]));
    m.vlaklast(deel, vloer, "Vlak zonder face", -6.0, { vorm: alleenVertex });
    // (c) Pendelstaven van een massieve rechthoek: plat (t ≤ b/4) in staal is trek-alleen, ook
    // precies op de grens; een gedrongen rechthoek niet; een rechthoek van hout blijft onbekend.
    const pendel = { soort: "PIN_JOINED_MEMBER", scharnieren: { begin: kogelscharnier, eind: kogelscharnier } };
    m.staaf("SP1", "V1", "W2", { ...pendel, profiel: profielen.rechthoek("Strip 80x10", 80, 10), materiaal: "S235", axis: [0, 1, 0] });
    m.staaf("SP2", "V2", "W1", { ...pendel, profiel: profielen.rechthoek("PL 10x80", 10, 80), materiaal: "S235", axis: [0, 1, 0] });
    m.staaf("SP3", "V3", "W4", { ...pendel, profiel: profielen.rechthoek("Staaf 60x30", 60, 30), materiaal: "S355", axis: [0, 1, 0] });
    m.staaf("SP4", "V4", "W3", { ...pendel, profiel: profielen.rechthoek("Strip 40x10", 40, 10), materiaal: "S235", axis: [0, 1, 0] });
    m.staaf("SP5", "V1", "W4", { ...pendel, profiel: profielen.rechthoek("Regel 100x200", 100, 200), materiaal: "C24", axis: [1, 0, 0] });
    m.toekennen(g.id, g.acties);
    m.toekennen(q.id, q.acties);
    m.toekennen(deel.id, deel.acties);
    m.afronden();
  }

  const kop = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [StructuralAnalysisView]'),'2;1');",
    `FILE_NAME('ifc-analyse-${eenheden.toLowerCase()}.ifc','2026-10-01T00:00:00',('Open FEM Studio'),('OpenAEC Foundation'),` +
      "'synthetisch testbestand','genereer-ifc-analyse.mjs','');",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
  ];
  return [...kop, ...w.regels, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}

// Als script: schrijf de twee vaste testbestanden naast dit bestand.
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const hier = dirname(fileURLToPath(import.meta.url));
  for (const eenheden of ["m-N", "mm-kN"]) {
    const pad = join(hier, `ifc-analyse-${eenheden.toLowerCase()}.ifc`);
    writeFileSync(pad, maakIfcAnalyseBestand({ eenheden }));
    console.log(`geschreven: ${pad}`);
  }
}
