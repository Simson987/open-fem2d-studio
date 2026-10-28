// Voer de echte App-callbacks uit; alleen I/O en React-setters zijn testnaden.
//
// De callbacks, effecten en JSX-attributen worden in de AST van App.tsx
// opgezocht en uitgevoerd (scripts/bron-uitvoeren.mjs). Er wordt geen
// broncodetekst vergeleken of vervangen: een dynamische `import()` wordt in de
// AST omgezet naar de naad `dynamischeImport`, en alles wat App.tsx importeert
// en hier geen naad heeft, komt uit de echte module.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { context, declaratie, effect, evalueer, jsxAttribuut, leesBron, noemt } from './scripts/bron-uitvoeren.mjs';

const app = leesBron('src/App.tsx');
/** De echte callback `naam` uit App.tsx, uitgevoerd met de naden in `naden`. */
async function callback(naam, naden) {
  const knoop = declaratie(app, naam);
  return evalueer(knoop, await context(app, naden, [knoop]));
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
test('Berekenen vanuit Model maakt de resultaten zichtbaar', async () => {
  const state = { view: 'report', tree: 'project', results: false, showLoads: false,
    flags: { M: false, V: false, N: false, deflection: false, reactions: false, uc: false, schaalM: 2 },
    selection: { type: 'beam', id: 6 }, runs: 0 };
  const handleSolve = await callback('handleSolve', {
    modelDimension: '2d',
    normaliseSolverPreference: value => value,
    getSetting: async (_key, fallback) => fallback,
    SOLVER_PREFERENCE_KEY: 'solverPreference',
    resolveSolver: () => ({}),
    setActiveView: value => { state.view = value; },
    setTreeTab: value => { state.tree = value; },
    setResultsTabActive: value => { state.results = value; },
    setDisplayFlags: update => { state.flags = update(state.flags); },
    fem: { analysetype: 'eersteOrde', plates: [], setShowLoads: value => { state.showLoads = value; }, setSelection: value => { state.selection = value; } },
    rekenDoor: async () => { state.runs++; },
  });
  await handleSolve();
  assert.equal(state.showLoads, true, 'de algemene zichtbaarheid moet na de Model-tab weer aan');
  assert.equal(state.view, 'default');
  assert.equal(state.tree, 'results');
  assert.equal(state.results, true);
  for (const key of ['M', 'V', 'N', 'deflection', 'reactions', 'uc']) assert.equal(state.flags[key], true, key);
  assert.equal(state.flags.schaalM, 2, 'bestaande weergave-instellingen behouden');
  assert.equal(state.selection, null);
  assert.equal(state.runs, 1);
});
test('betonvenster krijgt alleen de actuele afgeronde combinatieresultaten', async () => {
  const expression = jsxAttribuut(app, 'BetonStaafVenster', 'actueleCombinatieResultaten');
  const outputs = new Map();
  for (const kind of ['idle', 'rekenen', 'error', 'solved']) {
    const value = evalueer(expression, await context(app, { solverStatus: { kind }, fem: { combinationResults: outputs } }, [expression]));
    assert.equal(value, kind === 'solved' ? outputs : null);
  }
});
const tick = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
async function fixture(seam, fails) {
  const barrier = deferred();
  let calls=0;
  const events=[];
  const ref = current => ({current});
  const write = name => value => events.push([name, value]);
  const pause = async (name, value) => {
    if(name===seam && calls++ === 0) { await barrier.promise; if(fails) throw new Error('oude fout'); }
    return value;
  };
  const outputs = () => ({ perCase:new Map(), combinationResults:new Map(), envelope:{} });
  const c = {
    console:{warn(){}}, Map, Set, Date, Error, Promise,
    modelDimension:'2d',
    normaliseSolverPreference:value=>value,
    getSetting:async (_key,fallback)=>fallback,
    SOLVER_PREFERENCE_KEY:'solverPreference',
    rekenGeneratieRef:ref(0), lopendeRekengangenRef:ref(0), volledigeRekengangRef:ref(null),
    liveRekenenRef:ref(false), rekenFoutRef:ref(null), laatsteMultiInputRef:ref({snapshot:true}),
    herberekeningGeplandRef:ref(false), herberekenTimerRef:ref(null), rapportRekenPogingRef:ref(false),
    window:{clearTimeout(){}},
    setSolveTrigger(){}, setSolverStatus:write('status'), setSolverErrorText:write('error'),
    setStabiliteitsMelding:write('stabilityMessage'), checkClear:write('clearChecks'),
    stijfheidClear:write('clearTrace'), stijfheidZet:write('trace'),
    computeAndStoreSolverOutputs:outputs, leesbareRekenfout:e=>e.message,
    fem:{ analysetype:'tweedeOrdeFysisch', nodes:[], beams:[], supports:[], plates:[],
      actieveCombinaties:[{id:1,type:'uls',name:'UGT'}], setSolverOutputs:write('outputs') },
    // De enige dynamische import in deze rekengang; elke andere is een nieuwe
    // afhankelijkheid die deze test moet kennen.
    dynamischeImport:(specifier)=>{
      if(specifier==='./io/notify') return c.notifyImport();
      throw new Error(`onverwachte dynamische import ${specifier}`);
    },
    notifyImport:()=>pause('notify', {notifyInfo:write('info'),notifyWarning:write('warning')}),
    i18next:{t:x=>x}, roepKern:()=>pause('kernel', {}),
    bepaalKruipPerStaaf:()=>pause('creep',{mislukt:[]}), kruipWaardenPerStaaf:()=>new Map(),
    bepaalBeffPerStaaf:()=>pause('beff',new Map()), bEffWaardenPerStaaf:x=>x,
    betonStavenUitModel:()=>({staven:[{}],overgeslagen:[]}),
    bijlageVanProject:()=> 'NL', schatVrijheidsgraden:()=>1, segmentWaarschuwing:()=>null,
    getSecondOrderInput:()=>({snapshot:true}), belastingduurVanCombinatie:()=>({duur:'ShortTerm',reden:''}),
    losCombinatieFysischOp: async (_input,_combo,_staven, opts) => {
      if(seam==='kernel') await (opts.roep ?? c.roepKern)('segment');
      return pause('physical',{zonderKruipcoefficient:[],resultaat:{},ronden:1,geschiedenis:[],laatsteRonde:new Map()});
    },
    zetCombinatieResultaat:write('cache'), combineResults:()=>({}), computeEnvelope:()=>({}),
    bepaalStabiliteit:()=>{events.push(['stability']); return [];},
    handleRunMemberChecks:()=>pause('checks',undefined).then(()=>{}),
    // α_cr van de resultaten na de toets (issue #199): hier een naad; het
    // gedrag zelf staat in de test "α_cr één keer per rekengang" hieronder.
    vulStabiliteitAan:()=>{},
  };
  // De lus zelf is een eigen callback (gedeeld met de toets, issue #199); hij
  // draait hier echt, met de naden hierboven.
  c.fysischeLus = await callback('fysischeLus', c);
  c.rekenFysischNietlineair = await callback('rekenFysischNietlineair', c);
  const run = await callback('rekenDoor', c);
  return { c,events,barrier,run };
}
for (const seam of ['notify','creep','beff','physical','kernel','checks']) {
  for (const fails of [false,true]) test(`oude ${seam} ${fails?'fout':'succes'} schrijft niet na nieuwe rekengang`, async()=>{
    const f=await fixture(seam,fails);
    const a=f.run(); await tick();
    const b=await f.run(); assert.equal(b.gelukt,true, JSON.stringify(f.events));
    const completed=f.c.volledigeRekengangRef.current;
    const count=f.events.length;
    f.barrier.resolve();
    const old=await a;
    assert.equal(old.gelukt,false,'verouderde rekengang mag geen succes melden');
    assert.equal(f.events.length,count,'geen oude status, outputs, cache, spoor, checks of toast');
    assert.equal(f.c.volledigeRekengangRef.current,completed);
    assert.equal(f.c.lopendeRekengangenRef.current,0);
  });
}
test('modelwijziging zonder nieuwe solve verwerpt fysische uitkomst',async()=>{
  const f=await fixture('physical',false); const a=f.run(); await tick();
  f.c.rekenGeneratieRef.current++; const count=f.events.length;
  f.barrier.resolve(); assert.equal((await a).gelukt,false);
  assert.equal(f.events.length,count);
});
test('actuele kernfout wist solverresultaten en voltooiingsbewijs',async()=>{
  const f=await fixture('beff',true); f.c.volledigeRekengangRef.current=new Map();
  const a=f.run(); await tick(); f.barrier.resolve();
  assert.equal((await a).gelukt,false);
  assert.ok(f.events.some(([name,value])=>name==='outputs' && value===null));
  assert.equal(f.c.volledigeRekengangRef.current,null);
});

test('verse voltooide rekengang is in rust terwijl oude kernpromise nog hangt',async()=>{
  const f=await fixture('physical',false);
  const a=f.run(); await tick();
  assert.equal((await f.run()).gelukt,true);
  assert.ok(f.c.volledigeRekengangRef.current);
  assert.equal(f.c.lopendeRekengangenRef.current,0,'oude run mag export niet blokkeren');
  f.barrier.resolve(); await a;
  assert.equal(f.c.lopendeRekengangenRef.current,0,'oude finally mag teller niet negatief maken');
});

test('rekenDoor geeft een belofte die pas na de toetsing inlost, met de uitkomst', async()=>{
  // Het bedieningskanaal (`rekenen`) en een export naar PDF wachten hierop:
  // de belofte mag niet inlossen voordat de toetsing klaar is.
  const f=await fixture('checks',false);
  const gang=f.run();
  assert.equal(typeof gang.then,'function','rekenDoor geeft een belofte');
  let klaar=false; void gang.then(()=>{klaar=true;});
  await tick();
  assert.equal(klaar,false,'nog niet ingelost zolang de toetsing loopt');
  f.barrier.resolve();
  const uitkomst=await gang;
  assert.equal(uitkomst.gelukt,true);
  assert.equal(typeof uitkomst.fysisch,'string','de uitkomst zegt wat de fysisch niet-lineaire ronde deed');
});

/** Het rapport-effect: het effect dat bij de rapportweergave zelf doorrekent. */
async function reportEffect(naden) {
  const { body, deps } = effect(app, (e) => noemt(e.body, 'rapportRekenPogingRef') && noemt(e.body, 'activeView'));
  const ctx = await context(app, naden, [body, deps]);
  const run = evalueer(body, ctx);
  run.dependencies = () => evalueer(deps, ctx);
  return run;
}
test('open rapport probeert fysieke fout niet opnieuw; nieuw model mag wel',async()=>{
  const f=await fixture('physical',true);
  f.c.activeView='report';f.c.fem.combinationResults=null;
  let starts=0, pending;
  f.c.rekenDoorRef={current:()=>{starts++;pending=f.run();return pending;}};
  const effect=await reportEffect(f.c);
  effect();await tick();
  f.c.fem.combinationResults=new Map();effect();
  f.barrier.resolve();await pending;
  f.c.fem.combinationResults=null;effect();
  assert.equal(starts,1,'geen automatische lus na wissen van de voorronde');
  f.c.rekenGeneratieRef.current++;f.c.rapportRekenPogingRef.current=false;f.c.rekenFoutRef.current=null;
  effect();await pending;assert.equal(starts,2,'gewijzigd model krijgt nieuwe poging');
});

test('oude import vóór checkRun start geen nieuwe toetsgeneratie',async()=>{
  const f=await fixture('notify',false);let checks=0;
  Object.assign(f.c,{anyCheckableBeams:()=>true,anyCheckablePlates:()=>false,
    eersteOrdeResultatenVoorKolomtoets:()=>undefined,checkRun:async()=>{checks++;}});
  const run=await callback('handleRunMemberChecks',f.c);
  const a=run({openPanel:false,outputs:{combinationResults:new Map(),perCase:new Map()}});
  await tick();f.c.rekenGeneratieRef.current++;
  f.barrier.resolve();await a;assert.equal(checks,0);
});

// ── De toetskrachten (issue #199): de UGT-toets rekent altijd zelf tweede orde
// met scheefstand, op de invoer en de resultaten van DEZELFDE rekengang; de BGT
// komt uit die resultaten. Het bedieningscommando `toetsen` roept
// handleRunMemberChecks zonder uitkomst aan; zijn er dan geen resultaten, dan
// rekent het zelf door. α_cr komt uit de toetsrekengang zelf, nooit uit de
// closure (`fem.stabiliteit`, van een vorig model of van de resultaten).
const UGT = { id: 1, type: 'uls', name: 'UGT', factors: new Map([[1, 1.35]]) };
const BGT = { id: 2, type: 'sls', name: 'BGT', factors: new Map([[1, 1]]) };
const OUD = [{ combinatieId: 1, alphaCr: 3.1, bron: 'oud' }];
const TOETS_ALPHA = [{ combinatieId: 1, alphaCr: 7.4, bron: 'toets' }];
const TOETS_ANALYSE = { soort: 'tweedeOrdeGeometrisch', phi: 1 / 200, noemer: 200, bron: 'vast',
  scheefstandModelAan: false, hergebruikt: false };
/** Een uitkomst van `bepaalToetsKrachten2D` in de vorm van het echte antwoord. */
const toetsUitkomst = (extra = {}) => ({
  analyse: TOETS_ANALYSE, perCase: new Map(), ugtCombinaties: [UGT],
  combinationResults: new Map([[1, { toetskracht: 1 }]]), alphaCr: TOETS_ALPHA, weigering: null, meldingen: [],
  ...extra,
});
async function toetsing({ opgeslagen, vers, meegegeven, toets = toetsUitkomst(), analysetype = 'tweedeOrdeGeometrisch', naden = {}, voorRun }) {
  let data = null;
  const invoer = [];
  const geweigerd = [];
  const f = await fixture('none', false);
  const LAATSTE = { laatsteRekengang: true };
  f.c.laatsteMultiInputRef.current = LAATSTE;
  Object.assign(f.c, {
    anyCheckableBeams: () => true, anyCheckablePlates: () => false, setActiveView() {},
    checkRun: async (d) => { data = d; }, checkWeiger: (r) => { geweigerd.push(r); },
    gemeldeWeigeringRef: { current: null },
    scheefstandUitkomst: { phi: 1 / 200, noemer: 200, bron: 'vast', hoogteM: 3, aantalElementen: 1 },
    computeAndStoreSolverOutputs: () => vers,
    bepaalToetsKrachten2D: (i) => { invoer.push(i); return toets; },
    rekenToetsFysisch: async () => { throw new Error('alleen bij tweedeOrdeFysisch'); },
    ...naden,
  });
  Object.assign(f.c.fem, {
    analysetype, scheefstandEnabled: false, scheefstandRichting: 1, stabiliteit: OUD,
    actieveCombinaties: [UGT, BGT],
    combinationResults: opgeslagen ? new Map([[1, { resultaat: 1 }], [2, { resultaat: 2 }]]) : null,
    multiLcResult: opgeslagen ? new Map() : null,
  });
  voorRun?.(f);
  const run = await callback('handleRunMemberChecks', f.c);
  await run(meegegeven === undefined ? { openPanel: false } : { openPanel: false, outputs: meegegeven });
  return { data, invoer: invoer[0], geweigerd, LAATSTE, f };
}
test('API-pad zonder resultaten: de toets rekent op de verse doorrekening', async () => {
  const VERS_INVOER = { vers: true };
  const vers = { perCase: new Map(), combinationResults: new Map([[1, {}], [2, { bgt: true }]]), envelope: {},
    stabiliteit: [{ combinatieId: 1, alphaCr: 2.2, bron: 'resultaten' }], multiInput: VERS_INVOER };
  const { data, invoer } = await toetsing({ opgeslagen: false, vers });
  assert.ok(data, 'de toetsing is gestart');
  assert.equal(invoer.basis, VERS_INVOER, 'de toets rekent op de invoer van de verse doorrekening');
  assert.equal(invoer.resultaten.combinationResults, vers.combinationResults, '… en kan alleen díe resultaten hergebruiken');
  assert.equal(invoer.resultaten.perCase, vers.perCase);
  assert.equal(data.resultaten, vers.combinationResults, 'de toetsing hoort bij de verse resultaten');
  assert.equal(data.combinationResults.get(1).toetskracht, 1, 'UGT uit de toets');
  assert.equal(data.combinationResults.get(2), vers.combinationResults.get(2), 'BGT uit de resultaten (B6)');
  assert.equal(data.stabiliteit.alphaCr, TOETS_ALPHA, 'α_cr van de toetsrekengang, niet van de resultaten of de closure');
  assert.deepEqual({ ...data.stabiliteit, alphaCr: null },
    { analysetype: 'tweedeOrdeGeometrisch', alphaCr: null, scheefstandAan: true, scheefstandPhi: 1 / 200 });
});
test('API-pad met resultaten in de store: de toets rekent op de laatste rekengang', async () => {
  const { data, invoer, LAATSTE, f } = await toetsing({ opgeslagen: true, vers: null });
  assert.equal(invoer.basis, LAATSTE, 'de invoer van de rekengang waaruit de resultaten komen');
  assert.equal(invoer.resultaten.combinationResults, f.c.fem.combinationResults);
  assert.equal(data.stabiliteit.alphaCr, TOETS_ALPHA, 'niet de α_cr uit de closure');
  assert.equal(data.resultaten, f.c.fem.combinationResults);
});
test('meegegeven uitkomst: de toets rekent op haar invoer en haar resultaten', async () => {
  const EIGEN = { eigen: true };
  const meegegeven = { perCase: new Map(), combinationResults: new Map([[1, {}], [2, {}]]), multiInput: EIGEN };
  const { data, invoer } = await toetsing({ opgeslagen: true, vers: null, meegegeven });
  assert.equal(invoer.basis, EIGEN);
  assert.equal(invoer.resultaten.combinationResults, meegegeven.combinationResults);
  assert.equal(data.resultaten, meegegeven.combinationResults);
  assert.equal(data.stabiliteit.alphaCr, TOETS_ALPHA);
});
test('instellingen van het model gaan als scheefstand mee; de toets-φ volgt de projectinstelling', async () => {
  const { invoer } = await toetsing({ opgeslagen: true, vers: null });
  assert.equal(invoer.scheefstand.modelAan, false, 'de schakelaar geldt alleen voor de resultaten');
  assert.equal(invoer.scheefstand.richting, 1);
  assert.equal(invoer.scheefstand.project.noemer, 200);
  assert.equal(invoer.analysetype, 'tweedeOrdeGeometrisch');
});
test('een geweigerde toets: geen toetsing, de reden in de toetsing, de resultaten blijven (B7)', async () => {
  const weigering = { reden: 'De toetskrachten zijn niet te bepalen.', perCombinatie: [{ id: 1, naam: 'UGT', reden: 'niet convergent' }] };
  const { data, geweigerd, f } = await toetsing({ opgeslagen: true, vers: null,
    toets: toetsUitkomst({ weigering, combinationResults: new Map() }) });
  assert.equal(data, null, 'geen toetsronde');
  assert.equal(geweigerd.length, 1);
  assert.ok(geweigerd[0].includes('De toetskrachten zijn niet te bepalen.') && geweigerd[0].includes('UGT: niet convergent'), geweigerd[0]);
  assert.ok(f.events.some(([n, v]) => n === 'warning' && v === 'common:app.check.refused'), 'met een melding');
  assert.ok(!f.events.some(([n, v]) => n === 'outputs' && v === null), 'de resultaten worden niet gewist');
  assert.ok(f.c.fem.combinationResults instanceof Map);
});
test('dezelfde weigering bij elke live herberekening: één melding, de reden staat wel elke keer in de toetsing', async () => {
  const gemeld = { current: null };
  const weigering = (reden) => toetsUitkomst({ weigering: { reden, perCombinatie: [] }, combinationResults: new Map() });
  const ronde = async (toets) => {
    const { f, geweigerd } = await toetsing({ opgeslagen: true, vers: null, toets, naden: { gemeldeWeigeringRef: gemeld } });
    return { meldingen: f.events.filter(([n, v]) => n === 'warning' && v === 'common:app.check.refused').length, geweigerd };
  };
  assert.deepEqual(await ronde(weigering('A')), { meldingen: 1, geweigerd: ['A'] });
  assert.deepEqual(await ronde(weigering('A')), { meldingen: 0, geweigerd: ['A'] }, 'dezelfde reden: wel geweigerd, geen nieuwe melding');
  assert.equal((await ronde(weigering('B'))).meldingen, 1, 'een andere reden wel');
  assert.equal((await ronde(toetsUitkomst())).meldingen, 0, 'een geslaagde toets');
  assert.equal((await ronde(weigering('B'))).meldingen, 1, 'na een geslaagde toets is dezelfde weigering weer nieuws');
});
test('tweedeOrdeFysisch: de betonronde draait op de toetsset, niet op de resultaten (B11)', async () => {
  const fysischeToets = toetsUitkomst({ analyse: { ...TOETS_ANALYSE, soort: 'tweedeOrdeFysisch' } });
  const rondes = [];
  const NA_RONDE = { naRonde: true };
  const { data, invoer, f } = await toetsing({ opgeslagen: true, vers: null, toets: fysischeToets, analysetype: 'tweedeOrdeFysisch',
    naden: {
      rekenToetsFysisch: async (t, r, g) => { rondes.push({ t, r, g }); return null; },
      combineResults: (c, perCase) => (perCase === fysischeToets.perCase && c.id === 1 ? NA_RONDE : null),
    } });
  assert.equal(invoer.resultaten, undefined, 'resultaten zonder ronde (het API-pad) worden niet hergebruikt');
  assert.equal(rondes.length, 1, 'de ronde van de toets draaide');
  assert.equal(rondes[0].t, fysischeToets, '… op de toetsrekengang');
  assert.equal(rondes[0].r.combinationResults, f.c.fem.combinationResults, 'M₀Eqp uit de resultaten');
  assert.equal(data.combinationResults.get(1), NA_RONDE, 'de toetskrachten na de ronde, uit de cache van de toets');
  assert.equal(data.stabiliteit.analysetype, 'tweedeOrdeFysisch');
});
test('tweedeOrdeFysisch na de volledige rekengang: hergebruik zonder tweede ronde', async () => {
  const hergebruikt = toetsUitkomst({ analyse: { ...TOETS_ANALYSE, soort: 'tweedeOrdeFysisch', hergebruikt: true } });
  let rondes = 0;
  const meegegeven = { perCase: new Map(), combinationResults: new Map([[1, {}], [2, {}]]), multiInput: {}, fysischeRondeGehad: true };
  const { data, invoer } = await toetsing({ opgeslagen: true, vers: null, meegegeven, toets: hergebruikt, analysetype: 'tweedeOrdeFysisch',
    naden: { rekenToetsFysisch: async () => { rondes++; return null; } } });
  assert.equal(invoer.resultaten.combinationResults, meegegeven.combinationResults, 'de resultaten mét ronde mogen hergebruikt worden');
  assert.equal(rondes, 0, 'geen tweede ronde: de resultaten hadden hem al');
  assert.ok(data);
});
test('API-pad (toetsen) bij tweedeOrdeFysisch: de resultaten van de laatste volledige rekengang hergebruiken', async () => {
  // Het bedieningscommando `toetsen` geeft geen uitkomst mee. Zijn de
  // resultaten in de store die van de laatste VOLTOOIDE rekenDoor (hetzelfde
  // object), dan hadden ze de fysische ronde al: hergebruik, geen P-Δ en geen
  // ronde opnieuw. Vroeger was `fysischeRondeGehad` hier altijd false.
  const hergebruikt = toetsUitkomst({ analyse: { ...TOETS_ANALYSE, soort: 'tweedeOrdeFysisch', hergebruikt: true } });
  let rondes = 0;
  const { invoer, f } = await toetsing({ opgeslagen: true, vers: null, toets: hergebruikt, analysetype: 'tweedeOrdeFysisch',
    naden: { rekenToetsFysisch: async () => { rondes++; return null; } },
    voorRun: (f) => { f.c.volledigeRekengangRef.current = f.c.fem.combinationResults; } });
  assert.equal(invoer.resultaten?.combinationResults, f.c.fem.combinationResults, 'de resultaten uit de store mogen hergebruikt worden');
  assert.equal(rondes, 0, 'geen tweede ronde');
  // Andere resultaten dan die van de laatste volledige rekengang: niet.
  const { invoer: ander } = await toetsing({ opgeslagen: true, vers: null, analysetype: 'tweedeOrdeFysisch',
    naden: { rekenToetsFysisch: async () => null },
    voorRun: (f) => { f.c.volledigeRekengangRef.current = new Map(); } });
  assert.equal(ander.resultaten, undefined, 'zonder bewijs van de ronde rekent de toets zelf');
});
test('tweedeOrdeFysisch: loopt de ronde van de toets vast, dan alleen de toets weg', async () => {
  const fysischeToets = toetsUitkomst({ analyse: { ...TOETS_ANALYSE, soort: 'tweedeOrdeFysisch' } });
  const { data, geweigerd, f } = await toetsing({ opgeslagen: true, vers: null, toets: fysischeToets, analysetype: 'tweedeOrdeFysisch',
    naden: { rekenToetsFysisch: async () => 'segment 3 zonder stijfheid' } });
  assert.equal(data, null);
  assert.equal(geweigerd.length, 1);
  assert.equal(geweigerd[0], 'common:app.check.refusedNonlinear', 'de vertaalde reden (i18n is hier een naad)');
  assert.ok(!f.events.some(([n, v]) => n === 'outputs' && v === null), 'de resultaten blijven');
});

test('rekenDoor: alleen na de fysisch niet-lineaire ronde mag de toets de resultaten hergebruiken', async () => {
  const f = await fixture('none', false);
  const gegeven = [];
  f.c.handleRunMemberChecks = async (o) => { gegeven.push(o); };
  assert.equal((await f.run()).gelukt, true);
  assert.equal(gegeven[0].outputs.fysischeRondeGehad, true, 'tweedeOrdeFysisch: de resultaten hadden de ronde');
  f.c.fem.analysetype = 'tweedeOrdeGeometrisch';
  assert.equal((await f.run()).gelukt, true);
  assert.notEqual(gegeven[1].outputs.fysischeRondeGehad, true, 'zonder ronde zegt de rekengang dat ook niet');
});

// ── α_cr één keer per rekengang (issue #199) ──
// De toets bepaalt α_cr zelf (bij hergebruik op precies de invoer en krachten
// van de resultaten). `rekenDoor` vraagt de resultaten daarom zonder α_cr, en
// vult die van de resultaten pas aan als de toets er geen opleverde. Tot
// oktober 2026 deed elke rekengang dezelfde bisectie twee keer, synchroon op
// de UI-thread (seconden bij een portaal van 170 staven).
test('rekenDoor: de resultaten zonder α_cr, daarna aanvullen na de toets', async () => {
  const f = await fixture('none', false);
  const opties = [];
  const aangevuld = [];
  f.c.computeAndStoreSolverOutputs = (o) => { opties.push(o); return { perCase: new Map(), combinationResults: new Map(), envelope: {} }; };
  f.c.vulStabiliteitAan = (o) => { aangevuld.push(o); };
  f.c.fem.analysetype = 'tweedeOrdeGeometrisch';
  const run = await callback('rekenDoor', f.c);
  assert.equal((await run()).gelukt, true);
  assert.equal(opties[0]?.stabiliteitLater, true, 'de resultaten zonder α_cr');
  assert.equal(aangevuld.length, 1, 'na de toets één keer aanvullen (die kijkt zelf of het nodig is)');
  assert.ok(!f.events.some(([n]) => n === 'stability'), 'geen α_cr-bepaling in rekenDoor zelf');
});
test('vulStabiliteitAan: alleen zonder α_cr van de toets', async () => {
  const { useCheckStore } = await import('./src/stores/checkStore.ts');
  let bepaald = 0;
  const gezet = [];
  const vul = await callback('vulStabiliteitAan', {
    fem: { setSolverOutputs: (o) => gezet.push(o) },
    laatsteMultiInputRef: { current: { invoer: true } },
    bepaalStabiliteit: () => { bepaald++; return [{ combinatieId: 1 }]; },
  });
  const uit = { perCase: new Map(), combinationResults: new Map(), envelope: {} };
  useCheckStore.setState({ toets: { analyse: {}, meldingen: [], alphaCr: [{ combinatieId: 1 }], weigering: null } });
  vul(uit);
  assert.equal(bepaald, 0, 'de toets had α_cr: niets opnieuw bepalen');
  assert.equal(gezet.length, 0);
  useCheckStore.setState({ toets: null });
  vul(uit);
  assert.equal(bepaald, 1, 'geen toets (bijvoorbeeld geen toetsbare staven): α_cr van de resultaten');
  assert.equal(gezet[0].stabiliteit[0].combinatieId, 1);
  assert.equal(gezet[0].combinationResults, uit.combinationResults, 'dezelfde resultaten, alleen α_cr erbij');
});

// ── De ronde van de toets zelf: dezelfde lus, op de toetsrekengang ──
test('rekenToetsFysisch: de lus op de toetsrekengang, M₀Eqp uit de resultaten', async () => {
  const f = await fixture('none', false);
  const gezien = [];
  const TOETS_INVOER = { toets: true };
  const toetsPerCase = new Map();
  const toets = toetsUitkomst({ perCase: toetsPerCase });
  const resultaten = { perCase: new Map(), combinationResults: new Map([[2, { qp: true }]]) };
  Object.assign(f.c, {
    getSecondOrderInput: (p) => (p === toetsPerCase ? TOETS_INVOER : undefined),
    fysischeLus: async (o) => { gezien.push(o); return { spoor: [], zonderKruip: new Set() }; },
  });
  f.c.fem.actieveCombinaties = [UGT, BGT];
  const ronde = await callback('rekenToetsFysisch', f.c);
  assert.equal(await ronde(toets, resultaten, f.c.rekenGeneratieRef.current), null, 'gelukt: geen reden');
  assert.equal(gezien.length, 1);
  assert.equal(gezien[0].perCase, toetsPerCase, 'de uitkomst landt in de cache van de toets');
  assert.equal(gezien[0].input, TOETS_INVOER, 'met de invoer van de toets (de toets-φ)');
  assert.equal(gezien[0].combinaties, toets.ugtCombinaties, 'alleen de UGT-toetscombinaties');
  assert.equal(gezien[0].quasiBlijvendCombinaties, f.c.fem.actieveCombinaties);
  assert.equal(gezien[0].losQuasiBlijvend(TOETS_INVOER, BGT), resultaten.combinationResults.get(2),
    'M₀Eqp: eerste-orde-resultaten zijn zelf de eerste orde');
  f.c.fysischeLus = async () => { throw new Error('ronde 4 niet geconvergeerd'); };
  const misluktRonde = await callback('rekenToetsFysisch', f.c);
  assert.equal(await misluktRonde(toets, resultaten, f.c.rekenGeneratieRef.current), 'ronde 4 niet geconvergeerd');
  f.c.betonStavenUitModel = () => ({ staven: [], overgeslagen: [] });
  const leeg = await callback('rekenToetsFysisch', f.c);
  assert.equal(await leeg(toets, resultaten, f.c.rekenGeneratieRef.current), null, 'geen betonstaaf: niets te doen');
});

test('rapport herstart na modelwijziging ook als de synchrone eerste poging faalde',async()=>{
  const f=await fixture('none',false);let starts=0,pending;
  f.c.activeView='report';f.c.fem.combinationResults=null;
  f.c.computeAndStoreSolverOutputs=()=>null;
  f.c.rekenDoorRef={current:()=>{starts++;pending=f.run();return pending;}};
  const effect=await reportEffect(f.c);effect();await pending;
  assert.equal(f.c.liveRekenenRef.current,false);
  const before=effect.dependencies();
  f.c.fem.supports=[{nodeId:1,type:'fixed'}];
  f.c.rapportRekenPogingRef.current=false;f.c.rekenGeneratieRef.current++;
  if(effect.dependencies().some((value,i)=>!Object.is(value,before[i])))effect();
  await pending;assert.equal(starts,2,'effect moet ook op modelverandering luisteren');
});

test('pending live-timer wordt door handmatig rekenen geannuleerd',async()=>{
  const f=await fixture('none',false);let cleared;
  f.c.window.clearTimeout=id=>{cleared=id;};f.c.herberekenTimerRef.current=17;
  f.c.herberekeningGeplandRef.current=true;
  await f.run();assert.equal(cleared,17);assert.equal(f.c.herberekeningGeplandRef.current,false);
});

// GEWIJZIGD door issue #199 (B14). Tot 2026.42 gaf `bepaalStabiliteit` bij
// eerste orde met α_cr < 10 een FOUT met een melding op het scherm, en bewaakte
// deze test dat een late melding niet bij een nieuw model kwam. De toets rekent
// nu altijd zelf tweede orde met scheefstand; α_cr is informatief en staat
// alleen in de analysetoelichting. Er is dus geen melding meer, ook niet een
// late: de functie bepaalt α_cr en schrijft niets.
test('bepaalStabiliteit bepaalt α_cr en meldt niets meer (B14)',async()=>{
  const f=await fixture('notify',false);
  const uitkomsten=[{combinatieId:1,naam:'UGT',alphaCr:4.2,status:'bepaald'}];
  Object.assign(f.c,{bepaalAlphaCr:()=>uitkomsten,
    stabiliteitsMeldingen:()=>[{niveau:'fout',tekst:'Stabiliteit'}]});
  const run=await callback('bepaalStabiliteit',f.c);
  const before=f.events.length;
  assert.equal(run({},new Map()),uitkomsten);
  await tick();f.barrier.resolve();await tick();
  assert.equal(f.events.length,before,'geen melding op het scherm en geen foutvak');
});

test('late foutmelding van synchrone voorronde hoort niet bij nieuw model',async()=>{
  const f=await fixture('notify',false);
  Object.assign(f.c,{gemeldeRekenfoutRef:{current:null},controleerVoorRekenen(){throw Error('Model ongeldig');},
    leesSnapInstellingen:()=>({verbindingsTolerantie:5})});
  const run=await callback('computeAndStoreSolverOutputs',f.c);
  assert.equal(run(),null);await tick();f.c.rekenGeneratieRef.current++;
  const before=f.events.length;f.barrier.resolve();await tick();
  assert.equal(f.events.length,before,'geen oude fouttoast');
});

for (const initiallyOpen of [true,false]) test(`sluiten toetsing herstelt eigenschappen alleen indien eerder open=${initiallyOpen}`,async()=>{
  const state={activeView:'default',open:initiallyOpen};
  const c={paneelDoorAppIngeklapt:{current:false},setCheckFocus(){},setActiveView:v=>{state.activeView=v;},
    setRightPanelOpen:v=>{state.open=typeof v==='function'?v(state.open):v;}};
  Object.defineProperty(c,'activeView',{get:()=>state.activeView});
  (await callback('handleOpenCheckForBeam',c))();
  assert.equal(state.open,false);assert.equal(state.activeView,'check');
  const restore=effect(app,(e)=>noemt(e.body,'paneelDoorAppIngeklapt')).body;
  const close=jsxAttribuut(app,'CheckPanel','onClose');
  const ctx=await context(app,c,[close,restore]);
  for(const fn of [close,restore])evalueer(fn,ctx)();
  assert.equal(state.activeView,'default');assert.equal(state.open,initiallyOpen);
});
