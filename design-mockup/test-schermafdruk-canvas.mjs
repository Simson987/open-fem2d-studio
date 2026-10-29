// De 3D-tekenvlakken in de DOM-schermafdruk (gui_screenshot buiten Windows).
// Op Linux bestaat de venstercapture van de app niet; html2canvas kopieert
// een WebGL-canvas pas na het klonen, als de tekenbuffer al leeg is. De
// bediening laat de tekenvlakken daarom eerst synchroon tekenen, leest ze in
// dezelfde taak uit en tekent dat beeld op de kloon. Hier met nep-canvassen
// (geen DOM in node): volgorde, merk, overslaan, opruimen, en de bedrading.
//
// Uitvoeren: npx tsx test-schermafdruk-canvas.mjs   (vanuit design-mockup/)
import { readFileSync } from "node:fs";

const { legCanvassenVast, tekenInKloon, verwijderMerken, SCHERMAFDRUK_EVENT, SCHERMAFDRUK_MERK } =
  await import("./src/bediening/schermafdrukCanvas.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

// Een WebGL-canvas zonder preserveDrawingBuffer: alleen na `teken()` en vóór
// de volgende taak staat er iets in de buffer.
const nepCanvas = (naam, { breedte = 100, besmet = false } = {}) => {
  const attrs = new Map();
  let buffer = "";
  return {
    naam, width: breedte, height: 50,
    teken() { buffer = naam; },
    leeg() { buffer = ""; },
    toDataURL() { if (besmet) throw new Error("tainted"); return `data:image/png;base64,${buffer || "LEEG"}`; },
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => attrs.get(k) ?? null,
    attrs,
  };
};

console.log("\n[1] eerst tekenen, dan in dezelfde taak uitlezen");
{
  const drie = nepCanvas("3D");
  const leeg = nepCanvas("nul", { breedte: 0 });
  const besmet = nepCanvas("vreemd", { besmet: true });
  const tweede = nepCanvas("detail");
  const alle = [drie, leeg, besmet, tweede];
  const beelden = legCanvassenVast(alle, () => { drie.teken(); tweede.teken(); });
  check("het 3D-beeld is gevuld (niet de lege buffer)", beelden.get("0") === "data:image/png;base64,3D", JSON.stringify([...beelden]));
  check("tweede tekenvlak met eigen merk", beelden.get("1") === "data:image/png;base64,detail");
  check("canvas zonder afmeting en besmet canvas overgeslagen, zonder merk",
    beelden.size === 2 && !leeg.attrs.has(SCHERMAFDRUK_MERK) && !besmet.attrs.has(SCHERMAFDRUK_MERK));
  check("merken op de echte canvassen", drie.attrs.get(SCHERMAFDRUK_MERK) === "0" && tweede.attrs.get(SCHERMAFDRUK_MERK) === "1");

  // De kloon mist hier het eerste canvas (html2canvas kloont een element met
  // data-html2canvas-ignore niet): het merk telt, niet de volgorde.
  const getekend = [];
  const kloonCanvas = (merk) => ({
    width: 100, height: 50,
    getAttribute: (k) => (k === SCHERMAFDRUK_MERK ? merk : null),
    getContext: () => ({ clearRect() {}, drawImage: (img) => getekend.push([merk, img]) }),
  });
  const kloon = { querySelectorAll: (sel) => (sel === `canvas[${SCHERMAFDRUK_MERK}]` ? [kloonCanvas("1")] : []) };
  drie.leeg(); tweede.leeg(); // de compositor heeft de buffers inmiddels geleegd
  const n = await tekenInKloon(kloon, beelden, async (data) => `beeld:${data}`);
  check("de kloon krijgt het vastgelegde beeld bij het juiste merk", n === 1 && getekend[0]?.[1] === "beeld:data:image/png;base64,detail",
    JSON.stringify(getekend));
  verwijderMerken(alle);
  check("merken weer weg", alle.every((c) => !c.attrs.has(SCHERMAFDRUK_MERK)));
}

console.log("\n[2] bedrading");
{
  const bediening = readFileSync(new URL("./src/bediening/bediening.ts", import.meta.url), "utf8");
  check("screenshot_dom legt de canvassen vast vóór html2canvas en tekent ze in de kloon",
    /legCanvassenVast\(echte, \(\) => window\.dispatchEvent\(new Event\(SCHERMAFDRUK_EVENT\)\)\)[\s\S]{0,400}html2canvas\(document\.body[\s\S]{0,300}tekenInKloon\(kloon, beelden/.test(bediening)
    && /finally \{\s*verwijderMerken\(echte\);/.test(bediening));
  const canvas3d = readFileSync(new URL("./src/components/openFem3d/ThreeFrameCanvas.tsx", import.meta.url), "utf8");
  check("het 3D-tekenvlak tekent op het event, en meldt zich af",
    canvas3d.includes("window.addEventListener(SCHERMAFDRUK_EVENT, renderScene);")
    && canvas3d.includes("window.removeEventListener(SCHERMAFDRUK_EVENT, renderScene);"));
  check("eventnaam", SCHERMAFDRUK_EVENT === "openaec-schermafdruk");
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
