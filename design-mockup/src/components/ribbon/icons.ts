import { b2 } from "./b2Icons";
// Ribbon icons (SVG strings)
// Only icons actively used in the ribbon are exported here.
// Add project-specific icons as needed.

export const settingsIcon = b2("ui.settings");

export const helpIcon = b2("ui.help");
export const waterAccumulationIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8h18M3 8c3 0 3 2 6 2s3-2 6-2 3 2 6 2M4 14c3 0 4 5 8 5s5-5 8-5M4 14h16"/></svg>`;

export const infoIcon = b2("status.info");

// IFC Tab icons
export const ifcImportIcon = b2("ifc.import");
export const ifcExportIcon = b2("ifc.export");
export const ifcTreeIcon = b2("panel.model-tree");
export const ifcValidateIcon = b2("ifc.validate");
export const ifcStatsIcon = b2("data.chart");

// 3D Viewer Tab icons
export const viewerLoadIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="3.27 6.96 12 12.01 20.73 6.96"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
export const viewerOrbitIcon = b2("view.orbit");
export const viewerSectionIcon = b2("section.box");
export const viewerMeasureIcon = b2("measure.distance");
export const viewerFitIcon = b2("view.fit");
/** Perspectief: een vloer die naar een verdwijnpunt toe smaller wordt. */
export const viewerPerspectiveIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 20L9 5h6l6 15z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 13h12M12 5v15"/></svg>`;
export const viewerWireframeIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4l8 4 8-4M4 4v12l8 4M4 4l8 4v12M20 4v12l-8 4M20 4l-8 4v12"/></svg>`;

// Report Tab icons
export const reportNewIcon = b2("report.document");
export const reportTemplateIcon = b2("report.template");
export const reportGenerateIcon = b2("report.generate");
export const reportPreviewIcon = b2("view.report-preview");
export const reportCoverIcon = b2("report.cover");

// Extensions Tab icons
export const extensionBrowseIcon = b2("software.catalog");
export const extensionInstallIcon = b2("extension.install-file");
export const extensionManageIcon = b2("extensions.manage");

// Project Settings icon
export const projectIcon = b2("project.folder");

// Clipboard
export const pasteIcon = b2("edit.paste");
export const cutIcon = b2("edit.cut");
export const copyIcon = b2("edit.copy");

// History
export const undoIcon = b2("edit.undo");
export const redoIcon = b2("edit.redo");

// Font formatting
export const boldIcon = b2("format.bold");
export const italicIcon = b2("format.italic");
export const underlineIcon = b2("format.underline");

// Paragraph alignment
export const alignLeftIcon = b2("format.align-left");
export const alignCenterIcon = b2("format.align-center");
export const alignRightIcon = b2("format.align-right");

// Drawing
export const pencilIcon = b2("draw.freehand");
export const lineIcon = b2("draw.line");
export const arrowIcon = b2("draw.arrow");
export const circleIcon = b2("draw.circle");
export const rectangleIcon = b2("draw.rectangle");

// Insert
export const imageIcon = b2("draw.image");
export const tableIcon = b2("data.table");
export const linkIcon = b2("link.open-external");

// ============================================================================
// FEM-specific icons — lucide-react style components
// ============================================================================

// --- File / project (used in home File group) ---
export const fileNewIcon = b2("file.new");
export const fileOpenIcon = b2("file.open");
export const fileSaveIcon = b2("file.save");

// --- Draw tools (Select, Bar, Node, Plate, Grids) ---
// Eigen pijltje (zoals voorheen): het B2-icoon edit.select oogde te druk.
export const selectIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3l7 17 2.5-7.5L20 10z"/></svg>`;
export const barIcon = b2("fem.beam");
export const nodeIcon = b2("fem.node");
/** Opening in een plaat: de plaatomtrek met een uitgespaarde rechthoek erin. */
export const openingIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" stroke-width="2"/><rect x="8" y="8" width="8" height="8" stroke-width="2" stroke-dasharray="2 2"/></svg>`;
export const plateIcon = b2("fem.plate");
export const gridIcon = b2("view.grid");

// --- Boundary conditions (Pinned, X-Roller, Z-Roller, springs, Fixed) ---
// Inline SVGs — amber fills + dark strokes
// Scharnier (pinned) — pin-cirkel BOVEN driehoek + gearceerde grond. De
// pin-cirkel maakt visueel ondubbelzinnig dat dit een scharnier is (geen rol).
export const bcPinnedIcon = b2("fem.pinned-support");
export const bcXRollerIcon = b2("fem.roller-support", { draai: -90 });
export const bcZRollerIcon = b2("fem.roller-support");
export const bcZSpringIcon = b2("fem.spring-support");
export const bcXSpringIcon = b2("fem.spring-support", { draai: -90 });
export const bcRotSpringIcon = b2("fem.rotational-spring");
export const bcFixedIcon = b2("fem.fixed-support");

// --- Loads (Point, Line, Moment, Temp, Load cases) ---
// Larger, more "engineering" feel: thick shafts + solid filled triangle
// arrowheads + subtle outline. Same icon shows up at small + large sizes
// (RibbonButton scales the SVG); viewBox stays 24x24.

// PUNTLAST (V): verticale pijl, solid driehoek-pijlpunt, dikke shaft.
//   shaft: line (12,3) → (12,15)
//   head:  filled polygon (5,15)(19,15)(12,22)
export const loadPointIcon = b2("fem.point-load");

// PUNTLAST (H): horizontale pijl, solid driehoek-pijlpunt aan rechterkant.
//   shaft: line (2,12) → (15,12)
//   head:  filled polygon (14,5)(14,19)(22,12)
export const loadPointHIcon = b2("fem.point-load", { draai: -90 });

// LIJNLAST: rechthoekige omlijsting + bovenbalk + 3 puntlasten eronder.
//   buitenkader: rect (1,1)–(22,22) lichte border
//   bovenbalk: line (3,4) → (21,4)
//   3× shafts: kort verticaal segment
//   3× solid pijlpunten naar onder
export const loadLineIcon = b2("fem.line-load");
/** Belastingvlak: gearceerd vlak met lastpijlen erop, voor het 3D-gereedschap. */
export const loadPanelIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 21l4-8h14l-4 8z" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 21l3-6M13 21l3-6" stroke-width="1" opacity="0.6"/><path d="M8 3v7M14 3v7M20 3v7" stroke-width="1.8" stroke-linecap="round"/><path d="M6 8l2 3 2-3M12 8l2 3 2-3M18 8l2 3 2-3" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// MOMENT: 3/4 cirkel met solid driehoek-pijlpunt aan het einde (tangentieel).
//   arc: M5,12 a7,7 0 1,1 9.9,4.95  (270° draaiing rond (12,12))
//   pijlpunt: solid driehoek aan eind van de arc, georiënteerd tangentieel
//   Beter zichtbare pijl: groter, gevuld, met outline.
export const loadMomentIcon = b2("fem.moment");
export const loadTempIcon = b2("fem.thermal-load");
export const loadCasesIcon = b2("fem.load-case");

// LOAD COMBINATIONS — Σ-symbool + 3 stacked rows (γ₁·F₁ + γ₂·F₂ + γ₃·F₃).
// Visueel onderscheidt van "gevallen": de Σ links suggereert SOM/combinatie.
export const loadCombinationsIcon = b2("fem.load-combination");

// WINDGENERATOR — windvlagen die tegen een gevel aan waaien. Onderscheidt
// zich van de lastknoppen doordat het gebouw (rechts) er in zit.
export const windGeneratorIcon = b2("fem.wind-load");

// --- Edit / modify (Move, Rotate, Copy, Finish) ---
export const moveIcon = b2("transform.move");
export const rotateIcon = b2("transform.rotate");
export const finishIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-width="2"/><polyline points="8 12 11 15 16 9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// --- View / panels (Console, Filter) ---
// graphIcon/agentIcon zijn verwijderd samen met de dode View-groep in HomeTab
// (de toggles zetten state die nergens werd geconsumeerd).
export const consoleIcon = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
export const filterIcon = b2("table.column-filter");

// --- Settings tab (Project info, Materials, Calc, Theme, Language) ---
export const projectInfoIcon = b2("project.properties");
export const materialsIcon = b2("fem.material");
export const sectionsIcon = b2("fem.section");
export const calcSettingsIcon = settingsIcon;
export const themeSunIcon = b2("theme.light");
export const themeMoonIcon = b2("theme.dark");
export const languageIcon = b2("ui.language");
/** AI-assistent (MCP): een tekstballon met een vonk. */
export const aiAssistantIcon = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 01-12.3 7.6L3 20.5l1.4-5.2A8.5 8.5 0 1121 11.5z"/><path d="M12 7.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"/></svg>`;

// --- Table tab (Nodes, Elements, Plates, Loads tables) ---
export const tableNodesIcon = b2("fem.node");
export const tableElementsIcon = b2("fem.beam");
export const tableLoadsIcon = b2("fem.line-load");
export const tableResultsIcon = b2("fem.reaction");
export const exportCsvIcon = b2("file.export");

// --- Insights tab (Element K, System K, Solver info, DOF map, Logs, Errors) ---
export const matrixIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" stroke-width="2"/><line x1="3" y1="9" x2="21" y2="9" stroke-width="1.5"/><line x1="3" y1="15" x2="21" y2="15" stroke-width="1.5"/><line x1="9" y1="3" x2="9" y2="21" stroke-width="1.5"/><line x1="15" y1="3" x2="15" y2="21" stroke-width="1.5"/></svg>`;
export const networkIcon = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><line x1="12" y1="8" x2="6" y2="16"/><line x1="12" y1="8" x2="18" y2="16"/><line x1="7" y1="18" x2="17" y2="18"/></svg>`;
export const solverInfoIcon = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
export const dofMapIcon = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></svg>`;
export const logsIcon = consoleIcon;
export const errorsIcon = b2("status.error");

// --- Check tab (EN 1993 steel checks) ---
export const checkRunIcon = b2("fem.utilization");
export const checkPanelIcon = b2("status.success");
export const checkRulesIcon = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`;

// --- IFC tab (FEM ↔ IFC integration — import, structural model, validate, export) ---
export const ifcStructuralIcon = b2("fem.truss");
export const ifcMaterialMapIcon = b2("fem.material");
/** Een hal met een pijl naar binnen: een rekenmodel uit een IFC-bestand halen. */
export const ifcAnalysisImportIcon = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M3 21V9l9-6 9 6v12"/><path d="M3 21h18"/><path d="M12 9v8m-3.5-3.5L12 17l3.5-3.5"/></svg>`;

// --- Report tab — additional ---
export const reportConfigIcon = settingsIcon;
export const reportSectionsIcon = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3" y2="6"/><line x1="3" y1="12" x2="3" y2="12"/><line x1="3" y1="18" x2="3" y2="18"/></svg>`;

// Zichtbaarheid (issue #47): een oog — het venster met alle weergave-instellingen.
export const zichtbaarheidIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>`;

// Plaatweergave in 3D (issue #78): volume (plaat met dikte), vlak (alleen het
// middenvlak) en mesh (de elementen op het middenvlak). Lint, venster en verkenner.
export const plateVolumeIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 10 12 6l9 4-9 4-9-4Z" fill="currentColor" fill-opacity=".18" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 10v3.5l9 4 9-4V10M12 14v3.5" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
export const plateSurfaceIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 12 12 8l9 4-9 4-9-4Z" fill="currentColor" fill-opacity=".18" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
export const plateMeshIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 12 12 8l9 4-9 4-9-4Z" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 13.33l9-4M9 14.67l9-4M6 10.67l9 4M9 9.33l9 4" stroke-width="1.1"/></svg>`;
