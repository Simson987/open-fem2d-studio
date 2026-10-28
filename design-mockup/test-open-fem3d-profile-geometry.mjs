import assert from "node:assert/strict";
import * as THREE from "three";
import { openFem3DProfileInstanceScale } from "./src/components/openFem3d/openFem3dProfileGeometry.ts";

const lengthM = 3.75;
const scale = openFem3DProfileInstanceScale(lengthM);
assert.deepEqual(scale.toArray(), [1, 1, lengthM],
  "alleen de lokale profielas schaalt met de staaflengte");

// Een profielcontour heeft hier representatief een vaste breedte en hoogte.
// De productiecode gebruikt op dezelfde assen de echte cataloguscontour.
const unit = new THREE.BoxGeometry(0.2, 0.1, 1);
const exact = new THREE.BoxGeometry(0.2, 0.1, lengthM);
const scaled = unit.clone().applyMatrix4(new THREE.Matrix4().makeScale(...scale.toArray()));
scaled.computeBoundingBox();
exact.computeBoundingBox();
const scaledSize = scaled.boundingBox.getSize(new THREE.Vector3());
const exactSize = exact.boundingBox.getSize(new THREE.Vector3());

assert.ok(scaledSize.distanceTo(exactSize) < 1e-9,
  "axiaal schalen van de gedeelde meterextrusie behoudt de exacte IPE-doorsnede en staaflengte");
assert.ok(Math.abs(scaledSize.x - 0.2) < 1e-7, "de profielbreedte blijft gelijk");
assert.ok(Math.abs(scaledSize.y - 0.1) < 1e-7, "de profielhoogte blijft gelijk");
assert.ok(Math.abs(scaledSize.z - lengthM) < 1e-9,
  "de lokale staafas krijgt de werkelijke lengte");

unit.dispose(); exact.dispose(); scaled.dispose();

console.log("3D-profielinstancing met echte extrusies en ongelijke lengtes: geslaagd");
