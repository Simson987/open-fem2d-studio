// Een lastwaarde intypen (#52): komma of punt, min-teken, eenheid erachter.
const { leesLastWaarde, toonLastWaarde } = await import("./src/lib/lastWaarde.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

console.log("[1] lezen");
const gevallen = [
  ["-0,7", -0.7], ["-0.7", -0.7], ["−0,7", -0.7], ["–2,5", -2.5], ["5", 5], ["+5", 5], [" -12,25 ", -12.25],
  [",5", 0.5], ["-.5", -0.5], ["3,", 3], ["-7,5 kN/m", -7.5], ["-7,5kN/m²", -7.5], ["10 kN", 10], ["2 kNm", 2], ["0", 0],
];
for (const [tekst, verwacht] of gevallen) {
  const uit = leesLastWaarde(tekst);
  check(`"${tekst}" → ${verwacht}`, uit !== null && Math.abs(uit - verwacht) < 1e-12, String(uit));
}
for (const tekst of ["", "-", ",", "abc", "1.000,5", "1,2,3", "5 kg", "--5", "5-", "1e3", "NaN", "Infinity"]) {
  check(`"${tekst}" is geen lastwaarde`, leesLastWaarde(tekst) === null, String(leesLastWaarde(tekst)));
}

console.log("\n[2] tonen");
check("komma als decimaalteken", toonLastWaarde(-0.7) === "-0,7");
check("geen overbodige nullen", toonLastWaarde(-5) === "-5" && toonLastWaarde(2.5) === "2,5");
check("rekenruis weg", toonLastWaarde(0.1 + 0.2) === "0,3");
check("geen min bij nul", toonLastWaarde(-0) === "0");
check("tonen en lezen zijn elkaars omgekeerde", [-0.7, 12.25, -3, 0.001].every((v) => leesLastWaarde(toonLastWaarde(v)) === v));

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
