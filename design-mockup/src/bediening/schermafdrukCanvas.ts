/**
 * schermafdrukCanvas.ts — de WebGL-tekenvlakken in de DOM-schermafdruk
 * (`gui_screenshot` met `dom`, de standaard op Linux en macOS).
 *
 * WAAROM
 * De venstercapture van de app (`PrintWindow`) bestaat alleen op Windows.
 * Elders maakt `screenshot_dom` het beeld met html2canvas. Dat kopieert een
 * <canvas> pas als het de pagina kloont, asynchroon; de 3D-tekenvlakken
 * (Three.js, `preserveDrawingBuffer` uit, tekenen op verzoek) hebben hun
 * tekenbuffer dan al aan de compositor afgegeven, en html2canvas krijgt een
 * leeg vlak. Op Linux was de 3D-weergave in de schermafdruk zo altijd leeg.
 *
 * HOE
 * 1. `SCHERMAFDRUK_EVENT` op `window`: elk 3D-tekenvlak tekent zich SYNCHROON
 *    opnieuw (ThreeFrameCanvas luistert);
 * 2. in dezelfde taak `toDataURL()` van elk canvas — de buffer is dan nog
 *    gevuld — en het canvas een merk (`data-schermafdruk`) geven;
 * 3. in de kloon van html2canvas (`onclone`) het beeld op het gemerkte canvas
 *    tekenen; daarna de merken weer weg.
 * Het merk (geen volgnummer) omdat html2canvas elementen met
 * `data-html2canvas-ignore` niet kloont: de volgorde verschuift dan.
 */

/** Het event waarop een WebGL-tekenvlak zich direct opnieuw tekent. */
export const SCHERMAFDRUK_EVENT = "openaec-schermafdruk";
export const SCHERMAFDRUK_MERK = "data-schermafdruk";

/** Wat hier van een canvas nodig is (een echte HTMLCanvasElement voldoet). */
export interface CanvasLike {
  width: number;
  height: number;
  toDataURL(type?: string): string;
  setAttribute(naam: string, waarde: string): void;
  removeAttribute(naam: string): void;
}

/**
 * Stap 1 en 2: laat de tekenvlakken tekenen en lees ze meteen uit. Een canvas
 * zonder afmeting of dat niet uit te lezen is (besmet) slaat het over; dan
 * doet html2canvas wat het altijd deed. Geeft de beelden per merk terug.
 */
export function legCanvassenVast(
  canvassen: Iterable<CanvasLike>,
  meldTekenen: () => void,
): Map<string, string> {
  meldTekenen();
  const beelden = new Map<string, string>();
  let i = 0;
  for (const canvas of canvassen) {
    if (canvas.width <= 0 || canvas.height <= 0) continue;
    try {
      const data = canvas.toDataURL("image/png");
      if (!data.startsWith("data:image/png")) continue;
      const merk = String(i++);
      canvas.setAttribute(SCHERMAFDRUK_MERK, merk);
      beelden.set(merk, data);
    } catch {
      // Besmet canvas: overslaan.
    }
  }
  return beelden;
}

/** Stap 3: teken de vastgelegde beelden op de gekloonde canvassen. */
export async function tekenInKloon(
  kloon: { querySelectorAll(selector: string): Iterable<unknown> },
  beelden: ReadonlyMap<string, string>,
  laadBeeld: (dataUrl: string) => Promise<CanvasImageSource>,
): Promise<number> {
  let getekend = 0;
  for (const el of kloon.querySelectorAll(`canvas[${SCHERMAFDRUK_MERK}]`)) {
    const canvas = el as { getAttribute(n: string): string | null; getContext(t: "2d"): CanvasRenderingContext2D | null; width: number; height: number };
    const data = beelden.get(canvas.getAttribute(SCHERMAFDRUK_MERK) ?? "");
    const ctx = canvas.getContext("2d");
    if (!data || !ctx) continue;
    const beeld = await laadBeeld(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(beeld, 0, 0, canvas.width, canvas.height);
    getekend++;
  }
  return getekend;
}

/** Na de schermafdruk: de merken van de echte canvassen weer weg. */
export function verwijderMerken(canvassen: Iterable<CanvasLike>): void {
  for (const canvas of canvassen) canvas.removeAttribute(SCHERMAFDRUK_MERK);
}
