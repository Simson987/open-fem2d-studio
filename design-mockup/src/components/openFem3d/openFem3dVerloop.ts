/**
 * Verlopende 3D-staven (issue #73): een staaf met `profileName` aan het begin
 * en `profileNameEnd` aan het eind, de maten lineair ertussen.
 *
 * DEZELFDE REGELS ALS 2D. Er is hier geen tweede keuring en geen tweede
 * rekenregel:
 *  - of er een verloop is, en welk, beslist `bepaalVerloop` (lib/sectionResolver):
 *    rechthoek ↔ rechthoek (hout, vrij materiaal) of I/H ↔ I/H uit de
 *    staalcatalogus (gerekend als gelast I-profiel zonder afrondingsstraal);
 *    alles daarbuiten wordt met reden geweigerd;
 *  - het aantal delen is dat van een 2D-staaf (`aantalVerloopSegmenten`,
 *    lib/modelNaarSolverInput): 20 gelijke delen, minder als een deel korter
 *    dan 25 mm zou worden;
 *  - elk deel rekent met de doorsnede in zijn MIDDEN, zoals in 2D
 *    (`segmentenVoorVerloop`). Een staaf in 3D heeft daarvoor naast A en I_y
 *    ook I_z en I_t nodig; die komen voor een gelaste I uit dezelfde gesloten
 *    formules als de tussendoorsnede die het splitsen van een verlopende staaf
 *    bewaart (`gelasteIEigenschappen`, lib/verloopSplitsen), en voor een
 *    rechthoek uit b en h met de torsieconstante die ook een prismatische
 *    rechthoek in 3D krijgt.
 *
 * De rekenkern kent per staaf een lijst doorsneden, één per gelijk deel
 * (`partSectionIds` van Member3D); `buildOpenFem3DSolveRequest` zet die lijst
 * met de delen van {@link openFem3DVerloopDelen}.
 *
 * Puur: geen React, geen DOM.
 */
import {
  bepaalVerloop,
  matenOpPositie,
  type VerlopendeDoorsnede,
  type VerloopMaten,
  type VerloopUitkomst,
} from "../../lib/sectionResolver";
import { aantalVerloopSegmenten } from "../../lib/modelNaarSolverInput";
import { rechthoekTorsieconstante } from "../../lib/betonDoorsnedeGrootheden";
import { gelasteIEigenschappen, gelasteINaam } from "../../lib/verloopSplitsen";
import { eigenNaamVan } from "../../lib/profieleditor/eigenDoorsnedenStore";
import { profielNaamTekst } from "../../lib/verloopKeuze";
import { nederlands, vertaalWaarde, type Vertaalfunctie } from "../../lib/vertaalbareTekst";

/** Wat een 3D-staaf voor het verloop draagt; de rest van de staaf doet er niet toe. */
export interface OpenFem3DVerloopStaaf {
  material?: string;
  profileName?: string;
  profileNameEnd?: string;
}

/** De staaf in de vorm van de 2D-bouwstenen (`material`, `profile`, `profileEnd`). */
export function openFem3DBeamAls2D(beam: OpenFem3DVerloopStaaf): { material?: string; profile?: string; profileEnd?: string } {
  return {
    ...(beam.material !== undefined ? { material: beam.material } : {}),
    ...(beam.profileName !== undefined ? { profile: beam.profileName } : {}),
    ...(beam.profileNameEnd !== undefined ? { profileEnd: beam.profileNameEnd } : {}),
  };
}

/** `bepaalVerloop` voor een 3D-staaf: prismatisch, verlopend of fout met reden. */
export function openFem3DBeamVerloop(beam: OpenFem3DVerloopStaaf): VerloopUitkomst {
  return bepaalVerloop(beam.material?.trim(), beam.profileName?.trim(), beam.profileNameEnd?.trim());
}

/** Is deze staaf werkelijk verlopend (een geldig verloop tussen twee verschillende doorsneden)? */
export function isOpenFem3DBeamVerlopend(beam: OpenFem3DVerloopStaaf): boolean {
  return (beam.profileNameEnd?.trim() ?? "") !== "" && openFem3DBeamVerloop(beam).status === "verlopend";
}

/**
 * Torsieconstante I_t van een massieve rechthoek b × h (mm⁴): dezelfde
 * formule voor een prismatische en een verlopende rechthoek en voor de
 * deelrechthoeken van een betonnen T of L (`lib/betonDoorsnedeGrootheden`).
 */
export { rechthoekTorsieconstante };

/** De grootheden van één doorsnede van een verloop, in mm. */
export interface OpenFem3DVerloopDoorsnede {
  /** Naam voor de kern en het rapport: "Gelast I h×b×t_w×t_f" of "b x h". */
  naam: string;
  maten: VerloopMaten;
  areaMm2: number;
  /** Om de sterke as (y, h langs lokaal z). */
  iyMm4: number;
  izMm4: number;
  itMm4: number;
}

/** Een maat als tekst in een rechthoeknaam, met punt (de naam is de sleutel, zie `parseRechthoek`). */
const maat = (v: number) => String(Math.round(v * 1e6) / 1e6);

/** De doorsnede van verloop `v` op relatieve positie t (0 = begin, 1 = eind). */
export function openFem3DVerloopDoorsnede(v: VerlopendeDoorsnede, t: number): OpenFem3DVerloopDoorsnede {
  const m = matenOpPositie(v, t);
  if (v.soort === "gelastI") {
    const e = gelasteIEigenschappen(m);
    return { naam: gelasteINaam(m), maten: m, areaMm2: e.area_mm2, iyMm4: e.iy_mm4, izMm4: e.iz_mm4, itMm4: e.it_mm4 };
  }
  return {
    naam: `${maat(m.b)}x${maat(m.h)}`,
    maten: m,
    areaMm2: m.b * m.h,
    iyMm4: m.b * m.h ** 3 / 12,
    izMm4: m.h * m.b ** 3 / 12,
    itMm4: rechthoekTorsieconstante(m.b, m.h),
  };
}

/** Eén gelijk deel van een verlopende staaf: [tStart, tEnd] met de doorsnede van zijn midden. */
export interface OpenFem3DVerloopDeel {
  tStart: number;
  tEnd: number;
  doorsnede: OpenFem3DVerloopDoorsnede;
}

/** De delen van een verlopende staaf, met het verloop zelf. */
export interface OpenFem3DVerloopIndeling {
  verloop: VerlopendeDoorsnede;
  delen: OpenFem3DVerloopDeel[];
}

/**
 * De indeling van een verlopende staaf van `lengthM` in gelijke delen, elk met
 * de doorsnede van zijn midden; `null` bij een prismatische staaf. Een
 * eindprofiel dat niet bij het begin past, is een fout met de reden van
 * `bepaalVerloop` en geen terugval op een prismatische staaf.
 *
 * De fracties zijn i/n, zoals in 2D: de grenzen van het eigen gewicht per deel
 * vallen bit-gelijk op de deelgrenzen van de kern.
 */
export function openFem3DVerloopDelen(
  beam: OpenFem3DVerloopStaaf & { id?: number },
  lengthM: number,
): OpenFem3DVerloopIndeling | null {
  if ((beam.profileNameEnd?.trim() ?? "") === "") return null;
  const uitkomst = openFem3DBeamVerloop(beam);
  if (uitkomst.status === "prismatisch") return null;
  if (uitkomst.status === "fout") {
    throw new Error(`Staaf ${beam.id ?? "?"}: ${uitkomst.reden}.`);
  }
  return openFem3DVerloopIndelingVan(uitkomst.verloop, lengthM);
}

/** De indeling van verloop `verloop` over een staaf van `lengthM` (zie {@link openFem3DVerloopDelen}). */
export function openFem3DVerloopIndelingVan(verloop: VerlopendeDoorsnede, lengthM: number): OpenFem3DVerloopIndeling {
  const n = aantalVerloopSegmenten(lengthM * 1000);
  const delen: OpenFem3DVerloopDeel[] = [];
  for (let i = 0; i < n; i++) {
    const tStart = i / n;
    const tEnd = (i + 1) / n;
    delen.push({ tStart, tEnd, doorsnede: openFem3DVerloopDoorsnede(verloop, (tStart + tEnd) / 2) });
  }
  return { verloop, delen };
}

/**
 * De naam van een verlopende staaf voor weergave, met pijl: "IPE 400 → IPE 200".
 * Prismatisch: alleen de profielnaam. Een eigen doorsnede staat zonder het
 * voorvoegsel "EIGEN:" en een gelaste tussendoorsnede vertaald ("Gelast I …",
 * "Welded I …"), zoals in de 2D-profielkiezer (#113); zonder vertaalfunctie
 * in het Nederlands.
 */
export function openFem3DProfielTekst(beam: OpenFem3DVerloopStaaf, t?: Vertaalfunctie): string {
  const naam = (profiel: string) => {
    const tekst = profielNaamTekst(eigenNaamVan(profiel) ?? profiel);
    return t ? vertaalWaarde(t, tekst) : nederlands(tekst);
  };
  const begin = beam.profileName?.trim() ?? "";
  const eind = beam.profileNameEnd?.trim() ?? "";
  return eind !== "" && eind !== begin ? `${naam(begin)} → ${naam(eind)}` : naam(begin);
}
