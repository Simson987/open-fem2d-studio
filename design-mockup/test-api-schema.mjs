// De strenge validator van de API-invoer (src/api/schema.ts): een vaste
// subset van JSON Schema. Elk probleem met zijn pad; een onbekend veld is een
// fout, geen stille standaardwaarde.
const { valideer, isStrikt } = await import("./src/api/schema.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const paden = (problemen) => problemen.map((p) => p.pad).join(" ");
const toon = (problemen) => JSON.stringify(problemen);

const punt = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number", minimum: 0 },
    id: { type: "integer", exclusiveMinimum: 0 },
    soort: { type: "string", enum: ["vast", "scharnier"] },
    naam: { type: "string", minLength: 1 },
    actief: { type: "boolean" },
    niveau: { oneOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["x"],
  additionalProperties: false,
};

console.log("[1] object");
check("geldig object → geen problemen", valideer(punt, { x: 1, y: 2, id: 3, soort: "vast", naam: "A", actief: true, niveau: null }).length === 0);
check("verplicht veld ontbreekt → pad .x", paden(valideer(punt, {})) === ".x", toon(valideer(punt, {})));
const onbekend = valideer(punt, { x: 1, z: 2 });
check("onbekend veld → pad .z, melding 'onbekend veld'", paden(onbekend) === ".z" && onbekend[0].melding.includes("onbekend veld"), toon(onbekend));
check("alle problemen, niet alleen het eerste", valideer(punt, { y: -1, z: 0 }).length === 3, toon(valideer(punt, { y: -1, z: 0 })));
check("geen object (lijst, null, tekst) → probleem op de wortel",
  [[], null, "x"].every((w) => valideer(punt, w).length === 1 && valideer(punt, w)[0].pad === ""));
check("een expliciete undefined geldt als ontbrekend", paden(valideer(punt, { x: undefined })) === ".x");

console.log("\n[2] getallen, tekst, ja/nee");
check("verkeerd type → verwacht een getal", valideer(punt, { x: "1" })[0]?.melding.includes("getal"));
check("NaN en Infinity zijn geen geldig getal",
  valideer(punt, { x: Number.NaN }).length === 1 && valideer(punt, { x: Number.POSITIVE_INFINITY }).length === 1);
check("integer met 1,5 → geweigerd", paden(valideer(punt, { x: 0, id: 1.5 })) === ".id");
check("minimum 0: -1 geweigerd, 0 goed", paden(valideer(punt, { x: 0, y: -1 })) === ".y" && valideer(punt, { x: 0, y: 0 }).length === 0);
check("exclusiveMinimum 0: 0 geweigerd, 1 goed", paden(valideer(punt, { x: 0, id: 0 })) === ".id" && valideer(punt, { x: 0, id: 1 }).length === 0);
const verkeerdeSoort = valideer(punt, { x: 0, soort: "rol" });
check("enum → de toegestane waarden staan in de melding", verkeerdeSoort.length === 1 && verkeerdeSoort[0].melding.includes("vast") && verkeerdeSoort[0].melding.includes("scharnier"), toon(verkeerdeSoort));
check("minLength 1: lege naam geweigerd", paden(valideer(punt, { x: 0, naam: "" })) === ".naam");
check("boolean: 1 is geen ja/nee", paden(valideer(punt, { x: 0, actief: 1 })) === ".actief");

console.log("\n[3] lijsten");
const lijst = { type: "array", items: punt, minItems: 2, maxItems: 3 };
check("geldige lijst", valideer(lijst, [{ x: 1 }, { x: 2 }]).length === 0);
check("minItems 2: één element geweigerd", valideer(lijst, [{ x: 1 }]).length === 1);
check("maxItems 3: vier elementen geweigerd", valideer(lijst, [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }]).length === 1);
check("fout element → pad [1].x", paden(valideer(lijst, [{ x: 1 }, {}])) === "[1].x", toon(valideer(lijst, [{ x: 1 }, {}])));

console.log("\n[4] oneOf en const");
const keuze = {
  oneOf: [
    { type: "object", properties: { kind: { const: "move" }, dx: { type: "number" } }, required: ["kind", "dx"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "rotate" }, angleDeg: { type: "number" } }, required: ["kind", "angleDeg"], additionalProperties: false },
  ],
};
check("past bij precies één vorm → goed", valideer(keuze, { kind: "move", dx: 1 }).length === 0);
const geen = valideer(keuze, { kind: "scale", f: 2 });
check("past bij geen vorm → één probleem op de wortel", geen.length === 1 && geen[0].pad === "" && geen[0].melding.includes("geen"), toon(geen));
const beide = { oneOf: [{ type: "number" }, { type: "number", minimum: 0 }] };
check("past bij twee vormen → geweigerd", valideer(beide, 3).length === 1 && valideer(beide, 3)[0].melding.includes("meer dan één"));
check("const: andere waarde geweigerd", valideer({ const: "move" }, "rotate").length === 1);
check("null: alleen null", valideer({ type: "null" }, null).length === 0 && valideer({ type: "null" }, 0).length === 1);

console.log("\n[5] strengheid van een schema");
check("een strikt schema → geen paden", isStrikt(punt).length === 0 && isStrikt(lijst).length === 0 && isStrikt(keuze).length === 0);
const los = { type: "object", properties: { a: { type: "object", properties: { b: { type: "number" } } } }, additionalProperties: false };
check("object zonder additionalProperties:false op diepte 2 → zijn pad", JSON.stringify(isStrikt(los)) === JSON.stringify([".a"]), JSON.stringify(isStrikt(los)));
const losInLijst = { type: "array", items: { oneOf: [{ type: "object", properties: {} }] } };
check("ook in items en oneOf", isStrikt(losInLijst).length === 1, JSON.stringify(isStrikt(losInLijst)));

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
