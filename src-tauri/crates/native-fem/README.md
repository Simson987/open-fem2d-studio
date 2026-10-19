# Eigen Rust FEM-kern (experimenteel)

Deze crate is een zelfstandige rekenkern op de branch
`codex/native-rust-3d-plate-gnl-fnl`. De bestaande solver blijft de standaard in
de app. De CLI-programma's lezen één JSON-verzoek van stdin en schrijven
één JSON-resultaat naar stdout; fouten krijgen een niet-nul exitcode en een
`{"error":"..."}`-resultaat. Een solver die invoer niet ondersteunt, weigert
die expliciet.

De nieuwe getypeerde `volume3d`-route rekent lineaire Tet4-volumes met
knoop-, uniforme lichaams- en vlaklasten, opleggingen, per-element E/ν, verplaatsingen, reacties en
constante elementspanningen. `solverStrategy` kiest matrixvrije parallelle
PCG, gecomprimeerde CSR/PCG, directe sparse LDLᵀ of de directe frontale
wavefront-oplosser;
`automatic` kan op een klein stabiel model bij PCG-nietconvergentie naar de
frontale route overschakelen. `volume3dJ2` biedt een begrensde experimentele
globale Tet4-Newtonroute met J2-staalplasticiteit en lastpadgeschiedenis.
Optioneel vervangt `elementSteels` de globale staalwet per Tet4 in meshvolgorde,
met eigen E, ν, vloeigrens en isotrope verharding. Een onafhankelijke
drie-lagenstaaf controleert de elastische seriespanning, alle
knoopverplaatsingen en reacties; een afschuifproef controleert per laag de
plastische consistentie en ontlasting. De materiaaltoestand blijft per
element bewaard tijdens het lastpad.
De J2-Newtonstap biedt `options.linearBackend: "sparseDirect"` (standaard) of
`"frontalWave"`. De frontale route elimineert rechtstreeks uit de actuele
elementtangenten zonder globale CSR-opbouw; `maxFrontDofs` is begrensd op
256. Beide routes controleren ook bij nulresidu de actuele tangent op een
mechanisme. Frontaal vereist een symmetrische positief-definiete
geremde tangent en vervangt geen lastpad- of materiaalstabiliteitsanalyse.
Met `options.linearBackend: "automatic"` probeert de J2-route eerst sparse
direct; alleen een expliciete LDLᵀ-factoropslaglimietfout laat haar binnen
dezelfde laststap naar frontaal overschakelen. `linearBackendUsed` noemt de
oplosser van de laatste geaccepteerde stap en `frontalFallbacks` telt
geaccepteerde overschakelingen. Een mechanisme, ongeldige tangent of
Newton-convergentiefout krijgt geen automatische omweg.
De J2-residunorm gebruikt nu geschaalde `hypot`-accumulatie en weigert
niet-eindige normen. Een regressie met een eindige maar zeer grote vrije
kracht mag geen nulverplaatsing als evenwicht accepteren. J2, betonschade en
Tet4-GNL mengen opeenvolgende eindige lastdoelen gewogen; zo blijft een
omkering tussen grote krachten zonder overloop representabel. Niet-eindige
geïnterpoleerde waarden en reacties worden als fout gemeld.
`volume3dConcreteDamage` biedt een nog kleinere Tet4-proef met expliciete
scheurbandbreedte, breukenergie en betontrekschade tijdens trek en ontlasten.
In het onbeschadigde elastische bereik gebruikt de Newton-stap de exacte
elastische tangent. Zo kruist de numerieke tangentverstoring niet onbedoeld
een kleine maar geldige treksterkte; een onafhankelijke lage-treksterkteproef
controleert één Newton-stap, verplaatsing en vrij residu. Na schade gebruikt
de route nog een numerieke tangent en een begrensde dichte LU-oplosser.
Optioneel geeft `elementMaterials` voor elk Tet4 een eigen E, ν, treksterkte,
breukenergie en expliciet opgegeven scheurbandbreedte; ieder element bewaart
zijn eigen piekrek- en schadehistorie. De breedte wordt niet automatisch uit
de mesh afgeleid en algemene 3D mesh-objectiviteit blijft onbewezen.
Een tweelagen-Tet4-coupon met vrij axiaal grensvlak is tegen een onafhankelijk
opgeloste tweeverenwet gecontroleerd bij beschadiging en ontlasting. Ook de
grensvlak- en eindreacties sluiten; dit blijft een eendimensionaal lastpad.
Beide routes accepteren per lastdoel ook `bodyForces` (kN/m³) en
`faceTractions` (kN/m²) op de referentiegeometrie; dit zijn vaste krachten,
geen vervormingsvolgende druk. Hun consistente Tet4-knooplasten zijn
V·b/4 en A·t/3. De exacte knoopreacties onder gecombineerde lasten en het
leegmaken van deze lasten over een lastpad worden apart gecontroleerd.
`volume3dGnl` is een begrensde totale-Lagrangiaanse Tet4-route met
Green-Lagrange-rek, St Venant–Kirchhoff-elasticiteit en analytische consistente
tangent. Optioneel geeft `elementMaterials` per Tet4 een eigen E en ν in
meshvolgorde; de bestaande globale waarden blijven de standaard. Een
drie-lagenproef controleert eindige trek, belastingomkering en ontlasting
tegen een onafhankelijke nominale-spanningoplossing. Optioneel kiest
`elementEnergyBeta` per Tet4 een experimentele, omkeerbare
rekafhankelijke elasticiteit: `W = W₀ + βW₀²/(2E₀)` met W₀ de
St Venant–Kirchhoff-energie. De consistente Newton-tangent en de uitvoer
`elementEffectiveEMpa = E₀(1 + βW₀/E₀)` zijn gecontroleerd. Positieve β
verstijft; matig negatieve β verweekt maar kan bij grotere rek een
instabiele tangent geven. Een onafhankelijke krachtgestuurde kubusproef
controleert beide tekens, belastingomkering en ontlasting. Dit is een
gedefinieerde toetsmateriaalwet, geen gekalibreerd staal- of betonmodel.
`options.linearBackend` kiest de Newton-matrixoplosser: `dense` (standaard,
maximaal 180 DOF en 300 Tet4), `sparseDirect` via CSR-LDLᵀ of
`frontalWave` via elementtangenten. `automatic` begint sparse direct en
schakelt alleen bij een vastgestelde LDLᵀ-factoropslaglimiet binnen de
laststap over naar frontaal. `maxFactorEntries` en `maxFrontDofs` begrenzen
de twee routes; `linearBackendUsed` en `frontalFallbacks` melden de
daadwerkelijke keuze. Een mechanisme krijgt geen herstelpoging.
Een niet-lineaire kubus en een tweemateriaalligger geven voor alle drie
dezelfde analytische oplossing; een mechanisme wordt door alle drie
afgewezen. Sparse en frontaal assembleren geen globale dichte tangent en
zijn begrensd op 900 DOF en 1.200 Tet4; de directe sparse factor telt
maximaal 500.000 items en de frontbreedte maximaal 256 vrije DOF. Een
onafhankelijke affiene proef met 750 Tet4, 648 DOF en 192 vrije DOF toetst
beide routes bij β=0 en β=24 op alle verplaatsingen, spanningen, effectieve
E-waarden en afzonderlijke steunreacties. Dit is nog geen grote-modelroute.
Per `targets`-lastdoel zijn `bodyForces` in kN/m³ en `faceTractions` in kN/m² beschikbaar. Dit zijn
vaste belastingen op de referentiegeometrie: de equivalente knooplast is
respectievelijk V·b/4 per Tet4-knoop en A·t/3 per gekozen vlaknode. Een
zes-Tet kubus met nominale vlaktractie volgt de analytische eindige rek bij
belasten, omkeren en ontlasten; een volledig gefixeerde tetra controleert
de afzonderlijke knoopreacties uit volume- en vlaklast. De drie niet-lineaire
volumeroutes zijn experimenteel en geen ontwerpcontrole; algemene,
gekalibreerde gecombineerde volume-GNL/FNL is nog niet beschikbaar.
De aparte `volumeHex8`-route assembleert lineaire achtknoops hexaëders met
2×2×2-integratie, consistente lichaams-/vlaklasten, CSR/PCG, optionele
directe sparse LDLᵀ, begrensde frontale eliminatie en Gauss-puntspanningen.
`linearBackend: "sparseDirect"` is begrensd op 6.000 DOF, vier miljoen
assemblagetriplets en één miljoen factoritems. Met expliciete
`structuredGridCells` gebruikt zij de parallelle matrixvrije route voor exact
regelmatige rechthoekige dozen met E/ν per element; de uniforme
250.047-elementenproef en een afzonderlijke tweemateriaalproef van dezelfde
omvang draaien op vier threads. Met `linearBackend: "matrixFreeGeneral"`
rekent zij ook geldige, scheve of vervormde Hex8-netten matrixvrij, tot
68.061 elementen en 480.000 DOF. De symmetrische lokale stijfheid en
Gauss-gradiënten kosten 3.944 bytes per element; de cache heeft een expliciete
grens van 256 MiB. De grens is een geheugenbudget en geen aangetoonde
grootschalige acceptatie. Een analytische acht-elementenpatch en een
heterogene, vervormde CSR-vergelijking slagen. Een onafhankelijke
L-vormige lagenproef met verwisselde knoop- en elementvolgorde vergelijkt
ook één en vier threads met CSR. Een afzonderlijke 64.000-elementenproef
op een vervormd geëxtrudeerd net sluit op een onafhankelijke lagenberekening.
De afzonderlijke opt-in `linearBackend: "matrixFreeGeneralLarge"` gebruikt
dezelfde elementformulering met maximaal 1 GiB lokale elementcache en
1.000.000 DOF; de standaard- en automatische route behouden hun kleinere
grenzen. De daadwerkelijke modelallocaties en resultaatarrays komen bovenop
het cachebudget.
Een aparte releaseproef met deze grote optie lost 250.047 vervormde,
heterogeen gelaagde Hex8-elementen en 786.432 DOF op vier threads op,
met onafhankelijk gecontroleerde verplaatsingen, spanningen en reacties.
Een tweede grote proef rekent 257.250 Hex8-elementen in een geëxtrudeerde
L-vormige doorsnede met vervormde geometrie en herschikte knoop- en
elementvolgorde door. De analytische lagenberekening controleert opnieuw
alle verplaatsingen, Gauss-spanningen en eindreacties. Een kleine conforme
Hex8-vijfhoekige ster met vijfwaardig binnenknooppunt controleert daarnaast
een niet-roosterachtige topologie tegen onafhankelijke Hooke-vlaktracties,
reacties en Gauss-spanningen, met één en vier threads en CSR-pariteit.
Grootschalige willekeurige 3D-connectiviteit en gekoppelde GNL/FNL zijn nog
niet gevalideerd.
Een derde genegeerde releaseproef heeft een gesloten interne 3D-holte in
een vervormd Hex8-net: 260.416 elementen, 819.882 DOF, herschikte knoop- en
elementvolgorde en vier threads. De affiene elastische referentie controleert
alle verplaatsingen en Gauss-spanningen; onafhankelijke 2×2-oppervlakte-
integratie van σ·n controleert bovendien iedere randknoopreactie. Deze
voxel-holte blijft een gestructureerde topologie, geen willekeurig
ongestructureerd volume.
Voor invoer, analytische controles en schaalproeven: zie
[`VOLUME3D_EXAMPLES.md`](VOLUME3D_EXAMPLES.md).
Met `linearBackend: "automatic"` kiest de Hex8-route CSR binnen het
assemblagebudget en anders de begrensde algemene matrixvrije route. Alleen
na een herkende PCG-convergentie- of residufout probeert zij voor een klein
model frontaal te herstellen, na controle van de frontbreedte. Ongeldige
geometrie en ontoereikende opleggingen worden als fout gerapporteerd.

De `frame2d`-route is nu ook vanuit de app te kiezen voor een model
met uitsluitend staven. Zij vertaalt bestaande knopen, doorsneden, opleggingen
en belastingen en geeft staafdiagrammen in het bestaande resultaatformaat
terug. De geometrische analyse lost elke combinatie apart op met iteratieve
P-Δ-stijfheid en controleert of de vrije stijfheid positief is. De zelfstandige
Rust-kern berekent daarnaast axiale staalplastificatie en betontrekschade per
belastingpad. In de 2D-eigenschappen kan per staal- of betonstaaf een axiale
materiaalwet worden gekozen. De afzonderlijke analysekeuze „Rust 2e orde +
axiale FNL” bewaart het belastingpad in het project en gebruikt deze wetten.
De 2D-adapter zet scheefstand om in `H = φ·(−V)` op de verticale component
van knoop-, staafpunt- en lijnlasten. Hij lost de positieve en negatieve
richting afzonderlijk op, zodat combinaties en omhullenden beide meenemen.
De bestaande fysisch niet-lineaire stand voor gescheurde betonbuiging wordt
in de Rust-raamwerkroute nog geweigerd.
Buigscharnieren aan staafeinden zijn gekoppeld voor lineaire, P-Δ- en axiale FNL-analyse.
Een staaf op Winkler-bedding wordt met dezelfde karakteristieke lengte als de
bestaande solver in maximaal 200 Rust-elementen verdeeld. De kern voegt per
elementuiteinde de tributaire verticale veer en 0,1% horizontale
bodemweerstand toe; de app voegt de diagrammen weer samen. In de Rust-invoer
is `foundationKnPerM2` de lijnstijfheid in kN/m². De app-invoer
`bedding.kLijn` in N/mm² wordt hiervoor met 1000 vermenigvuldigd.
Staven met `segmenten` krijgen per stuk hun opgegeven A en I; extra sneden,
deellastgrenzen (ook bij een gewone staaf) en puntlasten maken zo nodig extra
rekenstukken. De app
hergebruikt een bestaande knoop op een segmentgrens en geeft per rekenstuk
`segmenten` met x-grenzen, N en M terug. Ook lineaire combinaties houden dit
veld en bepalen het maatgevende moment uit de gecombineerde stationsreeks.
Bij axiale FNL toont de staafhistorie het stuk met de meeste trekschade of
plastische rek. Een traptrede-ligger is tegen de analytische doorbuiging en
de bestaande solver gecontroleerd; ook wisselende A, P-Delta en FNL zijn
getest.
Translatiehulzen en eindveren zijn gekoppeld. Een axiale eindveer werkt bij
FNL in serie met de axiale staafrespons; een axiale translatievrijgave draagt
geen normaalkracht over en laat de staaf vrij uitzetten. De bestaande solver
blijft de automatische keuze.

Voor een zuiver lineair 2D-raamwerk accepteert de Rust-invoer ook
`linearBackend: "frontalWave"` met een optionele `frontalMaxFrontDofs`.
De app probeert deze route bij een specifieke iteratieve convergentiefout
op een begrensd model en kiest haar direct boven 20.000 globale DOF.
Gekoppelde membranen en niet-lineaire analyses
blijven op hun eigen route. De expliciet frontale lineaire route bouwt geen
globale matrix op. Een smal-front-proef met 7.000 staven en 21.003 globale
DOF slaagt; de maximale actieve frontbreedte blijft afhankelijk van de
elementvolgorde en modeltopologie.

Axiale verdeelde lijnlasten zijn in de
FNL-route beschikbaar; de app verdeelt zo'n staaf automatisch in stukken van
maximaal 0,1 m, zodat de veranderende normaalkracht en plastische toestand
ruimtelijk worden benaderd. Een interne axiale staafpuntlast blijft in de
aanvraag een staaflast. De Rust-kern maakt op de lastpositie een interne
knoop, splitst de materiaalstaaf en voegt het diagram daarna weer samen onder
de oorspronkelijke staafidentiteit. Zo worden de normaalkrachtsprong en
plastische toestand aan weerszijden apart berekend zonder dat de app de staaf
vooraf hoeft te splitsen. In de vezelgeïntegreerde buig-FNL wordt ook een
axiale eindveer of vrijgave meegenomen: de staafzijde-DOF's worden iteratief
teruggevonden en het geassembleerde evenwicht houdt rekening met het verschil
tussen ruwe en gecondenseerde equivalente elementlasten. Gecombineerde N-M-
staalplastificatie en betonscheurvorming met axiale veer, en vrije thermische
rek bij axiale vrijgave zijn onafhankelijk tegen sectie-evenwicht en
reactiekrachten gecontroleerd. Gekoppelde staaf-plaatmodellen zijn nog niet
aangesloten.
Een tweeledige staal-FNL-ligger met E=210 en 170 GPa vergelijkt de
tipverplaatsing en -rotatie met afzonderlijke moment-krommingsoplossingen
voor beide staven; de app-route controleert dat de verschillende E-moduli
per staaf en de plastische historie behouden blijven.
De app-routeproef voor een middenlast gebruikt `E=210 GPa`, `A=0,01 m²`,
`fᵧ=250 MPa`, `Eₜ/E=0,02` en `L=4 m`. Bij `6000 kN` op het midden wordt
de staaf opgedeeld in twee stukken met `N=±3000 kN` en `σ=300 MPa`.
De app stuurt de puntlast op de ongesplitste staaf naar Rust. De kern maakt
intern de twee stukken en geeft één staafdiagram terug met twee stations op de
lastpositie. De bilineaire rekformule geeft
`2 m·(250/210000 + 50/(0,02·210000))` oftewel `26,1905 mm`
middenverplaatsing; de app-route vergelijkt deze waarde, de normaalkrachtsprong
en de reacties met de berekende uitkomst. Afzonderlijke Rust-proeven controleren
ook een verlopende gedeeltelijke lijnlast, thermische uitzetting en een schuine
staafas op dezelfde interne splitsing.
Dezelfde routeproef controleert een 4 m vrij uitkragende staaf met een axiale
lijnlast van `700 kN/m`. De piekspanning is `280 MPa`; integratie van de
bilineaire rek over de lengte geeft `4,1667 mm` tipverlenging. De app splitst
de staaf in 40 stukken en de Rust-uitkomst wijkt minder dan `0,02 mm` af.
De Rust-proeven controleren de seriestijfheid en `N/k`-veeruitrekking bij
staalplastificatie en betonscheurvorming, inclusief ontlasten en uniforme
thermiek. Een vrijgegeven thermisch staafeinde geeft nul normaalkracht en de
vrije lengteverandering `α·ΔT·L`; de app-route toetst hetzelfde geval.
Het 2D-FNL-lastpad begint met tien increments per padsegment. Bij een niet-
convergerende iteratie of een tijdelijk verlies van positieve tangentstijfheid
halveert de solver de proefstap; de plastische rek en betonschade worden pas na
een geconvergeerde stap vastgelegd. De gecombineerde staalproef met
belasten/ontlasten/herbelasten controleert deze cutback-route.
Uniforme temperatuurbelasting per staaf loopt wel via Rust, met een
lastspecifieke uitzettingscoëfficiënt. De kern kan die belasting ook combineren
met axiale staalplastificatie, betontrekschade en P-Δ. De getypeerde 2D-adapter
neemt hiervoor per staaf `axialMaterialLaw` en een modelbreed
`axialMaterialLoadPath` aan en bewaart de axiale materiaaltoestand in het
resultaat. De 2D-werkbalk toont bij axiale FNL het lastpad, bijvoorbeeld
`1, 0, 0.5` voor belasten, ontlasten en herbelasten. Buiging blijft elastisch;
EN 1992/1993-toetsen worden voor deze gedeeltelijke FNL-uitkomst niet uitgevoerd.

Dezelfde projectfactoren gaan bij `material` en `combined` ook mee naar de
2D-plaatkern: CST en Q4 voeren het hele pad per materiaalpunt uit en bewaren
staalplastificatie, betonschade en de maximale rek voor de volgende stap.
Mislukte stappen worden gehalveerd. De app-route-tests controleren dat `[1, 0, 0.5]`
daadwerkelijk bij beide elementtypen aankomt. De gebruikte modelveldnaam
`axialMaterialLoadPath` is historisch; het pad geldt ook voor platen.

Voor een ligger op bedding controleert de app-route een puntlast in het midden
van een ligger van `20/λ` tegen de gesloten oplossing voor een oneindig lange
ligger: `λ=(k/(4EI))^(1/4)`, `w₀=Pλ/(2k)` en `M₀=P/(4λ)`. Zij vergelijkt ook
een gedeeltelijke trapeziumlast en een korte P-Δ-ligger met de bestaande
solver. Ook voor sparse raamwerkmatrices boven 600 DOF controleert een
LDLᵀ-factorisatie de vrije stijfheid op niet-positieve pivots. De eigenknik-
analyse van 3D-ramen blijft afzonderlijk begrensd op 120 vrije en 600 totale
DOF.

Een afzonderlijke lineaire of FNL 3D-plaatroute kan in de app met expliciete keuze
voor Open FEM Rust worden berekend. Zij accepteert één vlakke rechthoek in
een willekeurig 3D-vlak zonder staven of bogen, met optionele rechthoekige
openingen. De Rust-mesher
maakt een conform Q4-rooster; de hybride Kirchhoff-kern berekent uitwijking
normaal op de plaat, rotaties, reacties, momenten en dwarskrachten.
Oppervlaktelasten en puntlasten gaan mee per belastinggeval of combinatie;
eigen gewicht werkt voor horizontale platen. Bij een schuine plaat heeft
zwaartekracht ook een niet-ondersteunde component in het plaatvlak.
Opleggingen kunnen op plaat- en openingshoekknopen en langs de buitenranden
zitten. Alleen normaalgerichte belastingen en eenduidig naar lokale buigvrijheden
te vertalen globale opleggingen zijn toegestaan. Het rapport toont
roosteruitvoer en de 3D-weergave toont de vervormde plaat. Schijfwerking,
gekoppelde staven en opgelegde verplaatsingen worden in deze losse-plaatroute
expliciet geweigerd.
De opgegeven E-rekcurve is een onomkeerbare secant-E-omhulling op maximale
vezelrek per element. Het FNL-lastpad kan ook ontlasten; de daling van E blijft
bewaard. Voor P-Δ-shellberekeningen is aanvullend een materiaalwet per plaat
instelbaar: bilineair J2-staal of onomkeerbare betontrekbeschadiging werkt op
de 4×4 shellmembraanpunten, met blijvende toestand en gerapporteerde maximale
plastische rek/beschadiging. Per analyse kies je óf deze wet óf de secant-E-curve;
de combinatie is nog niet gevalideerd. De plaatbuiging blijft elastisch of
gebruikt de secant-E-envelop; het materiaalmodel is dus nog geen plastische of
gescheurde buigdoorsnede.

Een controleerbaar voorbeeld staat in
[`examples/frame2d-cantilever.json`](examples/frame2d-cantilever.json):
een uitkraging met `L=3 m`, `E=210 000 MPa`, `I=8·10⁻⁶ m⁴` en `P=10 kN`
omlaag. De Euler-Bernoulli-formules geven `EI=1680 kNm²`,
`u_y=-PL³/(3EI)=-0,0535714 m`, `θ=-PL²/(2EI)=-0,0267857 rad`,
`R_y=+10 kN` en `M_z=+30 kNm`. De Rust-test en de vergelijking met de
bestaande TypeScript-solver controleren dit voorbeeld, vijf andere
liggergevallen en een tweestaafs portaal.

[`examples/frame2d-p-delta-cantilever.json`](examples/frame2d-p-delta-cantilever.json)
voegt `100 kN` druk en `10 kN` dwarslast toe. Voor deze uitkraging is de
Euler-kniklast `π²EI/(4L²) ≈ 460,6 kN`. De exacte elastische balkkolomformule
geeft bij `100 kN` druk `u_y = -H[tan(kL)-kL]/(Pk) ≈ -0,0682304 m`, met
`k = √(P/EI)`. De Rust-uitkomst met één element wijkt minder dan `0,1%` af;
een last van `600 kN` druk wordt als instabiel afgewezen. De geometrische
stijfheid gebruikt de gemiddelde staafnormaalkracht; bij een sterk variërende
normaalkracht moet de staaf worden onderverdeeld.

[`examples/frame2d-steel-unload.json`](examples/frame2d-steel-unload.json)
belast een staaf met `A=0,01 m²`, `E=210 000 MPa`, `f_y=250 MPa` en
verharding `E_t/E=0,02` tot `3000 kN`, gevolgd door ontlasten. De analytische
totale rek op de piek is `f_y/E + (300−250)/E_t = 0,0130952`; de plastische
rek na ontlasten is `0,0116667`, dus de blijvende verlenging over `3 m` is
`0,035 m`. De Rust-test controleert die waarden en de nulkracht na ontlasten.
Dit voorbeeld isoleert de axiale respons.
Axiale verdeelde lijnlasten lopen via het app-mesh van maximaal 0,1 m.
De test `combined_gnl_fnl_cantilever_matches_independent_beam_column_solution`
controleert de gecombineerde GNL/FNL-route met een elastische uitkraging onder
druk en dwarskracht, parallel aan een rotatievrije staalstaaf die axiaal
plastificeert. De tipverplaatsing wordt op 4, 8 en 16 elementen vergeleken met
de gesloten beam-column-oplossing
`w(L) = Q/N · (tan(kL)/k − L)`, `k = √(N/EI)`; op het fijnste rooster is de
afwijking kleiner dan 1% en de evenwichtsrest kleiner dan `10⁻⁷`.
[`examples/frame2d-internal-axial-point-load.json`](examples/frame2d-internal-axial-point-load.json)
laat zien hoe Rust zelf een ongesplitste staaf bij een interne axiale puntlast
splitst, de plastische verlenging berekent en het resultaat onder één staaf
teruggeeft.

[`examples/frame2d-thermal-steel-unload.json`](examples/frame2d-thermal-steel-unload.json)
verwarmt een aan beide uiteinden vastgehouden staaf met 100 K. Voor
`E=210 GPa`, `A=0,01 m²`, `α=10⁻⁵/K`, `f_y=100 MPa` en
`E_t/E=0,5` is de drukkracht bij de piek 1550 kN. Na afkoelen via
`loadPath: [1, 0]` blijven 0,261905‰ plastische drukrek en 550 kN
trekreactie over. Een vrije staaf met dezelfde opwarming verlengt 3 mm zonder
plastificatie. De Rust-proeven dekken daarnaast verhinderde betonafkoeling en
gelijktijdige GNL/FNL-thermiek af; de 2D-app-test vergelijkt lineaire
thermische gevallen met de bestaande solver.

[`examples/frame2d-thermal-gradient.json`](examples/frame2d-thermal-gradient.json)
geeft een temperatuurverschil van `40 K` over `h=0,2 m` in een vrij
opgelegde staaf van `3 m`. `deltaTGradientK` betekent de temperatuur aan
lokale `+Y` minus die aan lokale `−Y`; `deltaTK` is de gemiddelde
temperatuurverandering. De opgelegde kromming is
`κ = −α·deltaTGradientK/h = −0,0024 m⁻¹`; het midden wijkt volgens
`−κL²/8 = +2,7 mm` uit zonder mechanisch buigmoment. Bij beide uiteinden
ingeklemd blijft de vervorming nul en ontstaat een constant moment
`−EIκ = +4,032 kNm`. De kern test beide randvoorwaarden en een analyseverzoek
met axiale staalplastificatie. In de app staan temperatuurverschil en afstand bij de
temperatuurlast. Zonder opgegeven positieve afstand wordt de gradiënt
geweigerd; de bestaande TypeScript-solver verwerkt dit veld niet.

De materiaalwet werkt nu ook op de 2D-raamwerkbuiging van staven zonder
eindveren of releases. De doorsnede gebruikt drie equivalente vezels die de
opgegeven `A` en `I` exact reproduceren voor een lineaire rekverdeling; langs de
staaf wordt met twee Gauss-punten geïntegreerd. Staalvezels bewaren plastische
rek en betonvezels onomkeerbare trekschade door het opgegeven lastpad. De
sectieresultante en volledige N-M-tangent sturen de Newton-stap; de maximale
vezelgeschiedenis wordt per staaf aan de app doorgegeven. Dit is een
equivalente doorsnede, geen integratie van de werkelijke flens-/lijfgeometrie;
bij eindveren of releases blijft de buiging elastisch.

[`examples/frame2d-fiber-steel-bending.json`](examples/frame2d-fiber-steel-bending.json)
is een uitkraging van 3 m met `A=0,01 m²`, `I=8·10⁻⁶ m⁴`, `E=210 000 MPa`,
`f_y=250 MPa`, `E_t/E=0,01` en een eindmoment van `41 kNm`. Voor de equivalente
vezelafstand `y=√(3I/A)=0,04899 m` is het eerste-vloeimoment
`M_y=f_y I/y≈40,82 kNm`. Rust berekent een tiprotatie van `0,104182 rad` en
maximale equivalente plastische rek `0,0005057`; het moment blijft `41 kNm` en
de evenwichtsrest is `5,2·10⁻¹⁶ kN`. De Rust-test vergelijkt de tiprotatie met
een onafhankelijke scalaire moment-krommingsoplossing.

[`examples/frame2d-fiber-concrete-bending.json`](examples/frame2d-fiber-concrete-bending.json)
gebruikt `E=30 000 MPa`, `f_t=3 MPa`, restverhouding `0,02` en `M=0,6 kNm`.
De berekende tiprotatie is `0,009445 rad`, de maximale vezeltrekschade `0,38545`
en de evenwichtsrest `3,1·10⁻¹⁵ kN`. De Rust-proef ontlast daarna naar nul en
controleert dat de schadegeschiedenis behouden blijft.

[`examples/frame2d-released-cantilever.json`](examples/frame2d-released-cantilever.json)
laat een uitkraging met een buigscharnier bij de tip zien. De knooprotatie is
vastgezet, maar de herstelde staafeindrotatie is `−PL²/(2EI)` en het
staafeindmoment is nul. De puntverplaatsing is `−PL³/(3EI)`. De app-route
vertaalt `startRy`/`endRy` en de legacy `hinge`-velden naar dezelfde releases.
Bij P-Δ wordt de scharniercondensatie met elke bijgewerkte normaalkracht
opnieuw uitgevoerd. Voor dezelfde staaf met `100 kN` druk volgt de
balkkolomverplaatsing binnen `0,1%`; bij `600 kN` druk faalt de
stabiliteitscontrole. Axiale FNL met een buigscharnier werkt ook, inclusief
lastpad. Ook de combinatie FNL + P-Δ herbouwt per iteratie de gecondenseerde
stijfheid en equivalente last. Het voorbeeld
[`frame2d-combined-released-steel.json`](examples/frame2d-combined-released-steel.json)
belast, ontlast en herbelast een staaf met staalplastificatie en een vrij
buigmoment aan de tip. De axiale kracht in de laatste stap is `1500 kN`;
de P-Δ-zijverplaatsing wordt met die actuele kracht berekend.

```bash
src-tauri/target/debug/native-frame2d \
  < src-tauri/crates/native-fem/examples/frame2d-cantilever.json
```

## Rekengebied

| Kern | Element | GNL | FNL | Lasten en opleggingen |
| --- | --- | --- | --- | --- |
| `native-frame2d` | 6-DOF Euler-Bernoulli raamwerk, 3 DOF/knoop | iteratieve P-Δ, dichte of sparse LDLᵀ-stabiliteitscontrole | axiale staal-/beton-FNL met lastpad; bij stijve staafeinden ook vezelgeïntegreerde N-M-buiging en blijvende vezelgeschiedenis | knoop-, verdeelde, staafpunt- en uniforme thermische lasten; vaste DOF, globale veren, Winkler-bedding, opgelegde verplaatsingen/rotaties en lineaire buigscharnieren |
| `native-frame3d` | 12-DOF Euler-Bernoulli raamwerk, 6 DOF/knoop | iteratieve P-Δ-stijfheid en sparse stabiliteitscontrole; eigenknik tot 120 vrije/600 totale DOF | monotone effectieve-E-envelop; met expliciet `loadPath` axiale staalplastificatie en blijvende betontrekschade | knoop-, lijn-, staafpunt- en thermische lasten; vaste DOF, globale veren, opgelegde verplaatsingen/rotaties en staafeindscharnieren |
| `native-plate2d` | 3-knoops CST-vlakspanning/membraan, 2 DOF/knoop | Green-Lagrange-rek met Newton-iteratie | J2-staalplastificatie met isotrope verharding en onomkeerbare betonschade per element | knoopkrachten en vaste x/y-DOF |
| `native-plate-bending` | 3-knoops DKT-plaatbuiging, 3 DOF/knoop | nog niet | nog niet | dwarsknoopkrachten, knoopmomenten, vaste w/rotatie-DOF en verticale/rotatieve knoopveren met reacties |
| `native-square-mesh` | exact vierkant Q4-rooster met randknoop-ID's | n.v.t. | n.v.t. | `widthM`, `heightM`, `cellSizeM` |
| `native-quad-mesh` | gestructureerd Q4-rooster voor willekeurige rechthoekmaten, met randknoop-ID's | n.v.t. | n.v.t. | `widthM`, `heightM`, `maxCellSizeM` |
| `native-quad2d` | 4-knoops Q4-schijfelement, 2 DOF/knoop | Green-Lagrange | J2-staal en betonschade per Gauss-punt; afnemende E(rek)-curve | vlakke knoopkrachten, x/y-opleggingen en translatieveren per richting |
| `mixed2d` | gekoppeld CST/Q4-vlakspanningsmesh, 2 DOF/knoop | Green-Lagrange-rek en gezamenlijke Newton-laststappen | J2-staal, betontrekschade en afnemende secant-E; CST-status per element en Q4-status per Gauss-punt met commit na geaccepteerde stap | gedeelde knopen, vlakke knoopkrachten, vaste x/y-DOF en translatieveren |
| `native-hybrid-plate` | 4-knoops hybride Kirchhoff-buiging, 12 DOF en 17 momentparameters | nog niet | afnemende secant-E per element en belastingpad, met cutbacks bij niet-convergerende E-updates | dwarsknoopkrachten, momenten, uniforme en per vierhoek bilineaire druk, lineaire lijnlasten op mesh-uitgelijnde elementranden, w/rotatie-opleggingen en verticale/rotatieve knoopveren met reacties; optionele UGT-wapenings- en BGT-scheurcontrole |
| `native-geometric-shell` / `geometricShell` | 4-knoops von-Kármán schaal, 5 DOF/knoop; hybride Kirchhoff-buiging gekoppeld aan Green-Lagrange Q4-membraan | Newton-tangent, sparse inertiecontrole en lastpad | afnemende secant-E op gecombineerde hoofdrek; optioneel staal-J2 of betontrekbeschadiging per 4×4 membraanpunt, toestand vastgelegd na geaccepteerde stap | membraan-/buigknooplasten, uniforme/bilineaire druk, elementrandlijnlasten, aparte membraan- en buigopleggingen, lokale translatie-/rotatieveerknopen met reacties; 21 membraan-/moment-/dwarskrachtresultaatpunten en toestand op alle 16 membraan-Gauss-punten per element |
| `native-prestressed-beam` | vrij opgelegde lineair-elastische ligger met rechte of parabolische kabel en optioneel stukgewijs constante E per spansegment | n.v.t. | opgegeven voorspanverlies | uniforme last, lineaire gedeeltelijke lastsegmenten en puntlasten per fase; stations, kritieke sneden en EC2-dwarskrachtpostprocessen; doorsnede-I blijft constant langs de ligger |
| gedeelde dispatch `crackWidth` | EC2 §7.3.4 postprocessor voor betonstaal en gebonden voorspanning | n.v.t. | n.v.t. | spanning uit de gescheurde doorsnede, rechthoekgeometrie, materiaalwaarden en effectieve voorspanstaalbijdrage; uitvoer `wk`, `sr,max` en benutting |
| `native-three-layer` | Blaauwendraad drie-lagen postprocessor voor schaalresultanten | n.v.t. | n.v.t. | membraan-/momentresultanten, huidwapening en optionele kernschuifwapening; getypeerd `threeLayer`-verzoek |

`crackWidth` gebruikt expliciet de spanning uit de gescheurde doorsnede. Bij
voorspanning is dat voor voorgespannen strengen de spanningsverandering vanaf
de rekloze betontoestand. De liggerkern leidt deze waarden nog niet af uit de
belastingen; zie [`PRESTRESSED_BEAM.md`](PRESTRESSED_BEAM.md) en het
[controlefixture](examples/ec2-bonded-prestress-crack-width.json).

De invoer gebruikt **m, kN en MPa**. Voor 3D volgt het JSON-schema de
veldnamen van `frame3d-solver` (`schemaVersion: 1`); een materiaal kan een
extra `law` krijgen. Voor 2D is de invoer een apart, beperkt roostercontract
met `nodes`, `materials`, `triangles`, `supports` en `loads`. De bestaande
TypeScript-plaat gebruikt Pa en N; de vergelijkingstest converteert die
eenheden expliciet. `buildNativePlate2DRequest` en
`buildNativePlateBendingRequest`, `buildNativeQuad2DRequest` en
`buildNativeHybridPlateRequest` in
`design-mockup/src/core/fem/nativePlate2DAdapter.ts` zet een bestaand `Mesh`
om naar de betreffende kern en weigert onder meer gemengde elementtypes,
gekoppelde balken, orthotropie en rotatieveren. Translatieveren worden als
`kxKnPerM`/`kyKnPerM` in kN/m doorgegeven; het native resultaat rapporteert de
veerreactie mee met de oplegreacties.

## Gedeelde aanroep uit de app

`dispatch::solve_native_fem` accepteert één getypeerd verzoek:

```json
{
  "kind": "squareMesh",
  "input": {"originX":0,"originY":0,"widthM":2,"heightM":2,"cellSizeM":1,"materialId":1,"thicknessM":0.1}
}
```

Andere `kind`-waarden zijn `frame2d`, `frame3d`, `plate2d`, `plateBending`, `quad2d`,
`mixed2d`, `quadMesh`, `hybridPlate`, `hybridPlateLayered`, `prestressedBeam` en `threeLayer`. Het antwoord heeft dezelfde `kind` en een
`result` met het bestaande resultaatcontract van die kern. De desktop roept
dit aan met Tauri-command `solve_native_fem({ inputs })`, de ontwikkelbrowser
met toetsbrug-opdracht `solve_native_fem`, en MCP met het gelijknamige
gereedschap. `design-mockup/src/lib/nativeFemClient.ts` kiest vanuit de app
automatisch Tauri of de ontwikkelbrug. Een drie-wegen-test vergelijkt de
gehele JSON-uitvoer voor een mesh en een Q4-trekproef.

`hybridPlateLayered` accepteert `input.bending` met het bestaande
`hybridPlate`-verzoek en `input.elasticLayeredSections` met per `quadId` een
onder-naar-boven geordende lijst `layers` (`thicknessM`, `eMpa`, `nu`,
`law: {"kind":"elastic"}`). De som van de laagdikten moet de plaatdikte zijn.
De buigstijfheid wordt per element uit de vezeldoorsnede bij lokaal `N=0`
gecondenseerd; dit is geen volledige membraan-buiging gekoppelde laminaatplaat.
`solveNativeHybridPlateLayered` bereikt dezelfde route via de apptransportlaag.
Moduluscurven, niet-elastische vezels, orthotropie en wapeningscontrole worden
in deze experimentele route afgewezen. `effectiveEMpa` in het bestaande
resultaatcontract is hier alleen de opgegeven referentie-E waarmee de hybride
matrix is genormaliseerd; de werkelijke gelaagde buigstijfheid is `D_eff` en
kan niet door één effectieve E worden weergegeven.

### Blaauwendraad drie-lagencontrole

`threeLayer` is een postprocessor voor opgegeven schaalresultanten in kN/m en
kNm/m. Hij verdeelt membraankrachten en momenten over boven- en onderschil met
behoud van krachtenevenwicht en moment, toetst de drie Annex F-membraantakken,
en kan optioneel een expliciet opgegeven kern-vakwerkmodel met vergelijking
(22) voor de extra schilkrachten controleren. Per huid rapporteert de uitvoer
ook het maatgevende membraangeval (`both-directions`, `x-only`, `y-only` of
`compression-only`); de 3D-plaatberekening en het rapport geven dat geval
zichtbaar door. De berekening is vergeleken met
de [artikelwaarden op pp. 7–8 van Blaauwendraad en Braam (2021)](https://struct4u.com/app/uploads/2022/11/struct4u_2021_cement_artikel.pdf)
en de gepubliceerde EC2-voorbeelden 648 en 93 voor de krachtsverdeling. De
publicatie is de lange versie van het [Cement-artikel *Wapenen van schijven en
platen*](https://www.cementonline.nl/artikelen/wapenen-van-schijven-en-platen-lang);
de korte versie verscheen in Cement 2021/8. Het artikel baseert de
wapeningsafleiding op elastische EEM-resultanten en lokale plastische
herverdeling. De hybride Kirchhoff-plaat is de elementkeuze voor betrouwbare
plaatmomenten en dwarskrachten; deze `threeLayer`-postprocessor vervangt dat
plaatelement niet.

De aanroeper kiest expliciet `compressionModel` (`blaauwendraad2021` of
`ec2AnnexF`), `fcdMpa`, `fydMpa` en `nuPrime`. `core` is optioneel; zonder die
waarden wordt de kern niet getoetst. Voorbeeldinvoer:

De volledige invoer staat in
[`examples/three-layer-blaauwendraad.json`](examples/three-layer-blaauwendraad.json).
Het Cement-2021-uitkragingsreferentieverzoek staat in
[`examples/three-layer-cement-2021.json`](examples/three-layer-cement-2021.json)
en is rechtstreeks uit te voeren met `native-three-layer`.

Gebruik `threeLayerBatch` wanneer een andere solver meerdere element- of
integratiepuntresultanten aanlevert. Eén gedeelde `configuration` bevat
doorsnede, wapening en normwaarden; `samples` bevat per unieke ID de positie en
de acht resultanten. De batch geeft elk puntresultaat terug en meldt of ten
minste één deelcontrole is overschreden.

De app-client biedt `solveNativeThreeLayerFromSolverResults` als losse adapter
voor bestaande Rust-Q4-membraan- en hybride plaatresultaten met dezelfde mesh.
De huidige 3D-plaatroute doet de uitgebreidere controle afzonderlijk: bij
in-vlakse belasting rekent hij het Rust-Q4-membraanelement en combineert de
resultaten met hybride buigresultanten op de 21 resultaatpunten per vierhoek.
De spanningen op de 2×2 membraan-Gauss-punten worden naar deze punten
geïnterpoleerd. Membraanreacties komen mee in de app-krachtenbalans; FNL
gebruikt de opgegeven `E(ε)`-curve voor beide oplossers. De membraan- en
buigoplossingen blijven geometrisch ontkoppeld, zodat deze route geen
GNL-schaalelement vormt. De adapter weigert afwijkende element-/knoopsets,
ongelijke plaatdikten en upstream-restresiduen boven `1e-7`.

In de FEM Studio-eigenschappen zijn er twee gebruikersroutes: een expliciet als
beton herkende 2D-Q4-schijf, met membraankrachten op alle vier Gauss-punten en
zonder kernschuifcontrole, en de losse 3D-plaatroute met hybride momenten en
dwarskrachten plus optionele membraankrachten. Bij lineaire combinaties worden
de Q4-Gauss-puntresultanten eerst gesuperponeerd en daarna opnieuw getoetst; de
UI toont per element de grootste benutting en de locatie van het maatgevende
resultaatpunt. In 3D worden de membraan- en buigresultaten op 21 punten per
vierhoek getoetst, maar niet geometrisch gekoppeld.

Dit is een deelcontrole: scheurtoestand, automatische laagdimensionering,
excentriciteit, verankering, detaillering en Nationale Bijlage worden niet
afgeleid of goedgekeurd. Het resultaat is geen volledige schaalberekening.

In **Instellingen → Berekening** kan de gebruiker nu `Open FEM Rust
(experimenteel)` kiezen voor een eerste-orde, P-Δ of fysisch niet-lineair
3D-raamwerk. De projectkeuze `2e orde + fysisch` wordt voor een zuiver
3D-raamwerk naar Rust `combined` gestuurd: P-Δ en de expliciete staal- of
betonwet worden samen iteratief opgelost. Zonder opgeslagen lastpad gebruikt
deze stand standaard `[1]`, zodat ook een monotone belasting de materiaalgeschiedenis
bijhoudt.

Voor een lineair 3D-raamwerk kan de Rust-invoer optioneel
`linearBackend: "frontalWave"` en `frontalMaxFrontDofs` opgeven. De app probeert
deze frontale methode op een begrensd model wanneer de iteratieve solve
expliciet niet convergeert of haar residunauwkeurigheid verliest. De
expliciet frontale lineaire route bouwt geen globale matrix op. Boven
20.000 globale DOF kiest de app deze route direct; een 20.010-DOF-proef
met een smal front is via de app en Rust-CLI doorgerekend. Eigenknik blijft
een afzonderlijke, op 600 totale DOF begrensde berekening.

Voor FNL stelt de gebruiker per staaf in de eigenschappen expliciet
een vloeigrens en verhardingsverhouding (staal) of treksterkte en
reststijfheidsverhouding (beton) in. Staven zonder FNL-wet blijven elastisch;
minstens één staaf moet een wet hebben. De automatische solverkeuze schakelt
de experimentele FNL-route niet zelf in. Uniforme thermische lasten en beide
doorsnedegradiënten kunnen met de FNL-laststappen worden gecombineerd. De
gradiënten krijgen hun vrije thermische kromming mee in de secant-E-schatting;
plastische rek en betonschade zijn nog alleen axiaal geformuleerd, dus dit is
geen vezel- of doorsnede-FNL voor buiging. Gesloten-vormige vrije uitkragingen
controleren de thermische kromming om beide lokale assen.
Eindscharnieren worden ook bij FNL per iteratie
gecondenseerd. In de 3D-eigenschappen zonder
selectie kan de gebruiker een FNL-lastpad invoeren, bijvoorbeeld `1, 0, 0.5`.
De app bewaart het pad in het project, stuurt het als `loadPath` naar Rust en
toont de axiale materiaaltoestand per staaf. Zonder lastpad gebruikt de
app meestal de monotone secant-E-benadering. Een FNL-lastpad start in 3D met
tien increments per padsegment; bij niet-convergentie of verlies van positieve
tangentstijfheid wordt de proefstap gehalveerd. Axiale plastische rek en
betonschade worden pas na een geconvergeerde stap vastgelegd. Uniforme
temperatuur wordt op dezelfde stappen met de axiale materiaalgeschiedenis
gecombineerd. Voor een vrijgegeven eindmoment herstelt de kern de interne staafrotatie voordat
zij de vezelrek en secante E schat. Bij P-Δ bevat de momentlijn de bijdrage
van de axiale kracht over de vervormde staaflijn; haar eindwaarde sluit aan
op het berekende staafeindmoment.
EN 1992/1993-toetsing wordt bij een FNL-lastpad geblokkeerd, omdat alleen de
axiale materiaalgeschiedenis is gevalideerd.

Voor een Rust-, dispatcher- of app-verzoek met `analysis: "material"`
kan `loadPath` de absolute lastfactoren per stap bevatten, bijvoorbeeld
`[1, 0]` voor belasten en ontlasten. De axiale staalwet gebruikt een
éénassige retourprojectie met isotrope verharding: plastische rek blijft na
ontlasten bestaan. De axiale betontrekschade blijft na ontlasten bestaan en
verlaagt de herbelastingsstijfheid; druk blijft elastisch. Het antwoord geeft
per staaf `axialHistory` met plastische rek, equivalente plastische rek,
trekschade en actuele axiale tangentmodulus. Buiging gebruikt in deze route
nog de bestaande secante staafbenadering. Een uniforme temperatuurbelasting
kan met de axiale FNL-geschiedenis worden gecombineerd: per laststap gebruikt
de retourprojectie totale rek minus thermische rek. Ook gelijktijdige P-Δ is
voor een axiaal verhinderde, verwarmde staaf getest. Temperatuurgradiënten
met FNL en eigenknik met materiaalgeschiedenis blijven buiten dit contract.

[`examples/frame3d-released-steel-history.json`](examples/frame3d-released-steel-history.json)
is een 2 m uitkraging met een vrijgegeven eindmoment Mz, 1500 kN axiale
trek en 10 kN dwarslast. Het pad `[1, 0, 0.5]` geeft analytisch
0,238095‰ blijvende plastische rek en 1,190476 mm eindverlenging bij de
laatste stap. Het Rust-resultaat heeft nul eindmoment, 1,190476 mm verlenging
en een evenwichtsresidu van 2,3·10⁻¹². Een tweede test herhaalt deze
scharnierproef met blijvende betontrekschade.

[`examples/frame3d-thermal-steel-unload.json`](examples/frame3d-thermal-steel-unload.json)
is een aan beide uiteinden axiaal vastgehouden stalen staaf van 2 m. Bij
100 K opwarming is de thermische rek 1‰. Met E=210 GPa, A=0,01 m²,
f_y=100 MPa en E_t/E=0,5 bereikt de drukkracht 1550 kN. Na afkoeling
langs `[1, 0]` blijft 0,261905‰ drukplastische rek en 550 kN trekreactie
over. De Rust-test vergelijkt de reacties en geschiedenis met deze gesloten
éénassige waarden; de app-test controleert een vrij uitzettende staaf en
ontlasten via de gewone 3D-invoerroute.
Een afzonderlijke betonproef met E=33 GPa, A=0,01 m², f_t=3 MPa,
residuverhouding 0,2 en verhinderde afkoeling van 30 K geeft 43,8 kN
trekreactie en schade `1 − 4,38/9,9 = 0,557576`. Na het lastpad
`[1, 0, 0.5]` blijft die schade behouden en is de trekreactie 21,9 kN.

```bash
src-tauri/target/debug/native-frame3d \
  < src-tauri/crates/native-fem/examples/frame-steel-axial-unload.json
src-tauri/target/debug/native-frame3d \
  < src-tauri/crates/native-fem/examples/frame-concrete-axial-reload.json
```

In het staalvoorbeeld (L=2 m, A=0,01 m², E=210 GPa, f_y=100 MPa,
E_t/E=0,5) geeft 1500 kN trek een piekspanning van 150 MPa. De gesloten
éénassige formule geeft na ontlasten 0,238095‰ plastische rek en 0,476190 mm
blijvende verlenging. In het betonvoorbeeld (E=33 GPa, f_t=3 MPa,
E_t/E=0,2) geeft 60 kN trek eerst 6 MPa spanning en schade 2/3; na ontlasten
en herbelasten tot 30 kN is de tangentmodulus 11 GPa en de verlenging
0,545455 mm. Beide voorbeelden worden ook in Rust-tests getoetst.

De bestaande analyseknop gebruikt dezelfde app-invoer en vertaalt de Rust-uitvoer naar
knoopverplaatsingen, reacties, staafkrachten, bemonsterde snedekrachtlijnen, evenwicht,
resultaatweergave en rapport. De automatische keuze blijft bij de bestaande
solver. Staaflijn-, staafpunt- en thermische lasten zijn ook gekoppeld en de
diagramstations zijn tegen de bestaande solver vergeleken. Voor P-Δ geeft de
app iteraties, convergentie, verplaatsingsversterking en eigenknikfactoren weer.
Voor FNL toont de app de effectieve E-modulus per staaf; met lastpad ook
plastische rek, betonschade en de actuele axiale tangentmodulus. Een axiale
trekproef voor beide wetten is tegen de gesloten formule
`ε = f_grens/E₀ + (σ − f_grens)/(r·E₀)` getoetst.

| Axiale proef (A = 0,01 m², L = 2 m) | E₀ | Grens | r | Spanning | Analytische verlenging |
| --- | ---: | ---: | ---: | ---: | ---: |
| Staal, 1500 kN trek | 210 000 MPa | 100 MPa | 0,5 | 150 MPa | 1,905 mm |
| Beton, 60 kN trek | 33 000 MPa | 3 MPa | 0,2 | 6 MPa | 1,091 mm |

De eigenknikoplosser heeft maximaal 120 vrije en 600 totale vrijheidsgraden;
daarboven meldt de app een mislukte knikberekening zonder de statische analyse
te verwerpen. Een uitkraging is tegen Euler en de bestaande knikoplosser
gevalideerd. De onafhankelijke momentensom over de onvervormde geometrie is
bij P-Δ niet altijd nul.
De andere native elementresultaten zijn nog niet op alle weergave-, combinatie-
en rapporttypen aangesloten. Onbekende `kind`- en invoervelden worden door de
Rust-typen geweigerd.

```bash
cd src-tauri
cargo test -p openaec-native-fem
cargo test -p openaec-native-fem --test frame3d_parity
cargo build -p openaec-native-fem --bins
cd ../design-mockup
node --import tsx test-native-frame2d-comparison.mjs
node --import tsx test-native-frame2d-app-route.mjs
node --import tsx test-native-frame3d-comparison.mjs
node --import tsx test-native-frame3d-app-route.mjs
node --import tsx test-native-plate2d-comparison.mjs
node --import tsx test-native-plate-bending-comparison.mjs
node --import tsx test-native-quad2d-comparison.mjs
```

Voorbeeld van een 2D-vlakspanning-verzoek:

```json
{
  "analysis": "material",
  "nodes": [{"id":1,"x":0,"y":0},{"id":2,"x":1,"y":0},{"id":3,"x":0,"y":1}],
  "materials": [{"id":1,"eMpa":210000,"nu":0.3,"law":{"kind":"steelBilinear","yield_mpa":235,"hardening_ratio":0.02}}],
  "triangles": [{"id":1,"nodeIds":[1,2,3],"materialId":1,"thicknessM":0.1}],
  "supports": [{"nodeId":1,"ux":true,"uy":true},{"nodeId":2,"ux":false,"uy":true},{"nodeId":3,"ux":true,"uy":false}],
  "loads": [{"nodeId":2,"fx":15000,"fy":0},{"nodeId":3,"fx":0,"fy":15000}],
  "loadPath": [1, 0]
}
```

`analysis` is `linear`, `geometric`, `material` of `combined` voor 2D;
3D gebruikt `linear`, `p-delta`, `material` of `combined`. Het
`MaterialLaw`-contract bevat `elastic`, `steelBilinear` en
`concreteCracking` met respectievelijk `yield_mpa`/`hardening_ratio` en
`tensile_mpa`/`residual_ratio`. `loadPath` is optioneel: de factoren worden
achtereenvolgens aangebracht, elk in tien stappen voor niet-lineaire analyses.
Het voorbeeld belast en ontlast weer. Het resultaat bevat per driehoek de
equivalente plastische rek en de trekschade. De materiaaltoestand leeft binnen
één verzoek; afzonderlijke CLI-aanroepen delen geen toestand.

## Verificatie en grenzen

- De 3D-verplaatsingen en reacties zijn voor drie stalen belastinggevallen
  vergeleken met de bestaande Dedaliano-adapter, met grenzen van 1e-7 m/rad
  en 1e-4 kN/kNm. Een uitkraging is bovendien tegen de gesloten formule getest.
  Een gedeelde JSON-invoer vergelijkt nu ook translatie- en rotatieveren en
  opgelegde axiale verplaatsing en rotatie rechtstreeks met de adapter;
  de eerste twee gevallen lopen ook door P-Δ. Voor de veer en de axiale
  verplaatsing zijn daarnaast gesloten evenwichtsformules getest. Uniforme,
  gedeeltelijke/lineair verlopende staaflijnlasten en staafpuntlasten zijn
  op dezelfde wijze vergeleken; de uitkragingslasten zijn ook met gesloten
  liggerformules getoetst. De JSON-vergelijking gebruikt maximaal 1e-8 m/rad
  absolute of 1e-6 relatieve afwijking voor verplaatsingen en 1e-6 kN/kNm
  absolute of relatieve afwijking voor reacties. Vrije en verhinderde
  thermische uitzetting zijn tegen de analytische staafoplossing getoetst;
  uniforme en tweerichtingsgradiënten zijn met de bestaande solver vergeleken.
  My-, Mz- en torsiescharnieren zijn met statische condensatie ingevoerd en
  tegen de bestaande solver en een opgelegde liggerformule gecontroleerd.
  Een schuine tweestaafsknoop met lokale staafrotatie is ook vergeleken.
  Vrije rotaties zonder aangesloten stijfheid krijgen een nulwaarde als
  rekentechnische referentie; een momentlast op zo'n vrijheidsgraad wordt
  geweigerd. De bestaande solver meldt het geteste tweezijdig losgelaten
  liggergeval als singulier, terwijl de reacties analytisch volgen.
- De 2D lineaire knoopverplaatsingen, reacties en spanningen van twee
  CST-elementen zijn vergeleken met de huidige TypeScript-kern. Tests dekken
  ook elementoriëntatie, GNL-verstijving, plastische restvervorming na ontlasten,
  blijvende betonschade en foutafhandeling.
- De DKT-plaatbuiging is voor acht driehoeken met de bestaande TypeScript-kern
  vergeleken op verplaatsingen, reacties en momenten. Starre modes en een
  constante-krommingspatch zijn apart getest.
- Q4-schijfverplaatsingen, reacties en spanningen zijn voor rechte en vervormde
  roosters met de bestaande TypeScript-kern vergeleken. De hybride
  buigplaat doorstaat starre modes, een constante-krommingspatch en een
  Navier-plaatbenchmark (4,1% middenzakkingverschil op 6×6 vierhoeken).
  De hybride plaat geeft nu ook momenten en herleide dwarskrachten terug op
  alle 4×4 Gauss-punten plus de vier hoeken en het middelpunt. De Cement-
  uitkraging controleert op die Gauss-punten de analytische lineaire
  dwarskrachtverdeling, naast de totaalsom van de reacties.
- Een slanke hybride plaatstrook met verdeelde tipveren is onafhankelijk
  vergeleken met de Euler–Bernoulli-cantileverstijfheid
  `3 EI / L³` en de seriestijfheid van ligger en tipveer; gemiddelde
  tipdoorbuiging wijkt maximaal 1,5% af en de reacties sluiten. De gebruikte
  tipstijfheid volgt uit [MIT OpenCourseWare, tip-loaded cantilever](https://ocw.mit.edu/courses/2-002-mechanics-and-materials-ii-spring-2004/bc25a56b5a91ad29ca5c7419616686f7_lec2.pdf).
- `geometricShell` koppelt de hybride buigplaat aan von-Kármán membraanrek met
  vijf vrijheidsgraden per knoop en een consistente geometrische tangent.
  Secant-E-rekhistorie per element bewaart de piekrek bij ontlasten.
  `examples/geometric-shell-uniaxial.json` controleert membraantrek; de
  tangent is met eindige verschillen vergeleken. De secant-E-curve gebruikt
  de grootste gecombineerde hoofdrek uit beide plaatzijden op elk membraan-
  Gauss-punt; deze rekreconstructie vraagt nog onafhankelijke validatie. Dit
  blijft experimenteel. Optionele staal-J2-plastificatie en
  betontrekbeschadiging werken op membraanpunten; geaccepteerde laststappen
  bewaren de geschiedenis. Uitvoer geeft locatie, Green-Lagrange membraanrek,
  equivalente plastische rek en trekbeschadiging van alle 16 integratiepunten;
  voor staal- en beton-FNL wordt dit via het 3D-plaatrapport gecontroleerd.
  Shellbuiging zelf gebruikt nog elastische of secant-E-stijfheid, geen
  constitutieve buigdoorsnede. Optionele wapeningspostprocessing
  gebruikt de 21 shellresultantpunten per element; membraankracht wordt gelijk
  verdeeld over beide vlakken voor langsstaal- en scheurwijdtetoetsen. Dit
  koppelt gescheurde stijfheid niet terug naar de solve, en de volledige
  axiaal-dwarskrachtinteractie moet nog onafhankelijk gevalideerd worden.
  Variabele drukvelden en
  mesh-uitgelijnde randlijnlasten worden verwerkt, maar zijn nog niet
  onafhankelijk gevalideerd onder GNL/FNL.
- De optionele plaatwapeningscontrole toetst de dwarskracht en de benodigde
  verticale en langsgerichte wapening in een UGT-verzoek. Een apart
  BGT-verzoek rapporteert scheurwijdten in vier wapeningsrichtingen. De
  scheurformule is op formule- en volledige sectiecontrole tegen twee
  gepubliceerde EC2-brugvoorbeelden getoetst (Sétra en JRC);
  de Cement-uitkraging geeft aan de steun 240 kN/m. Zie de
  [plaatvoorbeelden](PLATE_EXAMPLES.md) voor invoer, uitkomsten en aannames.
- **Beperkingen FNL:** de 3D-raamwerkkern gebruikt zonder `loadPath` een monotone
  effectieve-E-envelop. Met `loadPath` heeft alleen de axiale spanning
  plastische of schadegeschiedenis; vezelspanningen en buiging hebben nog geen
  historische doorsnedetoestand.
  De 2D-betonschade gebruikt één scalair per element zonder scheurband- of
  breukenergie-regularisatie; het resultaat kan daarom van de mesh afhangen.
  Ook de 2D-staalwet en het betonmodel zijn nog niet extern gevalideerd voor
  ontwerpbeslissingen.
- De DKT-kern ondersteunt lineaire elastische buiging, orthotropie en
  secans-E-curven per materiaal. Voor lineaire DKT kan
  `linearBackend: "frontalWave"` elementgewijs frontaal oplossen met
  `frontalMaxFrontDofs` als begrenzing; dit accepteert geen E-rekcurve.
  De lineaire hybride Q4-buigplaat heeft dezelfde optionele frontale
  keuze, inclusief variabele plaatdruk, randlijnlasten en oplegveren;
  geometrische of materiaalniet-lineariteit gebruikt die route niet.
  Zowel DKT als de hybride buigplaat gebruiken bij wisselende E een
  secans-E-benadering; dat is geen geregelde beton-scheurwet of
  doorsnedeplastificatie. Gekoppelde staaf-plaatmodellen zijn nog niet
  geïmplementeerd. Thermische lasten of staafeindscharnieren samen met
  materiaalniet-lineariteit, en eigenwaarde-knik worden in de 3D-kern geweigerd.
- De plaatwapeningsuitvoer gebruikt herleide dwarskracht, aangenomen
  eerste-generatie EC2-formules en een elastische momentverdeling. Er is
  geen gescheurde plaatstijfheid, automatische nationale bijlage of
  constructieve detaillering. De uitvoer is daarom een controlevoorbeeld
  en geen vrijgave voor constructief ontwerp.
- Tot 600 DOF gebruikt de kern dichte eliminatie. Grotere Q4-, CST-, DKT- en
  hybride plaatmatrices gebruiken nu een ijle symmetrische Jacobi-PCG-oplosser
  met een grens van 20.000 DOF. Vóór PCG controleert sparse LDLᵀ ook de
  volledige vrije stijfheidsinertie. Bij FNL/GNL wordt dit voor iedere nieuwe
  tangent herhaald, zolang de factor binnen twee miljoen opgeslagen waarden
  blijft; bij grotere fill blijft PCG de iteratieve route.
  Een mechanisme loodrecht op de vaste PCG-proeflast is als regressie getest.
  Een Q4-rekproef met 882 DOF en een hybride Navier-plaat met 675 DOF staan in
  de Rust-tests. De ijle oplosser weigert
  asymmetrische matrices en niet-positieve kromming tijdens de iteratie. Bij
  nulbelasting wordt de vrije stijfheid ook met een niet-nul proeflast
  aangesproken, zodat een onbelast mechanisme niet zonder meer als nuloplossing
  slaagt. Bij plaatmodellen waar de sparse factor binnen het geheugenbudget
  past is dit wel een volledige inertiecontrole; bij grotere fill blijft een
  mechanisme buiten de PCG-krommingstoets mogelijk onopgemerkt. De
  2D- en 3D-raamwerken gebruiken sparse LDLᵀ-eliminatie als
  expliciete stabiliteitstoets; een 2D-beddingraam met 603 DOF en een
  3D-axiale keten met 606 DOF zijn getest. De 3D-eigenknik blijft beperkt
  tot 120 vrije en 600 totale DOF. De sparse stabiliteitsfactor heeft een
  expliciete geheugenlimiet van twee miljoen opgeslagen factorwaarden. Sterk
  gevulde sparse factoren en slecht
  geconditioneerde grote raamwerken vragen nog schaal- en prestatietests.
  Een bredere referentieset, betrouwbare stabiliteitsdetectie voor grote
  modellen en 3D-materiaalhistorie zijn nodig voordat de app deze kern als
  standaard kan gebruiken.

De [migratie- en verificatielijst](RUST_SOLVER_ROADMAP.md) volgt de nog open
onderdelen van het doorlopende doel om de volledige solver naar Rust te brengen.

De [plaatvoorbeelden](PLATE_EXAMPLES.md) geven reproduceerbare invoer en
controlecijfers, inclusief de uitkragende plaat uit Cement 2021/8 van Braam
en Blaauwendraad. De [voorspanvoorbeelden](PRESTRESSED_BEAM.md) bevatten een
FHWA-controleberekening en een parabolische kabel.
