/**
 * De stroom van "Rekenmodel importeren": bestand kiezen → (bij meer
 * analysemodellen) model kiezen → de gewone vraag bij niet-opgeslagen werk →
 * het model als nieuw 3D-project neerzetten → verslag.
 *
 * App.tsx levert de drie dingen die bij de app horen (de vraag, het
 * toepassen, de melding); de browsertest levert eigen versies en loopt zo
 * door precies deze stroom. Een bestand dat niet deugt geeft een melding vóór
 * de vraag om niet-opgeslagen werk: er gaat dan niets verloren.
 */
import { useCallback, useState, type ReactNode } from "react";
import i18next from "i18next";
import {
  ifcAnalyseModellen,
  importeerIfcAnalyseModel,
  leesIfcAnalyseBestand,
  type IfcAnalyseBestand,
  type IfcAnalyseImport,
  type IfcAnalyseModelInfo,
} from "../../io/ifcAnalyseImport";
import type { GekozenIfcBestand } from "../../io/ifcBestandKiezen";
import { IfcImportVerslagVenster, IfcModelKeuze } from "./IfcImportDialogen";

export interface IfcImportStroomOpties {
  /** Een bestand kiezen; standaard de bestandsdialoog van de app. */
  kiesBestand?: () => Promise<GekozenIfcBestand | null>;
  /** De gewone vraag bij niet-opgeslagen werk; false = afbreken, er verandert niets. */
  bevestig: () => Promise<boolean>;
  /** Het geïmporteerde model als nieuw project neerzetten. */
  pasToe: (imp: IfcAnalyseImport) => void;
  /** Een melding als het bestand niet te importeren is. */
  meldFout: (titel: string, tekst: string) => void;
}

type Toestand =
  | { stap: "kiezen"; bestand: IfcAnalyseBestand; bestandsnaam: string; modellen: IfcAnalyseModelInfo[] }
  | { stap: "verslag"; imp: IfcAnalyseImport; bestandsnaam: string }
  | null;

export function useIfcImportStroom(opties: IfcImportStroomOpties): { start: () => Promise<void>; dialogen: ReactNode } {
  const { kiesBestand, bevestig, pasToe, meldFout } = opties;
  const [toestand, setToestand] = useState<Toestand>(null);
  const fout = useCallback((e: unknown) => {
    meldFout(i18next.t("common:ifcImport.mislukt"), e instanceof Error ? e.message : String(e));
  }, [meldFout]);

  const importeer = useCallback(async (bestand: IfcAnalyseBestand, model: number, bestandsnaam: string) => {
    let imp: IfcAnalyseImport;
    try {
      imp = importeerIfcAnalyseModel(bestand, { model });
    } catch (e) {
      setToestand(null);
      fout(e);
      return;
    }
    if (!(await bevestig())) {
      setToestand(null);
      return;
    }
    pasToe(imp);
    setToestand({ stap: "verslag", imp, bestandsnaam });
  }, [bevestig, pasToe, fout]);

  const start = useCallback(async () => {
    let gekozen: GekozenIfcBestand | null;
    try {
      gekozen = kiesBestand ? await kiesBestand() : await (await import("../../io/ifcBestandKiezen")).kiesIfcBestand();
    } catch (e) {
      fout(e);
      return;
    }
    if (!gekozen) return;
    try {
      const bestand = leesIfcAnalyseBestand(gekozen.tekst);
      const modellen = ifcAnalyseModellen(bestand);
      if (modellen.length > 1) {
        setToestand({ stap: "kiezen", bestand, bestandsnaam: gekozen.naam, modellen });
        return;
      }
      // Eén model, of geen: dan zegt de import waarom niet.
      await importeer(bestand, 1, gekozen.naam);
    } catch (e) {
      fout(e);
    }
  }, [kiesBestand, importeer, fout]);

  const dialogen = (
    <>
      <IfcModelKeuze
        open={toestand?.stap === "kiezen"}
        bestandsnaam={toestand?.bestandsnaam ?? ""}
        modellen={toestand?.stap === "kiezen" ? toestand.modellen : []}
        onKies={(nummer) => {
          if (toestand?.stap === "kiezen") void importeer(toestand.bestand, nummer, toestand.bestandsnaam);
        }}
        onSluit={() => setToestand(null)}
      />
      <IfcImportVerslagVenster
        open={toestand?.stap === "verslag"}
        bestandsnaam={toestand?.bestandsnaam ?? ""}
        projectnaam={toestand?.stap === "verslag" ? toestand.imp.projectnaam : ""}
        verslag={toestand?.stap === "verslag" ? toestand.imp.verslag : null}
        onSluit={() => setToestand(null)}
      />
    </>
  );
  return { start, dialogen };
}
