# Vierkantsmesh en plaatvoorbeelden

De Python-generator `examples/plate_cases.py` maakt zeven herhaalbare verzoeken.
Alle grootheden zijn **m, kN en MPa**. Voer de Rust-binaries uit vanuit de
repositoryroot, na `cargo build -p openaec-native-fem --bins` in `src-tauri`:

```bash
echo '{"originX":0,"originY":0,"widthM":2,"heightM":2,"cellSizeM":1,"materialId":1,"thicknessM":0.1}' |
  src-tauri/target/debug/native-square-mesh
```

De uitvoer bevat vier exacte vierkanten, negen knopen en de ID's van de
vier buitenranden. Afmetingen die geen geheel aantal cellen vormen worden
afgewezen.

```bash
python3 src-tauri/crates/native-fem/examples/plate_cases.py quad_patch |
  src-tauri/target/debug/native-quad2d
python3 src-tauri/crates/native-fem/examples/plate_cases.py quad_variable_e |
  src-tauri/target/debug/native-quad2d
python3 src-tauri/crates/native-fem/examples/plate_cases.py hybrid_navier |
  src-tauri/target/debug/native-hybrid-plate
python3 src-tauri/crates/native-fem/examples/plate_cases.py hybrid_fnl_cantilever |
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
scheurmodel of plastische doorsnedewet van Blaauwendraad. Opgegeven
`pressureKnM2` wordt via een 4×4 Gauss-integratie van bilineaire
vlakvormfuncties naar de vier knopen verdeeld. Daardoor kloppen de totale
dwarslast en haar eerste momenten ook bij een scheve vierhoek; bij een
rechthoek zijn de vier aandelen gelijk. Omdat het hybride element alleen
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
