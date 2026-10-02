// DOM-schermafbeelding met html2canvas en color-mix (#100), in een echte
// Chromium. Bewijst eerst het probleem (zonder omzetting, en met de oude
// koppeling op volgorde terwijl er een script in de head staat), dan de
// oplossing: maakKleurenCompatibel loopt de kloon zelf na.
import html2canvas from "html2canvas";
import { compatibeleKleur, maakKleurenCompatibel } from "../src/lib/html2canvasKleuren";

const tests: { name: string; error?: string }[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); tests.push({ name }); }
  catch (e) { tests.push({ name, error: e instanceof Error ? e.message : String(e) }); }
}
function gelijk(a: unknown, b: unknown, m: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
function ok(v: unknown, m: string) { if (!v) throw Error(m); }

function bouwPagina() {
  const stijl = document.createElement("style");
  stijl.textContent = `
    .mix-achtergrond { background: color-mix(in srgb, #d97706 60%, transparent); width: 40px; height: 20px; }
    .mix-rand { border: 2px solid color-mix(in srgb, #16a34a 50%, white); width: 40px; height: 20px; }
    .mix-schaduw { box-shadow: 0 0 4px color-mix(in srgb, black 30%, transparent); width: 40px; height: 20px; }
    .mix-vlak { fill: color-mix(in srgb, #36363e 6%, #fafaf9); }
    .mix-tekst { color: color-mix(in srgb, #d97706 70%, black); }`;
  document.head.appendChild(stijl);
  // Zoals de app: scripts in de head, vóór de inhoud. html2canvas kloont ze niet.
  for (let i = 0; i < 3; i++) {
    const script = document.createElement("script");
    script.type = "text/plain";
    document.head.appendChild(script);
  }
  document.getElementById("root")!.innerHTML =
    '<div class="mix-achtergrond" id="achtergrond"></div><div class="mix-rand"></div><div class="mix-schaduw"></div>'
    + '<svg width="40" height="20"><rect class="mix-vlak" width="40" height="20"/></svg><span class="mix-tekst">tekst</span>';
}

/** De oude omzetting uit bediening.ts: origineel en kloon gekoppeld op volgorde. */
function oudeOmzetting(kopie: Document) {
  const eigenschappen = ["color", "background-color", "border-top-color", "border-right-color",
    "border-bottom-color", "border-left-color", "outline-color", "text-decoration-color", "fill", "stroke",
    "box-shadow", "text-shadow"];
  const bron = [document.documentElement, ...document.querySelectorAll<HTMLElement | SVGElement>("*")];
  const doel = [kopie.documentElement, ...kopie.querySelectorAll<HTMLElement | SVGElement>("*")];
  for (let index = 0; index < Math.min(bron.length, doel.length); index += 1) {
    const berekend = getComputedStyle(bron[index]);
    for (const eigenschap of eigenschappen) {
      const waarde = berekend.getPropertyValue(eigenschap);
      if (waarde.includes("color(")) doel[index].style.setProperty(eigenschap, compatibeleKleur(waarde));
    }
  }
}

async function run() {
  bouwPagina();
  const root = document.getElementById("root")!;

  await test("Chromium geeft color-mix terug als color(): het probleem bestaat hier", () => {
    ok(getComputedStyle(document.getElementById("achtergrond")!).backgroundColor.includes("color("),
      "achtergrond: " + getComputedStyle(document.getElementById("achtergrond")!).backgroundColor);
  });

  await test("zonder omzetting stopt html2canvas op color()", async () => {
    let fout = "";
    try { await html2canvas(root, { logging: false }); } catch (e) { fout = String(e); }
    ok(/color/i.test(fout), "geen fout: " + fout);
  });

  await test("de oude koppeling op volgorde faalt met scripts in de head", async () => {
    let fout = "";
    try { await html2canvas(root, { logging: false, onclone: oudeOmzetting }); } catch (e) { fout = String(e); }
    ok(/color/i.test(fout), "geen fout: " + fout);
  });

  await test("maakKleurenCompatibel: html2canvas slaagt en tekent de kleur", async () => {
    const canvas = await html2canvas(root, { logging: false, backgroundColor: "#ffffff", onclone: maakKleurenCompatibel });
    ok(canvas.width > 0 && canvas.height > 0, "leeg canvas");
    const schaal = canvas.width / root.getBoundingClientRect().width;
    const vak = document.getElementById("achtergrond")!.getBoundingClientRect();
    const r0 = root.getBoundingClientRect();
    const px = canvas.getContext("2d")!.getImageData(
      Math.round((vak.left - r0.left + 20) * schaal), Math.round((vak.top - r0.top + 10) * schaal), 1, 1).data;
    // #d97706 60% over wit: r ≈ 232, g ≈ 173, b ≈ 106.
    ok(Math.abs(px[0] - 232) <= 3 && Math.abs(px[1] - 173) <= 3 && Math.abs(px[2] - 106) <= 3,
      "pixel " + Array.from(px).join(","));
  });

  await test("compatibeleKleur: srgb, display-p3, alfa, procenten en meerdere kleuren in één waarde", () => {
    gelijk(compatibeleKleur("color(srgb 1 0 0)"), "rgba(255,0,0,1)", "rood");
    gelijk(compatibeleKleur("color(srgb 0.5 0.5 0.5 / 0.25)"), "rgba(128,128,128,0.25)", "grijs met alfa");
    gelijk(compatibeleKleur("color(display-p3 100% 0% 0% / 50%)"), "rgba(255,0,0,0.5)", "p3 in procenten");
    gelijk(compatibeleKleur("color(srgb 0 0 0 / 0.3) 0px 0px 4px 0px, color(srgb 1 1 1) 1px 1px 0px 0px"),
      "rgba(0,0,0,0.3) 0px 0px 4px 0px, rgba(255,255,255,1) 1px 1px 0px 0px", "schaduw met twee kleuren");
    gelijk(compatibeleKleur("rgb(1, 2, 3)"), "rgb(1, 2, 3)", "gewone kleur blijft");
  });
}

run()
  .then(() => { document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: null }); })
  .catch((e) => { document.getElementById("uitslag")!.textContent = JSON.stringify({ tests, error: String(e?.stack ?? e) }); });
