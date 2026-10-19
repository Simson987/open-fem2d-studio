# 3D Tet4 testmodellen

De algemene `volume3d`-route leest expliciete `nodes`, `materials`, `elements`,
`loads` en `supports`; zie `examples/volume3d-loaded-tet.json` en
`examples/volume3d-two-materials.json`. Uniforme `bodyForces` in kN/m³ en
`faceTractions` in kN/m² gebruiken consistente Tet4-knooplasten (respectievelijk
`V/4` per knoop en `A/3` per vlaksknoop); zie
`examples/volume3d-distributed-loads.json`. De materialen kunnen per element
verschillen. De route rapporteert per knoop de drie verplaatsingen en reacties,
en per Tet4 zes spanningscomponenten `[xx,yy,zz,xy,yz,zx]` in MPa.
`solverStrategy` kan `automatic`, `matrixFree`, `sparse`, `sparseDirect` of
`frontal` zijn;
`solverUsed` in de uitvoer zegt welke route werkelijk draaide. De
frontale route is direct en heeft een grens van 10.000 DOF en 512 front-DOF;
de CSR-route begrenst de tijdelijke elementassemblage op vier miljoen
bijdragen. `automatic` schakelt alleen bij vastgestelde PCG-nietconvergentie
op een klein model naar frontal. Grote roosters gebruiken de matrixvrije
parallelle route.
Een aanvullende bimateriaal-Tet4-proef in `tests/volume_fallback_validation.rs`
forceert één PCG-iteratie: `automatic` schakelt dan aantoonbaar naar de
frontale route. Reacties, krachten en momenten zijn onafhankelijk uit de
elementspanningen gecontroleerd. Een onderbepaald model wordt door alle vijf
strategieën afgewezen.

`examples/volume3d-j2-steel-coupon.json` is een aparte experimentele
`volume3dJ2`-analyse met zes Tet4-elementen, één J2-staalmateriaal en twee
absolute verplaatsingsdoelen: 0,004 m rekbelasting gevolgd door ontlasten naar
0,0035 m. De kern gebruikt een consistente 6×6-tangent, globale Newton-stappen,
staphalvering en commit van plastische historie na convergentie. De analytische
1D-referentie is `p=(E·0,004−fy)/(E+H)` en de eindspanning
`σ=E·(0,0035−p)`. De uitvoer bevat elementhistorie, reacties, werkelijke vrije
residuen en geaccepteerde stappen. Deze route is begrensd op 1.800 DOF en
3.000 Tet4-elementen; zij omvat geen geometrische nietlineariteit, contact of
betonmodel en is geen gevalideerd ontwerpmodel.

`examples/volume3d-finite-j2-steel-coupon.json` gebruikt dezelfde
zes Tet4-elementen en verplaatsingsdoelen, maar kiest de aparte
`volume3dFiniteJ2`-route met multiplicatieve plastische kinematica en
Hencky-energie. De solver bewaart per Tet4 `Fp` en equivalente plastische rek,
gebruikt de analytische 9×9-materiaaltangent in een 12×12-elementtangent en
committeert historie uitsluitend na convergentie van de globale Newtonstap.
De uitvoer geeft nominale eerste Piola-spanning, reacties en het werkelijke
vrije residu. De onafhankelijke 48-Tet4-affiene proef vergelijkt spanning,
plastische rek en vlakreacties met gesloten Hencky/J2-formules; een niet-affiene
plastische knooplastproef reconstrueert elementkrachten en evenwicht.
De getypeerde toetsbrug-/app-route en live ontwikkelapp lossen de coupon op.
De aparte `volume3dFiniteJ2Coupled`-invoer bevat een `volume`-object met
dezelfde Tet4/J2-invoer en een niet-lege lijst `trusses` met `nodes`,
`youngsMpa` en `areaM2`. Deze elastische 3D-trekstaven delen de knoop-DOF's
en alle Newton-stappen met de plastische volumes. Hun Green-rek-energie levert
een consistente 6×6-tangent en de uitvoer `trussAxialForceKn` is de actuele
trekkracht. Het gewone 3D-project
`docs/verificatie/3d-volume/tet4-eindige-rek-j2-met-trekstaaf.ifcfem2d`
is via de normale knop **Berekenen** door de dev-app doorgerekend. Buigende
frames, plastische membranen en Hex8-koppeling bij eindige rek zijn hiermee
nog niet ondersteund.
Optioneel krijgt een gekoppelde trekstaaf `plasticity` met `yieldMpa` en
`hardeningMpa`. Deze afzonderlijke 1D-staalwet gebruikt logaritmische
axiale rek, een isotrope return map en een consistente geometrische plus
materiële 6×6-tangent. Zij bewaart getekende en geaccumuleerde plastische
logrek per geaccepteerde globale laststap; elastische trekstaven houden hun
bestaande Green-rekwet. De uitvoer bevat `trussStates` en
`trussAlgorithmicModulusMpa`, met `null` op elastische staven. In de gewone
3D-app is deze keuze beschikbaar voor axiale staven bij eindige-rek J2-Tet4-
materiaal-FNL. De ingevoerde verhouding `r=E_t/E` wordt omgezet naar
`H=E·r/(1-r)` en moet voor deze route kleiner zijn dan 1.
Een primaire publicatie over eindige-rek uniaxiale plastische
staafelementen en consistente tangenten is
[Pascon, *Nonlinear analysis of hyperelastoplastic truss-like structures*
(2016)](https://link.springer.com/article/10.1007/s00419-015-1065-9).
De hier gebruikte bilineaire 1D-wet is een afzonderlijke vereenvoudiging;
de exacte kracht- en tangentformules staan in `solid_finite_plastic_truss.rs`
en zijn met onafhankelijke verschillen en coupons gecontroleerd.
`tests/volume_finite_j2_plastic_truss_reference.rs` vergelijkt een
krachtgestuurde één-Tet4-plus-trekstaaf-parallelproef met onafhankelijke
Hencky-spanning, een gesloten 1D-plastische retour en de bissectie-oplossing
na ontlasten. Alle zes lineaire backendkeuzes sluiten op verplaatsing,
trekstaafkracht, geschiedenis en globale balans. Het opgeslagen gewone
3D-project
`docs/verificatie/3d-volume/tet4-eindige-rek-j2-plastische-trekstaaf-membraan.ifcfem2d`
combineert 48 Tet4, acht Tri3-membranen en één plastische trekstaaf met het
absolute lastpad `[1,0]`. De app-routeproef controleert drie backends en
reconstrueert de eindkracht onafhankelijk uit actuele staaflengte en bewaarde
plastische logrek. De proef dekt een afgebakende koppeling; willekeurige
grote gemengde plastische stelsels, buigframes en plaatbuiging blijven open.
Het grotere opgeslagen project
`docs/verificatie/3d-volume/tet4-eindige-rek-j2-3072-volumes-trekstaaf.ifcfem2d`
combineert 3.072 plastische Tet4-elementen, 729 knopen en een trekstaaf op
een vrije binnenknoop. De app-routeproef
`design-mockup/test-frame3d-volume-finite-j2-truss-3072-app-route.mjs`
gebruikt matrixvrije GMRES met vier threads en controleert plastische
geschiedenis, evenwicht en de trekstaafkracht tegen de actuele lengte.
De Rust-releaseproef
`tests/volume_finite_j2_coupled_truss_scale.rs` voert dezelfde koppeling
ook op 34.992 en 257.250 plastische Tet4 uit; beide grotere proeven worden
expliciet in release met `--ignored` uitgevoerd.
Bij de 257.250-elementenproef delen volume en trekstaaf een vrije binnenknoop;
de analytische actuele trekstaafkracht is 83,510508 kN en het vrij residu
1,103·10⁻⁸ kN op vier threads. De grote test is niet onderdeel van de
standaardtest vanwege zijn rekentijd van ongeveer 227 s in release.
Het opgeslagen project
`docs/verificatie/3d-volume/tet4-eindige-rek-j2-trekstaaf-membraan.ifcfem2d`
voegt aan de 48-Tet4/J2-coupon en zijn eindige-rek trekstaaf een Tri3-membraan
toe dat knoop 114 met twee volumeknopen deelt. De Rust-proef
`tests/volume_finite_j2_membrane_reference.rs` vergelijkt de gekoppelde
parallelkracht met onafhankelijke Hencky- en Green-rekformules op zes
backends; de app-routeproef vergelijkt de membraanspanning met een aparte
berekening uit de deformeerde knopen. De devapp berekent dit model via de
gewone knop **Berekenen**. Het membraan heeft geen buigstijfheid of
wrinkling-model.
Een afzonderlijke schaalproef in `tests/volume_finite_j2_membrane_scale.rs`
rekent dezelfde drie elementfamilies op 3.072, 34.992 en 257.250 Tet4;
het grootste model heeft daarnaast 2.450 Tri3-membranen, 139.968 DOF en
een gedeelde vrije trekstaafknoop. De expliciete release-run op vier threads
sloot met 1,060·10⁻⁸ kN vrij residu in 219,88 s. De membraanspanning en
trekstaafkracht zijn uit de deformeerde knoopgeometrie nagerekend.
Deze experimentele route ondersteunt nodale lasten en dode lichaams- en
vlaklasten op de referentiegeometrie, met consistente V₀/4- en A₀/3-
knooplasten. Dichte LU is begrensd op 120 DOF en 200 Tet4-elementen; met
`"options":{"linearBackend":"sparseGmres"}` kiest men optionele CSR-GMRES,
begrensd op 2.400 DOF en 3.600 Tet4, plus expliciete patroon- en
iteratiegrenzen. `"frontalWave"` is een tweede optionele matrixmethode
met dezelfde modelgrens en een maximale frontbreedte van 1.024 DOF.
`"automatic"` begint binnen deze kleine modelgrens met CSR-GMRES en probeert
alleen na een herkende iteratie-/stagnatie- of CSR-opslaglimietfout een
begrensde frontale oplossing. `linearBackendUsed` en `frontalFallbacks`
melden de werkelijk gebruikte methode en herstelpogingen; materiaal-,
geometrie-, mechanisme- en Newtonfouten blijven zichtbaar.
`"matrixFreeGmres"` cachet lokale 12×12-tangenten en voert elementproducten
parallel uit met `matrixFreeThreads` (1–16), zonder globale CSR-/dichte
stijfheidsmatrix. Deze route is begrensd op 24.000 DOF, 36.000 Tet4 en
5.184.000 lokale tangentwaarden. De expliciet uitgevoerde releaseproef met
34.992 plastische Tet4, 20.577 DOF en 14.739 vrije componenten sloot op de
gesloten Hencky/J2-oplossing met 6,953·10⁻⁹ kN vrij residu in 10,02 s op
vier threads. De afzonderlijk te kiezen `"matrixFreeGmresLarge"`-route
vergroot de begrensde capaciteit tot 180.000 DOF en 300.000 Tet4, met een
werkgeheugenraming van maximaal 1,5 GiB. De expliciete releaseproef met
257.250 plastische Tet4, 139.968 DOF en 117.912 vrije componenten sluit op
de gesloten isochore Hencky/J2-oplossing: 5,089·10⁻⁹ kN vrij residu, één
belastingsstap, nul cutbacks en 131,76 s op vier threads. Beide schaalproeven
zijn affiene patches; algemene mesh- en belastingpaden vragen aparte
acceptatieproeven.
Onafhankelijke tests vergelijken de backends bij plastisch
belasten en ontlasten en controleren een plastisch 192-DOF-model boven de
dichte grens. Twee extra onafhankelijke tests controleren verdeelde lasten
tegen handmatig berekende equivalente knooplasten voor beide backends. Een
expliciete releaseproef controleert de affiene plastische Hencky-oplossing
voor 3.072 Tet4, 2.187 DOF en 1.029 vrije componenten. Op het vloeivlak
gebruikt de globale Newtonstap een expliciet eenzijdige tangent. De frontale
route accepteert alleen een symmetrische positieve tangent en weigert een
mechanisme of grotere asymmetrie; numerieke skew onder 10⁻¹³ van de
elementnorm wordt expliciet gemiddeld. Onbekende velden en een niet-bestaande
backend worden afgewezen. Meebewegende vlaklasten, 250.000-elementenmodellen, contact
en ontwerpvalidatie ontbreken.

`examples/volume3d-concrete-damage-coupon.json` gebruikt de experimentele
`volume3dConcreteDamage`-route: een 0,1 m Tet4-kubus met 30 GPa, 3 MPa
treksterkte, 100 N/m breukenergie en een **expliciet opgegeven** scheurbandbreedte
van 0,1 m. Na trek tot de analytische piekrek volgt ontlasten. De schadehistorie
blijft staan; de uitvoer geeft per element ook actuele schadefactor en spanning.
De reacties volgen de uniaxiale exponentiële wet. De beschadigde tak gebruikt
een numerieke materiaal-Jacobiaan. Standaard gebruikt Newton begrensde dichte
LU voor maximaal 180 DOF en 300 Tet4-elementen. Met
`"options":{"linearBackend":"sparseGmres"}` kiest men experimentele
CSR-assemblage en GMRES tot 12.000 DOF en 20.000 elementen, met aanvullende
opslag- en iteratiegrenzen. Een 600-Tet4-trek-/ontlastproef en een onregelmatig
model met gemengde schade zijn onafhankelijk gecontroleerd; dit is geen
bewijs van algemene matrixrang of postpiekstabiliteit. De scheurbandbreedte
wordt niet uit de mesh afgeleid;
algemene 3D mesh-onafhankelijkheid, drukschade en constructieve ontwerpvalidatie
zijn niet aangetoond.

`examples/volume3d-gnl-affine-stretch.json` is een aparte experimentele
`volume3dGnl`-analyse van een 2×2×2-kubus met 48 Tet4-elementen. De
buitenrand krijgt een affiene x-rek van 5%; de drie verplaatsingen van de
binnenknoop blijven vrij. De Green-Lagrange-rek is analytisch
`Exx=(1,05²−1)/2` en de totale nominale kracht op de rechterzijde is
`1,05·(λ+2µ)·Exx·1000 kN`. De test vergelijkt beide waarden en het vrije
residu via de Rust-dispatcher en TypeScript-apptransport. Een tweede Rust-proef
controleert dat een starre rotatie geen rek of reactiekracht oplevert; de
elementtangent wordt numeriek gedifferentieerd. Deze totale-Lagrangiaanse
St Venant–Kirchhoff-route gebruikt standaard dichte Cholesky tot 180 DOF en
300 Tet4-elementen. Met `options.linearBackend` zijn ook `sparseDirect` en
`frontalWave` tot 900 DOF/1.200 Tet4, `automatic` met opslaglimietherstel,
en de experimentele `sparseGmres` tot 2.400 DOF/3.600 Tet4 beschikbaar.
Voor GMRES zijn `gmresRestart`, `gmresMaxIterations` en
`gmresRelativeTolerance` instelbaar. Een niet-affiene 1.440-Tet4-proef met
heterogene E, ν en β, lichaams- en vlaklasten controleert de uitkomst
onafhankelijk; de 2.880-Tet4-releaseproef is een aparte schaalcontrole.
Een klein lineair GMRES-residu bewijst geen volledige matrixrang of positieve
tangent. De route is niet geschikt als algemene staal- of betonontwerpwet. Materiaal-FNL,
grote rotaties met instabiliteit, knikken en postkritische paden ontbreken.
De uitvoer bevat per Tet4 ook de eerste Piola-spanningstensor `P` in MPa;
`Pxx` volgt in de affiene proef de onafhankelijke nominale spanning.

De afzonderlijke `volumeHex8`-route gebruikt 8-knoops hexaëders met
2×2×2-Gauss-integratie en levert acht spanningsvectoren per element.
Ook deze route verwerkt uniforme `bodyForces` in kN/m³ en `faceTractions`
in kN/m² via consistente Gauss-integratie. `faceNodes` zijn vier lokale
Hex8-knoopnummers in uitwendige cyclische volgorde; voor de +x-zijde van de
gedocumenteerde knoopvolgorde is dat `[1,2,6,5]`.
`examples/volume-hex8-distributed-loads.json` heeft analytisch 8 kN
lichaamskracht en 4 kN vlaklast op een ingeklemde eenheidskubus: de
reacties zijn −1 kN per knoop plus −1 kN op elk +x-vlakknooppunt.
`examples/volume-hex8-uniaxial.json` belast een kubus met 210.000 kN langs
de x-as; analytisch is `σxx=210 MPa`, `ux(x=1)=0,001 m` en de totale
linkerreactie `−210.000 kN`. De getypeerde CSR-route begrenst tijdelijke
assemblage op vier miljoen bijdragen, ongeveer 6.944 Hex8-elementen. Een
aparte matrixvrije route rekent grote regelmatige Hex8-roosters met
Jacobi-PCG. Met `structuredGridCells: [nx,ny,nz]` kiest dezelfde getypeerde
`volumeHex8`-route die backend expliciet. Zij vereist exact de gegenereerde
rechthoekige roostercoördinaten vanaf de oorsprong en elementvolgorde. Elk
element kiest een materiaal uit de lijst met maximaal 4.096 isotrope
E/ν-materialen; de geometrie blijft voor alle elementen een regelmatig blok.
Een mismatch wordt afgewezen. Knoop-, lichaams- en vlaklasten en opgelegde
verplaatsingen gaan door dezelfde validatie. Zonder opt-in blijft CSR actief;
willekeurige Hex8-geometrie schaalt daarmee nog niet tot 250k elementen.
Met `linearBackend: "frontalWave"` kiest dezelfde route een elementgewijze
directe frontale oplossing zonder globale CSR-assemblage. Zij accepteert
maximaal 2.500 elementen, 6.000 DOF en 256 actieve front-DOF en kan niet met
`structuredGridCells` worden gecombineerd. Affiene en heterogene
tweemateriaalproeven vergelijken verplaatsingen, reacties en spanningen met
CSR; mechanismen en overschrijding van de grenzen geven een fout terug.
Een onafhankelijke rechthoekige `[2,3,4]`-m patchproef staat in
`scripts/verification/benchmark_hex8_rectangular.sh`. Met 250.047 Hex8,
786.432 DOF en vier threads gaf de release-kern 1.808 PCG-iteraties,
een werkelijk relatief residu van 9,897·10⁻¹⁰, maximaal 2,505·10⁻¹² m
verplaatsingsafwijking, maximaal 4,465·10⁻⁷ MPa afwijking over alle
Gauss-spanningen en 360.000 kN analytische trekkracht tegenover
359.999,999996 kN reactie. De meting duurde 145,18 s en gebruikte maximaal
246.760 KiB RSS op deze machine. Dit valideert deze regelmatige uniforme
materiaalpatch, niet willekeurige grote Hex8-modellen. Een afzonderlijke
2×2×1-patch met twee E/ν-materialen vergelijkt de matrixvrije route met CSR
voor alle verplaatsingen, reacties en Gauss-puntspanningen. Twee runs met
vier threads leveren identieke resultaten. Een tweede reproduceerbare proef
staat in `scripts/verification/benchmark_hex8_multimaterial.sh`: 250.047 Hex8,
786.432 DOF, afwisselende x-lagen met E=30/24 GPa en ν=0,25 en een vlaklast
van 1 MPa over 12 m². Op vier threads: 1.811 PCG-iteraties, 103,25 s,
onafhankelijk nagemeten vrij residu 9,533·10⁻¹⁰, krachten- en
momentenevenwicht beter dan 1,7·10⁻¹¹ en linkerreactie
−11.999,999999814 kN tegenover 12.000 kN aangebrachte trekkracht. Eén
thread gebruikt 175,56 s met dezelfde 1.811 iteraties; de maximale
verplaatsingsafwijking tussen beide runs is 1,015·10⁻¹⁶ m. Piekgeheugen:
142.860 KiB. Deze proef valideert een regelmatig lineair tweemateriaalrooster,
geen willekeurige grote geometrie of niet-lineaire materiaalgrens.

De lineaire isotrope zwakke vorm volgt de
[MFEM ElasticityIntegrator-documentatie](https://docs.mfem.org/4.8/bilininteg__elasticity__kernels_8hpp.html).
De fixturebestanden `examples/volume3d-patch-162.json`,
`examples/volume3d-patch-10k.json`, `examples/volume3d-patch-250k.json` en
`examples/volume3d-patch-2m.json` genereren respectievelijk 162, 10.368,
257.250 en 2.058.000 lineaire tetraëders.
De grote proef heeft 46.656 knopen en 139.968
translatievrijheidsgraden, waarvan 117.912 vrij zijn. Vier threads voeren
elementacties uit met gescheiden accumulatiebuffers; de reductie naar één
resultaatvector verloopt in vaste volgorde.

De gestructureerde Tet4-benchmarks zijn exacte affiene 3D-patches. Op alle buitenrandknopen
wordt `ux=0,0001 x`, `uy=-ν 0,0001 y` en `uz=-ν 0,0001 z` opgelegd. De
binnenknopen zijn vrij en er werken geen uitwendige knooplasten. De analytische
spanning is `σxx=E·0,0001`; de totale reactiekracht op het vlak `x=1` is
bij `E=210.000 MPa` precies `21.000 kN`. De uitvoer geeft een werkelijk
nagerekend residu, de maximale verplaatsingsfout en beide trekkrachten.

Uitvoeren vanuit `src-tauri`:

```sh
cargo test --locked -p openaec-native-fem volume3d --lib
cargo build --locked -p openaec-native-fem --bin native-volume3d
cargo build --locked -p openaec-native-fem --bin native-volume3d-j2
cargo build --locked -p openaec-native-fem --bin native-volume3d-concrete-damage
cargo build --locked -p openaec-native-fem --bin native-volume3d-gnl
cargo build --locked -p openaec-native-fem --bin native-volume-hex8
cargo build --locked --release -p openaec-native-fem --bin native-volume3d-benchmark
cargo build --locked --release -p openaec-native-fem --bin native-hex8-benchmark
target/debug/native-volume3d < crates/native-fem/examples/volume3d-loaded-tet.json
target/debug/native-volume3d < crates/native-fem/examples/volume3d-two-materials.json
target/debug/native-volume3d < crates/native-fem/examples/volume3d-distributed-loads.json
python3 -c 'import json; print(json.dumps(json.load(open("crates/native-fem/examples/volume3d-j2-steel-coupon.json"))["input"]))' | target/debug/native-volume3d-j2
python3 -c 'import json; print(json.dumps(json.load(open("crates/native-fem/examples/volume3d-concrete-damage-coupon.json"))["input"]))' | target/debug/native-volume3d-concrete-damage
target/debug/native-volume-hex8 < crates/native-fem/examples/volume-hex8-uniaxial.json
target/debug/native-volume-hex8 < crates/native-fem/examples/volume-hex8-distributed-loads.json
target/release/native-volume3d-benchmark < crates/native-fem/examples/volume3d-patch-162.json
target/release/native-volume3d-benchmark < crates/native-fem/examples/volume3d-patch-10k.json
target/release/native-volume3d-benchmark < crates/native-fem/examples/volume3d-patch-250k.json
target/release/native-volume3d-benchmark < crates/native-fem/examples/volume3d-patch-2m.json
target/release/native-hex8-benchmark crates/native-fem/examples/hex8-250k.json
target/release/native-hex8-benchmark --typed crates/native-fem/examples/hex8-250k.json
```

Op 5 oktober 2026 rekende de 250k-proef na toevoeging van per-elementmateriaal
op 4 threads in ongeveer 1,9 s met circa 62 MiB piek-RSS, 197 PCG-iteraties
en een residu van 8,7·10⁻⁹.
Op één thread was dit ongeveer 2,5 s en 56 MiB.

De 2M-elementenpatch omvat 357.911 knopen en 1.073.733 DOF; die proef nam
23,3 s en 481 MiB piek-RSS op vier threads en bereikte een werkelijk residu
van 9,23·10⁻⁸ bij een ingestelde tolerantie van 10⁻⁷. De berekende
trekkracht was 21.000,022 kN tegenover analytisch 21.000 kN.

De regelmatige Hex8-patch van 63³ = 250.047 elementen omvat 262.144 knopen en
786.432 DOF. Op 5 oktober 2026 bereikte de release-binary met vier threads
1.504 PCG-iteraties, een werkelijk relatief residu van 9,68·10⁻¹⁰ en een
maximale afwijking van de affiene verplaatsing van 4,78·10⁻¹³ m. De berekende
trekkracht en tegengestelde reactie waren +30.000,0000000 en
−30.000,0000029 kN. Walltime was 97,73 s en piek-RSS 123.620 KiB, gemeten
met `/usr/bin/time` op de reeds gebouwde binary.

De getypeerde `volumeHex8`-opt-in rekende hetzelfde 250.047-elementenmodel
via `solve_hex8_volume` op vier threads door: 1.504 iteraties, werkelijk
residu 9,68·10⁻¹⁰, maximale verplaatsingsfout 4,78·10⁻¹³ m en maximale
Gauss-puntspanningsfout 2,02·10⁻⁷ MPa over 2.000.376 punten. De gemeten
solvertijd was 101,93 s en piek-RSS 243.176 KiB; de spanningsuitvoer kost
extra geheugen. De benchmarkgenerator omzeilt een gigantische JSON-overdracht.

De optionele releaseproef `volume_hex8_250k_cavity_validation` rekent
260.416 Hex8-elementen rondom een gesloten 3D-holte door met vier threads.
Dit vervormde net heeft 273.294 herschikte knopen en 819.882 DOF. De
oplossing duurde 38,349 s bij 182 iteraties, werkelijk relatief residu
9,891·10⁻⁸ en 1.258.028 KiB piek-RSS. Een onafhankelijke affiene oplossing
geeft maximaal 1,313·10⁻⁹ m verplaatsingsfout en 5,772·10⁻⁴ MPa
Gauss-spanningsfout. Afzonderlijke 2×2-integratie van de analytische
oppervlaktetractie op alle buiten- en holtevlakken geeft per randknoop
maximaal 2,023·10⁻⁴ kN reactiefout. De proef draait expliciet met:

```bash
cargo test --release -p openaec-native-fem --test volume_hex8_250k_cavity_validation -- --ignored --nocapture
```

De holte is uit een gestructureerd voxelnet gesneden; ongestructureerde
connectiviteit en algemene belastingspaden zijn hiermee nog niet gevalideerd.

## Eindige-rek gemengde krachtproef

`tests/volume_finite_j2_mixed_force_path.rs` klemt de buitenrand van een
2×2×2-Tet4-kubus en koppelt aan de vrije binnenknoop acht Tri3-membranen en
een elastische trekstaaf. Een krachtstap van 500.000/−250.000/150.000 kN
plastificeert het volume; de tweede stap ontlast volledig. De ontlaste
binnenknoop houdt 0,952887/0,107392/0,566961 mm verplaatsing over en de
grootste equivalente plastische rek is 0,00338633. Dicht, sparse GMRES,
frontaal, beide matrixvrije varianten en automatisch komen overeen binnen
10⁻⁷ m en 10⁻⁷ plastische rek. De proef herbouwt de trekstaafkracht uit de
vervormde eindpunten en controleert de reactiekrachtsom. Zij bewijst nog geen
algemene stabiliteit voor willekeurige grote krachtgestuurde modellen.
Hetzelfde invoermodel staat als
`docs/verificatie/3d-volume/tet4-eindige-rek-j2-kracht-ontlasten-membraan.ifcfem2d`
in het gewone 3D-projectformaat; de app-route controleert automatisch,
frontaal en groot matrixvrij tegen de ontlaste Rust-referentie en rekent
trekstaafkracht en membraan-PK2-spanning opnieuw uit de gerapporteerde
vervormde knopen. In de ontwikkelapp geeft **Berekenen** voor dit project
1,114 mm maximale resterende verplaatsing en 257,21 MPa maximale
von-Mises-spanning op de 48 volumes.

Het opgeslagen
`docs/verificatie/3d-volume/tet4-eindige-rek-j2-3072-volumes-plastische-trekstaaf.ifcfem2d`
houdt dezelfde 3.072-Tet4-geometrie en het piek-/ontlastpad van de elastische
trekstaafproef, maar geeft de axiale staaf een bilineaire logrek-plasticiteitswet
met 100 MPa vloeigrens en 1% tangentiële verhardingsverhouding. De app-route
controleert dat de vier-thread matrixvrije oplossing de materiaalgeschiedenis
teruggeeft en dat `N = 1000 A L₀ E (ln(l/L₀) − εp)/l` uit actuele lengte en
gerapporteerde plastische rek 201,586 kN oplevert. De browser-devapp rekent
het project door en toont 0,001346 equivalente plastische staafrek. De
Rust-integratietest controleert ook een onafhankelijke 1D-retourmap en
algoritmische tangent op 3.072 Tet4; de expliciete releaseproef met 34.992
Tet4 en dezelfde koppeling slaagt op vier threads:

```bash
cd src-tauri
cargo test --release -p openaec-native-fem \
  --test volume_finite_j2_plastic_truss_scale \
  plastic_truss_with_34992_j2_tets_four_threads -- --ignored --exact
```

Voor een kleine gemengde FNL-referentie gebruikt
`docs/verificatie/3d-volume/tet4-eindige-rek-j2-plastische-trekstaaf-en-membraan.ifcfem2d`
48 J2-Tet4, een plastische trekstaaf en acht Tri3-membranen; één Tri3 heeft een
bilineaire staalwet. Het project bevat piekbelasting en ontlasting. De
app-routetest `test-frame3d-volume-finite-j2-plastic-membrane-app-route.mjs`
controleert drie oplosmethoden, evenwicht en de blijvende plastische historie.
De Tri3 levert alleen membraanwerking, geen buiging of dwarskracht.
Een aparte releaseproef met 3.072 Tet4 en 128 plastische Tri3 in een
binnenvlak deelt vrije knopen en gebruikt matrixvrije GMRES met vier threads:

```bash
cd src-tauri
cargo test --release -p openaec-native-fem \
  --test volume_finite_j2_plastic_membrane_scale -- --nocapture
```

Het vrije residu was 1,141·10⁻⁸ kN; de plastische membraanhistorie en de uit
de actuele driehoeksgeometrie herbouwde membraankracht zijn gecontroleerd.

Deze cijfers zijn metingen op één machine, geen schaalgarantie. De grote
Tet4-route gebruikt een Jacobi-preconditioner; slecht geconditioneerde of bijna
onsamendrukbare modellen kunnen veel trager convergeren of de iteratielimiet
raken. De grote benchmarks gebruiken één elastisch materiaal; de getypeerde
Tet4- en gestructureerde Hex8-routes ondersteunen ook meerdere E/ν-materialen.
De getypeerde Tet4-route biedt bovendien belastingen,
spanningsuitvoer, directe sparse LDLᵀ en frontale wavefront-oplossing voor
kleine modellen. Een aparte begrensde J2-staal-Tet4-route dekt kleine-rek
materiaalnietlineariteit in validatieproeven. Een nog kleinere betontrekschade-
Tet4-route heeft een expliciete scheurbandbreedte; geometrische
nietlineariteit, algemeen betongedrag en gevalideerde 3D-scheurbandregularisatie
blijven open.

## Niet-affiene J2-volumeproef

De test `volume_j2_nonaffine_reference` klemt het linker vlak van een
Tet4-kubus in en belast het rechter vlak met 60.000 kN/m² schuiftractie.
Hij integreert de driehoeklasten en bouwt de interne knoopkrachten opnieuw
op uit de gerapporteerde elementspanningen en onafhankelijk berekende
Tet4-gradiënten. De kleine 384-elementenproef draait standaard. De grote
proef is expliciet op te roepen:

```bash
cd src-tauri
cargo test --release --locked -p openaec-native-fem \
  --test volume_j2_nonaffine_reference \
  end_shear_257k_tet4_release_benchmark_has_independent_balance \
  -- --ignored --nocapture
```

Met vier PCG-threads rekende de grote proef 257.250 Tet4-elementen en
139.968 DOF in 138,44 s: 113.330 elementen plastificeren, 143.920 blijven
elastisch. De vrije-knoopkrachtfout uit de onafhankelijke reconstructie was
maximaal 1,18·10⁻¹⁰ kN. Deze acceptatieproef controleert evenwicht en
materiaalspreiding voor één buig-/schuifgeval; zij levert geen exact
onafhankelijk verplaatsingsveld voor willekeurige 3D-modellen.
