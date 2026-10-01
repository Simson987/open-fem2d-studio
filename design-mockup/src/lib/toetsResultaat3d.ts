/** Gedeelde, materiaalonafhankelijke grens tussen een 3D-solver en staafchecks.
 * Alle krachten zijn in het lokale rechterhandige assenstelsel van de staaf.
 * Een 2D-oplossing mag dit contract niet gebruiken: ontbrekende componenten
 * mogen niet als nul worden ingevuld. */
export type MateriaalToets3D =
  | "staal" | "aluminium" | "hout" | "kruislaaghout"
  | "beton" | "voorgespannen-beton" | "vrije-spanning";

export interface Vector3 { x: number; y: number; z: number }
export interface LokaleAssen3D { x: Vector3; y: Vector3; z: Vector3 }
export interface StaafKrachten3D {
  /** Trek positief, kN. */ n: number;
  /** Dwarskrachten lokaal y en z, kN. */ vy: number; vz: number;
  /** Torsie om lokaal x, kNm. */ t: number;
  /** Buiging om lokaal y en z, kNm. */ my: number; mz: number;
}
export interface Station3D extends StaafKrachten3D {
  /** Afstand vanaf begin van de staaf, m. */ xM: number;
}
export interface StaafResultaat3D {
  staafId: number;
  combinatieId: number;
  lengteM: number;
  assen: LokaleAssen3D;
  stations: Station3D[];
  herkomst: { soort: "geverifieerde-3d-solver"; naam: string; versie: string };
}

export interface SchaalResultaat3D {
  schaalId: number;
  combinatieId: number;
  /** Lokale x/y liggen in het schaalvlak, z staat loodrecht op het vlak. */
  assen: LokaleAssen3D;
  /** Membraan kN/m, buiging kNm/m, dwarskracht kN/m. */
  krachten: { nx: number; ny: number; nxy: number; mx: number; my: number;
    mxy: number; vx: number; vy: number };
  herkomst: StaafResultaat3D["herkomst"];
}

const eindig = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const punt = (v: Vector3) => [v.x, v.y, v.z];
const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;
const kruis = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

function valideerAssen3D(assenStelsel: LokaleAssen3D): void {
  const assen = [assenStelsel?.x, assenStelsel?.y, assenStelsel?.z];
  if (assen.some((a) => !a || !punt(a).every(eindig))) {
    throw new Error("De lokale 3D-assen ontbreken of bevatten ongeldige waarden.");
  }
  const [x, y, z] = assen as [Vector3, Vector3, Vector3];
  const tol = 1e-6;
  if (assen.some((a) => Math.abs(dot(a!, a!) - 1) > tol) ||
      Math.abs(dot(x, y)) > tol || Math.abs(dot(x, z)) > tol ||
      Math.abs(dot(y, z)) > tol || dot(kruis(x, y), z) < 1 - tol) {
    throw new Error("De lokale 3D-staafassen moeten orthonormaal en rechtshandig zijn.");
  }
}

function valideerHerkomst(h: StaafResultaat3D["herkomst"]): void {
  if (h?.soort !== "geverifieerde-3d-solver" || !h.naam?.trim() || !h.versie?.trim()) {
    throw new Error("Een 3D-toets vereist geverifieerde solverherkomst.");
  }
}

/** Weigert onvolledige of niet-lokale 3D-resultaten vóór een materiaaltoets. */
export function valideerStaafResultaat3D(r: StaafResultaat3D): StaafResultaat3D {
  if (!Number.isSafeInteger(r.staafId) || r.staafId <= 0 ||
      !Number.isSafeInteger(r.combinatieId) || r.combinatieId <= 0 ||
      !eindig(r.lengteM) || r.lengteM <= 0 ||
      !r.herkomst) {
    throw new Error("De 3D-toets mist een staaf, combinatie, lengte of geverifieerde solverherkomst.");
  }
  valideerHerkomst(r.herkomst);
  valideerAssen3D(r.assen);
  const tol = 1e-6;
  if (!Array.isArray(r.stations) || r.stations.length < 2 ||
      r.stations.some((s) => !s ||
        ![s.xM, s.n, s.vy, s.vz, s.t, s.my, s.mz].every(eindig)) ||
      Math.abs(r.stations[0].xM) > tol ||
      Math.abs(r.stations[r.stations.length - 1].xM - r.lengteM) > tol ||
      r.stations.some((s, i) => s.xM < -tol || s.xM > r.lengteM + tol ||
        (i > 0 && s.xM <= r.stations[i - 1].xM))) {
    throw new Error("3D-krachtstations moeten alle zes krachten en een strikt oplopende positie hebben.");
  }
  return r;
}

export function valideerSchaalResultaat3D(r: SchaalResultaat3D): SchaalResultaat3D {
  if (!Number.isSafeInteger(r.schaalId) || r.schaalId <= 0 ||
      !Number.isSafeInteger(r.combinatieId) || r.combinatieId <= 0) {
    throw new Error("Het 3D-schaalresultaat mist een schaal of combinatie.");
  }
  valideerHerkomst(r.herkomst);
  valideerAssen3D(r.assen);
  if (!r.krachten || ![r.krachten.nx, r.krachten.ny, r.krachten.nxy,
    r.krachten.mx, r.krachten.my, r.krachten.mxy,
    r.krachten.vx, r.krachten.vy].every(eindig)) {
    throw new Error("Het 3D-schaalresultaat mist een van de acht krachtcomponenten.");
  }
  return r;
}

/** Migratiescope; aanwezigheid in deze lijst betekent geen werkende normtoets. */
export function materialenVoor3DContract(): readonly MateriaalToets3D[] {
  return ["staal", "aluminium", "hout", "kruislaaghout", "beton", "voorgespannen-beton", "vrije-spanning"];
}
