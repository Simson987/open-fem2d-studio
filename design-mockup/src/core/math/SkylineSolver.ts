/**
 * Skyline-oplosser (profieloplosser) — LDLᵀ zonder pivotering.
 *
 * WAAROM DEZE VORM
 * ----------------
 * Een raamwerk-stijfheidsmatrix is symmetrisch en, zodra de knopen redelijk
 * genummerd zijn, bandvormig: koppelingen bestaan alleen tussen knopen die een
 * staaf delen. Bij een staaf die in veel segmenten geknipt is — het geval
 * waarvoor deze oplosser bestaat — is die band bovendien smal en constant
 * (drie vrijheidsgraden per knoop, buren gekoppeld → halve bandbreedte 5).
 *
 * Gekozen is de SKYLINE-vorm (variabele profielhoogte per rij) en niet een
 * vaste band, om één reden: de invoer is niet altijd netjes genummerd. Een
 * vaste band moet op de SLECHTSTE rij gedimensioneerd worden en degradeert dan
 * naar dicht; een skyline betaalt per rij alleen wat die rij nodig heeft. Bij
 * een strak genummerd raamwerk zijn beide identiek — de skyline verliest daar
 * dus niets — maar bij een gemengd plaat/raamwerk-model, waar de plaatknopen
 * uit de mesher komen, houdt de skyline nog winst over waar een vaste band die
 * al kwijt is. Zie `scripts/meet-oplossers.mjs` voor de meting.
 *
 * LDLᵀ ZONDER PIVOTERING: WAAROM DAT MAG
 * --------------------------------------
 * Pivoteren zou de bandstructuur juist vernietigen (rijverwisselingen halen
 * elementen buiten het profiel). Dat mag hier achterwege blijven omdat de
 * matrix symmetrisch is en de randvoorwaarden met de PENALTY-methode zijn
 * opgelegd: er worden alleen diagonaaltermen opgehoogd, rijen en kolommen
 * blijven staan. De matrix is daarmee symmetrisch positief-definiet zolang de
 * constructie stabiel is.
 *
 * Bij een tweede-orde-berekening boven de kniklast wordt K indefiniet en
 * loopt een pivot door nul. Dat is geen tekortkoming maar precies het signaal
 * dat de aanroepende laag verwacht: `NonlinearSolver` vertaalt de singuliere
 * matrix naar de knikmelding. Een negatieve pivot op zichzelf is NIET fout —
 * die telt hoeveel kritieke belastingen al gepasseerd zijn — dus alleen de
 * grootte van de pivot wordt getoetst, niet het teken.
 *
 * VEILIGHEIDSKLEP
 * ---------------
 * Blijkt de matrix niet symmetrisch (buiten de afrondmarge), dan is LDLᵀ niet
 * van toepassing en valt deze oplosser terug op de dichte Gauss-eliminatie.
 * Dat is een gemeten eigenschap van de invoer, geen aanname: de scan die het
 * profiel bepaalt meet de asymmetrie in dezelfde doorloop.
 *
 * GEHEUGEN
 * --------
 * De envelop komt NAAST de dichte matrix te staan; hij kost 8 bytes per
 * opgeslagen term, dus n·h_gem·8 bytes. Bij een bandvormig raamwerk is dat een
 * fractie van de n²·8 bytes die de dichte matrix zelf al inneemt. Bij een
 * volledig gevulde matrix zou het n²/2·8 bytes zijn — dan is de winst alleen
 * nog de factor 2 van LDLᵀ tegen Gauss en betaal je er de helft van de
 * matrixomvang aan geheugen voor. Zie het meetscript voor de gemeten h_gem.
 */

import { Matrix } from './Matrix';
import { solveLinearSystem as solveGauss } from './GaussElimination';

/** Uitkomst van de structuurscan van een stelselmatrix. */
export interface IMatrixProfile {
  /** Per rij i de laagste kolomindex met een niet-nul in de onderdriehoek (≤ i). */
  first: Int32Array;
  /** Aantal opgeslagen getallen in de onderdriehoek-envelop, diagonaal inbegrepen. */
  profileSize: number;
  /** Grootste (i − first[i]); 0 betekent een diagonaalmatrix. */
  halfBandwidth: number;
  /** Gemiddelde profielhoogte (profileSize / n) — de effectieve bandbreedte. */
  meanHeight: number;
  /** max |A(i,j) − A(j,i)| over de hele matrix. */
  maxAsymmetry: number;
  /** max |A(i,j)| over de hele matrix. */
  maxMagnitude: number;
  /** maxAsymmetry / maxMagnitude; 0 bij een exact symmetrische matrix. */
  relAsymmetry: number;
  /** Optioneel verzameld voor RCM tijdens dezelfde matrixscan. */
  /** Vlakke indexparen [i, j, i, j, …] zonder object per niet-nul. */
  edges?: number[];
  nodeNeighbours?: number[][];
  /** Een vrijwel dichte matrix krijgt geen extra RCM-graaf in het geheugen. */
  graphTruncated?: boolean;
}

/**
 * Bovengrens voor de relatieve asymmetrie waarbij LDLᵀ nog wordt toegepast.
 *
 * De stijfheidsmatrix is theoretisch exact symmetrisch, maar wordt opgebouwd
 * met TᵀKT-producten waarin de sommatievolgorde per hoek verschilt. Wat
 * overblijft is afrondruis. De gemeten waarde over de hele testbatterij staat
 * in het verslag; deze grens ligt daar ruim boven en ruim onder elke
 * asymmetrie die op een echte modelleerfout zou wijzen.
 */
const ASYMMETRIE_GRENS = 1e-10;

/**
 * Pivotdrempels. De absolute drempel is gelijk aan die van de dichte oplosser
 * (`GaussElimination`), zodat de skyline-oplosser nooit LATER alarm slaat dan
 * de bestaande. De relatieve drempel vangt het geval dat de dichte oplosser
 * mist: een matrix met termen van orde 1e8 waarin een pivot naar 1e-4 zakt is
 * een mechanisme, maar haalt de absolute drempel van 1e-12 nooit.
 */
const PIVOT_ABS_DREMPEL = 1e-12;
const PIVOT_REL_DREMPEL = 1e-12;
/** Bij een dichte matrix kost de extra graaf meer geheugen zonder profielwinst. */
const MAX_GRAAF_RANDEN_PER_VRIJHEIDSGRAAD = 48;

/** Laagste gemeten |d_i| / |A_ii| sinds de laatste reset — diagnostiek. */
let laagstePivotRatio = Number.POSITIVE_INFINITY;

/** Aantal keren dat de veiligheidsklep naar Gauss is teruggevallen. */
let terugvalTeller = 0;

export function getSkylineDiagnostics(): {
  laagstePivotRatio: number;
  terugvallen: number;
} {
  return { laagstePivotRatio, terugvallen: terugvalTeller };
}

export function resetSkylineDiagnostics(): void {
  laagstePivotRatio = Number.POSITIVE_INFINITY;
  terugvalTeller = 0;
}

/**
 * Scant de matrix één keer en levert profielhoogten, bandbreedte en
 * asymmetrie. Kost O(n²) leesbewerkingen — dezelfde orde als de dichte
 * opslag zelf, en verwaarloosbaar naast de O(n³) van een dichte oplossing.
 */
export function analyzeMatrix(A: Matrix, collectGraph = false): IMatrixProfile {
  const n = A.rows;
  const first = new Int32Array(n);
  let profileSize = 0;
  let halfBandwidth = 0;
  let maxAsymmetry = 0;
  let maxMagnitude = 0;
  let edges: number[] | undefined = collectGraph ? [] : undefined;
  let neighbours: Array<Set<number>> | undefined = collectGraph && n % 3 === 0
    ? Array.from({ length: n / 3 }, () => new Set<number>()) : undefined;
  let graphTruncated = false;

  for (let i = 0; i < n; i++) {
    const rij = A.data[i];
    const nodeI = Math.floor(i / 3);
    let fi = i;
    for (let j = 0; j < i; j++) {
      const onder = rij[j];
      const boven = A.data[j][i];
      if (onder !== 0 || boven !== 0) {
        if (edges) {
          if (edges.length < 2 * MAX_GRAAF_RANDEN_PER_VRIJHEIDSGRAAD * n) edges.push(i, j);
          else { edges = undefined; neighbours = undefined; graphTruncated = true; }
        }
        if (neighbours) {
          const nodeJ = Math.floor(j / 3);
          if (nodeI !== nodeJ) {
            neighbours[nodeI].add(nodeJ); neighbours[nodeJ].add(nodeI);
          }
        }
        if (fi === i) fi = j;
        const verschil = Math.abs(onder - boven);
        if (verschil > maxAsymmetry) maxAsymmetry = verschil;
        const m = Math.abs(onder) > Math.abs(boven) ? Math.abs(onder) : Math.abs(boven);
        if (m > maxMagnitude) maxMagnitude = m;
      }
    }
    const diag = Math.abs(rij[i]);
    if (diag > maxMagnitude) maxMagnitude = diag;
    first[i] = fi;
    profileSize += i - fi + 1;
    if (i - fi > halfBandwidth) halfBandwidth = i - fi;
  }

  return {
    first,
    profileSize,
    halfBandwidth,
    meanHeight: n > 0 ? profileSize / n : 0,
    maxAsymmetry,
    maxMagnitude,
    relAsymmetry: maxMagnitude > 0 ? maxAsymmetry / maxMagnitude : 0,
    edges,
    nodeNeighbours: neighbours?.map((s) => [...s]),
    graphTruncated,
  };
}

/**
 * George–Liu-startknoop en reverse Cuthill–McKee op het knoopgraafje.
 * Een 2D-rekenknoop heeft drie opeenvolgende vrijheidsgraden. De volgorde
 * binnen een knoop blijft intact, zodat de fysische richtingen gelijk blijven.
 */
export function rcmNodeOrder(A: Matrix, knownNeighbours?: number[][]): Int32Array {
  const nodes = A.rows / 3;
  if (!Number.isInteger(nodes)) return Int32Array.from({ length: A.rows }, (_, i) => i);
  const neighbours: number[][] = knownNeighbours ?? Array.from({ length: nodes }, () => []);
  if (!knownNeighbours) for (let i = 0; i < nodes; i++) {
    for (let j = 0; j < i; j++) {
      let connected = false;
      for (let di = 0; di < 3 && !connected; di++) {
        for (let dj = 0; dj < 3; dj++) {
          if (A.data[3 * i + di][3 * j + dj] !== 0 ||
              A.data[3 * j + dj][3 * i + di] !== 0) {
            connected = true;
            break;
          }
        }
      }
      if (connected) { neighbours[i].push(j); neighbours[j].push(i); }
    }
  }
  const degree = neighbours.map((xs) => xs.length);
  const done = new Uint8Array(nodes);
  const order: number[] = [];
  const byDegree = (a: number, b: number) => degree[a] - degree[b] || a - b;

  const levels = (start: number): number[][] => {
    const seen = new Uint8Array(nodes);
    seen[start] = 1;
    let frontier = [start];
    const result: number[][] = [];
    while (frontier.length) {
      result.push(frontier);
      const next: number[] = [];
      for (const node of frontier) {
        for (const neighbour of neighbours[node]) {
          if (done[neighbour] || seen[neighbour]) continue;
          seen[neighbour] = 1;
          next.push(neighbour);
        }
      }
      frontier = next;
    }
    return result;
  };

  while (order.length < nodes) {
    let start = -1;
    for (let i = 0; i < nodes; i++) {
      if (!done[i] && (start < 0 || byDegree(i, start) < 0)) start = i;
    }
    // George–Liu: ga naar de laagste-graadknoop in het diepste niveau,
    // zolang het aantal niveaus toeneemt.
    let depth = levels(start).length;
    for (;;) {
      const allLevels = levels(start);
      const last = allLevels[allLevels.length - 1];
      const candidate = [...last].sort(byDegree)[0];
      const candidateDepth = levels(candidate).length;
      if (candidateDepth <= depth) break;
      start = candidate;
      depth = candidateDepth;
    }
    const seen = new Uint8Array(nodes);
    seen[start] = 1;
    const bfs = [start];
    for (let p = 0; p < bfs.length; p++) {
      const next = neighbours[bfs[p]].filter((v) => !done[v] && !seen[v]).sort(byDegree);
      for (const v of next) { seen[v] = 1; bfs.push(v); }
    }
    for (let p = bfs.length - 1; p >= 0; p--) {
      done[bfs[p]] = 1;
      order.push(bfs[p]);
    }
  }
  return Int32Array.from(order.flatMap((node) => [3 * node, 3 * node + 1, 3 * node + 2]));
}

/** Herordent alleen als het skyline-profiel daadwerkelijk kleiner wordt. */
export function reorderForSkyline(A: Matrix, originalProfile = analyzeMatrix(A, true)): {
  newToOld: Int32Array; first: Int32Array; applied: boolean;
  originalProfileSize: number; reorderedProfileSize: number;
} {
  const n = A.rows;
  const originalProfileSize = originalProfile.profileSize;
  if (originalProfile.graphTruncated) {
    return { newToOld: Int32Array.from({ length: n }, (_, i) => i),
      first: originalProfile.first, applied: false, originalProfileSize, reorderedProfileSize: originalProfileSize };
  }
  const order = rcmNodeOrder(A, originalProfile.nodeNeighbours);
  const inverse = new Int32Array(n);
  for (let i = 0; i < n; i++) inverse[order[i]] = i;
  const first = Int32Array.from({ length: n }, (_, i) => i);
  const edges = originalProfile.edges ?? (() => {
    const found: number[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
      if (A.data[i][j] !== 0 || A.data[j][i] !== 0) found.push(i, j);
    }
    return found;
  })();
  for (let edge = 0; edge < edges.length; edge += 2) {
    const oldI = edges[edge], oldJ = edges[edge + 1];
    const i = Math.max(inverse[oldI], inverse[oldJ]);
    const j = Math.min(inverse[oldI], inverse[oldJ]);
    if (j < first[i]) first[i] = j;
  }
  let reorderedProfileSize = 0;
  for (let i = 0; i < n; i++) reorderedProfileSize += i - first[i] + 1;
  if (reorderedProfileSize >= originalProfileSize) {
    return { newToOld: Int32Array.from({ length: n }, (_, i) => i),
      first: originalProfile.first, applied: false, originalProfileSize, reorderedProfileSize: originalProfileSize };
  }
  return { newToOld: order, first, applied: true,
    originalProfileSize, reorderedProfileSize };
}

/**
 * Lost A·x = b op met een skyline-LDLᵀ-ontbinding.
 *
 * Dezelfde handtekening en hetzelfde foutgedrag als
 * `GaussElimination.solveLinearSystem`, inclusief de tekst van de
 * singulariteitsmelding — `NonlinearSolver` leest daar de kolomindex uit om er
 * een knoop- en richtingsaanduiding bij te zoeken.
 */
export function solveSkyline(A: Matrix, b: number[]): number[] {
  const n = A.rows;

  if (A.rows !== A.cols) {
    throw new Error('Matrix must be square');
  }
  if (b.length !== n) {
    throw new Error('Vector length must match matrix size');
  }
  if (n === 0) return [];

  const profiel = analyzeMatrix(A, true);

  // Veiligheidsklep: geen symmetrie → geen LDLᵀ.
  if (profiel.relAsymmetry > ASYMMETRIE_GRENS) {
    terugvalTeller++;
    return solveGauss(A, b);
  }

  const reordered = reorderForSkyline(A, profiel);
  try {
    const solution = solveWithProfile(A, b,
      reordered.applied ? reordered.first : profiel.first, reordered.applied ? reordered.newToOld : undefined);
    const original = new Array<number>(n);
    for (let i = 0; i < n; i++) original[reordered.newToOld[i]] = solution[i];
    return original;
  } catch (error) {
    // NonlinearSolver interpreteert dit nummer als vrijheidsgraad in het
    // oorspronkelijke mesh. Die betekenis moet bij hernummering behouden.
    const match = /^Matrix is singular or nearly singular at column (\d+)$/.exec(
      error instanceof Error ? error.message : '');
    if (match) {
      // Bij meerdere mechanismevrijheden kan de permutatie een andere
      // singuliere pivot als eerste vinden. Herhaal alleen op dit foutpad in
      // de oorspronkelijke volgorde voor dezelfde knoopmelding als voorheen.
      if (reordered.applied) {
        try { solveWithProfile(A, b, profiel.first); } catch (originalError) { throw originalError; }
      }
      throw new Error(`Matrix is singular or nearly singular at column ${reordered.newToOld[Number(match[1])]}`);
    }
    throw error;
  }
}

/**
 * De kern: LDLᵀ over een OPGEGEVEN envelop.
 *
 * Apart naar buiten gebracht omdat het meetscript
 * (`scripts/meet-oplossers.mjs`) hiermee dezelfde code met een VASTE band
 * (first[i] = max(0, i − b_max)) kan draaien. Zo is de vergelijking
 * skyline-tegen-band een echte tijdmeting op één implementatie, en geen
 * schatting uit twee verschillende stukken code.
 *
 * Voorwaarde: `first[i] ≤ i` en de envelop moet alle niet-nullen van de
 * onderdriehoek omvatten. `analyzeMatrix` levert de krapst geldige.
 */
export function solveWithProfile(A: Matrix, b: number[], first: Int32Array, newToOld?: Int32Array): number[] {
  const n = A.rows;
  if (n === 0) return [];

  // ── Envelop vullen ──────────────────────────────────────────────────────
  // rij i beslaat de kolommen first[i]..i; start[i] is de plek van kolom
  // first[i] in `vals`, zodat L(i,j) = vals[start[i] + (j − first[i])].
  const start = new Int32Array(n);
  let offset = 0;
  for (let i = 0; i < n; i++) {
    start[i] = offset - first[i]; // zo is L(i,j) = vals[start[i] + j]
    offset += i - first[i] + 1;
  }
  const vals = new Float64Array(offset);
  for (let i = 0; i < n; i++) {
    const rij = A.data[newToOld?.[i] ?? i];
    const s = start[i];
    for (let j = first[i]; j <= i; j++) vals[s + j] = rij[newToOld?.[j] ?? j];
  }

  const d = new Float64Array(n);
  // `t` houdt per rij de tussenwaarden L(i,k)·d[k] vast, zodat de binnenste
  // lus twee vermenigvuldigingen scheelt.
  const t = new Float64Array(n);

  // ── Ontbinding A = L·D·Lᵀ (L eenheidsonderdriehoek) ─────────────────────
  for (let i = 0; i < n; i++) {
    const fi = first[i];
    const si = start[i];

    for (let j = fi; j < i; j++) {
      const sj = start[j];
      const k0 = fi > first[j] ? fi : first[j];
      let som = vals[si + j];
      for (let k = k0; k < j; k++) som -= t[k] * vals[sj + k];
      vals[si + j] = som / d[j];
      t[j] = som; // = L(i,j)·d[j]
    }

    let diag = vals[si + i];
    for (let k = fi; k < i; k++) diag -= vals[si + k] * t[k];

    const oldI = newToOld?.[i] ?? i;
    const oorspronkelijk = Math.abs(A.data[oldI][oldI]);
    if (oorspronkelijk > 0) {
      const ratio = Math.abs(diag) / oorspronkelijk;
      if (ratio < laagstePivotRatio) laagstePivotRatio = ratio;
    }

    if (
      Math.abs(diag) < PIVOT_ABS_DREMPEL ||
      Math.abs(diag) < PIVOT_REL_DREMPEL * oorspronkelijk
    ) {
      throw new Error(`Matrix is singular or nearly singular at column ${i}`);
    }
    d[i] = diag;
  }

  // ── Voorwaartse substitutie L·y = b ─────────────────────────────────────
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const si = start[i];
    let som = b[newToOld?.[i] ?? i];
    for (let k = first[i]; k < i; k++) som -= vals[si + k] * x[k];
    x[i] = som;
  }

  // ── Diagonaal D·z = y ───────────────────────────────────────────────────
  for (let i = 0; i < n; i++) x[i] /= d[i];

  // ── Terugwaartse substitutie Lᵀ·x = z ───────────────────────────────────
  for (let i = n - 1; i > 0; i--) {
    const si = start[i];
    const xi = x[i];
    if (xi === 0) continue;
    for (let k = first[i]; k < i; k++) x[k] -= vals[si + k] * xi;
  }

  return Array.from(x);
}
