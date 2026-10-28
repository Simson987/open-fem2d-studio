/**
 * openFem3dStramienLijn.ts — de stramienassen en de levelrechthoeken in het
 * 3D-tekenvlak als streep-stip (issue #103): lange streep, korte
 * tussenruimte, stip, korte tussenruimte, zoals stramien- en hartlijnen op een
 * constructietekening en zoals in 2D (lib/stramienStreepStip.ts).
 *
 * Three.js kent alleen streep-gat (LineDashedMaterial). Het materiaal hier is
 * een LineDashedMaterial waarvan alleen de regel in de fragment shader die
 * het gat wegknipt een patroon van vier delen kent; kleur, dekking, diepte,
 * mist, logaritmische diepte en clipping planes blijven die van Three.js.
 * Ontbreekt die regel in een andere versie van Three.js, dan blijft het een
 * gewone streeplijn met dezelfde streep en periode (en meldt de console dat
 * één keer); test-stramien-streepstip.mjs bewaakt de vervanging.
 *
 * Schermvast, zoals in 2D: het patroon staat in schermpixels. Elk lijnstuk
 * meet zijn eigen afstand in meters vanaf 0 (het begint met een lange
 * streep); `material.scale` (pixels per meter) zet die vóór elke render om,
 * gemeten bij het draaipunt van de camera (zoals de spoorlijnen van #84).
 * Dat is een uniform: in- en uitzoomen maakt geen nieuwe shader en geen
 * nieuwe geometrie. In perspectief wordt het patroon vóór het draaipunt
 * groter en erachter kleiner, zoals de lijn zelf.
 *
 * Section box (#86): het stramien hoort bij de oriëntatie en wordt niet
 * geknipt; dat beslist de groep (`openFem3dStructuralGrid`, zie
 * openFem3DSectionBoxNietKnippen), niet dit materiaal. De peilmaten (#92) zijn
 * een eigen laag en raken dit niet.
 */
import * as THREE from "three";
import { STRAMIEN_STREEPSTIP_PX, streepStipPeriode } from "../../lib/stramienStreepStip";
import { openFem3DWereldmaatPerPixel, type OpenFem3DCamera } from "./openFem3dProjectie";

/** Kleur van de stramienassen op het basisniveau (ongewijzigd sinds vóór #103). */
export const OPEN_FEM_3D_STRAMIEN_KLEUR = 0x7c8da0;
/** Kleur van de levelrechthoeken (ongewijzigd sinds vóór #103). */
export const OPEN_FEM_3D_STRAMIEN_LEVEL_KLEUR = 0x94a3b8;
/** Dekking van beide (ongewijzigd sinds vóór #103). */
export const OPEN_FEM_3D_STRAMIEN_DEKKING = 0.85;
/** Pixels per meter zolang er nog niet met een camera getekend is. */
const BEGIN_SCHAAL_PX_PER_M = 100;
const DOEL_SLEUTEL = "openFem3dStramienCameraDoel";

/** De regel van LineDashedMaterial die alles na de streep weggooit. */
const STREEP_GAT_REGEL = /if\s*\(\s*mod\(\s*vLineDistance\s*,\s*totalSize\s*\)\s*>\s*dashSize\s*\)\s*\{\s*discard;\s*\}/;

const glslGetal = (waarde: number) => (Number.isInteger(waarde) ? `${waarde}.0` : String(waarde));

/**
 * De fragment shader van LineDashedMaterial met streep-stip: getekend tot het
 * eind van de streep (`dashSize`) en van het begin tot het eind van de stip,
 * de rest van de periode (`totalSize`) niet. Null als de regel van Three.js
 * er niet (meer) in staat.
 */
export function openFem3DStreepStipFragment(fragment: string): string | null {
  if (!STREEP_GAT_REGEL.test(fragment)) return null;
  const [streep, tussen, stip] = STRAMIEN_STREEPSTIP_PX;
  const stipBegin = glslGetal(streep + tussen);
  const stipEinde = glslGetal(streep + tussen + stip);
  return fragment.replace(STREEP_GAT_REGEL, [
    "float openFem3dStreepStipT = mod( vLineDistance, totalSize );",
    `\tif ( openFem3dStreepStipT > dashSize && ( openFem3dStreepStipT < ${stipBegin} || openFem3dStreepStipT > ${stipEinde} ) ) discard;`,
  ].join("\n"));
}

let melding = false;

/**
 * Het streep-stipmateriaal: streep = `dashSize`, periode = `dashSize +
 * gapSize`, beide in pixels; `scale` (pixels per meter) zet de lijnafstand in
 * meters om. Zonder vervangen regel tekent het dus nog een streeplijn.
 */
export function maakOpenFem3DStreepStipMateriaal(kleur: number): THREE.LineDashedMaterial {
  const [streep] = STRAMIEN_STREEPSTIP_PX;
  const materiaal = new THREE.LineDashedMaterial({
    color: kleur, transparent: true, opacity: OPEN_FEM_3D_STRAMIEN_DEKKING,
    dashSize: streep, gapSize: streepStipPeriode() - streep, scale: BEGIN_SCHAAL_PX_PER_M,
  });
  materiaal.userData.openFem3dStreepStip = true;
  materiaal.onBeforeCompile = (shader) => {
    const fragment = openFem3DStreepStipFragment(shader.fragmentShader);
    if (fragment) {
      shader.fragmentShader = fragment;
    } else if (!melding) {
      melding = true;
      console.warn("[open-fem3d] streep-stip: de streepregel van LineDashedMaterial is niet gevonden; het stramien wordt een streeplijn");
    }
  };
  materiaal.customProgramCacheKey = () => `open-fem3d-streep-stip:${STRAMIEN_STREEPSTIP_PX.join(",")}`;
  return materiaal;
}

/**
 * De lijnafstand per hoekpunt van losse lijnstukken (paren van punten), in
 * meters: elk lijnstuk van 0 tot zijn lengte. Anders dan
 * LineSegments.computeLineDistances (die telt door over alle lijnstukken)
 * begint zo elke stramienlijn met een streep, en blijven de getallen klein.
 */
export function openFem3DStramienLijnAfstanden(punten: readonly THREE.Vector3[]): Float32Array {
  const afstanden = new Float32Array(punten.length);
  for (let i = 0; i + 1 < punten.length; i += 2) {
    afstanden[i] = 0;
    afstanden[i + 1] = punten[i].distanceTo(punten[i + 1]);
  }
  return afstanden;
}

/** Pixels per meter bij `doel` voor deze camera en tekenvlakhoogte (CSS-pixels). */
export function openFem3DStreepStipSchaal(camera: OpenFem3DCamera, doel: THREE.Vector3, hoogtePx: number): number {
  const wereldPerPixel = openFem3DWereldmaatPerPixel(camera, doel, hoogtePx);
  return Number.isFinite(wereldPerPixel) && wereldPerPixel > 1e-12 ? 1 / wereldPerPixel : BEGIN_SCHAAL_PX_PER_M;
}

/**
 * Het tekenvlak legt het draaipunt van de camera vast bij zijn scène
 * (OrbitControls werkt `controls.target` ter plekke bij). Zonder draaipunt
 * meet de lijn bij het midden van zijn eigen omhullende bol.
 */
export function openFem3DStramienCameraDoel(scene: THREE.Object3D, doel: THREE.Vector3): void {
  scene.userData[DOEL_SLEUTEL] = doel;
}

const isCamera = (camera: THREE.Camera): camera is OpenFem3DCamera =>
  (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true
  || (camera as THREE.OrthographicCamera).isOrthographicCamera === true;

const formaat = new THREE.Vector2();

/**
 * Losse lijnstukken (paren van punten) als streep-stip in `kleur`, of null
 * zonder lijnstukken. Vóór elke render zet de lijn zijn schaal naar de camera
 * van die render.
 */
export function maakOpenFem3DStramienLijnen(punten: readonly THREE.Vector3[], kleur: number): THREE.LineSegments | null {
  if (punten.length < 2) return null;
  const geometrie = new THREE.BufferGeometry().setFromPoints(punten as THREE.Vector3[]);
  geometrie.setAttribute("lineDistance", new THREE.BufferAttribute(openFem3DStramienLijnAfstanden(punten), 1));
  geometrie.computeBoundingSphere();
  const materiaal = maakOpenFem3DStreepStipMateriaal(kleur);
  const lijnen = new THREE.LineSegments(geometrie, materiaal);
  lijnen.userData.openFem3dStreepStip = true;
  lijnen.onBeforeRender = (renderer, scene, camera) => {
    if (!isCamera(camera)) return;
    const doel = (scene.userData[DOEL_SLEUTEL] as THREE.Vector3 | undefined) ?? geometrie.boundingSphere?.center;
    if (!doel) return;
    materiaal.scale = openFem3DStreepStipSchaal(camera, doel, renderer.getSize(formaat).y);
  };
  return lijnen;
}
