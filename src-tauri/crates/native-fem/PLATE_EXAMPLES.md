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
python3 src-tauri/crates/native-fem/examples/plate_cases.py hybrid_linear_pressure |
  src-tauri/target/debug/native-hybrid-plate
python3 src-tauri/crates/native-fem/examples/plate_cases.py cement_2021_cantilever |
  src-tauri/target/debug/native-hybrid-plate
python3 src-tauri/crates/native-fem/examples/plate_cases.py cement_2021_shear_uls |
  src-tauri/target/debug/native-hybrid-plate
python3 src-tauri/crates/native-fem/examples/plate_cases.py cement_2021_crack_sls |
  src-tauri/target/debug/native-hybrid-plate
```

| Geval | Berekening en controle |
| --- | --- |
| `quad_patch` | Eén Q4-schijfelement, E=1000 MPa, t=0,1 m, trek F=100 kN op de rechterrand. De spanning is F/t=1 MPa; de rechterrand verplaatst 0,001 m. |
| `quad_variable_e` | Dezelfde trekproef, nu E(0)=1000 MPa en E(0,002)=800 MPa. Bij piekbelasting volgt uit F/t=E(rek)×rek de rek 0,0011270 en E=887,30 MPa. Na ontlasten is de verplaatsing circa nul, terwijl de lagere modulus bewaard blijft. |
| `hybrid_navier` | Vierzijdig vrij opgelegde vierkante buigplaat: a=2 m, t=0,1 m, E=30 GPa, ν=0,2, q=1 kN/m². De klassieke middenzakking 0,00406qa⁴/D is 2,49446×10⁻⁵ m. Het 6×6 rooster geeft 2,39106×10⁻⁵ m (4,1% verschil). |
| `hybrid_fnl_cantilever` | Twee vierhoekige buigelementen met een afnemende E(vezelrek)-curve en een belast/ontlast-pad. De maximale vezelrek en de effectieve E blijven na ontlasten per element bewaard; de uitkraging keert bij deze secantwet elastisch terug naar nulverplaatsing. |
| `hybrid-plate-square-fnl.json` | Twee vierkanten van 1×1 m vormen een ingeklemde plaat van 2×1 m. Bij een vezelrek boven 10⁻¹⁰ daalt E van 30 naar 15 GPa. Het pad `[1, 0, 0.5]` geeft in de laatste stap E=15 GPa in beide elementen, een vrije hoekzakking van −0,108681 mm en een vrije-DOF-restkracht van minder dan 10⁻¹² relatief. De maximale vezelrek blijft van de eerste volle belastingstap bewaard. Bij volledige belasting is de zakking precies tweemaal die van dezelfde lineair-elastische plaat, omdat de eindmodulus is gehalveerd. |
| `hybrid_linear_pressure` | Uitkraging van 2×1 m met een per vierhoek bilineair opgegeven druk q(x)=−x kN/m². De analytische totale druk is −2 kN en de integraal van x·q over de plaat is −8/3 kNm; de verticale oplegreacties tellen op tot +2 kN. |
| `cement_2021_cantilever` | Gebaseerd op figuur 14 van Braam en Blaauwendraad: 10 m breed, 8 m uitkraging, t=0,6 m, q=30 kN/m² en ν=0,2. In dit voorbeeld is **E=30 GPa aangenomen**. Het 2 m rooster geeft bij het eerste elementcentrum (1 m vanaf inklemming) v_y=210 kN/m, gelijk aan q×(8−1). |
| `cement_2021_shear_uls` | Dezelfde plaat met illustratieve C20/25, z=500 mm, 2.000 mm²/m langs- en 1.200 mm²/m verticale dwarskrachtwapening, tanθ=1. Aan de steun vindt de herleiding v=240 kN/m=q×8; de eerste-generatie EC2-benadering geeft V_Rd,c=205,34 kN/m, benodigde dwarskrachtwapening 1.103,45 mm²/m², en σ_c=0,96 MPa < 7,36 MPa. De maatgevende benodigde bovenwapening in y is 4.689,66 mm²/m en overschrijdt de opgegeven 2.000 mm²/m. |
| `cement_2021_crack_sls` | Dezelfde geometrie en illustratieve wapening, met **apart aangenomen** BGT-druk q=10 kN/m². De maatgevende scheurwijdte in de bovenste y-wapening is 0,347 mm; bij een opgegeven limiet van 0,30 mm meldt de code een overschrijding. Dit is geen uit het Cement-artikel overgenomen BGT-belasting of scheurresultaat. |

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
blijft het maximum van het lastpad zichtbaar. Opgegeven
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
[JRC-brugvoorbeelden](https://eurocodes.jrc.ec.europa.eu/sites/default/files/2022-06/Bridge_Design-Eurocodes-Worked_examples.pdf)
geven een onafhankelijke 7.3.4-referentie. De plaatoplossing zelf krijgt
hierdoor **geen gescheurde doorsnedestijfheid**; de berekende scheurwijdte
is dus een benadering. De code past niet automatisch een nationale bijlage,
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
reactiesom van `+19,62 kN`. De route weigert momenteel openingen, bogen,
in-vlaklasten, gekoppelde staven, veren en GNL-buiging.
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

De app-FNL-proef geeft `C30/37` een expliciete curve met `E(0) = E_cm` en
`E(10⁻¹⁰) = E_cm/2`. Bij voldoende hoge belasting bereikt elk element de
lagere E; de zakking wordt tweemaal de lineaire waarde. Een lastpad `[1, 0]`
ontlast weer tot vrijwel nul zakking, terwijl de effectieve E en maximale
vezelrek als geschiedenis behouden blijven. De test controleert ook dat een
curve met verkeerd begin-E of stijgende E wordt geweigerd.

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
