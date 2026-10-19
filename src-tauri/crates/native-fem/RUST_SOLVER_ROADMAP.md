# Migratie van de FEM Studio-solver naar Rust

Doel: dezelfde modelinvoer, analyses, resultaten en foutafhandeling in Rust
beschikbaar maken, waarna de app de Rust-kern kan gebruiken. Een CLI-proef is
nog geen vervanging van de app-solver.

## Uitgebreide doelscope: lijn, plaat, volume en grote modellen

### Volume-elementen in de gewone 3D-tool (8 oktober 2026)

De gewone 3D-modelopslag en -editor ondersteunen nu Tet4- en Hex8-records met
knoopvolgorde, E en ν. De 3D-ribbon en het canvas laten volumes maken en
selecteren; de projectboom en eigenschappen tonen materiaal en spanningen.
De normale knop **Berekenen** kiest voor een lineair volume-model automatisch
de gedeelde `mixed3d`-Rust-kern. Modelknoop-ID's worden naar compacte
solverindices vertaald; Tet4, Hex8 en 3D-raamwerkstaven delen translatie-DOF's.
Belastinggevallen en combinaties gaan als afzonderlijke lastvectoren door de
kern. Resultaten bevatten verplaatsingen, reacties, Tet4-spanningen, acht
Hex8-Gauss-spanningen, von Mises en de gebruikte backend. De parser, de echte
Rust-app-route en het voorbeeldproject
`docs/verificatie/3d-volume/tet4-hex8-raamwerk.ifcfem2d` zijn getest. Dat
project met 1 Hex8, 2 Tet4 en 1 3D-staaf rekent ook zichtbaar in de dev-app;
de Hex8-eigenschappen tonen acht integratiepunten, matrixFreePcg, twaalf
iteraties en relatief residu 3,61e-13.

De gewone 3D-staafeigenschappen bieden in een volumemodel nu ook de keuze
**axiale trekstaaf**. Die staaf wordt als echte 3-DOF-truss naar `mixed3d`
gestuurd; buigende staven blijven 12-DOF-frames. De resultaatadapter koppelt
de twee gescheiden Rust-uitvoerreeksen op de oorspronkelijke staaf-ID's terug.
Een onafhankelijke Tet4-plus-trekstaaf-parallelveerproef controleert de
verplaatsing en normaalkracht; een aparte proef met gelijktijdig een frame en
een truss controleert de indexering en buiging. Eindscharnieren, dwarslasten
en materiaal-FNL op zo'n axiale staaf worden geweigerd. De 3D-volumeproef
heeft nu ook een direct laadbaar onregelmatig model met 1.872 Tet4 en 376
Hex8 (2.248 volumes), 972 knopen, een truss en een buigende staaf. De gewone
3D-app rekende dit opgeslagen project in vier threads door met matrixvrije
PCG: 229 iteraties en een relatief residu van 9,67e-10. Het
eigenschappenpaneel is verbreed en toont de volumevelden in leesbare kaarten;
uitgebreide formuletoelichting is uitklapbaar.
De opgeslagen variant
`docs/verificatie/3d-volume/groot-gemengd-2248-volumes-frame-truss.ifcfem2d`
voegt aan dit 2.248-volumeproject één diagonale trekstaaf toe, naast de
buigende raamstaaf. De gewone 3D-app berekende de variant met matrixvrije PCG
in 227 iteraties (residu 9,35e-10), met twee gescheiden staafresultaten en
globaal kracht- en momentevenwicht. De eigenschappen van staven en volumes
gebruiken nu kaarten; bij meer dan 500 knopen gebruikt ook de staafeditor
directe knoop-ID-invoer in plaats van honderden dropdownopties per eindknoop.

Het gedeelde `mixed3d`-app-pad is lineair en klein-vervormd. Daarnaast stuurt
de gewone 3D-editor nu een model met uitsluitend Tet4-volumes bij de keuze
**2e orde** naar de bestaande Rust-kern `volume3dGnl`. Die gebruikt een
totale-Lagrange formulering, Green-rek en een St Venant–Kirchhoff-materiaal;
de editor toont Cauchy-spanning en Green-rek per element. Knooplasten,
opgelegde verplaatsingen, volumekrachten, vlaktracties en combinaties worden
als één niet-lineaire lasttoestand opgelost. Het opgeslagen voorbeeld
`docs/verificatie/3d-volume/tet4-gnl-eenassig.ifcfem2d` is in de dev-app
geopend en doorgerekend: 100 mm verplaatsing, 0,105 Green-rek, 154 MPa
Cauchy-σxx en 4 Newton-iteraties. De app-routetest vergelijkt die uitkomsten
met de onafhankelijk afgeleide scalaire eindige-rekvergelijking, inclusief
volumekracht, nominale vlaktractie, opgelegde verplaatsing, combinatie en
de dichte, sparse-directe en frontale tangentoplosser.
Per Tet4 kan de gewone editor nu ook een eindige dimensieloze `energyBeta`
opslaan. De bestaande Rust-kern gebruikt dan de expliciete energie
`W = W₀ + βW₀²/(2E₀)` en rapporteert de effectieve E per element; de
eigenschappen en het rapport tonen deze parameter en uitkomst. Het opgeslagen
`docs/verificatie/3d-volume/tet4-gnl-rekafhankelijke-e.ifcfem2d` met β=40
is in de app doorgerekend: 100 mm verplaatsing, E_eff=1494 MPa en Cauchy-σxx
=191,730 MPa. De app-routetest vergelijkt dit met een onafhankelijk afgeleide
eenassige eindige-rekvergelijking. Dit is een specifieke hyperelastische
materiaalwet, geen staalplastificatie of betonscheurmodel.

Deze GNL-app-route accepteert alleen Tet4 zonder frames, platen of Hex8;
de PCG-keuzen en de threadinstelling gelden hier niet. Het gedeelde
Tet4/Hex8/staaf/plaat-stelsel heeft nog geen GNL of materiaal-FNL. De
rotaties van frameknopen worden
alleen door frame-elementen gedragen; de voorbeeldstaaf heeft daarom een
expliciete rotatieoplegging bij zijn volume-aansluiting. Buigplaten samen met
volumes, staafpunt- en temperatuurbelastingen, veren, staafscharnieren,
GNL/FNL in het gedeelde stelsel en volumetoetsen blijven geblokkeerd met een
expliciete melding. De overige losse volume-FNL-kernen zijn nog niet aan
de gewone 3D-tool gekoppeld. Vanaf 128 volumes groepeert de hoofdeditor
Tet4/Hex8-oppervlakken en randen nu in ruimtelijke batches van maximaal 512
elementen, met terugkoppeling van het geraakte driehoekvlak naar het volume-ID.
In de dev-app tekende een synthetisch model met 2.048 Tet4-elementen in 15
draw calls en bleef een willekeurig volume selecteerbaar. Bij meer dan 500
knopen gebruikt de volume-eigenschappeneditor directe knoop-ID-invoer om geen
duizenden keuzelijstopties per hoek te renderen. De hieronder beschreven
2.248-volumeprojecten zijn ook end-to-end in de gewone 3D-app doorgerekend;
een 250.000-volumeproject in die app blijft open.

De gewone editor bewaart nu ook uniforme globale volumekrachten (kN/m³) per
Tet4/Hex8 en belastinggeval. De eigenschappen laten deze lasten toevoegen,
bewerken en verwijderen. De app-route geeft ze als consistente volumelasten
door aan `mixed3d`; een afzonderlijke 2×2×2-Hex8- en exacte Tet4-integratie
controleert het weergegeven kracht- en momentevenwicht. Onafhankelijke
eenheidskubus- en eenheidstetraëderproeven toetsen de verplaatsing, reacties,
lastgevalfactoren en backendaanroep. Voor uitsluitend Tet4/Hex8-volumes kan
automatisch eigen gewicht nu via een expliciete positieve dichtheid (kg/m³)
per element worden berekend: de vluchtige berekeningskopie krijgt één
volumekracht in het eigengewichtgeval, terwijl het bewaarde projectmodel
ongewijzigd blijft. Tet4- en Hex8-eenheidscases controleren de resulterende
reacties en het globale evenwicht. Het opgeslagen voorbeeld
`docs/verificatie/3d-volume/hex8-eigengewicht.ifcfem2d` is via de normale
**Berekenen**-knop in de dev-app doorgerekend: 24,525 kN opwaartse
reactiesom in de bestandstest, neerwaartse verplaatsing en acht zichtbare
Hex8-Gauss-punten. Deze browserproef vond tevens een ontbrekend
lastgeval in de app-voorcontrole; de voorcontrole telt nu ook volumekrachten.
Ook lineair verdeelde, eventueel gedeeltelijke staaflasten worden nu met
driepunts-Gauss exact tegen de Hermite-vormfuncties geïntegreerd. De resulterende
knoopkrachten en -momenten worden in het gedeelde Rust-stelsel gezet; voor
gerapporteerde staafeindkrachten wordt de equivalente last weer van `K·u`
afgetrokken. Een onafhankelijke uniforme cantilever met een gedeelde Tet4-
interface toetst de verplaatsingen, 4 kN dwarskracht, 2 kNm vast moment en het
onbelaste vrije staafeinde. Een afzonderlijke proef toetst een gedeeltelijke
trapeziumlast met analytische cantilever-invloedslijn en een geroteerde staaf
op kracht, moment en verplaatsing. Daarmee werkt ook
automatisch eigen gewicht van een gemengd staaf/volume-model. Het opgeslagen
`docs/verificatie/3d-volume/tet4-hex8-raamwerk-eigengewicht.ifcfem2d` met
1 Hex8, 2 Tet4 en 1 staaf slaagt via de Rust-app-route en de normale knop
**Berekenen** in de dev-app (umax 0,03506 mm); de automatische lasttab toont
vier lasten. GNL/FNL en staafscharnieren in deze gedeelde route blijven open.

De gewone 3D-tool bewaart nu ook uniforme globale vlaktracties (kN/m²) op
een gekozen Tet4- of Hex8-buitenvlak per belastinggeval. De volume-eigenschappen
tonen de cyclische vlakknoopvolgorde en laten de drie tractiecomponenten
toevoegen, wijzigen en verwijderen; de actieve lasten staan ook in de
projectboom en de belastinggevaltab. De app stuurt de vlaklasten naar de al
bestaande consistente integratie van `mixed3d` en berekent de equivalente
knoopkrachten afzonderlijk voor de gerapporteerde kracht- en momentbalans.
Analytische driehoek- en scheve vierhoekproeven controleren resultante,
knoopverdeling en moment; de echte Rust-app-route controleert Tet4, Hex8,
combinatiefactoren en een gemengd Hex8/Tet4/staafproject. Het opgeslagen
`docs/verificatie/3d-volume/tet4-hex8-raamwerk-vlaktractie.ifcfem2d` is
in de dev-app geopend en met **Berekenen** opgelost (1 Hex8, 2 Tet4, 1 staaf,
2 vlaktracties, 0,0005573 mm maximale verplaatsing in actief geval 2).
Tractie is hier een globale vector; een automatisch normaaldrukmodel en
belastingen op geselecteerde zichtbare vlakken ontbreken nog.
De volume-eigenschappen laten nu voor het hele lineaire Tet4/Hex8/staafmodel
`automatic`, matrixvrije PCG, CSR-sparse PCG, sparse direct, frontale
wavefront of de dichte referentieroute kiezen, plus 1–32 threads. De keuze
blijft in het projectmodel bewaard. Een analytische Hex8-veer sluit via de
echte Rust-app-route op alle vijf expliciete backends; de verzonden backend
en threadtelling en de door Rust gerapporteerde `backendUsed` zijn
gecontroleerd. In de dev-app werd het gemengde vlaktractievoorbeeld na een
keuze voor frontaal opnieuw opgelost; de Hex8-resultaten tonen
`frontalWave` en een relatief residu van 1,33·10⁻¹⁵. De dichte route is
in `mixed3d` begrensd op 600 DOF; directe routes en de opslag van lokale
elementmatrices blijven ongeschikt voor zeer grote modellen. Voor zulke
modellen is de matrixvrije route de gevalideerde optie.

De lege gewone 3D-editor heeft nu een knop voor een bewerkbaar gemengd
proefmodel met 414 knopen, 143 Hex8, 720 Tet4, één buigende staaf,
wisselende E-moduli, een holte, L-uitsparing, opleggingen en tien knooplasten.
Alle volume-elementen krijgen ook dichtheid, zodat de standaard ingeschakelde
eigengewichtroute werkt. Zowel de gewone puntlastcase als het aparte
eigengewichtgeval zijn via de echte Rust-sidecar op evenwicht en residu getest.
De gewone Rust-app-route lost dit model matrixvrij
op met vier threads; 863 elementen leveren eindige spanningen, sluitend
krachtenevenwicht en een relatief residu van 8,47·10⁻¹⁰. De axiale truss uit
de afzonderlijke Volume Workbench is hier niet opgenomen omdat de gewone
3D-editor daarvoor nog geen eigen truss-object heeft. Het grotere model van
55.232 volumes blijft in die workbench beschikbaar.

Voor de gewone 3D-editor staat nu ook
`docs/verificatie/3d-volume/groot-gemengd-2248-volumes.ifcfem2d` klaar:
972 knopen, 1.872 Tet4, 376 Hex8, één gekoppelde buigende staaf, wisselende
E-moduli, dichtheid, opleggingen en tien knooplasten. Een knop in de lege
editor bouwt dezelfde grote variant. De projectroute via de echte Rust-sidecar
en vier threads convergeert in 229 matrixvrije PCG-iteraties met een relatief
residu van 9,67·10⁻¹⁰, eindige spanningen en sluitend krachtenevenwicht.
Openen, selecteren en berekenen zijn ook in de draaiende gewone 3D-app
gecontroleerd; die toont 2.248 volumes en een maximale verplaatsing van
0,001362 mm. De volume-eigenschappen zijn ingedeeld in geometrie, materiaal
en resultaatgroepen met een compacte spanningssamenvatting. Dit is een
app-acceptatieproef op duizenden volumes, nog geen 250.000-volumeproef in de
gewone editor.

De gewone 3D-editor biedt daarnaast een knop voor de onregelmatige grote
variant met 18.999 knopen, 46.080 Tet4, 9.152 Hex8 en één buigende staaf.
Het opgeslagen project `docs/verificatie/3d-volume/groot-gemengd-55232-volumes.ifcfem2d`
bevat dit model. `design-mockup/accept-frame3d-large-55k.mjs` leest dat
bestand via de gewone projectparser, bouwt de invoer via de app-adapter, roept
de echte actuele `native-mixed3d`-binary aan en controleert
55.232 volume-uitkomsten, eindige spanningen en kracht- en momentbalans. De
gevalideerde release-run gebruikte vier threads, 650 PCG-iteraties en een
relatief residu van 9,524·10⁻¹⁰. Ook de gewone 3D-viewer heeft de 55.232
volumes en de verkenner getoond. Vanaf 10.000 volumes lost de app de
belastinggevallen en combinaties na elkaar op, zodat niet voor elk geval
tegelijk een grote native mesh/cache/resultaatbuffer leeft. De volledige
browserberekening met vijf combinaties is geslaagd; de grootste verplaatsing
is 0,003367 mm. In de resultaatweergave worden reactievectoren alleen nog op
opgelegde knopen getekend; residuen op vrije knopen verhullen het grote model
niet meer. De volume-eigenschappen tonen Tet4/Hex8, elementnummer en
knoopconnectiviteit in een compact raster. Een 250.000-volumegeval in de
gewone editor is nog niet als acceptatieproef afgerond.

De volgende grotere variant gebruikt een 64×48×28 basisnet met vervormde
geometrie, een holte, L-uitsparing, wisselende E-moduli en een buigende staaf.
Na de uitsparingen blijven 215.040 Tet4, 42.688 Hex8 en 84.746 knopen over.
De genegeerde release-acceptatietest
`mixed3d_irregular_large_release_acceptance::massive_irregular_250k_matrix_free_four_threads`
lost dit model op vier threads in 56,6 s en 1.249 PCG-iteraties op, met relatief
residu 9,857·10⁻¹⁰, eindige spanningen en verplaatsingen, en sluitend kracht-
en momentevenwicht; de gemeten piek-RSS was 288.124 KiB. De handmatige
`design-mockup/accept-frame3d-massive-257k.mjs` stuurt dezelfde 257.728
volumes via de gewone TypeScript-app-adapter naar de actuele Rust-binary en
sluit in 1.250 PCG-iteraties en 56,9 s op residu 9,985·10⁻¹⁰ en evenwicht.
De lege 3D-editor kan dit model nu met een knop opbouwen. Eigen gewicht kan
in de 3D-belastinggevalstrook expliciet worden uitgeschakeld om de
afzonderlijke knooplastproef zonder 257.728 gegenereerde volumekrachten te
berekenen. De dev-app heeft dit model ook via de Berekenen-knop opgelost:
84.746 knopen en 257.728 volumes verschijnen in de 3D-viewer, en de actieve
knooplastcasus geeft Δmax = 0,006 mm en σvm,max = 2,618 MPa. Voor modellen
vanaf 100.000 volumes worden combinaties pas op aanvraag doorgerekend om geen
24 complete spanningsvelden tegelijk in browsergeheugen te houden. Eén UGT
6.10a-combinatie is vanuit de resultatenboom gekozen en apart opgelost:
Δmax = 0,007 mm, σvm,max = 3,534 MPa, matrixvrije PCG op vier threads,
1.250 iteraties en relatief residu 9,99·10⁻¹⁰. De Hex8-eigenschappen,
spanningscomponenten en vermelding van acht Gauss-punten zijn daarna in de
app bekeken. Dit valideert deze
lineaire modelroute, niet algemene GNL/FNL- of normtoetsing van volumes.

Een tweede groot bestand,
`docs/verificatie/3d-volume/groot-gemengd-2248-volumes-96-membranen.ifcfem2d`,
koppelt op de bovenste Hex8-knooppunten 96 Tri3-membranen aan dezelfde 2.248
volumes en 3D-staaf. Het bevat een afzonderlijk belastinggeval met globale
oppervlaktelast op de membranen. Een app-adapterfout die dit ondersteunde
gemengde model vóór de Rust-aanroep afwees, is hersteld; de zuivere
raamwerkroute blijft losse platen weigeren. De bestandsproef controleert de
gemonteerde belasting via onafhankelijke driehoeksoppervlakten (10,012844 kN),
reacties, eindige membraanspanningen, 221 matrixvrije PCG-iteraties en relatief
residu 9,40·10⁻¹⁰. Onder precies dezelfde knooplasten daalt de compliantie
van 1,022·10⁻⁵ naar 3,981·10⁻⁶ kNm wanneer de membranen meedragen. Het
bestand opent en rekent ook via **Berekenen** in de dev-app; plaat 1 toont
σ11 = 0,078 MPa en N11 = 6,223 kN/m. De lege editor heeft een knop voor dit
model. De routeproef controleert daarnaast lineaire superpositie van twee
belastinggevallen in een combinatie; de app toont 15 afgeleide combinaties.
Deze proef valideert lineaire Tri3-vlakspanning op het volumeoppervlak,
geen buigplaat of niet-lineaire plaat/volumekoppeling.

De reproduceerbare generator
`scripts/verification/generate_large_mixed_membrane_app_fixture.py` voegt
768 conforme Tri3-membranen en een afzonderlijk bovenvlaktractiegeval toe
aan het opgeslagen 55.232-volumeproject met één raamstaaf. Het resultaat
`docs/verificatie/3d-volume/groot-gemengd-55232-volumes-768-membranen.ifcfem2d`
is via de gewone app-adapter in vier threads met matrixvrije PCG opgelost:
642 iteraties, relatief residu 9,70·10⁻¹⁰. Onafhankelijke integratie van de
driehoeksoppervlakten geeft 9,997698 kN horizontale belasting; de
steunreacties sluiten. Bij dezelfde equivalente knooplasten daalt de
compliantie door de membranen van 1,073·10⁻⁵ naar 4,055·10⁻⁶ kNm. De
handmatige acceptatie staat in `design-mockup/accept-frame3d-large-membrane-55k.mjs`.
De gewone browser-devapp heeft dit bestand met 18.999 knopen geladen en
doorgerekend; het oppervlaktekrachtgeval geeft 0,0007924 mm maximale
verplaatsing en de op aanvraag gekozen UGT 6.10a-combinatie 0,001814 mm.
Vanaf 50.000 volumes worden combinaties nu pas bij selectie doorgerekend;
de twee afzonderlijke belastinggevallen blijven direct beschikbaar.
Ook dit is lineaire membraankoppeling; buigplaat/volume en een gezamenlijk
GNL/FNL-lastpad blijven open.

De gemengde `sparseDirect`-route assembleert de Tet4/Hex8/staafstijfheid nu
rechtstreeks in CSR via een tweepassige patroonbouwer, zonder tussentijdse
`math::Matrix`-opslag. Een analytische 60-Hex8-trekstaaf met 732 DOF volgt
`u = FL/(EA)` en sluit op sparse PCG; een gemengd Tet4/Hex8/raamwerk met
657 vrije DOF sluit eveneens op sparse PCG. De route weigert modellen boven
10.000 DOF voordat factorisatie start en heeft expliciete grenzen voor het
CSR-patroon en de LDLT-vulling. Dat maakt directe factorisatie beheersbaar
voor middelgrote modellen; de matrixvrije route blijft nodig voor grote
modellen en 250.000-elementenacceptatie.

Een lineair Tri3-vlakspanningsmembraan deelt inmiddels in `mixed3d` de
translatie-DOF's met Tet4, Hex8, trekstaven en frames en levert lokale
spanningen/resultanten. Een onafhankelijke solid-membraanreferentie en
frame-membraanproeven zijn op de beschikbare backends geslaagd. De gewone
3D-tool kan een driehoekige plaat nu expliciet als Tri3-membraan met E, ν en
dikte bewaren en samen met Tet4, Hex8 en staven door de normale knop
**Berekenen** sturen. Een globale uniforme plaatvlaklast wordt consistent als
A·q/3 per knoop geïntegreerd. Het bewaarde voorbeeld
`docs/verificatie/3d-volume/tet4-tri3-membraan.ifcfem2d` en de echte
Rust-app-route controleren met een analytische parallelstijfheidsreferentie
zes backendkeuzen, spanningen/resultanten, evenwicht, twee lastgevallen,
combinatie en automatisch eigen gewicht; een afzonderlijke Hex8/Tri3-proef
toetst dezelfde gedeelde knoopinterface. Het voorbeeld is via de normale
**Berekenen**-knop in de dev-app opgelost: 0,02855 mm maximale verplaatsing;
de plaat-eigenschappen tonen σ11 = 0,091 MPa en N11 = 7,310 kN/m in het
actieve knooplastgeval. De aanvankelijke blokkade in de app-oplosserkeuze en
een verouderde dev-brugbinary zijn daarbij gevonden en hersteld. Het 3D-rapport
neemt nu volume-invoer, spanningen, backend en membraanresultanten op. Deze
Tri3 voert alleen lineaire
vlakspanning; buigstijfheid, plaat/volume-GNL/FNL en een algemene
buigplaat/volume-interface blijven open.

### Eerste gedeelde 3D-staaf/volumekoppeling (7 oktober 2026)

Branch `codex/rust-solver-unified-assembly` voegt `mixed3d` toe: lineaire
Tet4- en Hex8-volumestijfheid en axiale 3D-staven worden elementgewijs op
dezelfde drie translatievrijheidsgraden per knoop geassembleerd. De getypeerde native
dispatcher en TypeScript-client bereiken dit pad; dense, sparse-direct en
frontale wavefront geven dezelfde oplossing. Een onafhankelijke eenheids-Tet4
met gedeelde staaf controleert analytisch de verplaatsing, afzonderlijke
staafkracht, Tet4-spanningen, reacties en evenwicht. Een schuine staaf toetst
ook de koppeling in alle drie richtingen. De app-transportproef doorloopt de
drie backends. Een tweede, onafhankelijk geïntegreerde affiene proef koppelt
vier Hex8- aan 24 Tet4-elementen op een gedeeld negenknopig grensvlak en
controleert de vrije interfaceverplaatsing, reacties en alle Gauss-spanningen.
Het reproduceerbare `examples/mixed3d-hex8-tet4-truss.json` bevat één Hex8,
twee aansluitende Tet4 en een diagonale staaf in dezelfde berekening; de
getypeerde dispatcher, drie backendkeuzen, app-transport, globale krachtbalans
en uitvoer per elementtype zijn getoetst. Een afzonderlijke analytische
GNL-Tet4-proef met eindige rek en Poissonreacties slaagt, maar deze GNL is nog
niet aan de gemengde assemblage gekoppeld. De dense route is expliciet begrensd op 600 DOF en de
geassembleerde directe route op de bestaande matrixlimieten. Deze mijlpaal
bewijst geen 250.000-elementenmodel met gekoppelde elementen.

Open: volledige niet-lineaire 3D-ramen, plaat/volume-interfaces,
kwadratische volume-elementen,
niet-lineaire volume- en staafmateriaalwetten per element, GNL/FNL in het gedeelde
stelsel, mesh- en UI-modelworkflow, automatisch backendherstel en een grote
gekoppelde acceptatieproef. De bestaande afzonderlijke 3D-solvers blijven
beschikbaar maar vormen nog geen algemene gekoppelde kernel.

De gemengde route accepteert nu optioneel één E/ν-wet per Tet4 via
`tetMaterials`, naast de bestaande materiaalgegevens per Hex8 en staaf.
Een onafhankelijke proef met twee Tet4-sectoren met verschillend E/ν en een
gedeelde staaf geeft de gesloten drie-parallelle-stijfhedenoplossing. Dense,
sparse-direct en frontaal stemmen overeen; een verkeerde materiaal-lijstlengte
wordt geweigerd. De TypeScript-app-route controleert dat een gewijzigde
Tet4-modulus daadwerkelijk de analytisch verwachte knoopverplaatsing geeft.
Deze lineaire heterogeniteit maakt nog geen GNL/FNL-materiaalhistorie in de
gemengde assemblage mogelijk.

De gemengde route heeft nu ook expliciet `sparsePcg`: twee-pass CSR-patroonbouw
assembleert gedeelde Tet4-, Hex8- en staafbijdragen, waarna Jacobi-PCG het
opgelegde stelsel oplost. De bestaande analytische koppelproeven lopen voor
deze vierde backend; een onafhankelijke affiene 300-Hex8-proef met 1.452 DOF
gaat over de dense grens, controleert alle knoopverplaatsingen en Gauss-
spanningen en convergeert. Het backend meldt zijn iteratieaantal. Omdat deze
eerste gemengde route nog alle lokale stijfheidsmatrices vasthoudt, wijst een
voorafgaande 8 miljoen-entry-grens grote invoer af vóór assemblage. CSR-PCG
levert geen algemene inertiecertificering bij onbelaste mechanismen; een
grote gekoppelde acceptatieproef en robuuste mechanismecontrole blijven open.

Een nieuwe expliciete `matrixFreePcg`-route gebruikt de bestaande compacte
Tet4-operator en de algemene compacte Hex8-operator samen met axiale
staafproducten in één globale Jacobi-PCG-iteratie. Deze route houdt geen lokale
12×12/24×24-matrices of globale CSR vast en ondersteunt `threads` 1–32.
Het `mixed3d`-JSON-model sluit op de directe referentie; een aparte affiene
945-DOF-proef met 96 Hex8, 576 Tet4 en één staaf controleert de onafhankelijke
vlaklasten, interfaceverplaatsingen, reacties, spanningen en staafkracht op
één en vier threads. Alle bestaande kleine gemengde referenties en de
app-transportproef slagen ook met deze vijfde backend. De globale grens is
1,2 miljoen DOF; de Hex8-cache volgt zijn bestaande expliciete 1-GiB-budget.
De twee iteratieve gemengde backends toetsen nu de zes starre bewegingen per
verbonden elementcomponent, ook bij nulbelasting. Een regressie met twee losse
Tet4-componenten wijst een onopgelegde tweede component af; met beide
componenten opgelegd convergeert de nulbelasting. Verbinding alleen via een
knoop of rand kan nog een intern scharnier vormen. Voor een zuivere
Tet4- of Hex8-mesh gebruiken beide iteratieve `mixed3d`-backends daarom
ook een face-verbonden zes-modi-rangcontrole: twee bij één knoop verbonden
volumes met slechts één opgelegd lichaam worden bij nulbelasting afgewezen;
met beide lichamen zelfstandig opgelegd blijft nul iteraties geldig. Twee
Hex8's die een volledig vlak delen blijven terecht als één stabiel lichaam
geldig. Algemene gemengde Tet4/Hex8/staaf/membraanverbindingen vragen
nog een aparte rang-/inertiecontrole. Een aparte, genegeerde
release-acceptatieproef met
259.308 volume-elementen (222.264 Tet4 en 37.044 Hex8), één gekoppelde staaf,
238.521 DOF en vier threads slaagt tegen onafhankelijke affiene
verplaatsings-, spannings-, kracht- en evenwichtsreferenties: 264 PCG-iteraties,
relatief residu 9,461e-10, 36,25 s oplostijd en circa 265 MiB piek-RSS op de
testhost. Deze proef valideert de schaal van een *lineair* conform gemengd
model; onregelmatige geometrie, plaat/raamwerk-koppeling en gedeelde
GNL/FNL-iteraties blijven open. Het gemengde voorbeeld is nu vanuit de
Volume Workbench te laden, op te lossen en als knoop-/elementresultaten te
bekijken.

De gedeelde `mixed3d`-invoer accepteert nu per Tet4 en Hex8 ook uniforme
volumekrachten en vlaktracties. Tet4 gebruikt de consistente V/4- en
A/3-knooplasten; Hex8 gebruikt de bestaande 2×2×2- en 2×2-Gaussintegratie
met controle van de uitwendig georiënteerde lokale vlakknopen. Een
onafhankelijke eenheidskubus-/tetraëderproef vergelijkt de handmatig
geïntegreerde knooplasten met verplaatsingen, reacties en staafkracht van alle
vijf backends, inclusief matrixvrije PCG op één en vier threads. Het tweede
app-voorbeeld `mixed3d-distributed-loads.json` bevat beide volumekrachten,
beide vlaktracties en een afzonderlijke knooplast; de Volume Workbench kan
beide voorbeelden en een eigen JSON-modelbestand laden. Deze uitbreiding
blijft lineair elastisch en gebruikt nog geen verdeelde staaflasten.

De gemengde 3D-route heeft daarnaast `backend: "automatic"`. Die probeert
eerst de matrixvrije parallelle PCG-route en probeert bij aantoonbare
niet-convergentie op maximaal 10.000 DOF de frontale wavefront-route. De
werkelijk gebruikte backend staat in het resultaat. `maxPcgIterations` is
begrensd instelbaar, zodat een te korte PCG-run reproduceerbaar naar de
frontale route kan gaan. Beide pogingen lenen hetzelfde model zonder een
volledige mesh-kopie. Drie gerichte getypeerde tests controleren normale
matrixvrije selectie, frontaal herstel na één PCG-iteratie en dat een
ongeldige staafdoorsnede niet als oplosfout wordt verhuld. Deze fallback is
bewust begrensd; voor grotere modellen of fysische mechanismen volgt een
expliciete fout in plaats van een onbewezen direct resultaat. Het derde
app-modelbestand `mixed3d-automatic-fallback.json` dwingt de korte PCG-run
af en controleert via de app-client dat de frontale route werkelijk is gebruikt.

### Lineaire buigende 3D-staaf met Tet4/Hex8 (8 oktober 2026)

`mixed3d` assembleert nu ook de bestaande 12-DOF Euler-Bernoulli-raamwerkstijfheid
met Tet4, Hex8 en axiale staven op gedeelde translatieknopen. Drie rotaties
worden alleen voor knopen met een buigende staaf aangemaakt. Het model accepteert
knoopmomenten en voorgeschreven rotaties en rapporteert knooprotaties,
momentreacties en lokale staafeindkrachten. Dense, sparse-direct, sparse PCG en
frontale wavefront zijn beschikbaar; `automatic` probeert matrixvrije PCG en bij
niet-convergentie tot 10.000 DOF de frontale route. Een onafhankelijke
Tet4-schuifveer met een buigende uitkraging en een afzonderlijke Hex8-proef
met exact geïntegreerde hoekvormfunctie toetsen seriecompliantie, reacties,
spanningen, momenten en backend-overeenkomst. Een aanvullende gelijktijdige
dwarskracht- en torsieproef op het gedeelde Tet4/raamwerkknooppunt vergelijkt
de staafverdraaiing met `TL/(GJ)` en bevestigt dat de torsie de onafhankelijke
Tet4-schuifverplaatsing en buigrespons niet wijzigt. Alle zes lineaire
backends leveren dezelfde rotatie-, spannings- en reactiereferenties.
De nieuwe modelinvoer is via de native dispatcher en de draaiende
browserbrug opgelost.

Deze koppeling is lineair elastisch, zonder staaflasten of eindvrijgaven.
De geassembleerde framebackends houden lokale matrices vast en begrenzen die
op 8 miljoen entries. `matrixFreePcg` combineert inmiddels de compacte
Tet4- en Hex8-operatoren, axiale staafproducten en opgeslagen 12×12-
raamwerkmatrices zonder globale CSR of opgeslagen volumefrontalen. De
zes starre modi worden per verbonden component getoetst, inclusief
rotatieopleggingen. Een onafhankelijk geïntegreerd Tet4/Hex8/raamwerkmodel
controleert seriecompliantie, spanningen, momenten en reacties op één en vier
threads. Een tweede model met 150 Hex8, één Tet4 en één buigende staaf heeft
657 vrije DOF, passeert de dichte-matrixgrens en stemt met sparse PCG overeen.
Het nieuwe versieerbare invoerbestand
`examples/mixed3d-all-types-analytic.json` zet Tet4, Hex8, Tri3-membraan,
axiale trekstaaf en 12-DOF-raamwerk in één gedeeld negenknoops model.
De onafhankelijke energiecontrole telt voor een eenheidsverplaatsing de vijf
stijfheidsbijdragen op. Een tweede belastingrichting controleert tevens
Tet4-/Tri3-schuif en de ingeklemde raamwerkbuiging met `12EI/L³`.
Alle zes backends stemmen voor beide richtingen overeen met de analytische
verplaatsing, afzonderlijke spanningen/krachten en het globale evenwicht.
Het bestand is ook als voorbeeld in Inzicht → 3D volumeproef → Gemengd 3D
beschikbaar. De draaiende dev-app lost het via de echte browserbrug op met
matrixvrije PCG: `|u|max = 6,5646·10⁻⁶ m`, relatief residu
`1,7764·10⁻¹⁶`, één iteratie; membraan-, volume-, trekstaaf- en
raamwerkkrachten zijn zichtbaar. Dit is een kleine lineaire gekoppelde
referentie en bewijst geen algemene plaatbuiging of GNL/FNL in het gedeelde
stelsel.
Een geforceerd te korte matrixvrije run met het raamwerkmodel valt bij
`automatic` aantoonbaar terug op de frontale oplosser en behoudt de
analytische buiguitkomst.
De bijgewerkte browserbrug lost het versieerde model op met `matrixFreePcg`
in drie iteraties en een relatief residu van 1,07·10⁻¹⁵. De matrixvrije
route begrenst het gemengde stelsel op 1,2 miljoen DOF en erft het
Hex8-cachebudget; raamwerkmatrices zijn nog opgeslagen per staaf. De
nieuwe genegeerde releaseproef
`mixed3d_matrixfree_frame_250k_release_acceptance` bevat 222.264 Tet4,
37.044 Hex8, één axiale staaf en één buigende 3D-staaf op de gedeelde vrije
interface: 259.308 volume-elementen, 79.508 knopen en 238.530 DOF. Op vier
threads lost zij in 264 PCG-iteraties op; gemeten oplostijd 10,084 s,
relatief residu 9,755·10⁻¹⁰ en piek-RSS 272.772 KiB op de testhost.
Onafhankelijke affiene spannings- en oppervlaktekrachtintegratie plus de
Euler–Bernoulli-tipcompliantie toetsen verplaatsingen, spanningen, reacties,
staafkracht en raamwerkeindkrachten. Maximale verplaatsingsafwijking:
1,104·10⁻¹¹ m; maximale spanningsafwijking: 3,028·10⁻⁷ MPa. De affiene
solide vervorming wordt met een berekend framekrachtpaar afgedwongen;
dit is een schaal- en koppelproef, geen validatie van willekeurige
onregelmatige geometrie of GNL/FNL-koppeling.
Een tweede genegeerde releaseproef,
`mixed3d_irregular_large_release_acceptance`, vormt een onregelmatig
L-vormig model met binnenholte, geometrische vervorming, gedeelde
Tet4/Hex8-interface, per element wisselende E-moduli, een diagonale
axiale staaf en een buigend 3D-raamwerk. Negen knopen dragen plaatselijke
lasten; de vrije raamwerktip draagt kracht en moment. De grote variant
heeft 46.080 Tet4 en 9.152 Hex8 (55.232 volume-elementen) en 18.999
knopen. De matrixvrije vier-thread release-run slaagt in 645 iteraties:
6,135 s oplostijd, relatief residu 9,873·10⁻¹⁰ en gemeten piek-RSS
64.516 KiB. De proef toetst globale kracht- en momentbalans,
raamwerktipkrachten, eindige en niet-uniforme spanningen en verplaatsingen;
een kleine variant vergelijkt sparse PCG en matrixvrije PCG. Dit is
numerieke acceptatievalidatie, zonder onafhankelijke analytische
verplaatsings- of spanningsreferentie voor de onregelmatige geometrie.
De 3D-volume-editor kan hetzelfde onregelmatige model als kleine of grote
variant in het geheugen genereren, tonen en via de native app-route oplossen.
De grote variant toont een isometrische uitsnede met 1.344 zichtbare vlakken,
de open holte, L-uitsparing, Tet4/Hex8-zones, trekstaaf en raamstaaf,
naast een vlakke doorsnede.
De grote browserinvoer heeft 18.999 knopen en circa 5 MiB JSON; de lokale
dev-brug retourneerde HTTP 200 met circa 19 MiB resultaten: matrixvrije PCG,
645 iteraties en relatief residu 9,862·10⁻¹⁰. Die debug-aanroep duurde
120,6 s op de testhost, inclusief opstart, transport en serialisatie.
Een oplossing via de browserknop gaf eveneens 645 iteraties,
relatief residu 9,873·10⁻¹⁰ en een zichtbaar overzicht van
verplaatsings- en spanningsmaxima.
Resultaattabellen worden begrensd op 24 regels; samenvattende extremen
gebruiken alle knopen en elementen. De app-weergave is een modelinspectie,
geen constructieve ontwerpcontrole.
De matrixvrije route toetst daarnaast raamwerkclusters op relatieve starre
bewegingen ten opzichte van het volume; een truss naar een volumeknoop
levert daarbij alleen zijn axiale beperking. Een nulbelast frame dat slechts
op één volumeknoop scharniert, ook met één axiale truss, wordt daardoor
afgewezen in plaats van als schijnbaar geconvergeerd gemeld. Complexere
trussnetwerken en interne scharnieren vragen nog een algemene rangcontrole;
trussankers die niet op het volume of een volledig opgelegde knoop eindigen
worden in de matrixvrije frame-route voorlopig expliciet afgewezen.
Een afzonderlijke Tet4/volledig 3D-raamwerk-proef legt dwarskracht, buigmoment
en torsie gelijktijdig op de gedeelde vrije tip. Gesloten Tet4-schijfstijfheid,
Euler–Bernoulli-buiging, Saint-Venant-torsie, lokale eindkrachten, spanning
en reacties sluiten op dense, directe sparse, frontale en matrixvrije
backends (`tests/mixed3d_tet_frame_tip_wrench_reference.rs`).
GNL/FNL in het gedeelde stelsel en plaat/volume-interfaces blijven open.

De 3D-raamwerkroute berekent de relatieve Newton-verplaatsingsverandering en
het vrije evenwichtsresidu nu met geschaalde componenten, ook voor het
lineaire frontale resultaat. Een analytische
regressie met eindige componenten van 10¹⁵⁵ en 10¹⁵⁴ controleert de
verhoudingen 1/√101 en 0,1; een volledige frontale uitkragingsproef met
een eindige last van 10¹⁵⁵ controleert dat beide rapportagematen eindig
blijven. Het eerdere kwadrateren kon daarbij overlopen.
De lineaire Tet4-route gebruikt voor de matrixvrije PCG en de controle van
CSR-/frontale oplossingen eveneens een overloopbestendige Euclidische norm.
Bij een niet-eindige PCG-stap volgt een fout in plaats van een schijnbaar
geconvergeerde uitkomst. Twee gerichte Tet4-proeven controleren een juiste
residuverhouding bij zeer grote eindige lasten en expliciete afwijzing van
een niet-eindige iteratie. Dit is numerieke foutafhandeling, geen bewijs
dat extreme lasten fysisch zinvolle resultaten opleveren.
De opnieuw gebouwde releasekern lost de 35³-celpatch met 257.250 Tet4-
elementen en 139.968 DOF op vier threads in 197 iteraties op: werkelijk
relatief residu 8,684·10⁻⁹, maximale analytische verplaatsingsfout
5,613·10⁻¹² m, 1,87 s en 64.464 KiB piek-RSS op deze machine. Dit
controleert dat de geschaalde PCG-norm de bestaande grote affiene patch
nog oplost; algemene modellen vragen afzonderlijke acceptatieproeven.
Ook de gedeelde CSR-Jacobi-PCG berekent de belasting- en residunorm nu
geschaald en wijst een niet-eindige norm vóór acceptatie af. Een onafhankelijke
2×2 SPD-oplossing met stijfheden tot 10³⁰⁸ en een eindige kracht van 10¹⁵⁵
controleert beide verplaatsingen en het werkelijke residu. Alle negen
gerichte CSR-tests, waaronder de 50.000-DOF-schaalproef, slagen.
De gekoppelde 2D-raamwerk/membraan-GNL controleert convergentie nu met
overloopbestendige normen over uitsluitend vrije DOF's. Een gerichte
regressie met 10²⁰⁰ kN belasting en 10¹⁵³ kN vrije onbalans controleert
de verhouding 10⁻⁴⁷; een grote last op een vaste DOF kan een vrij residu
niet meer verbergen. De andere 2D-raamwerk-Newtonmaten moeten nog
afzonderlijk worden geaudit.
De gestructureerde en algemene matrixvrije Hex8-routes delen nu dezelfde
geschaalde vrije-DOF-norm in PCG. Een analytisch 2×2 SPD-stelsel met
stijfheden van 10³⁰⁸ en een eindige belasting van 10¹⁵⁵ controleert
beide verplaatsingen en de werkelijke vrije onbalans. Een niet-eindige
belasting- of iteratienorm geeft een gerichte fout vóór acceptatie.
De opnieuw gebouwde releasebenchmark van de gestructureerde 63³-celpatch
rekent 250.047 Hex8-elementen en 786.432 DOF met vier threads in 1.504
iteraties door: relatief residu 9,682·10⁻¹⁰, maximale analytische
verplaatsingsfout 4,784·10⁻¹³ m, 88,87 s en 123.836 KiB piek-RSS op
deze machine. Deze meting geldt voor de compacte, regelmatige route;
zij bewijst geen schaalbaarheid van willekeurige Hex8-connectiviteit.
Een afzonderlijke algemene `matrixFreeGeneralLarge`-acceptatieproef heeft
250.000 heterogene Hex8-elementen, 263.105 knopen en 789.315 DOF. De
doorsnede bevat 204 gescheiden vijfwaardige sterren; 100 lagen, globale
knoop-ID's en elementvolgorde zijn verwisseld. Een onafhankelijke
serieschakelingsoplossing en 2×2-oppervlakte-integratie controleren alle
knoopverplaatsingen en -reacties, Gauss-spanningen, krachtbalans,
vlakaanligging en positieve hoek-Jacobianen. Op vier threads slaagt de
genegeerde releaseproef met 408 iteraties, werkelijk relatief residu
9,966·10⁻⁸, 84,787 s en 1.195.624 KiB piek-RSS. De grootste afwijkingen
zijn 2,006·10⁻⁹ m, 2,247·10⁻⁴ kN per knoop en 6,792·10⁻⁴ MPa.
Deze vijfwaardige doorsnede wordt langs één as geëxtrudeerd; willekeurige
ongestructureerde 3D-topologie is daarmee nog niet bewezen.

Op 5 oktober is de lineaire DKT-buigplaat ook met een optionele
`linearBackend: "frontalWave"` aangesloten. De frontale route voegt de lokale
driehoekstijfheden en verticale/rotatieve veren elementgewijs toe en geeft de
maximale actieve frontgrootte terug. Twaalf gerichte Rust-proeven controleren
onder meer pariteit van verplaatsingen, reacties en momenten met de bestaande
route, een analytische één-DOF-proef, een voorgeschreven zetting,
mechanismeherkenning en de frontlimiet. De app-adapter stuurt de keuze door;
de CLI-vergelijking met de onafhankelijke TypeScript-DKT-assemblage en
`tsc --noEmit` slagen. Deze frontale route is alleen lineair elastisch;
wisselende secans-E blijft op de bestaande DKT-route.

De lineaire hybride Q4-buigplaat accepteert nu dezelfde optionele
`frontalWave`-keuze. Zij assembleert vierhoekstijfheden en oplegveren
elementgewijs; variabele plaatdruk, randlijnlasten, orthotropie, reacties
en momenten zijn tegen de bestaande route vergeleken. Drie gerichte
Rust-proeven controleren ook mechanisme, frontlimiet en afwijzing van
FNL/GNL-verzoeken. De TypeScript-client geeft de backend en frontlimiet
door; de CLI-appvergelijking en TypeScript-controle slagen. De frontale
Q4-route is uitsluitend lineair elastisch.

De hybride Q4-frontale route is daarnaast op een 14×14-vierkantsrooster
met 675 DOF gecontroleerd. De middenzakking `−2,476638547·10⁻⁵ m`
ligt 0,772% van dezelfde onafhankelijke Navier-reeks; alle knoopreacties
en steekpuntmomenten stemmen met de bestaande solver overeen. Het vrije
residu is `2,045·10⁻¹³` en het maximale front 49 DOF bij limiet 64.
De 3D-plaatapproute probeert bij een specifieke iteratieve residu- of
convergentiefout op een begrensd lineair model de frontale backend en
vermeldt die keuze in de diagnose. De routeproef injecteert de eerste fout
en controleert de echte Rust-heroplossing en globale balans. Een apart
mechanisme blijft een fout en start geen fallback.

Ook het lineaire 3D-raamwerk heeft nu een optionele frontale backend.
Vijf gerichte Rust-proeven vergelijken axiale en biaxiale buiging,
oplegzetting, veren, vrijgaven, staaflasten en knikuitvoer met de bestaande
route, en controleren afwijzing van niet-lineaire analyses en frontlimieten.
De app kan bij dezelfde specifieke iteratieve convergentiefout voor een
begrensd lineair raamwerk frontaal herstellen; de app-route controleert de
heroplossing en onafhankelijke krachtenbalans. De expliciet frontale lineaire
route bouwt geen globale matrix meer op; de kleine optionele eigenknikberekening
houdt haar bestaande grens van 120 vrije en 600 totale DOF. Een fout wegens
ontbrekende stijfheid wordt niet via de frontale route verborgen.

Het lineaire 2D-raamwerk heeft nu eveneens een optionele
`linearBackend: "frontalWave"` met instelbare frontlimiet. Vier gerichte
Rust-proeven vergelijken de frontale route met de bestaande berekening,
inclusief bedding, opleg- en eindveren, vrijgaven, staaflijn-/puntlasten,
thermiek en opgelegde zetting. Gekoppelde membranen en niet-lineaire
analyses worden expliciet afgewezen. De 2D-approute probeert op een
begrensd zuiver raamwerk frontaal te herstellen na een specifieke
iteratieve convergentiefout; de routeproef controleert de echte Rust-
heroplossing en dat een mechanisme geen fallback krijgt. De globale
matrix wordt in de expliciet frontale lineaire route niet meer opgebouwd.
Een 7.000-staaf-proef met 21.003 globale DOF en een frontbreedte van
hoogstens vier controleert een gesloten axiale verplaatsing en reactie.
De standaard- en niet-lineaire routes gebruiken nog de globale matrix;
een groot breed gekoppeld front en willekeurige grote geometrie zijn nog niet
gevalideerd. De app kiest voor zuivere lineaire 2D-raamwerken boven
20.000 globale DOF rechtstreeks de frontale route; een echte 7.000-staaf-
appproef controleert de keuze, verplaatsing en reactie.

Een aanvullend 3D-raamwerk met 101 uitkragende armen aan één vaste knoop
heeft 612 globale DOF. De frontale route met maximaal zes actieve DOF
vergelijkt alle knoopverplaatsingen, reacties en staafeindkrachten met de
bestaande route en onafhankelijke axiale, buig- en torsieformules. Globaal
krachten- en momentenevenwicht sluiten; een limiet van vijf actieve DOF
wordt afgewezen. Dit test een smal front boven 600 DOF, geen algemene
grootschalige raamwerkfactorisatie.

Een afzonderlijke 2D-raamwerkproef met 201 uitkragende armen heeft 606
globale DOF. Beide lineaire backends stemmen voor elke tipverplaatsing en
staafeindkracht overeen; de frontale uitkomst volgt bovendien de gesloten
axiale en Euler-Bernoulli-buigformules. De wortelreacties sluiten op de
totale belasting en een frontlimiet van twee in plaats van drie DOF wordt
afgewezen. Ook deze proef heeft een smal front en is geen geheugentest voor
een breed gekoppeld rooster.

Een gekoppeld 2D-raamwerk met vijf vakken, drie verdiepingen, 36 staven,
72 DOF, asymmetrische lasten, oplegveren en een zetting houdt minstens
15 DOF tegelijk in het front. Alle knoopverplaatsingen, reacties en
staafeindkrachten sluiten op de bestaande backend; het totale krachten-
en momentenevenwicht en afwijzing van een te kleine frontlimiet slagen.
Dit vult de smal-front-proeven aan, maar test nog geen groot breed rooster.

Een gekoppeld ruimtelijk 3D-raamwerk met 72 DOF, 20 staven, gemengde lasten,
een oplegveer en een zetting houdt 25–30 DOF tegelijk in het front. De
frontale route sluit voor alle knoop- en staafresultaten op de bestaande
solver en voldoet aan globaal kracht- en momentevenwicht; een frontlimiet
van 24 wordt afgewezen. Daarnaast lost een 3.334-arm-model met 20.010
globale DOF en een front van zes zonder globale matrix op en volgt de
analytische axiale, buig- en torsieverplaatsingen, alle twaalf lokale
eindkrachtcomponenten en zes steunreacties bij belastingen in alle zes
tiprichtingen. De releaseproef heeft een evenwichtsresidu van 3,819·10⁻¹⁶.
De app kiest ook voor
zuivere lineaire 3D-raamwerken boven 20.000 DOF rechtstreeks frontaal;
de werkelijke app-CLI-proef met dit model slaagt. Een aanvullend verbonden
vierlaags 10×10-vaks raamwerk met 500 knopen en 1.120 buigende staven slaagt
via de app-adapter en in de ontwikkelapp; alle reacties sluiten op +100 kN
in X en −1.000 kN in Z en de getoonde maximale verplaatsing is 2,554 mm.
Dezelfde app-routetest slaagt ook met P-Δ; de dakdrift neemt toe, alle
verplaatsingen en staafresultaten blijven eindig en reacties en vrij residu
sluiten. De oorspronkelijke gekoppelde bronproef duurde 98,7 s op de testhost.
Met een minimum-degree-knoopblokvolgorde in de sparse LDLᵀ-
stabiliteitscontrole daalde de afzonderlijke P-Δ-kernproef van 125,16 naar
9,69 s bij numeriek identieke volledige resultaat-JSON; de actuele
app-routetest met beide analyses slaagt in 12,8 s. Ook de onafhankelijke
globale momentensom sluit, met voor P-Δ een afwijking van 0,0106 kNm op
circa 19.200 kNm wanneer de daklasten op de verplaatste knopen aangrijpen.
Het bestand opent standaard in tweede orde en de normale browserknop rekent
ook de vijf
combinaties af: maximaal 2,560 mm in het actieve geval tegenover 2,554 mm
in eerste orde.
Zie `docs/verificatie/3d-raamwerk/groot-raamwerk-acceptatie.md`. Dit valideert
nog geen willekeurig breed 250.000-stavenrooster of schaalbare eigenknik.

Een groter verbonden achtlaags 16×16-raamwerk bevat 2.304 knopen, 5.888
volledig buigende staven en 12.288 vrije DOF. Het opgeslagen project is in de
gewone 3D-editor geladen en daar ook lineair met vijf combinaties berekend;
het actieve geval toont Δmax = 1,342 mm. De Rust-app-adapter lost het actieve
belastinggeval lineair in 22,57 s en met P-Δ in 350,46 s op de testhost op.
Beide resultaten
hebben een sluitend vrij residu en onafhankelijke globale kracht- en
momentensom; de P-Δ-dakdrift neemt toe. De tweede-orde rekentijd is een
concrete schaalbeperking en de proef heeft geen gesloten referentie voor alle
individuele staafkrachten. Zie
`docs/verificatie/3d-raamwerk/raamwerk-5888-staven-acceptatie.md`.
De tijdelijke sparse LDLᵀ-vulling van de stabiliteitscontrole gebruikt nu
hashopslag met gesorteerde pivotburen en geeft afgeronde pivotopslag meteen
vrij. De entrygrens en pivotcontroles blijven gelijk. Een nieuwe
release-app-proef van hetzelfde raamwerk slaagde in 7,82 s lineair en
266,18 s P-Δ (274,45 s totaal, circa 631 MB piek-RSS), met dezelfde
afgeronde verplaatsingen en sluitende kracht- en momentbalans. De oudere
350,46 s-meting is niet een gelijktijdige A/B-controle; bij 1.120 staven
werd geen versnelling gemeten. De 515 Rust-unit-tests en tien
3D-raamwerkpariteitstests slagen. Willekeurige brede raamwerken en een
250.000-stavenacceptatie blijven open.

Een reproduceerbare grote DKT-proef gebruikt een vrij opgelegde vierkante
plaat (2×2 m, 14×14 cellen, 392 driehoeken, 675 DOF) met uniforme druk
`qz = −1 kN/m²`, `E = 30.000 MPa`, `ν = 0,2` en `h = 0,1 m`. Iedere
driehoek verdeelt de druk als `qA/3` over zijn drie verticale knoop-DOF;
alle randknopen hebben alleen `w = 0`, zodat de rotaties vrij blijven.
`tests/dkt_frontal_scale_validation.rs` vergelijkt alle knoopverplaatsingen,
reacties en elementmomenten met de bestaande Rust-route en de middenzakking
met een onafhankelijke Navier-dubbelreeks met 51×51 oneven modi (tot
harmonische 101). Het front bereikt
49 DOF bij een ingestelde limiet van 64; de middenzakking is
`−2,487899943·10⁻⁵ m` tegenover `−2,495909475·10⁻⁵ m` analytisch
(0,321% afwijking). Het vrije frontale residu is `2,153·10⁻¹³` en de
verticale steunreacties sommeren tot `+4 kN`.
Na deze aanvullingen slaagt `cargo test --locked -p openaec-native-fem
--all-targets`: 370 actieve unit-tests, één genegeerde test en 26
integratietests. De gerichte frontendproeven voor DKT, hybride Q4 en de
getypeerde client, plus `tsc --noEmit`, slagen eveneens.

Na de extra hybride Q4- en 3D-raamwerkproeven is dezelfde volledige
Rust-run opnieuw groen: 370 actieve unit-tests, één genegeerde test en
31 integratietests. Ook de 3D-app-routes voor plaat en raamwerk en de
TypeScript-controle slagen met de frontale fallback.

Na de 2D-raamwerk-, 3D-schaal- en meer-elementige betonschadeproeven is
`cargo test --locked -p openaec-native-fem --all-targets` opnieuw groen:
370 actieve unit-tests, één genegeerde test en 43 integratietests. De
2D- en 3D-app-routes, inclusief de grote frontale modellen, TypeScript-
typecheck en `rustfmt --check` slagen ook.

De volledige solver moet 2D- en 3D-lijnelementen, platen/schalen en 3D-
volume-elementen op één gecontroleerd modelcontract ondersteunen. Voor volume
zijn lineaire tetraëders en hexaëders de eerste elementfamilies; de keuze en
validatie van hogere orde volgen na patch-, buig- en meshconvergentieproeven.
De Rust-kern heeft nu een lineaire Tet4-volumeroute met echte knooplasten,
opleggingen, per-element E en ν, spanningen en vier expliciete lineaire
strategieën: matrixvrije Jacobi-PCG, CSR/PCG, directe sparse LDLᵀ en
frontale wavefront-eliminatie.
De getypeerde Tet4-invoer verwerkt ook uniforme lichaamskrachten en
vlaktracties als consistente knooplasten. Een experimentele kleine-rek
Tet4/J2-staalroute heeft nu globale Newton-stappen, geaccepteerde
plastische historie en adaptieve staphalvering. Sparse direct en frontaal
blijven begrensd op 1.800 DOF; de expliciete PCG-route heeft een afzonderlijke
limiet en toelatingscontrole.
Een aanvullende 2×2×2-Tet4-patch controleert gecombineerde hydrostatische
rek en plastische afschuiving, verplichte staphalvering en elastische
ontlasting tegen gesloten J2-formules voor equivalente plastische rek,
schuifspanning, centrumverplaatsing en dwarsreactie. Dit valideert een
uniform rekveld; niet-uniforme spanningsherverdeling blijft open.
`elementSteels` kan voor ieder J2-Tet4 een eigen E, ν, vloeigrens en
isotrope verharding opgeven. Alle Newton- en proefstap-evaluaties gebruiken
de wet van het betreffende element; geaccepteerde plastische historie blijft
per element bewaard. Een onafhankelijke drie-lagenstaaf onder eindtractie
volgt de analytische elastische serierelatie voor alle knoopverplaatsingen,
spanningen en eindreactie. Een afzonderlijke afschuifproef vergelijkt drie
verschillende plastische lagen met de scalaire J2-consistentierelatie en
controleert elastische ontlasting. Uniforme invoer is gelijk aan de oude
globale staalwet; foutieve lengtes en materiaaleigenschappen worden geweigerd.
Dit is nog geen gevalideerde algemene plastische spanningsherverdeling.
Voor de J2-Newtonstap is nu naast de standaard CSR-sparse directe LDLᵀ
ook begrensde frontale wavefront-eliminatie kiesbaar via
`options.linearBackend`. De frontale route bewaart de actuele 12×12
elementtangenten in plaats van een globale CSR-matrix, met instelbare
`maxFrontDofs` tot 256. Correctiestappen en nulresidu-tangentcontrole
gebruiken dezelfde backend; instabiliteit, asymmetrie of een mechanisme
worden niet stilzwijgend met een andere oplosser verborgen. Een
onafhankelijke heterogene serieproef en plastische afschuif-/ontlastproef
vergelijken beide routes met gesloten materiaal- en evenwichtsformules;
een te kleine frontlimiet wordt afzonderlijk afgewezen. Dit levert nog
geen grote J2-modelacceptatie of gekalibreerde constructieve staalcontrole.
De J2-route bouwt haar CSR-Newtonmatrix nu rechtstreeks uit een begrensd
knoopblokpatroon, zonder elementtriplets. Een expliciete
`linearBackend: "sparsePcg"` gebruikt parallelle Jacobi-PCG voor de
Newtoncorrectie met controle van het werkelijke lineaire residu. Deze keuze
vereist strikt positieve isotrope verharding per element, geen ongebruikte
knopen en zes onafhankelijke starre-lichaamsopleggingen per via volledige
driehoeksvlakken verbonden Tet4-groep; een knoop- of randverbinding alleen
kan daardoor geen verborgen scharnier maskeren. Niet-manifolde vlakken worden
afgewezen. De materiaalwet berekent de plastische radiale factor in positieve
vorm om een kleine verhardingstangent numeriek te bewaren. In exacte
rekenkunde is de kleine-rek J2-tangent dan positief definiet; de iteratieve
route heeft geen LDLᵀ-inertiecertificaat. Een 8×8×7-celpatch met 2.688
Tet4-elementen en 1.944 DOF volgt zowel de onafhankelijke elastische affiene
oplossing als een plastische scalaire radiale-terugkeeroplossing voor
verplaatsingen, materiaaltoestand en eindreactie. Een kleine plastische
belasting/ontlasting sluit op de directe route. De PCG-invoer is voorlopig
begrensd op 150.000 DOF en 300.000 elementen. Twee afzonderlijk opgeroepen
release-acceptatieproeven met 257.250 Tet4-elementen en 139.968 DOF slagen
op vier threads tegen de onafhankelijke affiene oplossing en de plastische
radiale-terugkeerformule. De optionele PCG-route begint nu bij de laatst
geaccepteerde toestand met
één elastische voorspelling voor het volledige doel van de stap; de plastische
historie blijft bevroren tot het werkelijke Newton-evenwicht sluit. Voor een
middelgrote vrije-interfaceproef daalde dit van zestien naar drie Newton-
correcties. De uniforme elastische en plastische grote proeven duren met deze
voorspelling respectievelijk 3,33 en 3,65 s, met 335.828 en 335.724 KiB
piek-RSS van het directe testproces. De maximale verplaatsingsfouten zijn
1,437·10⁻¹³ en 8,622·10⁻¹³ m; beide eindreacties sluiten. Een derde
257.250-elementenproef heeft twee materiaallagen met verschillende E,
vloeigrens en verharding en sluit op een afzonderlijk berekende plastische
serieschakeling: grootste verplaatsingsafwijking 5,757·10⁻¹⁴ m,
plastische-rekafwijking 2,482·10⁻¹³, spanningsafwijking 2,532·10⁻⁸ MPa,
eindreactie 250.000 kN, 5,84 s en 373.540 KiB piek-RSS.
Een vierde grote proef gebruikt een **vrije materiaalinterface** op `y=0,4`
met twee plastificerende lagen met verschillende E, ν, vloeigrens en
verharding. `u_x` is voorgeschreven op de twee eindvlakken, `u_z` is overal
vast en `u_y` is vrij behalve op de referentierand. Per laag levert een
onafhankelijke scalaire oplossing van
`σ_yy(ε_x,ε_y,0)=0` de dwarsrek, drie spanningen en plastische rek.
De exacte stukgewijs-affiene oplossing voldoet aan continuïteit van de
raakvlaktractie op de interface. Op 257.250 Tet4 en 139.968 DOF zijn de
maximale afwijkingen
3,961·10⁻¹⁵ m, 1,024·10⁻⁹ MPa en 4,896·10⁻¹⁵ equivalente plastische rek;
de rechterreactie is 156.144,9 kN en het vrije residu 2,688·10⁻⁸ kN.
De releaseproef duurt 26,50 s met 386.284 KiB piek-RSS. De vier proeven
valideren uniforme of stukgewijs-affiene velden. Een aparte 48-Tet4-proef
met twee niet-collineaire puntlasten heeft niet-affiene 3D-spanningen:
33 elementen plastificeren en 15 blijven elastisch. Rechtstreeks uit de
knoopcoördinaten gereconstrueerde Tet4-gradiënten controleren de gerapporteerde
spanning en plastische rek, vrije knoopevenwichten, reacties, globale kracht-
en momentbalans en virtuele arbeid. Het grootste krachtverschil is
6,97·10⁻⁸ kN; de sparse directe route geeft dezelfde verplaatsingen en
materiaaltoestand binnen de gestelde toleranties. Een tweede, geschaalde
eindvlak-schuifproef gebruikt een volledig ingeklemde zijde en verdeelde
vlaktractie. De kleine proef heeft 48 plastische en 336 elastische Tet4.
De expliciete releaseproef met 257.250 Tet4, 139.968 DOF en vier PCG-threads
heeft 113.330 plastische en 143.920 elastische elementen; zij sluit in één
geaccepteerde stap zonder cutbacks na 138,44 s. Uit de driehoekoppervlakken
en gerapporteerde elementspanningen onafhankelijk herbouwde knoopkrachten
geven maximaal 1,18·10⁻¹⁰ kN vrije-knoopfout; het gerapporteerde residu is
1,06·10⁻⁹ kN. Ook reacties, globale kracht-/momentbalans en arbeid sluiten.
Dit toetst één grote niet-affiene buig-/schuifconfiguratie, zonder tweede
globale oplosser of exact bekend verplaatsingsveld. Andere grote topologieën,
lastpaden en de precieze maximale invoergrenzen zijn nog niet als
praktijkmodellen gevalideerd. Slecht geconditioneerde geometrie, bijna
onsamendrukbaar materiaal en zeer kleine verharding kunnen
de iteratieve oplosser laten stagneren.
Een expliciete J2-`automatic`-strategie probeert eerst sparse LDLᵀ. Alleen
de herkenbare fout dat de opgegeven factoritemlimiet te klein is, activeert
voor de rest van die laststap de begrensde frontale route. De uitvoer noemt
de gebruikte backend van de laatste geaccepteerde stap en het aantal
geaccepteerde frontale hersteloverschakelingen. Onafhankelijke elastische
serie- en plastische afschuifproeven vergelijken gedwongen opslagherstel met
de gesloten referenties; een mechanisme en andere fouten blijven fouten.
Dit is geen algemene automatische herstelmethode voor alle oplos- of
materiaalinstabiliteiten.
Een numerieke J2-regressie toonde dat kwadrateren van een eindige vrije
kracht van `10²⁰⁰ kN` de norm naar oneindig liet overlopen en een onbelaste
beginstand ten onrechte kon accepteren. De J2-norm gebruikt nu geschaalde
`hypot`-accumulatie en meldt niet-representeerbare normen expliciet. Een
onafhankelijke één-DOF-Tet4-stijfheidsproef bewaakt de gewone elastische
uitkomst. J2, beton-Tet4 en GNL-Tet4 gebruiken bovendien gewogen interpolatie
van eindige lastdoelen; een omkering van `+10³⁰⁸` naar `−10³⁰⁸ kN` op een
gefixeerde knoop houdt de exacte eindreactie eindig. Niet-eindige tussenwaarden
en reacties worden afgewezen.
Een aanvullende 2×2×2-Tet4-proef dwingt opslagherstel pas af nadat de drie
vrije centrumdiagonalen nog binnen het budget passen maar de factorvulling
niet. De herstelde route doorloopt hydrostatische rek plus plastische
afschuiving, adaptieve staphalvering en elastische ontlasting. Alle knoop-
verplaatsingen en reacties, elementschuifspanningen en plastische rekken
sluiten op de sparse route en de eerder vastgelegde gesloten J2-oplossing.
Een begrensde experimentele Tet4-route voor betontrekschade is nu globaal
aangesloten met expliciete scheurbandbreedte, numerieke Newton-tangent en
analytische couponcontrole; de algemene 3D-betonrespons blijft open.
Een 6- en 24-Tet-homogene trekcoupon is bovendien tegen de onafhankelijk
geïntegreerde exponentiële breukenergiecurve gecontroleerd, inclusief
Poisson-krimp, alle elementspanningen/schadevariabelen, steunreacties en
secans-ontlasting. De dichte routegrenzen van 180 DOF en 300 elementen worden getest.
Dit betreft alleen homogene uniaxiale patches; willekeurige 3D-scheurvelden
en objectiviteit bij meshverfijning blijven open.
De optionele CSR-GMRES-route verwerkt ook asymmetrische en indefiniete
Newton-tangenten, controleert het werkelijke residu en begrenst de Krylov-
opslag. Zij is voorlopig begrensd op 12.000 DOF en 20.000 Tet4-elementen,
met afzonderlijke grenzen voor patroonopslag en iteraties. Een
726-DOF-/600-Tet4-trek-/ontlastcoupon sluit op de analytische schadecurve;
de kleine variant komt overeen met dichte LU. Ook de onbelaste rotatie-
mechanismeproef wordt afgewezen;
een onregelmatig 192-DOF-model met zowel beschadigde als intacte elementen
sluit op onafhankelijk herleid elementevenwicht, reacties en intern werk.
Een klein niet-affien model komt eveneens overeen met LU. De getypeerde
app-route en de matrixmethodekeuze zijn getest. GMRES-residu is geen bewijs
van matrixrang of een stabiele tak na de spanningspiek; algemene 3D-
scheurvelden, meshobjectiviteit en grote beton-FNL-modellen blijven open.
Een expliciete release-schaaldiagnose met 14³ cellen (16.464 Tet4,
10.125 DOF, 6.591 vrije binnen-DOF's) en affiene uniaxiale
randverplaatsingen bereikte de schadetoestand niet: bij het overschrijden van
de treksterkte liep de Newton-lijnzoektocht na 24 cutbacks vast rond fractie
0,600551 van de tweede laststap (vrij residu 1,914549·10⁻¹ kN; 441,72 s
rekentijd). Dit toont een convergentiebeperking op dit vrije-binnenknoop-
softeningpad, geen bewezen fout in de lokale materiaalwet; homogene
postpiekvelden kunnen onder deze randvoorwaarden lokaliseren. De aparte
release-schaaltest met 12³ cellen toetst daarom alleen de onbeschadigde
CSR-GMRES-assemblage, de analytische affiene verplaatsing/spanning en de
reactiebalans. Deze expliciet gedraaide proef slaagt met 10.368 Tet4,
6.591 DOF, 3.993 vrije DOF, één geaccepteerde stap, nul cutbacks en
3,119·10⁻⁹ kN vrij residu (1,43 s solve in release; 8,76 s inclusief
incrementele compilatie, 300.876 KiB piek-RSS). Groot-schalige beton-FNL met
schade blijft open.
De betonschade-Tet4-route kan optioneel een volledige `elementMaterials`-
reeks met E, ν, treksterkte, breukenergie en expliciete scheurbandbreedte
per element verwerken. Newton-evaluaties en geaccepteerde schadetoestand
gebruiken steeds het materiaal en de historie van datzelfde element. De
globale waarden blijven verplicht als compatibele standaard. Dit verandert
de status als experimentele couponwet niet: de bandbreedte wordt nog niet
uit geometrie en scheuroriëntatie afgeleid.
De onbeschadigde elastische tak gebruikt nu de exacte elastische tangent in
plaats van een centrale verschilquotient die bij een lage geldige treksterkte
de schadegrens kon overschrijden. Een onafhankelijke Tet4-krachtproef met
`f_t = 3·10⁻⁵ MPa` convergeert daardoor in één Newton-stap naar de gesloten
verplaatsing en een vrij residu onder `10⁻¹⁰ kN`. De beschadigde tak behoudt
de numerieke tangent en begrensde dichte LU; algemene 3D-schadevalidatie
blijft open.
Een onafhankelijke drie-lagenstaaf met verschillende E volgt onder eindtractie
de analytische elastische serieverplaatsing, spanning en reactie. Een
afzonderlijke voorgeschreven trek-/ontlastproef vergelijkt per laag de
exponentiële schadecurve, piekrek, ontlastspanning en buitenvlakreacties met
gesloten formules. Uniforme `elementMaterials` geven de bestaande globale
oplossing; foutieve lengte/kalibratie en de JSON-naamgeving worden getoetst.
De proef schrijft verplaatsingen voor aan alle knopen en bewijst dus geen
algemene schadegedreven spanningsherverdeling bij vrije binnenknoop-DOF's.
Een nieuwe tweelagenproef laat vier axiale grensvlak-DOF's vrij. De zwakkere
Tet4-laag beschadigt onder voorgeschreven eindverplaatsing; de sterkere laag
blijft elastisch. Een onafhankelijk gebisecteerde tweeverenwet controleert
grensvlakverplaatsing, spanning en schade per element, geschiedenis bij
ontlasten, vrije grensvlakreacties en beide eindreacties. Daarmee is één
schadegedreven herverdeling met vrije binnenknopen gevalideerd; algemene 3D-
scheurvelden, meshobjectiviteit en postpiek-evenwicht blijven open.
De getypeerde app-route voert hetzelfde beschadigings-/ontlastpad door en
controleert de onafhankelijke grensvlakverplaatsing, beide laagtoestanden,
reacties en vrij residu.
De J2-staal- en betonschade-Tet4-routes accepteren nu ook vaste
lichaamskrachten per referentievolume en nominale vlaktracties per
referentieoppervlak op elk belastingsdoel. De equivalente knooplasten
V·b/4 en A·t/3 lopen mee in het adaptieve lastpad. Een onafhankelijke
Tet4-proef vergelijkt de afzonderlijke knoopreacties met handmatig
geïntegreerde volume- en vlaklasten, ook bij omkering en wegnemen van de
lasten; plastische rek en betonschadegeschiedenis blijven behouden.
Een aparte totale-Lagrangiaanse Tet4-route gebruikt Green-Lagrange-rek en
St Venant–Kirchhoff-elasticiteit, analytische materiaal- en geometrische
tangent, adaptieve Newton-stappen en echte vrije residuen. Een affiene
rekproef, starre rotatie, tangentverschil en het getypeerde app-transport
zijn gecontroleerd. De dichte standaardroute is begrensd op 180 DOF en
300 elementen; sparse en frontaal hebben de afzonderlijke grenzen hieronder;
zij dekt nog geen staalplastificatie, betonscheurvorming of algemene
materiaalwetten bij grote vervorming.
Optioneel voert `elementMaterials` een eigen E en ν per Tet4 door naar alle
Newton- en resultatenevaluaties. Een onafhankelijke drie-lagenstaaf met
48 DOF en 18 Tet4 vergelijkt belasting, omkering en ontlasting met de
zelfstandig gebisecteerde St Venant–Kirchhoff-serierelatie
`P = Eᵢ(Fᵢ³ − Fᵢ)/2`; alle knoopverplaatsingen, elementrekken,
Piola-spanningen, vrije residuen en eindreacties sluiten aan. Een expliciet
uniforme materiaalreeks geeft dezelfde uitkomst als de bestaande globale
E/ν-invoer; foutieve arraylengte wordt afgewezen. Dit is heterogeen
geometrisch niet-lineair elastisch materiaal, geen plastische of gescheurde
volume-FNL. Per Tet4-GNL-lastdoel zijn nu ook vaste lichaamskrachten per
referentievolume en nominale vlaktracties per referentieoppervlak mogelijk.
De consistente knooplasten V·b/4 en A·t/3 worden in het Newton-lastpad
geïnterpoleerd. Een onafhankelijke zes-Tet kubus onder nominale eindtractie
volgt de analytische eindige rek bij trek, drukomkering en ontlasting;
verplaatsingen, Green-rek, Piola-spanning, eindreactie en vrij residu sluiten.
Een gefixeerde Tet4 verifieert daarnaast elke knoopreactie onder gecombineerde
volume- en vlaklast, ook na volledig wegnemen van de lasten. De getypeerde
app-route voert beide lastvormen door. De tractie is een voorgeschreven
nominale vector op een benoemd vlak in de referentiegeometrie, geen
vervormingsvolgende druk.
Een optionele `elementEnergyBeta`-reeks voegt een per-Tet4, omkeerbare
rekafhankelijke elastische energie toe: `W = W₀ + βW₀²/(2E₀)` met
`W₀ = ½ E:S₀` en het eigen E₀ van elk element. Dit is een expliciet
gedefinieerde proefmateriaalwet, geen staal- of betonconstitutief model.
De tweede Piola-spanning `S = (1 + βW₀/E₀)S₀` en de consistente tangent
bevatten zowel geometrische als extra materiaaltermen; een 12×12
eindige-verschillentangenttest controleert β = 0, +50 en −50 bij ν = 0,3.
De uitvoer geeft per element `elementEffectiveEMpa = E₀(1 + βW₀/E₀)`.
Een onafhankelijke krachtgestuurde zes-Tet kubus volgt voor β = +40 en −20
de gebisecteerde scalaire relatie
`P = F E₀ e(1 + βe²/2)`, `e = (F²−1)/2`, over trek,
omkering en ontlasting. Alle knoopverplaatsingen, Green-rekken,
Piola-spanningen, effectieve E-waarden, afzonderlijke steunreacties en
vrije residuen sluiten; zes verschillende β-waarden per Tet4, β=0-pariteit,
JSON en invoerfouten worden apart getest. Matig negatieve β kan bij grotere
rek een niet-positieve tangent geven; de begrensde solver rapporteert dan
een fout. Hiermee is één experimentele gecombineerde volume-GNL/FNL-wet
getoetst, geen algemene 3D-FNL of gekalibreerde schade/plasticiteit.
De begrensde Tet4-GNL-Newtonroute kan via `options.linearBackend` kiezen
tussen dichte Cholesky (standaard), CSR-sparse directe LDLᵀ en frontale
wavefront-eliminatie van de actuele elementtangenten. Voorspelling,
Newton-correctie en nulrechterlid-tangentcontrole gebruiken dezelfde
gekozen factorisatie, terwijl het convergentiecriterium het echte
niet-lineaire vrije krachtresidu blijft. Een onafhankelijke krachtgestuurde
kubus met β=40 en een tweelagenligger met verschillende E en β vergelijken
alle knoopverplaatsingen, reacties, rekken, Piola-spanningen en effectieve
E-waarden met scalaire referenties; alle drie wijzen een rotatiemechanisme
af. Sparse en frontaal assembleren inmiddels uitsluitend de elementtangenten
en zijn afzonderlijk begrensd op 900 DOF, 1.200 Tet4, 500.000 sparse
factoritems en 256 vrije DOF frontbreedte. Een onafhankelijke affiene
5×5×5-celproef met 750 Tet4, 648 globale DOF en 192 vrije DOF vergelijkt
beide alternatieven bij β=0 en β=24 met analytische Green-rek,
Piola-spanning, effectieve E en per-knoop geïntegreerde eindvlakreacties.
De dichte standaardroute houdt haar 180-DOF/300-Tet4-grens. Deze stap
verwijdert de kwadratische globale GNL-tangentopslag bij beide alternatieven,
maar levert nog geen algemene schaalbare GNL-oplosser voor grote modellen.
Een expliciete `sparseGmres`-keuze assembleert de actuele symmetrische
elementtangenten in een begrensd CSR-patroon en lost elke Newton-correctie
iteratief op met Jacobi-GMRES. De route is begrensd op 2.400 DOF, 3.600 Tet4,
57.600 tijdelijke knoopblokken en 600.000 scalaire CSR-posities; standaard
blijft de dichte methode. Een onafhankelijke niet-affiene proef met 1.440
Tet4, 1.134 globale en 1.008 vrije DOF, verschillende E/ν/β-materialen en
verdeelde lasten reconstrueert Green-rek, Piola-spanning, krachten,
reacties, momentenevenwicht en energieafgeleide. Een afzonderlijke grotere
affiene acceptatieproef met 2.880 Tet4 en 2.106 globale DOF wordt in release
gedraaid. Een aanvullende 1.296-Tet4-proef met 1.029 globale en 375 vrije
DOF volgt twee belastingsdoelen met eindige afschuiving en daaropvolgende
starre rotatie. Alle Green-Lagrange-rekken, eerste Piola-spanningen en
effectieve E-waarden stemmen met een onafhankelijke gesloten oplossing
overeen; negen eerste momenten van de steunreacties sluiten op
`Σ rₐ Xᵢ = 1000 V Pₐᵢ`. Dit is een affiene objectiviteits- en
evenwichtsproef, geen acceptatie van algemene grote GNL-modellen.
De GMRES-keuze controleert werkelijk lineair en niet-lineair
residu, maar het iteratieve residu bewijst geen rang of positieve
definietheid; de directe begrensde methode blijft nodig voor die controle.
Een extra GNL-keuze `automatic` start met sparse LDLᵀ en herstelt uitsluitend
een herkende factoropslaglimietfout met frontale eliminatie voor de rest van
dezelfde laststap. Instelbare `maxFactorEntries` en `maxFrontDofs` houden dit
begrensd; `linearBackendUsed` en `frontalFallbacks` rapporteren de uitkomst.
Een onafhankelijke krachtgestuurde niet-lineaire kubus (trek, omkering,
ontlasten) en een heterogene tweelagenligger volgen de analytische Piola-wet
bij geforceerd opslagherstel. Een rotatiemechanisme en ongeldige limieten
blijven fouten; dit is geen herstelpad voor onstabiele materiële tangenten.
Een extra 5×5×5-celproef met 750 Tet4 en 192 vrije DOF laat alle vrije
LDLᵀ-diagonalen in het budget passen maar dwingt bij de factorvulling tot
frontaal herstel. Bij β=24 sluiten de affiene Green-rek, Piola-spanning,
effectieve E, alle knoopreacties en het vrije residu op de onafhankelijke
continuümoplossing. De getypeerde app-route herhaalt die herstelproef.
Een afzonderlijke getypeerde Hex8-volumeroute gebruikt 2×2×2-integratie,
CSR-assemblage of begrensde frontale eliminatie en Gauss-puntspanningen.
Uniforme Hex8-lichaams- en vlaklasten
worden met consistente volumekwadatuur en vlakkwadatuur geïntegreerd; de
vlakknoopvolgorde wordt gecontroleerd.
Een optionele directe Hex8-frontale route assembleert elementen rechtstreeks
zonder CSR-matrix. Zij is begrensd op 2.500 elementen, 6.000 DOF en 256
actieve front-DOF en vergelijkt een affiene en een heterogene patch met CSR.
De expliciete Hex8-keuze `linearBackend: "sparseDirect"` gebruikt de bestaande
CSR-LDLᵀ-factorisatie met maximaal 6.000 DOF, vier miljoen assemblagetriplets
en één miljoen factoritems. Een analytische kubus, een vervormde heterogene
patch en een onafhankelijke scheve acht-elementenproef controleren
verplaatsingen, reacties en Gauss-spanningen tegen CSR. Een mechanisme en
een 6.084-DOF-model boven de grens worden afgewezen. De automatische keuze
blijft voorlopig CSR of matrixvrij met begrensd frontaal herstel; directe
factorisatie is een expliciete optie.
Een afzonderlijke expliciete `linearBackend: "matrixFreeGeneral"` past
matrixvrije Jacobi-PCG toe op geldige willekeurige Hex8-connectiviteit en
geometrie. De symmetrische lokale stijfheid en Gauss-gradiënten worden in
3.944 bytes per element bewaard; het expliciete cachebudget van 256 MiB
geeft een maximum van 68.061 elementen, naast een limiet van 480.000 DOF.
Een scheef en intern vervormd
acht-elementennet controleert een onafhankelijk affien verplaatsingsveld,
alle Gauss-spanningen, geïntegreerde oppervlakreacties en globale balans
tegen CSR, frontaal en de algemene matrixvrije route; een geïnverteerd
element wordt afgewezen. Een heterogeen vervormd model met omgekeerde
knoop- en elementvolgorde sluit ook op CSR aan en loopt door de getypeerde
app-transportlaag. Een genegeerde throughputproef met 1.000 elementen,
3.993 DOF en vier threads kost in debug 2,42 s en heeft een werkelijk residu
van `8,055·10⁻⁹`. Een L-vormige, heterogene lagenproef met onregelmatige
dwarsdoorsnede en herschikte knoop-, element- en steunvolgorde vergelijkt
één en vier threads met CSR. De onafhankelijke serieschakelingsoplossing
controleert alle verplaatsingen, Gauss-spanningen en eindreacties.
Dit zijn geen acceptatieproeven voor 250.000 willekeurige Hex8-elementen;
die algemene schaalbaarheid blijft open.
Een aanvullende algemene Hex8-proef gebruikt een conforme vijfhoekige
15-cellenster met een vijfwaardig binnenknooppunt, drie ongelijke lagen,
scheefgetrokken en inwendig vervormde geometrie en verwisselde knoop- en
elementvolgorde. Onafhankelijk geïntegreerde Hooke-vlaktracties belasten
alle vrije buitenvlakken; de matrixvrije oplossing op één en vier threads
en CSR volgen dezelfde affiene verplaatsingen, alle Gauss-spanningen en
ondervlakreacties met circa 99 vrije DOF. Dit toetst werkelijk andere
connectiviteit dan een tensorrooster, maar nog geen groot ongestructureerd
acceptatiemodel.
Een afzonderlijke genegeerde release-proef met 8.000 vervormde,
heterogeen gelaagde Hex8-elementen (27.783 DOF) controleert de onafhankelijke
serieschakelingsoplossing. Op vier threads duurde de oplossing 0,577 s bij
76 iteraties en een werkelijk relatief residu van `9,402·10⁻⁸`; maximale
verplaatsings- en spanningsafwijkingen waren `2,931·10⁻¹⁰` m en
`1,538·10⁻⁴` MPa. Na compacte lokale opslag was de gemeten piek
41.436 KiB RSS en de oplossingsduur 0,598 s bij hetzelfde residu en
dezelfde afwijkingen. De vervormde
dwarsdoorsnede blijft over de lengte geëxtrudeerd; dit valideert dus nog
geen grote willekeurige topologie of het doel van 250.000 algemene Hex8's.
Een tweede genegeerde release-proef met 64.000 elementen, 68.921 knopen en
206.763 DOF gebruikt dezelfde onafhankelijke lagenoplossing. Op vier threads
duurde de solve 6,747 s bij 150 iteraties, werkelijk relatief residu
`8,764·10⁻⁸` en 307.976 KiB piek-RSS. Maximale verplaatsings- en
spanningsafwijkingen waren `4,757·10⁻¹⁰` m en `1,839·10⁻⁴` MPa;
de eindreacties waren −40.026,684593 en +40.026,684456 kN. De 8.000-celproef
bleef na parametrisering ook slagen. Beide grote proeven betreffen een
vervormd geëxtrudeerd net en geven geen 250.000-celgarantie voor willekeurige
geometrie of topologie.
De expliciete keuze `linearBackend: "matrixFreeGeneralLarge"` gebruikt
dezelfde compacte algemene operator, met maximaal 1 GiB lokale
elementcache en 1.000.000 DOF. De normale en automatische routes behouden
de 256-MiB-grens; ook voor de grote route geldt maximaal 512 MiB per
parallelle productberekening. Het cachebudget omvat niet alle
PCG-werkvectoren, invoer en resultaatarrays.
Een genegeerde release-acceptatieproef met deze expliciete grote optie rekent
250.047 vervormde, heterogeen gelaagde Hex8-elementen, 262.144 knopen en
786.432 DOF op vier threads door. De solve duurde 41,111 s bij 235
iteraties, werkelijk relatief residu `8,767·10⁻⁸` en 1.189.468 KiB
piek-RSS. De maximale afwijkingen ten opzichte van de onafhankelijke
serieschakelingsoplossing waren `4,511·10⁻¹⁰` m in verplaatsing en
`1,521·10⁻⁴` MPa over alle Gauss-spanningscomponenten. De eindreacties
−31.153,372584 en +31.153,372698 kN sluiten op de analytische kracht
31.153,372698 kN. Het grote net heeft ondanks zijn geometrische vervorming
een regelmatig verbonden rooster; grote willekeurige topologie en algemene
geometrie blijven apart te toetsen.
Een tweede genegeerde release-proef gebruikt een verbonden geëxtrudeerde
L-doorsnede met onregelmatige interne geometrie, drie x-afhankelijke
E-moduli en door elkaar gehusselde globale knoop-ID's en elementvolgorde:
257.250 Hex8, 270.936 knopen en 812.808 DOF. Op vier threads duurde de
solve 85,820 s bij 439 iteraties, een werkelijk relatief residu van
`9,680·10⁻⁸` en 1.228.052 KiB piek-RSS. Tegen de onafhankelijke
serieschakelingsoplossing waren de maximale afwijkingen `4,140·10⁻⁹` m
en `4,411·10⁻⁴` MPa over alle Gauss-componenten. De analytische
L-oppervlakte is 0,745500 m²; de berekende eindreacties
−23.211,581713 en +23.211,582764 kN sluiten op de exacte kracht
23.211,582764 kN. Hiermee is een grote niet-rechthoekige meshklasse
gecontroleerd; willekeurige 3D-connectiviteit en algemene volumes blijven
open.
Een derde genegeerde release-acceptatieproef heeft een gesloten 12³-celholte
in een 64³ Hex8-net. Na weglaten van de holtecellen en ongebruikte knopen
zijn er 260.416 elementen, 273.294 herschikte knopen en 819.882 DOF;
ook de elementvolgorde is verwisseld en de geometrie in drie richtingen
vervormd. Vier threads losten dit in 38,349 s en 182 iteraties op, met een
werkelijk relatief residu van `9,891·10⁻⁸` en 1.258.028 KiB piek-RSS.
Tegen een onafhankelijke affiene Hooke-oplossing bedragen de maximale
verplaatsings- en Gauss-spanningsfout `1,313·10⁻⁹` m en
`5,772·10⁻⁴` MPa. Een aparte 2×2-vlakkwadatuur van analytische
oppervlaktetractie over alle 25.440 buiten- en holtevlakken geeft per
randknoop maximaal `2,023·10⁻⁴` kN reactiefout; de grootste analytische
knoopreactie is 7,426 kN. Deze proef valideert een echt 3D-volume met
interne holte, maar de topologie is nog steeds een gestructureerd voxelnet.
Willekeurige ongestructureerde 3D-connectiviteit en algemene belastingpaden
blijven open.
De nieuwe `linearBackend: "automatic"` kiest CSR binnen het
viermiljoen-tripletbudget en anders de begrensde algemene matrixvrije
route. Alleen een specifiek gediagnosticeerde PCG-convergentie- of
residufout mag bij maximaal 2.500 elementen en 6.000 DOF naar frontaal
herstellen; de werkelijk benodigde frontbreedte moet eerst binnen 256
vrije DOF passen. Fouten wegens geometrie, ontoereikende opleggingen of
mechanismen blijven zichtbaar. De gestructureerde snelle route blijft
expliciet via `structuredGridCells` en de bestaande keuze `sparse`.
De volledige `cargo test --locked -p openaec-native-fem --all-targets`
slaagde op 5 oktober met 406 actieve unit-tests, twee bewust genegeerde
unit-probes en alle actieve integratietests; de grote 8.000-, 64.000-, 250.047- en
257.250-elementenproeven zijn
standaard genegeerd en apart in release gedraaid. De getypeerde Hex8-app-route vergelijkt een vervormd
tweemateriaalmodel met CSR op alle knoopverplaatsingen, reacties en
Gauss-spanningen; `tsc --noEmit`, `rustfmt --check` en `git diff --check`
slagen ook.
De expliciete matrixvrije Hex8-route valideert ook een positieve rechthoekige
blokgeometrie met exact gestructureerde knoop- en elementvolgorde. Zij kiest
per element een van maximaal 4.096 isotrope E/ν-materialen; een kleine
tweemateriaalpatch vergelijkt verplaatsingen, reacties en alle
Gauss-puntspanningen met CSR en controleert herhaling op vier threads. Een
uniforme 250.047-elementenpatch van 2×3×4 m sluit op analytische spanning,
verplaatsing en 360.000 kN reactiekracht. De CSR-symmetriecontrole tolereert
numerieke annulering op de diagonale stijfheidsschaal en blijft echte
asymmetrie afwijzen. De bestaande globale matrixroute
voor andere elementfamilies blijft op 20.000 DOF begrensd. Algemene volume-GNL/FNL,
grote gecomprimeerde directe factorisatie en algemene koppeling van alle
elementfamilies aan de nieuwe backends ontbreken nog.

De lineaire oplossingslaag moet twee expliciet kiesbare routes krijgen:

1. **Sparse matrix:** gecomprimeerde opslag met een iteratieve methode voor
   geschikte positief definiete stelsels en een directe sparse factorisatie
   voor gevallen waarin de iteratieve methode niet convergeert.
2. **Frontale wavefront-methode:** elementgewijze assemblage met eliminatie
   zodra een vrijheidsgraad zijn laatste elementbijdrage heeft ontvangen,
   gebaseerd op [Irons (1970)](https://doi.org/10.1002/nme.1620020104).
   Elementvolgorde en maximale frontbreedte moeten worden gemeten; bij een
   te brede front is deze route niet automatisch de beste keuze.

De gemengde 2D CST/Q4-route biedt nu optioneel `linearBackend: "sparseDirect"`
en `linearBackend: "frontalWave"`. De frontale route assembleert lokale
elementbijdragen, verwerkt oplegveren en rapporteert de maximale frontbreedte.
Beide routes meten het werkelijke vrije residu en zijn met de bestaande
lineaire backend vergeleken, ook via de app-adapter. FNL met deze nieuwe
backends wordt expliciet afgewezen. Dezelfde strategie is nog niet op alle
elementfamilies beschikbaar.

De app moet `automatisch`, `sparse` en `frontaal` als strategieën kunnen
kiezen. Een automatische tweede poging is alleen toegestaan na een
gediagnosticeerde convergentie- of resourcefout en binnen een expliciet
geheugenbudget. Een mechanisme, singuliere matrix, negatieve tangent of
onvoldoende evenwicht mag nooit als geslaagde oplossing worden gemaskeerd.
Elke route moet het echte residu, reacties, verplaatsingen, gebruikte methode,
geheugenpiek en foutdiagnose rapporteren.

Voor de expliciete Tet4-route zijn `automatic`, `matrixFree`, `sparse`,
`sparseDirect` en `frontal` via het getypeerde solverprotocol beschikbaar.
`automatic` gebruikt
matrixvrije PCG en schakelt alleen bij vastgestelde niet-convergentie en
maximaal 10.000 DOF over op de frontale directe route. De CSR-route heeft
nu een tweepassige CSR-patroonopbouw via unieke 3×3-knoopblokken met
maximaal 40 miljoen tijdelijke knoopposities en 30 miljoen scalaire
matrixposities. Ook de reductie voor
opgelegde verplaatsingen gebeurt rechtstreeks van CSR naar CSR. De
directe sparse route blijft beperkt tot 10.000 DOF en de frontale route
heeft een frontlimiet van 512 DOF. Deze grenzen voorkomen dat
een herstelpoging onbeheerst geheugen opeist. Onder **Inzicht → 3D volumeproef**
kan de app nu experimentele lineaire Tet4-/Hex8-, J2-, betonschade- en
GNL-Tet4-modellen als JSON invoeren,
de lineaire Tet4-strategie kiezen en verplaatsingen, reacties en spanningen
tonen. De voorbeeldroutes zijn in de live dev-app tegen de actuele
release-bridge opgelost. De J2-PCG-coupon geeft in de browser twee
geaccepteerde stappen zonder stapverkleining en een vrij residu van
7,74·10⁻¹⁰ kN. Een verouderde release-bridge weigerde eerst de nieuwe
`sparsePcg`-keuze; na herbouw werkt de route. De dev-server kiest nu per
verzoek de nieuwste debug- of release-bridge, zodat een nieuwe build meteen
wordt gebruikt. Een volledige volume-modelworkflow met mesher,
projectopslag, rapportage en ontwerpcontrole ontbreekt nog.

Voor grote modellen zijn de huidige `BTreeMap`-rijen en de 20.000-DOF-grens
van de globale matrixroute een tussenoplossing. De lineaire frontale
2D- en 3D-raamwerkproeven passeren deze grens alleen bij een smal actief
front. De volgende algemene schaalstap is gecomprimeerde sparse opslag,
elementgewijze/gestreamde assemblage, herordening en geheugengelimiteerde
factorisatie. Als eerste meetdoel geldt voorlopig één miljoen vrijheidsgraden;
de definitieve acceptatiegrens hangt af van modeltype en beschikbaar geheugen.
Benchmark per elementfamilie: opbouwtijd, oplossertijd, piekgeheugen, residu,
evenwicht, meshverfijning en herstelgedrag wanneer één methode faalt.

## Huidige stand

| Deel | Rust-kern | Nog open voor vervanging van de app-solver |
| --- | --- | --- |
| 2D-raamwerk | 6-DOF-staven, lineair/P-Δ, staal- en beton-FNL met adaptieve laststappen en lastpad, uniforme thermiek en temperatuurgradiënten, oplegveren, Winkler-bedding, eindveren en buig-/translatievrijgaven. Axiale eindveren staan in serie met de FNL-staafstijfheid; axiale vrijgaven dragen geen normaalkracht over en herstellen vrije thermische/materiale rek. De gekoppelde N-M-vezelrespons wordt ook gebruikt met axiale eindveren en vrijgaven; interne staafzijde-DOF's worden iteratief teruggevonden en knoopkrachten worden gecorrigeerd met het verschil tussen ruwe en gecondenseerde equivalente lasten. Rotatievrijgaven, rotatieveereinden en dwarse translatieveren/-vrijgaven worden eveneens intern teruggevonden met hun veerevenwicht, nul moment/kracht bij vrijgave en behoud van vezeltoestand. Sectiehistorie wordt gerapporteerd. Materiaalwet per staaf, lastpad en temperatuurverschil over een opgegeven hoogte worden in het project bewaard. De adapter verwerkt scheefstand in beide richtingen voor knoop-, staafpunt- en lijnlasten; axiale verdeelde FNL-lijnlasten krijgen een mesh van maximaal 0,1 m. De Rust-kern splitst een ongesplitste materiaalstaaf bij interne axiale puntlasten en voegt het diagram terug onder de oorspronkelijke staafidentiteit, met behoud van de normaalkrachtsprong; interne segmenttoestanden worden apart berekend en de maatgevende axiale geschiedenis wordt gerapporteerd. Bedding, wisselende A/I-segmenten en extra sneden worden automatisch verdeeld en weer tot één staafdiagram samengevoegd; segmentkrachten blijven ook in lineaire combinaties beschikbaar. | Directe tests controleren een inwendige puntlast samen met een lineair verlopende gedeeltelijke lijnlast, uniforme thermische uitzetting en omzetting naar globale krachten voor een schuine staaf. Een cantilever met staalplastificatie vergelijkt de tiprotatie met een onafhankelijke doorsnede-moment-krommingsoplossing; de rotatievrijgave en rotatieveer worden onafhankelijk vergeleken met numerieke M-κ-integratie. De thermische proef controleert de gekoppelde N-M-resultante. Nieuwe proeven vergelijken gecombineerde axiale kracht en buiging met een onafhankelijke sectie-evenwichtsoplossing bij een axiale eindveer en controleren N=0 bij een axiale vrijgave met thermische rek. Een tweeledige FNL-ligger met verschillend E per staaf vergelijkt tiprotatie en -verplaatsing met onafhankelijke M-κ-integratie; beide elementen behouden hun eigen plastische historie en de native app-route voert de twee E-waarden door. Een 16-elementige staalproef vergelijkt de dwarse eindveer met onafhankelijke M-κ-integratie plus veervervorming. Zuiver buigende staal- en betongevallen controleren tiprotatie bij een dwarsvrijgave tegen onafhankelijke sectie-M-κ en nul dwarskracht; voor beton wordt per kromming ook N=0 opgelost vanwege de gekoppelde scheurrespons. De native en herbouwde app-routes slagen. Meer-elementige frameherverdeling onder algemene lastpatronen en gekoppelde staaf-plaatmodellen vragen nog aanvullende validatie. |
| 3D-raamwerk | 12-DOF-staven, lineair/P-Δ en gecombineerde GNL/FNL; staal-/beton-FNL met adaptieve laststappen en lastpad, eigenknik tot 120 vrije DOF, lokale lijn-, staafpunt- en thermische lasten, globale veren, opgelegde verplaatsingen/rotaties en My/Mz/torsiescharnieren. Uniforme temperatuur en beide doorsnedegradiënten lopen mee in de FNL-laststappen; vrije thermische kromming wordt van de secant-E-rek afgesplitst. Gesloten-vormige uitkragingproeven controleren beide krommingsassen en vrije thermische vervorming. FNL-staven integreren de volledige gekoppelde N-My-Mz-doorsnedetangent uit negen vezels op twee langsdoorsnede-Gauss-punten; vezelplasticiteit en betonschade blijven over het lastpad bewaard en komen via de app-adapter in eigenschappen en rapport. Aan My/Mz-momentreleases worden de interne staafrotaties iteratief teruggevonden tot het vrijgegeven eindmoment nul is; staalplastificatie en betonschade blijven ook bij ontlasten/herbelasten bewaard. Een rotatieve knoopsteunveer is samen met staalvezelplastificatie onafhankelijk met M-κ-kromming, veerrotatie, tiprotatie en tipverplaatsing gevalideerd en via de app-adapter gecontroleerd. Een 24-elementige stalen uitkraging met plastisch buigende vezels en vrij tipmoment stemt binnen 2% overeen met een onafhankelijke moment-krommingsberekening die langs de balk numeriek wordt geïntegreerd. De bestaande 1D-axiale geschiedenis blijft als aanvullende compatibiliteitsuitvoer beschikbaar. `2e orde + fysisch` bereikt voor zuivere 3D-raamwerken de Rust-combined analyse via de app-route. Een staalraamwerk met axiale druk en biaxiale buiging controleert bovendien 8/16-elementen meshverfijning voor alle tiptranslaties (<2% verschil), vezelplastificatie en globale krachtenbalans. Een aanvullende 24-elementige uitkraging met vierstaps lastpad, axiale druk en dwarskracht stemt met de gesloten beam-column-tipverplaatsing overeen binnen 0,2%. | Onafhankelijke validatie van de algemene N-My-Mz-interactie staat nu ook onder lastpad en algemene combinatiebelasting; member-endveren als afzonderlijke elementverbinding, staaf-plaatkoppeling en schaalbare knik- en stabiliteitstoets blijven open. |
| 3D-volume | Lineair Tet4 met per-element E/ν, knoop-, uniforme lichaams- en vlaklasten, opleggingen, verplaatsingen, reacties en constante spanningen; gestructureerde Tet4-mesher. Matrixvrije parallelle PCG rekent 257.250 elementen (139.968 DOF) en 2.058.000 elementen (1.073.733 DOF) door. Tet4 met geassembleerde CSR verwerkt 257.250 elementen op vier threads; kleine modellen kiezen ook directe sparse LDLᵀ of frontaal. Een aparte Hex8-route heeft globale CSR-assemblage, consistente lichaams-/vlaklasten en 8 Gauss-puntspanningen. De matrixvrije regelmatige Hex8-route ondersteunt per-element E/ν en een kleine tweemateriaalpatch sluit op CSR. Een uniforme patch via getypeerde `volumeHex8`-invoer rekent 250.047 elementen en 786.432 DOF op vier threads met residu 9,68·10⁻¹⁰; de 2.000.376 Gauss-puntspanningen zijn mee berekend. De algemene matrixvrije Hex8-route accepteert geldige willekeurige geometrie en elementconnectiviteit: standaard tot 68.061 elementen/480.000 DOF, en expliciet met 1 GiB cache tot 1.000.000 DOF. Een geëxtrudeerde vijfwaardige 250.000-elementenmesh met 789.315 DOF sluit op een onafhankelijke oplossing. Een gesloten, vervormde 260.416-celholte slaagt met één en twee materialen, onafhankelijk gecontroleerde Gauss-spanningen en oppervlakreacties. De getypeerde lineaire routes zijn via dispatcher, TypeScript-client en browsertransport bereikbaar. Een experimentele J2-staal-Tet4-route koppelt een op 36 componenten gecontroleerde tangent aan globale Newton-stappen met commit/rollback van de plastische historie; analytische verplaatsings- en krachtgestuurde ontlastproeven en een meer-elementenpatch slagen. Per-element E/ν/vloeigrens/verharding is gekoppeld en tegen een onafhankelijke drie-lagenstaaf en plastische afschuifontlasting getoetst. De J2-Newtonstap kiest sparse direct, frontaal met begrensde frontbreedte of expliciet parallelle sparse PCG bij positieve verharding; alle drie zijn tegen onafhankelijke materiaal- en evenwichtsproeven vergeleken. Vier releaseproeven met 257.250 Tet4-elementen en 139.968 DOF controleren PCG op uniforme en gelaagde, deels vrije plastische velden. De globale betontrekschade-coupon gebruikt een opgegeven scheurbandbreedte en bewaart de schadehistorie bij ontlasten; dichte LU is begrensd op 180 DOF en de optionele CSR-GMRES-route op 12.000 DOF plus opslaggrenzen. Een onregelmatig 192-DOF-model met gemengde schade sluit op onafhankelijk evenwicht en intern werk. Per-element E/ν/treksterkte/breukenergie/scheurbandbreedte is gekoppeld en tegen een elastische drie-lagenstaaf en afzonderlijke analytische schade-ontlastproeven gecontroleerd. Een aparte St Venant–Kirchhoff-Tet4-route controleert affiene rek, starre rotatie en eindige afschuiving met belastingsomkering via onafhankelijke reacties en Green-Lagrange-rekken; de dichte route is begrensd op 180 DOF, directe sparse/frontale routes op 900 DOF en de optionele CSR-GMRES-route op 2.400 DOF met verdere opslaggrenzen. Een geroteerde afschuifproef met 1.296 Tet4 en 1.029 DOF sluit op analytische Green-rek, Piola-spanning en reactiewerk. Een aparte eindige-rek Hencky/J2-Tet4-route combineert GNL/FNL met dichte LU, CSR-GMRES, frontale wavefront en matrixvrije parallelle GMRES, plus begrensd automatisch frontaal herstel uitsluitend na herkende CSR-/GMRES-fouten; de optionele grote matrixvrije route heeft een werkgeheugenraming van maximaal 1,5 GiB en een expliciete releaseproef met 257.250 plastische Tet4, 139.968 DOF en 117.912 vrije componenten sluit op een gesloten affiene Hencky/J2-oplossing (5,089·10⁻⁹ kN vrij residu, 131,76 s op vier threads). | Algemene volume-GNL en gekoppelde GNL/FNL buiten deze begrensde route, algemene en gevalideerde beton-FNL, J2-validatie op meer algemene belastingpaden en willekeurige grote topologieën, schaalbaarheid van de algemene Hex8-route naar 250.000 heterogene elementen op volledig willekeurige 3D-topologie, gekoppelde lijn/plaat/volume-modellen, rijkere meshconvergentie en een volledige volume-modelworkflow in de UI. De betonscheurbandlengte moet nog uit geometrie en scheuroriëntatie worden afgeleid en experimenteel gevalideerd. |
| 2D-schijf | CST en Q4, Green-Lagrange GNL, analytische consistente Q4-tangent voor elastisch/secant-E materiaal en constitutieve tangent voor staal-J2/betonschade; E(rek); app-FNL-factorpad bereikt beide Rust-elementen, met halvering van niet-convergerende laststappen; x/y-translatieveren met directe veerreacties in CST, Q4 en app-adapter | De analytische Q4-coupon controleert nu bilineair staal én beton-trekbeschadiging onder gecombineerde Green-Lagrange GNL/FNL; nominale spanning, stretch en PK2-spanning volgen uit onafhankelijke scalaire oplossingen, alle staal-Gauss-punten plastificeren en de betonschadefactor komt overeen. Externe validatie van de algemene FNL-wetten, alle combinaties van elementen/randvoorwaarden en gekoppelde staven blijven open. |
| 2D-buigplaat | DKT en 4-knoops hybride Kirchhoff, E(rek) per materiaal, per vierhoek bilineaire plaatdruk en mesh-uitgelijnde lineaire randlijnlasten, exacte vierkantsmesher en Q4-rechthoekmesher met begrensde celmaat en rechthoekige openingen; secant-E-FNL herhaalt tangentcontrole en verkleint niet-convergerende laststappen. Twee losgekoppelde Q4-plaatvelden met verschillende E(rek)-curven zijn nu met afzonderlijke vaste-E-referenties geverifieerd, inclusief behoud van iedere materiaalhistorie bij ontlasten. Hybride plaatuitvoer bevat momenten en herleide dwarskrachten op 4×4 Gauss-punten, hoeken en middens. DKT, hybride buigplaat en geometrische schaal ondersteunen lokale verticale en rotatieve knoopveren met directe veerreacties. Gekoppelde geometrische schaalroute: 5 DOF/knoop, von-Kármán membraanrek plus hybride plaatbuiging, Newton-evenwicht, load path, secant-E-rekhistorie met behoud van piekrek en tangent-inertiecontrole. Een bilineair variërend plaatdrukveld volgt bij kleine doorbuiging een onafhankelijke Navier-reeksoplossing; verticale reactiekracht en Newton-residu sluiten. Bij grote doorbuiging wordt het verplaatsingsveld bij omgekeerde drukgradiënt gespiegeld binnen 2·10⁻⁵ van de piekdoorbuiging; de reacties sluiten op de geïntegreerde belasting. Een onafhankelijke 5×5 Fourier-Ritz-referentie van de von Kármán-energie voor q(x,y)=qmax·x/a geeft w/h=0,427485 bij (a/4,b/2) en 0,669986 in het midden; het 8×8 Q4-shell wijkt daar respectievelijk 0,64% en 0,30% van af en omkering van de drukgradiënt spiegelt het veld. Voor een ingeklemde plaat met trapeziumvormige vrije-randlast convergeert een onafhankelijke polynomiale Ritz-reeks naar w/t=0,666667 aan het belastingsmidden; de 8×4 GNL-Q4-proef blijft binnen 5%, met gespiegelde verplaatsingen, 1000 kN reactiekracht en gesloten Newton-residu. De GNL-app-route met trapeziumvormige plaatrandlast volgt bij kleine doorbuiging de lineaire hybride Q4-referentie binnen 0,1%. GNL-shellmembraan ondersteunt staal-J2-plastificatie of betontrekbeschadiging per 4×4 integratiepunt; geaccepteerde laststappen bewaren de toestand. De Rust-uitvoer geeft locatie, membraanrek, plastische rek en schade voor elk van de 16 punten, en het 3D-plaatrapport toont ze per element. De onafhankelijke controle van de materiaalwet blijft beperkt tot bestaande coupons en lastpadproeven. | Experimentele GNL/FNL-kern; uniforme trekproef, kleine-doorbuigingsvergelijking met hybride plaat, gecombineerde membraan-/buigvezelrek, secant-E-ontlasting en finite-difference tangenttest zijn toegevoegd. Constitutieve shellproeven controleren staal- en betontoestand bij belasting en ontlasting. De geautomatiseerde Levy-proef uit NACA Report 737 (tabellen 8–9; immovable in-plane edges, ν=0,316 en p·a⁴/(E·h⁴)=51,4) vergelijkt 4×4, 8×8 en 16×16 Q4-roosters: w/h = 0,979106, 0,957550 en 0,950787 tegenover referentie 0,952; de afwijking daalt tot 0,13% en de verticale reactiebalans sluit op elk rooster. Dit is nog geen algemene asymptotische meshconvergentie of knikproef. Materiaalplasticiteit/beschadiging geldt alleen voor shellmembraanrek; shellbuiging blijft elastisch of secant-E en is nog niet onafhankelijk gevalideerd. De gekoppelde 3D-app-route neemt in-vlaks- en buiglasten in één solve op en voert 21 shellresultantpunten door naar de optionele UGT/BGT-wapeningscontrole. De gecombineerde hoofdrek wordt per Gauss-punt aan beide plaatzijden bepaald; onafhankelijke validatie van het hybride rekveld en materiaalmaatgetal blijft nodig. Verder: orthotrope plastische/schadewetten, wapeningscontrole op orthotrope platen, gescheurde buigstijfheid, willekeurige contouren/openingen en betrouwbare dwarskrachtherleiding aan alle randen. De lineaire DKT-, hybride buig- en geometrisch niet-lineaire schaalroutes ondersteunen orthotrope elasticiteit met secans-E-curven. |
| Wapeningscontrole | Verticale dwarskrachtwapening en EC2-scheurwijdte als aparte UGT/BGT-postprocessen; Blaauwendraad `threeLayer`-deelcontrole van membraanresultanten, buitenlagen en optionele kernschuifkracht. De vier membraanwapeningsgevallen uit Cement 2021/8 (twee richtingen, alleen x, alleen y, alzijdige druk) zijn afzonderlijk tegen de artikelvergelijkingen getoetst, inclusief continuïteit op gevalgrenzen. Elk huidresultaat geeft nu ook het maatgevende membraangeval door; de 3D-plaatrapportage toont de x/y-/drukclassificatie aan het maatgevende resultaatpunt. De beton-Q4-app-route toetst membraanresultanten op alle vier Gauss-punten en toetst combinaties na superpositie opnieuw. De geometrisch gekoppelde 3D-shellroute geeft 21 gecombineerde N/M/V-resultantpunten per element door naar de UGT/BGT-postprocessen; membraankracht wordt voor langswapening gelijk over beide vlakken verdeeld, terwijl scheurinitiatie met de werkelijke oppervlaktespanning N/h ± 6M/h² wordt gecontroleerd. EC2 k₂ volgt de trekrekverdeling over beide plaatvlakken (0,5 bij buiging, 1,0 bij zuivere membraantrek). | De shell-wapeningsroute is gekoppeld maar nog partieel: volledige axiaal-dwarskrachtinteractie, terugkoppeling van gescheurde stijfheid, scheurhistorie, nationale bijlage en detaillering ontbreken. Automatische extrema-/meshvalidatie en onafhankelijke shellvoorbeelden blijven nodig. |
| Lineaire algebra | Bestaande dicht-/BTreeMap-route met 20.000-DOF-grens en LDLᵀ-inertiecontrole; daarnaast CSR-assemblage met Jacobi-PCG, directe sparse LDLᵀ met factorfillgrens en een elementgewijze frontale wavefront-oplosser. De Tet4 sparse route bouwt het CSR-patroon met begrensde knoopblokopslag op, reduceert vrije DOF rechtstreeks naar CSR en vermenigvuldigt CSR-rijen parallel. Een regelmatige patch met 257.250 Tet4-elementen slaagt op vier threads; vier backends zijn voor kleine modellen kiesbaar. | Verdere streaming van het patroon voor miljoenen ongestructureerde elementen, robuustere preconditioner, herordening, strategiesteun bij alle elementfamilies en schaalbare eigenknik. |
| App-koppeling | Eén getypeerde dispatcher via Tauri, toetsbrug en MCP; TypeScript-client en invoeradapters; de elastische voorgespannen-liggerreferentiekern is getypeerd aan de FEM-client gekoppeld en doorrekent het FHWA-cambervoorbeeld via dezelfde browsertransportlaag. De kern ondersteunt nu ook fasegebonden geconcentreerde puntlasten; een onafhankelijk handvoorbeeld met 12 kN in het midden controleert `M=30 kNm`, `V=±6 kN` en `δ=1/2400 m`, inclusief beide dwarskrachtwaarden op de lastsprong en scheiding tussen overdrachts- en gebruiksfase. De FEM-clientroute voert die fixture door. De liggeruitvoer bevat naast een configureerbaar stationsraster kritieke doorsneden voor moment-/spanningsomhulling, puntlastlocaties en interne extremen van de doorbuigingslijn. De optionele voorgespannen `shearWithoutLinks`-controle geeft op elk station beide EC2-Worked-Example-6.3-takken voor `VRd,c` met de werkelijke elastische dwarskracht; de beugelcontrole gebruikt op een puntlastlocatie de zwaarste zijde van de dwarskrachtsprong. FNL-factorpad voor 2D-CST/Q4 wordt uit het project doorgegeven zodat materiaaltoestand bij ontlasten/herbelasten behouden blijft; de 3D-analyseknop gebruikt de native kern bij expliciete eerste-orde-, P-Δ- of FNL-keuze met invoer voor staalverharding en betonscheuren, FNL-eindscharnieren, getoetste snedekrachtlijnen en knikfactoren. Een losse rechthoekige 3D-plaat gebruikt de gekoppelde `geometricShell`-route bij P-Δ; de gebruiker kiest per plaat óf de secant-E-rekcurve óf een staal-/betonwet voor shellmembraanpunten. Het materiaal-lastpad bewaart de membraantoestand bij ontlasten. De plaatmateriaalwet is instelbaar in de bestaande 3D-eigenschappeneditor. Shellbuiging blijft elastisch/secant-E; materiaaltoestand uit de shellmembraanpunten wordt nog niet doorgegeven aan de dwarsdoorsnedetoets. Lineaire en material-only-FNL-plaatberekeningen blijven via hybride buig- en Q4-membraanoplossers lopen. Geometrische shellresultanten gaan rechtstreeks naar de optionele drielagencontrole en de rapportage toont de gecombineerde piekrek. Normaal- en in-vlaksbelastingen, buiten- en openingshoekopleggingen, lokale verticale/rotatieveerknopen en volledige vrije/scharnierende/ingeklemde buitenranden, plaatresultanten, alle randreacties en roostervervorming verschijnen in app en rapport. Rechthoekige openingen worden in Rust gemesht. Een expliciete UGT- of BGT-wapeningsspecificatie bereikt ook de Rust-plaatkern; elementgewijze dwarskracht-, langswapening- en scheurresultaten staan in de app en het rapport. Trapeziumvormige normaalrandlasten op de vier buitenzijden worden vanuit de app verdeeld over de Q4-meshsegmenten en hun resulterende momenten worden meegecontroleerd. | Alle 2D/3D-modelopties en resultaattypen gelijk maken; gekoppelde staaf-plaatassemblage, willekeurige contouren en gekromde openingen, elastische verdeelde randopleggingen en niet-lokaal-uitgelijnde veerkoppelingen, materiaaltoestand in buigdoorsneden/toetsen en gevalideerde gescheurde/plastische plaatdoorsneden uitbreiden. |

## Volgorde en acceptatie

1. **Matrix en roosters:** elke nieuwe backend krijgt een analytische proef,
   een groot rooster boven de oude grens en een foutproef voor mechanismen.
   Gerealiseerd: Q4-rekproef 882 DOF en hybride Navier-plaat 675 DOF. De
   sparse LDLᵀ-stabiliteitscontrole is aangesloten op CST-, Q4-, DKT- en
   hybride plaatoplossers. Niet-lineaire plaatanalyses controleren iedere
   nieuwe tangent. Een mechanisme dat loodrecht op de vaste PCG-proeflast
   staat, wordt door de inertieproef gevonden; bij factorfill boven het
   geheugenbudget valt de solver terug op PCG.
2. **Invoercontract:** leg per element en last vast hoe het app-model naar
   Rust-eenheden wordt vertaald. Wijs niet-ondersteunde onderdelen expliciet af.
3. **Elementen en koppelingen:** migreer de nog ontbrekende functies van de
   huidige `design-mockup/src/core/solver` en `src/components/fem/solver`.
   Vergelijk voor elk onderdeel knoopverplaatsingen, reacties, elementkrachten
   en convergentie met de huidige solver en een onafhankelijke referentie.
4. **Niet-lineariteit:** toets lastpad, ontlasten, materiaaltoestand, P-Δ en
   convergentiefouten afzonderlijk. Voor beton is objectieve meshregularisatie
   nodig voordat berekende scheurvorming als ontwerpresultaat kan gelden. De
   hybride plaatbuigproef met een lineaire E(rek)-curve vergelijkt modulus en
   tipverplaatsing met een onafhankelijke scalaire secantoplossing en controleert
   dat de modulusafname na ontlasten behouden blijft.
5. **App en rapport:** schakel pas per analysevorm om wanneer dezelfde
   modelinvoer door de Rust-kern gaat en de bestaande project-, rapport- en
   toetsworkflow haar resultaten kan gebruiken. Houd ongedekte gevallen
   zichtbaar totdat ze ondersteund en gevalideerd zijn.

Een onderdeel is pas afgerond als het in de app werkt, geautomatiseerde
vergelijkingstests doorstaat en de ondersteunde/niet-ondersteunde invoer
duidelijk is. De huidige branch blijft experimenteel tot die poort is gehaald.

## Verificatie op 5–7 oktober 2026

- De afzonderlijke eindige-rek J2-**materiaalpuntwet** heeft multiplicatieve
  plastische kinematica, Hencky-energie en een analytische 9×9-tangent bij
  vaste gecommitte geschiedenis. Tien moduletests en tien onafhankelijke
  referentietests controleren onder meer 324 tangentcomponenten in vier
  elastische/plastische toestanden, rotatie, ontlasten, `det(Fp)≈1`, de
  elastische energieafgeleide en de kleine-rek-limiet. De nieuwe
  Tet4-elementactie assembleert `V·P·∇N` en de volledige 12×12-tangent;
  twee referentietests controleren een analytische hydrostatische affiene
  proef en alle 144 elementtangentcomponenten tegen eindige verschillen.
  Een aparte globale Tet4-Newtonroute met gecommitte geschiedenis, line search,
  staphalvering, reacties en werkelijk vrij residu is toegevoegd. De globale
  Newtonstap kiest op het vloeivlak expliciet een eenzijdige tangent. Gerichte
  moduletests en zes onafhankelijke globale referentietests slagen, inclusief
  een 48-Tet4-affiene plastische belasting/omkering, niet-affiene plastische
  krachtbalans en afwijzing van een falend tweede lastdoel. De getypeerde
  Rust-dispatch, toetsbrug-/frontendroutetest en live ontwikkelapp tonen de
  zes-Tet4-coupon met twee geaccepteerde stappen, nul cutbacks en
  `6,2321·10⁻⁷ kN` vrij residu. Dichte LU blijft begrensd tot 120 DOF en
  200 Tet4. Optionele CSR-GMRES is begrensd tot 2.400 DOF, 3.600 Tet4,
  57.600 tijdelijke knoopblokken en 600.000 CSR-posities. Onafhankelijke
  tests vergelijken beide backends bij plastisch laden/ontladen en controleren
  een 192-DOF/162-Tet4-plastisch model boven de dichte grens, inclusief
  krachten en reacties. Dode lichaams- en vlaklasten op de referentiegeometrie
  zijn via V₀/4 en A₀/3 geïntegreerd. Twee onafhankelijke tests controleren
  ze tegen handberekende equivalente knooplasten, ook bij plastisch ontlasten.
  Een optionele frontale wavefront-route verwerkt dezelfde modelgrens met
  maximaal 1.024 front-DOF en weigert asymmetrische of niet-positieve
  tangenten. De onafhankelijke 48-Tet4-plastische omkeerproef controleert
  spanning en reacties tegen gesloten Hencky/J2-formules en dichte LU.
  De getypeerde app-route is voor de matrixmethoden en verdeelde lasten getest.
  Een expliciete releaseproef met 3.072 plastische Tet4, 2.187 DOF en 1.029
  vrije componenten sluit op de affiene Hencky/J2-oplossing, reacties en
  `1,242·10⁻⁸ kN` vrij residu. Een aparte matrixvrije GMRES-route cachet
  alleen lokale 12×12-tangenten,
  voert elementproducten op 1–16 threads uit en begrenst op 24.000 DOF,
  36.000 Tet4 en 5.184.000 lokale stijfheidsscalars. Een onafhankelijke
  162-Tet4-proef controleert plastisch laden/omkeren en 1/4-threadpariteit
  tegen sparse GMRES en gesloten Hencky/J2-formules. De expliciete
  releaseproef met 34.992 plastische Tet4, 20.577 DOF en 14.739 vrije
  componenten sluit op de analytische affiene spanning, verplaatsingen en
  vlakreactie met `6,953·10⁻⁹ kN` vrij residu; solve-tijd 10,02 s op vier
  threads. De aparte `matrixFreeGmresLarge`-route begrenst op 180.000 DOF,
  300.000 Tet4 en een raming van 1,5 GiB werkgeheugen. Haar expliciete
  releaseproef met 257.250 plastische Tet4, 139.968 DOF en 117.912 vrije
  componenten sluit op dezelfde gesloten Hencky/J2-oplossing: één stap,
  nul cutbacks, `5,089·10⁻⁹ kN` vrij residu en 131,76 s op vier threads.
  De optionele `automatic`-keuze probeert op kleine modellen CSR-GMRES en
  herstelt alleen bij herkende iteratie-/stagnatie- of opslaglimietfouten
  frontaal; de werkelijk gebruikte backend en het aantal herstelpogingen
  worden gerapporteerd. Zie `FINITE_STRAIN_J2_DESIGN.md`. Grote willekeurige
  topologieën, meebewegende belastingen, contact en constructieve
  ontwerpvalidatie zijn nog open.
- Het versieerde `combined-plate-frame-solid-acceptance`-voorbeeld toetst
  plaat, 2D/3D-raamwerk, tweede-orde Tet4, betonbeschadiging, voorspanning,
  dwarskracht en scheurwijdte in expliciet **afzonderlijke** analyses. Een
  extra Tet4-staalcoupon in hetzelfde volume toetst nu gelijktijdige eindige
  vervorming en J2-plasticiteit bij halve piek, piek, kleine ontlasting en
  herbelasting tegen de gesloten isochore Hencky-retour. Eerste
  Piola-spanningen, bewaarde plastische rek en oppervlakreactie sluiten.
  Eén globale plaat–raam–volume-FNL met compatibele interfaces blijft een
  open acceptatiepoort; de geslaagde afzonderlijke proeven bewijzen die
  koppeling niet.
- Een zelfstandige `plate_fiber_section`-kern integreert elastische en
  staalplastische vlakspanningsvezels over de plaatdikte. De invoer geeft
  onafhankelijke laag-E/ν en dikten; de uitvoer geeft N/M-resultanten,
  diktespanningen, een 6×6 eindige-verschillentangent en een proefhistorie
  die pas na expliciete acceptatie wordt gecommitteerd. De lokale inverse
  bepaalt bij opgegeven buigmomenten de drie membraanrekken en drie krommingen
  onder `N=0` met gedempte Newton-stappen; zijn twee residunormen worden
  afzonderlijk gecontroleerd, en instabiele/singuliere sectietangenten en
  verouderde proefhistorie worden geweigerd. Een unieke revisie per
  geaccepteerde toestand voorkomt dat een proef uit een andere load-step-tak
  een gekloonde geschiedenis overschrijft; ook kleine niet-nul momenten
  worden relatief aan hun doel gecontroleerd. De 3×3-tangent bij `N=0`
  volgt uit het Schurcomplement `D−CA⁻¹B`, na controle van de volledige
  6×6-tangent op stabiliteit. Dertien gerichte
  Rust-tests controleren de gesloten elastische A/B/D-stijfheid van een
  asymmetrische stapel, een plastische buig-/ontlastproef tegen fijne
  diktekwadratuur, afwijzing van toestand uit een andere sectie en de
  buigtangent tegen een onafhankelijke bij de vloeigrens gesplitste
  integraal. De inverse tests vergelijken met de exacte asymmetrische
  A/B/D-Schurcomplementoplossing, diens inverse gevoeligheid en 8.192
  onafhankelijke staalvezels.
  Met 512 tweepuntslagen is de tangentafwijking kleiner dan
  0,3%; bij grovere lagen is de convergentie rond de vloeigrens niet
  monotoon. Een aparte `hybridPlateLayered`-route koppelt nu **elastische**
  laagstapels per vierhoek aan het 17-parameter hybride buigelement. Zij
  assembleert de complementaire energie met `D_eff = D−BᵀA⁻¹B` bij lokaal
  `N=0` en neemt `ε₀=−A⁻¹Bκ` mee in de oppervlaktestrain. Homogene
  laagstapels sluiten op de bestaande hybride route voor zowel de bestaande
  als frontale oplosser; een asymmetrisch A/B/D-voorbeeld controleert stijfheid,
  momenten en reacties onafhankelijk. De getypeerde toetsbrug- en
  TypeScript-app-route slagen. Dit is geen volledige laminaat-schaal:
  globale in-vlakse compatibiliteit en membraan-buigkoppeling ontbreken.
  De aparte `hybridPlateFiber`-route koppelt nu de staalplastische
  diktevezels aan hetzelfde 17-parameter hybride buigelement, uitsluitend
  voor materiaal-FNL-buiging met lokaal `N=0`. Per vierhoek bewaren alle
  16 Gauss-punten een eigen doorsnede-identiteit en geschiedenis; per
  Newtonstap worden momentveld, lokale moment-krommingsinverse en de
  complementaire compatibiliteit tegelijk opgelost. De buigtangent wordt
  consistent gecondenseerd uit de lokale `D_eff` en het momentveld.
  Proeftoestanden worden pas na een volledig convergente globale laststap
  gecommitteerd; een mislukte stap keert terug naar de laatst geaccepteerde
  verplaatsing, momenten en vezelgeschiedenis. De getypeerde dispatcher en
  TypeScript-client geven het lastpad, 16 materiaalpunten per vierhoek,
  plastische rek, reacties, iteraties en cutbacks door. De elastische
  homogene en asymmetrische-lagenlimiet sluiten aan op de bestaande hybride
  solver; de staalproef controleert plastisch laden en blijvende vervorming
  na ontlasten op een tweeledige uitkraging. Een gesloten constante-kromming-
  proef controleert de gemengde compatibiliteitsvergelijking tegen de
  analytische plaatafbuigstijfheid. Een nieuwe frontale Newton-backend
  assembleert de actuele 12×12-plaattangenten element voor element, inclusief
  steunveren. De frontale oplossing sluit voor een elastische en een
  plastisch belast/ontlast staalplaat op de dichte route; een te kleine
  frontbreedte wordt herkenbaar afgewezen. Een expliciete 24×12-celproef
  met 975 DOF passeert de dichte 900-DOF-grens via frontale eliminatie en
  sluit op belasting, reacties en vrij residu. De getypeerde TypeScript-route
  rapporteert de werkelijk gebruikte backend en grootste front. De
  experimentele dichte route is begrensd op 900 DOF, de frontale route
  voorlopig op 5.000 DOF; dit is een invoergrens, nog geen gevalideerde
  5.000-DOF-capaciteit. Beide routes zijn begrensd op maximaal 100.000
  dikte-integratiepunten. Een onafhankelijke uniaxiale stripreferentie
  vergelijkt 2×1, 4×2 en 8×4 vlakroosters en 4/8/16 dikte-lagen: op
  het fijnste rooster is de tipafwijking 0,27% en neemt de momentfout bij
  vlakverfijning af. Deze referentie benadert vlakspannings-J2 als een
  uniaxiale strip; algemene dikte-laagverfijning rond het vloeifront,
  andere geometrieën en belastingpaden vragen verdere
  validatie. Een sparse backend, globale membraan-buigkoppeling en
  tweede-orde schaal-FNL ontbreken hier nog.
  Betonvezels blijven in `plate_fiber_section` afgewezen: de bestaande
  `material2d::ConcreteCracking`-restspanningswet heeft in monotone trek geen
  eindige breukenergie en kan dus niet met alleen een lengteparameter worden
  gekalibreerd. De afzonderlijke `plane_stress_crack_band` gebruikt nu de
  exponentiële Rankine-/`Gf`-kalibratie uit `solid_concrete_damage` met een
  expliciete **in-vlakse** scheurbandbreedte. Uniaxiale energie bij 0,05 en
  0,20 m bandbreedte, ontlasten/herbelasten, compressieherstel en geroteerde
  vlakspanningsrespons zijn direct getoetst. `plate_concrete_section`
  integreert deze wet over twee dikte-Gauss-punten per laag en bewaart een
  proef-/commitgeschiedenis per vezel; de analytische elastische A/B/D-termen
  van een asymmetrische stapel, een onafhankelijke fijn-geïntegreerde
  buigrespons, een buig-/ontlastproef en de negatieve trekverwekingstangent
  slagen. De bandbreedte is geen dikte van een vezellaag. De teruggegeven lokale
  schade-secant is geen consistente Newton-tangent; de sectietangent is een
  eindig verschil bij vaste gecommitteerde geschiedenis. Een robuust globaal
  oplossingspad door negatieve tangenten, gecombineerde staal-betonlagen,
  laagverfijning en verplaatsingsgestuurde zwakke-strookproeven op meerdere
  vlakroosters ontbreken nog. Pas daarna kan de hybride plaat-buig-FNL met
  beton betrouwbaar worden gekoppeld. Een secans-E-plaat alleen is geen
  gevalideerde gescheurde buigdoorsnede.
  Onderbouwing: [COMSOL-schadetheorie](https://doc.comsol.com/6.3/doc/com.comsol.help.sme/sme_ug_theory.06.036.html),
  [DIANA-scheurbandbreedte](https://manuals.dianafea.com/d107/en/1181807-1182167-cracking.html)
  en het [COMSOL-trekstaafvoorbeeld](https://doc.comsol.com/6.3/doc/com.comsol.help.models.nsm.damage_test_bar/damage_test_bar.html).
- De hybride plaat controleert haar 3×3-buigconstitutieve matrix nu met
  Cholesky-pivots voordat de compliantie wordt berekend. Een matrix met twee
  negatieve stijfheidsrichtingen en toch positieve determinant wordt afgewezen;
  de 40 gerichte hybride tests en beide bestaande plaat-appvergelijkingen
  slagen. De
  gerapporteerde hoofdvezelrek gebruikt bij zuivere twist nu de halve
  engineering-schuifkromming als tensorcomponent; een kinematisch
  `w=a·x·y`-plaatpatch toetst dit rechtstreeks.
- De optionele `sparseGmres`-route voor volume-GNL is door de onafhankelijke
  niet-affiene 1.440-Tet4-/1.008-vrije-DOF-proef en de expliciet in release
  gedraaide affiene 2.880-Tet4-/2.106-globale-DOF-proef gekomen. De volledige
  `openaec-native-fem`-testsuite, de toetsbrugtests, TypeScript-controle en de
  `native-volume3d-gnl-app-route`-test slagen. De grote releaseproef staat
  standaard op `ignored` zodat gewone debugtests beheersbaar blijven. De
  live dev-app toont voor de 48-Tet4-affiene proef met `sparseGmres`
  één geaccepteerde stap, nul cutbacks en een vrij residu van
  `3,0774·10⁻⁹ kN`. Bij voorgeschreven verplaatsingen schaalt de
  Newton-stopcontrole nu ook met de
  bijbehorende steunreacties; het werkelijke vrije residu blijft gerapporteerd.
  Een extra onafhankelijke 48-Tet4-proef met niet-affiene vervorming,
  heterogene E/ν, één vrije DOF, voorgeschreven overige componenten en
  lastomkering vergelijkt alle knoopreacties en element-E/P met een scalaire
  evenwichtsreferentie; alle vijf kleine-model-backends slagen.
  Dit is nog geen bewijs van algemene rangdetectie, postkritische GNL of
  staal-/beton-FNL bij grote vervormingen.
- Een aparte onafhankelijke totale-Lagrangiaanse Tet4-referentie toetst
  `dense`, `sparseDirect` en `frontalWave` op dezelfde niet-lineaire
  uniaxiale kracht-rekvergelijking. De analytische scalaire wortel wordt met
  bisectie bepaald, ook voor twee materiaallagen met verschillend E en
  verschillende energieparameter. Alle drie de backends sluiten op die
  verplaatsingen en reacties en wijzen een rotatiemechanisme af. Dit valideert
  drie kleine-model lineaire backends onder deze GNL-lastpaden; het zegt niets
  over hun schaalbaarheid bij 250.000 volume-elementen.
- De nieuwe experimentele totale-Lagrangiaanse Tet4-GNL-route rapporteert nu
  naast Green-Lagrange-rek ook de eerste Piola-spanning per element. Een
  affiene rekproef, starre rotatie, eindige afschuiving met belastingsomkering
  en vergelijking van de analytische tangent met eindige verschillen slagen.
  De getypeerde frontendroute en de live dev-app tonen voor 5% rek
  `Eₓₓ = 0,05125` en `Pₓₓ ≈ 14.488 MPa`. De route blijft beperkt tot
  180 DOF en 300 Tet4-elementen met de dichte standaardmethode; de later
  toegevoegde sparse en frontale routes zijn begrensd op 900 DOF en 1.200
  Tet4 en ondersteunen ook de expliciete β-energiewet. Een
  tangentvoorspelling voor vrije DOF's voorkomt een valse elementinversie bij
  grote voorgeschreven starre rotatie; de regressie loopt tot 3 radialen.
- De gemengde CST/Q4-route kan lineair via bestaande, directe sparse en
  frontale oplossers lopen. De frontale route verwerkt ook oplegveren en een
  niet-nul opgelegde verplaatsing. Een app-routetest vergelijkt verplaatsingen,
  reacties, werkelijk residu en maximale frontbreedte; GNL/FNL met deze
  alternatieve backends wordt afgewezen.
- Een getypeerde 2×2×1-Hex8-patch met twee E/ν-materialen vergelijkt de
  matrixvrije vierthreadoplossing met CSR op alle verplaatsingen, reacties en
  Gauss-puntspanningen, ook via de TypeScript-app-route. Een 250.047-elementen
  Hex8-proef met twee afwisselende E-moduli op een regelmatig blok controleert
  op vier en één thread onafhankelijk het residu en het globale krachten- en
  momentenevenwicht. Willekeurige grote geometrie blijft open.
- Een onafhankelijke 1D-evenwichtsreferentie met drie ongelijk lange
  Hex8-lagen, drie E-waarden, wisselende lichaamskrachten en eindtractie
  toetst alle axiale knoopverplaatsingen, Gauss-spanningen en reacties voor
  CSR, sparseDirect, frontalWave, matrixFreeGeneral en automatic. Zij bewijst
  geen algemeen 3D-gedrag of niet-lineaire heterogene belasting.
- De grote tweemateriaal-Hex8-proef heeft 786.432 DOF, E=30/24 GPa en
  12.000 kN vlaktrek. Vier threads lossen in 103,25 s met 1.811 iteraties op;
  het opnieuw aangebrachte operatorresidu is 9,533·10⁻¹⁰ en krachten- en
  momentenevenwicht blijven binnen 1,7·10⁻¹¹ relatief. Eén thread gebruikt
  175,56 s met hetzelfde iteratieaantal. De maximale verplaatsingsafwijking
  tussen beide runs is 1,015·10⁻¹⁶ m; piekgeheugen is 142.860 KiB.
- De begrensde Hex8-frontale route sluit voor een affiene proef en een
  tweemateriaalmodel op CSR, verwerkt gemengde lasten en rapporteert het echte
  residu en de piekfrontbreedte. Een mechanisme en een te groot front worden
  afgewezen. De app laat de gebruiker CSR/matrixvrij of frontaal kiezen; de
  live kubusproef toont 210 MPa op alle Gauss-punten en een piekfront van
  17 DOF.
- Een opnieuw gebouwde release-benchmark lost een regelmatige lineair
  elastische patch met 257.250 Tet4-elementen, 139.968 DOF en vier threads op:
  197 PCG-iteraties, werkelijk relatief residu `8,6844·10⁻⁹`, reactie
  `20.999,999985 kN` tegenover analytisch `21.000 kN`, 4,10 s wandtijd en
  66.976 KiB piekgeheugen. Eén thread geeft dezelfde numerieke uitkomst.
  Dit meet geen algemene grote geometrieën of niet-lineaire gevallen.
- De geassembleerde Tet4-sparse route verwerkt nu dezelfde 35³-patch van
  257.250 elementen en 139.968 DOF zonder tripletlijst. De oplossing sloot
  op de onafhankelijke affiene verplaatsing en reactiekracht: 222 iteraties,
  relatief residu `9,7301·10⁻¹⁰`, maximale verplaatsingsfout
  `4,68·10⁻¹³ m`, rechtervlakreactie `21.000,000027 kN` tegenover
  `21.000 kN`; de afzonderlijke release-test duurde met vier threads
  3,34 s en gebruikte maximaal 215.432 KiB RSS. De seriële route geeft
  dezelfde uitkomst in 4,77 s; de rijgewijze parallelle CSR-producten zijn
  bit voor bit gelijk aan de seriële. De patch is regelmatig en lineair
  elastisch. Een heterogene willekeurige topologie op deze schaal blijft open.
- Een expliciet uitgevoerde release-acceptatie controleert 260.416 vervormde
  Hex8-cellen rond een gesloten 12³-holte, 819.882 DOF, geschudde knoop- en
  elementnummers en vier threads. De homogene affiene oplossing convergeert
  in 182 iteraties met relatief residu `9,891·10⁻⁸`, maximaal
  `1,313·10⁻⁹ m` verplaatsingsfout, `5,772·10⁻⁴ MPa` Gauss-spanningsfout
  en `2,023·10⁻⁴ kN` knoopreactiefout tegenover onafhankelijke
  oppervlaktractie-integratie; 40,13 s, piek 1.257.992 KiB. Een tweede
  proef verdeelt dezelfde holte in exact 130.208 Hex8-cellen per E-laag
  (`31/62 GPa`, ν=0) en vergelijkt met een onafhankelijke serieschakeling:
  162 iteraties, residu `9,662·10⁻⁸`, verplaatsingsfout
  `8,109·10⁻¹⁰ m`, spanningsfout `5,209·10⁻⁴ MPa` en reactiefout
  `2,091·10⁻⁴ kN`; 35,23 s, piek 1.258.292 KiB. Beide gesloten
  randoppervlakken zijn afzonderlijk op reactiebalans getoetst. De mesh is
  uit een rooster met een echte binnenholte afgeleid; volledig ongestructureerde
  topologie en algemene E/ν-velden op deze schaal blijven open.
- Na de knoopblok- en parallelle CSR-wijzigingen slagen
  `cargo test --locked -p openaec-native-fem --all-targets`
  (411 actieve unittests, drie bewust genegeerde proeven en
  alle actieve integratietests), de onafhankelijke heterogene Tet4-pariteit
  en de TypeScript-app-route tegen de opnieuw gebouwde `native-volume3d`.
- `cargo test --locked -p openaec-native-fem --all-targets` slaagt met
  363 unittests, één bewust genegeerde grote benchmark en alle 24
  integratietests. Alle 22 native frontendtestbestanden, tien gerichte
  MCP-tests, TypeScript-typecheck en de Vite-productiebuild slagen. De
  Hex8-restnormwijziging is daarna nog afzonderlijk met twaalf unittests en
  vier integratietests gecontroleerd. De overige beperkingen in de tabel
  hierboven verhinderen een claim dat de volledige kernel af of algemeen
  constructief gevalideerd is.

## Verificatie op 2 oktober 2026

- De Rust-route voor 2D-raamwerken verwerkt nu ook een geconcentreerd moment op
  een willekeurige staafpositie. De app-adapter splitst de staaf op het
  laststation en draagt het moment als knooplast over; de splitsing blijft
  onafhankelijk van de lastfactor, zodat combinaties hetzelfde mesh houden.
  Een eenvoudig opgelegde ligger met een koppel van 2 kNm op x=2 m controleert
  de gesloten steunreacties van ±1/3 kN, de sprong van 2 kNm in de momentlijn,
  de verplaatsingen en het volledige moment-/vervormingsdiagram tegen de
  bestaande app-solver. Hetzelfde lastgeval doorloopt ook het staal-FNL-lastpad;
  de reactie en momentpuntsprong blijven behouden. `test-native-frame2d-app-route.mjs`,
  `tsc --noEmit` en `git diff --check` slagen. Dit verifieert de interne
  puntmomentoverdracht; de gekoppelde staaf-plaatproef hieronder verifieert de
  afzonderlijke lineaire combinatieroute.

- De Rust-kern assembleert nu ook een lineair, conform frame met CST- en/of
  Q4-membraanelementen in één globale translatie-/rotatievector. Gedeelde
  translatieknooppunten dragen normaalkracht tussen raamwerk en plaat over;
  membraanelementen leveren hun resultanten na dezelfde oplossing terug. CST
  en Q4 zijn elk op een gekoppelde ligger/plaatproef gecontroleerd. De native
  app-route bouwt de plaatmesh met de bestaande FEM Studio-mesher, deelt de
  randknopen met het Rust-frame, draagt plaatrandlasten over en zet spanningen
  terug naar de bestaande plaatresultaatstructuur. Een Q4-randlast vergelijkt
  verplaatsingen, reacties en liggernormaalkracht met de bestaande solver; de
  CST-proef controleert dezelfde lastoverdracht en resultaatmapping. Een ligger
  die een element binnenin kruist wordt vooraf afgewezen. `test-native-frame2d-app-route.mjs`,
  alle 14 frontendtestbestanden met `native` in de naam, `tsc --noEmit`, de
  Vite-productiebuild en 252 `openaec-native-fem`-bibliotheektests slagen; de
  crate-binaries doorstaan ook `cargo check --bins`. Niet-conforme
  randkoppelingen en gedeelde geometrische of fysische niet-lineariteit blijven
  open.

## Eerder geverifieerd op 1 oktober 2026

- End-to-end controle in de open ontwikkelapp: de release-`toetsbrug` is
  opnieuw gebouwd zodat de live `/api/toetsing`-route de actuele Rust-invoer
  accepteert, inclusief `shearLinks` en `stiffnessSegments`. Vanuit **Inzicht →
  Voorgespannen ligger** zijn overdracht en gebruik doorgerekend; met 30 GPa
  links en 15 GPa rechts rapporteert de stationslijst beide lokale E-waarden en
  verandert de middenverplaatsing in gebruik van 0,6944 naar 1,0417 mm. De
  dwarskrachtbeugelvraag wordt per station getoond. De losse routefixture en
  alle gerichte liggerproeven slagen eveneens; de volledige native FEM-crate
  slaagt met 234 unit-tests en 10 frame3d-pariteitstests. `tsc --noEmit` slaagt
  ook. Een regressietest op de toetsbrug controleert dezelfde combinatie van
  variërende E en dwarskrachtbeugels tegen de gedeelde dispatcher. Dit bevestigt
  alleen de elastische referentieligger en deze app-route; het vervangt de nog
  open koppeling van de solver met algemene modellen en automatische
  scheurwijdte-afleiding niet.

- De voorgespannen-liggerkern ondersteunt nu ook afzonderlijke geconcentreerde
  lasten tijdens overdracht en gebruik. Een symmetrische puntlast is getoetst
  aan de gesloten oplossingen voor middenmoment, beide dwarskrachten naast de
  sprong en doorbuiging; een excentrische puntlast controleert dat de
  beugeltoets de grootste snedekracht gebruikt. De fixture loopt via
  `nativeFemClient` naar de Rust-binary en controleert dat de gebruikslast niet
  in de overdrachtsfase lekt. Na deze wijziging slagen
  `cargo test --offline -p openaec-native-fem --all-targets` (229 unit-tests en
  10 frame3d-pariteitstests), `rustfmt --check` voor de liggerkern,
  `git diff --check`, `tsc --noEmit` en de native app-batterij (14/14 bestanden).
  Een gedeeltelijk driehoeklastsegment van 0 tot 20 kN/m op x=2..7 m is
  onafhankelijk gecontroleerd: de reacties zijn 70/3 en 80/3 kN, op x=5 m
  gelden M=296/3 kNm en V=16/3 kN, en de Green-functie geeft
  δ=0,00159683333333333 m. De ligger rapporteert nu ook externe en totale
  verticale reacties aan beide steunpunten; de parabolische kabelproef toetst
  de opwaartse voorspankracht en de netto gebruiksreactie. Een segment dat van
  uplift naar neerwaartse last verloopt heeft een intern dwarskrachtmaximum bij
  nul netto last; de test controleert VEd=18 kN en de maatgevende beugelvraag op
  die snede. De volledige crate slaagt nu met 232 unit-tests en 10 paritytests;
  ook `tsc --noEmit`, de formatcontrole en de voorgespannen-ligger-app-route
  slagen. De ligger heeft nog geen automatische scheurwijdte uit zijn FEM-
  toestand, volledige detaillering, variërende doorsnede-inertie of een
  niet-lineaire materiaalwet.
- De ligger accepteert nu optionele `stiffnessSegments` met een positief,
  stukgewijs constant E over een volledig verdeelde, aaneengesloten
  overspanning. Doorbuiging en axiale verkorting integreren met de lokale E;
  evenwichtsreacties en momenten blijven onafhankelijk daarvan. Een ligger met
  30 GPa over de eerste helft en 15 GPa over de tweede helft is met een
  onafhankelijke samengestelde Simpson-referentie gecontroleerd. De Rust-suite
  slaagt nu met 234 unit-tests en 10 pariteitstests; `tsc --noEmit`,
  `rustfmt --check`, `git diff --check` en de rechtstreekse FEM-client/app-route
  voor FHWA, EC2-dwarskracht en de twee E-segmenten slagen.
- De voorgespannen-liggerreferentiekern is nu ook bereikbaar vanuit **Inzicht →
  Voorgespannen ligger**. Het scherm stuurt geometrie en één tot twaalf
  aaneengesloten E-segmenten met eigen grenzen en moduluswaarden,
  voorspankabel, fasegebonden gelijkmatige lasten, meerdere instelbare
  puntlasten en meerdere lineair verlopende gedeeltelijke lastsegmenten per
  overdrachts-/gebruiksfase
  via de FEM-client naar Rust;
  het toont fase-resultaten, stations en de expliciete EC2-beugelberekening.
  De UI-invoerbuilder en kritieke punt-/lijnlastsneden zijn via dezelfde
  Rust-route getest; de driehoeklast valt samen met de onafhankelijke
  Green-functiereferentie voor middenmoment en doorbuiging. Een invoer met vier
  E-segmenten controleert niet-uniforme grenzen, de bijbehorende E-waarden en
  resultaatstations en vergelijkt de externe middenzakking met onafhankelijke
  Green-functie-integratie per E-segment; niet-oplopende grenzen worden vóór
  dispatch geweigerd.
  Meerdere puntlasten per fase worden via de UI-builder met een onafhankelijke
  Green-functie- en evenwichtsreferentie getest. Meerdere gedeeltelijke
  lijnlasten per fase worden gecontroleerd op reactiekrachten en middenmoment
  en met driepunts-Gaussintegratie van de onafhankelijke Green-functie op
  doorbuiging; een afzonderlijke overdrachtslast en twee gebruikslasten toetsen
  dat beide lastverzamelingen fasegebonden blijven. Actieve puntlastposities
  worden ook vóór dispatch begrensd tot de vrije overspanning; nul-lastrecords
  worden niet doorgestuurd. De invoerbuilder controleert tevens positieve
  doorsnede-/beugelwaarden, verliespercentage, cot(theta) en de beugelgeometrie.
  Een inklapbare EC2-7.3.4-controle in dit scherm stuurt ook expliciete waarden
  uit een elders bepaalde gescheurde doorsnede naar dezelfde FEM-dispatch en
  toont wk, sr,max en benutting. Zij rekent de gescheurde doorsnedetoestand
  niet af uit de liggerlasten. De invoerbuilder vergelijkt het handmatige
  FHWA/EC2-fixture; de FEM-client weigert null-, niet-eindige, onbekende of
  onderling strijdige scheurresultaten (wmax, wk, benutting en status). De
  invoerbuilder weigert ook negatieve hechtende wapeningsoppervlakken en een
  niet-positieve opgegeven langswapeningsteek.
- `cargo test --offline -p openaec-native-fem --all-targets`: 218 unit-tests en
  10 integratietests geslaagd, inclusief frame3d-referentietests, EC2 k₂- en
  shellmembraan-scheurinitiatieproeven en de nieuwe voorgespannen-liggerproef
  met kritieke sneden tegen een dichte responssteekproef. De Blaauwendraad-test
  omvat nu alle vier Cement-membraangevallen en hun grensovergangen. De
  Sétra-brugcontrole blijft binnen de gepubliceerde scheurwijdte. De 3D-
  raamwerkvezelrespons vergelijkt beide lokale krommingstangenten met de
  elementstijfheid en controleert de blijvende staalplastificatie en
  betontrekschade ook via de app-route. De volledige testset is opnieuw
  uitgevoerd na toevoeging van de gekoppelde N-My-Mz-tangent, de axiale
  compatibiliteitsgeschiedenis, de vrijgegeven vezelrotaties en de proef met
  twee aparte Q4-plaatgebieden met eigen E(rek)-geschiedenis en een
  niet-uniforme GNL-plaatdrukproef tegen Navier; alle 218
  unit-tests en 10 integratietests slagen. De onafhankelijke 24-elementige
  My-release-proef valt binnen 2% van de vezelreferentie. De bijgewerkte
  native 3D-app-route controleert lastpad-ontlasting, betonschade, thermiek,
  staalplastificatie met een buigeindrelease en nul vrijgegeven eindmoment. De aanvullende
  8/16-elementenproef voor gecombineerde staal-FNL/GNL slaagt eveneens.
  Voor 2D vergelijkt een staalbalk met rotatievrijgave de tipverplaatsing met
  onafhankelijke numerieke M-κ-integratie; de app-route controleert daarnaast
  staalplastificatie en betontrekschade én nul moment aan de vrijgegeven zijde.
  De app-route controleert ook de momentoverdracht door rotatieveereinden voor
  staal-FNL en beton-FNL.
  Een 16-elementige FNL-staalbalk met rotatieveer wordt eveneens met
  onafhankelijke M-κ-integratie plus veerrotatie vergeleken.
  De nieuwe 16-elementige staal-FNL-proef met dwarse eindveer stemt overeen met onafhankelijke M-κ-integratie; de 2D-app-route toetst bovendien staalplastificatie en betonscheurvorming bij dwarse eindveren en staalplastificatie en betonscheurvorming bij dwarsvrijgave met nul dwarskracht. Gecombineerde N-M-staal- en beton-FNL met axiale eindveer worden tegen onafhankelijke sectie-evenwichtsvergelijkingen gecontroleerd; axiale vrijgave met thermische rek behoudt N=0 terwijl buigplastificatie doorgaat. Een tweeledige FNL-ligger met E=210 en 170 GPa stemt overeen met een onafhankelijke M-κ-referentie en wordt ook via de app-route getoetst. Een 3D-rotatieve knoopveer met staalvezelplastificatie is onafhankelijk met M-κ en veerrotatie gevalideerd en loopt via de app-adapter. De volledige native FEM-crate slaagt met 215 unit-tests en 10 frame3d-pariteitstests.
  Ook de volledige `--filter=native-` app-batterij is na deze wijziging
  opnieuw uitgevoerd: 14/14 testbestanden geslaagd, inclusief 2D-/3D-
  raamwerken, platen, voorgespannen ligger en wapeningsadapters.
  De 3D-plaat-app-route is opnieuw met FNL-lastpad getest; ook de GNL-app-route met randlijnlast slaagt tegen de lineaire hybride kleine-doorbuigingsreferentie. Een gecombineerde
  3D-staalproef met N, My en Mz stemt overeen met een
  onafhankelijke Newton-oplossing van de 9-vezeldoorsnede; de tipvervormingen,
  plastische historie en app-route worden meegecontroleerd. Die doorsnedetest
  doorloopt nu ook `0 → 0,25 → 0,5 → 0,75 → 1,0 → 0,5 → 0,75` met vaste
  vezeltoestand per geaccepteerde stap. De eindresultanten, globale
  verplaatsingen en behouden equivalente plastische rek na ontlasten en
  herbelasten sluiten aan op de sectiereferentie. De volledige
  crate slaagt nu met 218 unit-tests en 10 pariteitstests; de native
  3D-plaat-app-route slaagt ook afzonderlijk na de materiaalkrommetest.
- De GNL-shell onder q(x,y)=qmax·x/a is aanvullend vergeleken met een
  onafhankelijke Fourier-Ritz-stationariteitsoplossing van de von Kármán-energie.
  De 5×5 reeks is op (a/4,b/2) tot 0,018% van de 4×4 reeks geconvergeerd;
  het 8×8 Q4-resultaat wijkt op dit punt 0,64% af en in het midden 0,30%.
  Ook de spiegeling bij omgekeerde drukgradiënt, krachtbalans en Newton-residu
  slagen. Reproduceerbare referentie: `scripts/verification/independent_vk_tapered_plate.py`.
  Een afzonderlijke polynomiale Ritz-referentie voor een ingeklemde 2×1 m plaat
  onder trapeziumvormige randlijnlast convergeert voor de tipdoorbuiging naar
  w/t=0,666667. De geometrisch niet-lineaire 8×4 Q4-proef blijft binnen 5%,
  spiegelt bij omkering van de last en sluit op 1000 kN reactie en Newton-residu.
  Referentie: `scripts/verification/independent_vk_cantilever_edge_load.py`.
- `cargo test --offline --workspace --exclude open-fem2d-studio`: opnieuw
  uitgevoerd met de meegeleverde Node 24-runtime op `PATH`, `OPENAEC_NODE` en
  een schrijfbare `XDG_CACHE_HOME`; alle tests en doctests van de
  niet-desktopcrates slagen. Twee tests zijn expliciet als ignored gemarkeerd.
- De app-routebatterij `--filter=native-` slaagde eerder: 14/14 bestanden. Na
  de scheurcontrolewijziging slaagde ook de gerichte 3D-plaatroute opnieuw; de
  2D-/3D-drielagenroutes bevestigden nu bovendien de gerapporteerde
  reinforcement-case labels.
  Op 1 oktober zijn de TypeScript-bronproeven opnieuw doorlopen: alle 14
  native FEM-app-routes slagen. De bundelbuild is opnieuw gegenereerd en de
  volledige kale-Node-bundelsuite slaagt met 67/67 bestanden. De testrunner
  classificeert de Rust-dispatcher- en native app-routes expliciet als
  bron-only, zodat ze niet onterecht als sidecarkernproeven worden uitgevoerd.
  De volledige bronbatterij haalde 215/234 bestanden (10.123 geslaagde
  controles). De 18 resterende browser-/UI-testbestanden vereisen een
  ingestelde Chromium; daarnaast signaleert `i18n-vaste-tekst` 13
  hardgecodeerde UI-teksten. De golden- en sidecarproeven zijn buiten de
  sandbox opnieuw uitgevoerd en slagen met respectievelijk 38 en 99 controles.
  De voorgespannen-liggerroute bevat de optionele EC2-`VRd,c`-takken zonder
  beugels en dimensionering/controle van verticale beugels per station; de
  gescheurde/ongescheurde capaciteit volgt Worked Example 6.3 en de vereiste
  `Asw/s` en `VRd,max` volgen Worked Example 6.4. De EC2-7.3.4-
  scheurwijdtepostprocessor is beschikbaar via Rust en MCP voor expliciet
  aangeleverde gescheurde doorsnedewaarden; invoer met een neutrale lijn op of
  achter de trekstaal wordt afgewezen. Hij leidt die doorsnedewaarden nog niet
  automatisch uit het ligger-FEM-model af. De native FEM-crate slaagt
  na deze uitbreiding met 226 unit-tests en 10
  frame3d-pariteitstests. De voorgespannen-liggerapp-route is via
  `nativeFemClient` getest met de FHWA-camberreferentie, kritieke sneden en de
  EC2-referenties. Dit is nog geen complete liggerontwerpcontrole: automatische
  hoekkeuze, minimumbeugelwapening/-afstand, detaillering en automatische
  afleiding van de gescheurde doorsnedewaarden voor de ligger-scheurwijdtecheck
  ontbreken. `tsc --noEmit` en
  `rustfmt --check` op de gewijzigde Rust-bestanden slaagden. Een
  repositorybrede `cargo fmt --check --all` toont formatteringsverschillen in
  bestaande, niet-gerelateerde bestanden; die zijn niet automatisch aangepast.
- De volledige workspace inclusief desktopapp is nog niet compileerbaar in deze
  Linux-omgeving: `glib-sys` en `gobject-sys` vinden de systeembibliotheken
  GLib/GObject >= 2.70 niet. Dit is een omgevingsblokkade, geen geslaagde
  desktopbuild; de GUI-route wordt daarom ook via de TypeScript-app-tests
  gecontroleerd.

### Verificatie op 2 oktober 2026

- De native 2D-plaatapp-route ondersteunt nu ook initiële scheefstand. Elk
  belastinggeval wordt in beide richtingen opgelost en de tegengestelde variant
  gebruikt dezelfde `SCHEEFSTAND_ID_OFFSET`-metadata als de bestaande solver.
  FNL-combinaties gebruiken de richting die bij die combinatie hoort. De
  Q4-app-pariteitstest vergelijkt beide richtingen met de bestaande solver,
  controleert reacties en verplaatsingen en verifieert dat `H = φV` als
  horizontale knooplast aan Rust wordt doorgegeven. `tsc --noEmit`, de gerichte
  Quad4-routeproef en `git diff --check` slagen.
- De native DKT- en hybride plaatadapters sturen verticale en rotatieve
  oplegveren nu als `kw`, `kthetaX` en `kthetaY` met omzetting van N/Nm naar
  kN/kNm door. De DKT-route is vergeleken met een onafhankelijke globale
  stijfheidsassemblage met middenknoopveren; verplaatsingen, rotaties,
  veerreacties en elementmomenten stemmen overeen. De hybride adaptertest
  controleert de DOF- en eenhedenmapping. `tsc --noEmit` en
  `git diff --check` slagen.
- De `E_mean,fin`-eindtoestanden uit EN 1995-1-1 lopen in eerste-orde Rust-
  berekeningen nu via dezelfde `eindstijfheidInvoer` en de gekozen native
  raamwerk- of plaatroute. De gevallen per ψ₂/BGT worden gekoppeld aan
  `combineResults`; GNL/FNL-eindtoestanden worden expliciet als onbeschikbaar
  gemeld. De frame-app-route vergelijkt de doorbuiging voor ψ₂ = 0,5 met de
  bestaande solver en bevestigt dat de eindtoestandvariant E_mean,fin gebruikt.
  `test-hout-eindstijfheid.mjs` slaagt met 60 controles; de native frame-route,
  `tsc --noEmit` en `git diff --check` slagen.
- De gedeelde plaatmesher handhaaft de 4.000-vrijheidsgradenlimiet alleen voor
  de dense TypeScript-solver; de native route mag nu tot de Rust-kern gaan.
  Een end-to-end 40×40 Quad4-model (meer dan 4.000 vrijheidsgraden volgens de
  oude mixed-mesh telling) wordt geweigerd door de dense route en opgelost
  door de sparse Rust-route. De Quad4-app-route, `tsc --noEmit` en
  `git diff --check` slagen.
- Herverificatie na deze route-uitbreidingen: `cargo test --offline -p
  openaec-native-fem --all-targets` slaagt met 234 unit-tests en 10
  frame3d-pariteitstests. De bronapp-batterij `--filter=native-` slaagt met
  14/14 bestanden; daarin zit ook de 40×40 sparse Quad4-app-proef.
- De native Quad4-kern accepteert nu orthotrope vlakspanningsmaterialen met
  `E₁`, `E₂`, `ν₁₂`, `G₁₂` en hoofdrichting. De elasticiteitsmatrix wordt in
  de materiaalassen opgebouwd en naar globale assen gedraaid; een afnemende
  E-curve schaalt de volledige orthotrope matrix, terwijl een isotrope
  plastische/schadewet op orthotroop materiaal expliciet wordt geweigerd. De
  app-route vergelijkt een 23° C24-plaat met de bestaande solver; de
  onafhankelijke Rust-coupon controleert de analytische trekvervorming,
  spanning en secant-E-verzwakking. De Rust-crate slaagt met 235 unit-tests en
  10 frame3d-pariteitstests; `tsc --noEmit`, `rustfmt --check` en
  `git diff --check` slagen.
- De native CST-driehoekskern ondersteunt nu dezelfde orthotrope vlakspanning
  en materiaaldraaiing als Quad4. Een dalende secans-E-curve schaalt E₁, E₂ en
  G₁₂ samen, ook in de materiaalroute; niet-lineaire plastische/schadewetten
  op orthotroop materiaal blijven expliciet geweigerd. De onafhankelijke
  rechthoekige assenproef controleert verplaatsingen, spanning en E-verzwakking;
  de 23° C24-app-proef vergelijkt verplaatsingen en reacties met de bestaande
  solver. Gerichte app-route slaagt. Volledige Rust- en TypeScript-validatie
  slaagt: 236 Rust-unit-tests en 10 frame3d-pariteitstests, `tsc --noEmit`,
  `rustfmt --check` en `git diff --check`.
- De lineaire DKT-buigkern en adapter accepteren nu orthotroop E₁/E₂/ν₁₂/G₁₂
  met materiaaldraaiing; de getransformeerde buigmatrix gebruikt Q̄·t³/12.
  Een onafhankelijke hoofdascontrole bevestigt de twee richtingsstijfheden en
  90°-rotatie; de app-adapter/solverproef controleert een 23°-C24-plaat op
  eindige verplaatsingen en momenten. Een aparte assemblage met de DKT-B-matrix
  controleert alle knoopverplaatsingen/-rotaties en elementmomenten tegen een
  onafhankelijk gedraaide Q̄-matrix. `test-native-plate-bending-comparison.mjs`,
  `tsc --noEmit`, `rustfmt --check` en `git diff --check` slagen. DKT blijft
  lineair; orthotrope secant-E/FNL is daar nog niet beschikbaar.
- De hybride Kirchhoff-kern gebruikt nu de inverse gedraaide orthotrope
  buigstijfheid in de complementaire energie, momenten- en krommingsherleiding.
  De materiaalkromme schaalt E₁/E₂/G₁₂ samen. De geometrisch niet-lineaire
  schaalroute gebruikt dezelfde richtingsmatrix voor membraan en buiging bij
  elastisch orthotroop materiaal. Rust-proeven controleren de materiaalassen,
  90°-rotatie, orthotrope membraanresultante en secant-E-verplaatsing tegen een
  vaste-E-referentie; de app-proef controleert 23° C24 in hybride buiging en
  gecombineerde GNL/FNL-schaal. `test-native-quad2d-comparison.mjs` slaagt.
  Orthotrope plastische/schadewetten en de isotrope wapeningspostprocessor
  worden expliciet geweigerd voor deze routes.
- Eindcontrole van de orthotrope plaat/schaaluitbreiding: de gecombineerde
  membraan- en buigrek-herleiding gebruikt nu dezelfde orthotrope compliance
  als de elementformulering, ook in centrum- en integratiepuntresultanten.
  `cargo test --offline -p openaec-native-fem --all-targets` slaagt met 238
  unit-tests en 10 frame3d-pariteitstests; de native app-batterij slaagt met
  14/14 testbestanden, inclusief hybride plaat- en Quad4-routes. De afzonderlijke
  vierkantsmesh/Quad4/hybride-plaatvergelijking, `tsc --noEmit`,
  `rustfmt --check` op `hybrid_plate.rs` en `git diff --check` slagen. Een
  repositorybrede `cargo fmt --check --all` meldt bestaande formatteringsverschillen
  in andere crates; die bestanden zijn niet gewijzigd door deze eindcontrole.
- De DKT-buigkern verwerkt nu ook secans-E-curven per driehoek met opgegeven
  lastpad, iteratieve stijfheidsherziening en blijvende piekvezelrek bij
  ontlasten/herbelasten. Bij orthotroop materiaal schaalt de curve E₁, E₂ en
  G₁₂ samen. De adapter en getypeerde `nativeFemClient.solveNativePlateBending`
  geven curve en lastpad door en maken effectieve E en piekvezelrek beschikbaar;
  de end-to-end proef
  vergelijkt de 23°-plaat na ontlasten met een vaste, equivalente zachte
  orthotrope referentie voor alle knoopverplaatsingen en elementmomenten. De
  app-clientproef assembleert die zachte referentie bovendien onafhankelijk
  uit de gereduceerde Q̄-matrix, met volle oplegveer-stijfheden, en vergelijkt
  daar direct de secans-E-verplaatsingen en -momenten mee.
  Een aparte principalerekproef controleert de omzetting van engineeringstwist
  naar vezelrek. `cargo test --offline -p
  openaec-native-fem --all-targets` slaagt nu met 240 unit-tests en 10
  frame3d-pariteitstests; de native app-batterij slaagt met 14/14 bestanden,
  inclusief `test-native-plate-bending-comparison.mjs` en de getypeerde
  clienttransporttest voor `solveNativePlateBending`. Een Rust-dispatchtest
  stuurt dezelfde orthotrope E-curve en het op/neergaand lastpad door
  `solve_native_fem` en controleert de effectieve E en piekvezelrek in de
  geserialiseerde uitvoer. De volledige native app-batterij blijft 14/14; de
  Rust-crate slaagt met 241 unit-tests en 10 pariteitstests. `tsc --noEmit`,
  gerichte `rustfmt --check` en `git diff --check` slagen.
- Hercontrole op 2 oktober: `cargo test --offline -p openaec-native-fem
  --all-targets` slaagt opnieuw met 241 unit-tests en 10 frame3d-pariteitstests;
  alle 14 native TypeScript-app-routebestanden slagen; `tsc --noEmit`, de
  Vite-productiebundel en `git diff --check` slagen. De volledige bronbatterij
  haalt 213/234 bestanden. De native routes zijn groen; de resterende uitval
  bestaat uit Chromium-afhankelijke UI-proeven en bestaande suite-/omgeving-
  kwesties in golden, i18n-vaste-tekst, rapport-verloop-reden en sidecar. Deze
  laatste punten zijn geen bewijs van een solverregressie en blijven apart te
  onderzoeken voordat de volledige applicatietestbatterij als groen kan gelden.
- De 2D-Q4 secans-E-proef is aangescherpt tot een exacte uniaxiale referentie:
  160 kN op 0,1 m² geeft bij Esec = 800 MPa een rek van 0,002 en 2 mm
  verplaatsing; reacties en Gauss-puntspanning sluiten op 160 kN en 1,6 MPa.
  Na volledig ontlasten blijft de piekrek behouden; bij herbelasting tot 80 kN
  volgt onafhankelijk 1 mm, 0,8 MPa en dezelfde Esec van 800 MPa. De gerichte
  Rust-test slaagt. Dezelfde coupon loopt ook via de bestaande Quad4-adapter:
  de N→kN-invoer, lastpad, piek-/nul-/half-lastuitvoer, Gauss-puntstatus en
  reacties komen overeen met de onafhankelijke oplossing.
- De native 2D-app-route bouwt standaard rechthoekige Q4-platen met de
  Rust-mesher, inclusief rechthoekige openingen en meerdere aangrenzende platen.
  De adapter controleert per plaat dat knoopcoördinaten, cellen, aantallen,
  elementidentiteiten en doorsnede-eigenschappen exact bij het app-model passen;
  gedeelde randknopen worden daarna samengevoegd en lasten en steunen behouden
  hun app-identiteit. De end-to-end proef vergelijkt verplaatsingen, reacties en
  elementresultanten met de bestaande solver. Ook een aangrenzend heterogeen
  FNL-model met verschillende diktes, basis-E-moduli, secans-E-curven en een
  belastings-/ontlastings-/herbelastingspad behoudt per plaat de eigen modulus.
- Een opgeslagen, zuiver-Q4-cache voor een niet-rechthoekige L-plaat wordt nu
  ongewijzigd door de native Rust-oplosser gebruikt. De app-routeproef controleert
  knoopverplaatsingen, oplegreacties en zes membraanresultanten per element tegen
  de bestaande solver. Een tweede proef houdt die cache vast tijdens FNL en
  controleert de doorgegeven secans-E-curve, het belasten-/ontlasten-/herbelastenpad
  en de verlaagde effectieve modulus in de Rust-uitvoer; tegelijk wordt bewezen
  dat de opgeslagen mesh niet opnieuw door de Rust-mesher wordt vervangen. De
  app-cdt blijft bij polygonen dus de meshbron; alleen de Q4-oplossing is native.
  Gemengde drie-/vierhoeksroosters gebruiken nu één gekoppelde Rust-kern; de
  Q4-cacheproef blijft zuiver Q4.
- Nieuwe `mixed2d`-kern en getypeerde dispatch assembleren CST- en Q4-elementen
  op één globale DOF-vector. Een gemengd L-plaatmodel met vier CST's en één Q4
  doorloopt de app-route; verplaatsingen, oplegreacties en zes membraanresultanten
  per element komen overeen met de bestaande solver. De Rust-patchproef met
  twee CST-elementen naast een Q4 volgt de analytische constante rek, spanning,
  krachtbalans en een klein residu. Gemengde GNL en secans-E FNL gebruiken nu
  dezelfde Newton-laststappen; materiaaltoestand wordt per CST-element en per
  Q4-Gauss-punt alleen na convergentie vastgelegd. Gerichte Rust-proeven
  controleren geometrische versterking, blijvende secans-E-historie bij
  ontlasten/herbelasten, staalplastificatie op de CST's en betonscheurvorming
  op de Q4-punten. De gemengde secans-E-coupon controleert na een volledige
  belasting, ontlasting en halve herbelasting de analytische piekrek, secans-E,
  eindspanning en verplaatsing. De app-routeproef controleert het doorgegeven
  FNL-pad, effectieve E en de krachtbalans op de halve eindlast.
  Gemengde rand-/plaatlasten die niet als knooplast in de kern landen, en
  koppeling met staven blijven open.
- De 2D-raamwerkkern assembleert CST- en Q4-membranen nu samen met frame-elementen
  op de gedeelde translatievrijheidsgraden voor geometrisch niet-lineair rekenen.
  De app-route voert ook materiaal-FNL door: staalplastificatie en afnemende
  E(rek)-curven per plaatmateriaal, naast eventuele axiale staafwetten. Gerichte
  Rust-proeven controleren CST/Q4-evenwicht en framekrachtsoverdracht; de
  app-routeproef controleert lineaire pariteit, GNL-cases en -combinaties,
  plaatplastificatie en gecombineerde GNL/FNL met gerapporteerde effectieve E.
  De native frame-plaatroute, 14 native frontend-routebestanden, `tsc --noEmit`
  en de Rust-unit-testbatterij zijn opnieuw gecontroleerd. De koppeling vereist
  gedeelde/conforme randknopen; MPC-randkoppelingen en een ligger door het
  plaatbinnenvlak worden expliciet geweigerd en blijven open voor implementatie.
- De app-iteratie voor gewapend beton volgens EN 1992-1-1 §5.8.6 gebruikt bij
  de Rust-engine nu ook de native 2D-frameoplosser voor elke bijgewerkte
  secans-EI-segmentverdeling. De eerste-ordecombinaties voor kruipverhouding
  (5.19) worden eveneens uit Rust opgehaald; de niet-lineaire combinatieresultaten
  blijven als afzonderlijke resultaten bewaard en worden niet achteraf
  gesuperponeerd. De routeproef doorloopt de asynchrone stijfheidslus met
  gecontroleerde segmentstijfheden en controleert dat Rust drie EI-segmenten
  terugrapporteert. De versterkte proef `test-fysisch-nietlineair.mjs` gebruikt
  nu tegelijk de echte Rust `toetsbrug`-kern voor M-N-κ en de native
  `native-frame2d`-CLI voor zowel de eerste-ordecombinaties als elke iteratieve
  GNL-stap. Voor een gewapende ligger met zes secans-EI-segmenten controleert
  zij kruip 5.19 (φ_eff = 0,4), convergentie, middenzakking en het statisch
  bepaalde middenmoment tegen de bestaande frame-oplosser; de gemeten EI en
  zakking wijken in dit geval 0,00% af. De volledige regressie draait direct
  met Node/tsx en slaagt met 84/84 controles. De native routeproef en de
  TypeScript-controle zijn ook uitgevoerd; een live UI-/rapportproef met
  wapening en kruip blijft nodig om de zichtbare rapportage te valideren.
- Hercontrole op 2 oktober met de meest recent gebouwde Rust-testharnassen in
  `target/debug/deps`: de native FEM-bibliotheek slaagt met 252/252 unit-tests,
  inclusief hybride plaat, veranderende moduluscurven, vierkantsmesher,
  geometrische schaal, Blaauwendraad/Cement-wapeningsgevallen en scheurwijdte.
  De frame3d-pariteit slaagt met 10/10 vergelijkingen met de bestaande solver.
  De harnesses zijn rechtstreeks uitgevoerd omdat `cargo` niet in de huidige
  omgeving beschikbaar is; dit herhaalt de tests maar bouwt de crate niet
  opnieuw. De bestaande grenzen blijven staan: 3D-staaf-plaatkoppeling,
  niet-conforme koppelingen en onafhankelijke validatie van beschadigde/
  gescheurde plaatbuiging zijn nog niet afgerond.
- De TypeScript-test-runner schrijft de uitvoer van kindprocessen nu naar
  tijdelijke bestanden voordat hij checks telt. Bij testbestanden die direct
  `process.exit()` aanroepen kon Node anders nog gebufferde pipe-uitvoer
  weggooien: een geslaagde suite leek daardoor `0 checks` te hebben en
  foutdetails ontbraken. De bestaande fysisch-niet-lineaire suite rapporteert
  nu weer 84/84, de native 2D-frame-route toont haar samenvatting en een
  opzettelijke mislukking wordt als 1 gefaalde check en mislukte suite gemeld.
  De gebundelde combinatietest slaagt met 300/300 checks; `tsc --noEmit` en
  `git diff --check` slagen. De volledige groep van 14 native frontend-
  testbestanden slaagt eveneens; routes zonder ingebouwde vinkjesteller worden
  nu als geslaagd bestand met `checkteller n.v.t.` getoond.
- De geometrische shell-adapter controleert membraansteunen en -lasten vóór
  transport: referenties moeten naar shellmeshknopen wijzen, per knoop mag
  slechts één steunrecord bestaan, veren zijn eindig/positief en een richting
  kan niet tegelijk vast en verend zijn. Dit voorkomt dat herhaalde steunrecords
  een membraanveer stilzwijgend dubbel stijf maken. De nieuwe adapterrandproef,
  bestaande 3D-plaat-app-routeproef, alle 15 native frontend-routes,
  `tsc --noEmit` en `git diff --check` slagen.
- Onafhankelijke plaatreferenties opnieuw uitgevoerd: de Fourier-Ritz reeks
  voor de taps-belaste von-Kármán plaat convergeert bij 5×5 modi naar
  `w/h = 0,427485` op kwartspan en `0,669986` in het midden (residu
  `3,4·10⁻¹⁹`); de polynomiale Ritz-reeks voor de ingeklemde plaat met
  trapeziumvormige vrije-randlast convergeert bij orde 4 naar
  `w/t = 0,208333` in het midden en `0,666667` aan de rand. Beide controles
  draaien onafhankelijk van de productie-Q4-assemblage.
- De 3D-plaatapp valideert de volledige Rust-uitvoer van de drielagencontrole
  nu ook per punt: unieke punt-ID's, gelijke posities, geldige status, eindige
  benuttingen en niet-negatieve wapening/utilisaties. Een routeproef vervangt
  bewust een benutting door een negatieve waarde, verschuift een resultaatpunt
  en maakt de omhullende status strijdig met de puntstatus; alle drie worden
  afgewezen voordat toetsuitvoer de rapportage bereikt. `tsc --noEmit` en alle
  15 native frontend-routes slagen; `git diff --check` slaagt.
- De 3D-plaatadapter controleert nu ook het volledige geometrische shellantwoord
  tegen de aangevraagde mesh: exacte unieke knoop-/elementidentiteiten, alle
  knoopverplaatsingen en reacties, 21 eindige resultantsamples en 16 geordende
  materiaalpunten per element, geldige toestandsmaten en restresidu ≤ 10⁻⁷.
  De end-to-end proef voert de echte shellroute uit en vervangt daarna expres
  een knoopverplaatsing door niet-eindige uitvoer en een tweede keer het
  residu door `10⁻³`; beide resultaten worden vóór rapportage afgewezen.
  `tsc --noEmit`, de gerichte 3D-plaatroute en `git diff --check` slagen.
- De 3D-raamwerkadapter vereist voortaan exacte één-op-één ID-sets voor de
  Rust-knoop-, staaf-, snedekrachtlijn- en eigenknikuitvoer. De end-to-end
  proef gebruikt geldige solverresultaten en vervangt daarin achtereenvolgens
  een knoop-ID, staaf-ID en diagram-ID door een duplicaat; iedere onvolledige
  set wordt vóór de app-resultatenmapping afgewezen. `tsc --noEmit`, de native
  3D-raamwerkroute en `git diff --check` slagen.
- De FEM-client valideert nu ook beide fasen van de voorgespannen ligger tegen
  het invoercontract: spanningen, krachten, doorbuigingen, effectieve E en
  optionele EC2-dwarskrachtuitvoer moeten eindig en fysisch toelaatbaar zijn;
  stations moeten oplopend binnen de overspanning liggen en zowel de gevraagde
  stations als de eindpunten bevatten. De bestaande FHWA-camber-, puntlast-,
  gedeeltelijke lijnlast-, stukgewijze E- en EC2 §6.3/§6.4-voorbeelden slagen.
  Twee foutproeven verifiëren afwijzing van niet-eindige spanning en een station
  buiten de ligger; een geldige gebruiksfase met 100% voorspanningsverlies mag
  nul voorspankracht behouden. `tsc --noEmit`, de voorgespannen-liggerroute en
  `git diff --check` slagen.
- De 2D-membraanadapter verifieert nu vóór mapping dat alle plaatmeshknopen
  een unieke respons hebben en dat ieder plaatmesh-element exact één resultaat
  heeft. Bij gekoppelde frame-plaatmodellen controleert hij de knoop-ID's tegen
  de gezamenlijke Rust-mesh. Verplaatsingen, reacties,
  spanningen, effectieve E, rek-/schadematen en de vier Q4-Gauss-punten moeten
  eindig en fysisch begrensd zijn. De Quad4-app-route injecteert een dubbele
  native knoop-ID en controleert dat de onvolledige respons wordt afgewezen;
  alle 15 native frontend-routes, `tsc --noEmit` en `git diff --check` slagen.
- De 2D-frameadapter controleert nu ook de geometrische stations van elk
  Rust-staafdiagram: de reeks moet op nul beginnen, oplopend blijven en op de
  aangevraagde staaflengte eindigen. Gelijke stations blijven toegestaan voor
  de twee zijden van een puntlastsprong. Een end-to-end routeproef vervangt
  bewust het tweede station door het eindstation; de onjuist teruglopende
  krachtlijn wordt afgewezen. De 2D-frame-app- en vergelijkingsroutes,
  `tsc --noEmit` en `git diff --check` slagen.
- De 3D-frameadapter verifieert nu per snedekrachtlijn dat de genormaliseerde
  stations binnen `[0, 1]` liggen, oplopen en beide staafeinden bereiken.
  Een eindpunt buiten de staaf wordt in de echte native app-routeproef
  geïnjecteerd en afgewezen. De native 3D-frame-app-route, `tsc --noEmit` en
  `git diff --check` slagen.
- De 3D-plaatadapter controleert nu voor zowel lineaire hybride Q4- als
  geometrische shellresultaten dat iedere aangevraagde meshknoop en elk
  Q4-element exact één unieke respons krijgt. De app-routeproef dupliceert
  achtereenvolgens een hybride knoop-ID en element-ID en controleert dat beide
  responses vóór mapping worden afgewezen. De native 3D-plaatroute,
  `tsc --noEmit` en `git diff --check` slagen.
- Ook reguliere hybride Q4-plaatresultaten moeten nu exact één respons per
  gevraagde meshknoop en element leveren; beide app-paden wijzen een negatief
  residu af. De native 3D-plaatroute injecteert dubbele hybride knoop- en
  element-ID's, een niet-eindige shellknoop en hoge/negatieve shellresiduen. De route,
  `tsc --noEmit` en `git diff --check` slagen.
- De 3D-plaatadapter controleert nu ook de ligging van de 21 Q4-resultaatpunten
  met een eigen bilineaire isoparametrische kaart vanaf de aangevraagde mesh;
  bij FNL worden ook de 16 materiaal-Gaussposities vergeleken. De echte
  hybride- en shellroutes wijzen een verschoven resultaatpunt af, evenals de
  shellroute een verschoven materiaalpunt. De 3D-plaatapp-route,
  `tsc --noEmit` en `git diff --check` slagen.
- De 3D-plaatadapter valideert nu ook de mesh van de Rust-Q4-mesher vóór
  assemblage: unieke positieve knoop-/element-ID's, eindige knopen binnen de
  plaat, vier geldige hoekreferenties, overeenkomend materiaal en dikte en
  positief georiënteerde rechthoekcellen. De oppervlaktesom gebruikt voortaan
  ID-opzoeking in plaats van de aanname dat ID gelijk is aan array-index plus
  één. Iedere cel moet bovendien binnen de door de gebruiker ingestelde
  maximale celmaat blijven. De native route wijst dubbele knoop-ID's,
  onbekende elementknoop-ID's en een opgerekte cel af; de route,
  `tsc --noEmit` en `git diff --check` slagen.
- Bij platen met openingen controleert de adapter nu bovendien elk Q4-celvlak
  op positieve overlap met de openinggeometrie; alleen een correcte totale
  oppervlaktesom is niet voldoende. Een foutproef vervangt een echt celvlak
  door de rechthoek in de opening en wordt vóór assemblage geweigerd. De
  native 3D-plaatroute, `tsc --noEmit` en `git diff --check` slagen.
- De 3D-plaatadapter controleert ook de vier randknoopreeksen van de mesher:
  alle buitenrandknopen moeten precies één keer, in geometrische volgorde en
  op de juiste rand voorkomen, zonder knopen over te slaan. Foutproeven met een
  dubbele, onbekende, verkeerd gelegen of ontbrekende randknoop worden vóór
  opleggingen en assemblage geweigerd.
- De Q4-meshcontrole detecteert nu ook overlappende celinterieurs met een
  x-sweep over de rechthoekige elementen. Daarmee kan een verdubbelde cel geen
  ontbrekend oppervlak maskeren via alleen de oppervlaktesom; een routefoutproef
  die een element op een buurcel legt, wordt geweigerd.
- Losse knopen die door geen Q4-element worden gebruikt, worden ook vóór
  assemblage afgewezen; de native app-routetest injecteert zo'n binnenknoop.
- Verschillende knoop-ID's op dezelfde geometrische coördinaat worden met een
  tolerantiebewuste ruimtelijke hash geweigerd. Zo kan een dubbel punt in het
  plaatinterieur geen niet-gedeelde elementrand en losse topologie veroorzaken;
  de app-routetest vervangt daarvoor een elementreferentie door een gedupliceerd
  binnenpunt.
- Q4-elementranden moeten nu topologisch conform zijn: iedere interne rand is
  door exact twee elementen in tegengestelde richting gedeeld; een enkelvoudige
  rand is alleen toegestaan op de buitencontour of een rechthoekige opening.
  Een test combineert twee echte buurcellen tot één element en laat de daardoor
  ontstane T-splitsing ondanks ongewijzigde totale oppervlakte afwijzen.
- De meshadapter controleert ook eerst of alle knoop- en elementrecords objecten
  zijn. De routefoutproeven injecteren `null` voor elk recordtype en krijgen nu
  een gerichte meshresponsfout vóór ID-mapping of elementassemblage.
- De geometrische-shelladapter valideert ook de recordvorm van knopen,
  elementen, 21 resultantpunten en 16 materiaal-Gauss-punten vóór numerieke
  mapping. Foutproeven met `null` in elk recordniveau worden afgewezen met de
  bestaande ongeldige-shellrespons, zonder een ongerichte runtimefout.
- De lineaire/material-only hybride plaatadapter controleert nu dezelfde
  recordgrenzen voor knopen, elementen en 21 resultantpunten, plus een geheel,
  niet-negatief iteratieaantal. De route injecteert `null` op elk van die
  niveaus; alle responses worden met de gevalideerde plaatfout afgewezen.
- De drielagenbatchcontrole vangt nu ook een ontbrekende batch, een ontbrekend
  puntrecord en een ontbrekende huiduitkomst af. Drie routefoutproeven controleren
  dat de postprocessor geen ongerichte propertyfout doorgeeft.
- De 3D-raamwerkadapter valideert ruwe Rust-records voor knopen, reacties,
  staafeindkrachten en diagrammen vóór mapping. Zes foutproeven injecteren
  `null` in elk niveau en worden met de gerichte resultaatfouten afgewezen.
- De 2D-raamwerkadapter valideert ook de knoop-/staafrecords, verplaatsings- en
  reactievectoren en stations-/eindkrachtarrays vóór het samenvoegen van
  staafsegmenten. Foutproeven voor zes ontbrekende records/arrays en een
  teruglopende stationsreeks worden met de bestaande routefouten afgewezen.
- De 2D-Q4-membraanadapter weigert nu ontbrekende knoop-/elementrecords en
  ontbrekende of verkeerd gevormde Gauss-punten/stressvectoren vóór omzetting
  naar UI-resultaten. De echte Rust-Q4-app-route injecteert deze corrupties en
  controleert ook dat dubbele knoop-ID's worden afgewezen.
- De optionele Rust-Q4-meshvervanging controleert nu ook recordvorm en
  materiaal-/diktepariteit met de oorspronkelijke app-elementen. Een ongeldige
  meshrespons of afwijkend materiaalelement valt veilig terug op de bestaande
  mesh; vier foutproeven controleren dit tegen de lineaire verplaatsingsreferentie.
- De CST- en gemengde CST/Q4-appadapters controleren nu ook ontbrekende
  knoop-, element-, Gauss-punt- en spanningsrecords vóór omzetting. Gerichte
  routeproeven injecteren null-records in de echte Rust-respons; ongeldige
  responses worden afgewezen met een begrijpelijke routefout in plaats van een
  ongerichte propertyfout. Ook een negatief evenwichtsresidu wordt geweigerd;
  de gemengde Rust-route controleert dit met een foutieve solverrespons.
- De gekoppelde 3D-plaatroute weigert ook een negatief evenwichtsresidu uit haar
  optionele 2D-Q4-membraansolve. Een foutproef injecteert dit in een echte
  Rust-Q4-respons vóór de buigresultaten worden samengevoegd.
- De 3D-raamwerkadapter weigert negatieve Newton-veranderingsmaten en negatieve
  tweede-orde-versterking. Twee routefoutproeven controleren deze solvermetadata
  vóór de staaf- en diagramresultaten worden overgenomen.
- Regressiecontrole van alle native frontendroutes: de testbatterij slaagt met
  16/16 suites, waaronder voorgespannen ligger, EC2-scheurwijdte, 2D-/3D-
  raamwerken, platen, schijven en driehoekselementen. `git diff --check` is
  schoon. Rust-broncode is in deze stap niet gewijzigd; `cargo` is niet
  beschikbaar in de huidige shellomgeving.
- De geometrische-shelladapter wijst nu ook null-/arrayrecords voor membraan-
  steunen en -lasten af en accepteert alleen boolean u/v-richtingsvlaggen.
  Gerichte foutproeven, `tsc --noEmit` en `git diff --check` slagen; hiermee
  worden ongerichte runtimefouten en truthy niet-boolean steuninstellingen vóór
  dispatch voorkomen.
- De shell-adapterproef loopt nu ook via `solveNativeGeometricShell`: een
  niet-boolean membraansteun wordt vóór de FEM-clientdispatch geweigerd.
  De onafhankelijke Fourier-Ritz-plaatreferentie reproduceert de eerder
  vastgelegde 5×5 waarden (`w/h=0,669985651` in het midden en `0,427485195`
  op kwartoverspanning); de polynomiale randlastreferentie convergeert naar
  `w/t=0,666666625` bij 4×4 modi. Beide scripts slagen opnieuw.
- Een nieuwe 3D-staalrouteproef toetst een zuivere torsie-uitkraging tegen de
  onafhankelijke elastische oplossing `θ=TL/(GJ)`, met `G` uit de doorgestuurde
  E en ν en `J` uit het profiel; ook de torsiekracht en globale balans sluiten.
  De volledige gerichte 3D-app-route slaagt. De reproduceerbare Q4-
  schaalmeting in `scripts/verification/benchmark_native_quad2d.py` geeft
  voor de bestaande debugbinary 0,79 s / 4,3 MiB bij 882 DOF, 7,74 s /
  7,9 MiB bij 3.362 DOF en 36,20 s / 13,9 MiB bij 7.442 DOF. Alle drie
  gevallen sluiten op 1 kN reactiekracht en een residu kleiner dan 1,5·10⁻¹¹.
  Dit is een uitgangsmeting, geen bewijs voor miljoen-DOF-capaciteit; de
  huidige harde grens blijft 20.000 DOF.
- Op 5 oktober is de officiële stabiele Rust-toolchain voor het gebruikersaccount
  geïnstalleerd: `cargo 1.99.0` en `rustc 1.99.0`. Met de vastgepinde
  afhankelijkheden slagen `cargo test --locked -p openaec-native-fem
  --all-targets`: 252 unit-tests en 10 frame3d-pariteitstests. De eerder
  ontbrekende toolchain blokkeert verdere Rust-validatie daarmee niet meer.
- De eerste 3D-volumekern heeft lineaire isotrope Tet4-elementen en een
  matrixvrije Jacobi-PCG met optionele parallelle elementacties. Het
  35×35×35-rooster bevat 257.250 tetraëders, 46.656 knopen en 139.968 DOF.
  Een uniaxiale affiene 3D-patch controleert zowel de analytische
  verplaatsing als de resulterende trekkracht; de 4-thread-releaseproef
  convergeerde in 197 iteraties met een echt residu van 8,7·10⁻⁹,
  maximale verplaatsingsafwijking 5,6·10⁻¹² m, circa 1,8 s looptijd en
  60 MiB piek-RSS. Eén thread nam circa 2,5 s en 56 MiB. Dit bewijst
  deze modelklasse en machine, niet algemene grote-modelrobuustheid.
- Het aparte 70×70×70-Tet4-rooster haalt ook het voorlopige
  miljoen-DOF-meetdoel: 2.058.000 tetraëders, 357.911 knopen en 1.073.733
  DOF. Na toevoeging van per-elementmateriaal nam de 4-thread-releaseproef
  23,3 s en 481 MiB piek-RSS, met 316
  iteraties en een werkelijk residu van 9,23·10⁻⁸. De totale trekkracht
  is 21.000,022 kN tegenover analytisch 21.000 kN. Een uniform affien
  patchveld is hierbij getest; willekeurige lastgevallen, zwakke
  conditionering en de twee gewenste alternatieve oplossingsmethoden
  blijven open.

### Gewoon 3D-project: grote gemengde volumeproef en materiaalroute (8 oktober 2026)

- Het opgeslagen app-project `docs/verificatie/3d-volume/gemengd-axiaal-3584-volumes.ifcfem2d`
  heeft 3.584 volume-elementen (512 Hex8 en 3.072 Tet4), 1.377 knopen,
  81 inklemmingen en 81 over het eindvlak verdeelde knooplasten met samen
  100 kN. De gewone 3D-app laadt, toont en berekent het project. De gerichte
  bestand-naar-Rust-routeproef vindt −100,000000 kN totale reactie, een
  eindverplaatsing van 1,328·10⁻⁵ m tegenover de staafschatting
  `FL/EA = 1,333·10⁻⁵ m`, en een solverresidu van 9,48·10⁻¹⁰. Deze
  schatting is een globale sanitycheck, geen exacte 3D-continuümreferentie.
- Het eigenschappenpaneel geeft bij dit grote model zonder selectie aantallen
  Tet4/Hex8 en knopen plus maximale verplaatsing, von Mises-spanning en
  oplossingsmethode weer. Het FNL-lastpad verschijnt alleen bij een
  materiaalnietlineaire analyse. Dit is visueel in de browser-devapp met
  het berekende 3.584-elementenproject gecontroleerd.
- Zuivere Tet4-projecten kunnen per element een staal-J2-wet of een
  betontrekschadewet bewaren. De gewone 3D-app stuurt het absolute
  materiaal-lastpad, ook bij ontlasten, door naar de bestaande Rust-kernen;
  de resultaten bevatten per element plastische rek of trekschade. Twee
  opgeslagen couponprojecten (`tet4-materiaal-staal-j2-coupon.ifcfem2d` en
  `tet4-materiaal-betonschade-coupon.ifcfem2d` in dezelfde map) en een
  app-routeproef controleren de invoer,
  spanning/reacties tegen onafhankelijke eenassige referenties, historie en
  globale balans. De route is kleine-rek materiaal-FNL; Hex8, raamwerk en
  platen worden in hetzelfde FNL-stelsel expliciet geweigerd. De lineaire
  gemengde route blijft daarvan gescheiden. Een gekoppeld groot
  materiaal-FNL-model is nog niet aangetoond; de beperkte gecombineerde
  GNL/FNL-route voor Tet4-staal staat hieronder.

### Gewoon 3D-project: eindige vervorming en J2-staal (8 oktober 2026)

- De gewone 3D-editor biedt voor zuivere Tet4-staalmodellen nu een expliciete
  keuze tussen kleine rek en eindige vervorming. De eindige-rekroute gebruikt
  de bestaande totale-Lagrange Rust-kern `volume3dFiniteJ2`, inclusief
  plastische geschiedenis bij een absoluut lastpad met ontlasten. De
  elementweergave onderscheidt Cauchy-spanning van de eerste
  Piola-Kirchhoff-spanning en toont equivalente plastische rek. Het rapport
  benoemt de eindige-rekroute en de gebruikte spanningsmaat.
- Het opgeslagen gewone 3D-project
  `docs/verificatie/3d-volume/tet4-eindige-rek-staal-j2-coupon.ifcfem2d`
  bevat 48 Tet4-elementen en twee laststappen (plastificatie en elastische
  ontlasting). De app-routeproef vergelijkt de invoer en uitvoer met een
  onafhankelijke diagonale Hencky/J2-terugkeerberekening: plastische rek,
  eerste Piola- en Cauchy-spanning, vrije middenknoop en globale balans.
  Een extra app-routeproef voegt op één Tet4 een volumekracht van
  48 kN/m³ toe: de laatste stap reageert met −1 kN op het elementvolume
  van 1/48 m³, zonder de kracht dubbel als knooplast in te voeren.
  De browser-devapp heeft hetzelfde project daadwerkelijk met Open FEM Rust
  berekend: 2,121 mm maximale verplaatsing en 112,638 MPa maximale
  von Mises-spanning. De browser bewaart de solverkeuze nu in localStorage;
  de Tauri-desktop blijft zijn plugin-store gebruiken.
- De optionele getypeerde `volume3dFiniteJ2Coupled`-route assembleert nu
  elastische eindige-rek 3D-trekstaven en plastische Tet4-volumes op dezelfde
  translatievrijheidsgraden in iedere Newton-stap. De trekstaaf gebruikt
  Green-axiale rek en een uit de referentie-energie afgeleide materiaal- en
  geometrische tangent; zijn gerapporteerde normaalkracht is de actuele
  axiale kracht. De een-Tet4-plus-een-trekstaaf-parallelproef vergelijkt
  kracht, verplaatsing, Piola-spanning, ontlasten en reacties met gesloten
  Hencky- en Green-rekformules. Dicht, sparse GMRES, frontaal, matrixvrij
  GMRES met vier threads, de grote matrixvrije variant en automatisch slagen.
  Een aparte eindige-differentieproef controleert alle 36 tangentcomponenten
  en een starre rotatie. Het opgeslagen 3D-project
  `docs/verificatie/3d-volume/tet4-eindige-rek-j2-met-trekstaaf.ifcfem2d`
  combineert 48 Tet4-elementen en één trekstaaf aan de vrije middenknoop.
  De normale app-route en de browser-devapp rekenen het model door: 2,121 mm
  maximale verplaatsing, 114,155 MPa maximale von Mises-spanning; de
  trekstaafkracht volgt uit zijn actuele lengte en beïnvloedt aantoonbaar de
  vrije volumeknoop. De app-route controleert ook plastische geschiedenis,
  globaal evenwicht en backendpariteit met matrixvrije GMRES op vier threads.
- Een tweede opgeslagen 3D-project,
  `docs/verificatie/3d-volume/tet4-eindige-rek-j2-3072-volumes-trekstaaf.ifcfem2d`,
  verbindt één elastische eindige-rek trekstaaf aan een vrije binnenknoop van
  3.072 plastische Tet4-elementen (729 knopen). De normale app-route rekent
  dit model met matrixvrije GMRES op vier threads door en controleert
  plastische geschiedenis, globaal evenwicht, de veranderde middenknoop-
  verplaatsing en de actuele trekstaafkracht tegen de Green-rekformule.
  De routeproef gaf 0,965188 mm middenknoopverplaatsing en 4.499,670 kN
  trekstaafkracht. De browser-devapp laadt en berekent hetzelfde project:
  3.072 volume-elementen, één staaf, 2,121 mm maximale verplaatsing en
  matrixvrije GMRES als werkelijke backend. Dit is een schaalproef voor deze
  specifieke koppeling.
- Een expliciete release-acceptatieproef
  `tests/volume_finite_j2_coupled_truss_scale.rs` koppelt vervolgens één
  trekstaaf aan een vrije binnenknoop van **257.250 plastische Tet4**
  (139.968 DOF) en rekent matrixvrij op vier threads. De staaf verstoort het
  affiene volumeverplaatsingsveld aantoonbaar: de middenknoop wijkt
  2,818·10⁻⁵ m af. De analytische Green-rekformule op de actuele eindpunten
  geeft dezelfde 83,510508 kN trekstaafkracht; het vrij residu is
  1,103·10⁻⁸ kN en de globale reactiekrachtsom sluit. De run duurde
  226,81 s. Een 3.072-Tet4-variant draait in de gewone tests; de 34.992-
  en 257.250-elementenvarianten zijn wegens rekentijd `ignored` en zijn
  expliciet in release uitgevoerd. Dit bewijst de grote
  **Tet4/J2-plus-een-trekstaaf**-route op deze gestructureerde mesh, niet een
  algemeen gekoppeld 250.000-elementenmodel met platen of buigende frames.
- De route geldt voor Tet4 met J2-staal, optioneel gekoppelde *elastische*
  axiale trekstaven en vaste referentiebelastingen. Beton bij eindige
  vervorming, Hex8-plasticiteit, materiaal-FNL van de trekstaaf en
  GNL/FNL-koppeling met buigende frames of platen zijn nog open. De
  48-elementenproef valideert deze patch, niet de robuustheid van willekeurige
  grote niet-lineaire gemengde modellen of constructieve volumetoetsing.
- Een tweede opgeslagen gewoon 3D-project,
  `docs/verificatie/3d-volume/tet4-eindige-rek-j2-3072-volumes.ifcfem2d`,
  heeft 3.072 Tet4-elementen, 729 knopen en 343 vrije binnenknopen. De
  reproduceerbare generator staat in
  `scripts/verification/generate_large_finite_j2_app_fixture.py`. Het
  tweestapslastpad plastificeert en ontlast; de app gebruikt expliciet
  matrixvrije GMRES met vier threads. De app-routeproef vergelijkt met een
  onafhankelijke diagonale Hencky/J2-oplossing: maximale fout 2,70·10⁻¹³ m
  in verplaatsing, 1,39·10⁻¹² in equivalente plastische rek en
  1,82·10⁻⁷ MPa in eerste Piola-spanning. De browser-devapp laadt en
  berekent het bestand, met 2,121 mm maximale verplaatsing en 112,64 MPa
  maximale von Mises-spanning. Dit is een geordende affiene patch met
  opgelegde randverplaatsingen; vrije vorm, willekeurige krachten,
  koppelingen en algemene grote-modelconvergentie blijven apart te toetsen.
- Het opgeslagen betonproject
  `docs/verificatie/3d-volume/tet4-betonschade-3072-volumes.ifcfem2d`
  gebruikt dezelfde 3.072-Tet4-mesh, een expliciete scheurbandbreedte van
  0,125 m en 1.000 N/m breukenergie. De axiale affiene rek is op alle knopen
  opgelegd; 343 binnenknopen behouden elk twee vrije laterale DOF (686
  totaal). Na overschrijden van de treksterkte en ontlasten sluit de
  app-routeproef op een onafhankelijke uniaxiale exponentiële schadewet:
  maximaal 9,67·10⁻¹⁵ m verplaatsingsfout, 2,47·10⁻¹⁰ schadefout en
  2,32·10⁻⁹ MPa spanningsfout. De browser-devapp laadt en berekent hetzelfde
  bestand: 0,104 mm maximale verplaatsing en 1,44 MPa maximale von
  Mises-spanning. De sparse-GMRES-berekening bewijst deze
  gecontroleerde schadepatch. Een vooraf onderzochte variant met ook vrije
  axiale binnenverplaatsingen en 100 N/m breukenergie liep na 24
  terugstappen vast kort na de schadeaanvang; die algemene
  verweking/lokalisatie is hiermee uitdrukkelijk niet gevalideerd.
- De 3D-Views-instellingen hebben nu een schuifregelaar voor de visuele
  opleggingsgrootte (25–300%). Deze instelling schaalt alleen de
  opleggingssymbolen; lasten en constructieve randvoorwaarden blijven gelijk.
  De waarde wordt lokaal en in opgeslagen 3D-views bewaard. De symbolen zijn
  in de devapp op 200% gecontroleerd; tests controleren schaal en opslag.

### Gekoppeld eindige-rek Tri3-membraan (8 oktober 2026)

- `solid_finite_membrane` voegt een totaal-Lagrangiaans Tri3-membraan met
  drie translatie-DOF per knoop toe. De referentie-energie gebruikt
  Green–Lagrange-rek en een elastische vlakspanningswet voor tweede
  Piola–Kirchhoff-spanning, overeenkomstig de
  [COMSOL-membraankinematica](https://doc.comsol.com/6.4/doc/com.comsol.help.sme/sme_ug_theory.06.141.html)
  en [spanningsinterpretatie](https://doc.comsol.com/6.4/doc/com.comsol.help.sme/sme_ug_membrane.11.16.html).
  Alle 81 consistente-tangentcomponenten zijn met gecentreerde
  krachtverschillen gecontroleerd; een starre rotatie geeft nul spanning en
  een eenassige vlakspanningsproef sluit op de analytische referentie.
- De getypeerde `volume3dFiniteJ2MembraneCoupled`-route assembleert deze
  membranen met plastische Tet4 en optionele elastische eindige-rek
  trekstaven in hetzelfde Newtonstelsel. Een onafhankelijke
  één-Tet4-plus-één-Tri3-parallelkrachtproef vergelijkt de vrije verplaatsing,
  solid-Piola-spanning, membraan-PK2-spanning, reacties en residu voor dicht,
  sparse GMRES, frontaal, matrixvrij, groot matrixvrij en automatisch.
  Het gewone 3D-project
  `docs/verificatie/3d-volume/tet4-eindige-rek-j2-trekstaaf-membraan.ifcfem2d`
  bevat 48 plastische Tet4, een trekstaaf en een Tri3-membraan met een vrije
  gedeelde knoop. De app-route reconstrueert de Green-rek en spanning
  onafhankelijk uit de deformeerde knopen, bewijst invloed op de vrije
  volumeknoop en vergelijkt een matrixvrije berekening op vier threads. De
  browser-devapp laadt en berekent het project via **Berekenen**: 48 volumes,
  één staaf, één plaat, 2,121 mm maximale verplaatsing en 114,185 MPa maximale
  volume-von-Mises-spanning.
- `tests/volume_finite_j2_membrane_scale.rs` koppelt vervolgens een ingebed
  Tri3-membraanveld en één trekstaaf aan vrije binnenknopen van dezelfde
  plastische Tet4-mesh. De gewone 3.072-Tet4/128-Tri3-proef en de expliciete
  releaseproeven met 34.992 Tet4/648 Tri3 en **257.250 Tet4/2.450 Tri3**
  slagen op vier matrixvrije threads. De grote proef had 139.968 DOF,
  1,060·10⁻⁸ kN vrij residu en duurde 219,88 s. Zij controleert de
  trekstaafkracht (83,791453 kN) en een lokaal berekende membraan-PK2-spanning
  (S11 = 202,188821 MPa) opnieuw uit de deformeerde eind- en hoekknopen;
  de globale reactiekrachtsom sluit. De gedeelde vrije knoop verstoort de
  affiene membraanspanning aantoonbaar. Deze acceptatie geldt voor de
  gestructureerde mesh en opgelegde buitenrandverplaatsingen; willekeurige
  grote gekoppelde topologieën en krachtgestuurde instabiliteiten blijven
  afzonderlijk te valideren.
- `tests/volume_finite_j2_mixed_force_path.rs` vult dit aan met een
  **krachtgestuurde** 48-Tet4/8-Tri3/1-trekstaaf-proef. De vrije binnenknoop
  krijgt 500.000/−250.000/150.000 kN, waarna de volledige last verdwijnt.
  Het model houdt na ontlasten plastische rek en verplaatsing over, de
  reactiekrachtsom en het vrije residu sluiten, en de trekstaafkracht wordt
  opnieuw uit de actuele eindpunten berekend. Dicht, sparse GMRES,
  frontalWave, matrixvrij, groot matrixvrij en automatisch geven dezelfde
  eindverplaatsing binnen 10⁻⁷ m en equivalente plastische rek binnen 10⁻⁷.
  De proef onthulde dat frontalWave een membraantangent met uitsluitend
  afrondingsscheefheid in bijna-nulwaarden afwees. De lokale tangenten worden
  nu eerst op matrixnorm gecontroleerd en pas daarna exact gesymmetriseerd;
  materieel asymmetrische tangenten blijven een fout.
  Het opgeslagen 3D-project
  `docs/verificatie/3d-volume/tet4-eindige-rek-j2-kracht-ontlasten-membraan.ifcfem2d`
  bevat dezelfde 48 Tet4, acht Tri3 en trekstaaf. De gewone app-adapter voert
  het lastpad `[1, 0]` door en vergelijkt automatische, frontale en grote
  matrixvrije uitkomsten met de Rust-referentie, plus onafhankelijk
  gereconstrueerde trekstaafkracht en membraan-PK2-spanning. De ontwikkelapp
  heeft het opgeslagen project bovendien geopend en via **Berekenen**
  opgelost: 27 knopen, 48 volumes, acht platen, één staaf, 1,114 mm maximale
  resterende verplaatsing en 257,21 MPa maximale von-Mises-spanning.
- Deze elastische route heeft uitsluitend *membraanwerking* met een St Venant–Kirchhoff
  vlakspanningswet. De later toegevoegde J2-membraanwet staat hieronder. Buigstijfheid, rotatie-DOF, wrinkling en buigende plaat-FNL,
  beton bij eindige rek en Hex8-plasticiteit zijn nog niet aangetoond. Het is geen
  Blaauwendraad-buigplaatelement.

### Gekoppelde plastische eindige-rek trekstaaf (8 oktober 2026)

- `solid_finite_plastic_truss` voegt een afzonderlijke 1D-staalwet toe voor
  axiale staven in het Tet4-J2-Newtonstelsel. De rek is `ln(l/L₀)` en de
  constitutieve spanning is daarmee energiegeconjugeerd; de 6×6-tangent
  bevat materiaal- en geometrische bijdragen. De materiaalpuntproeven
  controleren analytische plastificatie, ontlasten, omkering, starre rotatie
  en alle tangentkolommen met gecentreerde krachtverschillen. De globale
  materiaaltoestand wordt pas na convergentie van een laststap gecommit.
- `tests/volume_finite_j2_plastic_truss_reference.rs` vergelijkt een
  krachtgestuurde Tet4/trekstaaf-parallelproef en volledige ontlasting met
  een onafhankelijke scalaire Hencky- en logaritmische-plasticiteitsreferentie.
  Dicht, CSR-GMRES, frontaal, beide matrixvrije backends en automatisch
  sluiten op piekkracht, plastische restrek, restverplaatsing en evenwicht.
  In het gewone 3D-project
  `docs/verificatie/3d-volume/tet4-eindige-rek-j2-plastische-trekstaaf-membraan.ifcfem2d`
  hebben 48 Tet4, acht Tri3-membranen en één plastische trekstaaf gedeelde
  translatie-DOF en het lastpad `[1,0]`. Drie app-backends voeren de wet door;
  de routeproef herleidt de eindkracht opnieuw uit de actuele lengte en
  bewaarde plastische logrek. Het eigenschappenpaneel biedt de staalwet op
  axiale staven, en de staafresultaten bevatten plastische historie.
- Deze proef dekt een beperkte steel-J2-Tet4/Tri3/trekstaaf-koppeling.
  De later toegevoegde plastische Tri3-route staat hieronder. Beton bij eindige rek, buigende 3D-frames,
  plaatbuiging, Hex8-plasticiteit en grote willekeurige gemengde
  materiaal-FNL-modellen blijven open.
- Een opgeslagen grotere variant,
  `docs/verificatie/3d-volume/tet4-eindige-rek-j2-3072-volumes-plastische-trekstaaf.ifcfem2d`,
  heeft 3.072 J2-Tet4, 729 knopen en één plastische trekstaaf aan een vrije
  gedeelde knoop. De reproduceerbare generator is
  `scripts/verification/generate_large_finite_j2_plastic_truss_fixture.py`.
  Het bestaande absolute piek-/ontlastpad en de matrixvrije GMRES met vier
  threads blijven behouden. De echte app-route berekent 201,586 kN eindkracht
  en 0,001346 equivalente plastische logrek in de staaf; de kracht is opnieuw
  uit actuele staaflengte en gerapporteerde plastische rek opgebouwd.
  Rust-integratiecontrole `volume_finite_j2_plastic_truss_scale` vergelijkt
  de eenstapsretour en algoritmische tangent ook onafhankelijk, naast vrij
  residu en globale balans. De genegeerde releasevariant met 34.992 J2-Tet4
  en dezelfde plastische staaf slaagt op vier threads in 20,53 s; de
  3.072-elementenvariant draait in de gewone testset. De browser-devapp laadt en berekent het project
  via **Berekenen**: 3.072 volumes, 2,121 mm maximale verplaatsing,
  132,54 MPa maximale von-Mises-spanning en `matrixFreeGmres` als backend.
  Dit is een gestructureerd model met opgelegde buitenrandverplaatsingen;
  willekeurige grote krachtgestuurde plasticiteitsproblemen blijven open.

### Gekoppeld plastisch eindige-rek Tri3-membraan (8 oktober 2026)

- `solid_finite_j2_membrane` voegt een vlakspanning Tri3 met Hencky J2-staal,
  isotrope verharding en een gecondenseerde dikterek toe. De totale-Lagrange
  membraankracht en consistente 9×9 raakstijfheid delen de knopen en Newton-stappen
  met J2-Tet4 en optionele plastische trekstaven. Materiaalgeschiedenis wordt pas
  na een geaccepteerde stap vastgelegd. De wet is beperkt tot membraanwerking;
  buiging en dwarskracht van een plaat worden niet berekend.
- `volume_finite_j2_plastic_membrane_reference` toetst de analytische kracht,
  plastische historie, ontlasting en backendpariteit voor dicht, sparse GMRES,
  frontaal, beide matrixvrije varianten en automatisch. De lokale elementtests
  controleren ook objectiviteit onder starre rotatie en de volledige raakstijfheid
  met eindige verschillen.
- Het opgeslagen project `docs/verificatie/3d-volume/tet4-eindige-rek-j2-plastische-trekstaaf-en-membraan.ifcfem2d`
  combineert 48 J2-Tet4, één plastische trekstaaf en acht Tri3-elementen waarvan
  één plastisch en zeven elastisch. De app-route rekent piek en ontlasting met
  automatisch, frontaal en matrixvrij door, vergelijkt verplaatsing en plastische
  historie tussen backends en controleert kracht- en momentbalans. De UI toont
  voor het plastische membraan lokale Cauchy-spanning, actuele membraankrachten,
  equivalente plastische rek en dikterekfactor; elastische Tri3 houdt de bestaande
  tweede Piola–Kirchhoff-resultaten. De ontwikkelapp op poort 1440 laadt en
  berekent dit project ook: 27 knopen, 48 volumes, acht platen, 1,127 mm
  maximale verplaatsing, 257,26 MPa maximale Tet4-von-Mises-spanning en
  `sparseGmres`. Plaat 5001 toont na ontlasting 0,003233 equivalente
  plastische rek en een dikterekfactor van 0,999903.
- De begrensde release-schaalproef
  `tests/volume_finite_j2_plastic_membrane_scale.rs` koppelt 3.072 plastische
  Tet4 aan 128 plastische Tri3 in het binnenvlak (2.187 translatie-DOF), met
  gedeelde vrije knopen en matrixvrije GMRES op vier threads. Zij controleert
  alle geaccepteerde stappen, de bewaarde plastische geschiedenis, reactiesom
  en een onafhankelijk uit de actuele driehoeksgeometrie en globale
  Kirchhoff-spanning herbouwde membraankracht. Gemeten: 1,141·10⁻⁸ kN vrij
  residu en 0,003976 equivalente plastische rek in het middelste membraan.
  Dit is een regelmatige verplaatsingsgestuurde proef, geen bewijs voor
  willekeurige grote gemengde plasticiteitsmodellen.
- Dit is geen algemene constructieve staal- of betonplaatcontrole.
  Buigende plaat/raamwerkkoppeling, eindige-rek beton en acceptatie van grote
  willekeurige gemengde plasticiteitsmodellen blijven open.

### Eindige-rek staal-J2 voor Hex8 in het gedeelde stelsel (8 oktober 2026)

- De Hex8-variant gebruikt acht onafhankelijke Hencky/J2-Gaussgeschiedenissen,
  een consistente tangent en dezelfde Newton- en laststapcontrole als de
  bestaande Tet4, trekstaaf en Tri3. De getypeerde
  `volume3dFiniteJ2HexCoupled`-route en de 3D-app-adapter verwerken een
  gedeeld Tet4/Hex8/staaf/membraanmodel, dode lichaams- en vlaklasten en
  Cauchy-spanning plus plastische rek per Hex8-Gauss-punt.
- Een analytische gemengde proef vergelijkt zes backendkeuzes; elementtests
  controleren de volledige tangent, rotatieobjectiviteit, vervormde geometrie,
  plastische geschiedenis en afwijzing van inversie. Het opgeslagen
  `docs/verificatie/3d-volume/gemengd-hex8-tet4-eindige-rek-j2-plastisch.ifcfem2d`
  slaagt via de app-route en toont de acht Gauss-punten in de ontwikkelapp.
  De regelmatige schaalproeven met 1.000 en 4.096 Hex8, één Tet4, één staaf
  en één membraan slagen op vier matrixvrije threads met onafhankelijk
  voorspelde affiene verplaatsing, spanning, staafkracht en reacties. Zie
  `docs/verification/finite-j2-hex-mixed-scale.md` voor getallen en commando's.
- De matrixvrije tangent bewaart geen volledige 24×24-matrix meer per Hex8:
  Gauss-puntproducten worden met gedeelde geometrie opnieuw berekend. De
  genegeerde releaseproef `volume_finite_j2_hex_streamed_250k` lost nu
  250.047 plastische Hex8 op met vier geconfigureerde workers, 786.432
  globale DOF en 24 vrije componenten. Eén laststap sluit zonder cutback op
  7,606·10⁻¹⁴ kN vrij residu; verplaatsing, plastische rek, volledige
  eerste-Piola-spanning en beide vlakreacties sluiten op de affiene
  Hencky/J2-referentie. Gemeten: 31,54 s, 2.417.112 KB piek-RSS en geen swap.
  Dit bewijst de 250k-elementroute voor deze regelmatige, sterk opgelegde
  patch; het bewijst geen snelheid op vier kernen of willekeurige
  niet-affiene 250k-DOF-problemen.
- Een afzonderlijke 8³-proef met 512 Hex8 en 1.944 vrije DOF belast de
  rechterzijde met een vlaktractie plus een hoeklast. Een onafhankelijke
  achtpuntsintegratie reconstrueert ieder knooppuntresidu uit de berekende
  eerste-Piola-spanning: 3.880 plastische en 216 elastische Gauss-punten,
  maximale krachtfout 9,26·10⁻¹¹ kN. Het opgeslagen project
  `docs/verificatie/3d-volume/hex8-j2-niet-affien-512.ifcfem2d` slaagt ook
  via de echte app-adapter/testbrug met 495 plastische en 17 elastische
  elementen, reactiekrachtsommen en 2,311·10⁻¹⁴ relatief residu. Zie
  `docs/verificatie/3d-volume/hex8-j2-niet-affien-512.md`.

### Groter lineair Hex8/3D-raamwerk met gedeelde knopen (8 oktober 2026)

- De nieuwe opgeslagen projecten
  `docs/verificatie/3d-volume/hex8-raamwerk-koppeling-klein.ifcfem2d` en
  `hex8-raamwerk-koppeling-groot.ifcfem2d` combineren respectievelijk
  4 Hex8/42 volledige 3D-staven en 432 Hex8/1.443 volledige 3D-staven.
  De grote variant heeft 1.183 knopen en 5.577 translatie- en rotatie-DOF.
- De echte app-adapter/testbrug-proef vergelijkt de kleine variant op directe
  sparse, frontale en matrixvrije backend; alle zes knoopcomponenten komen
  binnen 10⁻⁷ overeen. De grote matrixvrije variant sluit in 305 iteraties
  met 7,02·10⁻¹⁰ relatief residu. Alle gerapporteerde knoop-, staaf- en
  volumewaarden zijn eindig en kracht- en momentreacties sluiten. Ook de
  gewone dev-appknop berekent het grote model: 0,2196 mm maximale
  verplaatsing en circa 0,009 MPa maximale volumespanning. Zie
  `docs/verificatie/3d-volume/hex8-raamwerk-koppeling.md`.
- Deze proef belast veel buigende frameleden op een gedeeld volume en vult
  de 55.232-volumevariant met slechts één framelid aan. De koppeling is
  lineair elastisch; de eerste gedeelde eindige-rek J2-route volgt hieronder.

### Buigend 3D-raamwerk in het eindige-rek volume-Newtonstelsel (8 oktober 2026)

- `volume3dFiniteJ2FrameCoupled` assembleert een volledige 12-DOF
  Euler–Bernoulli-staaf met beide buigvlakken, torsie en axiale stijfheid
  naast Tet4/Hex8-J2 in dezelfde Newton-stappen. Translatieknopen zijn
  gedeeld; rotaties, opgelegde knoopmomenten en lokale staafeindkrachten
  hebben een eigen getypeerde invoer en uitvoer. Rotaties van knopen zonder
  staaf worden automatisch vastgezet. De staaf gebruikt een elastische
  referentie-aswet: geen eigen geometrische of materiële staafnietlineariteit.
- `tests/volume_finite_j2_frame_coupled_reference.rs` vergelijkt een
  Tet4/staafmodel met een onafhankelijke kleine-verplaatsingsreferentie voor
  dwarskracht, twee buigvlakken en torsie op zes backendkeuzes. Een tweede
  proef controleert een gedeeld Hex8/staafknooppunt, lokale eindkrachten,
  getypeerde JSON-dispatch en de afwijzing van een moment op een knoop zonder
  staaf. De gewone app-route met opgeslagen
  `docs/verificatie/3d-volume/tet4-hex8-j2-buigraamwerk.ifcfem2d` slaagt op
  sparse GMRES, frontalWave en matrixvrij; de vrije staaf draagt onafhankelijk
  verwacht 10 kN dwarskracht en 10 kNm inklemmingsmoment, en de globale
  reacties sluiten. Zie
  `docs/verificatie/3d-volume/j2-buigraamwerk-koppeling.md`.
- De opgeslagen app-proef gebruikt de automatische backend en berekent
  daarmee ook de vijf gegenereerde combinaties, inclusief factor 0,3.
  Bij een vastgelopen Sparse-GMRES-Newtonstap herstart de automatische route
  vanaf de laatst geaccepteerde toestand met een frontale tangent, uitsluitend
  als de frontbreedte onder de ingestelde grens blijft. De tolerantie blijft
  gelijk. De Rust-regressieproef met de exacte app-invoer vergelijkt dit
  herstel met een rechtstreekse frontale oplossing voor tipverplaatsingen,
  rotaties, staafeindkrachten en vrij evenwichtsresidu. Expliciet gekozen
  matrixvrije en dichte backends zijn bij deze kleine belastingfactor nog
  niet robuust en blijven een open numeriek probleem.
- De volledige constructieve eis blijft open: grote gekoppelde modellen met
  meerdere buigende frames, geometrisch nietlineaire frames, staal- of
  beton-FNL in de staaf, buigplaten en onafhankelijke brede acceptatie.

### Verificatie van opgeslagen projectbestanden (8 oktober 2026)

- `design-mockup/test-verification-project-files.mjs` opent alle
  `.ifcfem2d`-bestanden onder `docs/verificatie`, slaat ze opnieuw op en
  controleert daarna 2D-structuur, 3D-geometrie, materialen, opleggingen en
  lasten op exact gegevensbehoud. Ook alle volumeknopen moeten bestaan. De
  test bevat de 257.728-volume-elementenfixture en is geslaagd.
- De expliciete releaseherhaling van
  `tests/volume_finite_j2_250k_validation.rs` is geslaagd met 257.250
  plastische Tet4, 139.968 DOF, 117.912 vrije componenten, vier threads,
  één laststap zonder cutback en 5,089·10⁻⁹ kN vrij residu in 137,03 s.
  De gesloten affiene Hencky/J2-oplossing, spanning en eindreactie zijn
  eveneens gecontroleerd. Dit is een regelmatige patch, geen algemene
  250.000-elementen-FNL-garantie.

### Blaauwendraad-hybride plaatelement: bronafbakening (8 oktober 2026)

- Blaauwendraad en Braam, *Wapenen van schijven en platen*, Cement 2021/8,
  beschrijven in de lange versie het hybride vierknoops plaatelement: per knoop
  `w`, `φx` en `φy`, langs de randen kubische dwarsverplaatsing en lineaire
  normaalrotatie, plus een onafhankelijk evenwichtsveld van kwadratische
  momenten met 17 parameters. Dwarskracht volgt uit de momentafgeleiden;
  complementaire energie bepaalt de onbekenden. Bron:
  https://struct4u.com/app/uploads/2022/11/struct4u_2021_cement_artikel.pdf
  (gedrukte pp. 22–23), met de uitgeverspagina
  https://www.cementonline.nl/artikelen/wapenen-van-schijven-en-platen-lang.
- Het artikel publiceert geen expliciete 17 basisfuncties, elementmatrices,
  condensatie, lastvector, integratieregel of coördinatentransformatie. De
  getoonde ontwerpvoorbeelden geven geen getabelleerde verplaatsingen of
  momenten als FE-referentie. De bestaande Rust-plaatroute mag daarom niet
  als een exacte implementatie van dit specifieke element worden aangeduid.
  Een reproduceerbare afleiding en onafhankelijke patch- en convergentieproeven
  zijn vereist voordat die claim mogelijk is.

### Groot lineair 3D-trekstaafmodel zonder volume (8 oktober 2026)

- De gedeelde `mixed3d`-kern en de gewone 3D-app-route accepteren nu een
  uitsluitend uit axiale staven bestaand model. `sparseDirect`, `sparsePcg`,
  `matrixFreePcg`, `frontalWave` en `automatic` zijn voor een kleinere
  analytische keten met elkaar vergeleken. Voor een in X
  uitgelijnde keten met alle dwarsverplaatsingen vast wordt de geldige ene
  starre modus bij de iteratieve opleggingscontrole apart herkend.
- `tests/mixed3d_large_truss_chain_reference.rs` toetst 5.000 verbonden
  staven en 5.000 vrije axiale DOF aan `u=FL/(EA)`, alle normaalkrachten en
  de eindreactie. Het opgeslagen app-model
  `docs/verificatie/3d-raamwerk/trekstaven-5000-analytische-keten.ifcfem2d`
  doorloopt de gewone 3D-modeladapter in
  `design-mockup/accept-truss-5000-app-route.mjs`: 5.001 knopen, 5.000
  staven, 25,000 mm tip en 10 kN in iedere staaf. Deze proef duurde 0,36 s
  in de debug-sidecar op de huidige machine.
- De gemengde matrixvrije route gebruikt de bestaande PCG-functie met reeds
  door `mixed3d` gecontroleerde componentopleggingen. De extra zes-modi-check
  van een Hex8-volume zou een geldige collineaire staafketen afwijzen. Een
  nulbelaste, niet opgelegde tweede keten wordt in zowel sparsePcg als
  matrixFreePcg nog steeds geweigerd. De expliciete releaseproef rekent
  5.000 verbonden staven matrixvrij in 0,97 s en voldoet aan `FL/EA`, alle
  5.000 normaalkrachten en de eindreactie. De gewone app-adapter geeft de
  expliciete `matrixFreePcg`-keuze voor een 64-staven-deelmodel door en
  vergelijkt de teruggeleverde tip met dezelfde gesloten formule. De live
  ontwikkelapp heeft na herbouw van `toetsbrug` ook de volledige opgeslagen
  5.000-stavenketen met expliciete `matrixFreePcg` verwerkt: 25,000 mm in het
  belastinggeval, 10,00 kN op de getoonde staafresultaten en vijf berekende
  combinaties.
- Dit is een axiale 1D-keten met opgelegde dwarsrichtingen, geen bewijs voor
  P-Δ of FNL zonder volume. Grote willekeurig geschoorde 3D-vakwerken vragen
  aparte stabiliteits- en schaalproeven.
- `tests/mixed3d_spatial_truss_scale.rs` vult dit aan met een daadwerkelijk
  ruimtelijk vakwerk: 256 volledig geschoorde kubusvakken, 1.028 knopen en
  5.638 unieke trek-/drukstaven. De frontale oplossing sluit vrij residu,
  krachten én globale momenten; een kleinere acht-vaksvariant geeft dezelfde
  verplaatsingen met sparseDirect en frontalWave. De gewone app-route is
  daarnaast getest met een volumevrije parallelle trekstaaf/raamstaaf. Het
  opgeslagen project `docs/verificatie/3d-raamwerk/ruimtelijk-vakwerk-5638-staven.ifcfem2d`
  loopt via `design-mockup/accept-truss-5000-app-route.mjs` door de gewone
  3D-app-adapter; alle 5.638 staafkrachten zijn eindig en kracht-, moment- en
  vrij evenwicht sluiten. De app-adapterproef duurde 0,29 s op de huidige
  machine. Na herbouw van `toetsbrug` is hetzelfde project zichtbaar in de
  ontwikkelapp en lineair berekend met 3,922 mm maximale knoopverplaatsing;
  de normaalkrachtweergave is in de browser gecontroleerd.
- Een 64-vaks ruimtelijk vakwerk geeft met matrixFreePcg en frontalWave
  dezelfde tipverplaatsing binnen 10⁻⁷ m. Dit bewijst de matrixvrije
  koppeling voorbij een enkel staafelement, maar de 256-vaks appfixture kiest
  nog expliciet frontaal. In een aparte releaseproef met dezelfde 256 vakken
  haalt expliciete matrixFreePcg de interne tolerantie van 10⁻⁹ niet binnen
  20.000 iteraties (waar residu 7,906·10⁻⁹ is). `automatic` herstart dan
  frontaal en levert hetzelfde tipresultaat binnen 10⁻⁶ m en sluitend
  evenwicht. Grote slanke ruimtelijke vakwerken vragen dus nog een sterkere
  matrixvrije preconditioner of een hogere iteratiegrens.
- Een aparte releaseacceptatie rekent 100.000 verbonden axiale staven en
  300.003 translatie-DOF met frontalWave. De onafhankelijke `FL/EA`-tip wijkt
  1,016·10⁻⁷ m af (2,13·10⁻⁷ relatief); de grootste fout van de 100.000
  normaalkrachten en de oplegreactie is 2,930·10⁻⁶ kN. De test zelf duurde
  0,31 s en bereikte 107.160 kB piek-RSS in de gemeten Cargo-aanroep.
  Dit bewijst een lang, smal front en geen 100.000-stavenmodel met brede
  ruimtelijke verbindingen; daarvoor ontbreken nog schaal- en foutproeven.
- `mixed3d_spatial_truss_scale::ninety_thousand_member_spatial_cage_balances_force_moment_and_energy`
  toetst nu ook een verbonden ruimtelijk model van 64 volledig geschoorde
  armen, 90.752 staven, 16.641 knopen en één gezamenlijke belaste kop. De
  frontale releaseberekening heeft een maximumfront van 27 vrije DOF en een
  vrij residu van 9,789·10⁻¹³. Kracht- en momentenevenwicht sluiten; de
  onafhankelijk uit `ΣN²L/(EA)` berekende staafenergie is gelijk aan het
  uitwendige werk `F·u` binnen 10⁻⁵ relatief. Een kleinere versie met vier
  gekoppelde armen geeft dezelfde kopverplaatsing met frontalWave,
  sparseDirect en matrixFreePcg. De afzonderlijke release-testduur op de
  huidige machine was 0,50 s met 86.420 kB piek-RSS (zonder Cargo-bouw).
  Elementvolgorde is hier wezenlijk: wanneer alle koppelingen met de kop
  pas na de armen komen, overschrijdt het front de ingestelde 512 vrije DOF;
  directe plaatsing na iedere arm houdt het front op 27.
- De frontale kern hergebruikt zijn eliminatierijen nu hoogstens drie keer
  voor iteratieve correctie wanneer het rechtstreeks teruggerekende vrije
  residu boven 10⁻⁸ ligt. Elke stap wordt alleen behouden wanneer een nieuwe
  onafhankelijke element-voor-element residuberekening verbetert; de vaste
  384-vaksregressie gaat daarmee van 1,714·10⁻⁸ (zonder correctie) naar
  6,577·10⁻⁹ (met correctie), inclusief kracht-, moment- en energiebalans.
  De bestaande negen frontale unittests en de grote-ketenproeven slagen.
  Na herbouw van `native-mixed3d` bleef ook de gewone app-adapterproef voor
  5.000 axiale staven en 5.638 ruimtelijke vakwerkstaven slagen.
- Een enkele volledig geschoorde, uitzonderlijk slanke arm van 512 vakken
  blijft terecht afgewezen: de correctie verlaagt het vrije frontale residu
  van 3,874·10⁻⁸ naar 1,565·10⁻⁸, nog boven de grens. Op hetzelfde model
  wordt sparseDirect met 4,382·10⁻⁷ residu afgewezen; sparsePcg en
  matrixFreePcg convergeren niet binnen 20.000 iteraties. Vóór de correctie
  werden 1.024 en 4.096 vakken eveneens geweigerd bij respectievelijk
  3,338·10⁻⁷ en 2,365·10⁻⁵ frontaal residu; die twee maten zijn na de
  correctie niet opnieuw gemeten. De verbonden 64-armproef bewijst schaal
  voor deze lokale fronttopologie, niet dat elk willekeurig vakwerk van
  90.000 staven stabiel opgelost kan worden. Voor extreem slanke modellen
  blijven conditionering, schaalkeuze en betrouwbare solverdiagnostiek open
  werk.

### Begrensd automatisch herstel voor grote 3D-staafwerken (8 oktober 2026)

- De lineaire gemengde `mixed3d`-route en haar frame-dragende variant kiezen
  na een niet-convergerende matrixvrije PCG nu ook boven 10.000 DOF de
  frontale oplosser, mits een conservatieve raming van lokale elementmatrices,
  eliminatierijen en actief front binnen 256 MiB blijft. De bestaande
  kleine-modelroute blijft beschikbaar. De echte frontgrens wordt tijdens de
  factorisatie nogmaals bewaakt. Bij een te ruime opgegeven frontgrens meldt
  `automatic` expliciet dat de opslagbewaking het herstel heeft overgeslagen.
- De expliciete releaseproef met 90.752 ruimtelijke trek-/drukstaven en
  49.923 translatie-DOF forceert matrixvrije niet-convergentie na één
  iteratie. `automatic` herstart frontaal met maximaal 27 actieve vrije DOF;
  de kopverplaatsing komt binnen 10⁻⁸ m overeen met een directe frontale
  oplossing. Evenwicht en staafenergie sluiten. Bij een ingestelde grens van
  4.096 front-DOF wordt de conservatieve opslagraming terecht geweigerd.
- `tests/mixed3d_frame_automatic_large_fallback.rs` controleert daarnaast
  2.000 buigende 3D-staven rond één ingeklemde wortel, samen 12.006
  translatie- en rotatie-DOF. Na één matrixvrije iteratie herstelt `automatic`
  frontaal binnen een grens van 16 actieve DOF. De translatie en rotatie van
  elk uiteinde volgen gesloten Euler–Bernoulli-uitkragingformules; de totale
  kracht- en momentreacties sluiten. De debug- en releaseproeven slagen. Een
  te ruime frontgrens wordt ook in deze framevariant zonder grote
  factorisatie afgewezen. Dit stermodel toetst aantal staaf-DOF en fallback,
  niet een ruimtelijk raamwerk met brede interne verbindingen.
- Na herbouw van `native-mixed3d` blijven ook
  `test-native-mixed3d-app-route.mjs` en
  `test-frame3d-volume-app-route.mjs` slagen: de getypeerde browsertransport-,
  gewone 3D-project- en gemengde Tet4/Hex8/raamwerkroute behouden hun
  referentieverplaatsingen en evenwicht.
- `tests/mixed3d_frame_connected_lattice_scale.rs` vervangt de
  stertopologie als aanvullende schaalproef door een doorlopend 4×4×128
  raamwerkrooster: 2.048 knopen, 5.104 volledige buigende/torderende staven
  en 12.288 translatie-/rotatie-DOF. Een belasting met knoopkracht en -moment
  op de verre hoek forceert automatische frontale herstart na één
  matrixvrije iteratie. Het gemeten maximumfront is 102, het vrije residu
  1,348·10⁻¹¹ en de verticale tipverplaatsing −1,242586 mm; globale kracht-
  en momentreacties sluiten. Een 4×4×4-versie vergelijkt alle translatie- en
  rotatiecomponenten tussen sparseDirect en frontalWave.
- Op hetzelfde grote verbonden rooster geeft een afzonderlijke axiale
  belasting op de zestien eindknopen de gesloten `u(x)=F_ix/(EA)`-oplossing
  voor elk van de zestien langsliggers. De grootste knoopfout is
  1,961·10⁻¹⁸ m en de grootste normaalkrachtfout 5,014·10⁻¹³ kN; dwarse
  verplaatsingen, rotaties, dwarskrachten en momenten blijven nul binnen de
  getoetste grens. Beide releaseproeven samen duurden 3,33 s en gebruikten
  66.300 kB piek-RSS buiten Cargo. Dit toetst een echt doorlopend, maar nog
  steeds beperkt 4×4-rooster; algemene brede 3D-raamwerken en gekoppelde
  GNL/FNL zijn daarmee niet aangetoond.
- Dezelfde 12.288-DOF roosterlast convergeert met expliciete
  `matrixFreePcg` en vier ingestelde threads in 1.470 iteraties bij
  8,059·10⁻¹⁰ vrij residu. Tegen frontalWave verschillen alle
  knooptranslaties hoogstens 2,357·10⁻¹⁵ m en alle rotaties hoogstens
  5,987·10⁻¹⁶ rad. De test controleert correcte parallel ingestelde
  matrixvrije oplossing; een versnelling ten opzichte van één thread is
  hiermee niet aangetoond.
- Het opgeslagen app-project
  `docs/verificatie/3d-volume/hex8-verbonden-raamwerk-5104-staven.ifcfem2d`
  voegt aan dit verbonden rooster een Hex8 met acht gedeelde knopen toe.
  De gewone app-adapter en echte Rust-binary leveren voor 5.104 staven,
  2.048 knopen en een vrije hoeklast een tipverplaatsing van −0,161833 mm,
  een residu van 7,411·10⁻¹⁰ en sluitende globale kracht- en momentbalans.
  De release-app-route duurde lokaal 6,13 s, waarvan 5,94 s in Rust. Het
  project is ook in de ontwikkelapp met **Berekenen** opgelost; de viewer
  toont de geometrie en resultaatvelden. Zie
  `docs/verificatie/3d-volume/hex8-verbonden-raamwerk-5104-staven.md` voor
  de opzet, toetsing en beperkingen. Dit ene Hex8-element is geen
  grootschalige volume-acceptatieproef.
- Dezelfde generator maakt nu ook
  `docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven.ifcfem2d`:
  alle 1.143 roostervakken bevatten Hex8 met gedeelde knopen en alle 5.104
  buigende/torderende staven blijven aanwezig. De normale app-adapter met
  vier ingestelde matrixvrije threads lost het releaseproject op met
  −0,121989 mm verticale tipverplaatsing en 9,702·10⁻¹⁰ vrij residu;
  alle knoopverplaatsingen, staafeindkrachten en volumestressrecords zijn
  eindig en de globale kracht-/momentbalans sluit. De ontwikkelapp toont
  het volledige model en 0,122 mm maximale verplaatsing na **Berekenen**.
  Alle 47 verificatieprojecten doorlopen de opslag-/herlaadproef.
  Een onafhankelijke gesloten buigreferentie voor dit gecombineerde model
  en algemene gekoppelde GNL/FNL-schaalvalidatie ontbreken nog.
- Een extra opgeslagen groot buig- en torsieproject voert alle 5.104
  volledige 3D-staven en 1.143 Hex8 op gedeelde knopen door de eindige-rek
  J2-Newtonroute. Dezelfde geometrie en hoeklast worden lineair met
  `native-mixed3d` opgelost. De app-route vergelijkt alle 2.048 knopen,
  5.104 staafeindacties en 1.143 Hex8-spanningen: maximale verschillen
  1,198·10⁻¹⁰ m translatie, 3,069·10⁻¹² rad rotatie,
  3,310·10⁻⁴ kN of kNm staafeindactie en 5,691·10⁻⁷ MPa spanning.
  Het materiaal blijft elastisch en beide evenwichten sluiten; de
  eindige-rek route kiest `frontalWave` en duurt lokaal 18,38 s.
  De ontwikkelapp heeft het project eveneens via **Berekenen** opgelost
  en toont 0,1223 mm maximale verplaatsing met dezelfde backend.
  Dit is een niet-affiene grote buigvergelijking in de elastische limiet,
  geen bewijs voor eigen frame-GNL of frameplastificatie. De opgeslagen
  invoer en test staan in de 3D-volume-verificatienotitie.
- Een derde opgeslagen bestand gebruikt dezelfde 5.104-staven/1.143-Hex8-
  topologie als analytische axiale patch met zijdelings verhinderde rek.
  De zestien eindlasten tellen op tot 100 kN en volgen de exacte Hex8-
  eindvlaktributen plus de 16 langsliggers. Met de onafhankelijk berekende
  opgesloten volumemodulus `M=33.333,333 MPa` en 2,56 m² totale
  staafdoorsnede is `ux(L)=0,003790592 mm`. De gewone app-route wijkt op
  alle 2.048 knopen maximaal 2,777·10⁻¹⁷ m af, op alle 1.143
  volumestressrecords maximaal 9,302·10⁻¹³ MPa en controleert ook alle
  5.104 staafeindkrachten. Het vrije residu is 9,069·10⁻¹⁰; de
  ontwikkelapp toont na **Berekenen** `umax=0,003791 mm`. Dit levert een
  onafhankelijke grote gekoppelde lineaire referentie, geen bewijs voor
  GNL/FNL op dezelfde topologie.
- Een vierde opgeslagen project voert dezelfde grote axiale patch door de
  eindige-rek J2/volledig 3D-raamwerk-Newtonroute, met een conventionele
  vloeigrens die tijdens de proef niet wordt bereikt. `FrontalWave` heeft
  nu een conservatieve 256 MiB-opslagraming in plaats van de oude 2.400-DOF-
  en 3.600-elementgrens; Hex8- en staafelementen worden per knoopvolgorde
  geordend om het gekoppelde front begrensd te houden. De app bewaart en
  valideert een expliciete `volumeResidualTolerance` (hier `1e-8`).
  `automatic` kiest boven de kleine sparse grens zelf de begrensde frontale
  route; de bestaande sparse-keuze voor kleine modellen blijft behouden. De
  grote app-route sluit met 3,742·10⁻¹⁰ relatief residu, maximaal
  2,466·10⁻¹³ m afwijking van de onafhankelijke axiale kleine-reklimiet
  op alle 2.048 knopen en 4,662·10⁻¹⁰ MPa op alle 1.143 volumes.
  De ontwikkelapp toont `frontalWave` en 0,003791 mm maximale verplaatsing;
  alle 47 verificatieprojecten doorlopen opslag/herladen. De expliciete
  `matrixFreeGmresLarge`-route faalde hier na 3.000 iteraties en 13
  cutbacks en is voor deze grote gemengde topologie nog niet robuust.
  Deze elastische proef valideert geen plastische volume- of staafrespons op schaal.
- Twee verdere opgeslagen 5.104-staven/1.143-Hex8-projecten testen de
  werkelijk plastische eindige-rek J2-route bij 100 kN en de daaropvolgende
  volledige ontlasting. Met tributairvlak-evenredige langsstaafdoorsneden
  en de onafhankelijke J2-return (`Y=0,002 MPa`, `H=300 MPa`) is de
  exacte axiale referentie bij belasting `ux(L)=0,004060776 mm`,
  `p=3,167887271·10⁻⁸`; na ontlasting `ux(L)=0,000270184 mm` bij
  behouden plastische rek. De gewone app-route en Rust-releasebinary
  controleren alle 2.048 knopen en 1.143 Hex8-resultaten. De maximale
  knoopfouten zijn 2,408·10⁻¹³ m en 5,985·10⁻¹⁵ m, de maximale
  spanningsfouten 4,603·10⁻¹⁰ en 2,963·10⁻¹¹ MPa; evenwicht sluit.
  Beide gebruiken `frontalWave` en duren lokaal 3,00 en 4,71 s. De
  47 projectbestanden doorlopen opslag/herladen. Zie
  `docs/verificatie/3d-volume/hex8-verbonden-raamwerk-5104-staven.md`.
  Deze proef is axiaal; buigende frame-GNL, realistische plastische
  staaldoorsneden en niet-affiene grote gekoppelde J2-proeven blijven open.

### Tweede-orde buigende staven in het gedeelde volume-J2-stelsel (9 oktober 2026)

- De bestaande `volume3dFiniteJ2FrameCoupled`-route heeft nu een optionele
  `geometricFrames`-keuze. Volledige 12-DOF-staven leveren hun niet-lineaire
  interne kracht en consistente Newton-tangent aan hetzelfde stelsel als
  eindige-rek J2-Tet4/Hex8. De materiaalwet van deze staven blijft elastisch.
  Het staafmodel gebruikt von Karman rekken op een vaste referentie-as met
  kleine rotaties; dit is geen corotationele grootrotatieformulering.
- De gewone 3D-app-adapter accepteert `combined` alleen voor een model met
  minstens één volledige buigende staaf en eindige-rek J2-staal op ieder
  volume. De projectkeuzes `tweedeOrdeFysisch` en `axiaalFysischRust` leiden
  zulke modellen naar deze route. De expliciete `material`-route behoudt
  lineaire staven.
- `accept-frame-volume-second-order-app-route.mjs` laadt de opgeslagen
  Tet4/Hex8/raamwerkfixture, legt 250 kN axiale druk en 0,1 kN dwarskracht
  op, en controleert drie backends. De relatieve staafdoorbuiging is
  `5,267360·10⁻⁵ m`; de onafhankelijke ingeklemde staafkolomformule geeft
  `5,268134·10⁻⁵ m` (0,015% verschil). De geometrische versterking ten
  opzichte van de eerste-orde formule is groter dan 10%. De Rust-eenheidstests
  verifiëren daarnaast de tangent met eindige verschillen en een tweede
  gedeelde Tet4/staafkolomlimiet.
- De gekoppelde app-adapter heeft ook consistente Hermite-eindlasten voor
  lokale staafpuntlasten; de reeds ondersteunde partiële/trapeziumlijnlasten
  volgen dezelfde knoop- en momentroute. Een punt- en uniforme lijnlast
  op een buigende staaf met gedeelde Tet4/Hex8-wortel sluiten in de
  `combined`-route aan op de onafhankelijke uitkragingsformules
  `P·a²(3L−a)/(6EI)` en `qL⁴/(8EI)` en op `P·a` en `qL²/2` voor de
  wortelmomenten. Reacties en lastgevalfactoren zijn ook gecontroleerd.
  De staafkolomacceptatie gebruikt nu expliciet `10⁻⁸` Newton-tolerantie;
  de standaard `10⁻⁹` liep voor die specifieke proef in de eerste stap
  vast met een `1,416·10⁻⁹ kN` line-search-residu. Een aparte
  `250 kN`-drukvergelijking trekt de druk-alleenrespons af. Tegen de
  onafhankelijke constante-`EI`-staafkolomoplossing bedraagt het verschil
  bij een middenpuntlast 0,42% (`1,640370·10⁻⁵` tegenover
  `1,633453·10⁻⁵ m`) en bij uniforme lijnlast 0,18%
  (`1,971474·10⁻⁵` tegenover `1,967942·10⁻⁵ m`). Beide vertonen meer
  dan 5% tweede-orde-versterking en sluiten globaal evenwicht. Deze
  referenties bestrijken stabiele druk en kleine rotaties; grootrotaties,
  volglasten en bijna-instabiliteit blijven open.
  Het opgeslagen 3D-project
  `tet4-hex8-j2-raamwerk-punt-en-lijnlast.ifcfem2d` combineert beide
  staaflasten met die druk en `10⁻⁸`-tolerantie. Via de normale
  app-adapter is de extra tipverplaatsing `3,611844·10⁻⁵ m` tegen
  `3,601395·10⁻⁵ m` uit onafhankelijke superpositie (0,29% verschil).
  De app-resultaatadapter schaalt de equivalente staafeindlast voortaan
  met de laatste absolute lastfactor. Voor punt- plus lijnlasten geeft
  `[1,0]` binnen `10⁻⁶ kN/kNm` nul op alle twaalf eindacties, en
  `[1,0,5]` stemt binnen die grens met een directe `[0,5]`-stap
  overeen. Eerder toonde volledige ontlasting nog een kunstmatige
  `0,1 kN` worteldwarskracht. De Rust-evenwichtsberekening zelf was
  daarbij al correct; de fout zat in de app-naverwerking.
  De lineaire gedeelde Tet4/Hex8/raamwerkroute reconstrueert nu ook
  snedekrachtstations tussen de staafknopen uit de gecorrigeerde eindacties
  en de werkelijk geselecteerde punt- en trapeziumlijnlasten. Een
  app-routetest controleert de parabolische veldmomenten, de
  dwarskrachtsprong bij een middenpuntlast en een halve combinatiefactor.
  Onbelaste staven bewaren alleen eindstations om grote modellen compact
  te houden. De gedeelde `material`-route met J2-volumes en elastische,
  eerste-orde staven gebruikt nu dezelfde stations bij de laatste absolute
  lastfactor. De app-routetest controleert het onafhankelijke
  uitkragingsmoment `P·a+qL²/2`, het vrije eind, de veldsprong en
  volledige ontlasting `[1,0]` zonder fictieve restsnedekrachten.
  De gecombineerde tweede-orde/J2-route gebruikt dezelfde fysieke
  staaflasten en voegt de lokale Hermite-verplaatsingsvorm met de berekende
  axiaalkracht toe aan het veldmoment. Een onafhankelijke gesloten
  uitkragende staafkolom onder einddwarskracht toetst het middenmoment
  voor drie lineaire backends binnen 5%; onbelaste punt- en lijnlastgevallen
  toetsen bovendien het kwartpuntsmoment tegen `P(a−x)` en
  `q(L−x)²/2`. `[1,0]` geeft nul stations en `[1,0,5]` dezelfde
  stations als direct `[0,5]`. Daarmee zijn kleine-rotatie
  tweede-orde-velddiagrammen voor elastische staven aan J2-volumes
  afgebakend gevalideerd. De bestaande 5.104-staven/1.143-Hex8
  app-acceptatie controleert nu ook dat alle staafdiagrammen bestaan en
  de belaste staaf eindige veldstations heeft; de releaserun duurde
  19,78 s. Grootrotaties en volglasten blijven open.
  Aan de vaste 5%-stations worden nu stationaire punten van de
  stuksgewijs kubische veldmomenten en kwadratische dwarskrachtlijnen
  toegevoegd. Een aparte onafhankelijke polynoomproef vindt het
  momentmaximum bij `x/L=0,327` en het dwarskrachtminimum bij
  `x/L=0,37`, beide tussen de rasterstations. De app-routetests en de
  5.104-staven/1.143-Hex8-proef blijven slagen (laatste releaserun
  21,50 s). Dit verkleint de kans dat een resultaatomhulling een
  inwendig maximum mist; algemene constructieve betrouwbaarheid vergt
  nog verdere vergelijking met onafhankelijke solvers.
  Een extra opgeslagen klein project koppelt nu een Tet4, een in-vlaks
  Tri3-membraan en een volledige 3D-buigstaaf op dezelfde wortelknoop.
  De onafhankelijke serie-parallelreferentie gebruikt
  `u_wortel=F/(k_Tet+k_Tri3)` en
  `u_punt=u_wortel+FL³/(3EI_z)`. Drie lineaire backends en de
  eindige-rek J2-route met twee backends sluiten aan; het opgeslagen
  GNL/J2-project lost via de normale app-analysekeuze op. Alle 55
  verificatieprojecten doorlopen opslag/herladen. Dit bewijst een
  gedeeld *membraan*, geen buigende plaat-volume-staafkoppeling.
  Een aanvullende opgeslagen vier-familiesproef koppelt nu één Hex8,
  één Tet4, één Tri3-membraan en één buigende 3D-staaf in hetzelfde
  knooppunt. De onafhankelijke serie-parallelreferentie
  `u_tip=F/(k_Hex8+k_Tet4+k_Tri3)+FL³/(3EI_z)` sluit voor drie lineaire
  backends en voor de elastische limiet van het gedeelde J2/GNL-pad.
  De fixture doorloopt opslag/herladen en de normale app-analysekeuze.
  Zie `docs/verificatie/3d-volume/tet4-hex8-tri3-raamwerk-j2-gekoppeld.md`.
  Een tweede opgeslagen variant laat *beide* volumefamilies plastificeren
  bij `Y=0,001 MPa`, `H=300 MPa` en `F=5 kN`. Dichte en frontale
  materiaalroutes stemmen binnen `10⁻⁷ m` op de tipverplaatsing overeen;
  de gedeelde wortel wordt slapper dan de elastische referentie.
  De gemiddelde J2-spanningen blijven onder `Y+H p_max+10⁻⁵ MPa`,
  en de gecombineerde GNL/J2-route sluit het globale evenwicht.
  Het kleine vier-familiesmodel is bovendien rechtstreeks te laden via
  de voorbeeldknop in de lege 3D-editor. Een live dev-app-berekening
  toonde 12 knopen, 2 volumes, 1 Tri3 en 1 staaf; `frontalWave` gaf
  `u_max=0,001332 mm`. De productie-Vitebuild en TypeScript-controle
  verwerken de opgeslagen fixture als voorbeeldasset.
  De live app herberekent dit voorbeeld ook na expliciete keuze voor
  `GNL + staal-FNL (Tet4/Hex8)` als `2e orde + FNL` zonder solverfout.
  Een derde opgeslagen vier-familiesproject ontlast de plastische
  Hex8/Tet4-toestand via `[0,25;0,5;1;0]`. Beide volumes behouden
  plastische rek, de gecombineerde GNL/J2-oplossing sluit het evenwicht
  en de vrije staafpunt houdt `3,455270·10⁻⁶ m` restverplaatsing zonder
  restbuiging ten opzichte van de wortel. Dicht en frontaal stemmen
  binnen `10⁻⁷ m` op de eerste-orde ontlastuitkomst overeen.
  De afzonderlijke eerste-orde `material`-route controleert bij gekoppelde
  eindige-rek volumes en elastische eerste-orde-staven het moment nu met
  referentiearmen. De eerdere fout door een onbedoeld P-Δ-koppel is met
  `−250 kN` druk en `−0,1 kN` dwarskracht gereproduceerd en hersteld:
  `4,548142·10⁻⁵ m` tipdoorbuiging tegen dezelfde analytische eerste-orde
  waarde; de gecombineerde route geeft `5,267360·10⁻⁵ m` tegen
  `5,268134·10⁻⁵ m` volgens de staafkolomformule. Een drukproef bij
  `−350 kN` komt op `5,623426·10⁻⁵ m` relatieve
  tipdoorbuiging tegen `5,625170·10⁻⁵ m` analytisch, met sluitende
  kracht-, moment- en residucontrole. Een verkennende `−1.000 kN`-run
  stopt bij circa 39,9% van het lastpad op een negatieve frontale
  tangentspil. Deze last ligt boven de afzonderlijke zwakke-as
  Eulerlast van de ingeklemde staaf (`circa 694 kN`), dus een
  evenwichtsoplossing zou niet als stabiel ontwerpresultaat mogen gelden.
  Sparse en matrixvrije GMRES bereiken in deze proef wel dezelfde
  evenwichtstak (`circa 0,10049 mm` relatieve doorbuiging), maar bewijzen
  daarmee geen stabiliteit. De exacte grens van het gekoppelde
  volume-staafstelsel vraagt nog om een onafhankelijke eigenwaarde- of
  padcontrole. De app rapporteert bij convergente sparse en matrixvrije
  GMRES-FNL-routes nu expliciet dat het algebraïsche evenwicht geen
  tangent- of knikbewijs is; dat geldt ook wanneer `automatic` daadwerkelijk
  sparse GMRES kiest. De app-diagnose benoemt bij `combined` nu de aanwezige
  geometrische tweede-orde-stijfheid, en bij `material` de eerste-orde-staaf.
  Een app-routetest controleert beide duidingen;
  een regressie bewaakt de frontale afwijzing. Een aanvullende
  app-routetest oefent dezelfde `−250 kN` druktoestand met een puntlast
  midden op de staaf en met een over de staaf verdeelde lijnlast uit.
  Voor beide belastingen blijft de eerste-orde `material`-doorbuiging
  binnen 5% van de onafhankelijke Euler-Bernoulli-formule en sluiten
  kracht-, moment- en vrije-residucontroles; de tweede-orde respons
  wordt afzonderlijk met de staafkolomoplossing vergeleken.
- Met `FEM_GEOMETRIC_FRAMES=1` doorloopt de opgeslagen grote buigfixture
  dezelfde app-route met 5.104 buigende 3D-staven, 1.143 Hex8 en 2.048
  knopen. De kleine-belastingvergelijking met de onafhankelijke lineaire
  `mixed3d`-route geeft maximaal `2,768·10⁻¹⁰ m` translatieverschil,
  `1,526·10⁻¹² rad` rotatieverschil en `3,296·10⁻⁸ MPa`
  spanningsverschil. Het vrije residu en globale evenwicht sluiten;
  `automatic` kiest `frontalWave` en de lokale J2-run duurde 25,38 s.
  Dit toont schaalgedrag in de kleine-vervormingslimiet, geen grote
  tweede-orde-versterking op 5.104 staven.
- Nog open: onafhankelijk grote-belastingbewijs op het grote rooster,
  objectieve grote staafrotaties, staafplastificatie in dit gedeelde stelsel,
  gekoppelde buigplaten en robuustheid bij bijna-instabiliteit. De hybride
  eerste-orde-staaf/eindige-rek-volumeroute is voor de hierboven genoemde
  drukreferentie gevalideerd; algemene grote rotaties en stabiliteit volgen
  daar niet uit.
- Een opgeslagen grotere-lastproef gebruikt 5.104 volledige staven en één
  lokaal gedeeld J2-Hex8. Vijf app-routeberekeningen met ±5.000 kN axiale
  last en 10 kN dwarslast trekken de axiaal veroorzaakte dwarsverplaatsing
  af. De gemeten dwarslastrespons is `0,15888 mm` bij druk, `0,15841 mm`
  zonder axiale last en `0,15794 mm` bij trek. Alle vijf sluiten het
  evenwicht met `frontalWave` en residu onder `5·10⁻¹²`; de projectfixture
  doorloopt opslag/herladen. Dit toetst de versterkingsrichting bij hoge
  last op de grote topologie, maar slechts circa 0,3% versterking en geen
  onafhankelijke analytische uitkomst voor het hele rooster.
- De afzonderlijke opgeslagen slanke staafkolom met 1.024 volledige
  HEA100-elementen en één actief gedeeld J2-Tet4 is analytisch getoetst:
  `0,0408500009 m` relatieve doorbuiging tegenover `0,0408500008 m`
  volgens de gesloten staafkolomformule; eerste orde is `0,0363851367 m`.
  Bij `P/P_cr=0,111` en vier laststappen sluit het evenwicht met een vrij
  residu van `1,361·10⁻⁷` onder de expliciete `10⁻⁶`-projectgrens.
  De frontale solver telt reactiebijdragen nu gecompenseerd op en de
  eindige-rek J2-route kan een begrensde hogere lineaire residugrens
  doorgeven; andere frontale routes behouden standaard `10⁻⁸`.
  Een verkennende 2.048-elementenketen bij 2 kN faalde op een negatieve
  spil en bij 0,5 kN op de appcontrole van het vrije eindresidu. Zij is
  geen gevalideerde schaalvariant. Zie de nieuwe staafkolom-verificatienotitie.
- Twee extra opgeslagen grote app-projecten koppelen 5.104 tweede-orde
  elastische 3D-staven aan 1.143 eindige-rek J2-Hex8 onder de excentrische
  hoeklast van de eerdere elastische roosterproef. Met een bewust lage
  numerieke vloeigrens `Y=0,001 MPa` en positieve verharding `H=3.000 MPa`
  plastificeren 1.090 volumes. De normale `combined`-app-route met
  `geometricFrames=true` kiest `frontalWave`; het vrije residu is
  `3,325·10⁻¹⁰`, globale kracht- en momentbalans sluiten en de
  volumegemiddelde spanning blijft per Hex8 binnen de onafhankelijke
  J2-grens `q(σ̄)≤Y+H·p_max` tot `10⁻⁶ MPa`. De tipdoorbuiging is
  `−0,137028 mm` tegenover `−0,121989 mm` in de afzonderlijk
  gevalideerde elastische limiet. De lokale releaserun duurde 22,41 s.
  Het tweede project ontlast dezelfde niet-affiene toestand met
  doelpad `[1,0]` tot nul externe last: 1.090 volumes behouden
  plastische historie (`p_max=5,315·10⁻⁷`) en de restverplaatsing is
  `−0,005520 mm`. Het vrije residu is `1,336·10⁻⁸ kN`, onder de
  absolute app-evenwichtsgrens `10⁻⁷ kN`; globale kracht- en
  momentbalans sluiten. De ontlast-run duurde 42,04 s. Alle 54
  opgeslagen verificatieprojecten doorlopen herladen. Zie
  `docs/verificatie/3d-volume/hex8-verbonden-raamwerk-5104-staven.md`.
  Dit valideert niet-affiene plastische volumevelden op het gedeelde
  rooster, niet constructieve staalwaarden of plastische framevezels.
  De acceptatieproef ondersteunt ook begrensde varianten. Bij de zachtere
  `H=300 MPa` slagen 128 Hex8 met vier doelstappen in 33,92 s
  (`1,226·10⁻¹⁰` vrij residu), en het volledige rooster met één stap
  in 23,51 s (`3,226·10⁻¹⁰`). Het volledige rooster met twee en vier
  doelstappen leverde bij projecttolerantie `10⁻⁸` binnen respectievelijk
  120 en 180 s geen einduitkomst op; een eerdere vierstapsrun werd na acht
  minuten afgebroken. Een diagnose met maximaal acht Newton-iteraties en
  twee cutbacks meldde bij de eerste halflast een vrij residu van
  `7,941·10⁻⁸ kN`. Met expliciete tolerantie `10⁻⁷` slagen het volledige
  twee- en vierstapspad in 34,22 en 55,16 s: 1.090 plastische Hex8,
  `p_max=3,341·10⁻⁷`, `uz=−0,138319/−0,138318 mm` en vrije
  eindresiduen `3,637·10⁻¹⁰/4,201·10⁻¹⁰`. Een apart opgeslagen
  vierstapsproject legt deze invoer vast en de app-route herrekent het
  zonder mutatie. De standaardtolerantie blijft `10⁻⁸`; robuuste
  meerstaps-FNL bij zachte verharding en willekeurige modellen blijft open.
  Een vierde opgeslagen project belast één eindstaaf aanvullend met een
  `−1 kN`-middenpuntlast en `−1 kN/m` lokale lijnlast. De gewone
  app-adapter rekent de 5.104 staven en 1.143 J2-Hex8 ongewijzigd door:
  1.100 plastische volumes, `p_max=3,494·10⁻⁷`,
  `uz=−0,154229 mm` tegenover `−0,137028 mm` zonder staaflasten,
  vrij residu `2,989·10⁻¹⁰` en sluitend evenwicht met `frontalWave`
  in 24,99 s. De belastingseffecten op het volledige rooster hebben
  geen onafhankelijke gesloten veldoplossing.

### Iteratieve 3D-trekstaven: kinematische rangcontrole (12 oktober 2026)

Een onverstijfd vierkant van vier axiale 3D-staven kon bij nulbelasting in
`sparsePcg`, `matrixFreePcg` en `automatic` eerder ten onrechte met nul
iteraties slagen: alle vrije diagonaalelementen waren positief en de zes
globale starre bewegingen waren geremd, maar het vierkant had nog een interne
schuifbeweging. De iteratieve route telt nu per zuivere trekstaafcomponent
de vrije translaties en staafvoorwaarden. Tot 128 vrije DOF en 512 staven
controleert zij bovendien de numerieke rang van de vrije
staafverlengingsmatrix. De regressie wijst zowel vier staven als een
redundante vijfde staaf af; een echte diagonaal lost met nulbelasting op.
Bij een horizontale eenheidslast sluit de diagonaalvariant op de onafhankelijke
virtuele-arbeidswaarde `u = F(2+2√2)/(EA)`. Grotere zuivere
trekstaafcomponenten krijgen alleen de noodzakelijke telling; gemengde
staaf-/volume-/membraanmechanismen en algemene schaalbare rangdetectie blijven
open. De bestaande 64-vaks ruimtelijke PCG-proef en de gewone app-route met
5.000 axiale plus 5.638 ruimtelijke staven blijven slagen na herbouw van de
Rust-binary.

### Consistente Tri3-membraantractie in het gedeelde 3D-stelsel (12 oktober 2026)

`mixed3d` accepteert nu globale oppervlakte-tracties op gekoppelde Tri3-
membranen en assembleert per knoop `A·t/3` met de eigen referentiegeometrie.
De lineaire app-adapter geeft plaatvlaklasten en combinatiefactoren als
tracties door; de equivalente knoopkrachten dienen alleen nog de gerapporteerde
belasting- en reactiebalans. Een onafhankelijke proef met een schuin Tri3-
vlak vergelijkt kracht, moment, verplaatsing en raamwerkeindkrachten met
handmatig geïntegreerde knooplasten voor alle zes lineaire backends. De
normale app-route met Tet4, Hex8, Tri3 en raamwerk slaagt na herbouw van de
Rust-binary, inclusief plaatlast en lastcombinatie. Niet-lineaire routes
behouden hun bestaande knooplast-integratie; deze uitbreiding valideert
geen volwaardige buigplaat of doorsnedetoets.

### Iteratieve steuncontrole: staafrichting en losse Tri3-punt (12 oktober 2026)

Een volledig dwarsgesteunde enkele trekstaaf werd door de iteratieve
`mixed3d`-routes ten onrechte afgewezen als hij langs de globale Y- of
Z-as lag: de uitzondering op de zes starre lichaamsmodi herkende alleen
de X-as. De uitzondering bepaalt nu de werkelijke globale staafas. Een
onafhankelijke `u=FL/(EA)`-proef sluit voor X, Y en Z op dense,
`sparsePcg`, `matrixFreePcg` en `automatic`. De bestaande ruimtelijke
staafproeven blijven slagen.

Een tweede nulbelastingproef vond een werkelijk slap Tri3-membraanpunt
dat slechts aan één membraan hangt en geen volume- of staafelement deelt.
De verplaatsing van dit punt volgens de driehoeksnormaal geeft exact nul
membraanrek. `sparsePcg`, `matrixFreePcg` en `automatic` meldden
eerder ten onrechte convergentie met nul iteraties. Een lineaire lokale
controle wijst die vrije normaalmodus nu af, ook in een verder gekoppeld
Tet4/raamwerkmodel. Met één extra dwarsoplegging lossen alle routes het
model op en stemmen de belaste puntverplaatsingen met de dichte referentie
overeen. De gerichte regressie, de bestaande membraan/raamwerkproef en de
schuine membraantractieproef slagen.

Een aanvullend hellend twee-Tri3-vlak heeft een vrije knoop die aan beide
membranen hangt. Zijn normaalverplaatsing geeft in beide elementen exact
nul rek, terwijl alle drie de vrije matrixdiagonaalelementen positief zijn.
De iteratieve routes meldden eerder ten onrechte nul-iteratieconvergentie.
De lokale controle vergelijkt nu de normaalrichtingen van alle Tri3's per
onverstijfde knoop en wijst een gezamenlijke vrije normaalmodus af. Met
dwarssteun en 1 kN puntlast stemt de verplaatsing op alle zes lineaire
backends overeen met de onafhankelijke
`u_x=√3/325000 m`-membraanreferentie. Na herbouw blijft de grote app-route
met 2.248 volumes, 96 Tri3-membranen en raamwerk slagen: 221 PCG-iteraties
en een relatief residu van `9,29·10⁻¹⁰`. Niet-coplanaire membraanhengsels,
algemene gemengde mechanismen en grootschalige rangdetectie blijven open.

### Iteratieve rangcontrole: losse staafassen en gemengde volume-interface (12 oktober 2026)

De axiale uitzondering op de steuncontrole wordt nu per verbonden
staafcomponent bepaald. Twee afzonderlijk opgelegde trekstaven langs de
globale X- en Y-as worden op alle zes lineaire backends aan de onafhankelijke
`u=FL/(EA)`-referentie getoetst; eerder werd de Y-staaf ten onrechte
afgewezen omdat de richting van de eerste component voor het hele model gold.

Een Tet4 en Hex8 die uitsluitend één knoop delen, kunnen relatief om die
knoop draaien. Bij nulbelasting rapporteerden beide PCG-routes eerder
ten onrechte convergentie zonder iteraties. Voor modellen met beide
volumetypen en maximaal 128 translatie-DOF controleert de iteratieve route
nu eerst de pivots van dezelfde sparse-direct-matrix. De onafhankelijke
nulbelastingproef wijst de scharnierende interface op alle backends af;
met twee extra, niet-collineaire Hex8-opleggingen lossen ze alle op. De
gemengde Tet4/Hex8-affiene proef, membraan/volume-referentie en app-route
blijven slagen. Deze begrensde directe controle bewijst geen algemene
rangdetectie voor grotere of andere gemengde modellen; dat blijft open.

### Eigen verdeelde 3D-staaflasten in de gemengde lineaire kern (12 oktober 2026)

De gedeelde lineaire `mixed3d`-kern accepteert nu lokale dwarslasten op
3D-raamstaven: lineair variërende lasten over een volledig of gedeeltelijk
staafsegment en puntlasten op een positie langs de staaf. De Rust-kern
integreert de Hermite-vormfuncties en assembleert de equivalente krachten
én momenten in het gedeelde stelsel. De gerapporteerde lokale
staafeindkrachten bevatten de aftrek van die equivalente lasten, zodat ze
de werkelijke eindresultanten voorstellen. Zowel de opgeslagen als de
matrixvrije route gebruikt dezelfde lasten.

De gewone 3D-app-route stuurt deze lasten nu rechtstreeks naar Rust voor
lineaire analyses. De app houdt de equivalente belasting apart bij voor de
weergave van totaal evenwicht en telt die niet dubbel in de oplosvector.
Onafhankelijke cantileverreferenties voor uniforme, gedeeltelijk
trapeziumvormige en puntlasten, alle zes lineaire backends, combinatiefactoren,
staafeindkrachten en de gewone Tet4/Hex8/raamwerk-app-route slagen. De
gekoppelde materiaal-FNL/GNL-route gebruikt voor puntlasten nog de
app-conversie naar equivalente knoopkrachten. Verdeelde lijnlasten hebben
nu het eigen Rust-lastcontract en absolute doelgeschiedenis hieronder.

### Horizontale DKT-buigplaat op gedeelde 3D-knopen (12 oktober 2026)

De lineaire `mixed3d`-kern assembleert nu horizontale XY-DKT-Tri3-platen
met `uz`, `rx` en `ry` op dezelfde knopen als Tet4, Hex8 en buigende
3D-staven. Alleen plaatknopen krijgen twee rotatie-DOF; bij een gedeelde
raamwerkknoop worden diens bestaande drie rotaties gebruikt. De tekens van
de DKT-rotaties zijn naar de fysieke globale rotatievector omgezet. Een
plaatknoop zonder in-vlak dragend element krijgt zijn afwezige `ux`/`uy`
exact op nul; een in-vlak belasting of opgelegde niet-nulverplaatsing daar
wordt afgewezen. Voor een vrije `rz` bestaat geen kunstmatige boorstijfheid.

Een onafhankelijke gekoppelde Tet4/DKT/raamwerkproef vergelijkt de enige
vrije `uz` met `F/(K_tet + K_plaat + K_staaf)`, waarbij voor de gekozen
rechthoekige eenheidsdriehoek `K_plaat = D(45-3ν)/8`. De proef controleert
ook de achtvoudige buigstijfheid bij verdubbelde dikte, omgekeerde
driehoekswinding, evenwicht en een fysieke starre rotatie zonder interne
krachten. Dense, `sparseDirect` en `frontalWave` slagen; de iteratieve
routes en de huidige `automatic`-keuze staan in de volgende mijlpaal.
Alle Rust-integratietargets compileren en de bestaande Tet4/raamwerkproeven
blijven slagen.

De gewone 3D-app-route trianguleert een rechte strikt convexe horizontale
plaatcontour en stuurt de DKT-elementen mee met de volume- en staafelementen.
Een globale `qz`-vlaklast wordt eenmaal als equivalente knooplast verdeeld;
de app toont `uz` en `rx`/`ry` per knoop en per plaat alleen maxima van
verplaatsing en rotatie. Een kleine end-to-end volume/DKT-proef controleert
de wire payload, combinatiefactor, belasting en reacties.

Dit is alleen lineaire buigstijfheid: geen membraanwerking van de DKT-plaat,
geen hellende of gekromde platen, openingen, plaatspanningen,
constructieve plaattoets of gedeelde GNL/FNL. Elastische
zwaartepuntmomenten zijn in een volgende mijlpaal toegevoegd. De app-route
vereist voorlopig minstens één volume of axiale staaf; de bestaande losse
plaatroute blijft voor een model zonder volume/axiale staaf gelden. De
opgeslagen `sparseDirect`-route begrenst op 10.000 DOF en 2 miljoen
factorentries. Iteratieve DKT-routes en een grotere plaatproef zijn in de
volgende mijlpaal vastgelegd.

### Iteratieve XY-DKT-buigplaten en onafhankelijke plaatproef (13 oktober 2026)

De gedeelde lineaire kern neemt XY-DKT-platen nu ook op in `sparsePcg` en
`matrixFreePcg`. De matrixvrije route bouwt geen globale CSR-matrix: per
plaat bewaart hij de negen DOF-indices en de lokale 9×9-stijfheid voor
diagonaal, matrix-vectorproduct en reacties. `automatic` probeert deze
route eerst en valt alleen bij een begrensde convergentie- of residufout
op de frontale route terug. DKT-producten lopen in deze stap sequentieel;
de bestaande Tet4/Hex8-producten kunnen meerdere threads gebruiken. De
matrixvrije route begrenst op 1.200.000 gealloceerde globale DOF-slots en
8 miljoen opgeslagen lokale DKT-stijfheidsentries (hoogstens 98.765
driehoeken). `sparsePcg` gebruikt de bestaande begrensde CSR-assemblage.

Een noodzakelijke steuncontrole onderzoekt nu per verbonden plaatcluster
de drie starre buigmodi `w=a+b*x+c*y`. Een volumeaansluiting geldt alleen
als de volumekomponent zelfstandig tegen zijn zes starre modi is gesteund;
onbewezen raamwerkaansluitingen worden conservatief afgewezen. Daardoor
geven de PCG-routes bij een onverstijfde plaat die slechts in één knoop is
opgelegd ook zonder belasting een fout, in plaats van schijnconvergentie.
Dit is geen algemene rang- of scharniercontrole.

Een onafhankelijke gekoppelde Tet4/DKT/raamwerkproef vergelijkt beide
PCG-routes en `automatic` met `F/(K_tet+K_plaat+K_staaf)`, en controleert
omgekeerde winding, dikteschaling, reacties, spanning en een starre fysieke
rotatie. De app-route vergelijkt expliciete en automatische matrixvrije
oplossingen met de dichte referentie. Een afzonderlijke 60×60 vierkante
DKT-plaat met 3.721 knopen, 7.200 driehoeken en 1 kN middelpuntlast heeft
18.605 gealloceerde gemengde DOF-slots, waarvan 11.163 fysieke plaat-DOF's
en 10.923 vrije DOF's na randopleggingen. De matrixvrije route convergeert
in 672 iteraties tot een relatief residu van `7,424·10⁻¹⁰`; de
middelpuntverplaatsing wijkt `0,038%` af van een onafhankelijk afgeleide
Navier-reeks en de totale verticale reactie is `−1 kN`. De opgeslagen
`sparsePcg`-route geeft dezelfde verplaatsing en reactie in 677 iteraties
met relatief residu `6,477·10⁻¹²`. De gerichte releaseproef is bewust
`#[ignore]` in de gewone testloop en is apart uitgevoerd. De exacte scope
blijft lineaire horizontale DKT-buiging; GNL/FNL, dwarskrachtresultanten,
hellende platen, volledige scharniercontrole en zeer grote plaatacceptatie
blijven open.

### Elastische zwaartepuntmomenten van gekoppelde XY-DKT-platen (13 oktober 2026)

De gedeelde 3D-kern rapporteert per DKT-driehoek nu `[Mx, My, Mxy]` in
globale XY-assen en kNm/m, op het zwaartepunt. De opgeslagen en matrixvrije
routes gebruiken dezelfde herstelroutine als de losse DKT-kern. Alleen bij
de omzetting van fysieke knooprotaties naar DKT geldt
`[θx, θy]=[−Rx, −Ry]`; op de momenten volgt geen extra tekenwisseling.
De 9×9 lokale DKT-stijfheid wordt gespiegeld gemiddeld, zodat afronding
van afzonderlijke kwadratuurtermen geen kunstmatige asymmetrie in de
sparse-`LDLᵀ`-controle veroorzaakt. De gemeten afwijking vóór correctie
was hoogstens `1,82·10⁻¹²` op een stijfheidsentry rond `1,24·10⁴`.

Een onafhankelijke constante-krommingsproef op een gekoppeld
Tet4/DKT/raamwerkrooster schrijft voor `E=30.000 MPa`, `ν=0,2`, `t=0,1 m`
en `κ=[0,002; −0,001; 0,0006] 1/m` de momenten
`[4,6875; −1,5625; 0,625] kNm/m` voor. Alle zes lineaire backends en
beide driehoekswindingen slagen, evenals starre rotatie, dikteschaling en
een model zonder platen. De 60×60 Navier-plaatproef slaagt ook na het
toevoegen van momentherstel. De app koppelt momenten in invoervolgorde
aan platen en toont maxima en momentwaarden per driehoek in eigenschappen
en rapport; de zichtbare detaillijsten zijn begrensd op 100 en 250 rijen,
terwijl de volledige resultaatdata beschikbaar blijft. De app-route,
TypeScript-controle en gerichte Rust-proeven slagen. De waarden zijn
elastische zwaartepuntmomenten: geen dwarskracht, membraankracht,
oppervlaktespanning, ontwerpwaarde of constructieve toets.

### Elastische XY-DKT in het gedeelde eindige-rek J2/raamwerkstelsel (13 oktober 2026)

De Rust-route `volume3dFiniteJ2FrameCoupled` kan nu horizontale elastische
DKT-driehoeken opnemen in hetzelfde Newtonstelsel als Tet4/Hex8-volumes en
3D-buigstaven. Per plaat gaan `uz`, `Rx` en `Ry` naar de bestaande globale
DOF's; de plaat levert `K·u` en dezelfde constante 9×9-tangent in dense,
sparse GMRES, frontalWave, matrixFreeGmres en matrixFreeGmresLarge. De
automatische keuze gebruikt de bestaande begrensde backend, maar de
frontale noodterugval is voor modellen met platen voorlopig uitgeschakeld
omdat de bestaande frontschatting hun rotaties nog niet certificeert.
Alle plaatknopen moeten ook bij Tet4/Hex8 horen, de driehoeken moeten
horizontaal en niet-ontaard zijn, en het aantal is begrensd op 10.000
naast de overige backendlimieten. Een vrije boormomentbelasting op een
knoop zonder raamwerk wordt afgewezen.

Een onafhankelijke één-DOF-proef combineert de exacte Hencky-schuifkracht
van een eindig vervormende Tet4 met de DKT-bijdrage
`D(45−3ν)·u/8` en de geleide staafbijdrage `12EI·u/L³`.
Zes backends, beide plaatwindingen, reacties en ontlasten/herbelasten
slagen. Een afzonderlijk voorgeschreven schuifpad `[0,06; 0; 0,04]`
plastificeert de Tet4 met `fy=1 MPa`; het reactieverschil met een verder
identiek model zonder plaat is op ieder doelpunt precies de elastische
DKT-bijdrage, terwijl de J2-plastische geschiedenis en eerste
Piola-spanning gelijk blijven. De zes gerichte Rust-tests, bestaande
raamwerkproeven, finite-J2-unit-tests en het compileren van alle
integratietargets slagen. De gewone 3D-app-route laat deze platen nu toe
bij materiaal- of gecombineerde eindige-rek J2-analyse met een buigende
3D-staaf en uitsluitend volumegebonden plaatknopen. Een getypeerde
Tet4/DKT/raamwerk-app-proef vergelijkt een 8 kN-last met dezelfde
onafhankelijke Hencky/DKT/staafvergelijking, controleert de reacties,
plaatbijdrage, rapportweergave en het vroegtijdig afwijzen van ongeldige
modellen. De bestaande J2-raamwerk- en lineaire DKT-app-proeven blijven
slagen. De plaat behoudt elastische referentiestijfheid in het niet-lineaire
volume/raamwerkstelsel: geen eigen plaat-GNL of plaat-FNL. Deze route
herstelt inmiddels elastische referentieplaatmomenten; dwarskracht,
oppervlaktespanning en constructieve toets ontbreken nog. De app toont
daar geen verzonnen waarden voor.

### Iteratieve rangcontrole voor gedeelde 3D-volumes met plaat en staaf (13 oktober 2026)

Een nulbelasting mag een ongestut intern scharnier niet als een geslaagde
PCG-oplossing melden. Twee Tet4-volumes die alleen één knoop delen, waarvan
slechts het eerste volume door een XY-DKT-plaat en een 3D-staaf wordt
verstijfd, vormden zo'n tegenvoorbeeld: de tweede Tet4 kan om de gedeelde
knoop draaien. Voor gemengde modellen tot 128 totale DOF's voert de
iteratieve route nu eerst de pivotcontrole van de bestaande sparse-direct
route uit. Dit vangt ook mechanismen die loodrecht op de aangebrachte last
staan.

Bij grotere modellen groepeert een noodzakelijke controle Tet4- en
Hex8-volumes langs gedeelde vlakken. Per groep toetst zij de zes starre
bewegingsmodi tegen de echte translatieopleggingen. Elke knoop die tevens
bij een andere volumegroep, staaf, membraan of DKT-plaat hoort, wordt voor
deze proef optimistisch in alle drie richtingen vastgehouden. Als zelfs
dan een vrije modus overblijft, is er zeker een nulenergiescharnier in het
lineaire stelsel. Dit gebruikt lineaire extra opslag ten opzichte van het
aantal elementen en knopen en vereist geen globale directe factorisatie.
Een volledige rang- of inertiegarantie volgt uit een geslaagde proef niet;
andere interne mechanismen en niet-manifolde interfaces blijven open.

De onafhankelijke nulbelastingproef en een belasting op het gestutte volume
die loodrecht op de scharniermodus staat, worden nu zowel onder als boven
de 128-DOF-grens afgewezen. Een met extra opleggingen gestabiliseerde
één-DOF-schuifproef geeft op alle zes lineaire backends de gesloten Tet4-
referentie `u=F/(1000 μ V)=1,2·10⁻⁵ m`, met kloppende reacties.
De bestaande onregelmatige L-uitsparing/holteproef met 46.080 Tet4,
9.152 Hex8, 18.999 knopen, trekstaaf en buigstaaf slaagt na deze wijziging
opnieuw op vier threads: 645 matrixvrije PCG-iteraties, relatief residu
`9,873·10⁻¹⁰` en `6,110 s` oplostijd in de releaseproef. De gemeten
piek voor dit testproces is `65.228 KiB` (VmHWM).

### Eigen verdeelde raamwerklasten in het gedeelde eindige-rek J2-stelsel (13 oktober 2026)

`volume3dFiniteJ2FrameCoupled` accepteert nu optionele
`frameMemberLoadTargets`: per absoluut volume-lastdoel een lijst met
lineair variërende lokale `qy`- en `qz`-lasten over een geheel of gedeeltelijk
3D-staafsegment. Driepunts-Gauss integreert de Hermite-vormfuncties exact
voor deze lastvorm. De resulterende kracht- en momentequivalenten gaan als
externe referentielasten mee in het Newton-evenwicht en de reacties; bij
gerapporteerde lokale staafeindkrachten wordt alleen de equivalente last
van het laatste absolute doel afgetrokken. Daardoor stapelt een
ontlast/herlastpad geen lijnlast op. De formule is gekruist met
[University of Florida EML 4500, lecture 05](https://web.mae.ufl.edu/nkim/eml5526/lect05.pdf).

Een onafhankelijke Tet4/DKT/3D-staafproef controleert beide lokale
lastrichtingen met de exacte Hencky-schuifkracht, een uniforme last over
de hele staaf en een oplopende driehoekslast over een halve staaf. De
Hermite-knooplasten, reacties, fysieke eindkrachten, een exact
uitkragingstipverplaatsing/rotatie, onbelast/ontlast/herlastpad en
ongeldige invoer slagen op de zes eindige-rek-J2-backends. Alle
Rust-integratietargets compileren. De gewone 3D-app-route stuurt deze
lijnlasten nu per absoluut doel naar Rust, inclusief geval- en
combinatiefactoren; de bestaande app-equivalenten blijven voor de
krachtenbalans in gebruik. Een verse toetsbrugproef
bevestigt ook een gedeeltelijke trapeziumlast, gecombineerde analyse,
lijn- plus puntlast en een ontladen einddoel. TypeScript-controle slaagt.

De grens is 100.000 lijn- en puntlastrecords samen over alle doelen. Intensiteiten
werken in de vaste lokale referentieassen als dode lasten, dus niet als
meedraaiende followerlast. De buigstaaf blijft in dit stelsel elastisch;
materiaalplasticiteit, eindscharnieren, temperatuur en algemene grote
rotaties van de staaf blijven buiten deze route.

### Eigen dwarse staafpuntlasten in het gedeelde eindige-rek J2-stelsel (13 oktober 2026)

`volume3dFiniteJ2FrameCoupled` accepteert daarnaast optionele
`frameMemberPointLoadTargets`: per absoluut volume-lastdoel een lijst
met staafindex, lokale `Py` en `Pz` in kN en positie langs de onvervormde
staaf in m. De bestaande kubische Hermite-vormfuncties verdelen elke
puntkracht over eindknoopkrachten en eindmomenten. Deze equivalenten
gaan rechtstreeks naar het externe Newton-evenwicht en de reacties;
de fysieke lokale staafeindkrachten trekken precies de equivalenten van
het laatste absolute doel af. Lijn- en puntlasten delen dezelfde
opbouw en de grens van 100.000 records. De lastassen blijven de vaste
lokale referentieassen, dus de puntlasten zijn geen followerlasten.

Een onafhankelijke Rust-proef vergelijkt voor zes backends beide lokale
dwarsrichtingen en uit-middenposities met `P·Nᵢ(a)` en de gesloten
uitkragingsformules `w = P a²(3L−a)/(6EI)` en `θ = P a²/(2EI)`.
Zij controleert ook reacties, fysieke staafeindkrachten, een gedeelde
Hencky-Tet4/DKT/geleide-staafvergelijking, absolute ontlast- en
herlastdoelen, nulbelasting en de gelijkwaardigheid van puntlasten
precies op een staafeinde met een knoopkracht. Alle vijf gerichte
proeven slagen. De formule is gekruist met
[University of Florida EML 4500, lecture 05](https://web.mae.ufl.edu/nkim/eml5526/lect05.pdf).

De gewone 3D-app-route stuurt staafpuntlasten nu eveneens als eigen
absolute doelen met geval- en combinatiefactoren naar Rust. De
berekende knoopequivalenten blijven alleen voor de getoonde globale
krachtenbalans beschikbaar; zij worden niet opnieuw als knooplasten
opgelegd of een tweede maal van de gerapporteerde staafeindkrachten
afgetrokken. De getypeerde app-proef dekt een gecombineerde lijn- en
puntlast, een zuivere puntlast met onafhankelijke uitkragingsreferentie,
gevalfactoren en een ontladen einddoel.

De staaf in dit stelsel blijft elastisch met een begrensde geometrische
rotatie; eigen materiaalplasticiteit van de staaf, scharnieren en
algemene followerlasten ontbreken. De algemene kernel is hiermee nog
niet volledig.

### Elastische XY-DKT-centroïdemomenten in het gedeelde J2-stelsel (13 oktober 2026)

De gedeelde `volume3dFiniteJ2FrameCoupled`-uitvoer bevat nu optionele
`bendingPlateMomentsKnmPerM`: per invoerdriehoek de elastische
zwaartepuntresultanten `[Mx, My, Mxy]` in kNm/m. Herstel gebruikt de
convergente knoopverplaatsingen, de vaste XY-referentiegeometrie en
dezelfde rotatietekens `[uz, -Rx, -Ry]` als de DKT-stijfheid. Zonder
buigplaten is de array leeg en wordt zij niet in JSON geschreven. Dit
zijn momenten van de elastische plaatwet bij eindige rek in de
omliggende volumes; zij zijn geen eigen plaat-GNL- of plaat-FNL-resultaten.

Een onafhankelijke Kirchhoff-patch met acht DKT-driehoeken, acht positief
georiënteerde Tet4-steunvolumes en een aangesloten 3D-buigstaaf geeft
bij opgelegde kwadratische doorbuiging `Dκ = [4,6875; -1,5625;
0,625] kNm/m`. Vier gerichte Rust-proeven slagen voor zes backends,
beide plaatwindingen, verschillende diktes in invoervolgorde, de
`t³`-schaal, ontlasten/herladen en een model zonder plaat. De
plaatvrijheidsgraden zijn in deze herstelpatch kinematisch opgelegd;
de afzonderlijke gedeelde Hencky/DKT/staaf-evenwichtsproef dekt een
vrije plaatvrijheid.

De getypeerde 3D-app-route controleert nu het aantal en de eindigheid
van deze momenten, koppelt ze per driehoek aan de bestaande
plaatresultaten en toont maxima en waarden in eigenschappen en rapport.
De verse toetsbrugproef vergelijkt een voorgeschreven kwadratische
driehoek met de onafhankelijke plaatwet `[Dκx, νDκx, 0]` en laat de
bestaande 8 kN-Tet4/DKT/staafvergelijking, materiaal- en gecombineerde
analyse en krachtenbalans slagen. Doorsnedevezelspanningen,
dwarskrachten, plaatplasticiteit en constructieve plaattoetsing blijven
open; de algemene kernel is nog niet volledig.

### Onafhankelijke G voor gekoppelde 3D-staaftorsie (13 oktober 2026)

Een buigende 3D-staaf in `volume3dFiniteJ2FrameCoupled` kan nu optioneel
`gMpa` krijgen naast `youngsMpa` en `poisson`. Saint-Venant-torsie
gebruikt dan de opgegeven `G`, terwijl axiale en Euler–Bernoulli-
buigstijfheid hun bestaande `E` behouden. Zonder `gMpa` blijft de
oude isotrope relatie `G = E/[2(1+ν)]` gelden. `G` moet positief en
eindig zijn. Dit maakt een onafhankelijk afschuifmodulus van een
lijnmateriaal zoals GL24h beschikbaar in de gekoppelde volume-/
raamwerkroute; de Tet4/Hex8 J2-volumes krijgen hierdoor geen
orthotrope houtwet.

Een onafhankelijke torsieproef vergelijkt `φ = TL/(1000 GJ)` met de
vrije eindrotatie, de negatieve wortelreactie en beide lokale
staafeindtorsies. Vier gerichte Rust-proeven slagen over zes backends,
verschillende expliciete `G` bij hetzelfde `E` en `ν`, de isotrope
terugval, een gelijktijdige onafhankelijke Hencky-Tet4-schuif- en
`E·Iy`-buigreferentie, ontlasten/herladen en ongeldige `G`.

De 3D-app geeft de eigen `gMpa` van het opgeloste staafmateriaal nu
door aan deze Rust-route en controleert de torsie voor een GL24h-staaf
aan dezelfde gesloten formule. Dit is een elastische lijnstaaftoepassing
naast een J2-volume, geen algemene GL24h-materiaal-FNL,
houtconstructietoets, afschuifvervorming van de Euler–Bernoulli-staaf
of orthotroop 3D-volume-element. Die functies blijven open.
