#!/usr/bin/env node
/**
 * Regressierunner voor de solverbatterij.
 *
 * Twee standen, met verschillend bewijskarakter:
 *
 *   npm test           — alle `test-*.mjs` tegen de BRON, via `tsx`.
 *                        Dit bewaakt of de solver juist rekent.
 *   npm run test:bundel — de adaptertests tegen de gebundelde SIDECAR
 *                        (`assets/fem-kernel.mjs`), met kaal `node`.
 *                        Dit bewaakt of de bundel een getrouwe afgeleide van
 *                        de bron is, en of hij het zonder DOM, zonder Tauri en
 *                        zonder bundler daadwerkelijk doet.
 *
 * Waarom niet alle tests tegen de bundel draaien: dertien tests raken de
 * kern rechtstreeks (`Mesh`, `PlateRegion`, `Assembler`, `DKT`, `Quad4`,
 * `Triangle`, `Matrix`, `GaussElimination`), de zustand-store, of staan er
 * los van. Die horen op de bron te blijven — ze bewaken de kern, niet het
 * MCP-artefact. Ophogen door `PlateRegion` in de barrel te trekken mag NIET:
 * dat haalt `TriangleService` en daarmee `window.location.origin` de bundel
 * in, en het bundelscript keurt de bundel dan (terecht) af.
 *
 * Twee mechanische valkuilen die deze runner respecteert:
 *
 *  1. Testbestanden worden NIET naar een andere map gekopieerd. Fixturepaden
 *     worden relatief aan het testbestand opgelost — `test-checkconfig.mjs`
 *     leest `../voorbeelden/houten-raamwerk.ifcfem2d` via `import.meta.url`.
 *     Verplaatsen breekt dat stil. De herschreven kopie komt daarom NAAST het
 *     origineel te staan, met een naam die buiten `test-*.mjs` valt zodat hij
 *     nooit als testbestand wordt opgepikt.
 *  2. Het bundelpad gaat als `file://`-URL de import in. Een kaal
 *     `C:/...`-pad is op Windows geen geldige ESM-specifier; alle
 *     bundeltests vallen daarop om.
 *
 * Gebruik:
 *   node scripts/run-tests.mjs [--bundel] [--filter=<deel>] [--breed]
 *   OPEN_FEM_TEST_DIRECT_TSX=1 node scripts/run-tests.mjs [--filter=<deel>]
 *
 *   --bundel        draai de adaptertests tegen de sidecarbundel
 *   --filter=<deel> alleen tests waarvan de naam <deel> bevat
 *   --breed         toon de volledige uitvoer van elke test, ook bij succes
 */

import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const repoRoot = resolve(frontendRoot, "..");

const BUNDEL = join(
  repoRoot,
  "src-tauri",
  "crates",
  "openaec-mcp-server",
  "assets",
  "fem-kernel.mjs",
);

const TSX_CLI = join(frontendRoot, "node_modules", "tsx", "dist", "cli.mjs");

/** Voorvoegsel van de herschreven kopieën; valt buiten de `test-*.mjs`-glob. */
const KOPIE_PREFIX = ".bundelrun-";

/** Tijdslimiet per test. Ruim: `test-tweede-orde` start zelf drie subtests. */
const TIJDSLIMIET_MS = 300_000;
// De 3D-selectie-UI doorloopt vijftien aparte SwiftShader-browsers. In CI
// slaagden alle 87 controles, maar de test had 322 s nodig en werd daarna
// door de algemene grens afgebroken. Houd ook deze langzame test begrensd.
const SELECTIE_UI_TIJDSLIMIET_MS = 600_000;
// De P-Δ-test van de staalhal rekent 104 berekeningen met de debugbouw van de
// 3D-kern, die gedrukte staven voor de knik en de tweede orde in delen rekent
// (controle oktober 2026, K4). Alleen: 75 s; naast de rest van de batterij
// liep hij tot 228 s op, driekwart van de algemene grens. Eigen ruimere grens.
const STAALHAL_PDELTA_TIJDSLIMIET_MS = 600_000;
/** De tijdslimiet van één test: ruimer voor de bekende langzame tests. */
const tijdslimietVan = (naam) => naam === "open-fem3d-selectie-ui" ? SELECTIE_UI_TIJDSLIMIET_MS
  : naam === "open-fem3d-staalhal-pdelta" ? STAALHAL_PDELTA_TIJDSLIMIET_MS : TIJDSLIMIET_MS;

/**
 * De tests die tegen de bundel kunnen draaien: ze praten uitsluitend met de
 * adapterlaag (`engine`, `combinations`, de check-builders, `sectionResolver`,
 * `femTypes`, de windmodules en `projectFile`) — precies wat de barrel
 * ontsluit.
 */
const BUNDEL_TESTS = new Set([
  // #231: eigen gewicht uit in de MCP-modelvorm wordt gemeld (solve en check).
  "eigen-gewicht-mcp",
  // De API-commando's (src/api/) en hun weg door de sidecar (`api_catalogus`,
  // `api_uitvoeren`): de MCP-server voert ze zonder app uit via de bundel, dus
  // alles hoort ook daartegen te slagen.
  "api-schema", "api-document", "api-register", "api-model3d", "api-model3d-voorwaarden",
  "api-model3d-bewerken", "api-project", "api-stramien", "api-sidecar",
  "api-model3d-envelope-loads", "api-model3d-nbc2025-preview",
  // Plaatsen op een object (#76, #77): model3d.support.place en model3d.load.placePoint.
  "api-model3d-plaatsen",
  // #230: onbekend profiel/materiaal geweigerd bij model3d.beam.add/update.
  "api-model3d-doorsnede",
  // Staaf op bedding in 3D (issue #106): beam.add/update en beam.setBedding.
  "api-model3d-bedding",
  "api-model3d-panelen",
  // Plaat op bedding in 3D (issue #107): plate.add/update en plate.setBedding.
  "api-model3d-plaatbedding",
  // Selectiefilter (issue #94): model3d.selection.filter, id's in en uit, en `select` met een nagebootste app.
  "api-model3d-selectie",
  // Lijnlast in een globale richting (issue #80): model3d.load.member.add/update met globalDirection,
  // qStart/qEnd en perProjection, van lokaal naar globaal en terug.
  "api-model3d-globale-lijnlast",
  // Knopen op staven aansluiten (issue #63): model3d.beam.connectNodes, op knopen, staven of het hele model.
  "api-model3d-aansluiten",
  // Knopen samenvoegen (issue #75): model3d.nodes.merge, op knopen of het hele model, met een dubbele staaf en een weigering.
  "api-model3d-samenvoegen",
  // Verlopende 3D-staaf (issue #73): beam.add/update met profileNameEnd (null = prismatisch), de keuring van
  // bepaalVerloop, en splitsen: de gelaste tussendoorsnede reist met het document mee (eigenDoorsneden).
  "api-model3d-verlopend",
  // Het contract van extensies (manifest, importresultaat) en het draaien van
  // een extensiescript in Node: de MCP-server importeert zonder app via de bundel.
  "extensie-contract",
  "extensie-sidecar",
  // Belastinggevallen en combinaties tegen de NB-tabellen en de hand: de
  // afleiding van de standaardset (`normcombinaties`), het bijhouden bij
  // toevoegen/wijzigen/verwijderen (`combinatieBeheer`), de zijdelingse toets
  // (`steelCheckBuilder`) en de MCP-weg (`sidecar`). Alles staat in de barrel,
  // en juist de sidecar gebruikt deze afleiding voor zijn standaardset — dus
  // hoort hij ook tegen de bundel te bewijzen dat die dezelfde factoren geeft.
  "belastingcombinaties",
  // De stalen hal langs de MCP-weg: `staalhal_maken` en `staalhal_uitwerken`
  // in de sidecar, met de 3D-kern ertussen. Importeert alleen de barrel en
  // hoort juist tegen de bundel: die voert de MCP-server uit.
  "staalhal-sidecar",
  // De import van een IFC4-analysemodel langs de MCP-weg: `ifc_importeren` en
  // `ifc_uitwerken` in de sidecar, met de 3D-kern ertussen. Importeert alleen
  // de barrel; tegen de bundel bewijst hij dat de MCP-server hetzelfde model
  // inleest als de knop "Rekenmodel importeren" in de app.
  "ifc-analyse-sidecar",
  // w₁, de zakking onder alleen de blijvende belasting (NEN-EN 1990:2002/NB:2019
  // A1.4.3(2), figuur NB.1), voor hout en staal: de bouwers vullen
  // `deflection_permanent_mm` uit de BGT-combinatie met alleen G, melden het
  // als die ontbreekt, en de selectie laat die combinatie ook in een zuivere
  // staalconstructie staan. Praat met `engine`, `combinations`,
  // `combinatieSelectie`, `bouwMultiInput` en de twee bouwers — alles in de
  // barrel — en start toetsbrug en de MCP-server als apart proces. Hoort juist
  // óók tegen de bundel: laat de bundel w₁ of de combinatie vallen, dan krijgt
  // de w_add-toets via `check_fem_model` stil weer de volledige zakking.
  "blijvende-zakking",
  "checkconfig",
  "combinatieselectie",
  // Rekent een externe referentie-berekening na (twee houten liggerlijnen) en
  // raakt daarbij uitsluitend de adapterlaag: `engine`, `combinations`,
  // `sectionResolver` en de twee check-builders — precies wat de barrel
  // ontsluit. Juist deze verificatie hoort óók in de bundelstand: zij is de
  // proef dat de sidecar dezelfde krachtsverdeling geeft als de bron, tegen
  // getallen van buiten dit project.
  "dakconstructie-referentie",
  "doorbuiging-toets",
  // Het belastinggeval "Eigen gewicht" (issue #42): de regel welk geval het
  // eigen gewicht krijgt (`lib/eigenGewicht`, gelezen door `bouwMultiInput`),
  // het overzicht voor tekenvlak/tabel/rapport, het aanbod voor oude projecten
  // (`combinatieBeheer`), `valideerModel`, het projectbestand en de sidecar —
  // alles in de barrel. Hoort juist óók tegen de bundel: de MCP-weg moet het
  // kenmerk net zo lezen als de app, en een oud model zonder kenmerk daar net
  // zo bit-identiek rekenen. Het blok over de store leest bronbestanden van
  // schijf (de hook draait niet buiten React), wat in beide standen werkt.
  "eigen-gewicht-geval",
  // Een door tussenknopen geknipte staaf als één staaf naar de kern
  // (`lib/doorgaandeLijn.ts`), en de staafeinden (vrij, doorlopend). Praat
  // alleen met engine, combinations en de bouwers; hoort óók tegen de bundel
  // te draaien, want juist de MCP-weg toetste tot september 2026 elk deel los
  // en nam de tussenknoop als gaffel.
  "doorgaande-lijn",
  // De controle van oktober 2026 (K3, K5, B6, B7, B15) langs de app-route:
  // model uit testdata/controle-2026-10, engine, combinaties uit het bestand,
  // de twee bouwers en de echte kern via de toetsbrug, tegen de handwaarden.
  // Raakt alleen de barrel; hoort óók tegen de bundel, want juist de MCP-weg
  // (`check_fem_model`) mat de uitkraging vanaf de koorde.
  "controle-2026-10",
  // Doorgaande lijn met de knik per vak (controle oktober 2026, K6, #188, en de
  // review): de rand van een vakwerk met L_cr = knoopafstand (UC 0,278 tegen de
  // hand), kip en doorbuiging over de hele lijn (ligger met paal), een
  // scharnier, veer of plaat op de tussenknoop, hout, de UC van de kern, en
  // `check_fem_model` via de MCP-server. Praat met engine, combinations,
  // `bouwMultiInput` en de bouwers — alles in de barrel — en start toetsbrug en
  // de MCP-server; hoort juist óók tegen de bundel, want de MCP-weg bouwt de
  // toetsinvoer met dezelfde functies als de app.
  "vakwerk-kniklengte",
  // Scheefstand in beide richtingen: solveAllCases levert elk geval tweemaal,
  // metScheefstandRichtingen ontvouwt de combinaties en de omhullende neemt
  // de ongunstigste richting. Raakt alleen engine en combinations; de
  // MCP-weg gebruikt dezelfde ontvouwing, dus hoort dit ook tegen de bundel.
  "scheefstand-richting",
  // De kritieke lastfactor α_cr en de meldingen (basisaudit nr 27). Raakt
  // engine, combinations en alphaCr; de sidecar zet de FOUT in `warnings`,
  // dus hoort dit ook tegen de bundel.
  "alpha-cr",
  "hoekverdraaiing",
  // Bewaakt dat de kniklengte van een HOUTEN staaf tot in de toetsinvoer
  // komt (buckling_length_y_m/_z_m in TimberBeamCheckInput). Praat alleen met
  // `engine`, `combinations` en de twee check-builders — precies wat de
  // barrel ontsluit, dus hij kan óók tegen de sidecarbundel. Dat is hier de
  // bedoeling: als de bundel de kniklengte laat vallen, rekent de sidecar met
  // de volle systeemlengte terwijl de bron met de opgegeven steunafstand
  // rekent, en dat verschil hoort luid op te vallen.
  "hout-kniklengte",
  // Bewaakt dat de KIPSTEUNAFSTAND van een houten staaf tot in de
  // toetsinvoer komt (ltb_segment_length_m in TimberBeamCheckInput), en dat
  // de kipsteunfracties per flens hem nog steeds niet stilzwijgend vullen.
  // Praat alleen met `engine`, `combinations` en de houtbouwer — precies wat
  // de barrel ontsluit, dus hij kan óók tegen de sidecarbundel. Dat is hier
  // de bedoeling: laat de bundel dit veld vallen, dan rekent de sidecar de
  // kiptoets op de volle staaflengte terwijl de bron met de steunafstand
  // rekent, en dat scheelt in l_ef een factor die je in de UC terugziet.
  "hout-kipsteunafstand",
  // Bewaakt dat de drie houtkeuzen van de toetsconfiguratie — scheurfactor
  // k_cr (6.1.7), kiptoets aan/uit (6.3.3(5)) en het aangrijpingspunt van de
  // belasting (tabel 6.1) — tot in de toetsinvoer komen, en dat de veldpoort
  // (`keurCheckConfig`, ook die van `check_config` in `check_fem_model`)
  // onzin weigert. Praat met `engine`, `combinations`, de houtbouwer en
  // `valideerModel` — alle vier in de barrel. Hoort juist óók tegen de
  // bundel: laat de bundel een veld vallen, dan toetst de MCP-weg met de
  // standaard (k_cr 1,0, kiptoets aan) terwijl de bron de keuze van de
  // gebruiker volgt, en dat verschil hoort luid op te vallen.
  "hout-checkconfig",
  // De eindstijfheid E_mean,fin van hout in een gemengd, statisch onbepaald
  // model (EN 1995-1-1 2.2.3(5), 2.3.2.2): de bepaling, de eindtoestandvarianten
  // van de UGT-combinaties en de herverdeling tegen de handberekening. Praat met
  // `engine`, `combinations`, `bouwMultiInput`, `houtEindstijfheid` en de
  // in-proces sidecar — alles in de barrel. Hoort juist óók tegen de bundel:
  // laat de bundel de varianten vallen, dan toetst de MCP-weg het staal naast
  // weggekropen hout stil met de krachtsverdeling van E_mean.
  "hout-eindstijfheid",
  // De BGT-eindtoestand van hout (EN 1995-1-1 2.2.3(4), issue #23): w_qp,fin uit
  // de quasi-blijvende combinatie met E_mean,fin, tegen de handberekening voor
  // hout naast staal en naast beton met φ, en w_fin/w_add uit de kern. Praat
  // met `engine`, `combinations`, `bouwMultiInput`, `houtEindstijfheid`, de
  // staal- en houtbouwer en de in-proces sidecar — alles in de barrel — en
  // start toetsbrug en de MCP-server. Hoort juist óók tegen de bundel: laat de
  // bundel de BGT-eindtoestand vallen, dan toetst `check_fem_model` het hout
  // stil weer met de vereenvoudiging van 2.2.3(5).
  "hout-bgt-eindtoestand",
  "lastomschrijving",
  "leeg-geval",
  // De grootste verplaatsing boven het canvas (issue #32): knopen én de
  // veldkromme langs de staven, per geval, per combinatie en in de omhullende,
  // tegen 5qL⁴/384EI. Praat alleen met `engine` en `combinations` — in de
  // barrel. Hoort óók tegen de bundel: `check_fem_model` geeft
  // `maxDisplacement` door, en een bundel die alleen knopen telt meldt daar
  // weer 0 bij een doorbuigende ligger.
  "max-verplaatsing",
  "n-teken",
  "omhullende",
  // Oude projectbestanden en de windgenerator: herkennen en vervangen van de
  // standaardset van 0.3.11 bij het openen, ongedaan maken, de controles op
  // eigen combinaties en het meelopen van de gegenereerde windcombinaties —
  // tegen de hand. Praat met `combinatieBeheer`, `normcombinaties`,
  // `combinations`, `engine`, `bouwMultiInput`, de windgenerator, de
  // projectbestand-functies en de sidecar: allemaal in de barrel. Hoort juist
  // óók tegen de bundel: de MCP-weg leest `project_path` met dezelfde
  // `openCombinatieStaat`, en een bundel die nog "melden, niet overschrijven"
  // meedraagt, rekent een oud bestand stil met de oude factoren. Het slotblok
  // start de MCP-server als apart proces en faalt luid als die ontbreekt.
  // De normnaad: de nationale bijlage van het project reist door naar elke
  // toetsinvoer, en een bijlage die deze uitgave niet kent wordt geweigerd.
  // Praat uitsluitend met `sidecar` en `lib/normAanduidingen` — precies wat de
  // barrel ontsluit, dus hij hoort ÓÓK tegen de bundel te draaien: laat de
  // bundel het veld `bijlage` vallen, dan rekent de MCP-weg met de
  // standaardwaarde van de kern terwijl het project iets anders zegt, en dat
  // is precies de stille fout die deze naad moet voorkomen.
  "normnaad",
  "oude-projecten",
  "plaat-adapter",
  "plaat-combinatie",
  "plaat-polygoon",
  "plaat-project",
  // Randadressering, meshcache-randknopen en harde elementfouten van platen:
  // praat met `engine`, `femTypes`, `bouwMultiInput`, `valideerModel` en de
  // in-proces sidecar (`verwerkVerzoek`) — allemaal in de barrel. Hoort juist
  // óók tegen de bundel: de weigeringen moeten in het MCP-artefact net zo hard
  // zijn als in de bron, anders valt een last daar stil weg.
  "plaat-randadres",
  "plaat-randlast",
  // Deel- en trapeziumrandlasten, puntlasten op een plaatrand en staafeinden
  // die tussen twee randknopen op een plaatrand liggen (kinematische
  // koppeling): praat met `engine`, `combinations`, `bouwMultiInput`,
  // `valideerModel` en de in-proces sidecar — allemaal in de barrel. Hoort
  // óók tegen de bundel: het is de proef dat de MCP dezelfde knoopkrachten en
  // dezelfde koppeling rekent als de app.
  "plaat-randlasten",
  // Vierhoekmesher en openingen (stap 2): raster met Quad4/CST, de keuring
  // van een cache met vierhoeken, het rasterpad met rechthoekige openingen
  // (ook via de MCP zonder cache) en de O-grid-cache rond een 16-hoek. Praten
  // met `engine`, `femTypes`, `PlaatMesher` (pure kern, in de barrel),
  // `bouwMultiInput`, `valideerModel`, `projectFile` en de in-proces sidecar
  // — allemaal in de barrel. Horen juist óók tegen de bundel: de MCP moet een
  // opening precies zo meshen als de app, anders rekent de sidecar stil een
  // dichte wand.
  "plaat-vierhoeken",
  // Materiaalkeuze per plaat (stap 3): E, ν en ρ uit de materiaalnaam, de
  // richtingsafhankelijke stijfheid van hout en kruislaaghout, het eigen
  // gewicht ρ·t·A en de weigering van een onbekend materiaal. Praat met
  // `engine`, `femTypes`, `plaatMateriaal`, `sectionResolver`,
  // `bouwMultiInput` en `valideerModel` — allemaal in de barrel. Hoort juist
  // óók tegen de bundel: laat het MCP-artefact het materiaalveld vallen, dan
  // rekent de sidecar een houten wand stil met E = 210 000 in plaats van
  // 11 000/370, en dat is een factor dertig in de dwarsrichting. De
  // spiegeltest op de houttabellen leest src-tauri/.../data.rs van schijf;
  // de herschreven bundelkopie staat naast het origineel, dus dat pad blijft
  // kloppen.
  "plaat-materiaal",
  // Plaatspanningen in de MATERIAALASSEN (issue #14): σ₁/σ₂/τ₁₂ per element
  // en per combinatie uit `engine`, `combinations` en `plaatMateriaal` — alle
  // drie in de barrel. Hoort óók tegen de bundel: de sidecar rekent met
  // dezelfde engine, en een bundel die de omrekening laat vallen, levert
  // straks een houttoets met spanningen in de verkeerde assen.
  "plaat-materiaalassen",
  // G₁₂ van kruislaaghout als verplichte invoer met bron, of bewust de
  // bovengrens (issue #14): `plaatMateriaal`, `engine`, `valideerModel`,
  // `bouwMultiInput`, `houtEindstijfheid` en het projectbestand — alles in de
  // barrel. Hoort óók tegen de bundel: laat het MCP-artefact de G₁₂-plicht
  // vallen, dan rekent de sidecar een kruislaaghouten schijf stil met de
  // niet-gereduceerde bovengrens.
  "plaat-clt-g12",
  // ν₁₂ van hout en kruislaaghout (issue #14): de aanname ν₁₂ = 0 zichtbaar,
  // overschrijfbaar per plaat, en weigering bij ν₁₂·ν₂₁ ≥ 1. Praat met
  // `plaatMateriaal`, `engine`, `valideerModel`, `bouwMultiInput` en het
  // projectbestand — alles in de barrel — en leest fem_tools.rs van schijf
  // (de bundelkopie staat naast het origineel, dus dat pad klopt). Hoort óók
  // tegen de bundel: de sidecar moet dezelfde grens trekken als de app.
  "plaat-nu12",
  // Randlast en randpuntlast op een OPENINGSRAND: engine, mapping, poort,
  // sidecar (verwerkVerzoek), projectbestand en IFC-export — allemaal in de
  // barrel, en juist in de bundel van belang: de sidecar rekent de plaat met
  // opening zonder canvas, dus een adres dat daar stil op de omtrek zou
  // vallen, moet ook in de bundel weigeren.
  "plaat-opening-randlast",
  // Staafeinde op een OPENINGSRAND (issue #13): koppeling en evenwicht in
  // engine, weigering bij bijna-op-de-rand in engine en MCP-droogloop,
  // sidecar-solve en bit-identiek zonder zo'n staafeinde. De sidecar rekent
  // zulke platen zonder canvas; een staaf die in de bundel stil los zou
  // blijven, moet ook daar gekoppeld of geweigerd worden.
  "plaat-opening-staafeinde",
  // Plaattoets staal (issue #15): de bouwer `plaatCheckBuilder`, de in-proces
  // sidecar (`check` levert `plate_check_inputs`) — beide in de barrel — en de
  // echte kern via de toetsbrug als apart proces. Hoort óók tegen de bundel:
  // `check_fem_model` bouwt de plaatinvoer uit de bundel, en een bundel die
  // spanningen, dikte of materiaal verkeerd doorgeeft, toetst daar stil een
  // andere plaat dan de app.
  "plaat-toets-staal",
  // Plaattoets hout (issue #15, stap 2): bouwer via de in-proces sidecar
  // (hoofdrichting, klimaatklasse, belastingduur per combinatie), de modelpoort
  // (`valideerModel`) — alles in de barrel — en de kern via de toetsbrug. Hoort
  // óók tegen de bundel: laat de bundel de belastingduur of de hoofdrichting
  // vallen, dan weigert of toetst de MCP-weg een andere plaat dan de app.
  "plaat-toets-hout",
  // Plaattoets beton (issue #15, stap 3): bouwer via de in-proces sidecar en de
  // kern (bijlage F) via de toetsbrug. Hoort óók tegen de bundel: de MCP-weg
  // moet dezelfde spanningen doorgeven, anders klopt de benodigde wapening niet.
  "plaat-toets-beton",
  // De plaatbouwer staat in de barrel: onafhankelijke meshmetadata en
  // onvolledige UGT/BGT-resultaten moeten ook via de bundel behouden blijven.
  "betonwand-mesh",
  "plaat-openingen",
  "plaat-randstaaf",
  "plaat-validatie",
  "qrichting",
  "releases",
  // Verende staafaansluitingen: engine + bouwMultiInput, allebei in de barrel.
  "staafveren",
  "scheefstand",
  // De MCP-weg rekent φ met de normkeuze uit het bestand of het model, via
  // dezelfde afleiding als de app. Praat met `sidecar`, `projectFile` en
  // `valideerModel` — alle drie in de barrel. Hoort juist óók tegen de bundel:
  // een bundel die de normkeuze nog laat liggen, rekent hetzelfde bestand
  // met een andere horizontale kracht dan de app (gemeten: tot factor 1,94).
  "scheefstand-mcp",
  "sectie-doorvoer",
  // Toetst waar de adapter zijn rekenknopen legt (deellastgrenzen,
  // `extraSneden`, de samenvoegregel) en praat daarvoor uitsluitend met
  // `engine` — solve/solveAllCases, precies wat de barrel ontsluit. Hoort
  // juist óók in de bundelstand: het stationsraster is wat de sidecar naar
  // buiten geeft, dus als de bundel daar afwijkt van de bron, moet dat hier
  // opvallen.
  "sneden",
  // Singulier stelsel: dezelfde Nederlandse melding (knoop, richting, oorzaak)
  // op het raamwerkpad en op het gemengde pad. Praat alleen met `engine` en
  // `bouwMultiInput` — allebei in de barrel. Hoort juist óók tegen de bundel:
  // de MCP-weg geeft deze melding door aan de client, en een bundel die het
  // gemengde pad nog als "column 5" meldt, laat de gebruiker raden.
  "singulier-melding",
  // Staal herkennen aan de profieldatabase: elke sleutel van profiles.json
  // moet door `isSteelProfile` en `buildSteelCheckInputs`. Praat met de
  // staalbouwer, `engine` en `combinations` — alle drie in de barrel. Hoort
  // juist óók tegen de bundel: in de MCP-weg verdwenen de 160 profielen die de
  // oude voorvoegsellijst miste zonder spoor, dus als de bundel een oude
  // herkenning meedraagt moet dat hier opvallen.
  "staalherkenning",
  "staafsegmenten",
  "thermiek",
  "tweede-orde",
  "v2-stations",
  "validatie-mcp",
  // De controle van 12 oktober 2026 (issues #183, #184, #191, #193), elk tegen
  // de handberekening en met een slotblok tegen de gebouwde MCP-server:
  // `solve`/`check` weigeren met de modelcontrole van `validate` (K1), een
  // lijnlast met alleen qStart/qEnd is een trapezium (K2), een vakwerk met
  // alleen scharnierende staafeinden rekent (B10) en het veldmaximum van M en w
  // ligt tussen de stations (C8). Praten met `sidecar`, `valideerModel`,
  // `engine`, `combinations`, `combinatieBeheer`, `modelNaarSolverInput`,
  // `sectionResolver` en de staalbouwer — alles in de barrel. Horen juist óók
  // tegen de bundel: de MCP-weg rekent met de bundel, en precies daar viel een
  // last stil weg.
  "last-verwijzing-mcp",
  "trapeziumlast-zonder-q",
  "vakwerk-scharnieren",
  "veldmaximum",
  "veldzakking",
  // Modelcontrole, invoer en rekenroute (controle 26 oktober 2026): de
  // mechanismecontrole van `validate` vraagt de kern (#248), opleggingen per
  // vrijheidsgraad samenvoegen (#223), veren met k <= 0 weigeren (#222) en
  // bedding als steun (#246). Praten met `sidecar`, `valideerModel` en
  // `engine` — alles in de barrel. Horen óók tegen de bundel: de MCP-weg
  // valideert en rekent met de bundel.
  "mechanisme-raam",
  "dubbele-oplegging",
  "veer-stijfheid",
  "bedding-mechanisme",
  // Veldsgewijze plaatsing van veranderlijke vloerbelasting (#219): splitsen,
  // veldpatronen, omhullende en staalbouwer — alles in de barrel — en de
  // gebouwde MCP-server. Hoort ook tegen de bundel: de sidecar maakt de
  // varianten met dezelfde functies als de app.
  "veldsgewijze-plaatsing",
  // Verlopende profielen (deel 1): doorsnede op positie x, segmenten met A
  // en I, eigen gewicht per segment, de poorten en de in-proces sidecar.
  // Praat met `engine`, `sectionResolver`, `modelNaarSolverInput`,
  // `valideerModel`, `sidecar`, `referentierichting` en de
  // projectbestandfuncties — alles in de barrel. Hoort juist óók tegen de
  // bundel: de MCP-weg moet een verlopende staaf precies zo opdelen als de
  // app, anders rekent de sidecar stil prismatisch met het beginprofiel.
  "verlopend-profiel",
  // Verlopende profielen (deel 2): de TOETSING. Praat met `engine`,
  // `combinations`, `bouwMultiInput` en de twee toetsbouwers — alles in de
  // barrel — en start daarnaast toetsbrug en de MCP-server als apart proces.
  // Hoort juist óók tegen de bundel: `check_fem_model` bouwt de toetsinvoer
  // uit de bundel, en een bundel die `profile_end` of de eindmaten van een
  // houten staaf nog niet doorgeeft, toetst daar stil de BEGINdoorsnede over
  // de hele staaf.
  "verlopend-toetsing",
  "veren",
  "wind-generator",
  "wind-code-route",
  "wind-nbc2025-static",
  "wind-nbc2025-combinations",
  "wind-nbc2025-snow",
  "wind-nbc2025-heights",
  "wind-nbc2025-rectangular-plan",
  "wind-nbc2025-partial",
  "wind-pressure-balance",
  "wind-eurocode",
  // Vrijstaand dak (§7.3, tabel 7.6/7.7): praat alleen met de windmodules en
  // `engine` — alles in de barrel. Hoort óók tegen de bundel: de sidecar moet
  // dezelfde tabelcellen, zones en c_f-gevallen leveren, en de gebouwgevallen
  // moeten daar net zo bit-identiek blijven als in de bron.
  "wind-vrijstaand-dak",
  // Vrijstaand dak, uitbreiding (issue #16: wrijving, tabel 7.8, kolommen):
  // zelfde modules als hierboven. Tegen de bundel omdat de sidecar dezelfde
  // horizontale gevallen en ψ_mc moet leveren, en de bestaande gevallen daar
  // net zo bit-identiek moeten blijven.
  "wind-vrijstaand-uitbreiding",
  // Hellend dak van een gebouw (issue #49, tabel 7.3/7.4): praat alleen met
  // de windmodules en `engine` — alles in de barrel. Tegen de bundel omdat de
  // sidecar dezelfde tabelcellen, zones, deellasten en gevallen (+/−) moet
  // leveren als de app.
  "wind-hellend-dak",
]);

/**
 * Waarom de overige tests op de bron blijven. Expliciet opgeschreven zodat een
 * ontbrekende test in de bundelstand een gedocumenteerde keuze is en geen
 * vergeten regel.
 */
const ALLEEN_BRON = new Map([
  ["model-bouwen-lasten", "#215: de React-hook useFemStore (latestRef, pushHistory) rendert via react-dom/server; de hook en de bediening (`model_bouwen`) staan buiten de headless sidecarbundel"],
  ["open-fem3d-leeg-geval", "#245: de keuze van het getoonde 3D-resultaat (lib/openFem3dResultaatKeuze) en bronscans van App.tsx en de bediening (React/app-laag), plus i18next; niets uit de sidecarbundel"],
  ["oplegging-app", "#223/#222: de modelcontrole en rekenpoort van de app (lib/modelControle, lib/rekenPoort), de vertaling via i18next en de Rust-raamwerkroute (nativeFrame2DRoute); geen van die modules staat in de barrel. De MCP-kant staat in dubbele-oplegging en veer-stijfheid, die wél tegen de bundel draaien"],
  ["max-verplaatsing-netknopen", "#228: 2D-combinatie en omhullende via de bron (engine/combinations) en de 3D-samenvatting (openFem3dDisplacement, buiten de barrel) met de 3D-kernbinary als apart proces"],
  ["categorie-h-combinaties", "#237: leest alleen de combinatiegenerator (normcombinaties.ts) rechtstreeks; geen sidecarpad"],
  ["backstage-import-export", "#235: leest de bron van Backstage.tsx en App.tsx (React-UI), niets uit de sidecarbundel"],
  ["chs-profielnaam", "#240: de profielsleutel (lib/strip.ts) en de CHS-toets via de 3D-staalbouwer (openFem3dSteelCheck, buiten de barrel) en de toetsbrug als apart proces; de kern zelf staat in steel-check/tests/chs_naam_en_kip.rs"],
  ["staal-wringing", "#249: wringing 6.2.7 langs de 3D-staalbouwer (openFem3dSteelCheck, buiten de barrel) en de toetsbrug als apart proces; de toets zelf staat in steel-check/tests/wringing.rs"],
  ["vrij-eind-tweede-orde", "vrij staafeind, 2·L of L bij P-Δ met scheefstand: de 3D-houtbouwer (openFem3dTimberCheck) staat buiten de barrel; de MCP-weg (check_fem_model) rekent in deze test al met de bundel, via de MCP-server"],
  ["niet-getoetst-weergave", "B7: de weergave van een niet getoetste staaf zit in het HTML-rapport, de React-panelen en het 3D-rapport; die staan buiten de headless sidecarbundel (de MCP-kant toetst drie_wegen_controle_2026_10.rs)"],
  ["controle-2026-10-3d", "K5 in 3D: de houttoets en de verplaatsingsstations van de 3D-staaf (openFem3dTimberCheck, openFem3dDisplacement) staan buiten de barrel; de staaltoets in 3D en de 2D-bouwers lopen in de bundelstand mee via test-controle-2026-10"],
  ["open-fem3d-nbc2025-transfer", "de 3D-overdrachtsproef start de afzonderlijke Rust-kern"],
  ["wind-zone-report-2d", "React-rapportweergave en projectbestandsopslag staan buiten de headless sidecarbundel"],
  ["wind-pressure-report-2d", "2D-rapportherkomst staat buiten de headless sidecarbundel"],
  ["wind-2d3d-parity", "de 3D-schilgeometrie staat buiten de headless sidecarbundel"],
  ["wind-roof-2d3d-parity", "de 3D-dakzonering staat buiten de headless sidecarbundel"],
  ["wind-pitched-2d3d-parity", "de 3D-zadeldakzonering staat buiten de headless sidecarbundel"],
  // Een Web Worker bestaat alleen in de browser, niet in de MCP-sidecar.
  ["extensie-worker-ui", "de echte browser-worker met tijdslimiet en foutafhandeling"],
  ["extensie-beheer", "de winkel van de desktop-app met nagebootste Tauri-commando's en lokale voorkeuren"],
  // De 3D-proeven raken React/Three, de projectadapter of de aparte Rust-kern.
  // Deze modules zitten niet in de 2D-sidecarbundel.
  ...[
    "open-fem3d-analysis-mode", "open-fem3d-analysemodulus", "open-fem3d-wheel-anchor", "open-fem3d-staalhal", "open-fem3d-staalhal-generator", "open-fem3d-knooppaneel", "open-fem3d-meldingen", "open-fem3d-modelvelden", "open-fem3d-scheefstand", "open-fem3d-kipsteunen", "open-fem3d-rapportsamenvatting", "open-fem3d-staalgewicht", "open-fem3d-opleggingsteken", "open-fem3d-model-api", "open-fem3d-eigen-doorsnede", "open-fem3d-gedraaide-hoofdassen", "open-fem3d-beam-screen-pick", "open-fem3d-box-selection", "open-fem3d-campus-frame", "open-fem3d-trek-schijf",
    // Belastingvlakken: afdracht en vlakmeetkunde, en de browsertest (tekenen
    // op het werkvlak, doorzichtig vlak, klikken door het vlak heen).
    "open-fem3d-belastingvlak", "open-fem3d-belastingvlak-ui",
    "open-fem3d-schilpanelen", // IFC, Three en 3D-weergave zitten buiten de sidecarbundel.
    // Schillastgeneratoren en zonering (#68) gebruiken 3D-geometrie buiten de MCP-barrel;
    // het API-pad wordt afzonderlijk in beide standen getest.
    "open-fem3d-binnendruk", "open-fem3d-daklasten", "open-fem3d-generatie-toepassen",
    "open-fem3d-nbc2025-wind", // Toepasser, modelparser en 3D-vlakkrachten zitten buiten de sidecarbundel.
    "open-fem3d-gevelwind", "open-fem3d-hellend-dakwind", "open-fem3d-platdakwind",
    "open-fem3d-portaal-2d-wind", "open-fem3d-schilzones", "open-fem3d-sneeuwcoefficienten",
    "open-fem3d-windgenerator", "open-fem3d-windzones",
    "open-fem3d-wind-pressure-report", // React-rapport en 3D-herkomsthelper zitten buiten de headless sidecarbundel.
    "open-fem3d-concrete-check", "open-fem3d-conditions", "open-fem3d-conversion",
    // Momentvast en Scharnierend voor de eindscharnieren van een staaf.
    "open-fem3d-eindscharnieren",
    // Scharnier aan één staafeind, liggers scharnierend op kolommen en waar
    // de scharnierbolletjes komen (issue #93).
    "open-fem3d-staafeinden",
    "open-fem3d-current", "open-fem3d-displacement", "open-fem3d-force-stations",
    "open-fem3d-history", "open-fem3d-knoopgereedschap", "open-fem3d-large-frame", "open-fem3d-layers", "open-fem3d-levels", "open-fem3d-member-load", "open-fem3d-mm-invoer",
    // Peilmaten bij de levels in 3D (issue #92): tekst, plaats, dunning en de
    // zichtbaarheid los van het stramien; en het echte tekenvlak in de browser
    // (hoek per kijkrichting, niet over staven, in beeld na passend beeld).
    "open-fem3d-peilmaten", "open-fem3d-peilmaten-ui",
    "open-fem3d-plates-views", "open-fem3d-platen", "open-fem3d-profile-geometry", "open-fem3d-report-views",
    "open-fem3d-selectie", "open-fem3d-selectie-ui", "open-fem3d-momentlijn",
    // Trek-alleen en schijven in de echte onderdelen (headless browser).
    "open-fem3d-trek-schijf-ui",
    // Knikfactor met staven in vier delen (controle oktober 2026, K4, #186): de
    // modellen van de controle langs de rekenweg van de app naar de aparte
    // Rust-kern, en de MCP-aanroepen naar de MCP-server.
    "open-fem3d-knik-onderverdeling",
    // Montage van trek-alleen staven na de permanente belasting, kruisregel en
    // kabelwerking van hun eigen gewicht (verzoekopbouw, Rust-kern, bediening).
    "open-fem3d-montage",
    "open-fem3d-steel-check", "open-fem3d-transform", "open-fem3d-utilization", "open-fem3d-vervormd",
    // Kopiëren met basispunt en doelpunt: de stap (bronpunt, doelpunt, tolerantie, eindige getallen) met de
    // kopie zelf; en het echte tekenvlak en lint in de browser (uitleg per stap, rubberband, één stap, aansluiten
    // op de doelknoop, Esc, eerst kiezen zonder selectie, en het lint Start compact als het met namen niet past).
    "open-fem3d-copy-points", "open-fem3d-copy-points-ui",
    // De tab Views (standaard- en eigen views, rapportbeelden) en zijn browsertest.
    "open-fem3d-views", "open-fem3d-views-ui",
    // De view cube: doelen, lintconventie, CSS-matrix en slepen (issue #85).
    "open-fem3d-view-cube",
    // Perspectief of parallel (issue #85, deel B): omrekening, schaal, raycastafstand, wielstap, pannen,
    // knopen achter elkaar (de voorste wint) en de muisstraal op het werkvlak.
    "open-fem3d-projectie",
    // Waarden bij de snedekrachtlijnen (issue #95): de standen weinig … veel, stand 3 = de oude regel,
    // monotoon, selectie, Waarden uit, views en de bedrading (de browserproef zit in open-fem3d-selectie-ui).
    "open-fem3d-diagram-labels",
    // Grootte van knopen en opleggingen (issue #82): begrenzen, standaard, oude opslag en views, maat × schaal,
    // rapportbeeld en bedieningskanaal; en het echte tekenvlak in de browser (200 % = twee keer zo groot, kiezen).
    "open-fem3d-symboolschaal", "open-fem3d-symboolschaal-ui",
    // Plaatweergave volume, vlak of mesh (issue #78): overname van de oude schakelaar mesh in opslag en views,
    // geometrie per stand, elementlijnen op het middenvlak, kanaal en MCP-schema, en het echte tekenvlak in de
    // browser (dikte per stand, kiezen, snel pad ook met plaatbatches, keuzegroep en lint).
    "open-fem3d-plaatweergave", "open-fem3d-plaatweergave-ui",
    // Plaatsen op een object (issues #76 en #77): oplegging, veer en puntlast op een knoop (snapzone), staaf
    // (splitsen; puntlast op de plek) of plaat (knoop in het middenvlak, rekennet), één stap ongedaan maken; en het
    // echte tekenvlak in de browser (klikken naast een knoop, midden op een staaf, op een plaat; lint en paneel).
    "open-fem3d-plaatsen", "open-fem3d-plaatsen-ui",
    // Tekenhulpen van het 3D-tekenvlak (issue #84): objectspoor (uitlijnen, snijpunt, verlengen, loodrecht,
    // parallel), voorrang, Alt, Shift als ortho, directe lengte-invoer, de snapinstelling Objectspoor en de
    // prestatie in een hal; en het echte tekenvlak met statusbalk en tab Weergave in de browser.
    "open-fem3d-tekenhulp", "open-fem3d-tekenhulp-ui",
    // Staaf op bedding in 3D (issue #106): keuren, zetten en weghalen, het verzoek, de uitkomst (gronddruk,
    // contact, zakking, rapport, krachtensom), het bedieningskanaal en de echte kern; de eigenschappen, de band
    // en de laag Gronddruk in de browser; en van eind tot eind een funderingsbalk door de rekenweg van de app en
    // de echte kern, vergeleken met de vrije balk op bedding (Hetényi), met tekenvlak en rapport in de browser.
    "open-fem3d-bedding", "open-fem3d-bedding-ui", "open-fem3d-bedding-e2e",
    // Plaat op bedding in 3D (issue #107): keuren, zetten en weghalen, de versie, het verzoek, het tributaire
    // oppervlak, de uitkomst (gronddruk en zakking als plaatgrootheid, contact, rapport, krachtensom), de arcering,
    // het bedieningskanaal en de echte kern door de rekenweg van de app; en de eigenschappen, de arcering in de drie
    // plaatweergaven, de contour Gronddruk, de keuzelijst en het rapport in de browser.
    // Van eind tot eind: een vloer op zand door de rekenweg van de app en de echte kern, met de contour, de
    // stippen zonder contact en het rapport in de browser (een oude bouw van de kern faalt met die melding).
    // Een begane-grondvloer van 10 × 6 m met twee kolomlasten door de app en de kern, vergeleken met q/k,
    // het evenwicht en Westergaard + Hertz; ook met een wand zonder opleggingen; contour en rapport in de browser.
    "open-fem3d-plaatbedding", "open-fem3d-plaatbedding-ui", "open-fem3d-plaatbedding-e2e", "open-fem3d-plaatbedding-vloer",
    // Section box (issue #86): de doos om model en selectie, binnen/buiten (punt, staaf, plaat, lijn), slepen,
    // clipping planes en grepen, opslag en views, kanaal en MCP-schema, rapportbeeld en kader; en het echte
    // tekenvlak in de browser (menu, een vlak slepen, niet zichtbaar en niet kiesbaar buiten de doos, kader, snap).
    "open-fem3d-section-box", "open-fem3d-section-box-ui",
    // Explodeweergave (#104): Three.js, rapportbeeld en live app-commando;
    // de geometrie blijft buiten de reken-sidecar en wordt alleen getekend.
    "open-fem3d-explode",
    // Rapporttabellen gebruiken UI-rapportmodules; themacontrast leest CSS.
    // Beide horen bij de bron en niet bij de reken-sidecar.
    "open-fem3d-rapport-omhullenden", "thema-tekstcontrast",
    // Lijnlast in een globale richting (issue #80): keuren, oude bestanden, bewerken, het verzoek, de
    // versie, krachtensom, scheefstand, de pijlen en de projectielijn, de echte kern; het lastpaneel, de
    // pijlrichting en het rapport in de browser; en van eind tot eind een schuine spant onder sneeuw per
    // projectie door de rekenweg van de app en de echte kern: reacties, M, V en de N-lijn tegen de hand.
    "open-fem3d-globale-lijnlast", "open-fem3d-globale-lijnlast-ui", "open-fem3d-globale-lijnlast-e2e",
    // Eigen gewicht langs de staafas als verdeelde last (issue #112): een staande kolom, een schuine spant en een
    // verlopende kolom door de rekenweg van de app en de echte kern; de N-lijn op elk punt tegen de hand.
    "open-fem3d-eigen-gewicht-e2e",
    // Tweede orde (P-Δ) van de stalen hal uit de wizard (issue #60): elk geval en elke standaardcombinatie, ook met
    // scheefstand ±X/±Y, een lessenaarsdak, een plat dak en een balkrooster, door de rekenweg van de app en de echte
    // kern: convergent, stabiel, ΣR gelijk aan de handsom en de onafhankelijke krachtensom (104 berekeningen; alleen
    // ongeveer 75 s, in de batterij tot bijna 4 min, eigen grens 600 s). Sinds de kern gedrukte staven in delen rekent
    // (controle oktober 2026, K4) weigert de stabiliteitspoort bij "Wind langs (W) leidend" in de standaardhal terecht
    // 3 (met scheefstand 8) berekeningen: de wandverbanden knikken zelf (α_cr < 1); de test eist dat waar de hand het
    // voorspelt.
    "open-fem3d-staalhal-pdelta",
    // Opmaak van het lastpaneel (issue #108): letter, maat, contrast en velden als het eigenschappenpaneel, licht en donker.
    "open-fem3d-lastpaneel-ui",
    // Knopen op staven aansluiten (issue #63): de zuivere functie (vier delen, lasten per deel, scharnieren,
    // knoop naast de as, staafeinde, bereik, automatisch na een bewerking, één stap, modelcontrole, melding,
    // instelling en bedrading); het echte tekenvlak, de modelcontrole, de tab Weergave en het lint in de
    // browser; en van eind tot eind een funderingsbalk met losse kolomvoeten: aangesloten tegen met de hand
    // gesplitst door de rekenweg van de app en de echte kern (op opleggingen en op bedding).
    "open-fem3d-aansluiten", "open-fem3d-aansluiten-ui", "open-fem3d-aansluiten-e2e",
    // Knopen samenvoegen (issue #75): de zuivere functie (platen, staven van lengte 0, dubbele staven in beide
    // richtingen met hun lasten, opleggingen, schijven, levels, 2 × de tolerantie, automatisch na een bewerking,
    // modelcontrole, melding en bedrading); de kaart, het lint, tekenen en verplaatsen in de browser; en de echte
    // kern: een dubbele staaf samengevoegd tegen dezelfde staaf dubbel op dezelfde knopen en met de hand overgezet.
    "open-fem3d-samenvoegen", "open-fem3d-samenvoegen-ui", "open-fem3d-samenvoegen-e2e",
    // Verlopende profielen in 3D (issue #73): keuren, oude bestanden, versie 6, het verzoek (n en de doorsnede per
    // deel gelijk aan 2D), eigen gewicht en staalgewicht per deel, kiezer, 2D → 3D, splitsen en samenvoegen,
    // toetsinvoer, profielkleuring, twee ringen, IFC, veldzakking, de wizard Stalen hal en de echte kern; het volume
    // met twee ringen, kiezen en de profielkiezer in de browser; en de 3D-staaltoets van een verlopende staaf tegen
    // de 2D-staaltoets met dezelfde krachten (toetsbrug); en van eind tot eind een verlopende ligger, een verlopend
    // portaal en de stalen hal uit de wizard door de rekenweg van de app, de echte kern en de toetsbrug, tegen de
    // 2D-rekenkern en de 2D-toets, met tekenvlak en rapport in de browser.
    "open-fem3d-verlopend", "open-fem3d-verlopend-ui", "open-fem3d-verlopend-toets", "open-fem3d-verlopend-e2e",
    // Hout in 3D (#72): dezelfde GL24h-ligger door twee onafhankelijke
    // rekenwegen, invoerbouwers en de echte EN 1995-toetsbrug.
    "open-fem3d-hout-pariteit",
  ].map((name) => [name, "3D-app, Three-weergave of aparte Rust-kern; geen module van de 2D-sidecarbundel."]),
  [
    "selectiefilter",
    "de zuivere kern van het selectiefilter (issue #94) met de 3D- en 2D-adapter, de 3D-groepsselectie met lasten en het verwijderen ervan: de modules zelf staan niet in de barrel (alleen het commando, dat test-api-model3d-selectie in beide standen bewaakt), en de 2D-adapter hoort bij het tekenvlak",
  ],
  [
    "selectiefilter-ui",
    "het echte venster Selectiefilter (React, CSS) in een lokale headless browser, in 3D en in 2D: kiezen, telling, Toepassen en Annuleren. React en de DOM bestaan in de sidecarbundel niet",
  ],
  // De 3D-proeven raken React/Three, de projectadapter of de aparte Rust-kern.
  // Deze modules zitten niet in de 2D-sidecarbundel.
  ...[
    "frame3d-analysis-mode", "frame3d-box-selection", "frame3d-campus-frame",
    "frame3d-beam-screen-pick", "frame3d-concrete-check", "frame3d-conditions", "frame3d-conversion",
    "frame3d-current", "frame3d-displacement", "frame3d-force-stations",
    "frame3d-history", "frame3d-large-frame", "frame3d-member-load",
    "frame3d-plates-views", "frame3d-profile-geometry", "frame3d-report-views",
    "frame3d-steel-check", "frame3d-steel-models", "frame3d-transform", "frame3d-utilization",
    "frame3d-3584-volume-project", "frame3d-large-membrane-project", "frame3d-large-volume-project",
    "frame3d-member-equivalent-loads", "frame3d-membrane-volume-app-route",
    "frame3d-bending-volume-app-route", "frame3d-volume-app-route",
    "frame3d-volume-batching", "frame3d-volume-body-loads", "frame3d-volume-concrete-3072-app-route",
    "frame3d-volume-example", "frame3d-volume-face-loads", "frame3d-volume-finite-j2-3072-app-route",
    "frame3d-volume-finite-j2-app-route", "frame3d-volume-finite-j2-truss-3072-app-route",
    "frame3d-volume-finite-j2-truss-app-route", "frame3d-volume-gnl-app-route",
    "frame3d-volume-material-app-route", "frame3d-volumes", "mixed3d-irregular-app", "mixed3d-workbench",
    // Ook uit cf107758, daar nog niet geplaatst: dezelfde 3D-app- en Rust-kernroute.
    "frame3d-gl24h-app-route", "frame3d-volume-diagrams", "frame3d-volume-finite-j2-dkt-app-route",
  ].map((name) => [name, "3D-app, Three-weergave of aparte Rust-kern; geen module van de 2D-sidecarbundel."]),
  // Deze routes toetsen de getypeerde native-fem-client, de Rust-dispatcher
  // en de app-adapters. De sidecarbundel bevat alleen de TypeScript 2D-kern.
  ...[
    "native-fem-client", "native-frame2d-app-route", "native-frame2d-comparison",
    "native-frame3d-app-route", "native-frame3d-comparison",
    "native-frame3d-plate-app-route", "native-plate-bending-comparison",
    "native-plate2d-comparison", "native-prestressed-beam-route",
    "native-quad2d-app-route", "native-quad2d-comparison",
    "native-three-layer-adapter", "native-three-layer-combination",
    "native-triangle2d-app-route",
    "native-volume3d-app-route", "native-volume3d-j2-app-route",
    "native-volume3d-concrete-damage-app-route", "native-volume3d-gnl-app-route",
    "native-volume3d-finite-j2-app-route",
    "frame3d-volume-finite-j2-membrane-app-route",
    "frame3d-volume-finite-j2-membrane-force-app-route",
    "frame3d-volume-finite-j2-plastic-membrane-app-route",
    "frame3d-volume-plastic-truss-app-route",
    "frame3d-volume-finite-j2-plastic-truss-3072-app-route",
    "native-frame2d-large-front-route", "native-frame3d-large-front-route",
    "native-geometric-shell-adapter", "native-hybrid-plate-fiber-app-route",
    "native-hybrid-plate-layered-app-route", "native-mixed2d-sparse-app-route",
    "native-mixed3d-app-route", "native-prestressed-beam-crack-width",
    "native-volume-hex8-app-route",
    "frame3d-1120-beam-app-route", "frame3d-coupled-hex-frame-grid-app-route",
    "frame3d-volume-finite-j2-hex-mixed-app-route",
    "frame3d-volume-finite-j2-hex-nonaffine-512-app-route",
    "frame3d-volume-finite-j2-full-frame-app-route",
    "frame3d-volume-finite-j2-frame-line-app-route",
    "frame3d-volume-finite-j2-frame-g-app-route",
    "saved-project-native-solve-matrix",
    "verification-project-files",
  ].map((name) => [name, "Rust-native FEM-dispatcher of app-adapterroute; geen TypeScript-sidecarkern."]),
  ["browser-settings-store", "Browser- en voorkeurenopslag van de app; geen module van de 2D-sidecarbundel."],
  ["aluminium-materiaal", "Materiaalbibliotheek en doorsnedeadapter buiten de sidecarbarrel."],
  ["aluminium-solver-verificatie", "Bouwt het model met modelNaarSolverInput, buiten de sidecarbarrel."],
  ["aluminium-voorspanning-verificatie", "Aluminium- en voorspancontrole buiten de sidecarbarrel."],
  ["drie-lagen-beton-verificatie", "Specifieke betontoets buiten de sidecarbarrel."],
  ["ifc-3d", "3D-projectopslag en IFC-export buiten de sidecarbarrel."],
  [
    "ifc-analyse-import",
    "de import van een IFC4-analysemodel tegen de BRON: de STEP-lezer, de vertaling naar het 3D-model (knopen, staven, scharnieren, schijven, belastingvlakken, gevallen, combinaties, levels), de afdracht van de belastingvlakken, het projectbestand en de 3D-kern als apart proces. Hij leest daarnaast de generator van de testbestanden in docs/verificatie. De MCP-weg van dezelfde import staat tegen de bundel in `ifc-analyse-sidecar`",
  ],
  ["toets-resultaat-3d", "3D-toetsresultaatcontract buiten de 2D-sidecarbarrel."],
  ["beton-bediening-ui", "React-interactie voor wapeningsselectie, sleepvoorbeelden en doorsnedebediening in Chromium; geen sidecarcode."],
  ["reken-ui", "React-interactie voor resultaatselectie, meldingen en het toetsingspaneel; geen sidecarcode."],
  ["staalhal-wizard-ui", "React-interactie van de wizard Stalen hal in Chromium (stappen, mm-invoer, voorbeeld, meldingen); de generator zelf draait ook in de bundel via staalhal-sidecar."],
  ["ifc-import-ui", "React-interactie van \"Rekenmodel importeren\" in Chromium (knop op het IFC-tabblad, keuzevenster, vraag bij niet-opgeslagen werk, verslag, foutmelding); de import zelf draait ook in de bundel via ifc-analyse-sidecar."],
  ["rekengang-generatie", "Asynchrone rekenregie van de app met afgeschermde React- en native IO-grenzen; niet beschikbaar in de sidecarbundel."],
  ["beton-tooltips", "Leest KorfVelden.tsx en ProfielKiezer.tsx als bron: waar de uitleg staat (tooltip of tekst); geen solvercode en niet in de sidecarbundel."],
  ["lijnlast-pijlen", "Pijlafstand van lijnlasten op het 2D-tekenvlak en de bron van FemCanvas; geen solvercode en niet in de sidecarbundel."],
  ["html2canvas-ui", "DOM-schermafbeelding met html2canvas en color-mix in Chromium (bedieningskanaal en feedback); geen solvercode en niet in de sidecarbundel."],
  ["tekenhulp", "Tekenhulpen van het 2D-tekenvlak (#53): ortho, hoeksnap en de bewaarde snapinstellingen, plus de bron van FemCanvas en de tab Weergave; geen solvercode en niet in de sidecarbundel."],
  ["last-waarde", "Een lastwaarde intypen (komma, punt, min-teken, eenheid) voor het q-veld op het tekenvlak en het paneel; geen solvercode en niet in de sidecarbundel."],
  ["fs-scope", "Leest de Tauri-capability en de bestandsroutes van de app; geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["staaf-dialoog-config", "Configuratielogica van de staafdialoog; geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["aansluiting-standaard", "Aansluitingskeuze van een staafeinde (React-component en i18n); geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["toon-mm", "Weergave van lengtes in het windvenster; geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["commando-reeks", "Toetsreeksen van het tekenvlak (MV, CO) en de kopieerregel voor lasten; geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["kader-selectie", "Kaderselectie (venster/crossing) en de Escape-regel van het 2D- en 3D-tekenvlak (lib/kaderSelectie, lib/escapeToets), plus bronteksttoetsen op tekenvlakken en thematokens; weergavelogica buiten de barrel, de sidecar selecteert niets."],
  ["kaderselectie-ui", "Het echte 2D-tekenvlak (FemCanvas) met de echte modelstore in een lokale headless browser: crossing- en vensterkader, Escape uit het gereedschap en Delete op een plaat met ongedaan maken. React, DOM en CSS bestaan in de sidecarbundel niet; geen server en geen rekenkern."],
  ["klik-op-last", "Klikgedrag van het tekenvlak op lasten; geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["weergave-model", "Weergavelogica van de tabbalk (Model sluit de resultaten); geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["undo-route", "Sneltoetsgedrag van de app (Ctrl+Z vanuit een invoerveld); geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["api-dekking", "Legt de dekking van de 3D-bediening door de API (src/api/dekking.ts) tegen de bediening zelf: tekent het 3D-lint (React, i18n in cimode) en leest de knoppen van het eigenschappenpaneel en de sneltoetsen uit de bron. React-onderdelen en bronbestanden zitten niet in de sidecarbundel; de commando's zelf draaien daar wel, in test-api-*."],
  ["api-adapter", "De API-commando's in de draaiende app (src/bediening/apiAdapter.ts): welk commando welke app-actie aanroept (3D-bewerking als één stap, gevallen via de store, Openen voor de rest, ongedaan maken en opslaan). De app-adapter zit niet in de sidecarbundel; de commando's zelf draaien daar wel, in test-api-*."],
  ["selecteer-bij-focus", "Invoergedrag van de app (focus selecteert de waarde); geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["tauri-plugin-versies", "Vergelijkt package-lock.json met Cargo.lock en leest App.tsx; geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["extern-openen", "De helper openExternal in src/lib/tauri.ts (#38) met de echte opener-plugin en een nagebootste IPC-grens en window.open: terugval buiten Tauri en bij een geweigerde plugin, geen onafgehandelde rejection. Webview-glue; geen solvercode en niet in de sidecarbundel."],
  ["bestandskoppeling", "Bestandskoppeling (#90): de interfacekant die een door het besturingssysteem aangereikt pad naar de bestaande open-weg brengt, met een nagebootste Rust-kant, plus broncontroles op App.tsx, tauri.conf.json en src-tauri/src/lib.rs. Geen solvercode en niet in de sidecarbundel; de Rust-kant toetst src-tauri/tests/bestandskoppeling.rs."],
  ["bestandskoppeling-recent", "Bestandskoppeling (#90): de echte useRecentFiles en useBestandskoppeling in React in Chromium, met de native IPC-grens nagebootst; meerdere paden in één ophaalronde komen alle in de recente bestanden. Geen solvercode en niet in de sidecarbundel."],
  ["mcp-koppeling-ui", "Een AI-assistent koppelen (#109): het paneel Instellingen → AI-assistent (MCP) in React in Chromium (schakelaar, status, pad van de MCP-server, Toevoegen aan Claude Desktop, opdracht voor Claude Code, JSON-fragment, vier talen, lint en tabblad), met de native IPC-grens nagebootst, plus broncontroles op lib.rs, gui_control.rs en mcp_koppeling.rs. Geen solvercode en niet in de sidecarbundel; de Rust-kant toetsen src-tauri/tests/gui_kanaal.rs en mcp_koppeling.rs."],
  ["eigen-gewicht-ui", "Echte tabbalk en tekenvlak (React, CSS, thema's) in Chromium met het geval \"Eigen gewicht\" (issue #42); geen solvercode en niet in de sidecarbundel. De rekenkant bewaakt test-eigen-gewicht-geval in beide standen."],
  ["window-controls","Echte React-titelbalk en native IPC-grens in Chromium, met de Tauri-windowcapability; geen solvercode en niet beschikbaar in de sidecarbundel."],
  ["beton-ui", "Echte React-interactie, async-resultaatverversing en containerlayout in Chromium; geen solverwijziging."],
  ["plaat-wapening-ui", "React/CSS-browsertests voor bereikbare wandwapeningsvelden, veldvalidatie en responsieve indeling."],
  ["mm-invoer-ui", "Interactietests van echte React-formulieren in een lokale headless browser; geen server of solver."],
  ["mm-invoer", "Lengte-invoer aan de UI-grens, bestaande opslageenheden en labels in vier talen; geen solverwijziging."],
  ["plaat-plooi", "Controleert de expliciete veldinvoer, geometriepoort, projectserialisatie en strikte MCP-validatie rechtstreeks op de bron."],
  ["plaat-wapening", "UI-rendering, projectroundtrip, MCP-poort en betonwandbouwer"],
  ["pendelstaaf", "raakt kerninterne klassen (Assembler, Matrix)"],
  [
    "lastwaarde-modelcontrole",
    "de app-kant van de controle van 12 oktober 2026 (K1, K2, C8): de modelcontrole en de rekenpoort van de app (lib/modelControle, lib/rekenPoort), de vertaling van de nieuwe meldingen via i18next en de momentenlijn van het tekenvlak (FemResultsOverlay, react-dom/server). Geen van die modules staat in de barrel; de MCP-kant van dezelfde punten staat in last-verwijzing-mcp, trapeziumlast-zonder-q en veldmaximum, die wél tegen de bundel draaien",
  ],
  ["plaat-dkt", "raakt kerninterne klassen (Mesh, PlateRegion, DKT)"],
  ["plaat-ids", "raakt kerninterne klassen (Mesh, PlateRegion)"],
  ["plaat-lasten", "raakt kerninterne klassen (Mesh, PlateRegion, PlateLoads)"],
  ["plaat-mixed", "raakt kerninterne klassen (Mesh, PlateRegion, NonlinearSolver)"],
  [
    "tweede-orde-platen",
    "toetst de geometrische stijfheid van de wandschijven op matrixniveau en bouwt zijn modellen met Mesh + PlateRegion; Triangle, Quad4 en PlateRegion staan bewust niet in de barrel (PlateRegion zou TriangleService en window.location de bundel in trekken). Het engine-pad dat hij aan het eind wél aanroept, is daar niet los van te knippen",
  ],
  [
    "trek-alleen",
    "trek-alleen staven in 2D (issue #234): naast engine, combinaties en de sidecar (in de barrel) ook de projectserialisatie (io/projectFile), α_cr en de Rust 2D-raamwerkroute (nativeFrame2DRoute met de native-frame2d-binary) — die staan niet in de barrel. De MCP-kant (valideerModel, sidecar solve) wordt in-proces op de bron getoetst; het schema in fem_tools.rs bewaakt de Rust-test schema_beams_spiegelt_de_staafpoort_van_de_sidecar",
  ],
  [
    "bedding",
    "toetst de staaf op bedding door de adapter en de projectserialisatie (io/projectFile, lib/modelNaarSolverInput) — die twee staan niet in de barrel; de engine-kant zelf zit erin, maar de test is één geheel",
  ],
  [
    "solverlog",
    "leest het solverlogboek uit de zustand-store en geeft de kern rechtstreeks een onLog-callback; de store hoort niet in de barrel en de sidecar zet juist géén opvanger — tegen de bundel zou deze test dus het tegenovergestelde bewijzen van wat hij moet bewaken",
  ],
  ["plaat-schijf", "raakt kerninterne klassen (Triangle, Quad4, GaussElimination)"],
  [
    "plaat-orthotroop",
    "meet de materiaalmatrix zelf (core/fem/Triangle.getConstitutiveMatrix met core/math/Matrix): kerninterne code die bewust buiten de barrel blijft. De uitkomsten ervan worden wél tegen de bundel bewezen, in test-plaat-materiaal",
  ],
  [
    "oplossers",
    "vergelijkt de twee stelseloplossers rechtstreeks (Matrix, GaussElimination, SkylineSolver, LinearSolver); die staan bewust niet in de barrel",
  ],
  ["deellast", "test de zustand-store, niet de solver"],
  ["puntlast-positie", "test de zustand-store, niet de solver"],
  ["splitsen", "test de zustand-store, niet de solver"],
  [
    "verlopend-splitsen",
    "splitst een verlopende staaf met `computeBeamSplitOpKnoop` uit de zustand-store en met de bibliotheek van eigen doorsneden; geen van beide staat in de barrel, en de sidecar splitst ook niets — tegen de bundel zou deze test dus niets bewaken. De solver dient er alleen als bewijs dat het splitsen geen enkel getal verandert",
  ],
  ["stramien-verplaatsen", "test de zustand-store, niet de solver"],
  ["transform", "test de zustand-store, niet de solver"],
  [
    "lasten-kopieren",
    "test de store-logica voor het kopiëren van lasten tussen belastinggevallen; de solver dient er alleen als eindcontrole",
  ],
  [
    "modelcontrole",
    "test de modelcontrole en de herstelbewerkingen in de store; de acceptatieproef gebruikt de solver alleen als eindcontrole",
  ],
  [
    "verbindingstolerantie",
    "de instelbare verbindingstolerantie van het 2D-model (#55): modelcontrole (lib/modelControle), rekenpoort, plaatsen en herstellen in de zustand-store, de snapinstellingen, i18n en de bron van FemCanvas, App.tsx en de tab Weergave. Geen van die modules hoort in de barrel; de MCP-poort houdt zijn eigen exacte drempel",
  ],
  ["ifc-export", "staat los van de solver (IFC-export)"],
  ["ifc-spiegel", "staat los van de solver (IFC-export spiegelt het model)"],
  ["profieleditor-snap", "test de objectsnap van de profieleditor, niet de solver"],
  ["oude-profielen", "controleert de overgetypte profieltabellen tegen de doorsnedemotor, niet de solver"],
  [
    "hoeklijnen",
    "houdt de hoeklijnreeksen (L-profielen) in profiles.json en in de gegenereerde TS-tabellen tegen de gedrukte profieltabel, en controleert de as-afspraak van NEN-EN 1993-1-1 1.7(2) (lang been langs z, hoofdassen u-u/v-v) plus de tekenvorm. Hij leest profiles.json rechtstreeks als bronbestand en importeert de tekenmodule; de solver en de barrel komen er niet aan te pas",
  ],
  [
    "rond-staal",
    "massief rond staal (reeks RD) over de hele keten: de aliassen (`lib/rondStaal.ts`, de spiegel van de Rust-lookup), resolveSection, de 3D-rekenroute (`openFem3dSolver`, I_z en J) en de 3D-staaltoets (`openFem3dSteelCheck`), de profielkiezer (`profieleditor/catalogus`, `profielZoeken`), de tekenvorm (`profielVorm`) en de IFC-export, plus de toetsbrug als apart proces voor de toets op het draadeind. De 3D-modules, de kiezer, de tekening en de IFC-export staan niet in de 2D-sidecarbundel; de bundelkant van de herkenning bewaakt `staalherkenning`, die elke catalogussleutel — ook RD — door isSteelProfile en de staalbouwer haalt",
  ],
  [
    "strip",
    "platstaal (reeks Strip) over de hele keten: de aliassen (`lib/strip.ts`, de spiegel van de Rust-lookup), resolveSection, de 3D-rekenroute (`openFem3dSolver`, I_z en J) en de 3D-staaltoets (`openFem3dSteelCheck`), de profielkiezer (`profieleditor/catalogus`, `profielZoeken`), de tekenvorm (`profielVorm`) en de IFC-export, plus de toetsbrug als apart proces voor de trektoets. De 3D-modules, de kiezer, de tekening en de IFC-export staan niet in de 2D-sidecarbundel; de bundelkant van de herkenning bewaakt `staalherkenning`, die elke catalogussleutel — ook de strips — door isSteelProfile en de staalbouwer haalt",
  ],
  [
    "csp-wasm",
    "leest src-tauri/tauri.conf.json rechtstreeks en controleert dat het CSP WebAssembly toestaat; raakt de solver noch de barrel, en de sidecar heeft geen CSP",
  ],
  [
    "unp-tabel",
    "houdt de UNP-reeks in profiles.json en de gegenereerde TS-tabellen tegen de gedrukte profieltabel; leest die twee bestanden rechtstreeks en raakt de solver noch de barrel",
  ],
  ["profieleditor-lassen", "test de schuifstroom per lasnaad uit de doorsnedemeetkunde, niet de solver"],
  ["profieleditor-transform", "test het verplaatsen en roteren in de editor, niet de solver"],
  ["clt-builder", "test de invoerbouwer voor de houttoetsing, niet de solver"],
  [
    "doorbuigingsnoemer",
    "issue #9: een doorbuigingsnoemer van 0 of kleiner wordt geweigerd. Raakt de MCP-modelkeuring `keurCheckConfig` (src/mcp, niet in de barrel) en start de toetsbrug en de MCP-server als apart proces voor de echte EN 1993- en EN 1995-kern; tegen de bundel zou de test juist de kernen overslaan die de weigering doen. De sidecarweg zelf loopt mee in het slotblok via `check_fem_model`",
  ],
  [
    "hout-zeeg",
    "issue #252: de zeeg in de netto eindzakking van hout. Bouwt de houtinvoer uit de bron en start de toetsbrug als apart proces voor de EN 1995-kern",
  ],
  [
    "clt-w-add",
    "issue #210: w_add = w₂ + w₃ met w₃ per BGT-combinatie voor kruislaaghout. De CLT-bouwer staat niet in de barrel, en de kern draait in de toetsbrug als apart proces",
  ],
  [
    "clt-rolschuif",
    "issue #232: de rolschuiftoets van kruislaaghout met een gedeclareerde f_v,rol,k. De CLT-bouwer en de modelkeuring staan niet in de barrel, en de kern draait in de toetsbrug als apart proces",
  ],
  [
    "clt-doorbuiging",
    "de doorbuigingstoets van kruislaaghout met een opgegeven k_def (tabel 3.2 kent er geen): de CLT-bouwer staat niet in de barrel, dus de bouwerkant kan alleen tegen de bron. De bundelweg is er wél in afgedekt: het slotblok stuurt hetzelfde model door `check_fem_model` van de gebouwde MCP-server, en die bouwt de CLT-invoer uit de sidecarbundel",
  ],
  [
    "hout-kmod-combinatie",
    "leidt de belastingduur per UGT-combinatie af (lib/belastingduur) en bouwt daarmee de hout- en CLT-invoer; de afleiding en de CLT-bouwer staan niet in de barrel, en het slotblok start de toetsbrug als apart proces voor de echte EN 1995-kern (k_mod 0,60 bij alleen G, UC 1,068). De sidecarweg van dezelfde afleiding bewaakt hout_in_check_fem_model.rs tegen de gebouwde MCP-server",
  ],
  [
    "clt-opbouwen",
    "test de bibliotheken van eigen CLT-opbouwen en eigen doorsneden: de winkels op localStorage, het samenvoegen bij het openen van een project en wat er in een projectbestand terechtkomt. Dat is invoerbeheer van de frontend — de solver komt er niet aan te pas en de winkels horen niet in de barrel",
  ],
  [
    "clt-voorinstellingen",
    "houdt de gegenereerde CLT-voorinstellingen tegen de Rust-kern aan: hij leest clt.rs als BRONBESTAND en importeert de generator uit scripts/ — allebei staan ze buiten de barrel, en tegen de bundel zou hij juist de generatiestap overslaan die hij moet bewaken",
  ],
  ["spanning-builder", "test de invoerbouwer voor de spanningstoets, niet de solver"],
  [
    "rapportpdf-invoer",
    "zet de stores om naar de invoer van de PDF-uitdraai (`lib/rapportPdfInvoer`) — rapportagelogica van de frontend die de solver niet raakt en dus niet in de barrel hoort",
  ],
  [
    "rapport-gereedheid",
    "toetst het klaar-signaal en de weigerregels van de PDF-export via het bedieningskanaal: de leesbare toestand van de inhoudsopgave (`components/report/toc`), de gereedheid van de paginering (`components/report/rapportGereedheid`), de kop van één export (`components/report/useProjectInfo`) en de oordelen van `bediening/rapportVoorwaarden`, plus een bronteksttoets op App.tsx en bediening.ts. Rapport- en bedieningslogica van de frontend — de solver komt er niet aan te pas en geen van die modules hoort in de barrel",
  ],
  [
    "bediening-wachten",
    "issue #28: toetst dat geen opdracht van het bedieningskanaal (`bediening/bediening.ts`) op een React-render wacht die niet komt als de opdracht niets verandert. Bedieningslogica van de frontend met nagebootste acties plus een bronteksttoets; de solver komt er niet aan te pas en de module hoort niet in de barrel",
  ],
  [
    "rapport-verloop-reden",
    "issue #30: rendert het verloopblok van het live rapport (`components/report/sections/CheckDetailSection`) met react-dom/server en toetst de cascade van CHECK_REPORT_CSS plus de layout in een headless Chromium-browser. Presentatielogica van de frontend; de solver komt er niet aan te pas en de module hoort niet in de barrel",
  ],
  [
    "sectierelevantie",
    "beoordeelt welke RAPPORTSECTIES een model kan vullen — presentatielogica van de frontend die niets met de solver of de sidecar te maken heeft en dus niet in de barrel hoort; de test leest bovendien de sectieregistry als bronbestand",
  ],
  ["plaat-gewicht", "vraagt een extra kernmodule (PlateLoads)"],
  [
    "plaat-toets-weergave",
    "rendert de plaatkaart van het toetsingspaneel en de rapportsectie \"Toetsing platen\" met react-dom/server, gevoed met een kernantwoord van de toetsbrug (apart proces). React en de stylesheets bestaan in de sidecarbundel niet, en paneel en rapport horen niet in de barrel; de bundelkant van de plaattoets staat in `plaat-toets-staal`",
  ],
  [
    "plaat-openingen-store",
    "test de modelcontrole (lib/modelControle) en het meereizen van openingen bij verplaatsen, roteren, spiegelen en kopiëren in de zustand-store; geen van beide hoort in de barrel",
  ],
  [
    "plaat-opening-randlast-doorvoer",
    "test de doorvoer van een last op een openingsrand BUITEN de rekenkern: de modelcontrole van het canvas (lib/modelControle) en de IFC-export (io/ifcExport). Geen van beide staat in de barrel; de rekenkant van hetzelfde adres — evenwicht, weigeringen in engine en MCP-poort, bit-identiek zonder openingen — staat in `plaat-opening-randlast` en draait wél tegen de bundel",
  ],
  [
    "plaat-opening-staafeinde-controle",
    "test de modelcontrole van het canvas (lib/modelControle) voor een staafeinde op of bijna op een openingsrand: geen vals vrij uiteinde, en de fout of waarschuwing bij 1–50 mm. De module staat niet in de barrel (de MCP-droogloop gebruikt de regel alleen intern via valideerModel); de rekenkant en de droogloop staan in `plaat-opening-staafeinde` en draaien wél tegen de bundel",
  ],
  [
    "materiaal-dubbelzinnig",
    "bewaakt dat een korte naam als \"C30\" overal hout is en nooit stil beton (basisaudit nr 16); leest daarvoor de modelcontrole (lib/modelControle) en de betonstijfheidslus (lib/betonStijfheid), die allebei buiten de barrel staan",
  ],
  ["modelmapping", "vergelijkt de bronmapping met een gouden JSON"],
  [
    "fysisch-nietlineair",
    "drijft de lus uit lib/betonStijfheid, die de Rust-rekenkern nodig heeft en dus niet in de barrel hoort; het echte-kernblok start de toetsbrug als apart proces en wordt luid overgeslagen als die binary ontbreekt",
  ],
  [
    "beton-kruip",
    "bewaakt β van (7.19) per combinatiesoort en de kruipcoëfficiënt in de fysisch niet-lineaire betonstijfheid: drijft de lus uit lib/betonStijfheid (buiten de barrel), leest App.tsx als bronbestand voor de doorvoer, en start de toetsbrug als apart proces voor de vergelijking met de handberekening — dat blok wordt luid overgeslagen als de binary ontbreekt",
  ],
  [
    "kolomtoets",
    "de §5.8-invoer van een betonnen kolom: de gevallen van figuur 5.7 uit components/beton/kolomgegevens, de doorvoer via korvenUitStaven (een zustand-store) en betonCheckBuilder — inclusief de φ(∞,t₀) van het project uit lib/kruipcoefficient, vergeleken met lib/betonStijfheid en met App.tsx en checkStore als bronbestand gelezen — en een blok dat de toetsbrug als apart proces aanroept. Twee van die drie modules staan buiten de barrel — het korfmodel en de store — en de Rust-kern hoort er sowieso niet in, dus tegen de sidecarbundel zou de test juist de laag overslaan die hij moet bewaken",
  ],
  [
    "kolom-eerste-orde",
    "r_m, λ_lim en φ_ef van de betonkolomtoets uit de eerste-orde-momenten na een tweede-orde-berekening (issue #35): de eerste-orde-cache in de engine en lib/eersteOrdeResultaten, de doorvoer via korvenUitStaven (een zustand-store), betonCheckBuilder en de (5.19)-stap uit lib/betonStijfheid (buiten de barrel), App.tsx, checkStore en variantStore als bronbestand, en een blok dat de toetsbrug als apart proces aanroept en tegen de handberekening legt. De store en de stijfheidslus staan buiten de barrel en de Rust-kern hoort niet in de sidecarbundel",
  ],
  [
    "kruip-bijlage-b",
    "φ(∞,t₀) volgens bijlage B van projectinvoer tot kolomtoets en BGT-stijfheid: de voorrangsregel en de kernaanroep uit lib/kruipcoefficient, de doorvoer via korvenUitStaven (een zustand-store) en lib/betonStijfheid (buiten de barrel), projectFile, rekenInstellingen en App.tsx als bronbestand, en een blok dat de toetsbrug als apart proces aanroept en tegen de handberekening legt. De Rust-kern hoort niet in de sidecarbundel, en de store en de stijfheidslus staan buiten de barrel",
  ],
  [
    "dubbele-buiging",
    "dubbele buiging bij kolommen (art. 5.8.9): `maakZConsistent` uit components/beton/kolomgegevens (buiten de barrel), de modelpoort uit mcp/valideerModel voor de drie velden om de z-as, en een blok dat de toetsbrug als apart proces aanroept en de imperfectie van art. 5.2, de grens van (5.38a) en de exponent a van (5.39) met de hand narekent. De Rust-kern hoort niet in de sidecarbundel, en de twee frontendmodules staan buiten de barrel",
  ],
  [
    "sidecar",
    "start de sidecar als eigen proces — en draait daarin zelf al bron én bundel",
  ],
  [
    "golden",
    "spreekt de bundel rechtstreeks als proces aan; herschrijven zou hem juist van het gouden artefact afhalen",
  ],
  [
    "beff-liggerlijn",
    "leidt de liggerlijn van 5.3.2.1 uit de modeltopologie af (knopen, staven, opleggingen); dat is invoerbouw voor de betontoetsing en geen solverwerk, dus hij hoort niet in de barrel",
  ],
  [
    "profiel-zoeken",
    "de zoekfunctie van de profielkiezer (`lib/profielZoeken`, issue #39): term → treffers per reeks over de hele staalcatalogus, ongevoelig voor hoofdletters en spaties, oude reeksen onderaan, en welke al gebruikte profielen in welke stap horen. Presentatielogica van de frontend zonder rekenwerk; de module en de profieleditor-catalogus staan niet in de barrel, en de test leest daarnaast ProfielKiezer.tsx, de stylesheet en de vier locales van schijf",
  ],
  [
    "profiel-zoeken-ui",
    "de echte ProfielKiezer in Chromium: focus in het zoekveld bij openen, pijltjes/Enter/Esc, de lege toestand, \"In dit project\" in de staal- en houtstap, het verlopende profiel en een smal venster. React-interactie en CSS-indeling; geen solvercode en niet beschikbaar in de sidecarbundel",
  ],
  [
    "profielvarianten",
    "kiest naburige doorsneden uit de profieldatabase en de handelsmatenlijst en bouwt daarmee toetsinvoer; dat is invoerbouw en geen solverwerk, en de korfcontrole die hij meeneemt hoort niet in de barrel",
  ],
  [
    "beton-doorsnede",
    "test de profielnaam-grammatica en het korfmodel van de betontoetsing; alleen de solverstijfheid daarvan (resolveSection) zit in de barrel, de rest is invoerbouw en tekenmeetkunde",
  ],
  [
    "betonfiguren-referentie",
    "legt de tekenmeetkunde van wapeningskorf.ts naast de gedeelde referentie die de Rust-kant óók leest (src-tauri/crates/report/tests/golden/betonfiguren-referentie.json); tekenwerk in plaats van solverwerk, en de referentie ligt buiten de bundel",
  ],
  [
    "dekking-per-zijde",
    "test het korfmodel van components/beton/wapeningskorf.ts met een eigen dekking en milieuklasse per betonoppervlak (4.4.1.1(1)P): de nuttige hoogte per trekzijde, de staafposities, s_t en de korfcontrole. Dat is invoerbouw en tekenmeetkunde van de frontend — de solver komt er niet aan te pas en wapeningskorf zit niet in de barrel van de sidecarbundel",
  ],
  [
    "cltmeetkunde-referentie",
    "legt de CLT-mechanica van cltCheckBuilder.ts (zwaartelijn, (EI)_ef, I_ef,net, de opbouw van I_y per laag en de bemonstering van het τ-verloop) naast de gedeelde referentie die de Rust-kant óók leest (src-tauri/crates/report/tests/golden/cltmeetkunde-referentie.json); die referentie is een bronbestand buiten de bundel, en de test importeert daarnaast TIMBER_E_MEAN uit sectionResolver om de tweede E-tabel te toetsen — rapport- en tekenwerk, geen solverwerk",
  ],
  [
    "doorsnede-kleur",
    "rendert ProfielMiniatuur én DoorsnedeTekening met react-dom/server en rekent de composietkleur na uit themes.css en ProfielKiezer.css; React en losse stylesheets bestaan in de sidecarbundel niet, en er komt geen rekenwerk aan te pas",
  ],
  [
    "bgvloer-referentie",
    "legt een betonnen plaatstrook uit een externe referentie-berekening naast de hele keten: hij bouwt de toetsinvoer met `lib/betonCheckBuilder` én `stores/checkStore` (de toetsstore valt buiten de barrel) en start de toetsbrug als apart proces voor de echte EN 1992-toetsing; zonder die binary faalt hij luid",
  ],
  [
    "startmodel",
    "bewaakt het model waarmee de app opent (`hooks/useFemStore`): samenstelling, opleggingen, evenwicht en toetsbaarheid. Hij leest de React-hook en de toetsstore, die allebei buiten de barrel van de sidecarbundel vallen, en stubt de staalprofieldatabase omdat die uit de Rust-kern komt",
  ],
  [
    "snedetekens",
    "rendert de resultatenoverlay met react-dom/server en meet de RICHTING van de afschuif- en buigtekens in de gerenderde SVG; dat is canvasweergave in plaats van solverwerk, en React bestaat in de sidecarbundel niet",
  ],
  [
    "korftekening",
    "rendert DoorsnedeTekening met react-dom/server en meet de LIGGING van de beugel en de staven terug uit de gerenderde SVG (schaal uit de omtrek, staafharten in millimeters, ligt-de-staaf-in-de-polygoon); tekenwerk in plaats van solverwerk, en React bestaat in de sidecarbundel niet",
  ],
  [
    "dekkingsvenster",
    "het betonvenster onderin: het zonemodel (de TS-spiegel van ReinforcementZones), de afleiding van de vier lagen, en AanzichtTekening gerenderd met react-dom/server waaruit de LIGGING van de trapjes en van het rode tekortvak in millimeters wordt teruggemeten. Drie redenen om op de bron te blijven: React bestaat in de sidecarbundel niet, het korf- en zonemodel van de frontend zit niet in de barrel, en het laatste blok start de toetsbrug als apart proces voor de echte EN 1992-uitkomsten",
  ],
  [
    "unp-flenshelling",
    "meet het oppervlak van de GETEKENDE contour van de U-profielen tegen de cataloguswaarde, om vast te leggen dat een UNP taps toeloopt en een UPE niet; tekenmeetkunde in plaats van solverwerk, en de contourfuncties zitten niet in de barrel",
  ],
  [
    "i18n-talen",
    "leest alleen de JSON-taalbestanden en config.ts van schijf en importeert geen enkele bronmodule; de bundelstand heeft er dus niets in te toetsen, en de runner weigert terecht een test zonder ./src-import",
  ],
  [
    "i18n-rekenlabels",
    "legt vast dat de labels uit .ts-bestanden (femTypes, dekkingLagen, lib/profieleditor) i18n-sleutels zijn die in nl/en/de/fr bestaan en in en/de/fr geen Nederlands zijn; dekkingLagen, de profieleditor-bibliotheek en de locales zitten niet in de barrel, en de test rendert via i18next, dat in de sidecarbundel niet bestaat",
  ],
  [
    "i18n-meldteksten",
    "legt vast dat meldingen en labels uit .ts-bestanden (verlopend profiel, windgenerator, modelcontrole bij plaatlasten, eindstijfheid hout, combinatieselectie, profieleditor, korf- en zonecontrole, scheefstand) in de interface via i18n lopen en dat hun Nederlandse vertaling letterlijk de Nederlandse tekst van het .ts-bestand is (issue #33). Hij rendert via i18next en leest locales en .tsx-bronnen van schijf; i18next, de locales, de profieleditor-bibliotheek, de betonkorf en de windlabels zitten niet in de barrel. De Nederlandse meldingen die de sidecar zelf teruggeeft, bewaken de bestaande bundeltests",
  ],
  [
    "i18n-vaste-tekst",
    "scant de .tsx-bronbestanden met de TypeScript-parser op vaste Nederlandse teksten in JSX; hij importeert geen enkele bronmodule en rekent niets, dus de bundelstand heeft er niets in te toetsen (en de runner weigert terecht een test zonder ./src-import)",
  ],
  [
    "projectbestand",
    "serialiseert en leest het projectbestand terug (io/projectFile) en zet de rapportinstellingen in de zustand-store; projectFile en de rapportstore staan niet in de barrel",
  ],
  [
    "wind-schema",
    "rendert de doorsnede- en plattegrondtekening van het windvenster met react-dom/server en leest de staven, pijlen en maten terug uit de SVG; tekenwerk, en React bestaat in de sidecarbundel niet",
  ],
  [
    "wind-voorbeeld",
    "legt vast dat het voorbeeld in het windvenster bij de invoer op het scherm hoort (issue #29): `lib/wind/windVoorbeeld` is presentatielogica van het venster en staat niet in de barrel, en de test leest daarnaast de aansluiting in WindGeneratorDialog.tsx en stores/windStore.ts van schijf. De generator zelf staat al tegen de bundel in `wind-generator` en `wind-vrijstaand-dak`",
  ],
  [
    "inp-flenshelling",
    "hetzelfde voor de I-profielen: de getekende INP-contour (14 %, tf op b/4 vanaf de tip) tegen de cataloguswaarde, en een IPE die evenwijdig blijft; tekenmeetkunde, niet in de barrel",
  ],
  [
    "rapportnormen",
    "bepaalt welke normen het rapport mag noemen (`lib/normenInRapport`) uit de uitgangspunten, de toetsresultaten en de materialen in het model — presentatielogica van de frontend die de solver niet raakt en dus niet in de barrel hoort",
  ],
  [
    "hout-eigen-doorsnede",
    "legt de terugval van `resolveSection` vast: een HOUTEN staaf met een eigen doorsnede (profielnaam met het voorvoegsel EIGEN) kreeg stilzwijgend HEA 160 / S235, dus E = 210 000 in plaats van 11 000. De test zet daarvoor een doorsnede in de winkel `profieleditor/eigenDoorsnedenStore` — een localStorage-winkel die net als de CLT-opbouwen buiten de barrel valt — en gaat verder door `lib/modelNaarSolverInput` (ook niet in de barrel, zie het bedding-punt hierboven) en `lib/timberCheckBuilder`. Tegen de sidecarbundel zou hij juist de winkel overslaan waar de doorsnede vandaan moet komen",
  ],
  [
    "dekkingslijn",
    "legt de hele keten van de dekkingslijn vast: de zonegrenzen uit `lib/betonZoneSneden` worden rekenknopen via `bouwMultiInput`, de zones reizen door `lib/betonCheckBuilder` en `lib/betonDekkingslijnBuilder` naar de kern, en het slotblok start de toetsbrug als apart proces voor het echte `concrete_dekkingslijn`. Hij leest daarvoor `stores/checkStore` (de toetsstore) en de twee invoerbouwers, en die vallen alle drie buiten de barrel van de sidecarbundel; tegen de bundel zou hij juist de aansluiting overslaan die hij moet bewaken. De solverkant van hetzelfde mechanisme — `extraSneden` als zodanig — staat in `test-sneden` en draait wél tegen de bundel",
  ],
  [
    "rapport-gevuld",
    "loopt de hele rapportketen van het model tot een gezette PDF: `lib/rapportPdfInvoer` en `lib/scheefstandNorm` (rapportagelogica van de frontend), de toetsstore `stores/checkStore` voor de korven, en twee Rust-binaries als apart proces — de toetsbrug voor `check_concrete_beams` en `concrete_dekkingslijn`, en de MCP-server voor `generate_steel_report_pdf`. Geen van die vier hoort in de barrel van de sidecarbundel, en tegen de bundel zou de test juist de rapportlaag overslaan die hij moet bewaken; de solverkant die hij aanroept (`bouwMultiInput` + `solveAllCases`) staat al in `test-sneden` en `test-scheefstand`",
  ],
  [
    "scheefstand-norm",
    "rekent φ uit volgens EN 1993-1-1 (5.5), EN 1992-1-1 (5.1) en EN 1995-1-1 (5.1) en leidt h en m uit het model af (`lib/scheefstandNorm`). Dat is een PROJECTINSTELLING van de frontend: de gebruiker kiest de norm, en de sidecar krijgt het resultaat gewoon als getal (`scheefstandNoemer`) binnen. De module zit daarom niet in de barrel — de motorkant van dezelfde zaak (H = φ·V) staat in `test-scheefstand`, en die draait wél tegen de bundel",
  ],
  [
    "niet-uitgevoerd",
    "legt het overzicht \"Niet uitgevoerd\" onder het toetsingsoverzicht van het live rapport vast: `lib/nietUitgevoerd` (rapportagelogica van de frontend), een bronteksttoets op `CheckTableSection` en de vertalingen. Geen van die bestanden staat in de barrel; de PDF-kant met een echte uitkomst van de betonkern staat in report/tests/niet_uitgevoerd_pdf.rs",
  ],
  [
    "maatgevend",
    "issue #41: welke toets maatgevend is, in welke combinatie en op welke positie. Test `lib/maatgevend` (weergavelogica van het toetsingspaneel en het live rapport) en `stores/maatgevendMarkeringStore` (zustand), rendert de React-blokken van het paneel, doet een bronteksttoets op paneel, plaatkaart, rapportsectie en App.tsx, leest de vertalingen en start de toetsbrug als apart proces voor een echt antwoord van de staal- en de houtkern. Geen van die modules staat in de barrel van de sidecarbundel; de sidecar toont niets en kent geen paneel",
  ],
  [
    "maatgevend-ui",
    "issue #41: het toetsingspaneel in een echte browser (headless Chromium): modeloverzicht, samenvattingsregel per kaart, de toetslijst met balkjes, de keuze van de volgorde en de klik naar het tekenvlak, plus de regel in het toetsingsoverzicht van het live rapport en de markering op het tekenvlak (die lezen uit een zustand-store, en die geeft bij renderen op de server de beginstand terug). Bundelt `components/panels/CheckPanel` met esbuild en vult `stores/checkStore` met een vaste uitslag; React, de DOM en die store bestaan in de sidecarbundel niet",
  ],
  [
    "rapport-datum",
    "issue #20: de datum voluit en in de taal van de app op titelblad en paginakop van het live rapport. Test `lib/rapportDatum` en `lib/rapportPdfInvoer` (rapportagelogica van de frontend) plus een bronteksttoets op `ReportShell` en `sections/ProjectSection`, en leest de gedeelde proeftabel van report/tests/datum_kop_pdf.rs. Geen van die modules staat in de barrel; de PDF-kant staat in die Rust-test",
  ],
  [
    "staafnummer-hergebruik",
    "bewaakt dat niets wat aan een staafnummer hangt meeverhuist naar een nieuwe staaf met hetzelfde nummer: de rapportkeuze `verborgenToetsStaven` (`stores/reportStore`), de focus van het toetsingspaneel (een bronteksttoets op het effect in App.tsx) en de toetsstore `stores/checkStore` (zustand) met een nagebootste, vertraagde rekenkern. Geen van die modules staat in de barrel, en React-effecten bestaan in de sidecar niet",
  ],
  [
    "verouderd",
    "bewaakt dat resultaten en toetsuitslagen vervallen na een wijziging van de rekeninstellingen en na een mislukte toetsronde: `lib/rekenInstellingen`, de toetsstore `stores/checkStore` (zustand) en een bronteksttoets op de afhankelijkheden van de invalidatie-effecten in App.tsx en `hooks/useFemStore`. Geen van die modules staat in de barrel, en React-effecten bestaan in de sidecar niet; het slotblok start de toetsbrug als apart proces",
  ],
  [
    "zwakke-as",
    "knik om de zwakke as over de hele keten: de invoerbouwers (een leeg kniklengteveld gaat als 0 door), de spiegel `lib/kniklengte.ts` die de placeholder in het eigenschappenpaneel voedt — die staat buiten de barrel — en de toetsbrug als apart proces voor de echte EN 1993- en EN 1995-kern, die zelf de kniklengte kiest en haar herkomst noemt. Tegen de sidecarbundel zou de test juist de spiegel en de Rust-kern overslaan die hij tegen elkaar moet houden",
  ],
  [
    "tekenrichting",
    "stuurt dezelfde constructie in beide tekenrichtingen door de hele toetsketen en eist gelijke uitkomsten plus de handberekening: de grens `lib/referentierichting.ts`, de invoerbouwers voor staal en beton, de dekkingslijnbouwer, en de toetsbrug als apart proces voor de echte EN 1992- en EN 1993-kern. De toetsbrug hoort niet in de sidecarbundel, en de betonbouwer met zijn korven staat buiten de barrel; tegen de bundel zou de test juist de kernen overslaan die de wereldtermen in de afleiding zetten",
  ],
  [
    "kipsteunen-tekenvlak",
    "issue #40: houdt de kipsteunen die het tekenvlak toont (`lib/kipsteunBeeld.ts`, buiten de barrel — het is een weergavemodule) tegen de `lateral_bracing`, de `ltb_segment_length_m` en de `staafeinden` die de staal- en de houtbouwer in de toetsinvoer zetten, en in het slotblok tegen de L_st en de l_ef die de echte EN 1993- en EN 1995-kern via de toetsbrug (apart proces) rapporteren. De gedeelde afleiding `lib/kipsteunen.ts` zit via de bouwers wél in de bundel; dat de bundelinvoer er niet door verandert, bewaken de bestaande bundeltests van de bouwers",
  ],
  [
    "kipsteunen-ui",
    "issue #40: het echte tekenvlak (FemCanvas), de weergavelijst en de constructieschets van het rapport in een lokale headless browser — symbolen aan de goede zijde en op de goede plaats, de maatketting in mm bij selectie en hover, de schakelaar, de zoomgrenzen en het rapport. React, SVG-meetkunde en CSS bestaan in de sidecarbundel niet; geen server en geen rekenkern",
  ],
  [
    "infotip-plaats",
    "issue #43: de plaats van een InfoTip binnen het venster (`lib/infoTipPlaats.ts`), een weergavemodule buiten de barrel; de sidecar tekent geen tips",
  ],
  [
    "kipsteunen-gelijk",
    "issue #44: het vinkje \"Onder en boven gelijk\" (`lib/kipsteunenGelijk.ts`): detectie binnen afronding, gelijktrekken en de wijziging die beide velden samen zet. Een paneelmodule buiten de barrel; dat de toetsinvoer volgt, rekent de test na met `lib/kipsteunen.ts`, die via de bouwers wél in de bundel zit en daar door hun bundeltests bewaakt wordt",
  ],
  [
    "aanzicht-geometrie",
    "issue #45: de staven in aanzicht op ware grootte (`lib/aanzichtGeometrie.ts`), een weergavemodule buiten de barrel — contour, flenslijnen, verborgen lijnen, lamellen, wapening en beugels in mm tegen de staalcatalogus, eigen doorsneden en de korf/zones. De sidecar tekent niets; de maten die hij rekent komen uit `sectionResolver` en de bouwers, die hun eigen bundeltests hebben",
  ],
  [
    "aanzicht-ui",
    "issue #45: de laag Aanzicht op het echte tekenvlak (FemCanvas), in de weergavelijst en in de constructieschets van het rapport in een lokale headless browser — ware hoogte rond de systeemlijn, tekenvolgorde, lijndikte bij zoom, detail naar zoom, selecteren door de laag heen, resultaatweergave, thema en rapport. React, SVG-meetkunde en CSS bestaan in de sidecarbundel niet; geen server en geen rekenkern",
  ],
  [
    "eigenschappen-ui",
    "issues #43 en #44: het echte eigenschappenpaneel en de echte staafdialoog in een lokale headless browser — uitleg in InfoTips (hover, focus, klik/tik, Esc, aria-describedby, binnen het venster, licht/donker), korte status en waarschuwingen zichtbaar, en het vinkje voor gelijke kipsteunen aan boven- en onderflens (één invoer, één undo-stap, detectie bij openen, uitzetten wist niets). React, DOM en CSS bestaan in de sidecarbundel niet; geen server en geen rekenkern",
  ],
  [
    "peilmaat",
    "issue #48: de peilmaat van een niveau (`lib/peilmaat.ts`): tekst, beginwaarde en het lezen van het ingetypte niveau in mm. Een tekenvlakmodule buiten de barrel; het verschuiven zelf doet `verplaatsStramienAs`, die test-stramien-verplaatsen.mjs bewaakt",
  ],
  [
    "peilmaat-ui",
    "issue #48: de klikbare peilmaat op het echte tekenvlak met de echte modelstore in een lokale headless browser — grootte, klikvlak, hover, invoer in mm, Enter/Esc, meldingen, niveau en knopen samen in één undo-stap, en de maatlijn vrij van de peilmaat. React, DOM en CSS bestaan in de sidecarbundel niet; geen server en geen rekenkern",
  ],
  [
    "zichtbaarheid",
    "issue #47: het venster Zichtbaarheid (`lib/zichtbaarheid.ts`: groepen, één bron met de verkenner, onthouden per gebruiker), de labels op het staafmidden (`lib/staafLabels.ts`) en de profielbreedte uit `lib/aanzichtGeometrie.ts`. Weergavemodules buiten de barrel; de sidecar tekent niets",
  ],
  [
    "zichtbaarheid-ui",
    "issue #47: het echte venster Zichtbaarheid, de echte weergavelijst en het echte tekenvlak op dezelfde displayFlags in een lokale headless browser — elke schakelaar zet dezelfde vlag als de verkenner, het tekenvlak volgt (knoop- en staafnummers, lagen, profielbreedte), Standaard, tandwiel, lintknop en thema. React, DOM en CSS bestaan in de sidecarbundel niet; geen server en geen rekenkern",
  ],
  [
    "profielkleur",
    "\"Profielen in kleur\": het vaste palet (contrast in beide thema's, kleurenblindheid, geen accentkleur) en de toekenning per profiel in `lib/profielKleur.ts` (stabiel, uniek, volgorde- en taalonafhankelijk, materiaal, zonder profiel, uitbreiding), de 3D-voorrang van de UC-kleuring, de weergavevlaggen en de teksten. Een weergavemodule buiten de barrel; de sidecar tekent niets",
  ],
  [
    "profielkleur-ui",
    "\"Profielen in kleur\" op het echte 2D-tekenvlak (verkenner, venster Zichtbaarheid, legenda, selectie, aanzicht, thema) en in de echte 3D-werkruimte (WebGL-pixels, snel en volledig opbouwpad, voorrang van de UC-kleuring) in een lokale headless browser. React, DOM, CSS en WebGL bestaan in de sidecarbundel niet; geen server en geen rekenkern",
  ],
  [
    "projectgegevens-ui",
    "issue #50: het echte venster Projectgegevens in een lokale headless browser, op de standaardgrootte en in een smal venster (iframe van 360 px) — geen horizontale overloop, uitleg bij normen, gevolgklasse, windgebied en terreincategorie in een InfoTip (nl/en/de/fr, niets verloren), korte status als één grijze regel. React, DOM en CSS bestaan in de sidecarbundel niet; geen server en geen rekenkern",
  ],
  [
    "tabbalk-scroll",
    "issue #51: de rekenregels van de scrollende strook met belastinggevallen (`lib/tabbalkScroll.ts`: overloop en pijlen, pijlstap, actief geval in beeld, pijltoetsen, muiswiel, sleepdrempel). Een weergavemodule buiten de barrel; de sidecar tekent geen tabbalk",
  ],
  [
    "tabbalk-ui",
    "issue #51: de echte tabbalk met twaalf gevallen in een te smal venster in een lokale headless browser — alleen de gevallen scrollen (pijlen, wiel, slepen, toetsenbord), het actieve geval schuift in beeld, de lijstknop kiest een geval, lange namen afgekort, vaste onderdelen zichtbaar, nl/en/de/fr. React, DOM en CSS bestaan in de sidecarbundel niet; geen server en geen rekenkern",
  ],
  [
    "wind-hellend-dak-ui",
    "issue #49: het echte windvenster met de echte generator in een lokale headless browser — c_pe-velden leeg met “(automatisch, tabel 7.4a)”, de automatische waarden per zone, de gevallen per teken, overschrijven en leeg maken, lessenaarsdak 7.3a/7.3b en thema. React, DOM en CSS bestaan in de sidecarbundel niet; de rekenregels staan tegen de bundel in `wind-hellend-dak`",
  ],
  ["stramien-streepstip", "issue #103: het streep-stip van stramien- en levellijnen — het patroon (lib/stramienStreepStip), de 2D-stijl in FemCanvas.css, de 3D-shader en -lijnen (Three), de section box en het rapport (reportGeometry). Weergavecode buiten de barrel; de sidecar tekent geen stramien"],
  ["stramien-streepstip-ui", "issue #103: het echte 3D-tekenvlak (WebGL) en 2D-tekenvlak in een lokale headless browser — pixels langs een stramienas in, uit en ingezoomd, perspectief, section box, peilmaten en de berekende 2D-stijl. React, DOM, CSS en Three bestaan in de sidecarbundel niet; geen server en geen rekenkern"],
]);

// ── Argumenten ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const bundelStand = args.includes("--bundel");
const breed = args.includes("--breed");
// The tsx CLI uses a Unix-domain IPC socket to launch its worker. In sandboxes
// that deny local sockets, invoke its ESM loader directly instead.
const directTsx = process.env.OPEN_FEM_TEST_DIRECT_TSX === "1";
const filterArg = args.find((a) => a.startsWith("--filter="));
const filter = filterArg ? filterArg.slice("--filter=".length) : null;

const onbekend = args.filter(
  (a) => !["--bundel", "--breed"].includes(a) && !a.startsWith("--filter="),
);
if (onbekend.length > 0) {
  console.error(`Onbekende optie(s): ${onbekend.join(", ")}`);
  console.error(
    "Gebruik: node scripts/run-tests.mjs [--bundel] [--filter=<deel>] [--breed]",
  );
  process.exit(2);
}

/** Basisnaam zonder `test-`-voorvoegsel en zonder `.mjs`. */
const basisnaam = (bestand) => bestand.replace(/^test-/, "").replace(/\.mjs$/, "");

// ── Testbestanden verzamelen ──────────────────────────────────────────────
const alleTests = readdirSync(frontendRoot)
  .filter((n) => n.startsWith("test-") && n.endsWith(".mjs"))
  .sort();

if (alleTests.length === 0) {
  console.error(`Geen test-*.mjs gevonden in ${frontendRoot}.`);
  process.exit(2);
}

let tests = alleTests;
if (bundelStand) {
  tests = tests.filter((n) => BUNDEL_TESTS.has(basisnaam(n)));

  // Bewaak dat de lijst en de werkboom niet uit elkaar lopen: een test die in
  // BUNDEL_TESTS staat maar niet bestaat, of een nieuwe test die in geen van
  // beide lijsten staat, is een stille gat in de dekking.
  const aanwezig = new Set(alleTests.map(basisnaam));
  const ontbrekend = [...BUNDEL_TESTS].filter((n) => !aanwezig.has(n));
  if (ontbrekend.length > 0) {
    console.error(
      `Bundellijst noemt tests die niet bestaan: ${ontbrekend.join(", ")}`,
    );
    process.exit(2);
  }
  const ongeplaatst = [...aanwezig].filter(
    (n) => !BUNDEL_TESTS.has(n) && !ALLEEN_BRON.has(n),
  );
  if (ongeplaatst.length > 0) {
    console.error(
      `Test(s) zonder plaatsbepaling: ${ongeplaatst.join(", ")}.\n` +
        "Zet elke nieuwe test in BUNDEL_TESTS of in ALLEEN_BRON (met reden) " +
        "in scripts/run-tests.mjs.",
    );
    process.exit(2);
  }
}
if (filter) tests = tests.filter((n) => n.includes(filter));

if (tests.length === 0) {
  console.error("Geen tests over na filtering.");
  process.exit(2);
}

// ── Voorwaarden per stand ─────────────────────────────────────────────────
if (bundelStand && !existsSync(BUNDEL)) {
  console.error(
    `Sidecarbundel ontbreekt: ${BUNDEL}\n` +
      "Bouw hem eerst met: npm run build:sidecar",
  );
  process.exit(2);
}
if (!bundelStand && !existsSync(TSX_CLI)) {
  console.error(
    `tsx ontbreekt: ${TSX_CLI}\nDraai eerst: npm ci (in design-mockup/)`,
  );
  process.exit(2);
}

/** Bundelpad als `file://`-URL — een kaal `C:/...`-pad is geen ESM-specifier. */
const bundelUrl = pathToFileURL(BUNDEL).href;

/** Elke `"./src/…​.ts"`-specifier in een testbestand, ongeacht de aanhalingsvorm. */
const BRON_SPECIFIER = /(["'])\.\/src\/[^"']*\.ts\1/g;

/** Restanten van een afgebroken eerdere run opruimen. */
function ruimKopieënOp() {
  for (const naam of readdirSync(frontendRoot)) {
    if (naam.startsWith(KOPIE_PREFIX)) {
      rmSync(join(frontendRoot, naam), { force: true });
    }
  }
}

/**
 * Schrijft een kopie van `bestand` NAAST het origineel waarin elke
 * bron-import naar de bundel wijst. Naast het origineel, want fixturepaden
 * worden relatief aan het testbestand opgelost.
 */
function schrijfBundelKopie(bestand) {
  const bron = readFileSync(join(frontendRoot, bestand), "utf8");
  let vervangingen = 0;
  const herschreven = bron.replace(BRON_SPECIFIER, () => {
    vervangingen++;
    return JSON.stringify(bundelUrl);
  });
  if (vervangingen === 0) {
    throw new Error(
      `${bestand} importeert geen enkele "./src/…" module; hij hoort niet in ` +
        "de bundelstand thuis.",
    );
  }
  const kopie = join(frontendRoot, `${KOPIE_PREFIX}${bestand}`);
  writeFileSync(kopie, herschreven);
  return { kopie, vervangingen };
}

/** Start een testproces en verzamelt uitvoer, exitcode en looptijd. */
function draai(commando, argumenten, tijdslimietMs = TIJDSLIMIET_MS) {
  return new Promise((klaar) => {
    const start = process.hrtime.bigint();
    const uitvoermap = mkdtempSync(join(tmpdir(), "open-fem-test-"));
    const stdoutPad = join(uitvoermap, "stdout.log");
    const stderrPad = join(uitvoermap, "stderr.log");
    let stdoutFd = -1;
    let stderrFd = -1;
    let wekker;
    let klaarGemeld = false;
    let verlopen = false;
    let foutBijStart = "";

    const rondAf = (code) => {
      if (klaarGemeld) return;
      klaarGemeld = true;
      if (wekker) clearTimeout(wekker);
      if (stdoutFd >= 0) closeSync(stdoutFd);
      if (stderrFd >= 0) closeSync(stderrFd);
      const uit = existsSync(stdoutPad) ? readFileSync(stdoutPad, "utf8") : "";
      const fout = (existsSync(stderrPad) ? readFileSync(stderrPad, "utf8") : "")
        + foutBijStart
        + (verlopen
          ? `\n[runner] tijdslimiet van ${tijdslimietMs / 1000} s overschreden.\n`
          : "");
      rmSync(uitvoermap, { recursive: true, force: true });
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      klaar({ code, uit, fout, ms });
    };

    try {
      stdoutFd = openSync(stdoutPad, "w");
      stderrFd = openSync(stderrPad, "w");
      const kind = spawn(commando, argumenten, {
        cwd: frontendRoot,
        // process.exit() can discard pending writes to pipes. Regular files
        // preserve the complete suite output for check counting and diagnostics.
        stdio: ["ignore", stdoutFd, stderrFd],
      });

      wekker = setTimeout(() => {
        verlopen = true;
        kind.kill("SIGKILL");
      }, tijdslimietMs);

      kind.on("error", (err) => {
        foutBijStart = err.message;
        rondAf(-1);
      });
      kind.on("close", (code) => rondAf(code));
    } catch (err) {
      foutBijStart = err instanceof Error ? err.message : String(err);
      rondAf(-1);
    }
  });
}

/**
 * Haalt "<n> geslaagd, <m> gefaald" uit de uitvoer. De batterij schrijft die
 * regel in wisselende opmaak; de laatste treffer is de eindstand. Valt terug
 * op het tellen van vinkjes. Heeft een integratietest geen interne teller,
 * dan blijft die teller onbekend in plaats van stil als nul te verschijnen.
 */
function telChecks(tekst) {
  const treffers = [...tekst.matchAll(/(\d+)\s+geslaagd,\s+(\d+)\s+gefaald/g)];
  if (treffers.length > 0) {
    const laatste = treffers[treffers.length - 1];
    return { geslaagd: Number(laatste[1]), gefaald: Number(laatste[2]) };
  }
  const geslaagd = (tekst.match(/✓/g) ?? []).length;
  const gefaald = (tekst.match(/✗/g) ?? []).length;
  return geslaagd + gefaald > 0
    ? { geslaagd, gefaald }
    : { geslaagd: null, gefaald: null };
}

// ── Uitvoeren ─────────────────────────────────────────────────────────────
const stand = bundelStand ? "BUNDEL (kaal node)" : "BRON (tsx)";
console.log(`Solverbatterij — stand: ${stand}`);
console.log(`  map     : ${frontendRoot}`);
if (bundelStand) console.log(`  bundel  : ${BUNDEL}`);
console.log(`  tests   : ${tests.length}${filter ? ` (filter "${filter}")` : ""}`);
console.log("");

ruimKopieënOp();

const uitslagen = [];
let totaalGeslaagd = 0;
let totaalGefaald = 0;

for (const bestand of tests) {
  const naam = basisnaam(bestand);
  let kopie = null;
  let uitslag;

  try {
    let commando;
    let argumenten;
    if (bundelStand) {
      const geschreven = schrijfBundelKopie(bestand);
      kopie = geschreven.kopie;
      commando = process.execPath;
      argumenten = [kopie];
    } else {
      commando = process.execPath;
      argumenten = directTsx
        ? ["--import", "tsx/esm", join(frontendRoot, bestand)]
        : [TSX_CLI, join(frontendRoot, bestand)];
    }
    const tijdslimietMs = tijdslimietVan(naam);
    uitslag = await draai(commando, argumenten, tijdslimietMs);
  } catch (err) {
    uitslag = { code: -1, uit: "", fout: String(err), ms: 0 };
  } finally {
    if (kopie) rmSync(kopie, { force: true });
  }

  const alles = `${uitslag.uit}${uitslag.fout}`;
  const { geslaagd, gefaald } = telChecks(alles);
  const ok = uitslag.code === 0;
  if (geslaagd !== null) totaalGeslaagd += geslaagd;
  if (gefaald !== null) totaalGefaald += gefaald;
  uitslagen.push({ naam, ok, geslaagd, gefaald, ms: uitslag.ms, alles });

  const merk = ok ? "PASS" : "FAAL";
  const checkStand = geslaagd === null
    ? "checkteller n.v.t."
    : `${String(geslaagd).padStart(4)} geslaagd, ${String(gefaald).padStart(3)} gefaald`;
  console.log(
    `  ${merk}  ${naam.padEnd(24)} ${checkStand}  (${uitslag.ms.toFixed(0)} ms)`,
  );
  if (breed || !ok) {
    console.log(
      alles
        .trimEnd()
        .split("\n")
        .map((r) => `        │ ${r}`)
        .join("\n"),
    );
    console.log("");
  }
}

// ── Samenvatting ──────────────────────────────────────────────────────────
const gefaaldeTests = uitslagen.filter((u) => !u.ok);
const testsZonderTeller = uitslagen.filter((u) => u.geslaagd === null).length;

console.log("");
console.log("─".repeat(72));
console.log(
  `${stand}: ${uitslagen.length - gefaaldeTests.length}/${uitslagen.length} ` +
    `testbestanden geslaagd — ${totaalGeslaagd} checks geslaagd, ` +
    `${totaalGefaald} gefaald${testsZonderTeller ? `; ${testsZonderTeller} suite(s) hebben geen interne checkteller` : ""}.`,
);

if (bundelStand && !filter) {
  console.log(
    `Op de bron gebleven: ${ALLEEN_BRON.size} test(s) — zie ALLEEN_BRON in ` +
      "scripts/run-tests.mjs voor de reden per test.",
  );
}

if (gefaaldeTests.length > 0) {
  console.log("");
  console.log("Gefaald:");
  for (const u of gefaaldeTests) console.log(`  - ${u.naam}`);
  process.exit(1);
}

process.exit(0);
