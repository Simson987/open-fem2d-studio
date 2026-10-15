/**
 * betonDoorsnedeGrootheden — de doorsnedegrootheden van een betondoorsnede
 * (rechthoek, T of L), op één plek voor de 2D-solver en de 3D-kern
 * (issue #197).
 *
 * WAAROM ÉÉN HULPFUNCTIE. De 2D-solver had A en I_y van een T of L al
 * (`sectionResolver`), de 3D-adapter kende alleen een rechthoek en weigerde
 * "T 400x450 bw=200 hf=50" met "mist Iz en J". Nu leveren beide paden hun
 * getallen uit deze functie, zodat A en I_y in 2D en 3D niet uit elkaar
 * kunnen lopen.
 *
 * DE AANNAMEN (alle maten in mm, assen zoals de rest van de app: y de sterke
 * as, horizontaal; z de zwakke as, verticaal)
 *  - Flens b_f × h_f, lijf b_w × (h − h_f). Een T heeft het lijf in het
 *    midden van de flens, een L aan één rand. `flens=onder` spiegelt om de
 *    y-as: A, I_y en I_z veranderen daar niet door.
 *  - I_y en I_z om de zwaartepuntsassen (Steiner).
 *  - L-ligger: de rekenassen blijven de geometrische assen. Het
 *    traagheidsproduct I_yz ≠ 0 wordt teruggegeven maar niet gebruikt: een
 *    L-ligger hangt in een vloer, die de flens zijdelings vasthoudt; de
 *    betontoets rekent ook om de geometrische assen. Een vrij hangende L met
 *    hoofdassen onder een hoek hoort als eigen doorsnede (`EIGEN:`) in de
 *    profieleditor.
 *  - Wringing I_t: de som van de deelrechthoeken flens en lijf (NEN-EN
 *    1992-1-1 6.3.1(3): een samengestelde doorsnede wordt opgedeeld in
 *    deeldoorsneden), elk met de reeks van Saint-Venant
 *    (`rechthoekTorsieconstante`).
 *  - Afschuifoppervlakken (alleen bij afschuifvervorming): A_v,z = 5/6·b_w·h
 *    (het lijf draagt de verticale dwarskracht), A_v,y = 5/6·A. Voor een
 *    rechthoek (b_w = b_f) is dat beide 5/6·b·h, dezelfde waarde als de
 *    rechthoek in de 3D-adapter.
 *
 * Wapening telt niet mee: ongescheurde betondoorsnede, zoals de lineaire
 * krachtsverdeling elders in de app.
 */
import type { ConcreteSectionInput } from "./types/concrete/ConcreteSectionInput";

/** Doorsnedegrootheden in mm² en mm⁴. */
export interface BetonDoorsnedeGrootheden {
  A: number;
  /** Om de sterke (horizontale) y-as, door het zwaartepunt. */
  Iy: number;
  /** Om de zwakke (verticale) z-as, door het zwaartepunt. */
  Iz: number;
  /** Traagheidsproduct om de zwaartepuntsassen (0 bij een rechthoek en een T). */
  Iyz: number;
  /** Torsieconstante. */
  It: number;
  /** Afschuifoppervlak voor de dwarskracht langs y (horizontaal). */
  AvY: number;
  /** Afschuifoppervlak voor de dwarskracht langs z (verticaal, het lijf). */
  AvZ: number;
}

/**
 * Torsieconstante I_t van een massieve rechthoek b × h (mm⁴), de reeks van
 * Saint-Venant zoals in de literatuur (Roark): l·k³·(1/3 − 0,21·k/l·(1 − k⁴/(12·l⁴)))
 * met l de lange en k de korte zijde.
 */
export function rechthoekTorsieconstante(bMm: number, hMm: number): number {
  const long = Math.max(bMm, hMm);
  const short = Math.min(bMm, hMm);
  return long * short ** 3 * (1 / 3 - 0.21 * (short / long) * (1 - short ** 4 / (12 * long ** 4)));
}

/**
 * De grootheden van een (door `parseConcreteSection` gelezen) betondoorsnede,
 * of `null` als de maten geen doorsnede opleveren.
 */
export function betonDoorsnedeGrootheden(d: ConcreteSectionInput): BetonDoorsnedeGrootheden | null {
  if (d.shape === "Rectangle") {
    const b = d.b_mm, h = d.h_mm;
    if (!(b > 0 && h > 0)) return null;
    const A = b * h;
    return {
      A, Iy: (b * h ** 3) / 12, Iz: (h * b ** 3) / 12, Iyz: 0,
      It: rechthoekTorsieconstante(b, h), AvY: (5 / 6) * A, AvZ: (5 / 6) * A,
    };
  }
  const bF = d.b_mm;
  const hF = d.h_f_mm ?? 0;
  const bW = d.b_w_mm ?? 0;
  const hW = d.h_mm - hF;
  if (!(bF > 0 && hF > 0 && bW > 0 && hW > 0)) return null;
  const aF = bF * hF;
  const aW = bW * hW;
  const A = aF + aW;
  // Verticaal: zwaartepunt vanaf de onderrand, lijf onder en flens erboven.
  const zF = hW + hF / 2;
  const zW = hW / 2;
  const zG = (aF * zF + aW * zW) / A;
  const Iy = (bF * hF ** 3) / 12 + aF * (zF - zG) ** 2 + (bW * hW ** 3) / 12 + aW * (zW - zG) ** 2;
  // Horizontaal: bij een T staat het lijf in het midden, bij een L aan de rand.
  const yF = bF / 2;
  const yW = d.shape === "Tee" ? bF / 2 : bW / 2;
  const yG = (aF * yF + aW * yW) / A;
  const Iz = (hF * bF ** 3) / 12 + aF * (yF - yG) ** 2 + (hW * bW ** 3) / 12 + aW * (yW - yG) ** 2;
  const Iyz = aF * (yF - yG) * (zF - zG) + aW * (yW - yG) * (zW - zG);
  const It = rechthoekTorsieconstante(bF, hF) + rechthoekTorsieconstante(bW, hW);
  return { A, Iy, Iz, Iyz, It, AvY: (5 / 6) * A, AvZ: (5 / 6) * bW * d.h_mm };
}
