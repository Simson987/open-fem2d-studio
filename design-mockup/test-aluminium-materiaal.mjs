import assert from "node:assert/strict";
import { parseAluminiumMateriaal } from "./src/lib/aluminiumMateriaal.ts";
import { resolveSection, dichtheidVanMateriaal } from "./src/lib/sectionResolver.ts";

// European Aluminium, Introduction to Eurocode 9, worked example 1, p. 55-56:
// EN AW-6063-T6, E = 70 000 N/mm² and an unwelded I-section.
const naam = "ALU:EN AW-6063-T6";
assert.equal(parseAluminiumMateriaal(naam)?.eMod, 70000);
assert.equal(resolveSection(naam, "100x200").E, 70000);
assert.equal(resolveSection(naam, "100x200").A, 20000);
assert.equal(dichtheidVanMateriaal(naam), 2700);
assert.match(resolveSection("ALU:EN AW-9999-T6", "100x200").reden, /niet ondersteund/);
assert.match(resolveSection("mystery-alloy", "100x200").reden, /niet ondersteund/);
assert.throws(() => dichtheidVanMateriaal("mystery-alloy"), /geen bekende dichtheid/);
assert.equal(resolveSection("S235", "HEA 160").E, 210000);
console.log("Aluminiummateriaal en onbekende materialen: OK");
