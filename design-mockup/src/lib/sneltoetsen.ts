/**
 * Sneltoetsen van de app op één plek: de tooltips van de lintknoppen, het
 * overzicht (? of F1) en de toetsafhandeling in App.tsx lezen deze lijst.
 *
 * `label` is een i18n-sleutel (namespace:pad). De letters zonder Ctrl werken
 * alleen in het model, niet terwijl iemand in een invoerveld typt; zie
 * `isTypVeld`. G, R en D op het canvas werken op de selectie (FemCanvas) en
 * zijn iets anders dan de lintknoppen Verplaatsen/Roteren/Kopiëren, die een
 * tool kiezen; ze staan daarom apart in de groep "canvas".
 */
export type SneltoetsGroep = "file" | "edit" | "draw" | "canvas" | "calc";

export type SneltoetsActie =
  | "nieuw" | "openen" | "opslaan" | "opslaanAls" | "afdrukken" | "voorkeuren"
  | "ongedaan" | "opnieuw" | "verwijderen"
  | "staaf" | "knoop" | "plaat" | "stramien" | "scharnier" | "puntlast" | "lijnlast" | "belastinggevallen"
  | "berekenen" | "overzicht";

export interface Sneltoets {
  /** Weergave van de toets(en), bv. "Ctrl+Shift+S" of "? / F1". */
  toets: string;
  label: string;
  groep: SneltoetsGroep;
  /** Actie in App.tsx; zonder actie handelt een ander onderdeel de toets af. */
  actie?: SneltoetsActie;
}

export const SNELTOETSEN: readonly Sneltoets[] = [
  { toets: "Ctrl+N", label: "ribbon:home.new", groep: "file", actie: "nieuw" },
  { toets: "Ctrl+O", label: "ribbon:home.open", groep: "file", actie: "openen" },
  { toets: "Ctrl+S", label: "ribbon:home.save", groep: "file", actie: "opslaan" },
  { toets: "Ctrl+Shift+S", label: "ribbon:home.saveAs", groep: "file", actie: "opslaanAls" },
  { toets: "Ctrl+P", label: "common:shortcuts.labels.print", groep: "file", actie: "afdrukken" },
  { toets: "Ctrl+,", label: "common:preferences", groep: "file", actie: "voorkeuren" },

  { toets: "Ctrl+Z", label: "ribbon:home.undo", groep: "edit", actie: "ongedaan" },
  { toets: "Ctrl+Y", label: "ribbon:home.redo", groep: "edit", actie: "opnieuw" },
  { toets: "Ctrl+C", label: "common:copy", groep: "edit" },
  { toets: "Ctrl+V", label: "common:paste", groep: "edit" },
  { toets: "Delete", label: "common:delete", groep: "edit", actie: "verwijderen" },

  { toets: "S", label: "ribbon:home.bar", groep: "draw", actie: "staaf" },
  { toets: "K", label: "ribbon:home.node", groep: "draw", actie: "knoop" },
  { toets: "P", label: "ribbon:home.plate", groep: "draw", actie: "plaat" },
  { toets: "Shift+G", label: "ribbon:home.grids", groep: "draw", actie: "stramien" },
  { toets: "O", label: "ribbon:home.pinned", groep: "draw", actie: "scharnier" },
  { toets: "U", label: "ribbon:home.pointLoad", groep: "draw", actie: "puntlast" },
  { toets: "L", label: "ribbon:home.lineLoad", groep: "draw", actie: "lijnlast" },
  { toets: "Ctrl+L", label: "ribbon:home.loadCases", groep: "draw", actie: "belastinggevallen" },

  { toets: "G", label: "common:shortcuts.labels.moveSelection", groep: "canvas" },
  { toets: "R", label: "common:shortcuts.labels.rotateSelection", groep: "canvas" },
  { toets: "D", label: "common:shortcuts.labels.duplicateSelection", groep: "canvas" },
  { toets: "F", label: "common:shortcuts.labels.fit", groep: "canvas" },
  { toets: "Spatie", label: "common:shortcuts.labels.pan", groep: "canvas" },

  { toets: "F9", label: "ribbon:home.solve", groep: "calc", actie: "berekenen" },
  { toets: "? / F1", label: "common:shortcuts.labels.overview", groep: "calc", actie: "overzicht" },
];

/** De toets bij een actie, voor de tooltip van een lintknop. */
export function toetsVoor(actie: SneltoetsActie): string | undefined {
  return SNELTOETSEN.find((s) => s.actie === actie)?.toets;
}

/** Typt de gebruiker in een veld? Dan horen letters bij de tekst, niet bij de app. */
export function isTypVeld(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  if (!e || !e.closest) return false;
  return !!e.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

/** Welke actie hoort bij deze toetsaanslag? */
export function actieVoorToets(e: KeyboardEvent): SneltoetsActie | undefined {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.altKey) return undefined;
  if (ctrl) {
    if (e.shiftKey) return undefined;
    switch (k) {
      case "n": return "nieuw";
      case "o": return "openen";
      case "p": return "afdrukken";
      case ",": return "voorkeuren";
      case "l": return "belastinggevallen";
      default: return undefined;
    }
  }
  if (k === "F9") return "berekenen";
  if (k === "F1" || k === "?") return "overzicht";
  if (e.shiftKey) return k === "g" ? "stramien" : undefined;
  switch (k) {
    case "s": return "staaf";
    case "k": return "knoop";
    case "p": return "plaat";
    case "o": return "scharnier";
    case "u": return "puntlast";
    case "l": return "lijnlast";
    default: return undefined;
  }
}
