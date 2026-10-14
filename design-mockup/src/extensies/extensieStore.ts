import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { getSetting, setSetting } from "../store";
import {
  importeurVoorBestand, keurImportResultaat, keurManifest,
  type ExtensieManifest, type ImportUitkomst,
} from "./manifest";
import { draaiImporteurInWorker } from "./worker";

export interface ExtensieKaart {
  map: string;
  bron: "geinstalleerd" | "gekoppeld" | "omgeving";
  manifest?: ExtensieManifest;
  fout?: string;
  ingeschakeld: boolean;
}

interface GevondenExtensie {
  map: string;
  bron: ExtensieKaart["bron"];
  manifestTekst?: string | null;
  fout?: string | null;
}

export class MeerdereImporteursFout extends Error {
  constructor(readonly keuzes: { id: string; label: string; extensie: string }[]) {
    super("Meer dan één importeur kan dit bestand openen.");
  }
}

export interface ExtensieBron {
  invoke<T>(commando: string, argumenten?: Record<string, unknown>): Promise<T>;
  getSetting<T>(sleutel: string, fallback: T): Promise<T>;
  setSetting<T>(sleutel: string, waarde: T): Promise<void>;
  draaiScript: typeof draaiImporteurInWorker;
}

const standaardBron: ExtensieBron = { invoke, getSetting, setSetting, draaiScript: draaiImporteurInWorker };

interface ExtensieState {
  kaarten: ExtensieKaart[];
  fout: string | null;
  laden(): Promise<void>;
  zetIngeschakeld(id: string, aan: boolean): Promise<void>;
  koppelMap(map: string): Promise<void>;
  ontkoppel(map: string): Promise<void>;
  installeerZip(pad: string): Promise<void>;
  verwijder(map: string): Promise<void>;
  importeer(pad: string, importerId?: string): Promise<{ uitkomst: ImportUitkomst; extensie: ExtensieManifest }>;
}

export function maakExtensieStore(bron: ExtensieBron = standaardBron) {
  return create<ExtensieState>((set, get) => ({
    kaarten: [],
    fout: null,
    laden: async () => {
      const mappen = await bron.getSetting<string[]>("extensies.mappen", []);
      const uit = await bron.getSetting<string[]>("extensies.uit", []);
      try {
        const gevonden = await bron.invoke<GevondenExtensie[]>("extensies_lezen", { mappen });
        const kaarten = gevonden.map((item): ExtensieKaart => {
          if (!item.manifestTekst) return { map: item.map, bron: item.bron, fout: item.fout || "extension.json ontbreekt.", ingeschakeld: false };
          const keuring = keurManifest(item.manifestTekst);
          if (!keuring.ok) return { map: item.map, bron: item.bron, fout: keuring.fouten.join(" "), ingeschakeld: false };
          return { map: item.map, bron: item.bron, manifest: keuring.manifest,
            ingeschakeld: !uit.includes(keuring.manifest.id) };
        });
        set({ kaarten, fout: null });
      } catch (error) {
        set({ kaarten: [], fout: error instanceof Error ? error.message : String(error) });
      }
    },
    zetIngeschakeld: async (id, aan) => {
      const uit = await bron.getSetting<string[]>("extensies.uit", []);
      const nieuw = aan ? uit.filter((x) => x !== id) : [...new Set([...uit, id])];
      await bron.setSetting("extensies.uit", nieuw);
      set((state) => ({ kaarten: state.kaarten.map((kaart) => kaart.manifest?.id === id
        ? { ...kaart, ingeschakeld: aan } : kaart) }));
    },
    koppelMap: async (map) => {
      const mappen = await bron.getSetting<string[]>("extensies.mappen", []);
      if (!mappen.includes(map)) await bron.setSetting("extensies.mappen", [...mappen, map]);
      await get().laden();
    },
    ontkoppel: async (map) => {
      const mappen = await bron.getSetting<string[]>("extensies.mappen", []);
      await bron.setSetting("extensies.mappen", mappen.filter((x) => x !== map));
      await get().laden();
    },
    installeerZip: async (pad) => {
      await bron.invoke("extensie_zip_installeren", { zipPad: pad });
      await get().laden();
    },
    verwijder: async (map) => {
      await bron.invoke("extensie_verwijderen", { map });
      await get().laden();
    },
    importeer: async (pad, importerId) => {
      const kandidaten = importeurVoorBestand(get().kaarten.flatMap((kaart) => kaart.manifest
        ? [{ map: kaart.map, manifest: kaart.manifest, ingeschakeld: kaart.ingeschakeld }] : []), pad)
        .filter(({ extensie, importeur }) => importerId === undefined || importerId === importeur.id
          || importerId === `${extensie.manifest.id}/${importeur.id}`);
      if (kandidaten.length === 0) throw new Error(`Geen ingeschakelde importeur voor ${pad}.`);
      if (kandidaten.length > 1) throw new MeerdereImporteursFout(kandidaten.map(({ extensie, importeur }) => ({
        id: `${extensie.manifest.id}/${importeur.id}`, label: importeur.label, extensie: extensie.manifest.name,
      })));
      const { extensie, importeur } = kandidaten[0];
      const mappen = await bron.getSetting<string[]>("extensies.mappen", []);
      const ingeschakeldeIds = get().kaarten.filter((kaart) => kaart.ingeschakeld && kaart.manifest)
        .map((kaart) => kaart.manifest!.id);
      const bytes = await bron.invoke<number[]>("extensie_bestand_lezen", { pad, mappen, ingeschakeldeIds });
      const script = await bron.invoke<string>("extensie_script_lezen", { map: extensie.map, main: extensie.manifest.main });
      const resultaat = await bron.draaiScript(script, {
        importerId: importeur.id, fileName: pad.split(/[\\/]/).pop() || pad, bytes: Uint8Array.from(bytes),
      });
      return { uitkomst: keurImportResultaat(resultaat), extensie: extensie.manifest };
    },
  }));
}

export const useExtensieStore = maakExtensieStore();
