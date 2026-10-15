/**
 * bron-uitvoeren — stukken van een React-component of hook (App.tsx,
 * useFemStore.ts) uitvoeren zonder React en zonder DOM.
 *
 * WAAROM. De rekenregie van de app (rekenDoor, handleRunMemberChecks, de
 * invalidatie-effecten, …) zijn closures BINNEN het component: ze zijn niet te
 * importeren. Tests lazen daarom de broncode met een reguliere expressie
 * ("staat hier `fem.stabiliteit`?"). Zo'n test breekt bij elke herschikking,
 * ook als het gedrag gelijk blijft, en hij slaagt bij code die er staat maar
 * niet doet wat hij moet. Deze hulp zoekt het stuk op in de AST (welke
 * callback, welk effect, welk JSX-attribuut) en VOERT HET UIT; de test kijkt
 * naar wat het doet.
 *
 * DE NADEN. Wat het stuk uit het component zelf haalt — state, setters, refs,
 * andere callbacks — geeft de test als naad mee. Wat het IMPORTEERT of op
 * MODULENIVEAU van het bronbestand staat (een losse functie, een constante),
 * krijgt het echt: elke zulke naam die het stuk gebruikt, wordt uit de echte
 * module geladen of in de context uitgevoerd, tenzij de test er een naad voor
 * geeft. Een nieuwe afhankelijkheid uit een lib-module laat de test dus niet
 * zonder reden vallen; een nieuwe naam uit het component zelf wel (met
 * "… is not defined"), en dat hoort: dan moet de test die toestand kiezen.
 *
 * Dynamische imports (`import("./io/notify")`) worden in de AST omgezet naar
 * een aanroep van `dynamischeImport(…)`. Zonder naad laadt die de echte
 * module, relatief aan het bronbestand; met een naad bepaalt de test wat er
 * terugkomt en wanneer.
 *
 * Stylesheets die echte modules meetrekken, worden een lege module.
 */
import ts from "typescript";
import vm from "node:vm";
import { existsSync, readFileSync, statSync } from "node:fs";
import { register } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HIER, "..");

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, ctx, next) {" +
        " if (url.split('?')[0].endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };" +
        " return next(url, ctx); }",
    ),
);

/**
 * Een bronbestand met zijn AST en zijn importtabel.
 * @param {string} pad relatief aan design-mockup/, of absoluut
 */
export function leesBron(pad) {
  const vol = isAbsolute(pad) ? pad : join(FRONTEND, pad);
  const tekst = readFileSync(vol, "utf8");
  const ast = ts.createSourceFile(vol, tekst, ts.ScriptTarget.Latest, true,
    vol.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  /** @type {Map<string, { specifier: string, export: string }>} lokale naam → bron */
  const imports = new Map();
  for (const st of ast.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || st.importClause.isTypeOnly) continue;
    const specifier = st.moduleSpecifier.text;
    const c = st.importClause;
    if (c.name) imports.set(c.name.text, { specifier, export: "default" });
    const b = c.namedBindings;
    if (b && ts.isNamespaceImport(b)) imports.set(b.name.text, { specifier, export: "*" });
    if (b && ts.isNamedImports(b)) {
      for (const el of b.elements) {
        if (el.isTypeOnly) continue;
        imports.set(el.name.text, { specifier, export: (el.propertyName ?? el.name).text });
      }
    }
  }
  /** @type {Map<string, ts.Node>} naam → functiedeclaratie of initialisatie op moduleniveau */
  const moduleNiveau = new Map();
  for (const st of ast.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) moduleNiveau.set(st.name.text, st);
    if (ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.Const)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) moduleNiveau.set(d.name.text, d.initializer);
      }
    }
  }
  return { pad: vol, map: dirname(vol), ast, imports, moduleNiveau };
}

function alleKnopen(node, bezoek) {
  const loop = (n) => { bezoek(n); ts.forEachChild(n, loop); };
  loop(node);
}

/** Pak `useCallback(fn, deps)` / `useMemo(fn, deps)` uit tot de functie. */
function zonderHook(init) {
  if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression)
    && /^use(Callback|Memo)$/.test(init.expression.text)) return init.arguments[0];
  return init;
}

/**
 * De initialisatie van `const naam = …`. Bij useCallback/useMemo de functie
 * (bij useMemo dus de FABRIEK: aanroepen geeft de waarde). Precies één.
 */
export function declaratie(bron, naam) {
  const gevonden = [];
  alleKnopen(bron.ast, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === naam && n.initializer) gevonden.push(n.initializer);
  });
  if (gevonden.length !== 1) throw new Error(`${bron.pad}: ${gevonden.length} declaraties van "${naam}", verwacht 1`);
  return zonderHook(gevonden[0]);
}

/** De afhankelijkheden (tweede argument) van `const naam = useCallback/useMemo(…, deps)`. */
export function declaratieDeps(bron, naam) {
  const init = declaratie(bron, naam).parent;
  if (!init || !ts.isCallExpression(init) || !init.arguments[1]) throw new Error(`"${naam}" is geen useCallback/useMemo met afhankelijkheden`);
  return init.arguments[1];
}

/** De state van het bestand: `const [waarde, setWaarde] = useState(…)`, als waarde → setter. */
export function stateVariabelen(bron) {
  const uit = new Map();
  alleKnopen(bron.ast, (n) => {
    if (!ts.isVariableDeclaration(n) || !ts.isArrayBindingPattern(n.name) || !n.initializer) return;
    const init = n.initializer;
    if (!ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "useState") return;
    const [waarde, setter] = n.name.elements;
    if (waarde && setter && ts.isBindingElement(waarde) && ts.isBindingElement(setter)
      && ts.isIdentifier(waarde.name) && ts.isIdentifier(setter.name)) uit.set(waarde.name.text, setter.name.text);
  });
  return uit;
}

/**
 * Naden die useState nabootsen, gezet op `doel`: elke statewaarde leest uit
 * `toestand`, elke setter schrijft erin (ook in de vorm `set(v => …)`). Zo
 * kijkt een test naar de TOESTAND na een effect, niet naar welke setter er
 * toevallig werd aangeroepen. Wat de test zelf al in `doel` zette, gaat voor:
 * een waarde wordt de begintoestand, een eigen setter blijft staan.
 */
export function stateNaden(bron, toestand, doel = {}) {
  for (const [naam, setter] of stateVariabelen(bron)) {
    if (Object.prototype.hasOwnProperty.call(doel, naam)) {
      toestand[naam] = doel[naam];
      delete doel[naam];
    }
    Object.defineProperty(doel, naam, { get: () => toestand[naam], enumerable: true, configurable: true });
    if (!(setter in doel)) doel[setter] = (v) => { toestand[naam] = typeof v === "function" ? v(toestand[naam]) : v; };
  }
  return doel;
}

/**
 * De lokale naam waaronder `bron` de export `exportNaam` uit een module
 * importeert waarvan het pad eindigt op `padEinde` — zodat een test een naad op
 * een import kan zetten zonder de alias uit de broncode over te nemen.
 */
export function importNaam(bron, padEinde, exportNaam) {
  for (const [lokaal, imp] of bron.imports) {
    if (imp.export === exportNaam && imp.specifier.replace(/\.(ts|tsx)$/, "").endsWith(padEinde)) return lokaal;
  }
  throw new Error(`${bron.pad} importeert "${exportNaam}" uit …${padEinde} niet`);
}

/** Het eerste argument van de aanroep `naam(…)` (bijvoorbeeld `useFemStore({…})`). Precies één. */
export function argumentVan(bron, naam, index = 0) {
  const gevonden = [];
  alleKnopen(bron.ast, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === naam) gevonden.push(n.arguments[index]);
  });
  if (gevonden.length !== 1) throw new Error(`${bron.pad}: ${gevonden.length} aanroepen van "${naam}", verwacht 1`);
  return gevonden[0];
}

/**
 * Het effect (`useEffect(body, deps)`) waarvoor `kies({ body, deps })` waar is.
 * Precies één, anders een fout die het aantal noemt.
 */
export function effect(bron, kies) {
  const gevonden = [];
  alleKnopen(bron.ast, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "useEffect") {
      const e = { body: n.arguments[0], deps: n.arguments[1] };
      if (kies(e)) gevonden.push(e);
    }
  });
  if (gevonden.length !== 1) throw new Error(`${bron.pad}: ${gevonden.length} effecten voldoen, verwacht 1`);
  return gevonden[0];
}

/** De uitdrukking van attribuut `attribuut` op JSX-element `tag`. Precies één. */
export function jsxAttribuut(bron, tag, attribuut) {
  const gevonden = [];
  alleKnopen(bron.ast, (n) => {
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(bron.ast) === tag) {
      for (const p of n.attributes.properties) {
        if (ts.isJsxAttribute(p) && p.name.getText(bron.ast) === attribuut && p.initializer) {
          gevonden.push(ts.isJsxExpression(p.initializer) ? p.initializer.expression : p.initializer);
        }
      }
    }
  });
  if (gevonden.length !== 1) throw new Error(`${bron.pad}: ${gevonden.length} keer <${tag} ${attribuut}=…>, verwacht 1`);
  return gevonden[0];
}

/** Komt de naam (identifier of eigenschap) ergens in de knoop voor? Voor `kies` bij `effect`. */
export function noemt(node, naam) {
  let ja = false;
  if (!node) return false;
  alleKnopen(node, (n) => { if (ts.isIdentifier(n) && n.text === naam) ja = true; });
  return ja;
}

/**
 * De namen die de knoop van BUITEN leest: identifiers die geen eigenschapsnaam,
 * geen type en geen eigen declaratie binnen de knoop zijn. Een benadering
 * zonder scopes, ruim genoeg voor een test die er naden bij zoekt.
 */
export function vrijeNamen(node) {
  const gebruikt = new Set();
  const eigen = new Set();
  const inType = (n) => { for (let p = n.parent; p && p !== node.parent; p = p.parent) if (ts.isTypeNode(p)) return true; return false; };
  alleKnopen(node, (n) => {
    if (!ts.isIdentifier(n)) return;
    const p = n.parent;
    if (p && (ts.isPropertyAccessExpression(p) && p.name === n)) return;
    if (p && (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p)) && p.name === n) return;
    if (p && (ts.isJsxAttribute(p))) return;
    if (p && ts.isBindingElement(p) && p.propertyName === n) return;
    if (p && (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p)
      || ts.isFunctionExpression(p) || ts.isBindingElement(p) || ts.isClassDeclaration(p)) && p.name === n) {
      eigen.add(n.text);
      return;
    }
    if (inType(n)) return;
    gebruikt.add(n.text);
  });
  return [...gebruikt].filter((n) => !eigen.has(n));
}

/**
 * Een eigen merkteken per vrije naam van de knoop (behalve globale namen en
 * `behalve`): naden voor een stuk dat waarden alleen DOORGEEFT. Daarna is te
 * zien welke waarde waar terechtkwam, zonder de lokale namen over te nemen.
 */
export function merktekenNaden(knoop, behalve = []) {
  const naden = {};
  for (const naam of vrijeNamen(knoop)) {
    if (!(naam in globalThis) && !behalve.includes(naam)) naden[naam] = { merkteken: naam };
  }
  return naden;
}

/** Een relatief importpad opgelost tot een bestaand bestand. */
function losOp(map, specifier) {
  if (!specifier.startsWith(".")) return null;
  const basis = resolve(map, specifier);
  for (const kandidaat of [basis, `${basis}.ts`, `${basis}.tsx`, `${basis}.js`, `${basis}.mjs`,
    join(basis, "index.ts"), join(basis, "index.tsx")]) {
    if (existsSync(kandidaat) && statSync(kandidaat).isFile()) return kandidaat;
  }
  throw new Error(`import "${specifier}" vanuit ${map} niet gevonden`);
}

async function laadModule(bron, specifier) {
  const pad = losOp(bron.map, specifier);
  return import(pad ? pathToFileURL(pad).href : specifier);
}

/**
 * Globale namen uit DEZE realm. Een Map die in de vm wordt gemaakt, moet
 * dezelfde Map zijn als die van de echte modules en van de test (`instanceof`).
 */
const GLOBALEN = {
  Map, Set, WeakMap, WeakSet, Promise, Error, TypeError, RangeError, Date, Math, JSON, Number, String,
  Boolean, Array, Object, Symbol, BigInt, RegExp, Infinity, NaN, isFinite, isNaN, parseFloat, parseInt,
  console, performance, setTimeout, clearTimeout, queueMicrotask, structuredClone,
  Float64Array, Int32Array, Uint8Array,
};

/**
 * Maak `naden` tot de context waarin stukken uit `bron` draaien. Het object
 * blijft levend: wat de test er later in zet of in wijzigt, ziet het stuk.
 * Vult aan (alleen waar de test zelf niets gaf): globale namen van deze realm,
 * de echte imports en de declaraties op moduleniveau die `knopen` gebruiken
 * (ook wat die op hun beurt gebruiken), en `dynamischeImport`.
 */
export async function context(bron, naden, knopen = []) {
  for (const [k, v] of Object.entries(GLOBALEN)) if (!(k in naden)) naden[k] = v;
  if (!("dynamischeImport" in naden)) naden.dynamischeImport = (specifier) => laadModule(bron, specifier);
  const ctx = vm.isContext(naden) ? naden : vm.createContext(naden);
  const bezig = new Set();
  const voorzie = async (knoop) => {
    for (const naam of vrijeNamen(knoop)) {
      if (naam in naden || bezig.has(naam)) continue;
      bezig.add(naam);
      const imp = bron.imports.get(naam);
      const lokaal = bron.moduleNiveau.get(naam);
      try {
        if (imp) {
          const mod = await laadModule(bron, imp.specifier);
          naden[naam] = imp.export === "*" ? mod : mod[imp.export];
        } else if (lokaal) {
          // Eerst wat de declaratie zelf nodig heeft: een constante wordt
          // meteen uitgerekend.
          await voorzie(lokaal);
          naden[naam] = evalueer(lokaal, ctx);
        }
      } catch {
        // Niet te laden of uit te rekenen buiten de app (Tauri, DOM): de naam
        // blijft weg, en gebruik ervan geeft "… is not defined" — de test
        // geeft dan een naad.
      }
    }
  };
  for (const knoop of knopen) await voorzie(knoop);
  return ctx;
}

/** `import(x)` → `dynamischeImport(x)`, in de AST (niet in de tekst). */
const dynamischeImportOmzetten = (tctx) => (bestand) => {
  const bezoek = (n) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return ts.factory.createCallExpression(
        ts.factory.createIdentifier("dynamischeImport"), undefined,
        ts.visitNodes(n.arguments, bezoek));
    }
    return ts.visitEachChild(n, bezoek, tctx);
  };
  return ts.visitNode(bestand, bezoek);
};

/**
 * Voer de knoop uit in `ctx` (van `context`) en geef de waarde. Een uitdrukking,
 * of een functiedeclaratie (die wordt een functie-uitdrukking).
 */
export function evalueer(knoop, ctx) {
  const tekst = ts.isFunctionDeclaration(knoop)
    ? knoop.getText().replace(/^export\s+(default\s+)?/, "")
    : knoop.getText();
  const uit = ts.transpileModule(`(${tekst})`, {
    fileName: "stuk.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
    transformers: { before: [dynamischeImportOmzetten] },
  }).outputText;
  return vm.runInContext(uit, ctx);
}

/** Kort: context maken en één knoop evalueren. */
export async function voerUitIn(bron, knoop, naden) {
  return evalueer(knoop, await context(bron, naden, [knoop]));
}
