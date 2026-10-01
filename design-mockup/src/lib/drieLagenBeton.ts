/**
 * Afgebakend 3-lagenmodel voor een gewapend betonschaalelement.
 * Blaauwendraad e.a. (2021) / EN 1992-2:2005, informatieve bijlage LL.
 *
 * Dit is een doorsnedecontrole op OPGEGEVEN schaalresultanten. De huidige
 * 2D-wandsolver levert alleen membraanspanningen en kan deze invoer niet zelf
 * samenstellen. De kerncontrole vereist opgegeven normwaarden; scheurtoestand,
 * iteratie van laagdikten en Nederlandse NB worden niet automatisch beoordeeld.
 * Een uitkomst is nooit een volledige schaalgoedkeuring.
 */
import { valideerSchaalResultaat3D, type SchaalResultaat3D } from "./toetsResultaat3d";

export interface SchaalKrachten {
  /** Membraankrachten, trek positief, kN/m. */
  nx: number;
  ny: number;
  nxy: number;
  /** Momenten, kNm/m; positief volgens dezelfde lokale schaalassen. */
  mx: number;
  my: number;
  mxy: number;
  /** Dwarskrachten, kN/m. */
  vx: number;
  vy: number;
}

export interface BuitenlaagWapening {
  /** Aanwezige wapening per meter in lokale x- en y-richting, mm²/m. */
  asX: number;
  asY: number;
}

export interface DrieLagenInvoer {
  krachten: SchaalKrachten;
  dikteMm: number;
  dikteBovenMm: number;
  dikteOnderMm: number;
  wapeningBoven: BuitenlaagWapening;
  wapeningOnder: BuitenlaagWapening;
  /** Ontwerpwaarden expliciet uit de toepasselijke norm en NB, N/mm². */
  fcdMpa: number;
  fydMpa: number;
  /** Reductie ν′ voor een gescheurde drukdiagonaal, expliciet opgegeven. */
  nuAccent: number;
  /** Volle f_cd voor buitenlagen volgens Blaauwendraad 2021, of EC2-reductie. */
  drukmodel: "blaauwendraad-2021" | "ec2-bijlage-f";
  /** Afzonderlijk bepaalde EN 1992-kernwaarden; zonder deze blijft de kern ongekeurd. */
  kernControle?: {
    vRdcKNPerM: number;
    /** tan θ volgens het gekozen vakwerkmodel, 0,4..1,0. */
    tanTheta: number;
    aanwezigeDwarskrachtWapeningMm2PerM2: number;
    grensDiagonaalMpa: number;
  };
}

export interface LaagKrachten { nx: number; ny: number; nxy: number }
export interface LaagControle {
  krachten: LaagKrachten;
  benodigdAsX: number;
  benodigdAsY: number;
  sigmaBetondrukMpa: number;
  grensBetondrukMpa: number;
  ucAsX: number;
  ucAsY: number;
  ucBetondruk: number;
  tak: "F.1(3)" | "F.2-F.4" | "F.5-F.7";
}
export interface DrieLagenUitkomst {
  /** Afstand tussen de zwaartepunten van de buitenlagen, mm. */
  hefboomMm: number;
  boven: LaagControle;
  onder: LaagControle;
  kern: {
    vx: number; vy: number; hoofdDwarskracht: number; hoekGraden: number;
    dwarskrachtWapeningNodig: boolean | null;
    benodigdAsvMm2PerM2: number | null;
    sigmaDiagonaalMpa: number | null;
    ucDwarskrachtWapening: number | null;
    ucDiagonaal: number | null;
  };
  status: "deelcontrole_voldoet" | "deelcontrole_overschreden";
  nietBeoordeeld: string[];
}

function eindig(v: number): boolean { return Number.isFinite(v); }
function positief(v: number): boolean { return eindig(v) && v > 0; }

/** Evenwicht n_b+n_o=n en n_o·y_o−n_b·y_b=m, per component. */
export function verdeelSchaalkrachten(
  k: SchaalKrachten, dikteMm: number, bovenMm: number, onderMm: number,
): { hefboomMm: number; boven: LaagKrachten; onder: LaagKrachten } {
  if (!Object.values(k).every(eindig) ||
      ![dikteMm, bovenMm, onderMm].every(positief) ||
      bovenMm + onderMm >= dikteMm) {
    throw new Error("Ongeldige schaalkrachten of laagdikten voor het 3-lagenmodel.");
  }
  const armBovenMm = (dikteMm - bovenMm) / 2;
  const armOnderMm = (dikteMm - onderMm) / 2;
  const hefboomMm = armBovenMm + armOnderMm;
  // kNm/m / (mm/1000) = kN/m.
  const splits = (n: number, m: number) => ({
    boven: (n * armOnderMm - m * 1000) / hefboomMm,
    onder: (n * armBovenMm + m * 1000) / hefboomMm,
  });
  const x = splits(k.nx, k.mx), y = splits(k.ny, k.my), xy = splits(k.nxy, k.mxy);
  return {
    hefboomMm,
    boven: { nx: x.boven, ny: y.boven, nxy: xy.boven },
    onder: { nx: x.onder, ny: y.onder, nxy: xy.onder },
  };
}

/** Bijlage F met trek positief; dezelfde drie takken als de bestaande plaatkern. */
function controleerLaag(
  n: LaagKrachten, dikteMm: number, as: BuitenlaagWapening,
  fcd: number, fyd: number, nuAccent: number, drukmodel: DrieLagenInvoer["drukmodel"],
): LaagControle {
  const sx = n.nx / dikteMm, sy = n.ny / dikteMm;
  const cx = -sx, cy = -sy, tau = Math.abs(n.nxy) / dikteMm;
  const xIsY = cy > cx;
  const groot = Math.max(cx, cy), klein = Math.min(cx, cy);
  let ftx = 0, fty = 0, sigma = 0;
  let tak: LaagControle["tak"];
  if (groot > 0 && klein > 0 && groot * klein > tau * tau) {
    sigma = (groot + klein) / 2 + Math.hypot((groot - klein) / 2, tau);
    tak = "F.1(3)";
  } else if (groot <= tau) {
    ftx = tau - groot;
    fty = tau - klein;
    sigma = 2 * tau;
    tak = "F.2-F.4";
  } else {
    ftx = 0;
    fty = tau * tau / groot - klein;
    sigma = groot * (1 + (tau / groot) ** 2);
    tak = "F.5-F.7";
  }
  const benodigdAsX = Math.max(0, xIsY ? fty : ftx) * dikteMm * 1000 / fyd;
  const benodigdAsY = Math.max(0, xIsY ? ftx : fty) * dikteMm * 1000 / fyd;
  const gescheurd = benodigdAsX > 1e-6 || benodigdAsY > 1e-6;
  const grensBetondrukMpa = drukmodel === "blaauwendraad-2021"
    ? fcd : gescheurd ? 0.6 * nuAccent * fcd : fcd;
  return {
    krachten: n, benodigdAsX, benodigdAsY,
    sigmaBetondrukMpa: sigma, grensBetondrukMpa,
    // JSON kan Infinity niet opslaan; MAX_VALUE markeert ontbrekende
    // weerstand zonder de overschrijding als een kleine UC te presenteren.
    ucAsX: benodigdAsX === 0 ? 0 : as.asX === 0 ? Number.MAX_VALUE : Math.min(Number.MAX_VALUE, benodigdAsX / as.asX),
    ucAsY: benodigdAsY === 0 ? 0 : as.asY === 0 ? Number.MAX_VALUE : Math.min(Number.MAX_VALUE, benodigdAsY / as.asY),
    ucBetondruk: sigma / grensBetondrukMpa,
    tak,
  };
}

export function toetsDrieLagenBuitenlagen(i: DrieLagenInvoer): DrieLagenUitkomst {
  if (!["blaauwendraad-2021", "ec2-bijlage-f"].includes(i.drukmodel) ||
      ![i.fcdMpa, i.fydMpa, i.nuAccent].every(positief) || i.nuAccent > 1 ||
      ![i.wapeningBoven.asX, i.wapeningBoven.asY,
        i.wapeningOnder.asX, i.wapeningOnder.asY].every((v) => eindig(v) && v >= 0)) {
    throw new Error("Geef geldige materiaalwaarden en aanwezige wapening voor beide buitenlagen op.");
  }
  const verdeling = verdeelSchaalkrachten(
    i.krachten, i.dikteMm, i.dikteBovenMm, i.dikteOnderMm);
  const hoofdDwarskracht = Math.hypot(i.krachten.vx, i.krachten.vy);
  const kc = i.kernControle;
  if (kc && (!positief(kc.vRdcKNPerM) || !positief(kc.grensDiagonaalMpa) ||
      !eindig(kc.tanTheta) || kc.tanTheta < 0.4 || kc.tanTheta > 1 ||
      !eindig(kc.aanwezigeDwarskrachtWapeningMm2PerM2) ||
      kc.aanwezigeDwarskrachtWapeningMm2PerM2 < 0)) {
    throw new Error("Ongeldige kernwaarden; geef de dwarskrachtgrens, hoek en aanwezige beugels expliciet op.");
  }
  const nodig = kc ? hoofdDwarskracht > kc.vRdcKNPerM : null;
  const asv = nodig && kc
    ? hoofdDwarskracht / verdeling.hefboomMm * kc.tanTheta * 1e6 / i.fydMpa : null;
  const sigmaDiagonaal = nodig && kc
    ? hoofdDwarskracht / verdeling.hefboomMm * (kc.tanTheta + 1 / kc.tanTheta) : null;
  // Blaauwendraad (2021), (22): horizontale kerncompressie levert aan BEIDE
  // schillen een extra trekresultante in de richting van de hoofd-dwarskracht.
  const extra = nodig && kc && hoofdDwarskracht > 0
    ? {
        nx: 0.5 * i.krachten.vx ** 2 / (hoofdDwarskracht * kc.tanTheta),
        ny: 0.5 * i.krachten.vy ** 2 / (hoofdDwarskracht * kc.tanTheta),
        nxy: 0.5 * i.krachten.vx * i.krachten.vy / (hoofdDwarskracht * kc.tanTheta),
      }
    : { nx: 0, ny: 0, nxy: 0 };
  const metExtra = (n: LaagKrachten): LaagKrachten => ({
    nx: n.nx + extra.nx, ny: n.ny + extra.ny, nxy: n.nxy + extra.nxy,
  });
  const boven = controleerLaag(metExtra(verdeling.boven), i.dikteBovenMm,
    i.wapeningBoven, i.fcdMpa, i.fydMpa, i.nuAccent, i.drukmodel);
  const onder = controleerLaag(metExtra(verdeling.onder), i.dikteOnderMm,
    i.wapeningOnder, i.fcdMpa, i.fydMpa, i.nuAccent, i.drukmodel);
  if (![verdeling.hefboomMm, hoofdDwarskracht,
    boven.benodigdAsX, boven.benodigdAsY, boven.sigmaBetondrukMpa, boven.ucBetondruk,
    onder.benodigdAsX, onder.benodigdAsY, onder.sigmaBetondrukMpa, onder.ucBetondruk,
    ...(asv === null ? [] : [asv]), ...(sigmaDiagonaal === null ? [] : [sigmaDiagonaal])]
    .every(Number.isFinite)) {
    throw new Error("De 3-lagencontrole valt buiten het eindige rekenbereik.");
  }
  const ucAsv = asv === null ? null :
    kc!.aanwezigeDwarskrachtWapeningMm2PerM2 === 0
      ? Number.MAX_VALUE : Math.min(Number.MAX_VALUE,
        asv / kc!.aanwezigeDwarskrachtWapeningMm2PerM2);
  const ucDiagonaal = sigmaDiagonaal === null ? null :
    Math.min(Number.MAX_VALUE, sigmaDiagonaal / kc!.grensDiagonaalMpa);
  const uc = [boven.ucAsX, boven.ucAsY, boven.ucBetondruk,
    onder.ucAsX, onder.ucAsY, onder.ucBetondruk,
    ...(ucAsv === null ? [] : [ucAsv]),
    ...(ucDiagonaal === null ? [] : [ucDiagonaal])];
  return {
    hefboomMm: verdeling.hefboomMm,
    boven, onder,
    kern: { vx: i.krachten.vx, vy: i.krachten.vy, hoofdDwarskracht,
      hoekGraden: Math.atan2(i.krachten.vy, i.krachten.vx) * 180 / Math.PI,
      dwarskrachtWapeningNodig: nodig,
      benodigdAsvMm2PerM2: asv,
      sigmaDiagonaalMpa: sigmaDiagonaal,
      ucDwarskrachtWapening: ucAsv,
      ucDiagonaal },
    status: uc.some((v) => v > 1) ? "deelcontrole_overschreden" : "deelcontrole_voldoet",
    nietBeoordeeld: ["Scheurtoestand van de schaal",
      ...(kc ? [] : ["Kernlaag en dwarskrachtweerstand"]),
      "Automatische iteratie en excentriciteit van de wapening",
      "Wapeningsverankering en detaillering",
      "Nederlandse Nationale Bijlage en projecttoepasselijkheid"],
  };
}

/** Toets alleen met alle acht lokaal georiënteerde, geverifieerde 3D-resultanten. */
export function toetsDrieLagenUit3D(
  resultaat: SchaalResultaat3D,
  invoer: Omit<DrieLagenInvoer, "krachten">,
): DrieLagenUitkomst {
  valideerSchaalResultaat3D(resultaat);
  return toetsDrieLagenBuitenlagen({ ...invoer, krachten: resultaat.krachten });
}
