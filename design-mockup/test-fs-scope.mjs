// Recente bestanden openen zonder dialoog: de fs-rechten moeten projectbestanden
// (.ifcfem, en de oudere .ifcfem2d) toestaan, en verder niets extra.
//
// Aanleiding: "forbidden path" bij openen via de lijst met recente bestanden.
// Bestand → Openen werkt altijd, omdat de dialoogplugin het gekozen pad voor de
// looptijd vrijgeeft. `handleOpenFilePath` (recente bestanden, welkomstscherm)
// en `saveProjectTo` (Opslaan) roepen readTextFile/writeTextFile rechtstreeks
// aan; zonder scope in de capability weigert tauri-plugin-fs dat pad.
//
//   [1] default.json geeft read- en write-text-file vrij voor **/*.<projectext>
//   [2] geen ongescoopte read-/write-text-file-vrijgave ernaast
//   [3] de extensie is die van het projectbestand, en de twee aanroepen bestaan nog
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const lees = (...p) => readFileSync(join(HIER, ...p), "utf8").replace(/\r\n/g, "\n");

const cap = JSON.parse(lees("..", "src-tauri", "capabilities", "default.json"));
const ext = /PROJECT_FILE_EXT\s*=\s*"([^"]+)"/.exec(lees("src", "io", "projectFile.ts"))?.[1];
const patronen = [`**/*.${ext}`, "**/*.ifcfem2d"];

log("[1] vrijgave voor projectbestanden");
for (const id of ["fs:allow-read-text-file", "fs:allow-write-text-file"]) {
  const item = cap.permissions.find((p) => typeof p === "object" && p.identifier === id);
  const paden = (item?.allow ?? []).map((a) => a.path);
  check(`${id} is gescoopt op ${patronen.join(" en ")}`, patronen.every((p) => paden.includes(p)), JSON.stringify(paden));
  check(`${id} staat verder niets toe`, paden.length === patronen.length && !item?.deny, JSON.stringify(item));
}

log("\n[2] geen ongescoopte vrijgave");
for (const id of ["fs:allow-read-text-file", "fs:allow-write-text-file", "fs:allow-read-file", "fs:read-all", "fs:write-all"]) {
  check(`geen kale "${id}"`, !cap.permissions.includes(id));
}
check("geen globale fs:scope met jokers", !cap.permissions.some((p) => (typeof p === "string" ? p : p.identifier).startsWith("fs:scope")));

log("\n[3] extensie en aanroepen");
check("projectextensie is .ifcfem", ext === "ifcfem", String(ext));
const { voorgesteldeProjectnaam, PROJECT_FILE_EXTS } = await import("./src/io/projectFile.ts");
check("openen herkent .ifcfem en de oudere .ifcfem2d", JSON.stringify(PROJECT_FILE_EXTS) === JSON.stringify(["ifcfem", "ifcfem2d"]));
check("Opslaan als: een .ifcfem2d-bestand krijgt .ifcfem als voorstel",
  voorgesteldeProjectnaam("C:/werk/hal.ifcfem2d") === "C:/werk/hal.ifcfem" && voorgesteldeProjectnaam("C:/werk/HAL.IFCFEM2D") === "C:/werk/HAL.ifcfem");
check("… een nieuw project heet project.ifcfem, een .ifcfem blijft gelijk",
  voorgesteldeProjectnaam(null) === "project.ifcfem" && voorgesteldeProjectnaam("C:/werk/hal.ifcfem") === "C:/werk/hal.ifcfem");
check("de lijst met recente bestanden herkent beide als project",
  /ext === "ifcfem" \|\| ext === "ifcfem2d"\) return "project"/.test(lees("src", "hooks", "useRecentFiles.ts")));
const app = lees("src", "App.tsx");
check("handleOpenFilePath leest nog met readTextFile(path)", /const handleOpenFilePath[\s\S]{0,400}readTextFile\(path\)/.test(app));
check("saveProjectTo schrijft nog met writeTextFile(path, …)", /export async function saveProjectTo[\s\S]{0,300}writeTextFile\(path/.test(lees("src", "io", "projectFile.ts")));

// "Rekenmodel importeren" leest een .ifc dat de gebruiker in de bestandsdialoog
// kiest. De dialoogplugin zet dat pad voor de looptijd in de fs-scope
// (`allow_file`), en tauri-plugin-fs laat een pad toe dat in die scope OF in de
// scope van het commando staat. Een vrijgave van **/*.ifc in de capability is
// dus niet nodig — en zou elk .ifc op de schijf leesbaar maken zonder dialoog.
log("\n[4] IFC-rekenmodel importeren");
const kiezen = lees("src", "io", "ifcBestandKiezen.ts");
check("de IFC-import kiest het bestand met de dialoog en leest precies dat pad",
  /open\(\{[\s\S]{0,200}extensions: \["ifc"/.test(kiezen) && /readTextFile\(pad\)/.test(kiezen));
check("… zonder eigen vrijgave van *.ifc in de capability", !JSON.stringify(cap).includes("*.ifc\""));
check("de bedieningsopdracht laat Rust het pad lezen (gui_control.rs), niet de pagina",
  /"ifc_analysemodel_importeren" => \{[\s\S]{0,400}fs::read\(pad\)/.test(lees("..", "src-tauri", "src", "gui_control.rs")));

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
