/**
 * openFem3dViewCubeDom.ts — de view cube als DOM: een gebouwtje van CSS
 * 3D-transformaties rechtsboven in het 3D-tekenvlak (geen tweede
 * WebGL-context). De wiskunde staat in openFem3dViewCube.ts; dit bestand
 * bouwt de elementen, volgt de camera met één transform per frame en
 * vertaalt klikken, slepen en toetsen naar de acties van het tekenvlak.
 *
 * Opbouw:
 *   div.open-fem3d-view-cube              vaste plek; zelf geen pointer-events
 *     div.open-fem3d-view-cube-kubus      role=toolbar; vangt klikken en slepen
 *       div.open-fem3d-view-cube-scene    transform = de inverse camerarotatie
 *         div.open-fem3d-view-cube-maaiveld   gearceerde rand om de voet (decoratief)
 *         div.open-fem3d-view-cube-vlak × 6   dak, vier gevels, vloer (naam + 3 × 3 cellen)
 *     div.open-fem3d-view-cube-keuze      rechtsonder vast aan de kubus
 *       button.open-fem3d-view-cube-menuknop   ▾, aria-haspopup=menu
 *       div.open-fem3d-view-cube-menu          role=menu, een lijst items
 *
 * Elk van de 26 doelen (vlak, ribbe, hoek) heeft één bedienbare cel
 * (role=button, aria-label, roving tabindex); de andere cellen van dezelfde
 * ribbe of hoek zijn dezelfde knop op een ander vlak en markeren mee. De
 * bedienbare cel ligt altijd op een vlak dat naar de kijker wijst (als het
 * doel zichtbaar is): draait de camera, dan schuift de knop naar zo'n vlak.
 * Pijltjestoetsen gaan alleen naar doelen die naar de kijker gericht zijn.
 */
import {
  OPEN_FEM_3D_VIEW_CUBE_DOELEN,
  OPEN_FEM_3D_VIEW_CUBE_VLAKKEN,
  openFem3DViewCubeCellen,
  openFem3DViewCubeCss,
  openFem3DViewCubeDoel,
  openFem3DViewCubeMaaiveldMatrix,
  openFem3DViewCubeNaamTransform,
  openFem3DViewCubeNaarKijker,
  openFem3DViewCubeVlakMatrix,
  OPEN_FEM_3D_VIEW_CUBE_ZICHTBAAR_VANAF,
  type OpenFem3DViewCubeDoel,
  type OpenFem3DViewCubeVlak,
} from "./openFem3dViewCube";

/** Ribbe van de kubus in CSS-pixels; de kubus past zo in elke stand binnen ~94 px. */
export const OPEN_FEM_3D_VIEW_CUBE_RIBBE_PX = 54;
/** Zoveel pixels bewegen voordat een indruk slepen wordt in plaats van een klik. */
const SLEEP_DREMPEL_PX = 3;

export interface OpenFem3DViewCubeTeksten {
  /** Naam van de kubus (toolbar) met een korte uitleg. */
  kubus: string;
  /** Naam op het vlak: Dak, Vloer, Voor, Achter, Links, Rechts. */
  vlak: Readonly<Record<OpenFem3DViewCubeVlak, string>>;
  /** Aria-label van een vlak: het aanzicht, bijv. "Bovenaanzicht (dak)". */
  aanzicht: Readonly<Record<OpenFem3DViewCubeVlak, string>>;
  /** "Ribbe Voor, Dak" uit de namen van de twee vlakken. */
  ribbe: (namen: string) => string;
  /** "Hoek Voor, Rechts, Dak" uit de namen van de drie vlakken. */
  hoek: (namen: string) => string;
  /** Label van de knop ▾ en van zijn menu. */
  menu: string;
}

/**
 * Eén regel in het menu van de knop ▾. Een schakelaar (zoals Perspectief of
 * Section box) is een `menuitemcheckbox` met `aan`. Een regel die nu niets
 * kan doen (Section box passend op selectie zonder selectie) staat erin met
 * `uitgeschakeld` (aria-disabled): bereikbaar met het toetsenbord, maar
 * kiezen doet niets en laat het menu open. `scheiding` zet een lijn boven de
 * regel (het begin van een nieuwe groep), zonder eigen element.
 */
export interface OpenFem3DViewCubeMenuItem {
  id: string;
  tekst: string;
  rol?: "menuitem" | "menuitemcheckbox";
  aan?: boolean;
  uitgeschakeld?: boolean;
  scheiding?: boolean;
  kies: () => void;
}

export interface OpenFem3DViewCubeActies {
  /** Klik (of Enter/spatie) op een vlak, ribbe of hoek. */
  kies: (doel: OpenFem3DViewCubeDoel) => void;
  sleepStart: () => void;
  /** Verplaatsing in pixels sinds de vorige sleepstap. */
  sleep: (dxPx: number, dyPx: number) => void;
  sleepEinde: () => void;
  /** Het menu ▾ ging open of dicht: het tekenvlak deelt zijn labels opnieuw in (het menu is gereserveerd gebied). */
  menuWissel?: (open: boolean) => void;
}

export interface OpenFem3DViewCubeDom {
  readonly element: HTMLDivElement;
  /** Zet de kubusmatrix (kolomvolgorde); alleen een transform, en alleen als hij verandert. */
  volg: (matrix: readonly number[]) => void;
  zetTeksten: (teksten: OpenFem3DViewCubeTeksten) => void;
  /** De regels van het menu ▾, in volgorde. */
  zetMenu: (items: readonly OpenFem3DViewCubeMenuItem[]) => void;
  /** Kubus en menuknop tonen of verbergen (zichtbaarheid `viewCube`). */
  toon: (zichtbaar: boolean) => void;
  verwijder: () => void;
}

let volgnummer = 0;

export function createOpenFem3DViewCube(
  ouder: HTMLElement, teksten: OpenFem3DViewCubeTeksten, acties: OpenFem3DViewCubeActies,
  menuItems: readonly OpenFem3DViewCubeMenuItem[] = [],
): OpenFem3DViewCubeDom {
  const nummer = ++volgnummer;
  const element = document.createElement("div");
  element.className = "open-fem3d-view-cube";
  element.dataset.openFem3dViewCube = "";

  const kubus = document.createElement("div");
  kubus.className = "open-fem3d-view-cube-kubus";
  kubus.setAttribute("role", "toolbar");
  element.appendChild(kubus);

  const scene = document.createElement("div");
  scene.className = "open-fem3d-view-cube-scene";
  kubus.appendChild(scene);

  const half = OPEN_FEM_3D_VIEW_CUBE_RIBBE_PX / 2;
  // Het maaiveld eerst: bij gelijke diepte tekent de browser in DOM-volgorde.
  const maaiveld = document.createElement("div");
  maaiveld.className = "open-fem3d-view-cube-maaiveld";
  maaiveld.setAttribute("aria-hidden", "true");
  maaiveld.style.transform = openFem3DViewCubeCss(openFem3DViewCubeMaaiveldMatrix(half));
  scene.appendChild(maaiveld);

  const cellenPerDoel = new Map<string, HTMLElement[]>();
  const knopPerDoel = new Map<string, HTMLElement>();
  const labelPerDoel = new Map<string, string>();
  const naamPerVlak = new Map<OpenFem3DViewCubeVlak, HTMLElement>();
  const vlakVanCel = new Map<HTMLElement, OpenFem3DViewCubeVlak>();
  const vlakElementen = new Map<OpenFem3DViewCubeVlak, HTMLElement>();
  for (const vlak of OPEN_FEM_3D_VIEW_CUBE_VLAKKEN) {
    const vlakElement = document.createElement("div");
    vlakElement.className = "open-fem3d-view-cube-vlak";
    vlakElement.dataset.vlak = vlak;
    vlakElement.style.transform = openFem3DViewCubeCss(openFem3DViewCubeVlakMatrix(vlak, half));
    vlakElementen.set(vlak, vlakElement);
    const naam = document.createElement("span");
    naam.className = "open-fem3d-view-cube-naam";
    naam.setAttribute("aria-hidden", "true");
    const naamTransform = openFem3DViewCubeNaamTransform(vlak);
    if (naamTransform) naam.style.transform = naamTransform;
    vlakElement.appendChild(naam);
    naamPerVlak.set(vlak, naam);
    if (vlak === "voor") {
      // Een deuromtrek onderaan de voorgevel: zo is "voor" ook zonder tekst herkenbaar.
      const deur = document.createElement("span");
      deur.className = "open-fem3d-view-cube-deur";
      deur.setAttribute("aria-hidden", "true");
      vlakElement.appendChild(deur);
    }
    for (const { rij, kolom, doel } of openFem3DViewCubeCellen(vlak)) {
      const cel = document.createElement("div");
      cel.className = "open-fem3d-view-cube-cel";
      cel.dataset.openFem3dViewCubeDoel = doel.id;
      cel.dataset.soort = doel.soort;
      cel.style.gridRow = String(rij + 1);
      cel.style.gridColumn = String(kolom + 1);
      vlakVanCel.set(cel, vlak);
      const cellen = cellenPerDoel.get(doel.id) ?? [];
      cellen.push(cel);
      cellenPerDoel.set(doel.id, cellen);
      cel.setAttribute("aria-hidden", "true");
      vlakElement.appendChild(cel);
    }
    scene.appendChild(vlakElement);
  }

  /**
   * Maak `cel` de bedienbare knop van zijn doel: role, label en tabindex
   * verhuizen mee; de vorige cel is weer een stille kopie.
   */
  const zetKnop = (id: string, cel: HTMLElement) => {
    const oud = knopPerDoel.get(id);
    if (oud === cel) return;
    const tabIndex = oud ? oud.tabIndex : -1;
    if (oud) {
      oud.removeAttribute("role");
      oud.removeAttribute("aria-label");
      oud.removeAttribute("tabindex");
      delete oud.dataset.openFem3dViewCubeKnop;
      oud.setAttribute("aria-hidden", "true");
    }
    cel.removeAttribute("aria-hidden");
    cel.setAttribute("role", "button");
    cel.tabIndex = tabIndex;
    cel.dataset.openFem3dViewCubeKnop = "";
    const label = labelPerDoel.get(id);
    if (label) cel.setAttribute("aria-label", label);
    knopPerDoel.set(id, cel);
  };
  for (const [id, cellen] of cellenPerDoel) zetKnop(id, cellen[0]);

  // Volgorde voor de pijltjestoetsen: dezelfde als de doelenlijst.
  const volgorde = OPEN_FEM_3D_VIEW_CUBE_DOELEN.map((doel) => doel.id);
  let actief = volgorde[0];
  knopPerDoel.get(actief)!.tabIndex = 0;

  // Per vlak hoe ver het naar de kijker wijst (bijgewerkt in volg).
  const naarKijker = new Map<OpenFem3DViewCubeVlak, number>(OPEN_FEM_3D_VIEW_CUBE_VLAKKEN.map((vlak) => [vlak, 0]));
  const vlakZichtbaar = (vlak: OpenFem3DViewCubeVlak) => (naarKijker.get(vlak) ?? 0) >= OPEN_FEM_3D_VIEW_CUBE_ZICHTBAAR_VANAF;
  /** De cel van een doel op zijn meest naar de kijker gerichte vlak, of null. */
  const zichtbareCel = (id: string): HTMLElement | null => {
    let beste: HTMLElement | null = null;
    let besteZ = OPEN_FEM_3D_VIEW_CUBE_ZICHTBAAR_VANAF;
    for (const cel of cellenPerDoel.get(id) ?? []) {
      const z = naarKijker.get(vlakVanCel.get(cel)!) ?? 0;
      if (z >= besteZ) { beste = cel; besteZ = z; }
    }
    return beste;
  };
  const doelZichtbaar = (id: string) => zichtbareCel(id) !== null;

  const markeer = (id: string | undefined, klasse: string, aan: boolean) => {
    if (!id) return;
    cellenPerDoel.get(id)?.forEach((cel) => cel.classList.toggle(klasse, aan));
  };
  const doelVan = (target: EventTarget | null) => {
    const cel = target instanceof Element ? target.closest<HTMLElement>(".open-fem3d-view-cube-cel") : null;
    return cel?.dataset.openFem3dViewCubeDoel;
  };
  const focusInKubus = () => {
    const actiefElement = document.activeElement;
    return actiefElement instanceof HTMLElement && kubus.contains(actiefElement) ? actiefElement : null;
  };
  /** Zet de tabstop (en zo nodig de focus) op het doel `id`, op een zichtbare cel. */
  const activeer = (id: string, focus: boolean) => {
    const cel = zichtbareCel(id);
    if (cel) zetKnop(id, cel);
    actief = id;
    knopPerDoel.forEach((knop, doelId) => { knop.tabIndex = doelId === id ? 0 : -1; });
    if (focus) knopPerDoel.get(id)?.focus({ preventScroll: true });
  };

  /**
   * Na een camerawissel: knoppen van zichtbare doelen op een zichtbaar vlak,
   * en de tabstop (met de focus) nooit op de achterkant.
   */
  const houdKnoppenZichtbaar = () => {
    for (const id of volgorde) {
      const knop = knopPerDoel.get(id)!;
      if (vlakZichtbaar(vlakVanCel.get(knop)!)) continue;
      const cel = zichtbareCel(id);
      if (!cel) continue;
      const hadFocus = document.activeElement === knop;
      zetKnop(id, cel);
      if (hadFocus) cel.focus({ preventScroll: true });
    }
    if (doelZichtbaar(actief)) return;
    // Het actieve doel draaide weg: het zichtbare doel met de meest
    // gelijke richting neemt de tabstop (en de focus) over.
    const oud = openFem3DViewCubeDoel(actief)!;
    let beste: string | null = null;
    let besteCos = -Infinity;
    for (const doel of OPEN_FEM_3D_VIEW_CUBE_DOELEN) {
      if (!doelZichtbaar(doel.id)) continue;
      const cos = doel.richting[0] * oud.richting[0] + doel.richting[1] * oud.richting[1] + doel.richting[2] * oud.richting[2];
      if (cos > besteCos) { besteCos = cos; beste = doel.id; }
    }
    if (beste) activeer(beste, focusInKubus() !== null);
  };

  // ── Menu (knop ▾) ───────────────────────────────────────────────────────
  const keuze = document.createElement("div");
  keuze.className = "open-fem3d-view-cube-keuze";
  element.appendChild(keuze);
  const menuKnop = document.createElement("button");
  menuKnop.type = "button";
  menuKnop.className = "open-fem3d-view-cube-menuknop";
  menuKnop.dataset.openFem3dViewCubeMenuknop = "";
  menuKnop.setAttribute("aria-haspopup", "menu");
  menuKnop.setAttribute("aria-expanded", "false");
  const pijl = document.createElement("span");
  pijl.setAttribute("aria-hidden", "true");
  pijl.textContent = "▾";
  menuKnop.appendChild(pijl);
  keuze.appendChild(menuKnop);
  const menu = document.createElement("div");
  menu.className = "open-fem3d-view-cube-menu";
  menu.id = `open-fem3d-view-cube-menu-${nummer}`;
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menuKnop.id = `open-fem3d-view-cube-menuknop-${nummer}`;
  menuKnop.setAttribute("aria-controls", menu.id);
  menu.setAttribute("aria-labelledby", menuKnop.id);
  keuze.appendChild(menu);

  let items: readonly OpenFem3DViewCubeMenuItem[] = [];
  const itemElementen: HTMLElement[] = [];
  /** De regels bijwerken op hun plek: een open menu houdt zo zijn focus (bijv. bij een taalwissel). */
  const zetMenu = (nieuw: readonly OpenFem3DViewCubeMenuItem[]) => {
    items = nieuw;
    while (itemElementen.length > nieuw.length) itemElementen.pop()!.remove();
    nieuw.forEach((item, index) => {
      let el = itemElementen[index];
      if (!el) {
        el = document.createElement("div");
        el.className = "open-fem3d-view-cube-menuitem";
        el.tabIndex = -1;
        menu.appendChild(el);
        itemElementen.push(el);
      }
      el.setAttribute("role", item.rol ?? "menuitem");
      if (item.rol === "menuitemcheckbox") el.setAttribute("aria-checked", item.aan ? "true" : "false");
      else el.removeAttribute("aria-checked");
      if (item.uitgeschakeld) el.setAttribute("aria-disabled", "true");
      else el.removeAttribute("aria-disabled");
      el.classList.toggle("is-scheiding", item.scheiding === true);
      el.dataset.openFem3dViewCubeMenuitem = item.id;
      el.textContent = item.tekst;
    });
  };
  zetMenu(menuItems);

  const menuOpen = () => !menu.hidden;
  /**
   * Onder de knop als er ruimte is in het tekenvlak, anders erboven. Past het
   * menu ook daar niet (een laag tekenvlak; sinds de section box, issue #86,
   * heeft het zes regels), dan aan de kant met de meeste ruimte, zo hoog als
   * er ruimte is en met een schuifbalk: het blijft binnen het tekenvlak.
   */
  const plaatsMenu = () => {
    delete keuze.dataset.omhoog;
    menu.style.maxHeight = "";
    const vak = ouder.getBoundingClientRect();
    const r = menu.getBoundingClientRect();
    if (!(r.height > 0) || r.bottom <= vak.bottom - 4) return;
    const k = keuze.getBoundingClientRect();
    const onder = vak.bottom - 4 - (k.bottom + 4);
    const boven = k.top - 4 - (vak.top + 4);
    const omhoog = boven >= r.height || boven > onder;
    if (omhoog) keuze.dataset.omhoog = "";
    const ruimte = omhoog ? boven : onder;
    if (r.height <= ruimte) return;
    // max-height geldt voor de inhoud: binnenrand en rand komen erbij.
    const stijl = getComputedStyle(menu);
    const extra = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"]
      .reduce((som, naam) => som + (parseFloat(stijl[naam as "paddingTop"]) || 0), 0);
    menu.style.maxHeight = `${Math.max(40, Math.floor(ruimte - extra))}px`;
  };
  /** In een menu met schuifbalk: de regel met de focus in beeld (zonder de pagina te schuiven). */
  const houdInBeeld = (el: HTMLElement | undefined) => {
    if (!el || menu.scrollHeight <= menu.clientHeight) return;
    if (el.offsetTop < menu.scrollTop) menu.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = el.offsetTop + el.offsetHeight - menu.clientHeight;
    }
  };
  const onBuitenDruk = (event: PointerEvent) => {
    if (event.target instanceof Node && keuze.contains(event.target)) return;
    sluitMenu(false);
  };
  const openMenu = (focusIndex: number) => {
    if (!menuOpen()) {
      menu.hidden = false;
      menuKnop.setAttribute("aria-expanded", "true");
      element.dataset.menuOpen = "";
      plaatsMenu();
      document.addEventListener("pointerdown", onBuitenDruk, true);
      acties.menuWissel?.(true);
    }
    const index = (focusIndex + itemElementen.length) % Math.max(1, itemElementen.length);
    itemElementen[index]?.focus({ preventScroll: true });
    houdInBeeld(itemElementen[index]);
  };
  function sluitMenu(focusKnop: boolean, melden = true) {
    if (!menuOpen()) return;
    menu.hidden = true;
    menuKnop.setAttribute("aria-expanded", "false");
    delete element.dataset.menuOpen;
    delete keuze.dataset.omhoog;
    menu.style.maxHeight = "";
    document.removeEventListener("pointerdown", onBuitenDruk, true);
    if (focusKnop) menuKnop.focus({ preventScroll: true });
    if (melden) acties.menuWissel?.(false);
  }
  const kiesItem = (index: number) => {
    const item = items[index];
    // Uitgeschakeld: niets te doen, het menu blijft open.
    if (!item || item.uitgeschakeld) return;
    // Een keuze sluit het menu; de focus gaat terug naar de knop.
    sluitMenu(true);
    item.kies();
  };
  const onMenuKnopKlik = (event: MouseEvent) => {
    event.preventDefault();
    if (menuOpen()) sluitMenu(true);
    else openMenu(0);
  };
  const onMenuKnopToets = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    let index: number | null = null;
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") index = 0;
    else if (event.key === "ArrowUp") index = itemElementen.length - 1;
    else if (event.key === "Escape" && menuOpen()) { sluitMenu(true); }
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (index !== null) openMenu(index);
  };
  const onMenuToets = (event: KeyboardEvent) => {
    const index = itemElementen.findIndex((el) => el === document.activeElement);
    if (event.key === "Tab") { sluitMenu(false); return; }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "ArrowDown") openMenu(index + 1);
    else if (event.key === "ArrowUp") openMenu(index - 1);
    else if (event.key === "Home") openMenu(0);
    else if (event.key === "End") openMenu(itemElementen.length - 1);
    else if (event.key === "Escape") sluitMenu(true);
    else if (event.key === "Enter" || event.key === " ") kiesItem(index);
    else if (event.key.length === 1) {
      // Typ-vooruit: naar de volgende regel die met deze letter begint.
      const letter = event.key.toLocaleLowerCase();
      for (let stap = 1; stap <= itemElementen.length; stap += 1) {
        const volgende = (index + stap) % itemElementen.length;
        if ((itemElementen[volgende].textContent ?? "").trim().toLocaleLowerCase().startsWith(letter)) {
          openMenu(volgende);
          break;
        }
      }
    } else if (event.key !== "Delete" && event.key !== "Backspace") {
      // Overige toetsen (F-toetsen, Insert, …): de browser mag ze afhandelen,
      // de editor krijgt ze niet.
      event.stopPropagation();
      return;
    }
    // Een open menu houdt zijn toetsen: Delete, Backspace of een letter komt
    // niet bij de sneltoetsen van de editor aan (selectie verwijderen,
    // gereedschap kiezen).
    event.preventDefault();
    event.stopPropagation();
  };
  const onMenuKlik = (event: MouseEvent) => {
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>(".open-fem3d-view-cube-menuitem") : null;
    if (!el) return;
    event.preventDefault();
    kiesItem(itemElementen.indexOf(el));
  };
  const onMenuWijzer = (event: PointerEvent) => {
    // Onder de muis krijgt een regel de focus, zoals in een keuzelijst.
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>(".open-fem3d-view-cube-menuitem") : null;
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  };
  const onKeuzeFocusUit = (event: FocusEvent) => {
    // Tab of een klik elders: de focus verlaat knop en menu → menu dicht.
    if (event.relatedTarget instanceof Node && keuze.contains(event.relatedTarget)) return;
    sluitMenu(false);
  };

  const zetTeksten = (nieuw: OpenFem3DViewCubeTeksten) => {
    kubus.setAttribute("aria-label", nieuw.kubus);
    kubus.title = nieuw.kubus;
    menuKnop.setAttribute("aria-label", nieuw.menu);
    menuKnop.title = nieuw.menu;
    naamPerVlak.forEach((naam, vlak) => { naam.textContent = nieuw.vlak[vlak]; });
    for (const doel of OPEN_FEM_3D_VIEW_CUBE_DOELEN) {
      const namen = doel.vlakken.map((vlak) => nieuw.vlak[vlak]).join(", ");
      const label = doel.soort === "vlak" ? nieuw.aanzicht[doel.vlakken[0]]
        : doel.soort === "ribbe" ? nieuw.ribbe(namen) : nieuw.hoek(namen);
      labelPerDoel.set(doel.id, label);
      knopPerDoel.get(doel.id)?.setAttribute("aria-label", label);
    }
  };
  zetTeksten(teksten);

  // ── Klikken en slepen ───────────────────────────────────────────────────
  // Tijdens een indruk luistert de kubus op het hele venster (in de
  // vangfase): de kubus draait onder de muis weg en de muis kan de kubus
  // verlaten. Met pointer capture komen de events ook zo binnen; zonder
  // (geen actieve aanwijzer, of de vangst ging verloren) evengoed. Het
  // tekenvlak krijgt ze tijdens het slepen niet.
  let druk: {
    pointerId: number; knop: number; doel?: string; vanger: Element;
    startX: number; startY: number; x: number; y: number; sleept: boolean;
  } | null = null;
  const onPointerMove = (event: PointerEvent) => {
    if (!druk || event.pointerId !== druk.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!druk.sleept) {
      if (Math.hypot(event.clientX - druk.startX, event.clientY - druk.startY) < SLEEP_DREMPEL_PX) return;
      druk.sleept = true;
      element.dataset.sleept = "true";
      acties.sleepStart();
    }
    const dx = event.clientX - druk.x, dy = event.clientY - druk.y;
    druk.x = event.clientX;
    druk.y = event.clientY;
    if (dx !== 0 || dy !== 0) acties.sleep(dx, dy);
  };
  const stopVenster = () => {
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
  };
  const beeindig = (event: PointerEvent, geannuleerd: boolean) => {
    if (!druk || event.pointerId !== druk.pointerId) return;
    if (event.type !== "lostpointercapture") {
      event.preventDefault();
      event.stopPropagation();
    }
    const klaar = druk;
    druk = null;
    stopVenster();
    try {
      if (klaar.vanger.hasPointerCapture(event.pointerId)) klaar.vanger.releasePointerCapture(event.pointerId);
    } catch { /* geen actieve aanwijzer (synthetisch) */ }
    if (klaar.sleept) {
      delete element.dataset.sleept;
      acties.sleepEinde();
      return;
    }
    if (geannuleerd || klaar.knop !== 0 || !klaar.doel) return;
    const doel = openFem3DViewCubeDoel(klaar.doel);
    if (!doel) return;
    acties.kies(doel);
    // De tabstop (en een focus die al in de kubus stond) volgt de klik: Enter
    // kiest daarna het aangeklikte doel en niet het vorige.
    activeer(doel.id, focusInKubus() !== null);
  };
  function onPointerUp(event: PointerEvent) { beeindig(event, false); }
  // Afgebroken, of de vangst ging verloren (venster kwijt, element weg): wel
  // het slepen afsluiten (labels terug, camera opslaan), geen klik.
  function onPointerCancel(event: PointerEvent) { beeindig(event, true); }
  const onPointerDown = (event: PointerEvent) => {
    if (druk || (event.button !== 0 && event.button !== 2)) return;
    const doel = doelVan(event.target);
    if (!doel) return;
    // preventDefault houdt de browser ook van zijn focuswissel af. Doe die
    // dan zelf, zoals een klik op het canvas: een invoerveld buiten de kubus
    // verliest de focus, anders gaan de toetsen na een kubusklik naar het veld.
    event.preventDefault();
    const actiefElement = document.activeElement;
    if (actiefElement instanceof HTMLElement && actiefElement !== document.body && !kubus.contains(actiefElement)) {
      actiefElement.blur();
    }
    sluitMenu(false);
    const vanger = event.target as Element;
    druk = {
      pointerId: event.pointerId, knop: event.button, doel, vanger,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, sleept: false,
    };
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    try { vanger.setPointerCapture(event.pointerId); } catch { /* geen actieve aanwijzer (synthetisch) */ }
  };
  // Een rechtermuisklik op de kubus draait (slepen) en opent geen menu.
  const onContextMenu = (event: Event) => event.preventDefault();

  // ── Markeren: hover en zichtbare toetsenbordfocus ───────────────────────
  let hover: string | undefined;
  const onPointerOver = (event: PointerEvent) => {
    const doel = doelVan(event.target);
    if (doel === hover) return;
    markeer(hover, "is-hover", false);
    hover = doel;
    markeer(hover, "is-hover", true);
  };
  const onPointerLeave = () => {
    markeer(hover, "is-hover", false);
    hover = undefined;
  };
  let focus: string | undefined;
  const onFocusIn = (event: FocusEvent) => {
    const doel = doelVan(event.target);
    markeer(focus, "is-focus", false);
    focus = undefined;
    if (!doel) return;
    actief = doel;
    knopPerDoel.forEach((knop, id) => { knop.tabIndex = id === doel ? 0 : -1; });
    // Alleen bij toetsenbordfocus een rand: na een muisklik niet.
    const zichtbaar = (event.target as HTMLElement).matches(":focus-visible");
    if (zichtbaar) {
      focus = doel;
      markeer(focus, "is-focus", true);
    }
  };
  const onFocusOut = () => {
    markeer(focus, "is-focus", false);
    focus = undefined;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      const doel = openFem3DViewCubeDoel(actief);
      if (doel) acties.kies(doel);
      return;
    }
    // Pijltjes alleen langs de doelen die naar de kijker gericht zijn.
    const zichtbaar = volgorde.filter(doelZichtbaar);
    if (zichtbaar.length === 0) return;
    const index = zichtbaar.indexOf(actief);
    let volgende: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") volgende = index < 0 ? 0 : (index + 1) % zichtbaar.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      volgende = index < 0 ? zichtbaar.length - 1 : (index - 1 + zichtbaar.length) % zichtbaar.length;
    } else if (event.key === "Home") volgende = 0;
    else if (event.key === "End") volgende = zichtbaar.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    activeer(zichtbaar[volgende], true);
  };

  kubus.addEventListener("pointerdown", onPointerDown);
  kubus.addEventListener("lostpointercapture", onPointerCancel);
  kubus.addEventListener("pointerover", onPointerOver);
  kubus.addEventListener("pointerleave", onPointerLeave);
  kubus.addEventListener("contextmenu", onContextMenu);
  kubus.addEventListener("focusin", onFocusIn);
  kubus.addEventListener("focusout", onFocusOut);
  kubus.addEventListener("keydown", onKeyDown);
  menuKnop.addEventListener("click", onMenuKnopKlik);
  menuKnop.addEventListener("keydown", onMenuKnopToets);
  menu.addEventListener("keydown", onMenuToets);
  menu.addEventListener("click", onMenuKlik);
  menu.addEventListener("pointermove", onMenuWijzer);
  keuze.addEventListener("focusout", onKeuzeFocusUit);
  keuze.addEventListener("contextmenu", onContextMenu);
  ouder.appendChild(element);

  let laatsteTransform = "";
  const volg = (matrix: readonly number[]) => {
    const transform = openFem3DViewCubeCss(matrix);
    if (transform === laatsteTransform) return;
    laatsteTransform = transform;
    scene.style.transform = transform;
    for (const vlak of OPEN_FEM_3D_VIEW_CUBE_VLAKKEN) {
      const z = openFem3DViewCubeNaarKijker(matrix, vlak);
      naarKijker.set(vlak, z);
      // Voor de proeven: welke vlakken naar de kijker wijzen.
      vlakElementen.get(vlak)!.dataset.naarKijker = z >= OPEN_FEM_3D_VIEW_CUBE_ZICHTBAAR_VANAF ? "ja" : "nee";
    }
    houdKnoppenZichtbaar();
  };
  // Tot de eerste cameramatrix: recht van boven (de eenheidsmatrix).
  volg([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  return {
    element,
    volg,
    zetTeksten,
    zetMenu,
    toon: (zichtbaar) => {
      if (element.hidden === !zichtbaar) return;
      if (!zichtbaar) {
        sluitMenu(false);
        const actiefElement = document.activeElement;
        if (actiefElement instanceof HTMLElement && element.contains(actiefElement)) actiefElement.blur();
      }
      element.hidden = !zichtbaar;
    },
    verwijder: () => {
      druk = null;
      stopVenster();
      sluitMenu(false, false);
      kubus.removeEventListener("pointerdown", onPointerDown);
      kubus.removeEventListener("lostpointercapture", onPointerCancel);
      kubus.removeEventListener("pointerover", onPointerOver);
      kubus.removeEventListener("pointerleave", onPointerLeave);
      kubus.removeEventListener("contextmenu", onContextMenu);
      kubus.removeEventListener("focusin", onFocusIn);
      kubus.removeEventListener("focusout", onFocusOut);
      kubus.removeEventListener("keydown", onKeyDown);
      menuKnop.removeEventListener("click", onMenuKnopKlik);
      menuKnop.removeEventListener("keydown", onMenuKnopToets);
      menu.removeEventListener("keydown", onMenuToets);
      menu.removeEventListener("click", onMenuKlik);
      menu.removeEventListener("pointermove", onMenuWijzer);
      keuze.removeEventListener("focusout", onKeuzeFocusUit);
      keuze.removeEventListener("contextmenu", onContextMenu);
      element.remove();
    },
  };
}
