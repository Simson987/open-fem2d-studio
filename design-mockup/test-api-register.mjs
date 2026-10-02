// Het commandoregister van de API (src/api/register.ts): catalogus, strenge
// controle bij het opbouwen, validatie vóór uitvoering en vaste foutcodes.
const { ApiFout, maakRegister } = await import("./src/api/register.ts");
const { leegDocument } = await import("./src/api/projectDocument.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const fout = (fn) => { try { const r = fn(); return r instanceof Promise ? r.then(() => null, (e) => e) : null; } catch (e) { return e; } };

let aangeroepen = 0;
const knoopToevoegen = {
  naam: "model3d.node.add", beschrijving: "Knoop toevoegen.", soort: "document",
  invoer: {
    type: "object", additionalProperties: false, required: ["x", "y", "z"],
    properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
  },
  uitvoeren: (invoer, context) => { aangeroepen++; return { uitkomst: { x: invoer.x }, document: context.document }; },
};
const modelLezen = {
  naam: "model3d.get", beschrijving: "Model lezen.", soort: "document",
  invoer: { type: "object", additionalProperties: false, properties: {} },
  uitvoeren: () => ({ uitkomst: { ok: true } }),
};
const weigeraar = {
  naam: "model3d.beam.add", beschrijving: "Staaf toevoegen.", soort: "document",
  invoer: { type: "object", additionalProperties: false, properties: {} },
  uitvoeren: () => { throw new Error("Knoop 9 bestaat niet."); },
};
const eigenFout = {
  naam: "model3d.beam.delete", beschrijving: "Staaf verwijderen.", soort: "document",
  invoer: { type: "object", additionalProperties: false, properties: {} },
  uitvoeren: () => { throw new ApiFout("NIET_GEVONDEN", "Staaf 4 bestaat niet.", { id: 4 }); },
};
const appCommando = {
  naam: "app.undo", beschrijving: "Ongedaan maken.", soort: "app",
  invoer: { type: "object", additionalProperties: false, properties: {} },
  uitvoeren: async (_invoer, context) => {
    if (!context.app) throw new Error("geen app");
    return { uitkomst: { gedaan: true } };
  },
};
const register = maakRegister([knoopToevoegen, modelLezen, weigeraar, eigenFout, appCommando]);

console.log("[1] catalogus en opbouw");
const catalogus = register.catalogus();
check("gesorteerd op naam", catalogus.map((c) => c.naam).join() === "app.undo,model3d.beam.add,model3d.beam.delete,model3d.get,model3d.node.add",
  catalogus.map((c) => c.naam).join());
check("elk item: naam, beschrijving, invoer en soort, geen uitvoering",
  catalogus.every((c) => c.naam && c.beschrijving && c.invoer && c.soort && !("uitvoeren" in c)));
check("heeft()", register.heeft("model3d.get") && !register.heeft("model3d.niets"));
check("een dubbele naam gooit", fout(() => maakRegister([modelLezen, modelLezen])) instanceof Error);
for (const naam of ["model3d", "Model3d.get", "model3d.node-add", "model3d..get"]) {
  check(`ongeldige naam "${naam}" gooit`, fout(() => maakRegister([{ ...modelLezen, naam }])) instanceof Error);
}
check("een invoer die geen object is, gooit", fout(() => maakRegister([{ ...modelLezen, invoer: { type: "number" } }])) instanceof Error);
const losSchema = { type: "object", additionalProperties: false, properties: { a: { type: "object", properties: {} } } };
const losFout = fout(() => maakRegister([{ ...modelLezen, invoer: losSchema }]));
check("een niet-streng schema gooit, met het pad", losFout instanceof Error && losFout.message.includes(".a"), losFout?.message);

console.log("\n[2] uitvoeren en foutcodes");
const document = leegDocument();
const goed = await register.voerUit("model3d.node.add", { x: 1, y: 2, z: 3 }, { document });
check("geldige invoer → de uitkomst van het commando", goed.uitkomst.x === 1 && goed.document === document);
const onbekend = await fout(() => register.voerUit("model3d.node.ad", {}, { document }));
check("onbekend commando → ONBEKEND_COMMANDO, met suggesties", onbekend?.code === "ONBEKEND_COMMANDO"
  && onbekend.detail.suggesties.includes("model3d.node.add"), JSON.stringify(onbekend?.detail));
const voor = aangeroepen;
const ongeldig = await fout(() => register.voerUit("model3d.node.add", { x: "1", w: 0 }, { document }));
check("ongeldige invoer → INVOER_ONGELDIG met alle problemen", ongeldig?.code === "INVOER_ONGELDIG"
  && ongeldig.detail.problemen.length === 4, JSON.stringify(ongeldig?.detail));
check("… en het commando is niet uitgevoerd", aangeroepen === voor);
check("de melding noemt de paden", ongeldig?.message.includes(".x") && ongeldig.message.includes(".w"), ongeldig?.message);
const geenDoc = await fout(() => register.voerUit("model3d.get", {}, {}));
check("documentcommando zonder document → GEEN_DOCUMENT", geenDoc?.code === "GEEN_DOCUMENT");
const geweigerd = await fout(() => register.voerUit("model3d.beam.add", {}, { document }));
check("een Error uit het commando → GEWEIGERD met dezelfde melding", geweigerd?.code === "GEWEIGERD" && geweigerd.message === "Knoop 9 bestaat niet.");
const eigen = await fout(() => register.voerUit("model3d.beam.delete", {}, { document }));
check("een ApiFout gaat ongewijzigd door", eigen?.code === "NIET_GEVONDEN" && eigen.detail.id === 4);
check("zonder invoer telt als {}", (await register.voerUit("model3d.get", undefined, { document })).uitkomst.ok === true);

console.log("\n[3] app-commando's");
check("een app-commando mag async zijn", (await register.voerUit("app.undo", {}, { app: {} })).uitkomst.gedaan === true);
const appFout = await fout(() => register.voerUit("app.undo", {}, {}));
check("een afgewezen belofte → GEWEIGERD", appFout?.code === "GEWEIGERD" && appFout.message === "geen app", appFout?.message);

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
