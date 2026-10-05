/**
 * openFem3dSectionBoxBeeld.ts — de section box (issue #86) in het
 * 3D-tekenvlak: zes gedeelde clipping planes, de twaalf doosranden als dunne
 * lijn en op elk vlak een greep (een pijltje langs de buitennormaal). De
 * regels (grenzen, slepen, binnen/buiten) staan in openFem3dSectionBox.ts;
 * dit bestand maakt er Three.js-objecten van.
 *
 * Prestatie: de zes vlakken zijn dezelfde THREE.Plane-objecten voor alle
 * materialen die geknipt worden. Een andere doos verandert alleen hun normaal
 * en constante, en dat zijn uniforms: geen nieuwe shader en geen opbouw van
 * de scène, ook niet tijdens het slepen in een hal met duizend staven.
 *
 * Randen en grepen worden zelf niet geknipt, liggen altijd bovenop
 * (depthTest uit) en zijn geen kiesdoel: het tekenvlak vangt een greep in
 * schermpixels ({@link OpenFem3DSectionBoxBeeld.greepOnder}).
 */
import * as THREE from "three";
import {
  OPEN_FEM_3D_SECTION_BOX_VLAKKEN,
  openFem3DSectionBoxLangsStraal,
  openFem3DSectionBoxVlakken,
  openFem3DSectionBoxVlakMidden,
  type OpenFem3DSectionBoxBounds,
  type OpenFem3DSectionBoxVlak,
} from "./openFem3dSectionBox";
import { isOpenFem3DOrtho, openFem3DWereldmaatPerPixel, type OpenFem3DCamera } from "./openFem3dProjectie";

/** Lengte van een greep (het pijltje) op het scherm, in CSS-pixels. */
export const OPEN_FEM_3D_SECTION_BOX_GREEP_PX = 18;
/** Zo ver (px) van het midden van een greep vangt een klik hem nog. */
export const OPEN_FEM_3D_SECTION_BOX_GREEP_VANG_PX = 13;
/** Ruimte (px) tussen het doosvlak en de voet van het pijltje. */
const GREEP_AFSTAND_PX = 3;
const RAND_KLEUR = 0xc2410c;
const GREEP_KLEUR = 0xea580c;
const GREEP_ACTIEF = 0x7c2d12;

export interface OpenFem3DSectionBoxBeeld {
  /** Randen en grepen; hangt in de scène, wordt zelf niet geknipt. */
  readonly group: THREE.Group;
  /** De zes gedeelde clipping planes (binnen = positieve kant, zoals Three.js knipt). */
  readonly vlakken: THREE.Plane[];
  /** De grepen, één per vlak, in de volgorde van OPEN_FEM_3D_SECTION_BOX_VLAKKEN. */
  readonly grepen: readonly THREE.Mesh[];
  /** Zet de doos (null = uit): vlakken, randen en grepen. */
  zet(bounds: OpenFem3DSectionBoxBounds | null): void;
  /**
   * De grepen op vaste schermmaat bij deze camera, met hun wereldmatrix
   * bijgewerkt; vóór elke render. Een greep die langs de kijkstraal wijst, is
   * niet te slepen en staat uit (geen stip midden in de doos).
   */
  schaal(camera: OpenFem3DCamera, hoogtePx: number): void;
  /**
   * De greep binnen de vangstraal van schermpunt (xPx, yPx) in het tekenvlak,
   * de dichtstbijzijnde; of null. Een greep die langs de kijkstraal wijst,
   * vangt niets: de klik gaat naar wat eronder ligt.
   */
  greepOnder(camera: THREE.Camera, breedtePx: number, hoogtePx: number, xPx: number, yPx: number): OpenFem3DSectionBoxVlak | null;
  /** Markeer de greep onder de muis of die gesleept wordt (null: geen). */
  markeer(id: string | null): void;
  dispose(): void;
}

export function createOpenFem3DSectionBoxBeeld(): OpenFem3DSectionBoxBeeld {
  const group = new THREE.Group();
  group.name = "open-fem3d-section-box";
  group.userData.openFem3dSectionBox = true;
  group.visible = false;
  const vlakken = OPEN_FEM_3D_SECTION_BOX_VLAKKEN.map(() => new THREE.Plane(new THREE.Vector3(1, 0, 0), 0));

  const randGeometrie = new THREE.BufferGeometry();
  randGeometrie.setAttribute("position", new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
  const rand = new THREE.LineSegments(randGeometrie, new THREE.LineBasicMaterial({
    color: RAND_KLEUR, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false,
  }));
  rand.renderOrder = 150;
  rand.frustumCulled = false;
  rand.userData = { openFem3dSectionBoxRand: true, pickable: false };
  group.add(rand);

  // Een kegel met de punt langs +Y; de greep draait hem naar de buitennormaal.
  const kegel = new THREE.ConeGeometry(0.42, 1, 20);
  const grepen = OPEN_FEM_3D_SECTION_BOX_VLAKKEN.map((vlak) => {
    const mesh = new THREE.Mesh(kegel, new THREE.MeshBasicMaterial({
      color: GREEP_KLEUR, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false,
    }));
    const normaal = new THREE.Vector3();
    normaal.setComponent(vlak.as, vlak.kant);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normaal);
    mesh.renderOrder = 151;
    mesh.frustumCulled = false;
    mesh.userData = { openFem3dSectionBoxGreep: vlak.id, pickable: false };
    group.add(mesh);
    return mesh;
  });

  let huidig: OpenFem3DSectionBoxBounds | null = null;
  const midden = new THREE.Vector3();

  const zet = (bounds: OpenFem3DSectionBoxBounds | null) => {
    huidig = bounds;
    group.visible = bounds !== null;
    if (!bounds) return;
    openFem3DSectionBoxVlakken(bounds).forEach(({ normaal, constante }, index) => {
      vlakken[index].normal.set(normaal[0], normaal[1], normaal[2]);
      vlakken[index].constant = constante;
    });
    const [x0, y0, z0] = bounds.min, [x1, y1, z1] = bounds.max;
    const hoeken = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    const ribben = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const posities = randGeometrie.getAttribute("position") as THREE.BufferAttribute;
    ribben.forEach(([a, b], index) => {
      posities.setXYZ(2 * index, hoeken[a][0], hoeken[a][1], hoeken[a][2]);
      posities.setXYZ(2 * index + 1, hoeken[b][0], hoeken[b][1], hoeken[b][2]);
    });
    posities.needsUpdate = true;
    randGeometrie.computeBoundingSphere();
  };

  const straal = new THREE.Vector3();
  const as = new THREE.Vector3();
  /**
   * Wijst de greep van dit vlak (op `punt`) langs de kijkstraal? Parallel: de
   * kijkrichting; perspectief: van het oog naar de greep. Dezelfde toets als
   * het slepen (openFem3DSectionBoxLangsStraal). Vraagt een bijgewerkte
   * camera.matrixWorld.
   */
  const wijstNaarKijker = (camera: THREE.Camera, punt: THREE.Vector3, vlak: OpenFem3DSectionBoxVlak) => {
    const e = camera.matrixWorld.elements;
    if (isOpenFem3DOrtho(camera)) straal.set(-e[8], -e[9], -e[10]);
    else straal.set(punt.x - e[12], punt.y - e[13], punt.z - e[14]);
    as.set(0, 0, 0).setComponent(vlak.as, 1);
    return openFem3DSectionBoxLangsStraal(as, straal);
  };

  const schaal = (camera: OpenFem3DCamera, hoogtePx: number) => {
    if (!huidig) return;
    camera.updateMatrixWorld();
    OPEN_FEM_3D_SECTION_BOX_VLAKKEN.forEach((vlak, index) => {
      const [x, y, z] = openFem3DSectionBoxVlakMidden(huidig!, vlak);
      midden.set(x, y, z);
      const perPixel = openFem3DWereldmaatPerPixel(camera, midden, hoogtePx);
      const lengte = OPEN_FEM_3D_SECTION_BOX_GREEP_PX * perPixel;
      const greep = grepen[index];
      greep.scale.set(lengte, lengte, lengte);
      greep.position.copy(midden);
      greep.position.setComponent(vlak.as, midden.getComponent(vlak.as) + vlak.kant * (lengte / 2 + GREEP_AFSTAND_PX * perPixel));
      greep.visible = !wijstNaarKijker(camera, greep.position, vlak);
      // Ook de wereldmatrix: schaal() draait in scene.onBeforeRender, en dat
      // komt in WebGLRenderer.render ná scene.updateMatrixWorld(). Zonder dit
      // tekent de greep op de plek (en maat) van de vorige render: na "aan" op
      // de oorsprong, na Reset of "passend op selectie" op de oude vlakken.
      greep.updateMatrix();
      greep.updateMatrixWorld(true);
    });
  };

  const scherm = new THREE.Vector3();
  const greepOnder = (camera: THREE.Camera, breedtePx: number, hoogtePx: number, xPx: number, yPx: number) => {
    if (!huidig) return null;
    camera.updateMatrixWorld();
    let beste: OpenFem3DSectionBoxVlak | null = null;
    let besteAfstand = OPEN_FEM_3D_SECTION_BOX_GREEP_VANG_PX;
    OPEN_FEM_3D_SECTION_BOX_VLAKKEN.forEach((vlak, index) => {
      if (wijstNaarKijker(camera, grepen[index].position, vlak)) return;
      scherm.copy(grepen[index].position).project(camera);
      if (!(scherm.z >= -1 && scherm.z <= 1)) return;
      const afstand = Math.hypot((scherm.x + 1) * breedtePx / 2 - xPx, (1 - scherm.y) * hoogtePx / 2 - yPx);
      if (afstand <= besteAfstand) {
        besteAfstand = afstand;
        beste = vlak;
      }
    });
    return beste;
  };

  const markeer = (id: string | null) => {
    grepen.forEach((greep) => {
      (greep.material as THREE.MeshBasicMaterial).color.setHex(greep.userData.openFem3dSectionBoxGreep === id ? GREEP_ACTIEF : GREEP_KLEUR);
    });
  };

  return {
    group, vlakken, grepen, zet, schaal, greepOnder, markeer,
    dispose: () => {
      randGeometrie.dispose();
      (rand.material as THREE.Material).dispose();
      kegel.dispose();
      grepen.forEach((greep) => (greep.material as THREE.Material).dispose());
    },
  };
}

/**
 * Hoort dit object bij de oriëntatie en niet bij het model? Grondraster,
 * assenkruis, stramien, peilmaten, het tekenvoorbeeld en de doos zelf blijven
 * heel: zo zie je waar de doos in het gebouw ligt. Al het andere (staven,
 * platen, knopen, opleggingen, lasten, resultaten, contouren) wordt geknipt.
 */
export function openFem3DSectionBoxNietKnippen(object: THREE.Object3D): boolean {
  const data = object.userData;
  return data.openFem3dSectionBox === true || data.openFem3dStructuralGrid === true
    || data.openFem3dLevelMarks === true || data.openFem3dNietKnippen === true
    || (object as THREE.Light).isLight === true;
}

/**
 * Zet de clipping planes op elk materiaal onder `wortel` dat geknipt wordt
 * (`vlakken`), of haal ze weg (null). Alleen een andere waarde wordt
 * gezet: zolang de doos aan staat, kost een render hier één doorloop door de
 * scène zonder wijzigingen. Geeft het aantal geraakte materialen terug.
 */
export function openFem3DSectionBoxKnipMaterialen(wortel: THREE.Object3D, vlakken: THREE.Plane[] | null): number {
  let aantal = 0;
  const bezoek = (object: THREE.Object3D) => {
    if (object !== wortel && openFem3DSectionBoxNietKnippen(object)) return;
    const materiaal = (object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
    if (materiaal) {
      for (const m of Array.isArray(materiaal) ? materiaal : [materiaal]) {
        aantal += 1;
        if (m.clippingPlanes !== vlakken) m.clippingPlanes = vlakken;
      }
    }
    for (const kind of object.children) bezoek(kind);
  };
  bezoek(wortel);
  return aantal;
}
