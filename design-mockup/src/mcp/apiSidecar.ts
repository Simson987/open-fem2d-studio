/**
 * De API-commando's in de sidecar: zonder app, op de tekst van een
 * projectbestand. De MCP-server leest en schrijft het bestand; de sidecar
 * voert alleen het commando uit (zuiver).
 *
 *   api_catalogus  → { commands: [{ name, description, inputSchema, kind }] }
 *   api_uitvoeren  { name, input?, project? } → { output, project }
 *       `project` in het verzoek: de tekst van het projectbestand. Ontbreekt
 *       het, dan alleen bij project.new (dat begint leeg). `project` in het
 *       antwoord: de tekst van het gewijzigde document, of null als het
 *       commando niets wijzigde.
 *
 * Veldnamen Engels, zoals de rest van het protocol; meldingen Nederlands.
 */
import { ApiFout } from "../api/register";
import { documentNaarTekst, documentUitTekst, leegDocument, type ApiDocument } from "../api/projectDocument";
import { standaardRegister } from "../api/standaardRegister";

let register: ReturnType<typeof standaardRegister> | null = null;
const hetRegister = () => (register ??= standaardRegister());

export function opApiCatalogus(): {
  commands: { name: string; description: string; inputSchema: unknown; kind: "document" | "app" }[];
} {
  return {
    commands: hetRegister().catalogus().map((c) => ({
      name: c.naam, description: c.beschrijving, inputSchema: c.invoer, kind: c.soort,
    })),
  };
}

export function opApiUitvoeren(payload: Record<string, unknown>): { output: unknown; project: string | null } {
  const onbekend = Object.keys(payload).filter((veld) => !["name", "input", "project"].includes(veld));
  if (onbekend.length > 0) {
    throw new ApiFout("INVOER_ONGELDIG", `Onbekende velden in api_uitvoeren: ${onbekend.join(", ")}.`, { velden: onbekend });
  }
  if (typeof payload.name !== "string" || payload.name === "") {
    throw new ApiFout("INVOER_ONGELDIG", "Veld `name` (de naam van het commando) ontbreekt.");
  }
  if (payload.project !== undefined && typeof payload.project !== "string") {
    throw new ApiFout("INVOER_ONGELDIG", "Veld `project` moet de tekst van een projectbestand zijn.");
  }
  let document: ApiDocument | undefined;
  if (typeof payload.project === "string") {
    try {
      document = documentUitTekst(payload.project);
    } catch (fout) {
      throw new ApiFout("BESTAND_ONLEESBAAR", `Het projectbestand is niet te lezen: ${fout instanceof Error ? fout.message : String(fout)}`);
    }
  } else if (payload.name === "project.new") {
    document = leegDocument();
  }
  const resultaat = hetRegister().voerUit(payload.name, payload.input, { document });
  if (resultaat instanceof Promise) {
    // Alleen een app-commando kan een belofte geven, en die werkt hier niet.
    resultaat.catch(() => undefined);
    throw new ApiFout("ALLEEN_IN_APP", `${payload.name} werkt alleen in de draaiende app.`);
  }
  return {
    output: resultaat.uitkomst,
    project: resultaat.document ? documentNaarTekst(resultaat.document) : null,
  };
}
