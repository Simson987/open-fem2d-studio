/**
 * Geometric Nonlinear Frame Solver
 *
 * Implements P-Delta analysis for second-order effects
 * Uses Newton-Raphson iteration for geometric nonlinearity
 */

import { Matrix } from '../math/Matrix';
import { Mesh } from '../fem/Mesh';
import { ISolverResult, IBeamForces, IElementStress, AnalysisType, getConnectionTypes, getDOFConnectionTypes, getReleasedLocalDofs, getSprungLocalDofs, getBeamDistributedLoads } from '../fem/types';
import {
  calculateBeamLength,
  calculateBeamAngle,
  calculateBeamLocalStiffness,
  calculateGeometricStiffness,
  createTransformationMatrix,
  calculateDistributedLoadLocalForces,
  telGeometrischeStijfheidOp,
} from '../fem/Beam';
import { calculateBeamInternalForces } from '../fem/BeamForces';
import { calculateBeamThermalLocalForces } from '../fem/ThermalLoad';
import { calculateElementStress, calculatePrincipalStresses, calculateTriangleGeometricStiffness, expandTriangleGeometricStiffness } from '../fem/Triangle';
import { calculateQuadStress, calculateQuadGeometricStiffness, expandQuadGeometricStiffness } from '../fem/Quad4';
import { calculateElementMoments, calculateElementShearForces } from '../fem/DKT';
import { assembleGlobalStiffnessMatrix, assembleForceVector as assembleForceVectorNew, getConstrainedDofs, getDofsPerNode, applyEndReleases, applyEndConnections, buildNodeIdToIndex, PlaatElementFout } from './Assembler';
// De keuze welke stelseloplosser draait loopt via één plek: `LinearSolver`.
// De zeven aanroepen hieronder houden hun bestaande handtekening en weten niet
// welke oplosser eronder zit. Standaard is dat nog steeds de dichte
// Gauss-eliminatie uit `GaussElimination`.
import { solveLinearSystem } from '../math/LinearSolver';
import { solveLinearSystem as losDichtOp } from '../math/GaussElimination';
import {
  ISectionState,
  createSteelMaterial,
  createConcreteMaterial,
  initSectionState,
  updateSectionState,
} from './NonlinearMaterial';

// ── Meldingen in plaats van stilte ──────────────────────────────────────────

/** Getal in mm met hooguit één decimaal, decimaalkomma. */
function mmTekst(v: number): string {
  return (Math.round(v * 10) / 10).toString().replace('.', ',');
}

/**
 * Het stelsel is singulier: een vrijheidsgraad heeft geen stijfheid.
 *
 * WAAROM DEZE KLASSE BESTAAT. De stelseloplosser meldt alleen "Matrix is
 * singular or nearly singular at column N". Dat kolomnummer zegt de gebruiker
 * niets: het is de positie in de stijfheidsmatrix, niet een knoopnummer.
 * Gemeten bij een vakwerkknoop (column 5), een pendelstaaf met een scharnier
 * op een scharnieroplegging (column 2) en een losse knoop (column 6) — drie
 * geldige modelfouten met dezelfde onbruikbare melding. Hier wordt de kolom
 * terugvertaald naar de knoop, de richting en, als die knoop aan niets vastzit,
 * de mededeling dat het een losse knoop is.
 *
 * De kern kent alleen rekenknopen; de adapter (`engine.ts`) vervangt het label
 * door het knoopnummer uit het model via `tekstVoor`.
 */
export class SingulierStelselFout extends Error {
  readonly meshKnoopId: number;
  readonly xMm: number;
  readonly zMm: number;
  readonly richting: 'x' | 'z' | 'rotatie';
  readonly losseKnoop: boolean;
  readonly origineel: string;
  /**
   * Er werkt een koppel op een knoop waar alleen scharnierende staafeinden
   * samenkomen (zie `vrijeKnoopdraaiingen`): de draaiing zelf wordt
   * vastgezet, maar dat moment kan nergens heen — een echt mechanisme.
   */
  readonly koppelOpScharnierknoop: boolean;
  /**
   * Extra uitleg achter de melding, bijvoorbeeld welke trek-alleen staven
   * op het moment van de singulariteit waren uitgeschakeld (issue #234).
   */
  aanvulling = '';
  /**
   * Welke releases er op deze knoop WERKELIJK zitten (issue #243, punt 111):
   * `Ry` als een staafeinde hier een momentscharnier heeft, `Tx/Tz` als een
   * normaal- of dwarskrachthuls. De melding verwijst alleen naar een release
   * die bestaat; tot oktober 2026 stond er bij elke vrije draaiing
   * "waarschijnlijk hebben alle staafeinden een scharnier (release Ry)", ook
   * bij een ligger zonder enige release.
   */
  readonly releasesOpKnoop: { ry: boolean; translatie: boolean };
  /** De beweging is een mechanisme met meer knopen (uit de nulvorm van K). */
  readonly mechanisme: boolean;
  constructor(v: {
    meshKnoopId: number; xMm: number; zMm: number;
    richting: 'x' | 'z' | 'rotatie'; losseKnoop: boolean; origineel: string;
    koppelOpScharnierknoop?: boolean;
    releasesOpKnoop?: { ry: boolean; translatie: boolean };
    mechanisme?: boolean;
  }) {
    super('');
    this.name = 'SingulierStelselFout';
    this.meshKnoopId = v.meshKnoopId;
    this.xMm = v.xMm;
    this.zMm = v.zMm;
    this.richting = v.richting;
    this.losseKnoop = v.losseKnoop;
    this.origineel = v.origineel;
    this.koppelOpScharnierknoop = v.koppelOpScharnierknoop === true;
    this.releasesOpKnoop = v.releasesOpKnoop ?? { ry: false, translatie: false };
    this.mechanisme = v.mechanisme === true;
    this.message = this.tekstVoor('een rekenknoop');
  }

  /** De melding met `knoop` als onderwerp, bijvoorbeeld "knoop 7". */
  tekstVoor(knoop: string): string {
    const beweging =
      this.richting === 'x' ? 'horizontaal verschuiven (x)'
        : this.richting === 'z' ? 'verticaal verschuiven (z)'
          : 'draaien';
    const oorzaak = this.koppelOpScharnierknoop
      ? 'Op deze knoop komen alleen scharnierende staafeinden (release Ry) samen en ' +
        'geen oplegging houdt de draaiing tegen, maar er werkt een koppel op: dat moment ' +
        'kan nergens heen (mechanisme). Zet het koppel op een knoop waar een staaf star ' +
        'aansluit, of maak één staafeinde op deze knoop star.'
      : this.losseKnoop
      ? 'Deze knoop is met geen enkele staaf verbonden (een losse knoop): ' +
        'verwijder hem, of verbind hem met de constructie.'
      : this.richting === 'rotatie'
        ? (this.releasesOpKnoop.ry
          ? 'Niets houdt die rotatie tegen: er zitten scharnierende staafeinden ' +
            '(release Ry) op deze knoop en de knoop zelf heeft geen rotatiesteun. ' +
            'Laat één staaf star aansluiten, of haal het scharnier weg op een ' +
            'scharnieroplegging.'
          : 'Niets houdt die rotatie tegen: controleer de opleggingen (een ' +
            'rotatiesteun of een tweede oplegging) en of de staven hier werkelijk ' +
            'aan elkaar vastzitten.')
        : (this.mechanisme
          ? 'Het model is een mechanisme: deze beweging kost geen vervorming. '
          : '') +
          'Niets houdt die verplaatsing tegen: controleer de opleggingen (een rol ' +
          'die juist in deze richting vrij is?) en of de staven daar werkelijk aan ' +
          'elkaar vastzitten' +
          (this.releasesOpKnoop.translatie
            ? ', en of een normaalkracht- of dwarskrachthuls (release Tx/Tz) op ' +
              'deze knoop niet de enige verbinding is.'
            : '.');
    return (
      `Het stelsel is singulier: ${knoop} op (${mmTekst(this.xMm)}, ${mmTekst(this.zMm)}) mm ` +
      `kan vrij ${beweging}. ${oorzaak}${this.aanvulling ? ' ' + this.aanvulling : ''} ` +
      `(Oorspronkelijke melding: ${this.origineel})`
    );
  }
}

/**
 * Vertaal een "column N"-melding van de stelseloplosser naar een
 * [`SingulierStelselFout`]. Drie vrijheidsgraden per knoop (u, w, θ).
 *
 * Welke knoop bij kolom N hoort, verschilt per pad:
 *  - frame-pad: álle knopen in de invoegvolgorde van `mesh.nodes` — dezelfde
 *    nummering als `applyBoundaryConditions`;
 *  - gemengd pad (staven + schijven): alleen de ACTIEVE knopen, in de
 *    volgorde van `buildNodeIdToIndex`; die tabel geeft de aanroeper mee.
 * Tot september 2026 vertaalde alleen het frame-pad; het gemengde pad gaf
 * dezelfde vakwerkknoop nog als "column 5" door (gemeten: vakwerk met een
 * losse wandschijf ernaast). Elke andere fout gaat ongewijzigd door.
 */
function vertaalSingulier(
  e: unknown,
  mesh: Mesh,
  knoopVanIndex?: (index: number) => { id: number } | undefined,
  K?: Matrix,
): unknown {
  const origineel = e instanceof Error ? e.message : String(e);
  const treffer = /column (\d+)/.exec(origineel);
  if (!treffer) return e;
  const kolomOplosser = Number(treffer[1]);
  // De kolom waar de oplosser stopt is de vrijheidsgraad die in ZIJN
  // eliminatievolgorde als laatste overbleef — bij een ligger die als star
  // lichaam om zijn scharnieroplegging kan draaien is dat de draaiing van de
  // eindknoop, terwijl de gebruiker de verticale verschuiving moet tegenhouden
  // (issue #243, punt 111). Met de stijfheidsmatrix erbij wordt de nulvorm
  // bepaald en de grootste VERSCHUIVING daarin gemeld.
  const vorm = K ? mechanismeVorm(K, kolomOplosser) : null;
  const kolom = vorm ? maatgevendeKolom(vorm, kolomOplosser) : kolomOplosser;
  const index = Math.floor(kolom / 3);
  const knoopId = knoopVanIndex ? knoopVanIndex(index)?.id : [...mesh.nodes.values()][index]?.id;
  const knoop = knoopId === undefined ? undefined : mesh.nodes.get(knoopId);
  if (!knoop) return e;
  let losseKnoop = true;
  for (const beam of mesh.beamElements.values()) {
    const eind = mesh.getBeamElementNodes(beam);
    if (eind && (eind[0].id === knoop.id || eind[1].id === knoop.id)) {
      losseKnoop = false;
      break;
    }
  }
  if (losseKnoop) {
    for (const element of mesh.elements.values()) {
      if (element.nodeIds.includes(knoop.id)) { losseKnoop = false; break; }
    }
  }
  const richtingen = ['x', 'z', 'rotatie'] as const;
  return new SingulierStelselFout({
    meshKnoopId: knoop.id,
    xMm: knoop.x * 1000,
    zMm: knoop.y * 1000,
    richting: richtingen[kolom % 3],
    losseKnoop,
    origineel,
    releasesOpKnoop: releasesOp(mesh, knoop.id),
    mechanisme: vorm !== null && kolom !== kolomOplosser,
  });
}

/** Welke releases zitten er op de staafeinden aan deze knoop? */
function releasesOp(mesh: Mesh, knoopId: number): { ry: boolean; translatie: boolean } {
  let ry = false;
  let translatie = false;
  for (const beam of mesh.beamElements.values()) {
    const eind = mesh.getBeamElementNodes(beam);
    if (!eind) continue;
    const vrij = getReleasedLocalDofs(beam);
    const lokaal = eind[0].id === knoopId ? [0, 1, 2] : eind[1].id === knoopId ? [3, 4, 5] : null;
    if (!lokaal) continue;
    if (vrij.includes(lokaal[2])) ry = true;
    if (vrij.includes(lokaal[0]) || vrij.includes(lokaal[1])) translatie = true;
  }
  return { ry, translatie };
}

/**
 * De nulvorm van een singuliere K: v met v[kolom] = 1 en K·v = 0 in alle
 * andere rijen. Alleen op de foutroute en alleen voor een klein stelsel (dicht
 * opgelost, O(n³)); `null` als de rest van K óók singulier is (meer dan één
 * mechanisme) of het stelsel te groot is — dan blijft de melding bij de kolom
 * van de oplosser.
 */
function mechanismeVorm(K: Matrix, kolom: number): number[] | null {
  const n = K.rows;
  if (n < 2 || n > 600 || kolom >= n) return null;
  const rest: number[] = [];
  for (let i = 0; i < n; i++) if (i !== kolom) rest.push(i);
  const A = new Matrix(n - 1, n - 1);
  const b = new Array<number>(n - 1);
  rest.forEach((i, r) => {
    rest.forEach((j, c) => A.set(r, c, K.get(i, j)));
    b[r] = -K.get(i, kolom);
  });
  try {
    const x = losDichtOp(A, b);
    if (!x.every(Number.isFinite)) return null;
    const v = new Array<number>(n).fill(0);
    v[kolom] = 1;
    rest.forEach((i, r) => { v[i] = x[r]; });
    return v;
  } catch {
    return null;
  }
}

/**
 * De vrijheidsgraad die de gebruiker moet tegenhouden: de grootste
 * VERSCHUIVING in de nulvorm (in m, bij een eenheidsdraaiing of
 * -verschuiving), want een oplegging houdt een verschuiving tegen. Alleen als
 * de vorm geen noemenswaardige verschuiving heeft (een zuiver vrij draaiende
 * knoop) blijft het de kolom van de oplosser.
 */
function maatgevendeKolom(vorm: number[], kolomOplosser: number): number {
  let beste = -1;
  let grootste = 0;
  for (let i = 0; i < vorm.length; i++) {
    if (i % 3 === 2) continue;
    const a = Math.abs(vorm[i]);
    if (a > grootste) { grootste = a; beste = i; }
  }
  // 1 µm per eenheid: daaronder is de "verschuiving" rekenruis van de penalty.
  if (beste < 0 || grootste <= 1e-6) return kolomOplosser;
  // Verschuift de kolom van de oplosser zelf (vrijwel) even ver — een
  // raam dat als parallellogram wegzakt: alle regelknopen gelijk — dan blijft
  // het die knoop, zodat de melding niet verspringt.
  if (kolomOplosser % 3 !== 2 && Math.abs(vorm[kolomOplosser]) >= 0.999 * grootste) return kolomOplosser;
  return beste;
}

/** `solveLinearSystem` voor het frame-pad, met de knoopvertaling van een singulier stelsel. */
function losFrameStelselOp(K: Matrix, F: number[], mesh: Mesh): number[] {
  try {
    return solveLinearSystem(K, F);
  } catch (e) {
    throw vertaalSingulier(e, mesh, undefined, K);
  }
}

/**
 * Een rekenelement van lengte nul wordt GEWEIGERD. Het werd stil overgeslagen
 * (`if (L < 1e-10) continue;`): de rest rekende door en de krachtsverdeling
 * hoorde bij een ander model. Gemeten: twee ingeklemde uitkragingen, gekoppeld
 * door een staaf van lengte nul, puntlast 10 kN — juist is 15 kNm en 5 kN per
 * inklemming, gerekend werd 30 kNm en 10 kN bij de ene en 0 bij de andere,
 * zonder uitzondering. `Assembler.ts` weigert zo'n element al op het gemengde
 * pad; hier nu ook op het frame-pad.
 */
function nulElementFout(elementId: number, knoop: { x: number; y: number }): Error {
  return new Error(
    `Rekenelement ${elementId} heeft lengte nul: begin- en eindknoop liggen allebei op ` +
    `(${mmTekst(knoop.x * 1000)}, ${mmTekst(knoop.y * 1000)}) mm. Zo'n element kan geen ` +
    'kracht overbrengen, en overslaan zou een krachtsverdeling geven bij een ander model ' +
    'dan is ingevoerd. Voeg de twee knopen samen of verwijder de staaf.'
  );
}

/**
 * Draagt de mesh werkzame ELEMENTlasten (verdeeld of thermisch), los van wat
 * er na de scharniercondensatie van overblijft?
 *
 * Nodig omdat de lastvector na condensatie exact nul kan zijn terwijl er wél
 * een last is: een uniforme ΔT op een staaf met een normaalkrachthuls levert
 * lokaal [−N_th, 0, 0, +N_th, 0, 0], en dat valt door de condensatie weg. Het
 * juiste antwoord is dan N = 0 met vrije uitzetting, niet de melding dat er
 * geen last is — die liet de berekening van ALLE belastinggevallen falen.
 */
function heeftElementlasten(mesh: Mesh): boolean {
  for (const beam of mesh.beamElements.values()) {
    const verdeeld = getBeamDistributedLoads(beam);
    if (verdeeld.some(dl => dl.qx !== 0 || dl.qy !== 0 || (dl.qxEnd ?? 0) !== 0 || (dl.qyEnd ?? 0) !== 0)) {
      return true;
    }
    const material = mesh.getMaterial(beam.materialId);
    if (material && calculateBeamThermalLocalForces(beam, material).some(v => v !== 0)) return true;
  }
  return false;
}

/**
 * Eén regel solverlogboek.
 *
 * De solver MELDT; hij bewaart niets. Dat is met opzet: het log is juist het
 * meest waard wanneer de solver daarna een fout gooit (divergentie, singuliere
 * K), en dan komt er nooit een resultaatobject waar het log in had kunnen
 * zitten. Een callback levert de regels wél, tot en met de laatste iteratie
 * vóór de fout.
 *
 * `soort` stuurt de weergave, niet de inhoud:
 *   - `info`        — een stap die gelukt is (assembly, randvoorwaarden)
 *   - `iteratie`    — één Newton-Raphson-stap, met de twee normen
 *   - `waarschuwing`— iets wat de uitkomst kleurt maar hem niet verwerpt
 *   - `fout`        — de reden waarom er zo meteen niets terugkomt
 */
export interface SolverLogRegel {
  soort: 'info' | 'iteratie' | 'waarschuwing' | 'fout';
  tekst: string;
  /** Laststap (1-gebaseerd); alleen bij `iteratie`. */
  laststap?: number;
  /** Iteratienummer binnen de laststap (1-gebaseerd); alleen bij `iteratie`. */
  iteratie?: number;
  /** ‖Δu‖ van deze iteratie. */
  incrementNorm?: number;
  /** ‖u‖ na deze iteratie — samen met de vorige de convergentiemaat. */
  verplaatsingsNorm?: number;
}

export interface NonlinearSolverOptions {
  analysisType: AnalysisType;
  geometricNonlinear: boolean;
  materialNonlinear: boolean;          // Enable physical nonlinearity (FNL)
  materialType: 'steel' | 'concrete';  // Material model for FNL
  steelFy: number;                     // Steel yield strength (Pa)
  concreteFck: number;                 // Concrete characteristic strength (Pa)
  maxIterations: number;
  tolerance: number;
  loadSteps: number;
  /**
   * Ontvangt elke logregel zodra hij ontstaat. Weglaten = geen log, en dan
   * kost dit niets: er wordt geen tekst opgebouwd die niemand leest.
   *
   * De ontvanger mag NIET gooien — hij draait midden in de iteratielus.
   */
  onLog?: (regel: SolverLogRegel) => void;
  /**
   * Kinematische randkoppelingen (alleen het gemengde pad): de verplaatsing u
   * en v van een SLAAFknoop is de gewogen som van die van zijn MEESTERS,
   *     u_slaaf = Σ w_m · u_m,   Σ w_m = 1.
   * Gebruikt voor een staafeinde dat op een plaatrand tussen twee randknopen
   * ligt: de lineaire interpolatie langs die elementrand (w = 1 − t en t) is
   * precies de verplaatsing die het membraan daar heeft. De rotatie van de
   * slaaf blijft vrij — het membraan draagt in zijn knopen geen moment, net
   * als bij een staafeinde dat op een randknoop zelf ligt.
   *
   * Uitgewerkt door EXACTE eliminatie (K̂ = TᵀKT, F̂ = TᵀF), niet met een
   * straffactor: een straf van de orde 1e20 op buitendiagonaaltermen kost
   * cijfers in de ontbinding, eliminatie niet. Ontbreekt het veld (of is het
   * leeg), dan is het pad bit-identiek aan voorheen.
   */
  randKoppelingen?: { slaafKnoopId: number; meesters: { knoopId: number; gewicht: number }[] }[];
}

const DEFAULT_OPTIONS: NonlinearSolverOptions = {
  analysisType: 'frame',
  geometricNonlinear: false,
  materialNonlinear: false,
  materialType: 'steel',
  steelFy: 235e6,        // S235
  concreteFck: 30e6,     // C30/37
  maxIterations: 20,
  tolerance: 1e-6,
  loadSteps: 1
};

// `calculateGeometricStiffness` en `telGeometrischeStijfheidOp` staan in
// `fem/Beam.ts`: ook de krachtterugrekening (`calculateBeamInternalForces`)
// heeft ze nodig, en daar mag NonlinearSolver niet vandaan importeren.

/**
 * Assemble global stiffness matrix including geometric stiffness
 */
export function assembleGlobalStiffnessWithGeometric(
  mesh: Mesh,
  axialForces: Map<number, number>,  // elementId -> N
  includeGeometric: boolean
): Matrix {
  const numNodes = mesh.getNodeCount();
  const numDofs = numNodes * 3;
  const K = new Matrix(numDofs, numDofs);

  // Create node ID to index mapping
  const nodeIdToIndex = new Map<number, number>();
  let index = 0;
  for (const node of mesh.nodes.values()) {
    nodeIdToIndex.set(node.id, index);
    index++;
  }

  for (const beam of mesh.beamElements.values()) {
    const nodes = mesh.getBeamElementNodes(beam);
    if (!nodes) continue;

    const material = mesh.getMaterial(beam.materialId);
    if (!material) continue;

    const [n1, n2] = nodes;
    const L = calculateBeamLength(n1, n2);
    const angle = calculateBeamAngle(n1, n2);

    // Lengte nul: weigeren, niet overslaan — zie `nulElementFout`.
    if (L < 1e-10) throw nulElementFout(beam.id, n1);

    // Linear elastic stiffness
    const Kl = calculateBeamLocalStiffness(L, material.E, beam.section.A, beam.section.I);

    // Geometrische stijfheid: VÓÓR de scharniercondensatie optellen, zodat
    // elastische en geometrische stijfheid samen worden gecondenseerd.
    if (includeGeometric) {
      // TEKENCONVENTIE: calculateAllInternalForces vult axialForces met
      // (N1+N2)/2 uit de krachtenrecovery, en die levert N1 = f_lokaal[0]
      // — DRUK-positief (empirisch geverifieerd: trek geeft negatieve N1).
      // calculateGeometricStiffness verwacht N trek-positief, dus flippen.
      // Zonder deze flip verstijft druk i.p.v. verslapt (P-Δ verkeerd om).
      const N = -(axialForces.get(beam.id) || 0);
      telGeometrischeStijfheidOp(Kl, L, N);
    }

    // Statische condensatie voor releases: buigscharnieren (Rz) én
    // translatie-releases (Tx = axiaal / normaalkrachthuls, Tz = dwars),
    // in LOKALE assen — vandaar vóór de transformatie naar globaal. Met Kg
    // er al in: de condensatie werkt op de raakstijfheid Ke + Kg, zie
    // `telGeometrischeStijfheidOp`.
    const releasedLocalDofs = getReleasedLocalDofs(beam);
    const veren = getSprungLocalDofs(beam);
    if (veren.length > 0) {
      applyEndConnections(Kl, releasedLocalDofs, veren);
    } else if (releasedLocalDofs.length > 0) {
      applyEndReleases(Kl, releasedLocalDofs);
    }

    // Transform to global
    const T = createTransformationMatrix(angle);
    const TT = T.transpose();
    const temp = Kl.multiply(T);
    const Ke = TT.multiply(temp);

    // Get DOF indices
    const idx1 = nodeIdToIndex.get(n1.id)!;
    const idx2 = nodeIdToIndex.get(n2.id)!;
    const dofIndices = [
      idx1 * 3, idx1 * 3 + 1, idx1 * 3 + 2,
      idx2 * 3, idx2 * 3 + 1, idx2 * 3 + 2
    ];

    // Assemble
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        K.addAt(dofIndices[i], dofIndices[j], Ke.get(i, j));
      }
    }

    // Add Winkler foundation stiffness for beam on grade
    if (beam.onGrade?.enabled && beam.onGrade.k > 0) {
      const k = beam.onGrade.k; // N/m² (spring stiffness per unit area)
      const b = beam.onGrade.b ?? 1.0; // Foundation width in m (default 1.0m)
      const kL = k * b * L; // Total spring stiffness along beam

      // Vertical stiffness (primary Winkler stiffness)
      const v1Dof = dofIndices[1]; // v1
      const v2Dof = dofIndices[4]; // v2
      K.addAt(v1Dof, v1Dof, kL / 2);
      K.addAt(v2Dof, v2Dof, kL / 2);

      // Small horizontal friction stiffness to prevent singularity (0.1% of vertical)
      const u1Dof = dofIndices[0]; // u1
      const u2Dof = dofIndices[3]; // u2
      const kFriction = kL * 0.001;
      K.addAt(u1Dof, u1Dof, kFriction / 2);
      K.addAt(u2Dof, u2Dof, kFriction / 2);
    }
  }

  // Add spring support stiffness to diagonal
  for (const node of mesh.nodes.values()) {
    const nodeIndex = nodeIdToIndex.get(node.id);
    if (nodeIndex === undefined) continue;
    const c = node.constraints;
    if (c.springX != null && c.x) {
      K.addAt(nodeIndex * 3, nodeIndex * 3, c.springX);
    }
    if (c.springY != null && c.y) {
      K.addAt(nodeIndex * 3 + 1, nodeIndex * 3 + 1, c.springY);
    }
    if (c.springRot != null && c.rotation) {
      K.addAt(nodeIndex * 3 + 2, nodeIndex * 3 + 2, c.springRot);
    }
  }

  return K;
}

/**
 * Calculate beam element stiffness with reduced EI from material nonlinearity
 * Uses the tangent stiffness EI_tangent from M-κ relationship
 */
function calculateBeamLocalStiffnessFNL(
  L: number,
  E: number,
  A: number,
  _I: number,          // Not used directly - EI_tangent provides the stiffness
  EI_tangent: number   // From M-κ relationship
): Matrix {
  const Kl = new Matrix(6, 6);

  // Axial stiffness (unchanged - assuming axial remains elastic)
  const EA_L = E * A / L;
  Kl.set(0, 0, EA_L);
  Kl.set(0, 3, -EA_L);
  Kl.set(3, 0, -EA_L);
  Kl.set(3, 3, EA_L);

  // Bending stiffness using tangent EI
  const EI = EI_tangent;
  const EI_L3 = EI / (L * L * L);
  const EI_L2 = EI / (L * L);
  const EI_L = EI / L;

  // v1, v1
  Kl.set(1, 1, 12 * EI_L3);
  // v1, θ1
  Kl.set(1, 2, 6 * EI_L2);
  Kl.set(2, 1, 6 * EI_L2);
  // v1, v2
  Kl.set(1, 4, -12 * EI_L3);
  Kl.set(4, 1, -12 * EI_L3);
  // v1, θ2
  Kl.set(1, 5, 6 * EI_L2);
  Kl.set(5, 1, 6 * EI_L2);

  // θ1, θ1
  Kl.set(2, 2, 4 * EI_L);
  // θ1, v2
  Kl.set(2, 4, -6 * EI_L2);
  Kl.set(4, 2, -6 * EI_L2);
  // θ1, θ2
  Kl.set(2, 5, 2 * EI_L);
  Kl.set(5, 2, 2 * EI_L);

  // v2, v2
  Kl.set(4, 4, 12 * EI_L3);
  // v2, θ2
  Kl.set(4, 5, -6 * EI_L2);
  Kl.set(5, 4, -6 * EI_L2);

  // θ2, θ2
  Kl.set(5, 5, 4 * EI_L);

  return Kl;
}

/**
 * Assemble global stiffness matrix with material nonlinearity (FNL)
 * For steel: uses tangent stiffness from M-κ section states.
 *
 * BETON LOOPT HIER NIET LANGS. De gescheurde buigstijfheid komt uit de
 * rekenkern (NEN-EN 1992-1-1, M-N-κ met de werkelijke wapeningskorf) en wordt
 * per SEGMENT als `section.I` van een deelelement aangeleverd — zie
 * `lib/betonStijfheid.ts`. `solveNonlinear` weigert daarom
 * `materialNonlinear` met `materialType: 'concrete'`.
 */
function assembleGlobalStiffnessFNL(
  mesh: Mesh,
  sectionStates: Map<number, ISectionState>,
  axialForces: Map<number, number>,
  includeGeometric: boolean
): Matrix {
  const numNodes = mesh.getNodeCount();
  const numDofs = numNodes * 3;
  const K = new Matrix(numDofs, numDofs);

  const nodeIdToIndex = new Map<number, number>();
  let index = 0;
  for (const node of mesh.nodes.values()) {
    nodeIdToIndex.set(node.id, index);
    index++;
  }

  for (const beam of mesh.beamElements.values()) {
    const nodes = mesh.getBeamElementNodes(beam);
    if (!nodes) continue;

    const material = mesh.getMaterial(beam.materialId);
    if (!material) continue;

    const [n1, n2] = nodes;
    const L = calculateBeamLength(n1, n2);
    const angle = calculateBeamAngle(n1, n2);

    // Lengte nul: weigeren, niet overslaan — zie `nulElementFout`.
    if (L < 1e-10) throw nulElementFout(beam.id, n1);

    // Steel: use tangent stiffness from M-κ relationship
    const sectionState = sectionStates.get(beam.id);
    const EI_eff = sectionState?.tangentStiffness ?? (material.E * beam.section.I);

    // Local stiffness with effective EI
    const Kl = calculateBeamLocalStiffnessFNL(L, material.E, beam.section.A, beam.section.I, EI_eff);

    // Geometrische stijfheid vóór de condensatie, net als op het
    // geometrische pad — zie `telGeometrischeStijfheidOp`.
    if (includeGeometric) {
      // Zelfde tekenflip als in assembleGlobalStiffnessWithGeometric:
      // recovery-N is druk-positief, Kg verwacht trek-positief.
      const N = -(axialForces.get(beam.id) || 0);
      telGeometrischeStijfheidOp(Kl, L, N);
    }

    // Releases condenseren (Rz-scharnieren + Tx/Tz-hulzen, lokale assen),
    // op Ke + Kg samen.
    const releasedLocalDofs = getReleasedLocalDofs(beam);
    const veren = getSprungLocalDofs(beam);
    if (veren.length > 0) {
      applyEndConnections(Kl, releasedLocalDofs, veren);
    } else if (releasedLocalDofs.length > 0) {
      applyEndReleases(Kl, releasedLocalDofs);
    }

    // Transform to global
    const T = createTransformationMatrix(angle);
    const TT = T.transpose();
    const temp = Kl.multiply(T);
    const Ke = TT.multiply(temp);

    // Get DOF indices
    const idx1 = nodeIdToIndex.get(n1.id)!;
    const idx2 = nodeIdToIndex.get(n2.id)!;
    const dofIndices = [
      idx1 * 3, idx1 * 3 + 1, idx1 * 3 + 2,
      idx2 * 3, idx2 * 3 + 1, idx2 * 3 + 2
    ];

    // Assemble
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        K.addAt(dofIndices[i], dofIndices[j], Ke.get(i, j));
      }
    }
  }

  // Add spring support stiffness
  for (const node of mesh.nodes.values()) {
    const nodeIndex = nodeIdToIndex.get(node.id);
    if (nodeIndex === undefined) continue;
    const c = node.constraints;
    if (c.springX != null && c.x) {
      K.addAt(nodeIndex * 3, nodeIndex * 3, c.springX);
    }
    if (c.springY != null && c.y) {
      K.addAt(nodeIndex * 3 + 1, nodeIndex * 3 + 1, c.springY);
    }
    if (c.springRot != null && c.rotation) {
      K.addAt(nodeIndex * 3 + 2, nodeIndex * 3 + 2, c.springRot);
    }
  }

  return K;
}

/**
 * Update section states based on current displacements
 * For steel: updates M-κ state for plastic hinge tracking.
 */
function updateAllSectionStates(
  mesh: Mesh,
  displacements: number[],
  sectionStates: Map<number, ISectionState>,
  opts: NonlinearSolverOptions
): Map<number, ISectionState> {
  const nodeIdToIndex = new Map<number, number>();
  let index = 0;
  for (const node of mesh.nodes.values()) {
    nodeIdToIndex.set(node.id, index);
    index++;
  }

  const steel = opts.materialType === 'steel' ? createSteelMaterial(opts.steelFy) : undefined;
  const concrete = opts.materialType === 'concrete' ? createConcreteMaterial(opts.concreteFck) : undefined;

  for (const beam of mesh.beamElements.values()) {
    const nodes = mesh.getBeamElementNodes(beam);
    if (!nodes) continue;

    const material = mesh.getMaterial(beam.materialId);
    if (!material) continue;

    const [n1, n2] = nodes;
    const L = calculateBeamLength(n1, n2);
    const angle = calculateBeamAngle(n1, n2);

    if (L < 1e-10) continue;

    const idx1 = nodeIdToIndex.get(n1.id)!;
    const idx2 = nodeIdToIndex.get(n2.id)!;

    // Extract local displacements
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const u1 = displacements[idx1 * 3];
    const v1 = displacements[idx1 * 3 + 1];
    const theta1 = displacements[idx1 * 3 + 2];
    const u2 = displacements[idx2 * 3];
    const v2 = displacements[idx2 * 3 + 1];
    const theta2 = displacements[idx2 * 3 + 2];

    // Transform to local (only transverse displacements needed for curvature)
    const vL1 = -u1 * sin + v1 * cos;
    const vL2 = -u2 * sin + v2 * cos;

    // Calculate curvature at mid-span (approximate)
    // κ ≈ (θ2 - θ1) / L + 6*(vL2 - vL1) / L²
    const kappa = (theta2 - theta1) / L + 6 * (vL2 - vL1) / (L * L);

    // Steel: use M-κ relationship for plastic hinge tracking
    let state = sectionStates.get(beam.id);
    if (!state) {
      state = initSectionState(beam.section, opts.materialType, steel, concrete);
    }

    state = updateSectionState(
      state, kappa, beam.section, opts.materialType,
      steel, concrete,
      undefined, // rebarTop
      undefined  // rebarBot
    );

    sectionStates.set(beam.id, state);
  }

  return sectionStates;
}

/**
 * Assemble force vector from nodal loads and distributed loads
 */
function assembleForceVector(mesh: Mesh): number[] {
  const numNodes = mesh.getNodeCount();
  const F: number[] = new Array(numNodes * 3).fill(0);

  const nodeIdToIndex = new Map<number, number>();
  let index = 0;
  for (const node of mesh.nodes.values()) {
    nodeIdToIndex.set(node.id, index);
    index++;
  }

  // Nodal loads
  for (const node of mesh.nodes.values()) {
    const idx = nodeIdToIndex.get(node.id)!;
    F[idx * 3] = node.loads.fx;
    F[idx * 3 + 1] = node.loads.fy;
    F[idx * 3 + 2] = node.loads.moment || 0;
  }

  // Equivalent nodal forces from distributed loads + thermal loads (ΔT)
  for (const beam of mesh.beamElements.values()) {
    const material = mesh.getMaterial(beam.materialId);

    // Thermische equivalente knoopkrachten (lokaal): uniforme ΔT geeft
    // ±E·A·α·ΔT axiaal; gradient-ΔT ook eindmomenten. Zie ThermalLoad.ts.
    const fThermal = material
      ? calculateBeamThermalLocalForces(beam, material)
      : [0, 0, 0, 0, 0, 0];
    const hasThermal = fThermal.some(v => v !== 0);

    const dLoads = getBeamDistributedLoads(beam);
    if (dLoads.length === 0 && !hasThermal) continue;

    const nodes = mesh.getBeamElementNodes(beam);
    if (!nodes) continue;

    const [n1, n2] = nodes;
    const L = calculateBeamLength(n1, n2);
    const angle = calculateBeamAngle(n1, n2);

    // Equivalente knoopkrachten (lokaal): SOM over alle verdeelde lasten op
    // deze staaf (enkelvoudig veld + deellasten-array). Per last exact
    // dezelfde projectie/dispatch als voorheen inline — zie Beam.ts.
    // (De vroegere inline uniforme tak was formule-identiek aan
    //  calculateDistributedLoadVector.)
    const fLocal: number[] = [0, 0, 0, 0, 0, 0];
    for (const dl of dLoads) {
      const f = calculateDistributedLoadLocalForces(L, angle, dl);
      for (let i = 0; i < 6; i++) fLocal[i] += f[i];
    }

    // Thermiek optellen vóór de scharniercondensatie, zodat beide
    // lastsoorten consistent met de gecondenseerde stijfheid meelopen.
    if (hasThermal) {
      for (let i = 0; i < 6; i++) fLocal[i] += fThermal[i];
    }

    // Krachtcondensatie voor releases (Rz-scharnieren + Tx/Tz-hulzen) —
    // de equivalente knoopkrachten moeten consistent met de gecondenseerde
    // stijfheid meelopen.
    const releasedLocalDofs = getReleasedLocalDofs(beam);
    const veren = getSprungLocalDofs(beam);
    if ((releasedLocalDofs.length > 0 || veren.length > 0) && material) {
      const Kl = calculateBeamLocalStiffness(L, material.E, beam.section.A, beam.section.I);
      if (veren.length > 0) applyEndConnections(Kl, releasedLocalDofs, veren, fLocal);
      else applyEndReleases(Kl, releasedLocalDofs, fLocal);
    }

    // Transform to global
    const T = createTransformationMatrix(angle);
    const TT = T.transpose();
    const fGlobal = new Array(6).fill(0);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        fGlobal[i] += TT.get(i, j) * fLocal[j];
      }
    }

    // Add to global force vector
    const idx1 = nodeIdToIndex.get(n1.id)!;
    const idx2 = nodeIdToIndex.get(n2.id)!;

    F[idx1 * 3] += fGlobal[0];
    F[idx1 * 3 + 1] += fGlobal[1];
    F[idx1 * 3 + 2] += fGlobal[2];
    F[idx2 * 3] += fGlobal[3];
    F[idx2 * 3 + 1] += fGlobal[4];
    F[idx2 * 3 + 2] += fGlobal[5];
  }

  return F;
}

/**
 * Knopen waarvan de draaiing van GEEN enkel element stijfheid krijgt: er hangt
 * minstens één staaf aan, elk staafeinde op de knoop is voor buiging
 * vrijgegeven (een scharnier, lokaal DOF 2 of 5 in `getReleasedLocalDofs`), en
 * geen oplegging of rotatieveer houdt de draaiing vast. Schijfelementen geven
 * in 2D geen draaistijfheid en tellen dus niet mee. Een verend aangesloten
 * staafeind (`spring` met k > 0) is geen scharnier en geeft wel stijfheid.
 *
 * WAAROM (controle 12 oktober 2026, punt B10). In een vakwerk waarin alle
 * staven aan beide einden scharnieren, is de knoopdraaiing onbepaald: ze
 * vervormt niets en heeft geen invloed op de rest. De stijfheidsmatrix heeft
 * daar een rij en kolom van precies nul, en tot oktober 2026 weigerde de kern
 * zo'n stabiel vakwerk als "singulier: knoop 1 kan vrij draaien", terwijl
 * `validate_fem_model` het goedkeurde. Hetzelfde gold voor een pendelstaaf op
 * een scharnieroplegging. De 3D-kern zet zulke draaiingen sinds #96 vast
 * (`open-fem-3d/src/knoopdraaiing.rs`); dit is dezelfde regel, eenvoudiger
 * omdat 2D per knoop maar één draaiing kent en geen torsiekoppeling.
 *
 * `applyBoundaryConditions` (raamwerkpad) en `solveMixed` (staven + schijven)
 * zetten die draaiingen vast met een kunstmatige blokkering. Omdat de rij van
 * K daar nul is, is de reactie van zo'n blokkering precies −F op die draaiing:
 * nul zolang er geen koppel op de knoop werkt. Er verandert dan niets aan de
 * translaties, de krachten en de reacties; alleen de onbepaalde knoopdraaiing
 * ligt op 0. Werkt er wél een koppel, dan is het een echt mechanisme en volgt
 * een fout (`koppelOpScharnierknoop`) in plaats van een stil weggevallen
 * moment. Een mechanisme mét translaties (een raamwerk dat zijdelings kan
 * wegzakken) blijft singulier in de translaties en wordt als zodanig gemeld.
 */
export function vrijeKnoopdraaiingen(mesh: Mesh): number[] {
  const metStaaf = new Set<number>();
  const draaistijf = new Set<number>();
  for (const beam of mesh.beamElements.values()) {
    const [a, b] = beam.nodeIds;
    const los = getReleasedLocalDofs(beam);
    metStaaf.add(a);
    metStaaf.add(b);
    if (!los.includes(2)) draaistijf.add(a);
    if (!los.includes(5)) draaistijf.add(b);
  }
  const uit: number[] = [];
  for (const node of mesh.nodes.values()) {
    if (!metStaaf.has(node.id) || draaistijf.has(node.id)) continue;
    // Een oplegging die de draaiing vasthoudt (inklemming) of een rotatieveer
    // (`springRot`): dan is er al een blokkering of stijfheid.
    if (node.constraints.rotation) continue;
    uit.push(node.id);
  }
  return uit;
}

/**
 * Gooit als er een koppel werkt op een vrij draaiende knoop (zie
 * `vrijeKnoopdraaiingen`). `F` is de krachtvector, `dofVan` geeft per knoop de
 * index van zijn draaiings-DOF. Een waarde onder 1e-9 maal de grootste
 * component telt als afrondingsruis.
 */
function weigerKoppelOpVrijeDraaiing(
  mesh: Mesh,
  F: readonly number[],
  vrij: readonly number[],
  dofVan: (knoopId: number) => number | undefined,
): void {
  let schaal = 0;
  for (const f of F) schaal = Math.max(schaal, Math.abs(f));
  for (const id of vrij) {
    const dof = dofVan(id);
    if (dof === undefined) continue;
    const m = F[dof] ?? 0;
    if (m === 0 || Math.abs(m) <= 1e-9 * schaal) continue;
    const knoop = mesh.nodes.get(id)!;
    throw new SingulierStelselFout({
      meshKnoopId: id,
      xMm: knoop.x * 1000,
      zMm: knoop.y * 1000,
      richting: 'rotatie',
      losseKnoop: false,
      origineel: `koppel van ${(m / 1000).toFixed(3)} kNm op een vrij draaiende knoop`,
      koppelOpScharnierknoop: true,
    });
  }
}

/**
 * Apply boundary conditions using penalty method
 *
 * Ook de knoopdraaiingen zonder stijfheid (`vrijeKnoopdraaiingen`) worden hier
 * vastgezet en staan in `fixedDofs`; een koppel op zo'n knoop is een fout.
 */
export function applyBoundaryConditions(
  K: Matrix,
  F: number[],
  mesh: Mesh
): { K: Matrix; F: number[]; fixedDofs: number[] } {
  const Kmod = K.clone();
  const Fmod = [...F];
  const fixedDofs: number[] = [];

  const nodeIdToIndex = new Map<number, number>();
  let index = 0;
  for (const node of mesh.nodes.values()) {
    nodeIdToIndex.set(node.id, index);
    index++;
  }

  const penalty = 1e20;

  // Knoopdraaiingen zonder stijfheid: vastzetten, en weigeren als er een
  // koppel op werkt (dan is het een mechanisme, geen onbepaalde draaiing).
  const vrij = vrijeKnoopdraaiingen(mesh);
  const draaiDof = (id: number): number | undefined => {
    const i = nodeIdToIndex.get(id);
    return i === undefined ? undefined : i * 3 + 2;
  };
  weigerKoppelOpVrijeDraaiing(mesh, F, vrij, draaiDof);
  for (const id of vrij) {
    const dof = draaiDof(id)!;
    Kmod.set(dof, dof, Kmod.get(dof, dof) + penalty);
    Fmod[dof] = 0;
    fixedDofs.push(dof);
  }

  for (const node of mesh.nodes.values()) {
    const idx = nodeIdToIndex.get(node.id)!;
    const c = node.constraints;

    // Spring DOFs are NOT constrained with penalty — stiffness is added to K diagonal instead
    if (c.x && c.springX == null) {
      const dof = idx * 3;
      Kmod.set(dof, dof, Kmod.get(dof, dof) + penalty);
      Fmod[dof] = 0;
      fixedDofs.push(dof);
    }
    if (c.y && c.springY == null) {
      const dof = idx * 3 + 1;
      Kmod.set(dof, dof, Kmod.get(dof, dof) + penalty);
      Fmod[dof] = 0;
      fixedDofs.push(dof);
    }
    if (c.rotation && c.springRot == null) {
      const dof = idx * 3 + 2;
      Kmod.set(dof, dof, Kmod.get(dof, dof) + penalty);
      Fmod[dof] = 0;
      fixedDofs.push(dof);
    }
  }

  return { K: Kmod, F: Fmod, fixedDofs };
}

/**
 * MECHANISMECONTROLE ZONDER LAST (issue #248) — is het raamwerkstelsel van
 * deze mesh kinematisch bepaald? Geeft de singulariteit terug zoals de
 * berekening haar zou melden, of `null` als het stelsel oplosbaar is.
 *
 * WAAROM HIER, EN NIET IN DE VALIDATIE NAGESCHREVEN. Een rechthoekig raam met
 * alle staafeinden scharnierend is een parallellogrammechanisme. De
 * modelcontrole van `validate_fem_model` keek alleen naar NOODZAKELIJKE
 * voorwaarden (x, z en rotatie ergens gesteund) en keurde het goed, terwijl de
 * berekening het daarna weigerde ("knoop 3 kan vrij horizontaal verschuiven").
 * Een tweede, eigen rangtoets in de validatie zou een tweede antwoord op
 * dezelfde vraag zijn. Deze functie doet daarom PRECIES wat het lineaire
 * raamwerkpad van `solveNonlinear` doet — dezelfde stijfheidsmatrix
 * (scharnieren, eindveren, bedding, opleggingsveren), dezelfde randvoorwaarden
 * (inclusief het vastzetten van onbepaalde knoopdraaiingen,
 * `vrijeKnoopdraaiingen`) en dezelfde stelseloplosser — alleen met een
 * nul-lastvector. Of het stelsel singulier is, hangt niet van de last af; zo
 * keurt de validatie per definitie hetzelfde als de berekening.
 *
 * Alleen het raamwerkpad (staven zonder schijven). Het gemengde pad met
 * schijven heeft een eigen opbouw en wordt hier niet nagebootst.
 */
export function zoekFrameMechanisme(mesh: Mesh): SingulierStelselFout | null {
  const K = assembleGlobalStiffnessWithGeometric(mesh, new Map(), false);
  const F = new Array<number>(K.rows).fill(0);
  const { K: Kbc, F: Fbc } = applyBoundaryConditions(K, F, mesh);
  try {
    losFrameStelselOp(Kbc, Fbc, mesh);
    return null;
  } catch (e) {
    if (e instanceof SingulierStelselFout) return e;
    throw e;
  }
}

/**
 * Calculate internal forces for all beam elements
 *
 * `kgNormaalkrachten`: na een P-Δ-oplossing de normaalkrachten (druk-positief,
 * de vorm van `axialForces`) waarmee K_G in het stelsel zat. De eindkrachten
 * komen dan uit (K_E + K_G)·u, zodat ze in evenwicht zijn met de reacties uit
 * dezelfde matrix (zie `calculateBeamInternalForces`). Weglaten = K_E·u.
 */
function calculateAllInternalForces(
  mesh: Mesh,
  displacements: number[],
  kgNormaalkrachten?: Map<number, number>,
): { beamForces: Map<number, IBeamForces>; axialForces: Map<number, number> } {
  const beamForces = new Map<number, IBeamForces>();
  const axialForces = new Map<number, number>();

  const nodeIdToIndex = new Map<number, number>();
  let index = 0;
  for (const node of mesh.nodes.values()) {
    nodeIdToIndex.set(node.id, index);
    index++;
  }

  for (const beam of mesh.beamElements.values()) {
    const nodes = mesh.getBeamElementNodes(beam);
    if (!nodes) continue;

    const material = mesh.getMaterial(beam.materialId);
    if (!material) continue;

    const [n1, n2] = nodes;
    const idx1 = nodeIdToIndex.get(n1.id)!;
    const idx2 = nodeIdToIndex.get(n2.id)!;

    const globalDisp = [
      displacements[idx1 * 3],
      displacements[idx1 * 3 + 1],
      displacements[idx1 * 3 + 2],
      displacements[idx2 * 3],
      displacements[idx2 * 3 + 1],
      displacements[idx2 * 3 + 2]
    ];

    // K_G verwacht N trek-positief; `axialForces` is druk-positief (zie
    // `assembleGlobalStiffnessWithGeometric`).
    const nKg = kgNormaalkrachten ? -(kgNormaalkrachten.get(beam.id) || 0) : undefined;
    const forces = calculateBeamInternalForces(beam, n1, n2, material, globalDisp, nKg);
    beamForces.set(beam.id, forces);

    // Average axial force for geometric stiffness
    axialForces.set(beam.id, (forces.N1 + forces.N2) / 2);
  }

  return { beamForces, axialForces };
}

/**
 * Stabiliteitscheck voor 2e-orde: tel het aantal negatieve (en bijna-nul)
 * pivots van de symmetrische matrix K via eliminatie ZONDER rijwisselingen.
 * Volgens de traagheidswet van Sylvester is dat het aantal negatieve
 * eigenwaarden. Voor K = Ke + Kg(N) betekent ≥ 1 negatieve eigenwaarde dat
 * de belasting de kritieke (knik)waarde van minstens één mode overschrijdt —
 * de geïtereerde P-Δ kan dan wél "convergeren", maar naar een fysisch
 * betekenisloze oplossing voorbij het knikpunt. Vandaar deze aparte check.
 *
 * Bijna-nul-pivots (|piv| < 1e-10 × |oorspronkelijke diagonaal|) tellen ook
 * mee: dan zit de belasting op (of numeriek onhoudbaar dicht bij) de
 * kritieke waarde.
 */
export function countNonPositivePivots(K: Matrix): number {
  const n = K.rows;
  // Dense kopie voor in-place eliminatie
  const a: number[][] = [];
  const diag0: number[] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) row.push(K.get(i, j));
    a.push(row);
    diag0.push(Math.abs(K.get(i, i)) || 1);
  }

  let nonPositive = 0;
  for (let col = 0; col < n; col++) {
    const piv = a[col][col];
    if (!Number.isFinite(piv) || Math.abs(piv) < 1e-10 * diag0[col]) {
      // (bijna) singulier — conservatief als instabiel tellen en stoppen
      return nonPositive + 1;
    }
    if (piv < 0) nonPositive++;
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / piv;
      if (factor === 0) continue;
      for (let j = col; j < n; j++) {
        a[row][j] -= factor * a[col][j];
      }
    }
  }
  return nonPositive;
}

/**
 * Main nonlinear solver using Newton-Raphson iteration
 */
export function solveNonlinear(
  mesh: Mesh,
  options: Partial<NonlinearSolverOptions> = {}
): ISolverResult {
  const groepen = verzamelAxiaalGroepen(mesh);
  if (groepen.length === 0) return solveNonlinearKern(mesh, options);
  return losOpMetAxiaalVoorwaarden(mesh, options, groepen);
}

// ── Trek-alleen (en druk-alleen) staven — issue #234 ──────────────────────
//
// WAT. Een windverband van strip of rondstaal kan geen druk opnemen: het
// knikt bij een verwaarloosbare kracht uit en draagt dan niets meer. Van een
// kruisverband werkt dus alleen de getrokken diagonaal. Rekent het model
// beide diagonalen als gewone staaf, dan krijgt de trekdiagonaal ongeveer de
// helft van de kracht (onveilig) en wordt de drukdiagonaal op knik afgekeurd
// (te streng) — gemeten in issue #234: −53 % in de trekschoor.
//
// HOE. Iteratief, per oplossing (dus per belastinggeval of per combinatie;
// superpositie geldt niet meer):
//   1. alle trek-alleen staven actief, oplossen;
//   2. een actieve staaf(groep) met een gemiddelde drukkracht wordt
//      uitgeschakeld: een normaalkrachthuls aan het eind van het laatste
//      deelelement (lokaal DOF u2), dezelfde statische condensatie als een
//      release Tx. Lasten, krachtenrecovery, K_g en het gemengde pad volgen
//      die release vanzelf via `getReleasedLocalDofs`;
//   3. een uitgeschakelde staaf wordt weer actief als hij in de nieuwe stand
//      zou rekken: N_proef = EA/L·δ − N_th > 0, met δ de verlenging tussen
//      zijn eindknopen (de knoopverplaatsing, niet het losgemaakte
//      staafeinde) en N_th de thermische term;
//   4. herhalen tot de verzameling uitgeschakelde staven niet meer verandert.
// Een stand die al eerder voorkwam (kringloop) of het maximum aantal rondes
// is een FOUT met de betrokken staven — geen stille laatste stand.
//
// Het wordt hier, op het niveau van de hele oplossing, gedaan zodat elk pad —
// lineair, P-Δ, fysisch niet-lineair, staven met schijven — hetzelfde doet.
// Bij P-Δ is dat een buitenlus om de geometrisch niet-lineaire oplossing.
// De oude, alleen lineaire, route (`solveWithAxialConstraints`) maakte de
// assemblage wel axiaal los, maar de lastvector en de krachtenrecovery niet,
// en las de normaalkracht van een losgemaakte staaf (altijd 0) om te beslissen
// of hij terug moest: dat sloeg om en om tot het maximum.

/** Eén trek-alleen of druk-alleen staafgroep (een modelstaaf met zijn deelelementen). */
interface AxiaalGroep {
  sleutel: number;
  soort: 'trek' | 'druk';
  /** Rekenelement-id's in kettingvolgorde (invoegvolgorde van de mesh). */
  staafIds: number[];
}

const MAX_AXIAAL_RONDES = 50;

function verzamelAxiaalGroepen(mesh: Mesh): AxiaalGroep[] {
  const groepen = new Map<number, AxiaalGroep>();
  for (const beam of mesh.beamElements.values()) {
    let soort: 'trek' | 'druk' | null = null;
    if (beam.tensionOnly) soort = 'trek';
    else {
      // Oude aanduiding via het aansluitingstype ('tension_only' /
      // 'pressure_only'); de app zet die niet, maar de kern kende hem.
      const { start, end } = getConnectionTypes(beam);
      if (start === 'tension_only' || end === 'tension_only') soort = 'trek';
      else if (start === 'pressure_only' || end === 'pressure_only') soort = 'druk';
    }
    if (!soort) continue;
    const sleutel = beam.tensionOnly ? (beam.tensionOnlyGroup ?? beam.id) : beam.id;
    const g = groepen.get(sleutel);
    if (g) g.staafIds.push(beam.id);
    else groepen.set(sleutel, { sleutel, soort, staafIds: [beam.id] });
  }
  return [...groepen.values()];
}

/**
 * Maak een rekenelement axiaal los aan zijn eind (Tx = 'hinge' op het
 * eindeinde) en geef de functie terug die het oorspronkelijke element
 * terugzet. `updateBeamElement` vervangt het object in de mesh; het origineel
 * blijft dus onaangeroerd en gaat bij het herstellen gewoon terug.
 */
export function maakAxiaalLos(mesh: Mesh, beamId: number): () => void {
  const origineel = mesh.beamElements.get(beamId);
  if (!origineel) return () => {};
  const { start, end } = getDOFConnectionTypes(origineel);
  mesh.updateBeamElement(beamId, {
    startConnections: { ...start },
    endConnections: { ...end, Tx: 'hinge' },
  });
  return () => { mesh.beamElements.set(beamId, origineel); };
}

/**
 * Schakel de gegeven trek-alleen groepen uit (zie `maakAxiaalLos`). Voor wie
 * buiten de solver met dezelfde stand verder rekent, zoals de bepaling van
 * α_cr met de actieve staven (alphaCr.ts).
 */
export function schakelAxiaalGroepenUit(mesh: Mesh, sleutels: Iterable<number>): () => void {
  const uit = new Set(sleutels);
  const herstel: (() => void)[] = [];
  for (const g of verzamelAxiaalGroepen(mesh)) {
    if (uit.has(g.sleutel)) herstel.push(maakAxiaalLos(mesh, g.staafIds[g.staafIds.length - 1]));
  }
  return () => { for (const h of herstel.reverse()) h(); };
}

function losOpMetAxiaalVoorwaarden(
  mesh: Mesh,
  options: Partial<NonlinearSolverOptions>,
  groepen: AxiaalGroep[],
): ISolverResult {
  const log = (regel: SolverLogRegel): void => { options.onLog?.(regel); };
  // Knoopindex van de verplaatsingsvector: het gemengde pad nummert alleen
  // de actieve knopen, het frame-pad alle knopen in invoegvolgorde.
  const index = options.analysisType === 'mixed_beam_plate'
    ? buildNodeIdToIndex(mesh, 'mixed_beam_plate')
    : new Map([...mesh.nodes.keys()].map((id, i) => [id, i] as const));

  const naam = (sleutels: Iterable<number>) => [...sleutels].sort((a, b) => a - b).join(', ');

  // Bij tweede orde (en fysisch niet-lineair) convergeert de verzameling eerst
  // met lineaire rondes; daarna volgen de niet-lineaire rondes vanaf die
  // verzameling — dezelfde aanpak als de 3D-kern (open-fem-3d/trek_alleen.rs).
  // Zonder die eerste fase rekent de eerste P-Δ-ronde met álle verbanden
  // actief; staan ze daarin allemaal op druk (kolomverkorting onder grote
  // verticale last), dan valt in de tweede ronde het hele verband weg, en
  // knikt een ongeschoord portaal dat in de eindstand wél geschoord is.
  // Gemeten: portaal HEA120 met 2 × 240 kN en wind, eindstand schoor 4 actief,
  // maar een "niet convergent"-fout via de tussenstand zonder verbanden.
  let uit = new Set<number>();
  if (options.geometricNonlinear || options.materialNonlinear) {
    uit = axiaalRondes(mesh, { ...options, geometricNonlinear: false, materialNonlinear: false },
      groepen, index, uit, naam, log).uit;
  }
  const { res, uit: eind } = axiaalRondes(mesh, options, groepen, index, uit, naam, log);
  return { ...res, axiaalUitgeschakeld: [...eind].sort((a, b) => a - b) };
}

/** De statusrondes van één fase, vanaf de verzameling `start`. */
function axiaalRondes(
  mesh: Mesh,
  options: Partial<NonlinearSolverOptions>,
  groepen: AxiaalGroep[],
  index: Map<number, number>,
  start: Set<number>,
  naam: (sleutels: Iterable<number>) => string,
  log: (regel: SolverLogRegel) => void,
): { res: ISolverResult; uit: Set<number> } {
  let uit = new Set(start);
  const gezien = new Set<string>();
  for (let ronde = 1; ronde <= MAX_AXIAAL_RONDES; ronde++) {
    const herstel = schakelAxiaalGroepenUit(mesh, uit);
    let res: ISolverResult;
    try {
      res = solveNonlinearKern(mesh, options);
    } catch (e) {
      if (uit.size > 0 && e instanceof SingulierStelselFout) {
        e.aanvulling =
          `Dat ontstaat doordat de gedrukte trek-alleen staaf/staven (rekengroep ${naam(uit)}) ` +
          'zijn uitgeschakeld: zonder hen is de constructie in deze belasting niet stabiel. ' +
          'Voeg een verband toe dat in deze richting op trek werkt.';
      }
      throw e;
    } finally {
      herstel();
    }

    // Per groep de (proef)normaalkracht, trek positief.
    const kracht = new Map<number, number>();
    let schaal = 0;
    for (const g of groepen) {
      let som = 0;
      for (const id of g.staafIds) {
        const beam = mesh.beamElements.get(id)!;
        if (!uit.has(g.sleutel)) {
          const bf = res.beamForces.get(id);
          // N1/N2 zijn DRUK-positief (BeamForces.ts).
          som += bf ? -(bf.N1 + bf.N2) / 2 : 0;
        } else {
          const knopen = mesh.getBeamElementNodes(beam);
          const material = mesh.getMaterial(beam.materialId);
          if (!knopen || !material) continue;
          const [n1, n2] = knopen;
          const i1 = index.get(n1.id), i2 = index.get(n2.id);
          if (i1 === undefined || i2 === undefined) continue;
          const L = Math.hypot(n2.x - n1.x, n2.y - n1.y);
          const c = (n2.x - n1.x) / L, sn = (n2.y - n1.y) / L;
          const d = res.displacements;
          const delta = (d[i2 * 3] - d[i1 * 3]) * c + (d[i2 * 3 + 1] - d[i1 * 3 + 1]) * sn;
          const thermisch = calculateBeamThermalLocalForces(beam, material)[3];
          som += material.E * beam.section.A / L * delta - thermisch;
        }
      }
      const n = som / g.staafIds.length;
      kracht.set(g.sleutel, n);
      schaal = Math.max(schaal, Math.abs(n));
    }
    // Een kracht van 1e-9 van de grootste telt als nul: een staaf die precies
    // spanningsloos is, blijft in de stand waarin hij staat.
    const tol = 1e-9 * Math.max(schaal, 1);
    const volgende = new Set<number>();
    for (const g of groepen) {
      const n = kracht.get(g.sleutel)!;
      const nuUit = uit.has(g.sleutel);
      const ongunstig = g.soort === 'trek' ? n < -tol : n > tol;
      const gunstig = g.soort === 'trek' ? n > tol : n < -tol;
      if (nuUit ? !gunstig : ongunstig) volgende.add(g.sleutel);
    }

    const sleutel = naam(volgende);
    if (sleutel === naam(uit)) {
      log({
        soort: 'info',
        tekst: uit.size > 0
          ? `Trek-alleen: na ${ronde} ronde(s) uitgeschakeld (gedrukt): rekengroep ${naam(uit)}`
          : `Trek-alleen: na ${ronde} ronde(s) alle ${groepen.length} staaf(groep)en actief`,
      });
      return { res, uit };
    }
    gezien.add(naam(uit));
    if (gezien.has(sleutel)) {
      throw new Error(
        'De trek-alleen-iteratie keert terug naar een eerdere stand en convergeert niet ' +
        `(uitgeschakeld afwisselend ${naam(uit) || 'geen'} en ${sleutel || 'geen'}). ` +
        'Er is geen eenduidige krachtsverdeling met alleen getrokken verbanden; ' +
        'controleer de verbanden of maak een ervan een gewone staaf.'
      );
    }
    log({ soort: 'info', tekst: `Trek-alleen ronde ${ronde}: uitgeschakeld ${sleutel || 'geen'}` });
    uit = volgende;
  }
  throw new Error(
    `De trek-alleen-iteratie is na ${MAX_AXIAAL_RONDES} rondes niet geconvergeerd; ` +
    'er wordt geen krachtsverdeling gegeven.'
  );
}

function solveNonlinearKern(
  mesh: Mesh,
  options: Partial<NonlinearSolverOptions> = {}
): ISolverResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Mixed beam+plate analysis: beams AND plates together
  if (opts.analysisType === 'mixed_beam_plate') {
    return solveMixed(mesh, opts);
  }

  // For plate-related analyses, delegate to the Assembler-based path
  // But if there are no plate/triangle elements, fall back to frame analysis for beams
  if (opts.analysisType === 'plate_bending' || opts.analysisType === 'plane_stress' || opts.analysisType === 'plane_strain') {
    if (mesh.elements.size > 0) {
      return solvePlateOrPlane(mesh, opts);
    }
    // No plate elements — fall back to frame if there are beams
    if (mesh.getBeamCount() > 0) {
      opts.analysisType = 'frame';
    } else {
      throw new Error('Model must have plate elements for this analysis type, or beams for frame analysis');
    }
  }

  // Validate frame analysis
  if (mesh.getNodeCount() < 2) {
    throw new Error('Model must have at least 2 nodes');
  }
  if (mesh.getBeamCount() < 1) {
    throw new Error('Model must have at least 1 beam element');
  }

  // Check for constraints
  let hasConstraints = false;
  for (const node of mesh.nodes.values()) {
    if (node.constraints.x || node.constraints.y || node.constraints.rotation) {
      hasConstraints = true;
      break;
    }
  }
  if (!hasConstraints) {
    throw new Error('Model has no constraints - add boundary conditions');
  }

  // Check for loads
  const F = assembleForceVector(mesh);
  // Een lastvector die na de scharniercondensatie nul is, is geen ontbrekende
  // last zolang er elementlasten zijn — zie `heeftElementlasten`. Dan lost het
  // stelsel K·u = 0 gewoon op (u = 0) en levert de krachtenrecovery de
  // thermische en verdeelde lasten binnen de elementen.
  const hasLoads = F.some(f => f !== 0) || heeftElementlasten(mesh);
  if (!hasLoads) {
    throw new Error('No loads applied - add forces to nodes');
  }

  const numDofs = mesh.getNodeCount() * 3;
  let displacements = new Array(numDofs).fill(0);
  let axialForces = new Map<number, number>();

  /**
   * Meld een regel, als er iemand luistert. De tekst wordt binnen deze functie
   * opgebouwd, dus zonder luisteraar kost het log niets.
   */
  const log = (regel: SolverLogRegel): void => {
    opts.onLog?.(regel);
  };

  const soortAnalyse = opts.materialNonlinear
    ? (opts.geometricNonlinear ? 'fysisch én geometrisch niet-lineair' : 'fysisch niet-lineair')
    : (opts.geometricNonlinear ? 'geometrisch niet-lineair (P-Δ)' : 'lineair');
  log({
    soort: 'info',
    tekst:
      `Model: ${mesh.getNodeCount()} knopen, ${mesh.beamElements.size} staven, ` +
      `${numDofs} vrijheidsgraden — ${soortAnalyse}`,
  });

  // Initialize section states for material nonlinearity
  let sectionStates = new Map<number, ISectionState>();

  if (opts.materialNonlinear) {
    // Beton kent hier geen materiaalmodel meer. Er stond er wel een — met een
    // geschatte wapening (0,5 % van het betonoppervlak) en b en h
    // teruggerekend uit A en I — maar dat was een tweede antwoord op een vraag
    // die de rekenkern al beantwoordt, mét de werkelijke wapeningskorf. Een
    // stille terugval op de ongescheurde EI zou hier het ergste van twee
    // werelden zijn: fysisch niet-lineair heten en het niet zijn.
    if (opts.materialType === 'concrete') {
      throw new Error(
        'Fysisch niet-lineair beton loopt niet via deze solver. De gescheurde ' +
        'buigstijfheid komt per segment uit de rekenkern (NEN-EN 1992-1-1, ' +
        'M-N-κ met de wapeningskorf) en wordt als section.I van de ' +
        'deelelementen aangeleverd — zie lib/betonStijfheid.ts.'
      );
    }
    const steel = createSteelMaterial(opts.steelFy);

    for (const beam of mesh.beamElements.values()) {
      const material = mesh.getMaterial(beam.materialId);
      if (!material) continue;

      // Steel: use M-κ section state
      const state = initSectionState(beam.section, opts.materialType, steel, undefined);
      sectionStates.set(beam.id, state);
    }
  }

  // For linear analysis, just solve once. Trek-alleen staven: zie
  // `losOpMetAxiaalVoorwaarden` — die lus ligt om deze functie heen.
  if (!opts.geometricNonlinear && !opts.materialNonlinear) {
    const K = assembleGlobalStiffnessWithGeometric(mesh, axialForces, false);
    log({ soort: 'info', tekst: `Stijfheidsmatrix geassembleerd (${K.rows}×${K.cols})` });
    const { K: Kbc, F: Fbc } = applyBoundaryConditions(K, F, mesh);
    log({ soort: 'info', tekst: 'Randvoorwaarden toegepast' });
    displacements = losFrameStelselOp(Kbc, Fbc, mesh);
    log({ soort: 'info', tekst: 'Stelsel opgelost — één keer, want lineair' });

    const { beamForces, axialForces: newAxial } = calculateAllInternalForces(mesh, displacements);
    axialForces = newAxial;

    // Calculate reactions
    const reactions = K.multiplyVector(displacements);
    for (let i = 0; i < reactions.length; i++) {
      reactions[i] = reactions[i] - F[i];
    }

    // Find max values for scaling
    let maxVonMises = 0;
    for (const forces of beamForces.values()) {
      maxVonMises = Math.max(maxVonMises, Math.abs(forces.maxM));
    }

    return {
      displacements,
      reactions,
      elementStresses: new Map(),
      beamForces,
      maxVonMises,
      minVonMises: 0
    };
  }

  // Nonlinear iteration (P-Delta and/or FNL analysis)
  //
  // Iteratieschema (geometrisch): geïtereerde P-Δ. Iteratie 0 lost 1e-orde op
  // (axialForces leeg → Kg = 0); elke volgende iteratie herassembleert
  // K = Ke + Kg(N_vorige) en lost het residu F − K·u op. Voor het (in u)
  // lineaire P-Δ-probleem is dit de klassieke vaste-punt-iteratie met
  // convergentieratio ≈ P/P_kritiek per iteratie.
  //
  // CONVERGENTIECRITERIUM: relatieve verplaatsingsincrement-norm
  //     ‖Δu‖ ≤ tolerance · ‖u‖
  // Het oude criterium (residunorm/krachtnorm) was kapot: het residu bevatte
  // op vaste DOF's de reactiekrachten (F_bc = 0 daar, K·u = reactie), die
  // per definitie niet naar nul gaan — de toets sloeg dus nooit aan.
  //
  // DIVERGENTIEDETECTIE (alleen geometrisch pad): als de increment-norm 3
  // iteraties op rij groeit, of niet-eindig wordt, of K (bijna) singulier
  // raakt, of maxIterations wordt bereikt zonder convergentie, dan is de
  // belasting op of boven de kritieke (knik)waarde → duidelijke Error
  // (stroomt via engine.ts als nette NL-melding naar de UI).
  let beamForces = new Map<number, IBeamForces>();

  const DIVERGENCE_MSG =
    'Second-order (P-Delta) analysis did not converge — the applied load is at or above the critical (buckling) load';

  for (let step = 1; step <= opts.loadSteps; step++) {
    const loadFactor = step / opts.loadSteps;
    const scaledF = F.map(f => f * loadFactor);

    let converged = false;
    let prevIncrNorm = Infinity;
    let growthCount = 0;

    for (let iter = 0; iter < opts.maxIterations; iter++) {
      // Assemble stiffness with current state
      let K: Matrix;
      if (opts.materialNonlinear) {
        // Use effective stiffness from material state (M-κ for steel, cracked I for concrete)
        K = assembleGlobalStiffnessFNL(
          mesh, sectionStates, axialForces, opts.geometricNonlinear
        );
      } else {
        // Geometric nonlinearity only
        K = assembleGlobalStiffnessWithGeometric(mesh, axialForces, true);
      }

      const { K: Kbc, F: Fbc, fixedDofs } = applyBoundaryConditions(K, scaledF, mesh);

      // Residual t.o.v. de huidige stand; op vaste DOF's is het residu per
      // definitie 0 (K·u geeft daar de reactie, geen onbalans).
      const internalForces = K.multiplyVector(displacements);
      const residual = Fbc.map((f, i) => f - internalForces[i]);
      for (const dof of fixedDofs) residual[dof] = 0;

      // Solve for displacement increment
      let deltaU: number[];
      try {
        deltaU = solveLinearSystem(Kbc, residual);
      } catch (e) {
        // In de EERSTE iteratie van de eerste laststap is Kg nog nul (er zijn
        // nog geen normaalkrachten): een singuliere K is dan een mechanisme
        // (losse knoop, vrij draaiende knoop) en geen knik. Die melding
        // "belasting boven de kniklast" zou naar de verkeerde oorzaak wijzen.
        if (opts.geometricNonlinear && !(step === 1 && iter === 0)) throw new Error(DIVERGENCE_MSG);
        throw vertaalSingulier(e, mesh, undefined, Kbc);
      }

      // Update displacements
      for (let i = 0; i < numDofs; i++) {
        displacements[i] += deltaU[i];
      }

      // Update internal forces
      const forcesResult = calculateAllInternalForces(mesh, displacements);
      axialForces = forcesResult.axialForces;
      beamForces = forcesResult.beamForces;

      // Update section states for material nonlinearity
      if (opts.materialNonlinear) {
        sectionStates = updateAllSectionStates(mesh, displacements, sectionStates, opts);
      }

      const incrNorm = Math.sqrt(deltaU.reduce((s, d) => s + d * d, 0));
      const dispNorm = Math.sqrt(displacements.reduce((s, d) => s + d * d, 0));

      log({
        soort: 'iteratie',
        laststap: step,
        iteratie: iter + 1,
        incrementNorm: incrNorm,
        verplaatsingsNorm: dispNorm,
        tekst: `‖Δu‖ = ${incrNorm.toExponential(3)}, ‖u‖ = ${dispNorm.toExponential(3)}`,
      });

      if (!Number.isFinite(incrNorm) || !Number.isFinite(dispNorm)) {
        log({ soort: 'fout', tekst: 'De normen zijn niet-eindig — het stelsel loopt weg' });
        if (opts.geometricNonlinear) throw new Error(DIVERGENCE_MSG);
        break;
      }

      // Convergentie: relatieve increment-norm
      if (incrNorm <= opts.tolerance * Math.max(dispNorm, 1e-30)) {
        converged = true;
        log({
          soort: 'info',
          tekst:
            `Laststap ${step} geconvergeerd in ${iter + 1} iteratie(s) ` +
            `(tolerantie ${opts.tolerance.toExponential(0)})`,
        });
        break;
      }

      // Divergentie: increment-norm groeit structureel (ratio P/P_kr > 1)
      if (iter >= 1 && incrNorm > prevIncrNorm) {
        growthCount++;
      } else {
        growthCount = 0;
      }
      if (growthCount >= 3 && opts.geometricNonlinear) {
        log({
          soort: 'fout',
          tekst: 'De increment-norm groeit drie iteraties op rij — de last ligt op of boven de kniklast',
        });
        throw new Error(DIVERGENCE_MSG);
      }
      prevIncrNorm = incrNorm;
    }

    if (!converged && !opts.geometricNonlinear) {
      log({
        soort: 'waarschuwing',
        tekst:
          `Laststap ${step} bereikte ${opts.maxIterations} iteraties zonder te convergeren; ` +
          `de laatste stand wordt aangehouden`,
      });
    }

    if (!converged && opts.geometricNonlinear) {
      throw new Error(
        `Second-order (P-Delta) analysis did not converge within ${opts.maxIterations} iterations — the load is at, above, or very close to the critical (buckling) load`
      );
    }
  }

  // Final internal forces calculation (if not already calculated)
  if (beamForces.size === 0) {
    const forcesResult = calculateAllInternalForces(mesh, displacements);
    beamForces = forcesResult.beamForces;
    axialForces = forcesResult.axialForces;
  }

  // Calculate reactions using the final stiffness matrix
  let K: Matrix;
  if (opts.materialNonlinear) {
    K = assembleGlobalStiffnessFNL(
      mesh, sectionStates, axialForces, opts.geometricNonlinear
    );
  } else {
    K = assembleGlobalStiffnessWithGeometric(mesh, axialForces, opts.geometricNonlinear);
  }

  // Tweede orde: de staafkrachten uit DEZELFDE K_E + K_G(N) als de reacties
  // hieronder, met dezelfde N. Met alleen K_E·u sloot het knoopevenwicht niet
  // (zie `calculateBeamInternalForces`). De normaalkrachten zelf veranderen
  // niet: K_G heeft geen axiale termen.
  if (opts.geometricNonlinear) {
    beamForces = calculateAllInternalForces(mesh, displacements, axialForces).beamForces;
  }

  // Stabiliteitscheck: boven de kniklast "convergeert" de geïtereerde P-Δ
  // vaak alsnog (N hangt nauwelijks van u af, dus Kg ligt na iteratie 1 vast
  // en het indefiniete stelsel heeft gewoon een vast punt) — maar dan is
  // K = Ke + Kg indefiniet en de oplossing fysisch betekenisloos. Detecteer
  // dat via negatieve pivots (Sylvester) op de finale K mét randvoorwaarden.
  if (opts.geometricNonlinear) {
    const { K: Kstab } = applyBoundaryConditions(K, F, mesh);
    const nietPositief = countNonPositivePivots(Kstab);
    if (nietPositief > 0) {
      log({
        soort: 'fout',
        tekst:
          `Stabiliteitscontrole: ${nietPositief} niet-positieve pivot(s) in K = Ke + Kg — ` +
          `de matrix is indefiniet en de oplossing fysisch betekenisloos`,
      });
      throw new Error(
        'Second-order (P-Delta) analysis is unstable — the applied load is at or above the critical (buckling) load'
      );
    }
    log({ soort: 'info', tekst: 'Stabiliteitscontrole: K = Ke + Kg is positief definiet' });
  }

  const reactions = K.multiplyVector(displacements);
  for (let i = 0; i < reactions.length; i++) {
    reactions[i] = reactions[i] - F[i];
  }

  // Find max values
  let maxVonMises = 0;
  for (const forces of beamForces.values()) {
    maxVonMises = Math.max(maxVonMises, Math.abs(forces.maxM));
  }

  return {
    displacements,
    reactions,
    elementStresses: new Map(),
    beamForces,
    maxVonMises,
    minVonMises: 0,
  };
}

/**
 * Solve plane stress/strain or plate bending using the Assembler module.
 */
function solvePlateOrPlane(
  mesh: Mesh,
  opts: NonlinearSolverOptions
): ISolverResult {
  const analysisType = opts.analysisType;
  const dofsPerNode = getDofsPerNode(analysisType);

  // Validate
  if (mesh.elements.size < 1) {
    throw new Error('Model must have at least 1 plate element');
  }

  // Get active nodes (nodes connected to elements) - IMPORTANT: only these are used by the solver
  const activeNodeIds = buildNodeIdToIndex(mesh, analysisType);

  // Collect all node IDs that are connected to elements
  const elementNodeIds = new Set<number>();
  for (const element of mesh.elements.values()) {
    for (const nid of element.nodeIds) {
      elementNodeIds.add(nid);
    }
  }

  // === CONSTRAINT TRANSLATION ===
  // If constraints are on nodes NOT connected to elements, transfer them to the nearest active node
  // This handles the case where the UI places constraints on polygon vertices that don't match mesh nodes
  const constraintTransfers: Array<{ fromId: number; toId: number; dist: number }> = [];

  for (const node of mesh.nodes.values()) {
    const hasConstraint = node.constraints.x || node.constraints.y || node.constraints.rotation;
    const hasLoad = node.loads.fx !== 0 || node.loads.fy !== 0 || (node.loads.moment && node.loads.moment !== 0);

    if ((hasConstraint || hasLoad) && !activeNodeIds.has(node.id)) {
      // This node has constraints/loads but is not connected to any element
      // Find the nearest active node and transfer the constraint/load
      let nearestActiveId: number | null = null;
      let nearestDist = Infinity;

      for (const activeId of activeNodeIds.keys()) {
        const activeNode = mesh.getNode(activeId);
        if (!activeNode) continue;
        const dist = Math.sqrt((node.x - activeNode.x) ** 2 + (node.y - activeNode.y) ** 2);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestActiveId = activeId;
        }
      }

      if (nearestActiveId !== null && nearestDist < 0.5) { // 0.5m tolerance
        const targetNode = mesh.getNode(nearestActiveId);
        if (targetNode) {
          // Transfer constraints
          if (hasConstraint) {
            targetNode.constraints = {
              x: targetNode.constraints.x || node.constraints.x,
              y: targetNode.constraints.y || node.constraints.y,
              rotation: targetNode.constraints.rotation || node.constraints.rotation,
              springX: node.constraints.springX ?? targetNode.constraints.springX,
              springY: node.constraints.springY ?? targetNode.constraints.springY,
              springRot: node.constraints.springRot ?? targetNode.constraints.springRot,
            };
          }
          // Transfer loads
          if (hasLoad) {
            targetNode.loads = {
              fx: targetNode.loads.fx + node.loads.fx,
              fy: targetNode.loads.fy + node.loads.fy,
              moment: (targetNode.loads.moment || 0) + (node.loads.moment || 0),
            };
          }
          constraintTransfers.push({ fromId: node.id, toId: nearestActiveId, dist: nearestDist });
        }
      }
    }
  }

  if (constraintTransfers.length > 0) {
    console.log(`[Plate Solver] Transferred ${constraintTransfers.length} constraint(s) to mesh nodes`);
  }

  // Re-check constraints after transfer
  let hasActiveConstraints = false;
  let hasAnyConstraints = false;
  for (const node of mesh.nodes.values()) {
    if (node.constraints.x || node.constraints.y || node.constraints.rotation) {
      hasAnyConstraints = true;
      if (activeNodeIds.has(node.id)) {
        hasActiveConstraints = true;
      }
    }
  }

  if (!hasAnyConstraints) {
    throw new Error('Model has no constraints - add boundary conditions');
  }

  if (!hasActiveConstraints) {
    // List nodes with constraints that couldn't be transferred
    const problemNodes: string[] = [];
    for (const node of mesh.nodes.values()) {
      if ((node.constraints.x || node.constraints.y || node.constraints.rotation) && !activeNodeIds.has(node.id)) {
        problemNodes.push(`Node ${node.id} at (${node.x.toFixed(3)}, ${node.y.toFixed(3)})`);
      }
    }
    throw new Error(`Constraints are not on mesh nodes and couldn't be transferred. Problem nodes: ${problemNodes.join('; ')}`);
  }

  // Assemble
  const K = assembleGlobalStiffnessMatrix(mesh, analysisType);
  const F = assembleForceVectorNew(mesh, analysisType);
  const { dofs: constrainedDofs, nodeIdToIndex } = getConstrainedDofs(mesh, analysisType);
  // GEEN vastzetten van vrije knoopdraaiingen (`vrijeKnoopdraaiingen`) op dit
  // pad: plane_stress, plane_strain en plate_bending assembleren geen staven,
  // dus er is geen staafdraaiing om vast te zetten. De DOF-indeling is hier
  // ook een andere (2 per knoop bij een schijf; bij plaatbuiging is index 2
  // θy): een index i·3+2 wees naar een translatie van een andere knoop en zette
  // die stil vast, of viel buiten de matrix (controle 12 oktober 2026, B10).

  // Check for sufficient constraints to prevent rigid body motion (need at least 3 DOFs constrained for 2D)
  if (constrainedDofs.length < 3) {
    throw new Error(`Insufficient constraints: ${constrainedDofs.length} DOFs constrained, need at least 3 to prevent rigid body motion`);
  }

  const hasLoads = F.some(f => f !== 0);
  if (!hasLoads) {
    // Debug: check if loads exist but on inactive nodes
    const inactiveLoads: string[] = [];
    const activeLoads: string[] = [];
    for (const node of mesh.nodes.values()) {
      const hasLoad = node.loads.fx !== 0 || node.loads.fy !== 0 || (node.loads.moment && node.loads.moment !== 0);
      if (hasLoad) {
        const isActive = activeNodeIds.has(node.id);
        const info = `Node ${node.id} at (${node.x.toFixed(3)}, ${node.y.toFixed(3)}): fx=${node.loads.fx}, fy=${node.loads.fy}`;
        if (isActive) activeLoads.push(info); else inactiveLoads.push(info);
      }
    }
    if (inactiveLoads.length > 0) {
      throw new Error(`Loads on ${inactiveLoads.length} node(s) not connected to elements (inactive). Loads: ${inactiveLoads.join('; ')}. Total elements: ${mesh.elements.size}`);
    }
    throw new Error('No loads applied - add forces to nodes or elements');
  }

  // Diagnostic & auto-fix: check for zero-stiffness DOFs and auto-constrain them
  const numDofs = K.rows;
  const indexToNodeId = new Map<number, number>();
  for (const [nodeId, idx] of nodeIdToIndex.entries()) indexToNodeId.set(idx, nodeId);
  const constrainedSet = new Set(constrainedDofs);
  for (let d = 0; d < numDofs; d++) {
    if (Math.abs(K.get(d, d)) < 1e-20 && !constrainedSet.has(d)) {
      const nodeIdx = Math.floor(d / dofsPerNode);
      const localDof = d % dofsPerNode;
      const nodeId = indexToNodeId.get(nodeIdx);
      const node = nodeId !== undefined ? mesh.getNode(nodeId) : null;
      const dofLabel = dofsPerNode === 2 ? ['u', 'v'][localDof] : ['u/w', 'v/θx', 'θ/θy'][localDof];
      console.warn(`[Plate Solver] Zero stiffness at DOF ${d} (node ${nodeId} at (${node?.x.toFixed(3)}, ${node?.y.toFixed(3)}), dof=${dofLabel}) — auto-constraining`);
      // Auto-constrain this DOF to prevent singularity
      constrainedDofs.push(d);
      constrainedSet.add(d);
    }
  }

  // Apply boundary conditions (penalty method)
  // Note: getConstrainedDofs already excludes spring DOFs — springs have their stiffness
  // added to K diagonal in assembleGlobalStiffnessMatrix instead
  const Kmod = K.clone();
  const Fmod = [...F];
  const penalty = 1e20;
  for (const dof of constrainedDofs) {
    Kmod.set(dof, dof, Kmod.get(dof, dof) + penalty);
    Fmod[dof] = 0;
  }

  // Solve
  let displacements: number[];
  try {
    displacements = solveLinearSystem(Kmod, Fmod);
  } catch (e) {
    // Enhanced error message with DOF diagnosis
    const msg = (e as Error).message;
    const colMatch = msg.match(/column (\d+)/);
    if (colMatch) {
      const col = parseInt(colMatch[1]);
      const nodeIdx = Math.floor(col / dofsPerNode);
      const localDof = col % dofsPerNode;
      const nodeId = indexToNodeId.get(nodeIdx);
      const node = nodeId !== undefined ? mesh.getNode(nodeId) : null;
      const dofLabel = dofsPerNode === 2 ? ['u', 'v'][localDof] : ['u/w', 'v/θx', 'θ/θy'][localDof];
      throw new Error(`Singular matrix at DOF ${col}: node ${nodeId} at (${node?.x.toFixed(3)}, ${node?.y.toFixed(3)}), direction=${dofLabel}. Check boundary conditions and element connectivity.`);
    }
    throw e;
  }

  // Solve succeeded

  // Reactions: R = K·u - F
  const reactions = K.multiplyVector(displacements);
  for (let i = 0; i < reactions.length; i++) {
    reactions[i] = reactions[i] - F[i];
  }

  // Post-processing: element stresses / moments
  const elementStresses = new Map<number, IElementStress>();
  let maxVonMises = 0;
  let minVonMises = Infinity;
  let maxMoment = -Infinity;
  let minMoment = Infinity;

  // Per-component range tracking
  const ranges = {
    sigmaX: { min: Infinity, max: -Infinity },
    sigmaY: { min: Infinity, max: -Infinity },
    tauXY: { min: Infinity, max: -Infinity },
    mx: { min: Infinity, max: -Infinity },
    my: { min: Infinity, max: -Infinity },
    mxy: { min: Infinity, max: -Infinity },
    vx: { min: Infinity, max: -Infinity },
    vy: { min: Infinity, max: -Infinity },
    nx: { min: Infinity, max: -Infinity },
    ny: { min: Infinity, max: -Infinity },
    nxy: { min: Infinity, max: -Infinity },
  };

  for (const element of mesh.elements.values()) {
    const nodes = mesh.getElementNodes(element);
    if (nodes.length < 3 || nodes.length > 4) continue;

    const material = mesh.getMaterial(element.materialId);
    if (!material) continue;

    // Extract element displacements
    const elemDisp: number[] = [];
    for (const node of nodes) {
      const idx = nodeIdToIndex.get(node.id);
      if (idx === undefined) continue;
      for (let d = 0; d < dofsPerNode; d++) {
        elemDisp.push(displacements[idx * dofsPerNode + d]);
      }
    }

    if (analysisType === 'plate_bending') {
      // DKT plate bending only supports triangles (backward compat)
      if (nodes.length !== 3) continue;
      const [n1, n2, n3] = nodes;
      // Calculate moments
      const moments = calculateElementMoments(n1, n2, n3, material, element.thickness, elemDisp);
      // Calculate transverse shear forces
      const shear = calculateElementShearForces(n1, n2, n3, material, element.thickness, elemDisp);
      const stress: IElementStress = {
        elementId: element.id,
        sigmaX: 0,
        sigmaY: 0,
        tauXY: 0,
        vonMises: 0,
        principalStresses: { sigma1: 0, sigma2: 0, angle: 0 },
        mx: moments.mx,
        my: moments.my,
        mxy: moments.mxy,
        vx: shear.vx,
        vy: shear.vy,
      };
      elementStresses.set(element.id, stress);

      maxMoment = Math.max(maxMoment, moments.mx, moments.my, moments.mxy);
      minMoment = Math.min(minMoment, moments.mx, moments.my, moments.mxy);

      // Track per-component ranges
      ranges.mx.min = Math.min(ranges.mx.min, moments.mx);
      ranges.mx.max = Math.max(ranges.mx.max, moments.mx);
      ranges.my.min = Math.min(ranges.my.min, moments.my);
      ranges.my.max = Math.max(ranges.my.max, moments.my);
      ranges.mxy.min = Math.min(ranges.mxy.min, moments.mxy);
      ranges.mxy.max = Math.max(ranges.mxy.max, moments.mxy);
      ranges.vx.min = Math.min(ranges.vx.min, shear.vx);
      ranges.vx.max = Math.max(ranges.vx.max, shear.vx);
      ranges.vy.min = Math.min(ranges.vy.min, shear.vy);
      ranges.vy.max = Math.max(ranges.vy.max, shear.vy);
    } else {
      // Plane stress/strain — handle both quad and triangle elements
      let stress: { sigmaX: number; sigmaY: number; tauXY: number; vonMises: number };

      if (nodes.length === 4) {
        const [n1, n2, n3, n4] = nodes;
        stress = calculateQuadStress(n1, n2, n3, n4, material, elemDisp, analysisType);
      } else {
        const [n1, n2, n3] = nodes;
        stress = calculateElementStress(n1, n2, n3, material, elemDisp, analysisType);
      }

      const principal = calculatePrincipalStresses(stress.sigmaX, stress.sigmaY, stress.tauXY);

      // Membrane forces: N = stress x thickness (N/m)
      const thickness = element.thickness || 1;
      const nx = stress.sigmaX * thickness;
      const ny = stress.sigmaY * thickness;
      const nxy = stress.tauXY * thickness;

      elementStresses.set(element.id, {
        elementId: element.id,
        ...stress,
        principalStresses: principal,
        nx,
        ny,
        nxy,
      });
      maxVonMises = Math.max(maxVonMises, stress.vonMises);
      minVonMises = Math.min(minVonMises, stress.vonMises);

      // Track per-component ranges
      ranges.sigmaX.min = Math.min(ranges.sigmaX.min, stress.sigmaX);
      ranges.sigmaX.max = Math.max(ranges.sigmaX.max, stress.sigmaX);
      ranges.sigmaY.min = Math.min(ranges.sigmaY.min, stress.sigmaY);
      ranges.sigmaY.max = Math.max(ranges.sigmaY.max, stress.sigmaY);
      ranges.tauXY.min = Math.min(ranges.tauXY.min, stress.tauXY);
      ranges.tauXY.max = Math.max(ranges.tauXY.max, stress.tauXY);
      ranges.nx.min = Math.min(ranges.nx.min, nx);
      ranges.nx.max = Math.max(ranges.nx.max, nx);
      ranges.ny.min = Math.min(ranges.ny.min, ny);
      ranges.ny.max = Math.max(ranges.ny.max, ny);
      ranges.nxy.min = Math.min(ranges.nxy.min, nxy);
      ranges.nxy.max = Math.max(ranges.nxy.max, nxy);
    }
  }

  if (minVonMises === Infinity) minVonMises = 0;
  if (maxMoment === -Infinity) maxMoment = 0;
  if (minMoment === Infinity) minMoment = 0;

  // Finalize ranges (replace Infinity with 0 for unused components)
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    if (ranges[key].min === Infinity) ranges[key].min = 0;
    if (ranges[key].max === -Infinity) ranges[key].max = 0;
  }

  // Result ready

  return {
    displacements,
    reactions,
    elementStresses,
    beamForces: new Map(),
    maxVonMises,
    minVonMises,
    maxMoment: analysisType === 'plate_bending' ? maxMoment : undefined,
    minMoment: analysisType === 'plate_bending' ? minMoment : undefined,
    stressRanges: ranges,
  };
}

/**
 * De geometrische stijfheid van het GEMENGDE stelsel: staven én wandschijven,
 * beide in het 3-DOF-schema (u, v, θ) dat `mixed_beam_plate` gebruikt.
 *
 * Twee bronnen, één matrix:
 *
 * * **Staven** — dezelfde `calculateGeometricStiffness(L, N)` als het
 *   frame-pad, met N uit de huidige verplaatsingen. De tekenafspraak is hier
 *   eenvoudiger dan in het frame-pad: N wordt hieronder rechtstreeks uit de
 *   lokale rekking bepaald en is dus TREK-positief, precies zoals
 *   `calculateGeometricStiffness` hem wil. Er wordt niets omgeklapt.
 * * **Wandschijven** — de initiële-spanningsstijfheid van het membraan, uit
 *   de heersende σx, σy en τxy (zie `calculateTriangleGeometricStiffness`).
 *
 * De θ-vrijheidsgraden van de schijven blijven leeg, net als bij de elastische
 * matrix: een membraan draagt geen moment in zijn knopen.
 *
 * Waarom de index hier opnieuw wordt opgebouwd en niet die van het frame-pad
 * hergebruikt: `mixed_beam_plate` nummert alleen de ACTIEVE knopen (via
 * `buildNodeIdToIndex`), terwijl het frame-pad alle knopen op volgorde neemt.
 * Dezelfde staaf krijgt in de twee schema's dus andere DOF-nummers, en de
 * meegegeven `nodeIdToIndex` is de enige die bij dit stelsel hoort.
 */
function assembleGeometricStiffnessMixed(
  mesh: Mesh,
  displacements: number[],
  nodeIdToIndex: Map<number, number>,
  numDofs: number
): Matrix {
  const Kg = new Matrix(numDofs, numDofs);

  // ── Staven ────────────────────────────────────────────────────────────────
  for (const beam of mesh.beamElements.values()) {
    const nodes = mesh.getBeamElementNodes(beam);
    if (!nodes) continue;
    const material = mesh.getMaterial(beam.materialId);
    if (!material) continue;

    const [n1, n2] = nodes;
    const idx1 = nodeIdToIndex.get(n1.id);
    const idx2 = nodeIdToIndex.get(n2.id);
    if (idx1 === undefined || idx2 === undefined) continue;

    const L = calculateBeamLength(n1, n2);
    if (L < 1e-10) continue;
    const angle = calculateBeamAngle(n1, n2);

    const dofIndices = [
      idx1 * 3, idx1 * 3 + 1, idx1 * 3 + 2,
      idx2 * 3, idx2 * 3 + 1, idx2 * 3 + 2,
    ];

    // Lokale verplaatsingen u_l = T·u_g, en daaruit de rekking. N = EA/L·Δu
    // is trek-positief.
    const T = createTransformationMatrix(angle);
    const ug = dofIndices.map(d => displacements[d]);
    const ul = T.multiplyVector(ug);
    const N = (material.E * beam.section.A / L) * (ul[3] - ul[0]);

    // Scharnieren en veren: de elastische matrix in het stelsel is al
    // gecondenseerd (Assembler.ts). Kg hoort daar niet ongecondenseerd bij —
    // zie `telGeometrischeStijfheidOp` voor de gemeten gevolgen. Omdat Ke hier
    // al in K zit, gaat alleen het VERSCHIL mee:
    //   Kg_eff = cond(Ke + Kg) − cond(Ke)
    // Zonder release of veer is dat exact Kg zelf.
    const releasedLocalDofs = getReleasedLocalDofs(beam);
    const veren = getSprungLocalDofs(beam);
    let KgLokaal: Matrix;
    if (releasedLocalDofs.length === 0 && veren.length === 0) {
      KgLokaal = calculateGeometricStiffness(L, N);
    } else {
      const condenseer = (M: Matrix): Matrix => {
        if (veren.length > 0) applyEndConnections(M, releasedLocalDofs, veren);
        else applyEndReleases(M, releasedLocalDofs);
        return M;
      };
      const KeAlleen = condenseer(
        calculateBeamLocalStiffness(L, material.E, beam.section.A, beam.section.I));
      const KeMetKg = calculateBeamLocalStiffness(L, material.E, beam.section.A, beam.section.I);
      telGeometrischeStijfheidOp(KeMetKg, L, N);
      condenseer(KeMetKg);
      KgLokaal = new Matrix(6, 6);
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          KgLokaal.set(i, j, KeMetKg.get(i, j) - KeAlleen.get(i, j));
        }
      }
    }
    const KgGlobaal = T.transpose().multiply(KgLokaal.multiply(T));

    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        Kg.addAt(dofIndices[i], dofIndices[j], KgGlobaal.get(i, j));
      }
    }
  }

  // ── Wandschijven ──────────────────────────────────────────────────────────
  for (const element of mesh.elements.values()) {
    const nodes = mesh.getElementNodes(element);
    if (nodes.length < 3 || nodes.length > 4) continue;
    const material = mesh.getMaterial(element.materialId);
    if (!material) continue;

    const dofIndices: number[] = [];
    const elemDisp: number[] = [];
    let compleet = true;
    for (const node of nodes) {
      const idx = nodeIdToIndex.get(node.id);
      if (idx === undefined) { compleet = false; break; }
      dofIndices.push(idx * 3, idx * 3 + 1, idx * 3 + 2);
      elemDisp.push(displacements[idx * 3], displacements[idx * 3 + 1]);
    }
    if (!compleet) continue;

    try {
      if (nodes.length === 4) {
        const [n1, n2, n3, n4] = nodes;
        const s = calculateQuadStress(n1, n2, n3, n4, material, elemDisp, 'plane_stress');
        const Kg12 = expandQuadGeometricStiffness(
          calculateQuadGeometricStiffness(n1, n2, n3, n4, s, element.thickness)
        );
        for (let i = 0; i < 12; i++) {
          for (let j = 0; j < 12; j++) Kg.addAt(dofIndices[i], dofIndices[j], Kg12.get(i, j));
        }
      } else {
        const [n1, n2, n3] = nodes;
        const s = calculateElementStress(n1, n2, n3, material, elemDisp, 'plane_stress');
        const Kg9 = expandTriangleGeometricStiffness(
          calculateTriangleGeometricStiffness(n1, n2, n3, s, element.thickness)
        );
        for (let i = 0; i < 9; i++) {
          for (let j = 0; j < 9; j++) Kg.addAt(dofIndices[i], dofIndices[j], Kg9.get(i, j));
        }
      }
    } catch (e) {
      // HARD, niet overslaan. Een ontaard element leverde hier stil géén
      // geometrische bijdrage, terwijl de rest van de tweede orde doorrekende:
      // een tweede gat naast dat in de elastische assemblage. Die weigert zo'n
      // element nu al (PlaatElementFout); hier dezelfde weigering, voor het
      // geval een element pas onder de heersende spanning ontaardt.
      throw new PlaatElementFout(
        element.id, e instanceof Error ? e.message : String(e), nodes);
    }
  }

  return Kg;
}

/**
 * Solve mixed beam+plate analysis.
 * Uses unified 3 DOFs per node (u, v, θ) with expanded plate stiffness matrices.
 * Beam elements use their native 6×6 (3 DOF/node) stiffness.
 * Plate elements are expanded from 6×6 or 8×8 to 9×9 or 12×12 (3 DOF/node).
 *
 * Met `geometricNonlinear` wordt er geïtereerd: elke ronde bouwt K = Ke + Kg
 * met de spanningen en normaalkrachten van de vorige stand, tot de
 * verplaatsingen niet meer veranderen. Zie `assembleGeometricStiffnessMixed`.
 *
 * WAT DIT PAD NIET DOET, en het raamwerkpad wél:
 * `opts.loadSteps` wordt hier genegeerd — de last gaat er in één keer op. Het
 * raamwerkpad kent een laststappenlus die de belasting in stappen opbouwt.
 * Voor geometrische niet-lineariteit maakt dat geen verschil: het eindpunt
 * hangt niet van de weg erheen af, en de directe iteratie vindt hetzelfde vaste
 * punt. Het zou pas gaan tellen bij fysische niet-lineariteit, en die loopt
 * voor schijven niet via deze weg. Niemand zet `loadSteps` vandaag: de
 * standaard is 1 en geen enkele aanroeper in de app of de sidecar wijkt daarvan
 * af. Wordt dat ooit anders, dan hoort hier eerst een laststappenlus omheen.
 */
function solveMixed(
  mesh: Mesh,
  opts: NonlinearSolverOptions
): ISolverResult {
  const analysisType = 'mixed_beam_plate';
  const dofsPerNode = 3; // u, v, θ for all nodes

  const log = (regel: SolverLogRegel): void => { opts.onLog?.(regel); };

  // Validate model
  if (mesh.elements.size < 1 && mesh.getBeamCount() < 1) {
    throw new Error('Mixed analysis requires at least one plate or beam element');
  }

  // Get active nodes (nodes connected to elements/beams) - IMPORTANT: only these are used by the solver
  const activeNodeIds = buildNodeIdToIndex(mesh, analysisType);

  // Check that constraints are on ACTIVE nodes
  let hasActiveConstraints = false;
  let hasAnyConstraints = false;
  for (const node of mesh.nodes.values()) {
    if (node.constraints.x || node.constraints.y || node.constraints.rotation) {
      hasAnyConstraints = true;
      if (activeNodeIds.has(node.id)) {
        hasActiveConstraints = true;
      }
    }
  }

  if (!hasAnyConstraints) {
    throw new Error('Model has no constraints - add boundary conditions');
  }

  if (!hasActiveConstraints) {
    throw new Error('Constraints are not on mesh nodes - place supports on plate corner/edge nodes or beam nodes');
  }

  // Assemble global matrices using the mixed_beam_plate mode
  const K = assembleGlobalStiffnessMatrix(mesh, analysisType);
  const F = assembleForceVectorNew(mesh, analysisType);
  const { dofs: constrainedDofs, nodeIdToIndex } = getConstrainedDofs(mesh, analysisType);
  // Knoopdraaiingen zonder stijfheid (alleen scharnierende staafeinden, geen
  // draaisteun): vastzetten zoals op het raamwerkpad, zie
  // `vrijeKnoopdraaiingen`. Een knoop met alleen schijfelementen krijgt al
  // een kleine draaistijfheid in de assemblage en staat er niet in.
  {
    const vrij = vrijeKnoopdraaiingen(mesh).filter((id) => nodeIdToIndex.has(id));
    const draaiDof = (id: number): number | undefined => {
      const i = nodeIdToIndex.get(id);
      return i === undefined ? undefined : i * 3 + 2;
    };
    weigerKoppelOpVrijeDraaiing(mesh, F, vrij, draaiDof);
    for (const id of vrij) {
      const dof = draaiDof(id)!;
      if (!constrainedDofs.includes(dof)) constrainedDofs.push(dof);
    }
  }

  // Check for sufficient constraints to prevent rigid body motion
  if (constrainedDofs.length < 3) {
    throw new Error(`Insufficient constraints: ${constrainedDofs.length} DOFs constrained, need at least 3 to prevent rigid body motion`);
  }

  const hasLoads = F.some(f => f !== 0);
  if (!hasLoads) {
    throw new Error('No loads applied - add forces to nodes or elements');
  }

  // ── Kinematische randkoppelingen (zie NonlinearSolverOptions) ─────────────
  // Per slaaf-vrijheidsgraad (u en v) de meester-vrijheidsgraden met gewicht.
  // Een slaaf mag geen meester zijn en geen starre oplegging dragen: dan is de
  // eliminatie niet eenduidig. De adapter weigert dat al met knoopnummers;
  // dit is de bewaking in de kern zelf.
  const slaafDofs: { dof: number; meesters: { dof: number; w: number }[] }[] = [];
  for (const k of opts.randKoppelingen ?? []) {
    const si = nodeIdToIndex.get(k.slaafKnoopId);
    if (si === undefined) {
      throw new Error(`Randkoppeling: knoop ${k.slaafKnoopId} is geen actieve rekenknoop.`);
    }
    const som = k.meesters.reduce((s, m) => s + m.gewicht, 0);
    if (!(Math.abs(som - 1) <= 1e-9)) {
      throw new Error(`Randkoppeling van knoop ${k.slaafKnoopId}: de gewichten tellen op tot ${som}, niet 1.`);
    }
    for (const d of [0, 1]) {
      slaafDofs.push({
        dof: si * dofsPerNode + d,
        meesters: k.meesters.map((m) => {
          const mi = nodeIdToIndex.get(m.knoopId);
          if (mi === undefined) {
            throw new Error(`Randkoppeling van knoop ${k.slaafKnoopId}: meester ${m.knoopId} is geen actieve rekenknoop.`);
          }
          return { dof: mi * dofsPerNode + d, w: m.gewicht };
        }),
      });
    }
  }
  const slaafSet = new Set(slaafDofs.map((s) => s.dof));
  for (const s of slaafDofs) {
    if (s.meesters.some((m) => slaafSet.has(m.dof))) {
      throw new Error('Randkoppeling: een meesterknoop is zelf aan een rand gekoppeld.');
    }
  }
  if (constrainedDofs.some((d) => slaafSet.has(d))) {
    throw new Error('Randkoppeling: een aan een plaatrand gekoppelde knoop draagt een starre oplegging.');
  }
  if (slaafDofs.length > 0) {
    log({
      soort: 'info',
      tekst: `${slaafDofs.length / 2} staafknopen kinematisch aan een plaatrand gekoppeld (lineaire interpolatie)`,
    });
  }

  /**
   * K̂ = TᵀKT als verse matrix. T is de eenheidsmatrix, behalve in de rijen van
   * de slaven: daar staan de gewichten in de meesterkolommen en een nul op de
   * diagonaal. Uitgevoerd als kolom- en rijbewerkingen (O(n) per koppeling)
   * in plaats van twee volle matrixproducten. Daarna krijgt elke slaaf een 1
   * op de diagonaal, zodat zijn (nul-)rij het stelsel niet singulier maakt.
   */
  const gecondenseerdeKloon = (M: Matrix): Matrix => {
    const C = M.clone();
    if (slaafDofs.length === 0) return C;
    const a = C.data;
    const n = C.rows;
    for (const sl of slaafDofs) {                  // K·T: kolommen
      for (const m of sl.meesters) {
        if (m.w === 0) continue;
        for (let i = 0; i < n; i++) a[i][m.dof] += m.w * a[i][sl.dof];
      }
      for (let i = 0; i < n; i++) a[i][sl.dof] = 0;
    }
    for (const sl of slaafDofs) {                  // Tᵀ·(K·T): rijen
      const rij = a[sl.dof];
      for (const m of sl.meesters) {
        if (m.w === 0) continue;
        const doel = a[m.dof];
        for (let j = 0; j < n; j++) doel[j] += m.w * rij[j];
      }
      for (let j = 0; j < n; j++) rij[j] = 0;
      rij[sl.dof] = 1;
    }
    return C;
  };
  /** F̂ = TᵀF: de kracht op een slaaf gaat met dezelfde gewichten naar de meesters. */
  const Fc = slaafDofs.length === 0 ? F : (() => {
    const g = [...F];
    for (const sl of slaafDofs) {
      for (const m of sl.meesters) g[m.dof] += m.w * F[sl.dof];
      g[sl.dof] = 0;
    }
    return g;
  })();
  /** u = T·û: de slaven terugrekenen uit hun meesters. */
  const herstel = (u: number[]): number[] => {
    for (const sl of slaafDofs) {
      let v = 0;
      for (const m of sl.meesters) v += m.w * u[m.dof];
      u[sl.dof] = v;
    }
    return u;
  };

  /**
   * Los K·u = F op met de opgelegde vrijheidsgraden erin. Penaltymethode,
   * net als voorheen — apart gezet omdat de niet-lineaire lus hem per
   * iteratie opnieuw nodig heeft, met een andere K. Met randkoppelingen wordt
   * eerst gecondenseerd en daarna de slaven teruggerekend.
   */
  const metRandvoorwaarden = (Kt: Matrix): Matrix => {
    const Kmod = gecondenseerdeKloon(Kt);
    const penalty = 1e20;
    for (const dof of constrainedDofs) {
      Kmod.set(dof, dof, Kmod.get(dof, dof) + penalty);
    }
    return Kmod;
  };
  const losOp = (Kt: Matrix): number[] => {
    const Kmod = metRandvoorwaarden(Kt);
    const Fmod = [...Fc];
    for (const dof of constrainedDofs) Fmod[dof] = 0;
    return herstel(solveLinearSystem(Kmod, Fmod));
  };

  // Kolomnummer → knoop, voor de vertaling van een singulier stelsel. Het
  // gemengde pad nummert alleen de actieve knopen (`nodeIdToIndex`).
  const knoopVanIndex = new Map<number, { id: number }>();
  for (const [id, index] of nodeIdToIndex) knoopVanIndex.set(index, { id });

  const numDofsMixed = K.rows;
  log({
    soort: 'info',
    tekst:
      `Gemengd model: ${mesh.beamElements.size} staven en ${mesh.elements.size} ` +
      `schijfelementen, ${numDofsMixed} vrijheidsgraden` +
      (opts.geometricNonlinear ? ' — geometrisch niet-lineair (P-Δ)' : ' — lineair'),
  });

  let displacements: number[];
  try {
    displacements = losOp(K);
  } catch (e) {
    // Dezelfde Nederlandse melding (knoop, richting, oorzaak) als het
    // frame-pad; de adapter zet het rekenknoopnummer om naar het modelnummer.
    // Met de matrix erbij: dezelfde nulvorm-analyse als het raamwerkpad
    // (issue #243, punt 111), zodat beide paden dezelfde knoop noemen.
    throw vertaalSingulier(e, mesh, (i) => knoopVanIndex.get(i), metRandvoorwaarden(K));
  }

  /**
   * De matrix waaruit de oplegreacties volgen. Lineair is dat de elastische K;
   * bij tweede orde de raakstijfheid Ke + Kg van de eindstand, want dát is de
   * matrix waarmee het evenwicht is gevonden. Het frame-pad doet hetzelfde.
   */
  let Kreactie: Matrix = K;

  // ── Geometrisch niet-lineair: itereren op K = Ke + Kg ─────────────────────
  //
  // Directe iteratie op de secansstijfheid, niet Newton-Raphson: Kg volgt uit
  // de spanningstoestand, en die volgt weer uit u. Elke ronde bouwt Kg met de
  // stand van de vorige en lost opnieuw op. Voor P-Δ convergeert dat met
  // ratio ≈ P/P_kr per ronde — hetzelfde gedrag als het frame-pad, dat langs
  // dezelfde weg tot P ≈ 0,87·P_kr komt.
  //
  // De elastische K blijft staan en wordt per ronde opgeteld bij een VERSE Kg;
  // Kg accumuleren zou de tweede orde tweemaal tellen.
  if (opts.geometricNonlinear) {
    let vorigeNorm = Infinity;
    let groei = 0;
    let geconvergeerd = false;

    for (let iter = 0; iter < opts.maxIterations; iter++) {
      const Kg = assembleGeometricStiffnessMixed(
        mesh, displacements, nodeIdToIndex, numDofsMixed
      );
      const Kt = K.clone();
      for (let i = 0; i < numDofsMixed; i++) {
        for (let j = 0; j < numDofsMixed; j++) Kt.addAt(i, j, Kg.get(i, j));
      }

      let nieuw: number[];
      try {
        nieuw = losOp(Kt);
      } catch {
        log({ soort: 'fout', tekst: 'Het stelsel K = Ke + Kg is niet oplosbaar' });
        throw new Error(
          'Second-order (P-Delta) analysis is unstable — the applied load is at or above the critical (buckling) load'
        );
      }

      let som = 0, somU = 0;
      for (let i = 0; i < numDofsMixed; i++) {
        const d = nieuw[i] - displacements[i];
        som += d * d;
        somU += nieuw[i] * nieuw[i];
      }
      const incrNorm = Math.sqrt(som);
      const dispNorm = Math.sqrt(somU);
      displacements = nieuw;

      log({
        soort: 'iteratie',
        laststap: 1,
        iteratie: iter + 1,
        incrementNorm: incrNorm,
        verplaatsingsNorm: dispNorm,
        tekst: `‖Δu‖ = ${incrNorm.toExponential(3)}, ‖u‖ = ${dispNorm.toExponential(3)}`,
      });

      if (!Number.isFinite(incrNorm) || !Number.isFinite(dispNorm)) {
        log({ soort: 'fout', tekst: 'De normen zijn niet-eindig — het stelsel loopt weg' });
        throw new Error(
          'Second-order (P-Delta) analysis did not converge — the applied load is at or above the critical (buckling) load'
        );
      }

      if (incrNorm <= opts.tolerance * Math.max(dispNorm, 1e-30)) {
        geconvergeerd = true;
        log({
          soort: 'info',
          tekst: `Geconvergeerd in ${iter + 1} iteratie(s) (tolerantie ${opts.tolerance.toExponential(0)})`,
        });
        break;
      }

      if (iter >= 1 && incrNorm > vorigeNorm) groei++; else groei = 0;
      if (groei >= 3) {
        log({
          soort: 'fout',
          tekst: 'De increment-norm groeit drie iteraties op rij — de last ligt op of boven de kniklast',
        });
        throw new Error(
          'Second-order (P-Delta) analysis did not converge — the applied load is at or above the critical (buckling) load'
        );
      }
      vorigeNorm = incrNorm;
    }

    if (!geconvergeerd) {
      throw new Error(
        `Second-order (P-Delta) analysis did not converge within ${opts.maxIterations} iterations — the load is at, above, or very close to the critical (buckling) load`
      );
    }

    // De raakstijfheid van de EINDSTAND. Hij dient twee doelen: de
    // stabiliteitscontrole hieronder, en straks de reacties — die horen uit
    // dezelfde matrix te komen waarmee het evenwicht is gevonden, precies
    // zoals het frame-pad dat doet.
    const Kg = assembleGeometricStiffnessMixed(
      mesh, displacements, nodeIdToIndex, numDofsMixed
    );
    const Kt = K.clone();
    for (let i = 0; i < numDofsMixed; i++) {
      for (let j = 0; j < numDofsMixed; j++) Kt.addAt(i, j, Kg.get(i, j));
    }
    Kreactie = Kt;

    // Stabiliteitscontrole op de eindstand, langs dezelfde weg als het
    // frame-pad: boven de kniklast kan de directe iteratie alsnog een vast
    // punt vinden terwijl K = Ke + Kg indefiniet is. Dan is er wel een
    // getal, maar het betekent niets. De penalty gaat op een KLOON — anders
    // zou 1e20 op de diagonaal in de reactieberekening meeliften.
    const Kstab = gecondenseerdeKloon(Kt);
    for (const dof of constrainedDofs) Kstab.set(dof, dof, Kstab.get(dof, dof) + 1e20);
    const nietPositief = countNonPositivePivots(Kstab);
    if (nietPositief > 0) {
      log({
        soort: 'fout',
        tekst:
          `Stabiliteitscontrole: ${nietPositief} niet-positieve pivot(s) in K = Ke + Kg — ` +
          `de matrix is indefiniet en de oplossing fysisch betekenisloos`,
      });
      throw new Error(
        'Second-order (P-Delta) analysis is unstable — the applied load is at or above the critical (buckling) load'
      );
    }
    log({ soort: 'info', tekst: 'Stabiliteitscontrole: K = Ke + Kg is positief definiet' });
  }

  // Calculate reactions: R = K·u - F
  // Met randkoppelingen uit het GECONDENSEERDE stelsel, R̂ = TᵀKTû − TᵀF. De
  // koppeling is een inwendige verbinding: de kracht die hij overbrengt hoort
  // niet als "reactie" op een meesterknoop te verschijnen. In R̂ valt die weg,
  // en Σ R̂ = −Σ F blijft gelden omdat de gewichten per slaaf optellen tot 1.
  const reactions = slaafDofs.length === 0
    ? Kreactie.multiplyVector(displacements)
    : gecondenseerdeKloon(Kreactie).multiplyVector(
        displacements.map((v, i) => (slaafSet.has(i) ? 0 : v)));
  for (let i = 0; i < reactions.length; i++) {
    reactions[i] = reactions[i] - Fc[i];
  }

  // =====================
  // POST-PROCESSING: BEAMS
  // =====================
  const beamForces = new Map<number, IBeamForces>();

  for (const beam of mesh.beamElements.values()) {
    const nodes = mesh.getBeamElementNodes(beam);
    if (!nodes) continue;

    const material = mesh.getMaterial(beam.materialId);
    if (!material) continue;

    const [n1, n2] = nodes;
    const idx1 = nodeIdToIndex.get(n1.id);
    const idx2 = nodeIdToIndex.get(n2.id);
    if (idx1 === undefined || idx2 === undefined) continue;

    // Extract 6-DOF global displacements for beam (3 DOF per node)
    const globalDisp = [
      displacements[idx1 * dofsPerNode],      // u1
      displacements[idx1 * dofsPerNode + 1],  // v1
      displacements[idx1 * dofsPerNode + 2],  // θ1
      displacements[idx2 * dofsPerNode],      // u2
      displacements[idx2 * dofsPerNode + 1],  // v2
      displacements[idx2 * dofsPerNode + 2],  // θ2
    ];

    // Tweede orde: K_G met dezelfde N als `assembleGeometricStiffnessMixed`
    // (EA/L·Δu, trek-positief), zodat de eindkrachten in evenwicht zijn met
    // de reacties uit Ke + Kg (zie `calculateBeamInternalForces`).
    let nKg: number | undefined;
    if (opts.geometricNonlinear) {
      const L = calculateBeamLength(n1, n2);
      const ul = createTransformationMatrix(calculateBeamAngle(n1, n2)).multiplyVector(globalDisp);
      nKg = L > 1e-10 ? (material.E * beam.section.A / L) * (ul[3] - ul[0]) : undefined;
    }
    const forces = calculateBeamInternalForces(beam, n1, n2, material, globalDisp, nKg);
    beamForces.set(beam.id, forces);
  }

  // ======================
  // POST-PROCESSING: PLATES
  // ======================
  const elementStresses = new Map<number, IElementStress>();
  let maxVonMises = 0;
  let minVonMises = Infinity;

  // Per-component range tracking
  const ranges = {
    sigmaX: { min: Infinity, max: -Infinity },
    sigmaY: { min: Infinity, max: -Infinity },
    tauXY: { min: Infinity, max: -Infinity },
    mx: { min: Infinity, max: -Infinity },
    my: { min: Infinity, max: -Infinity },
    mxy: { min: Infinity, max: -Infinity },
    vx: { min: Infinity, max: -Infinity },
    vy: { min: Infinity, max: -Infinity },
    nx: { min: Infinity, max: -Infinity },
    ny: { min: Infinity, max: -Infinity },
    nxy: { min: Infinity, max: -Infinity },
  };

  for (const element of mesh.elements.values()) {
    const nodes = mesh.getElementNodes(element);
    if (nodes.length < 3 || nodes.length > 4) continue;

    const material = mesh.getMaterial(element.materialId);
    if (!material) continue;

    // Extract element displacements: only u, v (skip θ) for plate stress calculation
    // Plates in mixed analysis use plane stress formulation
    const elemDisp: number[] = [];
    for (const node of nodes) {
      const idx = nodeIdToIndex.get(node.id);
      if (idx === undefined) continue;
      // Only u and v (indices 0 and 1 within each node's 3 DOFs)
      elemDisp.push(displacements[idx * dofsPerNode]);     // u
      elemDisp.push(displacements[idx * dofsPerNode + 1]); // v
    }

    // Calculate stresses using plane_stress formulation
    let stress: { sigmaX: number; sigmaY: number; tauXY: number; vonMises: number };

    if (nodes.length === 4) {
      const [n1, n2, n3, n4] = nodes;
      stress = calculateQuadStress(n1, n2, n3, n4, material, elemDisp, 'plane_stress');
    } else {
      const [n1, n2, n3] = nodes;
      stress = calculateElementStress(n1, n2, n3, material, elemDisp, 'plane_stress');
    }

    const principal = calculatePrincipalStresses(stress.sigmaX, stress.sigmaY, stress.tauXY);

    // Membrane forces: N = stress × thickness (N/m)
    const thickness = element.thickness || 1;
    const nx = stress.sigmaX * thickness;
    const ny = stress.sigmaY * thickness;
    const nxy = stress.tauXY * thickness;

    elementStresses.set(element.id, {
      elementId: element.id,
      ...stress,
      principalStresses: principal,
      nx,
      ny,
      nxy,
    });

    maxVonMises = Math.max(maxVonMises, stress.vonMises);
    minVonMises = Math.min(minVonMises, stress.vonMises);

    // Track per-component ranges
    ranges.sigmaX.min = Math.min(ranges.sigmaX.min, stress.sigmaX);
    ranges.sigmaX.max = Math.max(ranges.sigmaX.max, stress.sigmaX);
    ranges.sigmaY.min = Math.min(ranges.sigmaY.min, stress.sigmaY);
    ranges.sigmaY.max = Math.max(ranges.sigmaY.max, stress.sigmaY);
    ranges.tauXY.min = Math.min(ranges.tauXY.min, stress.tauXY);
    ranges.tauXY.max = Math.max(ranges.tauXY.max, stress.tauXY);
    ranges.nx.min = Math.min(ranges.nx.min, nx);
    ranges.nx.max = Math.max(ranges.nx.max, nx);
    ranges.ny.min = Math.min(ranges.ny.min, ny);
    ranges.ny.max = Math.max(ranges.ny.max, ny);
    ranges.nxy.min = Math.min(ranges.nxy.min, nxy);
    ranges.nxy.max = Math.max(ranges.nxy.max, nxy);
  }

  if (minVonMises === Infinity) minVonMises = 0;

  // Finalize ranges (replace Infinity with 0 for unused components)
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    if (ranges[key].min === Infinity) ranges[key].min = 0;
    if (ranges[key].max === -Infinity) ranges[key].max = 0;
  }

  return {
    displacements,
    reactions,
    elementStresses,
    beamForces,
    maxVonMises,
    minVonMises,
    stressRanges: ranges,
  };
}
