# Open FEM Studio — actielijst

Datum: 26 september 2026
Scope: één geïntegreerde 2D/3D-app, 3D-raamwerkberekening, resultaten, rapportage, normtoetsing, IFC, MCP en uitrol.

## Status

- `[x]` uitgevoerd en minimaal technisch gecontroleerd
- `[~]` aanwezig, maar nog verder afmaken of onafhankelijk verifiëren
- `[ ]` nog uitvoeren
- **P0** nodig voor een betrouwbare eerste 3D-uitgave
- **P1** nodig voor professioneel dagelijks gebruik
- **P2** geplande uitbreiding

## Productroute naar een volledig 3D FEM-pakket

Elke fase is pas gereed wanneer dezelfde functie via **GUI, API en MCP** werkt,
automatisch is getest en een controleerbare berekeningsuitdraai kan maken.

1. **Betrouwbare 3D-raamwerken.** Zes vrijheidsgraden, alle relevante
   staaflasten en randvoorwaarden, eerste en tweede orde, knik, evenwicht,
   foutdiagnostiek en onafhankelijke verificatie.
2. **Stalen 3D-raamwerken toetsen.** Doorsnede, stabiliteit, twee-assige
   interactie, knik, kip, imperfecties, UGT/BGT-combinaties en rapportage.
3. **Betonnen 3D-raamwerken toetsen.** Materiaalniet-lineariteit waar vereist,
   tweede-orde-effecten, wapening, normaalkracht met twee-assige buiging,
   dwarskracht, torsie, scheurvorming, kruip en een volledige uitdraai.
4. **Plaat- en schaalelementen.** Eerst betrouwbare elementen en verificatie,
   daarna staal-, beton- en houttoetsing op de relevante resultaatvelden.
5. **Volume-elementen.** Mesh, materiaalmodellen, spanningsresultaten,
   contouren en koppeling met staven en schalen in één globale analyse.

### Acceptatiepoort per fase

- Eén geversioneerd model- en resultaatcontract voor GUI, API en MCP.
- Exact dezelfde solverroute en eenheden via alle drie de ingangen.
- Positieve verificatiemodellen én doelbewuste foutmodellen.
- Vergelijking met gesloten oplossingen en minimaal twee onafhankelijke bronnen.
- Automatische unit-, integratie-, contract-, regressie- en GUI-tests.
- Evenwichts-, energie-, symmetrie- en convergentiecontroles waar toepasbaar.
- Reproduceerbare uitdraai met invoer, aannames, engine/revisie, combinaties,
  krachten, vervormingen, normartikelen, unity checks en waarschuwingen.
- Projectbestand, IFC-uitwisseling en heropenen zonder verlies van gegevens.

## 1. Direct afronden — huidige gebruikersvraag (P0)

- [x] Het aparte 3D-tabblad verwijderen; een project heeft één modeldimensie.
- [x] Een 2D-model eenmalig naar 3D kunnen omzetten.
- [x] Voorkomen dat een eenmaal 3D geworden model terugschakelt naar 2D.
- [x] In 3D dezelfde lintindeling tonen als in 2D.
- [x] De oude rechter 3D-invoerbalk verwijderen.
- [x] In 3D dezelfde Verkenner, het centrale canvas en het rechter Eigenschappenpaneel gebruiken.
- [x] Een 3D-staaf via Verkenner of canvas kunnen selecteren.
- [x] Voor een 3D-staaf dezelfde profielkiezer als in 2D openen.
- [x] Tabbladen **Algemeen**, **Resultaten** en **EN 1993** in 3D tonen.
- [x] De knop **Berekenen** in 3D beschikbaar maken.
- [x] Na berekenen automatisch het tabblad **Resultaten** in de Verkenner openen.
- [x] De Verkennerregels voor knopen en staven echte toetsenbordbedienbare knoppen maken.
- [ ] Alle oude, niet meer gebruikte CSS en componentcode van de aparte 3D-zijbalk verwijderen.
- [x] De volledige stroom opnieuw via de GUI controleren: openen, selecteren, profiel wijzigen, berekenen, resultaten, EN 1993, EN 1992 en rapport.

## 2. Eén gelijkwaardige 2D/3D-bediening (P0/P1)

### Tekenen en bewerken

- [x] **Selecteren**, **Knoop** en **Staaf** in 3D aansluiten op het canvas.
- [x] **Passend beeld**, isometrisch, boven-, voor- en zijaanzicht toevoegen.
- [x] Middelste muisknop ingedrukt gebruiken voor pannen; rechter muisknop voor roteren.
- [x] Direct en sneller zoomen zonder merkbare vertraging.
- [~] **Stramien** zichtbaar maken in 3D; toevoegen, wijzigen, verwijderen en snappen nog volledig nalopen.
- [x] **Sub-knoop** voor 3D-staven implementeren: klikken knipt op de
  geprojecteerde positie; profiel, materiaal, roll en toetsinstellingen blijven
  behouden; trapezium-, punt- en temperatuurbelastingen worden overgezet en
  alleen de oorspronkelijke buitenste eindvrijgaven blijven bestaan.
- [x] **Verplaatsen** voor geselecteerde 3D-knopen en staven implementeren.
- [x] **Roteren** van geometrie om een gekozen as implementeren.
- [x] **Kopiëren** implementeren, inclusief gekoppelde opleggingen en lasten.
- [x] **Spiegelen** om een globaal vlak implementeren.
- [ ] Meervoudig kopiëren met afstand en aantal toevoegen.
- [ ] **Filter selectie** voor knopen, staven, opleggingen en belastingen implementeren.
- [~] Ongedaan maken en opnieuw uitvoeren voor 3D-modelwijzigingen volledig aansluiten op titelbalk én lint.
- [x] Verwijderen van een geselecteerde 3D-knoop of staaf ondersteunen.
- [ ] Meervoudige selectie en vensterselectie toevoegen.
- [x] Numerieke invoer voor knoopcoördinaten in het Eigenschappenpaneel toevoegen.
- [x] Beginknoop en eindknoop van een staaf via Eigenschappen kunnen wijzigen,
  met behoud van staaflasten/eigenschappen en blokkering van nulstaven.
- [x] Lokale staafrotatie invoerbaar maken, met graden in de GUI en radialen in het openbare adaptercontract.

### Opleggingen en verbindingen

- [x] Inklemming, scharnier, X-rol en Z-rol op een geselecteerde 3D-knoop kunnen zetten.
- [x] Opleggingen duidelijk als 3D-symbolen tonen.
- [x] Een echte **revolute** 3D-oplegging toevoegen: één gekozen globale of
  lokale rotatie-as vrij, overige rotaties en translaties expliciet instelbaar.
- [x] De vrije revolve-as als 3D-as en rotatieboog in het canvas tonen.
- [x] Revolute-opleggingen in projectbestand, API, MCP en rapport opnemen;
  de huidige geometrische IFC-export bewaart deze nog niet als structurele randvoorwaarde.
- [~] Revolute-opleggingen testen voor elke as; presets X/Y/Z, GUI en
  analytische X/Y/Z-proeven zijn afgedekt, een geroteerd-modelgeval nog niet.
- [x] X-, Y- en Z-rol en een vrije keuze per `Ux/Uy/Uz/Rx/Ry/Rz` toevoegen,
  met asgerichte 3D-symbolen.
- [x] Translatie- en rotatieveren per vrijheidsgraad toevoegen, inclusief
  2D→3D-omzetting, reacties, 3D-symbolen, rapport, IFC4, GUI-API en MCP-schema.
- [~] Lokale `My`, `Mz`- en torsiereleases aan beide staafeinden lopen door
  eigenschappen, project, solver en rapport; een aparte globale-asvariant ontbreekt nog.
- [ ] Excentriciteiten en stijve eindzones toevoegen.
- [x] Instabiliteit door ontbrekende torsieblokkering begrijpelijk melden.

### Belastingen en combinaties

- [x] Knoopkrachten en knoopmomenten in zes globale componenten ondersteunen.
- [x] Belastingen als pijlen en momenten in het 3D-canvas tonen.
- [x] Puntlasten op een staaf in de lokale Y- en Z-richting ondersteunen,
  inclusief positie, projectroundtrip, canvas, API, MCP, IFC en rapport.
- [~] Gelijkmatige, lineair verlopende en gedeeltelijke lijnlasten in lokale
  richting ondersteunen; globale invoerrichting ontbreekt nog.
- [x] Uniforme temperatuurbelasting, lokale y/z-gradiënten en opgelegde
  knoopverplaatsingen ondersteunen, inclusief materiaal-α, 2D→3D waar van
  toepassing, combinaties, GUI, IFC4, MCP, rapport en gesloten verificatie.
- [x] Eigengewicht uit materiaal en profiel genereren.
- [x] Belastinggevallen in 3D gebruiken voor knoop-, lijn- en staafpuntlasten.
- [~] NEN-EN 1990-combinaties voor 3D berekenen en selecteren; een grafische
  omhullende over alle combinaties ontbreekt nog.
- [ ] Windgenerator geschikt maken voor ruimtelijke gevels en daken.
- [ ] Niet-ondersteunde 2D-belastingen bij omzetting gericht laten oplossen in plaats van alleen melden.

## 3. Weergave en 3D-engine (P0/P1)

- [x] That Open als BIM/IFC-richting kiezen; de eerste rekenweergave met een gerichte 3D-canvaslaag bouwen.
- [x] Een witte 3D-achtergrond instellen.
- [x] Profielweergave optioneel maken; centrumlijnen blijven beschikbaar.
- [x] Een tab **Weergave** met pictogrammen en zoekfunctie toevoegen.
- [x] Knopen, staven, knoopnummers, staafnummers, coördinaten, opleggingen, belastingen, stramienen en assenstelsel schakelbaar maken.
- [x] Snapinstellingen in **Weergave** opnemen.
- [x] Resultaatlagen voor vervorming, reacties, N, Vy, Vz, T, My en Mz schakelbaar maken.
- [x] EN 1992/EN 1993-unity checks als schakelbare kleurlaag, labels en legenda in de 3D-view tonen.
- [ ] Maatvoering als volwaardige 3D-laag toevoegen.
- [ ] Aanzichtgeometrie en doorsnedevlakken toevoegen.
- [ ] Instellingen voor schaduw, randen, transparantie en perspectief/orthografisch toevoegen.
- [ ] Profielmeshes via instancing en level of detail snel maken voor grote modellen.
- [ ] Selectie, labels en resultaten testen met ten minste 10.000 staven.
- [ ] GPU- en geheugengebruik meten in Chrome, Edge en Tauri/WebView.

## 4. 3D-rekenkernel (P0)

- [x] Zes vrijheidsgraden per knoop ondersteunen.
- [x] `A`, `E`, `G`, `J`, `Iy` en `Iz` per staaf gebruiken.
- [x] Lokale assen en globale transformatie voor willekeurige 3D-richting implementeren.
- [x] Eerste-orde lineair elastische analyse implementeren.
- [x] Directe tweede-ordeanalyse met iteratieve P-Delta implementeren.
- [x] Lineaire knik-eigenwaarden en kritieke belastingfactoren leveren.
- [x] Numerieke nulmodi uit de gerapporteerde fysieke knikmodi filteren.
- [x] Verplaatsingen en rotaties per knoop teruggeven.
- [x] Reactiekrachten en reactiemomenten per oplegging teruggeven.
- [x] `N/Vy/Vz/T/My/Mz` aan beide staafeinden teruggeven.
- [x] Evenwichtsresidu, iteraties, convergentie en engineherkomst rapporteren.
- [x] De geldige P-Delta-nultoestand met een volledig geblokkeerde belasting herkennen en als `B2=1` rapporteren.
- [x] De openbare radiaal-eenheid van staafrotatie correct naar de engine converteren.
- [x] Geometrische stijfheid en tekenconventies voor trek én druk aanvullend toetsen.
- [x] Tweede-ordeanalyse nabij de kritieke last robuust begrenzen en diagnostiek verbeteren.
- [ ] Automatische staafsegmentering voor lokale P-δ toevoegen.
- [x] Staafpuntlasten met consistente equivalente knooplasten in de kern toevoegen.
- [x] Gedeeltelijke en lineair verlopende lokale staaflasten en
  resultaatstations langs de staaf toevoegen.
- [~] Staafreleases en oplegveren zijn in de kern aanwezig; excentriciteiten
  en stijve eindzones ontbreken nog.
- [ ] Sparse assemblage en oplosser benchmarken op grotere modellen.
- [~] Mechanismen en oplossingen met een te groot solverresidu worden hard
  geweigerd met concrete hersteltekst; een expliciete conditiegetalgrens ontbreekt nog.

## 5. Solverarchitectuur en SaaS (P0/P1)

- [x] Een neutraal solverregister en capabilityselectie toevoegen.
- [x] **Automatisch** en een expliciete solverkeuze in Instellingen tonen.
- [x] Dedaliano/Stabileo achter een versievaste adapter plaatsen.
- [x] De geteste upstream-revisie vastpinnen.
- [x] Engine, revisie en AGPL-licentie in resultaat en rapport tonen.
- [ ] De AGPL-netwerkverplichtingen concreet in distributie- en SaaS-documentatie vastleggen.
- [ ] Beslissen of Open FEM Studio volledig open SaaS blijft of een commerciële Dedaliano-licentie nodig heeft.
- [ ] De bestaande licentie-inconsistentie tussen repository, package en Cargo-manifesten oplossen.
- [ ] Een permissieve tweede frame-engine of onafhankelijke verificatieadapter toevoegen.
- [ ] Het neutrale contract voor plaat-, schaal- en volume-elementen definitief versiebeheer geven.
- [ ] SaaS-jobcontract toevoegen: limieten, time-out, annuleren, reproduceerbare engineversie en auditlog.

## 6. Staal- en betontoetsing van 3D-staven (P0/P1)

### Staal — EN 1993

- [x] De bestaande Rust EN 1993-kern aan de zes 3D-staafkrachten koppelen.
- [x] Doorsnedeklasse, unity checks en maatgevende toets in 3D Eigenschappen tonen.
- [x] Een UGT-max zonder BGT-doorbuiging apart rapporteren.
- [x] Knikfactor, kritieke kracht, effectieve lengte en slankheid uit de globale eigenwaarde tonen.
- [~] Interactie van normaalkracht en twee-assige buiging controleren; de invoer is aangesloten, onafhankelijke verificatie ontbreekt nog.
- [ ] Belastingcombinaties per UGT/BGT invoeren; de huidige ene lasttoestand is nog geen normcombinatie.
- [ ] Kniklengten per lokale as en per staaf invoerbaar maken.
- [ ] Zijdelingse steunpunten, gaffelcondities en torsierandvoorwaarden in 3D invoerbaar maken.
- [ ] Kipcontrole met momentverloop en werkelijke steunpunten toevoegen/valideren.
- [x] Resultaatstations langs de staaf gebruiken, inclusief stations direct
  vóór en na een staafpuntlast.
- [ ] Imperfecties en sway/nonsway-keuze conform EN 1993-1-1 koppelen aan de analyse.
- [ ] BGT-doorbuiging uit afzonderlijke karakteristieke, frequente en quasi-blijvende combinaties bepalen.
- [ ] Waarschuwingen hard maken wanneer een vereiste norminvoer ontbreekt; niets stil aannemen.

### Beton — EN 1992

- [x] Betonsterkteklasse, doorsnede, dekking, langswapening, beugels en de
  volledige §5.8-kolominvoer per 3D-staaf via dezelfde profiel-/eigenschappenstroom als 2D invoerbaar maken.
- [~] `N`, `Vy`, `Vz`, `T`, `My` en `Mz` op voldoende stations langs de staaf
  aan de betontoets doorgeven.
- [~] UGT-toets voor normaalkracht met twee-assige buiging toevoegen.
- [ ] Dwarskracht in beide lokale richtingen toetsen; `Vy` en `Vz` reizen al
  door het contract, de huidige liggerdoorsnedetoets gebruikt alleen `Vz`.
- [ ] Torsie en interactie tussen torsie en dwarskracht toetsen.
- [~] Slanke kolommen en tweede-orde-effecten volgens EN 1992-1-1 §5.8 toetsen.
- [~] Nominale-krommings- of nominale-stijfheidsmethode als onafhankelijke
  normtoets naast de globale tweede-ordeanalyse aanbieden en de keuze melden.
- [ ] Initiële imperfecties en scheefstand in beide horizontale richtingen meenemen.
- [ ] Kruip, krimp, scheurvorming en effectieve stijfheid voor BGT en tweede orde verwerken.
- [ ] Wapeningsvoorstel en controle van minimale/maximale wapening toevoegen.
- [ ] Interactiediagrammen `N-My-Mz` en maatgevende combinatie tonen.
- [ ] Brand-, vermoeiings- en seismische toetsen buiten de eerste betonrelease
  expliciet als niet ondersteund markeren.
- [~] Betonresultaten in Eigenschappen, Verkenner, 3D-view en rapport opnemen.
- [ ] Gepubliceerde kolom-, ligger- en ruimtelijke betonraamwerkvoorbeelden toevoegen.
- [~] De 3D-betontoets vergelijken met de bestaande 2D-kern voor vlakke modellen.

### Daarna

- [ ] EN 1995 en aluminiumtoetsing voor 3D-staven op dezelfde resultaatlaag aansluiten.

## 7. Resultaten en rapport (P0/P1)

- [x] Compacte 3D-samenvatting met verplaatsing, reactie, iteraties en knik toevoegen.
- [x] Geselecteerde staafresultaten in Eigenschappen tonen.
- [x] EN 1993-overzicht in het compacte 3D-rapport opnemen.
- [x] Overgeslagen/niet-ondersteunde staven en aannames zichtbaar melden.
- [~] Vervormde vorm werkelijk in het canvas tekenen; automatische schaal is
  aanwezig, handmatige schaalinvoer ontbreekt nog.
- [x] Reactiepijlen op schaal tekenen; reactiemomentbogen volgen nog.
- [x] N-, V-, T- en M-diagrammen met waarden en extrema langs de staaf tekenen.
- [~] Waardelabels en extrema toevoegen; aanwijzen en een algemene
  resultaatlegenda ontbreken nog.
- [~] UGT/BGT-combinatiekiezer toevoegen; omhullendeweergave ontbreekt nog.
- [ ] Modale knikvormen doorlopen en animeren.
- [ ] Rapportsecties op dezelfde instellingen, inhoudsopgave en exportstroom als 2D aansluiten.
- [ ] Rapporttekst verder comprimeren: kerngetallen eerst, aannames en afleidingen inklapbaar/bijlage.
- [ ] Een volledige **3D-raamwerkuitdraai** maken met modelafbeeldingen,
  opleggingen, belastingen, combinaties, vervormingen, reacties en staafkrachten.
- [ ] Per stalen staaf een compacte en gedetailleerde EN 1993-uitdraai maken.
- [~] Per betonnen staaf een compacte en gedetailleerde EN 1992-uitdraai maken,
  inclusief doorsnede, wapening, interactie, tweede orde en maatgevende combinatie.
- [ ] Voorblad en conclusietabel laten zien welke staven voldoen, niet voldoen
  of niet konden worden getoetst en waarom.
- [ ] Geselecteerde 3D-views, aanzichten en resultaatbeelden als vaste figuren
  in de uitdraai kunnen opnemen.
- [ ] PDF-export visueel controleren op A4/A3, staand/liggend en meerdere talen.

## 8. IFC en uitwisseling (P0/P1)

- [x] 3D-knooppunten en staven in het projectbestand bewaren.
- [x] Modeldimensie in het bestand bewaren en dubbel actief 2D/3D weigeren.
- [x] 3D-opleggingen en knooplasten roundtrip bewaren.
- [x] Een basis-IFC-export voor 3D-geometrie toevoegen.
- [ ] IFC-profielen met juiste plaatsing en lokale assen volledig valideren.
- [~] `IfcStructuralCurveMember`, knopen en lasten exporteren; staaflijnlasten
  en staafpuntlasten zijn aan het structurele staafobject gekoppeld, maar alle
  verbindingen en randvoorwaarden moeten nog worden aangevuld en extern gevalideerd.
- [ ] Resultaten als duidelijke property sets of gekoppeld resultaatbestand exporteren.
- [ ] IFC-import met profiel-, materiaal- en eenhedenmapping toevoegen.
- [ ] Roundtrip testen in That Open en minimaal twee onafhankelijke IFC-viewers.
- [ ] Foutmeldingen voor ontbrekende profielen, niet-ondersteunde entiteiten en eenheden toevoegen.

## 9. MCP en automatisering (P0/P1)

- [x] `frame3d_engine_info` en `solve_frame3d` aan Tauri toevoegen.
- [x] Een browser-devroute voor dezelfde 3D-solve toevoegen.
- [x] Een directe MCP-tool voor de 3D-solver toevoegen.
- [x] MCP stdio-roundtrip voor de 3D-tool toevoegen.
- [x] GUI-bedieningsacties voor 3D-model, zichtbaarheid, stramien en aanzicht
  toevoegen en via de zelfstandige desktopbuild uitvoeren.
- [x] GUI-bediening voor 3D berekenen, selecteren, profiel toewijzen,
  resultaten en rapport toevoegen.
- [x] GUI-API- en MCP-bediening voor het splitsen van een 3D-staaf toevoegen,
  met streng schema en een live roundtrip door de zelfstandige desktopapp.
- [ ] Project openen via de GUI-bediening als vaste teststap toevoegen.
- [ ] Een openbare, geversioneerde 3D REST/JSON-API toevoegen met dezelfde
  request- en responsevorm als de lokale adapter.
- [ ] API-routes toevoegen voor valideren, rekenen, staaltoetsen,
  betontoetsen, rapport genereren en engine-informatie.
- [ ] MCP-tools toevoegen voor valideren, staaltoetsen, betontoetsen en een
  reproduceerbare berekeningsuitdraai.
- [ ] Voor elke API- en MCP-functie JSON-schema's, eenheden, voorbeelden,
  foutcodes en contracttests toevoegen.
- [ ] Authenticatie, tenantgrenzen, joblimieten en auditgegevens voor SaaS ontwerpen.
- [ ] MCP-schema's voorzien van volledige eenheden, foutvoorbeelden en engineherkomst.
- [ ] MCP, Tauri, browserroute en GUI voor één identiek model bit-voor-bit vergelijken waar mogelijk.

## 10. Verificatie en testen (P0)

### Rekenkundige verificatie

- [x] Axiale schuine staaf tegen gesloten oplossing toetsen.
- [x] Twee-assige uitkraging tegen gesloten oplossing toetsen.
- [x] Schuine torsie en lokale transformatie toetsen.
- [x] Staafrotatie/roll in radialen regressietesten.
- [x] Tweede orde en knik op een portaal regressietesten.
- [x] Numerieke nulmodus regressietesten.
- [x] P-Delta met exact nul vrije verplaatsing en een niet-nulle oplegreactie regressietesten.
- [x] De vier gevallen uit `cases.json` automatisch tegen de Rust-engine uitvoeren en foutmaten vastleggen.
- [ ] Het TU Delft-torsieraamwerk als volledige 6-DOF-variant modelleren en vergelijken.
- [ ] AISC C2.1-tweede-ordebenchmarks toevoegen.
- [ ] De uitkomsten met twee onafhankelijke solvers vergelijken.
- [x] Convergentie bij elementverfijning en bij toenemende normaalkracht documenteren.
- [~] Symmetrie en globaal kracht-/momentevenwicht zijn voor de vier JSON-
  referenties geautomatiseerd; een onafhankelijke energie-identiteit ontbreekt nog.

### Softwaretests

- [x] Rust-unit- en integratietests voor de huidige framekernel laten slagen.
- [x] TypeScript-typecontrole voor de huidige integratie laten slagen.
- [x] Een test voor lokale 3D-assen en planrotatie-onafhankelijke Hermite-doorbuiging toevoegen.
- [x] Relevante projectbestand-, IFC-, zichtbaarheid-, bediening- en
  resultaatregressies gezamenlijk draaien.
- [x] De volledige Rust-workspace testen.
- [x] De productie-Vite-build na de laatste wijzigingen opnieuw draaien.
- [~] De Tauri-desktopbuild op Linux controleren; Windows en macOS ontbreken nog.
- [x] GUI-e2e-bediening toevoegen voor lint/profiel, solve, resultaten,
  EN 1993, EN 1992 en rapport en via de Linux-desktopbuild uitvoeren.
- [ ] Toetsenbordbediening, focusvolgorde, labels en kleurcontrast controleren.
- [ ] Foutpaden testen: leeg model, ontbrekende steun, onbekend profiel, nul lengte, mechanisme en niet-convergentie.
- [ ] Grote-modeltest en prestatiedrempels in CI opnemen.
- [ ] Eén golden model door GUI, REST-API, MCP en directe Rust-aanroep sturen
  en invoer, solverherkomst en numerieke resultaten automatisch vergelijken.
- [x] Een vrij opgelegde IPE200 met een lokale staafpuntlast van 10 kN via de
  echte desktop-GUI toetsen: reacties 5/5 kN, `Vz=±5 kN`, `My,max=10 kNm` en
  `wmax=3,2727868 mm`, gelijk aan `PL³/(48EI)`.
- [x] Een IPE200-uitkraging van 2 m met `kz=370 kN/m` en `Pz=-10 kN` via de
  echte desktop-GUI toetsen: `uz=-5,269398 mm`, veerreactie `1,949677 kN`,
  inklemmingsreactie `8,050323 kN` en exact globaal evenwicht.
- [x] Vrije betonuitzetting via de echte desktop-GUI toetsen: `C30/37`,
  `L=2 m`, `ΔT=30 K`, `α=10·10⁻⁶/K` geeft exact `ux=0,600000 mm` en
  nulreacties op afrondruisniveau.
- [x] Een IPE200 van 2 m met `Ux=1,000 mm` opgelegd via de echte desktop-GUI
  toetsen: `Rx=-299,25/+299,25 kN` en `N=299,25 kN`, gelijk aan `EAδ/L`.
- [~] Voor staal én beton een golden rapport als gestructureerde data testen;
  alleen de visuele PDF-laag met gerenderde pagina-afbeeldingen beoordelen.
- [ ] Elke ondersteunde 3D-oplegging, inclusief revolute per as, in een klein
  zelfstandig verificatiemodel testen.

## 11. Plaat-, schaal- en volume-elementen (P2)

- [x] Solvercapaciteiten en toekomstige elementfamilies in de architectuur voorbereiden.
- [x] Veelhoekige 3D-platen tekenen, selecteren, verplaatsen, roteren, spiegelen en kopiëren.
- [x] Werkelijke plaatdikte, afgeronde buitenhoeken en afgeronde openingen als 3D-geometrie tonen.
- [x] Oppervlaktebelastingen per belastinggeval toevoegen, bewerken, selecteren en opslaan.
- [x] Rekenen blokkeren zolang een model platen of oppervlaktebelastingen bevat,
  zodat de raamwerkkern deze elementen nooit stil kan negeren.
- [x] Plaatgeometrie, openingen en oppervlaktebelastingen via projectbestand, GUI-API en MCP ontsluiten.
- [x] 3D-viewsets met camera, zichtbaarheid en actieve resultaatcombinatie in het project opslaan.
- [ ] Neutraal knoop-, materiaal-, element- en resultaatcontract voor gemengde modellen vastleggen.
- [ ] Plaat/schaalelement kiezen en onafhankelijk verifiëren.
- [ ] Volume-elementfamilie en meshstrategie kiezen.
- [ ] Eén gezamenlijke globale matrix voor staven, platen en volumes afdwingen.
- [ ] Resultaten voor spanningen, hoofdspanningen, vervormingen en contourplots ontwerpen.
- [~] IFC4-oppervlakte-elementen koppelen: 3D-plaat, dikte, materiaal,
  afgeronde buitenrand, openingen en `IfcStructuralSurfaceAction` zijn aanwezig;
  volume-elementen, plaatmesh en plaatresultaten ontbreken nog.
- [ ] Solverrouter uitbreiden zonder resultaten van gekoppelde domeinen los van elkaar op te lossen.

## 12. Documentatie, kwaliteit en oplevering (P0/P1)

- [x] De verouderde tekst in `docs/verificatie/3d-raamwerk/README.md` bijwerken: de solver is inmiddels wel uitgevoerd.
- [ ] Eenheden- en tekenconventies centraal documenteren.
- [ ] Bekende beperkingen van de eerste 3D-uitgave in app, rapport en README gelijk trekken.
- [ ] De ontwerpbesluiten voor één modeldimensie en de eenmalige 2D→3D-omzetting vastleggen.
- [ ] Versienummer en changelog bijwerken.
- [ ] Gegenereerde en tijdelijke bestanden uit de wijzigingenset verwijderen.
- [ ] Wijzigingenset per onderwerp nalopen en onbedoelde nevenwijzigingen uitsluiten.
- [x] Alle vereiste builds en tests groen krijgen en bewijs in het verificatiedocument opnemen.
- [x] Een reviewbare commit maken.
- [ ] Naar GitHub pushen.
- [ ] GitHub-issues sluiten of bijwerken met de concrete testresultaten en resterende beperkingen.

## Uitvoervolgorde

1. **3D-raamwerk betrouwbaar maken:** randvoorwaarden inclusief revolute,
   lasten, combinaties, releases, tweede orde, knik en harde foutdiagnostiek.
2. **API/MCP/GUI-pariteit bewijzen:** hetzelfde golden model door alle routes,
   met identieke uitkomsten en automatische tests.
3. **3D-resultaatweergave en uitdraai afmaken:** views, vervorming, reacties,
   staafdiagrammen, extrema en reproduceerbare PDF.
4. **Staaltoetsing voltooien:** EN 1993 combinatiegestuurd, knik, kip,
   twee-assige interactie en onafhankelijke verificatie.
5. **Betontoetsing voltooien:** EN 1992, wapening, `N-My-Mz`, dwarskracht,
   torsie, §5.8, kruip/scheurvorming en volledige uitdraai.
6. **IFC end-to-end maken:** geometrie, analytisch model, lasten,
   randvoorwaarden en resultaten roundtrip testen.
7. **Alles groen maken, documenteren, reviewen, committen en pushen.**
8. **Plaatfundament verder uitbouwen:** de nu beschikbare geometrie, openingen en
   oppervlaktebelastingen koppelen aan een onafhankelijk geverifieerde plaatkernel,
   mesh, contourresultaten en IFC.
