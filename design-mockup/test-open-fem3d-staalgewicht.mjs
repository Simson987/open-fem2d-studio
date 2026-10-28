// Staalgewicht van een 3D-model (ρ·A·L per stalen staaf), zoals het 3D-venster
// het toont. De verwachte waarden komen uit de profieltabel (A in cm²) en
// ρ = 7850 kg/m³, niet uit de rekenregel zelf.
const { openFem3DStaalgewicht } = await import("./src/components/openFem3d/openFem3dStaalgewicht.ts");
let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const dichtbij = (a, b, rel = 0.005) => Math.abs(a - b) <= rel * Math.abs(b);

const model = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 },
    { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 0, z: 3 },
    { id: 5, x: 3, y: 4, z: 0 },
  ],
  beams: [
    // HEA 200: A = 53,83 cm² → 42,26 kg/m × 6 m = 253,5 kg
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S235" },
    // IPE 200: A = 28,48 cm² → 22,36 kg/m × 4 m = 89,4 kg (S355: zelfde ρ)
    { id: 2, startNodeId: 2, endNodeId: 3, profileName: "IPE 200", material: "S355" },
    // Platstaal 80×10: A = 8 cm² → 6,28 kg/m × 5 m (diagonaal 3-4-5) = 31,4 kg
    { id: 3, startNodeId: 1, endNodeId: 5, profileName: "Strip 80x10", material: "S235", tensionOnly: true },
    // Hout telt niet mee
    { id: 4, startNodeId: 1, endNodeId: 4, profileName: "100x200", material: "C24" },
    // Onbekend stalen profiel: niet meegeteld, wel gemeld
    { id: 5, startNodeId: 4, endNodeId: 2, profileName: "XYZ 999", material: "S235" },
    // Tweede HEA 200 (3 m) in dezelfde groep: 126,8 kg
    { id: 6, startNodeId: 4, endNodeId: 1, profileName: "HEA 200", material: "S235" },
  ],
};

console.log("[1] staalgewicht per staaf en totaal");
const g = openFem3DStaalgewicht(model);
const hea = g.perProfiel.find((p) => p.profiel === "HEA 200");
const ipe = g.perProfiel.find((p) => p.profiel === "IPE 200");
const strip = g.perProfiel.find((p) => p.profiel === "Strip 80x10");
check("HEA 200: 2 staven, 9 m, 7850 · 53,83 cm² · 9 m = 380,3 kg", hea?.aantal === 2 && dichtbij(hea.lengteM, 9, 1e-9) && dichtbij(hea.kg, 7850 * 53.83e-4 * 9), JSON.stringify(hea));
check("IPE 200 in S355: 7850 · 28,48 cm² · 4 m = 89,4 kg", ipe?.staalsoort === "S355" && dichtbij(ipe.kg, 7850 * 28.48e-4 * 4), JSON.stringify(ipe));
check("platstaal 80x10 (trek-alleen telt mee): 7850 · 8 cm² · 5 m = 31,4 kg", strip !== undefined && dichtbij(strip.kg, 7850 * 8e-4 * 5), JSON.stringify(strip));
check("totaal is de som van de staalprofielen", dichtbij(g.totaalKg, hea.kg + ipe.kg + strip.kg, 1e-12), String(g.totaalKg));
check("hout telt niet mee; 4 stalen staven", g.aantalStaven === 4);
check("onbekend stalen profiel wordt gemeld en niet meegeteld", JSON.stringify(g.onbekend) === "[5]");
check("zwaarste groep eerst", g.perProfiel[0].profiel === "HEA 200" && g.perProfiel[g.perProfiel.length - 1].profiel === "Strip 80x10");

console.log("\n[2] randgevallen");
check("leeg model: 0 kg", openFem3DStaalgewicht({ nodes: [], beams: [] }).totaalKg === 0);
check("alleen hout: geen stalen staven",
  openFem3DStaalgewicht({ nodes: model.nodes, beams: [model.beams[3]] }).aantalStaven === 0);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
