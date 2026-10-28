// Issue #237: bij categorie H (dak, ψ₀ = ψ₁ = ψ₂ = 0) valt elke frequente
// combinatie "6.15b — Dak (H) leidend" samen met een quasi-blijvende 6.16b.
// Het model van de controleset (OFS-022): eigen gewicht, G, Q cat. A, sneeuw,
// wind, opslag cat. E en dak cat. H, gevolgklasse CC2.
//
// Verwacht (controle 26-10-2026): 72 combinaties (36 UGT, 36 BGT), waarvan
// vier frequente met dezelfde factoren als een quasi-blijvende.
// Gekozen oplossing: de combinaties blijven staan — de toetsen die alleen de
// 6.15b-lijst lezen (scheurwijdte, plaat) hebben ze formeel nodig — maar de
// formule zegt met welke quasi-blijvende combinatie ze samenvallen.
//
// Uitvoeren: npx tsx test-categorie-h-combinaties.mjs   (vanuit design-mockup/)
const { genereerStandaardCombinaties } = await import("./src/components/fem/solver/normcombinaties.ts");

let geslaagd = 0;
let gefaald = 0;
function check(naam, ok, detail = "") {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); }
  else { gefaald++; console.log(`  ✗ ${naam}${detail ? ` — ${detail}` : ""}`); }
}

const gevallen = [
  { id: 1, name: "Eigen gewicht", type: "dead" },
  { id: 2, name: "Permanent (G)", type: "dead" },
  { id: 3, name: "Variabel (Q)", type: "live", categorie: "A" },
  { id: 4, name: "Sneeuw (S)", type: "snow" },
  { id: 5, name: "Wind (W)", type: "wind" },
  { id: 6, name: "Opslag", type: "live", categorie: "E" },
  { id: 7, name: "Dak", type: "live", categorie: "H" },
];
const set = genereerStandaardCombinaties(gevallen, "CC2");
const sleutel = (c) => [...c.factors].filter(([, x]) => x !== 0).sort((a, b) => a[0] - b[0]).map(([id, x]) => `${id}:${x}`).join(",");

console.log("[1] de set zelf is ongewijzigd");
check("72 combinaties: 36 UGT en 36 BGT", set.length === 72
  && set.filter((c) => c.type === "uls").length === 36 && set.filter((c) => c.type === "sls").length === 36,
  `${set.length} (${set.filter((c) => c.type === "uls").length} UGT)`);

console.log("[2] frequent = quasi-blijvend wordt vermeld");
const quasi = new Map(set.filter((c) => c.standaard.soort === "6.16b").map((c) => [sleutel(c), c.name]));
const samen = set.filter((c) => c.standaard.soort === "6.15b" && quasi.has(sleutel(c)));
check("vier frequente combinaties vallen samen met een quasi-blijvende", samen.length === 4, `${samen.length}`);
check("het zijn de combinaties met Dak (H) leidend", samen.every((c) => /Dak.*leidend/.test(c.name)),
  samen.map((c) => c.name).join("; "));
check("elk vermeldt de quasi-blijvende combinatie en ψ₁ = 0",
  samen.every((c) => c.formula.includes(`(= ${quasi.get(sleutel(c))}: ψ₁ van de leidende last is 0)`)));
const overige = set.filter((c) => !samen.includes(c));
check("geen andere combinatie krijgt die vermelding", overige.every((c) => !c.formula.includes("ψ₁ van de leidende last is 0")));
check("de leidende dakbelasting heeft factor 0 in die vier", samen.every((c) => (c.factors.get(7) ?? 0) === 0));

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
