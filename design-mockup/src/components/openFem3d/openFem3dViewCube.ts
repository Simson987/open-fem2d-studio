/**
 * openFem3dViewCube.ts — de wiskunde van de view cube (aanzichtkubus) in het
 * 3D-tekenvlak (issue #85). Puur: geen DOM en geen Three.js, zodat de
 * afspraken los te toetsen zijn (test-open-fem3d-view-cube.mjs).
 *
 *  - De 26 doelen: 6 vlakken, 12 ribben en 8 hoeken. De kijkrichting van een
 *    doel is de genormaliseerde som van de normalen van zijn vlakken; de
 *    camera staat dan aan die kant van het model en kijkt naar het midden.
 *  - De up-regel: wereld-Z omhoog, behalve recht van boven of onder (richting
 *    ±Z); dan Y omhoog, net als het bovenaanzicht uit het lint.
 *  - De lintaanzichten (boven, voor, zij, iso) staan hier ook, zodat lint en
 *    kubus één conventie delen: vlak Boven (het dak) = Bovenaanzicht, Voor
 *    (−Y) = Vooraanzicht, Rechts (+X) = Zijaanzicht. De iso-richting is één
 *    constante voor lint, Startaanzicht, startcamera, rapportbeeld en kubus.
 *  - De CSS-matrix van de kubus: de inverse van de camerarotatie, in de
 *    CSS-assen (x rechts, y omlaag, z naar de kijker).
 *  - Slepen op de kubus: azimut om wereld-Z en een begrensde elevatie.
 *  - Welke vlakken naar de kijker wijzen (het toetsenbord gaat alleen naar
 *    die doelen) en hoe de naam op dak en vloer draait om in het
 *    startaanzicht rechtop te staan.
 */
import type { OpenFem3DView } from "./openFem3dCommands";

export type Vec3 = readonly [number, number, number];

export type OpenFem3DViewCubeVlak = "boven" | "onder" | "voor" | "achter" | "links" | "rechts";
export type OpenFem3DViewCubeSoort = "vlak" | "ribbe" | "hoek";

/** Buitennormaal per vlak, in wereldassen (Z omhoog; Voor kijkt naar −Y). */
export const OPEN_FEM_3D_VIEW_CUBE_NORMAAL: Readonly<Record<OpenFem3DViewCubeVlak, Vec3>> = {
  rechts: [1, 0, 0],
  links: [-1, 0, 0],
  achter: [0, 1, 0],
  voor: [0, -1, 0],
  boven: [0, 0, 1],
  onder: [0, 0, -1],
};

/** Vaste volgorde van de vlakken: zo staan ze in de DOM en in de doelenlijst. */
export const OPEN_FEM_3D_VIEW_CUBE_VLAKKEN: readonly OpenFem3DViewCubeVlak[] = [
  "boven", "voor", "rechts", "achter", "links", "onder",
];

export interface OpenFem3DViewCubeDoel {
  /** Uit de tekens van de som, in de volgorde x, y, z: "+z", "-y+z", "+x-y+z". */
  id: string;
  soort: OpenFem3DViewCubeSoort;
  /** Som van de vlaknormalen; elke component is −1, 0 of 1. */
  som: Vec3;
  /** Kijkrichting van het modelmidden naar de camera (genormaliseerd). */
  richting: Vec3;
  /** Up-vector van de camera (zie openFem3DViewCubeUp). */
  up: Vec3;
  /** De vlakken van dit doel, in de volgorde voor/achter, links/rechts, boven/onder. */
  vlakken: readonly OpenFem3DViewCubeVlak[];
}

const lengte = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const normaliseer = (v: Vec3): Vec3 => {
  const l = lengte(v);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
};
const kruis = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const punt = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const schoon = (v: number) => (Math.abs(v) < 1e-15 ? 0 : v);

/**
 * Up-regel: Z omhoog; recht van boven of onder (geen horizontale component)
 * Y omhoog, zodat X naar rechts wijst zoals in het bovenaanzicht.
 */
export function openFem3DViewCubeUp(richting: Vec3): Vec3 {
  const horizontaal = Math.hypot(richting[0], richting[1]);
  return horizontaal <= 1e-9 * Math.max(lengte(richting), 1e-300) ? [0, 1, 0] : [0, 0, 1];
}

/**
 * De iso-richting (camera − doel, niet genormaliseerd): rechtsvoor en iets van
 * boven, zodat de kubus in het startbeeld Voor, Rechts en het dak laat zien en
 * de liggers niet samenvallen. Eén constante voor de lintknop Iso, het
 * Startaanzicht van de kubus, de startcamera en het iso-rapportbeeld.
 */
export const OPEN_FEM_3D_ISO_RICHTING: Vec3 = [1.4, -1.4, 1];

/**
 * De camera vóór het eerste passend beeld (en zolang er nog geen camera is
 * opgeslagen): in de iso-richting, zes keer de constante van het doel af.
 */
export function openFem3DStartCamera(): {
  position: [number, number, number]; target: [number, number, number]; up: [number, number, number];
} {
  const [x, y, z] = OPEN_FEM_3D_ISO_RICHTING;
  return { position: [x * 6, y * 6, z * 6], target: [0, 0, 0], up: [0, 0, 1] };
}

/**
 * De lintaanzichten: kijkrichting (van het modelmidden naar de camera) en up.
 * Iso: OPEN_FEM_3D_ISO_RICHTING, genormaliseerd.
 */
export function openFem3DAanzichtRichting(view: OpenFem3DView): { richting: Vec3; up: Vec3 } {
  if (view === "top") return { richting: [0, 0, 1], up: [0, 1, 0] };
  if (view === "front") return { richting: [0, -1, 0], up: [0, 0, 1] };
  if (view === "side") return { richting: [1, 0, 0], up: [0, 0, 1] };
  return { richting: normaliseer(OPEN_FEM_3D_ISO_RICHTING), up: [0, 0, 1] };
}

const tekenId = (som: Vec3) => ["x", "y", "z"]
  .map((as, index) => (som[index] > 0 ? `+${as}` : som[index] < 0 ? `-${as}` : ""))
  .join("");

const vlakVanAs = (as: 0 | 1 | 2, teken: number): OpenFem3DViewCubeVlak =>
  as === 0 ? (teken > 0 ? "rechts" : "links")
    : as === 1 ? (teken > 0 ? "achter" : "voor")
      : (teken > 0 ? "boven" : "onder");

/** Rondgang om Z vanaf Voor (−Y) naar Rechts (+X): de volgorde in de lijst en voor de pijltjestoetsen. */
const rondgang = (som: Vec3) => {
  if (som[0] === 0 && som[1] === 0) return 0;
  const hoek = Math.atan2(som[0], -som[1]);
  return hoek < 0 ? hoek + 2 * Math.PI : hoek;
};

function bouwDoelen(): OpenFem3DViewCubeDoel[] {
  const doelen: OpenFem3DViewCubeDoel[] = [];
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        if (x === 0 && y === 0 && z === 0) continue;
        const som: Vec3 = [x, y, z];
        const aantal = som.filter((component) => component !== 0).length;
        const vlakken = ([1, 0, 2] as const)
          .filter((as) => som[as] !== 0)
          .map((as) => vlakVanAs(as, som[as]));
        const richting = normaliseer(som);
        doelen.push({
          id: tekenId(som),
          soort: aantal === 1 ? "vlak" : aantal === 2 ? "ribbe" : "hoek",
          som, richting, up: openFem3DViewCubeUp(richting), vlakken,
        });
      }
    }
  }
  const soortRang = { vlak: 0, ribbe: 1, hoek: 2 } as const;
  return doelen.sort((a, b) => soortRang[a.soort] - soortRang[b.soort]
    || b.som[2] - a.som[2]
    || rondgang(a.som) - rondgang(b.som));
}

/** De 26 doelen: eerst de vlakken, dan de ribben, dan de hoeken; per soort van boven naar onder. */
export const OPEN_FEM_3D_VIEW_CUBE_DOELEN: readonly OpenFem3DViewCubeDoel[] = bouwDoelen();

const DOEL_PER_ID = new Map(OPEN_FEM_3D_VIEW_CUBE_DOELEN.map((doel) => [doel.id, doel]));

export function openFem3DViewCubeDoel(id: string): OpenFem3DViewCubeDoel | undefined {
  return DOEL_PER_ID.get(id);
}

/**
 * Hoe een vlak er recht van voren uitziet: zijn normaal, en de wereldrichtingen
 * die op dat vlak naar rechts en naar boven wijzen (boven = de up-regel,
 * rechts = boven × normaal). Zo staat de naam rechtop in zijn eigen aanzicht.
 */
export function openFem3DViewCubeVlakAssen(vlak: OpenFem3DViewCubeVlak): { normaal: Vec3; rechts: Vec3; boven: Vec3 } {
  const normaal = OPEN_FEM_3D_VIEW_CUBE_NORMAAL[vlak];
  const boven = openFem3DViewCubeUp(normaal);
  return { normaal, rechts: kruis(boven, normaal), boven };
}

/**
 * Draaiing (graden, CSS `rotate`: positief met de klok mee) van de naam op een
 * vlak. Op de gevels 0: met Z omhoog staan ze rechtop. Op dak en vloer volgt
 * de naam het schermrechts van de iso-camera (horizontaal, loodrecht op de
 * iso-richting), zodat hij in het startaanzicht rechtop leest: het dak van
 * boven, de vloer met dezelfde camera gespiegeld onder het model. De cellen
 * van het vlak draaien niet mee.
 */
export function openFem3DViewCubeNaamHoek(vlak: OpenFem3DViewCubeVlak): number {
  if (vlak !== "boven" && vlak !== "onder") return 0;
  const { rechts, boven } = openFem3DViewCubeVlakAssen(vlak);
  const schermRechts = normaliseer(kruis([0, 0, 1], normaliseer(OPEN_FEM_3D_ISO_RICHTING)));
  const hoek = Math.atan2(punt(schermRechts, boven), punt(schermRechts, rechts));
  return Math.round(-hoek * 180 / Math.PI * 1e9) / 1e9 + 0;
}

/**
 * Rek (CSS `scaleY`, langs de letterhoogte) van de naam op een vlak. In het
 * startaanzicht ligt het dak schuin weg: de letterhoogte wordt er verkort
 * met sin(elevatie) ≈ 0,45, op de gevels maar met cos(elevatie) ≈ 0,89. Rekken
 * met cos/sin = 1/tan(elevatie) ≈ 1,98 geeft de naam op dak en vloer in het
 * startaanzicht dezelfde hoogte als op de gevels; recht van boven staat hij
 * dan hoger, maar daar is ruimte genoeg. De gevels: 1.
 */
export function openFem3DViewCubeNaamRek(vlak: OpenFem3DViewCubeVlak): number {
  if (vlak !== "boven" && vlak !== "onder") return 1;
  const [x, y, z] = OPEN_FEM_3D_ISO_RICHTING;
  return Math.round(Math.hypot(x, y) / Math.abs(z) * 1e6) / 1e6;
}

/** De inline transform van de naam: draaiing (dak en vloer) en rek langs de letterhoogte. */
export function openFem3DViewCubeNaamTransform(vlak: OpenFem3DViewCubeVlak): string {
  const hoek = openFem3DViewCubeNaamHoek(vlak), rek = openFem3DViewCubeNaamRek(vlak);
  return [hoek !== 0 ? `rotate(${hoek}deg)` : "", rek !== 1 ? `scaleY(${rek})` : ""].filter(Boolean).join(" ");
}

/**
 * Het vlak in 3 × 3 cellen (rij 0 = bovenrand, kolom 0 = linkerrand): het
 * midden is het vlak, de randcellen zijn ribben en de hoekcellen hoeken. Een
 * ribbe staat zo op twee vlakken, een hoek op drie.
 */
export function openFem3DViewCubeCellen(vlak: OpenFem3DViewCubeVlak): { rij: number; kolom: number; doel: OpenFem3DViewCubeDoel }[] {
  const { normaal, rechts, boven } = openFem3DViewCubeVlakAssen(vlak);
  const cellen: { rij: number; kolom: number; doel: OpenFem3DViewCubeDoel }[] = [];
  for (let rij = 0; rij < 3; rij += 1) {
    for (let kolom = 0; kolom < 3; kolom += 1) {
      const i = kolom - 1, j = 1 - rij;
      const som: Vec3 = [0, 1, 2].map((as) => normaal[as] + i * rechts[as] + j * boven[as]) as unknown as Vec3;
      cellen.push({ rij, kolom, doel: DOEL_PER_ID.get(tekenId(som))! });
    }
  }
  return cellen;
}

/** Camera-assen in wereldcoördinaten: rechts, boven en achter (van het doel naar de camera). */
export interface OpenFem3DCameraAssen {
  rechts: Vec3;
  boven: Vec3;
  achter: Vec3;
}

/**
 * De assen van een camera die vanuit `positie` naar `doel` kijkt met `up`,
 * zoals Three.js `lookAt` ze bouwt (voor de test en de lintaanzichten; het
 * tekenvlak leest ze uit het camera-quaternion).
 */
export function openFem3DViewCubeCameraAssen(positie: Vec3, doel: Vec3, up: Vec3): OpenFem3DCameraAssen {
  let achter = normaliseer([positie[0] - doel[0], positie[1] - doel[1], positie[2] - doel[2]]);
  if (lengte(achter) === 0) achter = [0, 0, 1];
  let rechts = kruis(up, achter);
  if (lengte(rechts) < 1e-12) {
    // Up evenwijdig aan de kijkrichting: verschuif zoals Three.js een fractie.
    const verschoven: Vec3 = Math.abs(up[2]) === 1 ? [achter[0] + 1e-4, achter[1], achter[2]] : [achter[0], achter[1], achter[2] + 1e-4];
    achter = normaliseer(verschoven);
    rechts = kruis(up, achter);
  }
  rechts = normaliseer(rechts);
  const boven = kruis(achter, rechts);
  return { rechts, boven, achter };
}

// De kubus heeft eigen, rechtshandige assen L = (X, −Y, Z): zo zijn zowel de
// kubusmatrix als de vlakmatrices echte rotaties (determinant +1), wat de
// browser nodig heeft voor de achterkant (backface-visibility) en het raken.
const P = (v: Vec3): Vec3 => [v[0], -v[1], v[2]];

/**
 * De CSS-matrix (matrix3d, kolomvolgorde) van de kubus: wereldrichting w komt
 * op het scherm als (w·rechts, −w·boven, w·achter) in CSS-assen (x rechts,
 * y omlaag, z naar de kijker). Dat is de inverse van de camerarotatie.
 */
export function openFem3DViewCubeMatrix(assen: OpenFem3DCameraAssen): number[] {
  const { rechts: r, boven: u, achter: b } = assen;
  // Kolom j = beeld van de kubusas L_j = P·e_j.
  return [
    r[0], -u[0], b[0], 0,
    -r[1], u[1], -b[1], 0,
    r[2], -u[2], b[2], 0,
    0, 0, 0, 1,
  ].map(schoon);
}

/**
 * De CSS-matrix van één vlak binnen de kubus: lokale x (tekst naar rechts)
 * → `rechts`, lokale y (omlaag) → −`boven`, lokale z → de buitennormaal, en
 * een halve ribbe naar buiten.
 */
export function openFem3DViewCubeVlakMatrix(vlak: OpenFem3DViewCubeVlak, halveRibbePx: number): number[] {
  const { normaal, rechts, boven } = openFem3DViewCubeVlakAssen(vlak);
  const x = P(rechts), y = P(boven), z = P(normaal);
  return [
    x[0], x[1], x[2], 0,
    -y[0], -y[1], -y[2], 0,
    z[0], z[1], z[2], 0,
    z[0] * halveRibbePx, z[1] * halveRibbePx, z[2] * halveRibbePx, 1,
  ].map(schoon);
}

/**
 * Het maaiveld: een vlak met de assen van het dak (voorkant naar boven), maar
 * in het vlak van de vloer, een halve ribbe onder het midden. Met verborgen
 * achterkant is het van onderen onzichtbaar, zodat het de vloer nooit afdekt.
 */
export function openFem3DViewCubeMaaiveldMatrix(halveRibbePx: number): number[] {
  const m = openFem3DViewCubeVlakMatrix("boven", halveRibbePx);
  for (const index of [12, 13, 14]) m[index] = schoon(-m[index]);
  return m;
}

/** Product a·b van twee matrices in kolomvolgorde (4 × 4). */
export function openFem3DViewCubeMaal(a: readonly number[], b: readonly number[]): number[] {
  const uit = new Array<number>(16).fill(0);
  for (let kolom = 0; kolom < 4; kolom += 1) {
    for (let rij = 0; rij < 4; rij += 1) {
      let som = 0;
      for (let k = 0; k < 4; k += 1) som += a[k * 4 + rij] * b[kolom * 4 + k];
      uit[kolom * 4 + rij] = som;
    }
  }
  return uit;
}

/** Een punt (x, y, z, 1) door een matrix in kolomvolgorde. */
export function openFem3DViewCubePunt(m: readonly number[], p: Vec3): Vec3 {
  return [0, 1, 2].map((rij) => m[rij] * p[0] + m[4 + rij] * p[1] + m[8 + rij] * p[2] + m[12 + rij]) as unknown as Vec3;
}

/** De kubusas L van een wereldrichting (voor de test: waar ligt de hoek +X+Y+Z). */
export function openFem3DViewCubeLokaal(wereld: Vec3): Vec3 {
  return P(wereld);
}

/**
 * Een vlak telt als naar de kijker gericht als zijn normaal op het scherm
 * minstens zoveel naar voren wijst (cos van de hoek met de kijkas; 0,1 ≈ 84°).
 * Een vlak dat bijna op zijn kant staat, is een streep en geen doel.
 */
export const OPEN_FEM_3D_VIEW_CUBE_ZICHTBAAR_VANAF = 0.1;

/**
 * Hoe ver een vlak naar de kijker wijst bij kubusmatrix `matrix`: de
 * schermdiepte-component (CSS-z, naar de kijker) van zijn buitennormaal, −1..1.
 */
export function openFem3DViewCubeNaarKijker(matrix: readonly number[], vlak: OpenFem3DViewCubeVlak): number {
  const n = P(OPEN_FEM_3D_VIEW_CUBE_NORMAAL[vlak]);
  return matrix[2] * n[0] + matrix[6] * n[1] + matrix[10] * n[2];
}

/**
 * Het vlak waarop een doel het best te zien is (het meest naar de kijker
 * gericht), of null als geen van zijn vlakken naar de kijker wijst.
 */
export function openFem3DViewCubeZichtbaarVlak(
  matrix: readonly number[], doel: OpenFem3DViewCubeDoel,
): OpenFem3DViewCubeVlak | null {
  let beste: OpenFem3DViewCubeVlak | null = null;
  let besteZ = OPEN_FEM_3D_VIEW_CUBE_ZICHTBAAR_VANAF;
  for (const vlak of doel.vlakken) {
    const z = openFem3DViewCubeNaarKijker(matrix, vlak);
    if (z >= besteZ) { beste = vlak; besteZ = z; }
  }
  return beste;
}

/** De doelen die naar de kijker gericht zijn, in de volgorde van de doelenlijst. */
export function openFem3DViewCubeZichtbareDoelen(matrix: readonly number[]): OpenFem3DViewCubeDoel[] {
  return OPEN_FEM_3D_VIEW_CUBE_DOELEN.filter((doel) => openFem3DViewCubeZichtbaarVlak(matrix, doel) !== null);
}

/** `matrix3d(...)` met zes decimalen: geen exponentnotatie in de stijl. */
export function openFem3DViewCubeCss(m: readonly number[]): string {
  return `matrix3d(${m.map((waarde) => {
    const tekst = (Math.abs(waarde) < 5e-7 ? 0 : waarde).toFixed(6);
    return tekst === "-0.000000" ? "0.000000" : tekst;
  }).join(",")})`;
}

/** Hoogste elevatie bij slepen: net onder de pool, zodat de camera er niet overheen slaat. */
export const OPEN_FEM_3D_VIEW_CUBE_MAX_ELEVATIE = Math.PI / 2 - 0.002;

/**
 * Binnen deze hoek (rad) van de pool staat de camera "recht boven of onder"
 * het doel en volgt de azimut uit de up-as op het scherm. OrbitControls zet
 * een camera op de pool met makeSafe 1e-6 rad opzij, aan een vaste kant (−Y);
 * van onderen is dat precies de verkeerde kant. De marge ligt daarom ruim
 * boven die 1e-6 (geen omslag van 180°) en ruim onder de 0,002 rad die het
 * slepen van de pool overlaat (daar telt de echte positie).
 */
export const OPEN_FEM_3D_VIEW_CUBE_POOL_MARGE = 1e-4;

/**
 * Slepen op de kubus: de camera draait om het doel, horizontaal om wereld-Z
 * (azimut) en verticaal in elevatie, begrensd op ±MAX_ELEVATIE.
 *
 * `offset` is camera − doel; `cameraBoven` is de huidige up-as van de camera
 * op het scherm. Die geeft de azimut als de camera recht boven of onder het
 * doel staat (boven- of onderaanzicht met Y omhoog): de draaiing gaat dan
 * zonder sprong verder met Z omhoog. Geeft de nieuwe offset; de camera krijgt
 * daarna up = Z.
 */
export function openFem3DViewCubeDraai(
  offset: Vec3, cameraBoven: Vec3, dAzimut: number, dElevatie: number,
): Vec3 {
  const straal = lengte(offset);
  if (!(straal > 0)) return offset;
  const horizontaal = Math.hypot(offset[0], offset[1]);
  const elevatie = Math.atan2(offset[2], horizontaal);
  let azimut: number;
  if (horizontaal > Math.sin(OPEN_FEM_3D_VIEW_CUBE_POOL_MARGE) * straal) {
    azimut = Math.atan2(offset[1], offset[0]);
  } else {
    // Op de pool: met Z omhoog is de schermrichting omhoog −(cos a, sin a)
    // boven het doel en +(cos a, sin a) eronder. Kies a zodat die gelijk is
    // aan de huidige up-as op het scherm.
    const hx = cameraBoven[0], hy = cameraBoven[1];
    const teken = elevatie >= 0 ? -1 : 1;
    azimut = Math.hypot(hx, hy) > 1e-9 ? Math.atan2(teken * hy, teken * hx) : -Math.PI / 2;
  }
  const nieuweElevatie = Math.max(-OPEN_FEM_3D_VIEW_CUBE_MAX_ELEVATIE,
    Math.min(OPEN_FEM_3D_VIEW_CUBE_MAX_ELEVATIE, elevatie + dElevatie));
  const nieuweAzimut = azimut + dAzimut;
  const cosE = Math.cos(nieuweElevatie);
  return [
    straal * cosE * Math.cos(nieuweAzimut),
    straal * cosE * Math.sin(nieuweAzimut),
    straal * Math.sin(nieuweElevatie),
  ];
}

/**
 * Hoeken per schermpixel slepen, zoals rechts slepen in het tekenvlak
 * (OrbitControls: 2π per tekenvlakhoogte). Naar rechts slepen draait het
 * model mee naar rechts (azimut omlaag); omlaag slepen brengt de camera hoger.
 */
export function openFem3DViewCubeSleepHoeken(dxPx: number, dyPx: number, hoogtePx: number): { dAzimut: number; dElevatie: number } {
  const perPixel = (2 * Math.PI) / Math.max(1, hoogtePx);
  return { dAzimut: -dxPx * perPixel, dElevatie: dyPx * perPixel };
}
