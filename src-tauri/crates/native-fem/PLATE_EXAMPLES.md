# Vierkantsmesh en plaatvoorbeelden

De Python-generator `examples/plate_cases.py` maakt acht herhaalbare verzoeken.
Alle grootheden zijn **m, kN en MPa**. Voer de Rust-binaries uit vanuit de
repositoryroot, na `cargo build -p openaec-native-fem --bins` in `src-tauri`:

```bash
echo '{"originX":0,"originY":0,"widthM":2,"heightM":2,"cellSizeM":1,"materialId":1,"thicknessM":0.1}' |
  src-tauri/target/debug/native-square-mesh
```

De uitvoer bevat vier exacte vierkanten, negen knopen en de ID's van de
vier buitenranden. Afmetingen die geen geheel aantal cellen vormen worden
afgewezen.

Voor een rechthoek waarvan de maten geen veelvoud van één celgrootte zijn,
geeft `native-quad-mesh` een conform Q4-rooster. `maxCellSizeM` is een
bovengrens voor beide celzijden; de laatste strook wordt niet afgesneden.

```bash
echo '{"originX":0,"originY":0,"widthM":2.1,"heightM":1.5,"maxCellSizeM":1,"materialId":1,"thicknessM":0.2}' |
  src-tauri/target/debug/native-quad-mesh
```

Dit voorbeeld heeft 3×2 vierhoeken van 0,70×0,75 m, twaalf knopen,
een totaal oppervlak van 3,15 m² en dezelfde vier randknoop-ID-lijsten als
de exacte vierkantsmesher. Een Rust-test voert dit rooster rechtstreeks aan
de hybride buigplaat; onder 1 kN/m² druk tellen de reacties op tot 3,15 kN.

```bash
python3 src-tauri/crates/native-fem/examples/plate_cases.py quad_patch |
  src-tauri/target/debug/native-quad2d
python3 src-tauri/crates/native-fem/examples/plate_cases.py quad_variable_e |
  src-tauri/target/debug/native-quad2d
python3 src-tauri/crates/native-fem/examples/plate_cases.py hybrid_navier |
  src-tauri/target/debug/native-hybrid-plate
python3 src-tauri/crates/native-fem/examples/plate_cases.py hybrid_fnl_cantilever |
  src-tauri/target/debug/native-hybrid-plate
src-tauri/target/debug/native-hybrid-plate \
  < src-tauri/crates/native-fem/examples/hybrid-plate-square-fnl.json
src-tauri/target/debug/native-hybrid-plate \
  < src-tauri/crates/native-fem/examples/hybrid-plate-edge-line-load.json
python3 src-tauri/crates/native-fem/examples/plate_cases.py hybrid_linear_pressure |
  src-tauri/target/debug/native-hybrid-plate
python3 src-tauri/crates/native-fem/examples/plate_cases.py cement_2021_cantilever |
  src-tauri/target/debug/native-hybrid-plate
python3 src-tauri/crates/native-fem/examples/plate_cases.py cement_2021_shear_uls |
  src-tauri/target/debug/native-hybrid-plate
python3 src-tauri/crates/native-fem/examples/plate_cases.py cement_2021_crack_sls |
  src-tauri/target/debug/native-hybrid-plate
src-tauri/target/debug/native-three-layer \
  < src-tauri/crates/native-fem/examples/three-layer-cement-2021.json
```

| Geval | Berekening en controle |
| --- | --- |
| `quad_patch` | Eén Q4-schijfelement, E=1000 MPa, t=0,1 m, trek F=100 kN op de rechterrand. De spanning is F/t=1 MPa; de rechterrand verplaatst 0,001 m. |
| `quad_variable_e` | Dezelfde trekproef, nu E(0)=1000 MPa en E(0,002)=800 MPa. Bij piekbelasting volgt uit F/t=E(rek)×rek de rek 0,0011270 en E=887,30 MPa. Na ontlasten is de verplaatsing circa nul, terwijl de lagere modulus bewaard blijft. |
| `hybrid_navier` | Vierzijdig vrij opgelegde vierkante buigplaat: a=2 m, t=0,1 m, E=30 GPa, ν=0,2, q=1 kN/m². De klassieke middenzakking 0,00406qa⁴/D is 2,49446×10⁻⁵ m. Het 6×6 rooster geeft 2,39106×10⁻⁵ m (4,1% verschil). |
| `hybrid_fnl_cantilever` | Twee vierhoekige buigelementen met een afnemende E(vezelrek)-curve en een belast/ontlast-pad. De maximale vezelrek en de effectieve E blijven na ontlasten per element bewaard; de uitkraging keert bij deze secantwet elastisch terug naar nulverplaatsing. |
| `hybrid-plate-square-fnl.json` | Twee vierkanten van 1×1 m vormen een ingeklemde plaat van 2×1 m. Bij een vezelrek boven 10⁻¹⁰ daalt E van 30 naar 15 GPa. Het pad `[1, 0, 0.5]` geeft in de laatste stap E=15 GPa in beide elementen, een vrije hoekzakking van −0,108681 mm en een vrije-DOF-restkracht van minder dan 10⁻¹² relatief. De maximale vezelrek blijft van de eerste volle belastingstap bewaard. Bij volledige belasting is de zakking precies tweemaal die van dezelfde lineair-elastische plaat, omdat de eindmodulus is gehalveerd. |
| `hybrid-plate-edge-line-load.json` | Twee vakken vormen een 2×1 m ingeklemde plaat. Op de vrije rand loopt de dwarslijnlast lineair van −1 naar −3 kN/m. De lastresultante is −2 kN en het moment van die last om de steunlijn is 4 kNm; de Rust-reacties zijn respectievelijk +2 kN en +4 kNm. |
| `hybrid_linear_pressure` | Uitkraging van 2×1 m met een per vierhoek bilineair opgegeven druk q(x)=−x kN/m². De analytische totale druk is −2 kN en de integraal van x·q over de plaat is −8/3 kNm; de verticale oplegreacties tellen op tot +2 kN. |
| `cement_2021_cantilever` | Gebaseerd op figuur 14 van Braam en Blaauwendraad: 10 m breed, 8 m uitkraging, t=0,6 m, q=30 kN/m² en ν=0,2. In dit voorbeeld is **E=30 GPa aangenomen**. Het 2 m rooster geeft bij het eerste elementcentrum (1 m vanaf inklemming) v_y=210 kN/m, gelijk aan q×(8−1). |
| `cement_2021_shear_uls` | Dezelfde plaat met illustratieve C20/25, z=500 mm, 2.000 mm²/m langs- en 1.200 mm²/m verticale dwarskrachtwapening, tanθ=1. Aan de steun vindt de herleiding v=240 kN/m=q×8; de eerste-generatie EC2-benadering geeft V_Rd,c=205,34 kN/m, benodigde dwarskrachtwapening 1.103,45 mm²/m², en σ_c=0,96 MPa < 7,36 MPa. De maatgevende benodigde bovenwapening in y is 4.689,66 mm²/m en overschrijdt de opgegeven 2.000 mm²/m. |
| `cement_2021_crack_sls` | Dezelfde geometrie en illustratieve wapening, met **apart aangenomen** BGT-druk q=10 kN/m². De maatgevende scheurwijdte in de bovenste y-wapening is 0,347 mm; bij een opgegeven limiet van 0,30 mm meldt de code een overschrijding. Dit is geen uit het Cement-artikel overgenomen BGT-belasting of scheurresultaat. |
| `three-layer-cement-2021.json` | Braam en Blaauwendraad (Cement 2021/8), figuur 14: 8 m uitkraging met q=30 kN/m² geeft aan de inklemming `VEd=240 kN/m`. Met expliciet aangenomen `z=500 mm`, `fyd=435 MPa`, `tan(theta)=1` en `vRdc=205,34 kN/m` levert de Rust-drielagenkern `Asw=1103,45 mm²/m²` en `sigma_c=0,96 MPa`; de shear shift voegt 120 kN/m in y-richting toe aan elk huidvlak. Het artikel publiceert de geometrie en dwarskrachtreferentie; de overige ontwerpwaarden zijn zichtbare invoeraannames. |

`reinforcement.limitState` kiest `ultimate` (dwarskracht, betondrukdiagonaal
en langsstaal) of `service` (scheurwijdte). De gebruiker moet zelf de passende
UGT- en BGT-belastingcombinaties aanleveren. Het resultaat bevat per element
21 controlepunten (vier hoeken, midden en zestien integratiepunten) en de
maatgevende locatie per grootheid. De opgegeven hoeveelheid dwarskrachtstaal
`shearMm2PerM2` is mm² per m² plaatoppervlak: bij verticale wapening komt
dat overeen met Asw per eenheid doorsnede en per lengteeenheid. De vier
`top`/`bottom`-velden zijn mm²/m in x- en y-richting.

## Elementformulering en grenzen

Het [Cement-artikel *Wapenen van schijven en platen*](https://struct4u.com/app/uploads/2022/11/struct4u_2021_cement_artikel.pdf)
(p. 22–23) beschrijft een vierhoekig hybride Kirchhoff-element met 12
knoopvrijheidsgraden, kubische zakking langs elke rand, lineaire normale
randrotatie en 17 onafhankelijke momentparameters. `native-hybrid-plate`
implementeert een zelfstandige 17-parameter variant: kwadratische momenten
die lokaal in evenwicht zijn, condenseerd via complementaire energie.
`native-quad2d` is een afzonderlijk standaard Q4-**schijf**element voor
vlakspanning, met 2×2 Gauss-integratie, Green-Lagrange GNL en staal-/beton-FNL.

De hybride buigplaat heeft een **secantmodulus-omhulling**: de invoer
`modulusCurves` koppelt hoofdvezelrek aan een positieve, niet-toenemende E.
De hoogste absolute vezelrek per element blijft gedurende `loadPath` bewaard.
Dat is een eigen FNL-uitbreiding van de elastische hybride plaat, geen
scheurmodel of plastische doorsnedewet van Blaauwendraad. Ook zonder E-curve
rapporteert `maxFibreStrain` de werkelijk bereikte vezelrek; bij ontlasten
blijft het maximum van het lastpad zichtbaar.

Een afzonderlijke experimentele `plate_fiber_section`-kern integreert nu
vlakspanningsvezels over de plaatdikte voor elastische en staalplastische
N/M-resultanten. Elke vezel heeft een eigen gecommitte toestand; een
proefberekening wijzigt die toestand pas na expliciete acceptatie. Gerichte
tests controleren de gesloten elastische A/B/D-stijfheid, plastisch buigen
en ontlasten tegen fijne diktekwadratuur, en de buigtangent bij 512 lagen
binnen 0,3% van een onafhankelijk gesplitste integraal. Een lokale inverse
bepaalt bij `N=0` de krommingen voor opgegeven momenten; analytische
elastische A/B/D-oplossingen en fijne staalvezelkwadratuur controleren deze
route. De lokale `N=0`-buigtangent wordt uit `D−CA⁻¹B` berekend en tegen
de exacte A/B/D-waarde en inverse gevoeligheid getoetst.
Proeftoestanden uit uiteenlopende lastpadvertakkingen worden apart
herkend. Alleen de **elastische** laagstapels zijn via `hybridPlateLayered`
aan de hybride buigplaat en getypeerde apptransportlaag gekoppeld; de
plastische sectiehistorie nog niet. De lokale `N=0`-condensatie waarborgt
geen globale membraancompatibiliteit. Betonbuiging blijft
afgewezen totdat een onderbouwde scheurbandlengte en regularisatie bestaan.

Opgegeven
`pressureKnM2` en optionele `quadPressures` worden via een 4×4
Gauss-integratie van bilineaire vlakvormfuncties naar de vier knopen verdeeld.
Per `quadId` geven `nodalPressureKnM2` de vier extra drukwaarden in de
volgorde van `nodeIds`; deze worden bij de uniforme druk opgeteld. Daardoor
kloppen de totale dwarslast en haar eerste momenten ook bij een scheve
vierhoek; bij uniforme druk op een rechthoek zijn de vier aandelen gelijk.
Omdat het hybride element alleen
langs de rand een verplaatsingsaanname doet, blijft dit een benadering van
de exacte drukbelasting op de hybride vervormingsruimte. De
elementdwarskracht voor wapening wordt lineair uit buurelementen herleid.
Op een grof 2-cellen-uitkragingsrooster is de
herstelde steundwarskracht 1,875 kN/m tegenover 2,0 kN/m uit evenwicht
(6,25% verschil); op het 2 m Cement-rooster is 240 kN/m gevonden.

Een `edgeLoads`-invoer belast een elementrand met `startKnPerM` en
`endKnPerM`, gemeten langs lokale rand 0–3 in de volgorde van de quadknopen.
De solver integreert de lineaire lijnlast met de kubische Hermite-randvormen
en maakt daar consistente knoopkrachten en knoopmomenten van. De Rust-proef
belast een vrije plaatrand van 1 m met −1 naar −3 kN/m: de totale
oplegreactie is 2 kN en het herstelde moment door de lastarm is 4 kNm.
Voor directe solverinvoer moet een lijnlast per elementrandsegment worden
opgegeven. De app verdeelt een geometrische trapeziumlast op een van de vier
buitenranden van een losse rechthoekige 3D-plaat automatisch over de passende
Q4-randsegmenten. Lijnlasten rond openingen en algemene contouren zijn nog
niet beschikbaar.

De dwarskrachtcontrole volgt de evenwichtsopzet met betondrukdiagonaal,
verticale beugels en extra trekkracht in de huiden uit het
[lange Cement-artikel van Braam en Blaauwendraad](https://struct4u.com/app/uploads/2022/11/struct4u_2021_cement_artikel.pdf).
Voor de betonbijdrage gebruikt de code een eerste-generatie EC2 6.2.2
benadering met opgegeven `gammaC`, optionele `cRdc` en `alphaCc`; de
diagonaalhoek wordt via `tanTheta` opgegeven (0,4–1). De langsstaalcontrole
verdeelt het moment over twee huiden en gebruikt een conservatieve
orthogonale trekbenadering voor Mxy. Hij optimaliseert geen hoek of
wapeningsrichting. Verankeringslengte, minimumwapening, detaillering en
in-vlak normaalkrachten zijn niet afgedekt.

De scheurwijdte volgt de eerste-generatie EC2 7.3.4-vorm
`w_k = s_r,max (epsilon_sm - epsilon_cm)` met aanbevolen factoren
`k1=0,8`, `k2=0,5`, `k3=3,4`, `k4=0,425`. Als de berekende ongescheurde
randspanning `fctm` overschrijdt, schat de code de staalspanning uit de
elastische plaathuidkracht / opgegeven As en de effectieve trekzone van een
enkel gewapende doorsnede. De
[Sétra-gids Eurocode 2 voor betonbruggen](https://piles.cerema.fr/IMG/pdf/setra_guide_methodologique_eurocode_2_application_aux_ponts_routes_en_beton_2008_cle7c2bef.pdf)
geeft in bijlage VII, §2.3 een directe 7.3.4-referentie voor een 350 mm
dekconsole. De Rust-proef berekent die volledige controleketen: bij
`M_frequent=93 kNm/m`, `As=1230 mm²/m`, `c=30 mm`, `φ=14 mm` en `Es/Ec=15`
volgt `σs=266,98 MPa`, `ρeff=1,422%`, `sr,max=269,31 mm` en
`wk=0,2157 mm`, overeenkomend met de gepubliceerde `267 MPa`, `1,43%`,
`269 mm` en `0,22 mm`. De andere directe referentie is het
[JRC-brugvoorbeeld](https://eurocodes.jrc.ec.europa.eu/sites/default/files/2022-06/Bridge_Design-Eurocodes-Worked_examples.pdf)
met `σs=94 MPa` en `wk=0,12 mm`. De plaatoplossing zelf krijgt hierdoor
**geen gescheurde doorsnedestijfheid**; de berekende scheurwijdte is dus een
benadering. De code past niet automatisch een nationale bijlage,
belastingcombinatie, scheurgrens of materiaalveiligheidsfactor toe.
Een kwantitatieve XFEM4U-vergelijking, breukenergie-regularisatie,
ortotropie en GNL-buiging ontbreken.

De Navier-referentie voor de vrij opgelegde vierkante plaat is ook gebruikt in
de [ScadSoft verificatie van een vierzijdig opgelegde plaat](https://scadsoft.com/tests_scad/en/index/test/46).
Voor de Cement-plaat is de dwarskrachtlijn de controle; het artikel levert geen
openbare knoopverplaatsingen om een volledige implementatievergelijking te doen.
Deze experimentele controle is geen gecertificeerde constructieberekening.

## 3D-app-route: losse rechthoekige buigplaat

`design-mockup/test-native-frame3d-plate-app-route.mjs` stuurt één 2×2 m
betonplaat (`C30/37`, dikte 0,20 m) via dezelfde `solveFrame3D`-functie als de
app naar `native-quad-mesh` en `native-hybrid-plate`. Vier hoekknopen zijn
verticaal gesteund; zonder expliciete randinvoer blijven de overige randen
vrij. Bij `qz = −1 kN/m²` is de
onafhankelijke totale belasting `−4 kN`, dus moeten de verticale reacties
`+4 kN` optellen. De test controleert ook de globale momenten rond de
oorsprong, 25 roosterknopen, 16 elementen en een negatieve binnenzakking.
Een combinatie met lastfactoren 1 en 0,5 op respectievelijk `−1` en `−2
kN/m²` verdubbelt last, reacties en elastische zakking. Voor automatisch eigen
gewicht levert `ρ = 2500 kg/m³` een extra `qz = −4,905 kN/m²` en een
reactiesom van `+19,62 kN`. De route weigert momenteel bogen, afgeronde
openingen, gekoppelde staven, veren en GNL-buiging.
Een asymmetrisch ingeklemde hoek controleert de tekenomzetting van de lokale
plaatrotaties en reactiemomenten naar globale 3D Rx/Ry; ook een afzonderlijk
globaal My-puntmoment sluit de onafhankelijke momentensom.
Dezelfde plaat wordt als extra objectiviteitstest om globale Y en Z geroteerd.
De normale belasting, lokale zakking, globale reacties en het kracht- en
momentenevenwicht blijven dan gelijk na de bijbehorende coördinatenrotatie.
De mesher rondt een quotiënt als `4,000000000000001` nu tot vier cellen af;
een echt grotere maat krijgt nog steeds een extra cel. Een schuine plaat met
alleen verticaal eigen gewicht wordt geweigerd omdat daarvoor ook
schijfwerking nodig is.

`edgeSupports` kan per zijde van de rechthoek `free`, `simplySupported` of
`clamped` zijn. De app legt dan alle Rust-roosterknopen op die zijde op:
scharnierend fixeert `w`, ingeklemd fixeert `w`, `thetaX` en `thetaY`.
`maxCellSizeM` begrenst de Q4-celmaat. Een 2×2 m C30/37-plaat met 0,20 m
dikte, een 6×6 rooster en vier scharnierende randen heeft onder
`qz = −1 kN/m²` een middenzakking binnen 4,15% van de Navier-referentie
`0,00406 qa⁴/D`. Vier ingeklemde randen leveren een kleinere zakking; één
ingeklemde rand geeft de verwachte steunmomenten. De 3D-app toont de reacties
op *alle* randroosterknopen en telt ze mee in de globale kracht- en
momentensom. Een geroteerde plaat met dezelfde randvoorwaarden behoudt zijn
lokale zakking en geroteerde reacties.

Een rechthoekige opening in dezelfde plaat loopt via de Rust `quadMesh`-mesher
naar de Rust `native-hybrid-plate`-kern. In de app-proef
heeft een 2×2 m plaat een centrale opening van 0,5×0,5 m: het 0,25 m raster
bevat 60 Q4-elementen en 80 knopen, geen elementen in de opening, en bij
`qz = −1 kN/m²` tellen de randreacties op tot `+3,75 kN`. Een last van
`−0,5 kN` op een openingshoek verhoogt die som tot `+4,25 kN`. Een
excentrische opening controleert apart de globale momentensom. Ook de
geroteerde plaat behoudt de lokale zakking. Het rooster begrenst de
celmaat, houdt minimaal 10 mm materiaal tussen opening en buitenrand of
andere opening, en wijst niet-assengelijnde en uitwendige openingen af.
Voor dit exacte raster vergelijkt de app-proef ook alle knoopcoördinaten en
Q4-connectiviteit met de bestaande TypeScript-rastermesher; een aparte
Rust-proef sluit de drukresultante direct op de Rust-mesh/solver-keten.
Een tweede opening van 0,25×0,25 m verlaagt de netto drukresultante verder
tot `3,6875 kN`; ook die app-routeproef sluit de globale krachten en momenten.
Het invoervoorbeeld `examples/quad-mesh-opening.json` is direct met
`native-quad-mesh` uit te voeren en levert het gebruikte 80-knoops rooster.

De app-FNL-proef geeft `C30/37` een expliciete curve met `E(0) = E_cm` en
`E(10⁻¹⁰) = E_cm/2`. Bij voldoende hoge belasting bereikt elk element de
lagere E; de zakking wordt tweemaal de lineaire waarde. Een lastpad `[1, 0]`
ontlast weer tot vrijwel nul zakking, terwijl de effectieve E en maximale
vezelrek als geschiedenis behouden blijven. De test controleert ook dat een
curve met verkeerd begin-E of stijgende E wordt geweigerd.
Hetzelfde E(rek)- en ontlastpad is met de rechthoekige opening getest:
halvering van de effectieve E verdubbelt de maximale zakking, en na het
lastpad `[1, 0]` is de zakking vrijwel nul terwijl E en de maximale
vezelrek behouden blijven.

Dezelfde 3D-app-route kan nu per betonplaat een expliciete
`reinforcement`-specificatie bewaren en aan Rust doorgeven. De gebruiker kiest
`ultimate` voor dwarskracht, betondrukstaaf en langswapening, of `service`
voor scheurwijdte, en kiest zelf het bijbehorende belastinggeval of de
combinatie. Het rapport toont per Q4-element de maatgevende steekpuntwaarde,
het aantal onderzochte punten en de toetsstatus. De app controleert dat
`fckMpa` past bij de gekozen betonklasse en dat dekking en staafdiameter in
de plaatdikte passen. De app-routeproef controleert beide grenstoestanden,
de doorgifte naar de Rust-kern en het rapport; de afzonderlijke Rust-proeven
hierboven vergelijken de rekenformules met de Cement- en JRC-voorbeelden.
Ook deze app-toets is een eerste-generatie postprocessor op de berekende
elastische of secant-E-momenten; hij corrigeert de plaatstijfheid niet voor
scheuren, zoekt geen extrema tussen steekpunten en stelt geen nationale
bijlage of combinatiefactoren vast.

Als de Blaauwendraad-drielagencontrole is ingesteld, ondersteunt deze route
ook in-vlakse knooplasten en `qx`/`qy`-oppervlaktelasten. Dezelfde Rust-Q4-mesh
wordt aan `native-quad2d` gegeven; constante vlaklasten worden met consistente
Q4-knooplasten verdeeld. De resulterende spanningen worden vanuit de vier
Gauss-punten naar dezelfde 21 steekpunten als de buigresultanten
geïnterpoleerd. De membraanreacties worden samen met de buigreacties in de
globale balans opgenomen. Zonder drie-lagenconfiguratie weigert de route
in-vlakse belasting in plaats van membraanresultanten weg te laten.

De app-integratietest bevat een onafhankelijke uniaxiale Q4-trekproef: een
plaat van 2×2 m, dikte 0,20 m, met in totaal 5 kN trekbelasting op de vrije
rand. De handberekening geeft `σx = 5.000 N / (200 mm × 2.000 mm) =
0,0125 MPa` en `Nx = σx × 200 mm = 2,5 kN/m`; alle 21 resulterende
drielagenpunten moeten die waarde teruggeven. Dezelfde app-test controleert
een rekafhankelijke `E(ε)`-curve, het doorlopen van `[0,5, 1]` en een
effectieve E lager dan de beginmodulus.

Dit blijft een ontkoppelde analyse: de Q4-membraan- en hybride buigoplossing
wisselen geen geometrische stijfheid of buigrek uit. De route levert dus geen
gekoppeld schaalelement en ondersteunt geen GNL-buiging.

## GNL-shell: onafhankelijke vierkante-plaatreferentie

`geometric_shell_matches_levy_large_deflection_square_plate` reproduceert de
vierkante-plaatproef uit Samuel Levy, [NACA Report 737 (1942)](https://ntrs.nasa.gov/citations/19930091816),
tabellen 8–9. De vier randen zijn in het vlak onbeweeglijk; uit het vlak zijn
ze eenvoudig opgelegd (`w = 0`, vrije rotaties). Voor `ν = 0,316` en
`p a⁴/(E h⁴) = 51,4` vermeldt Levy `w_center/h = 0,952` (zes-termenreeks).
Een uniform Q4-rooster in de ondiepe-shellsolver geeft `w_center/h = 0,979106`
op 4×4, `0,957550` op 8×8 en `0,950787` op 16×16. De afwijking van Levy's
`0,952` neemt daarmee af van 2,85% via 0,58% tot 0,13%. Op alle drie roosters
sluit ook de verticale reactieresultante op de totale druklast. Dit is een
sterke meshverfijningscontrole voor dit benchmarkgeval, maar nog geen
algemene asymptotische meshconvergentie of ontwerpvalidatie.

De test gebruikt `E = 1000 MPa`, `h = 0,05 m` en `a = 1 m`, dus
`p = 321,25 kN/m²`. De solver koppelt von-Kármán-membraanrek aan de hybride
Kirchhoff-buiging en voert een Newton-laststap uit. Het materiaal blijft
lineair elastisch in deze referentie; secant-E-FNL, staalplastificatie,
betonscheuren en wapening zijn hiermee niet gevalideerd.

De aparte proef `geometric_shell_secant_modulus_retains_peak_strain_after_unloading`
controleert de actieve membraanrespons van een 1×1 m Q4-vak met `t = 0,1 m`,
`ν = 0`, een totale trekkracht van 5 kN en een secantcurve die bij
`ε = 10⁻¹⁰` van 30 GPa naar 15 GPa daalt. Op de piek is
`ε = 5/(15·10⁶·0,1)` en de Green-Lagrange-relatie geeft de randverplaatsing
`u = √(1+2ε)−1`. Na ontlasten naar nul controleert dezelfde proef dat de
piekrek en lagere E bewaard blijven terwijl de verplaatsing terugkeert naar nul.
