// Eigen factoren, bewust gekozen (issue #196) in de echte melding, het echte
// venster Belastinggevallen & combinaties en de echte rapportsectie, in
// Chromium met de echte CSS en thema's.
//
// Het project is het referentieproject P01 (K_FI = 0,9 maal NB tabel NB.4:
// 1,22 / 1,08), geopend zoals de app het opent (`gevolgklasseBijOpenen` en
// `openCombinatieStaat`); de melding komt uit `meldCombinatiesBijOpenen`,
// precies de functie die App.tsx bij het openen aanroept. De knoppen roepen
// `bevestigEigenFactoren` en `trekBevestigingIn` aan, net als de store.
//
// Drie standen, gekozen met de hash van de pagina:
//   (geen hash)        de controles — uitslag als JSON in <pre id="uitslag">;
//   #toon-melding      de melding bij het openen en het venster, vóór de knop;
//   #toon-bevestigd    het venster na "Behoud eigen factoren";
//   #toon-rapport      de rapportsectie na "Behoud eigen factoren".
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import ToastHost from '../src/components/feedback/Toast';
import LoadCasesDialog from '../src/components/fem/LoadCasesDialog';
import CombinationsSection from '../src/components/report/sections/CombinationsSection';
import { EMPTY_REPORT_DATA, ReportDataProvider } from '../src/components/report/ReportDataContext';
import { meldCombinatiesBijOpenen } from '../src/io/combinatieMeldingen';
import { combinationsFromFile, deserializeProject } from '../src/io/projectFile';
import {
  bevestigEigenFactoren, gevolgklasseBijOpenen, meldingenBelastinggevallen, openCombinatieStaat, trekBevestigingIn,
  type CombinatieStaat,
} from '../src/lib/combinatieBeheer';
import P01 from '../referentie-projecten/P01.femp';
import '../src/themes.css';
import '../src/App.css';
import nlCommon from '../src/i18n/locales/nl/common.json';
import nlRibbon from '../src/i18n/locales/nl/ribbon.json';

const box = document.getElementById('root')!;
box.style.cssText = 'width:1280px;min-height:900px;position:relative;background:var(--theme-bg)';
const root = createRoot(box);
const tests: string[] = [], errors: string[] = [];
function ok(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function test(name: string, fn: () => void) { try { fn(); tests.push(name); } catch (e) { errors.push(`${name}: ${e}`); } }
function mount(element: React.ReactNode) { flushSync(() => root.render(element)); }
const noop = () => {};

// P01 geopend zoals de app het opent: geen klasse in het bestand, terugval CC2.
const p = deserializeProject(P01 as unknown as string);
const combinaties = combinationsFromFile(p.combinations);
const { klasse } = gevolgklasseBijOpenen({ bestand: null, combinations: combinaties, terugval: 'CC2' });
const geopend = openCombinatieStaat({ loadCases: p.loadCases, combinations: combinaties, gevolgklasse: klasse, idTellers: p.idTellers });

/** De staat zoals de proef hem nu toont, voor de controles. */
let huidig: CombinatieStaat = geopend.staat;

function Proef({ melden, metRapport, metVenster = true, bevestigd = false }: {
  melden: boolean; metRapport: boolean; metVenster?: boolean; bevestigd?: boolean;
}) {
  const [staat, setStaat] = useState(bevestigd ? bevestigEigenFactoren(geopend.staat).staat : geopend.staat);
  const [afwijking, setAfwijking] = useState(geopend.afwijking);
  huidig = staat;
  const meldingen = useMemo(() => meldingenBelastinggevallen({
    loadCases: staat.loadCases, combinations: staat.combinations, alleCombinaties: staat.combinations,
    gevolgklasse: staat.gevolgklasse, bijlage: staat.bijlage, loads: p.loads, selfWeightEnabled: p.selfWeightEnabled,
  }), [staat]);
  // Zoals de store: bevestigen, en de melding bij het openen gaat dicht.
  const houd = () => { setStaat((s) => bevestigEigenFactoren(s).staat); setAfwijking(null); };
  useEffect(() => {
    if (melden) {
      meldCombinatiesBijOpenen({ vervanging: geopend.vervanging, afwijking: geopend.afwijking, maakOngedaan: noop, houdEigenFactoren: houd });
    }
  }, []);
  return (
    <>
      <ToastHost />
      <LoadCasesDialog
        open={metVenster} onClose={noop} initialTab="combos" loadCases={staat.loadCases} combinations={staat.combinations}
        belastingMeldingen={meldingen} combinatieAfwijking={afwijking} combinatieVervanging={null}
        onSluitAfwijking={() => setAfwijking(null)} onBevestigEigenFactoren={houd}
        onTrekBevestigingIn={() => setStaat((s) => trekBevestigingIn(s).staat)}
        onVervangDoorStandaard={noop} gevolgklasse={staat.gevolgklasse} bijlage={staat.bijlage}
        addLoadCase={noop} updateLoadCase={noop} removeLoadCase={noop}
        addCombination={noop} updateCombination={noop} removeCombination={noop}
      />
      {metRapport && (
        <div className="rpt-page" data-proef-rapport style={{ position: 'absolute', left: 0, top: metVenster ? 640 : 0, width: 1280, background: '#fff', color: '#000', padding: 16, boxSizing: 'border-box' }}>
          <ReportDataProvider value={{ ...EMPTY_REPORT_DATA, loadCases: staat.loadCases, combinations: staat.combinations, loads: p.loads, gevolgklasse: staat.gevolgklasse }}>
            <CombinationsSection />
          </ReportDataProvider>
        </div>
      )}
    </>
  );
}

const knop = (tekst: string, binnen: ParentNode = document) =>
  [...binnen.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === tekst);
const herkomst = () => [...document.querySelectorAll('.lcd-table-combo tbody tr td:nth-child(4)')].map((td) => td.textContent?.trim());
const fouten = () => document.querySelectorAll('.lcd-melding-fout').length;

async function run() {
  await i18next.use(initReactI18next).init({
    lng: 'nl', fallbackLng: 'nl', defaultNS: 'common', ns: ['common', 'ribbon'],
    resources: { nl: { common: nlCommon, ribbon: nlRibbon } },
    interpolation: { escapeValue: false },
  });
  const houden = i18next.t('common:loadCases.keepCustomFactors');
  const intrekken = i18next.t('common:loadCases.revokeOwnFactors');

  const toon = /^#toon-(melding|bevestigd|rapport)$/.exec(location.hash);
  if (toon) {
    document.documentElement.dataset.theme = 'light';
    document.body.style.cssText = 'margin:0;background:var(--theme-bg)';
    if (toon[1] === 'rapport') mount(<Proef melden={false} metRapport metVenster={false} bevestigd />);
    else mount(<Proef melden={toon[1] === 'melding'} metRapport={false} />);
    if (toon[1] === 'bevestigd') flushSync(() => knop(houden, document.querySelector('.lcd-dialog')!)[0].click());
    document.getElementById('uitslag')!.textContent = JSON.stringify({ tests: ['weergave'], errors: [] });
    return;
  }

  mount(<Proef melden metRapport />);
  // De melding komt uit een effect (zoals in de app na het openen): wachten
  // tot ToastHost haar toont.
  for (let i = 0; i < 100 && document.querySelector('.toast') === null; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }

  test('de melding bij het openen: titel, de schaal K_FI op NB.4 en de NB-waarde, geen "september 2026"', () => {
    const toast = document.querySelector('.toast');
    ok(toast, 'geen melding');
    const tekst = toast.textContent ?? '';
    ok(tekst.includes(i18next.t('common:app.file.combosNoticeTitle')), tekst);
    ok(tekst.includes('1,22 ≈ 0,9 × 1,35') && tekst.includes('NB.5 CC1 geeft 1,2'), tekst);
    ok(!/september 2026/.test(tekst) && !/verkeerde factoren/.test(tekst), tekst);
  });
  test('de melding draagt de knop "Behoud eigen factoren"', () => {
    ok(knop(houden, document.querySelector('.toast')!).length === 1, 'geen knop in de melding');
  });
  test('het venster: de melding met de knop, en de FOUT bij de combinaties met dezelfde knop', () => {
    const dialoog = document.querySelector('.lcd-dialog')!;
    ok(knop(houden, dialoog).length === 2, `knoppen: ${knop(houden, dialoog).length}`);
    ok(fouten() >= 1, 'geen FOUT in het venster');
    ok(herkomst().every((h) => h === i18next.t('common:loadCases.originCustom')), JSON.stringify(herkomst()));
  });
  test('het rapport vóór bevestigen: een FOUT, en geen combinatie of vermelding als bewust gekozen', () => {
    const r = document.querySelector('[data-proef-rapport]')!;
    const tekst = r.textContent ?? '';
    ok(tekst.includes(`${i18next.t('ribbon:report.meldingFout')}:`), tekst.slice(0, 400));
    ok(!tekst.includes(`(${i18next.t('ribbon:report.comboEigenBevestigd')})`), tekst.slice(0, 400));
    ok(r.querySelector('[data-rapport-eigen-factoren]') === null, 'vermelding vóór bevestigen');
  });

  flushSync(() => knop(houden, document.querySelector('.toast')!)[0].click());
  test('klik in de melding: de melding weg, alle vijf combinaties bevestigd, de factoren ongewijzigd', () => {
    ok(document.querySelector('.toast') === null, 'de melding staat er nog');
    ok(huidig.combinations.every((c) => c.bevestigdeFactoren !== undefined), JSON.stringify(huidig.combinations.map((c) => c.bevestigdeFactoren ?? null)));
    ok(JSON.stringify(huidig.combinations.map((c) => [...c.factors])) === JSON.stringify(geopend.staat.combinations.map((c) => [...c.factors])), 'factoren veranderd');
  });
  test('het venster daarna: geen FOUT, herkomst "eigen, bevestigd", de noot en de knop om in te trekken', () => {
    ok(fouten() === 0, `${fouten()} FOUT(en)`);
    ok(herkomst().every((h) => h === i18next.t('common:loadCases.originConfirmed')), JSON.stringify(herkomst()));
    ok(document.querySelector('.lcd-bevestigd')?.textContent?.includes('5 eigen combinaties'), document.querySelector('.lcd-bevestigd')?.textContent ?? 'geen noot');
    ok(knop(intrekken).length === 1, 'geen knop om in te trekken');
    ok(knop(houden, document.querySelector('.lcd-dialog')!).length === 0, 'de knop Behoud eigen factoren staat er nog');
  });
  test('het rapport daarna: "eigen factoren, bewust gekozen" en de vermelding, geen FOUT', () => {
    const r = document.querySelector('[data-proef-rapport]')!;
    const tekst = r.textContent ?? '';
    ok(tekst.includes(`(${i18next.t('ribbon:report.comboEigenBevestigd')})`), tekst.slice(0, 400));
    ok(r.querySelector('[data-rapport-eigen-factoren="bevestigd"]')?.textContent?.includes('1,22 ≈ 0,9 × 1,35'), 'geen vermelding');
    ok(!tekst.includes(`${i18next.t('ribbon:report.meldingFout')}:`), tekst.slice(0, 600));
  });

  flushSync(() => knop(intrekken)[0].click());
  test('Bevestiging intrekken: de FOUT en de knop komen terug, herkomst weer "eigen"', () => {
    ok(fouten() >= 1, 'geen FOUT na intrekken');
    ok(huidig.combinations.every((c) => c.bevestigdeFactoren === undefined), 'bevestiging staat er nog');
    ok(herkomst().every((h) => h === i18next.t('common:loadCases.originCustom')), JSON.stringify(herkomst()));
    ok(knop(houden, document.querySelector('.lcd-dialog')!).length === 1, 'geen knop in de FOUT');
  });
  flushSync(() => knop(houden, document.querySelector('.lcd-dialog')!)[0].click());
  test('de knop in het venster bevestigt opnieuw', () => {
    ok(fouten() === 0 && huidig.combinations.every((c) => c.bevestigdeFactoren !== undefined), `${fouten()} FOUT(en)`);
  });
  flushSync(() => root.unmount());
  document.getElementById('uitslag')!.textContent = JSON.stringify({ tests, errors });
}

run().catch((e) => {
  document.getElementById('uitslag')!.textContent = JSON.stringify({ tests, errors: [...errors, `run: ${e}`] });
});
