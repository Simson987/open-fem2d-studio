# Groot verbonden 3D-raamwerk met gedeeld Hex8-element

`scripts/verification/generate_connected_frame_hex8_project.py` maakt zeven
opgeslagen app-projecten met hetzelfde 4×4×128-rooster. Deze bevatten
2.048 knopen en 5.104 volledige 3D-raamwerkstaven met axiale, buig- en
torsiestijfheid. Het eerste project heeft één Hex8-element in het eerste
rooster-vak; het tweede vult alle 1.143 vakken met Hex8-elementen. Elk
Hex8 deelt zijn knopen met de staven en naburige volumes. Alle zestien
knopen van het eerste station zijn
translatoir en rotatief vast. Op de verre hoekknoop werken een kracht van
(1, 0, −10) kN en een moment van (0, 1, 0) kNm. Eigen gewicht staat uit.

De app kiest expliciet `matrixFreePcg` met vier threads. De
acceptatieproef `design-mockup/accept-connected-frame-hex8-5104-app-route.mjs`
laadt het project via de gewone projectdeserialisatie, gebruikt de normale
`solveFrame3D`-adapter en roept de echte `native-mixed3d`-binary aan. Zij
controleert de getypeerde invoer, 2.048 knoopresultaten, 5.104
staafeindkrachtresultaten, alle Hex8-spanningen, het vrije residu en de
globale kracht- en momentbalans. De grote variant wordt met
`FEM_FULL_VOLUME_GRID=1` gekozen.

| Variant | Hex8 | Verticale tipverplaatsing | Vrij residu |
| --- | ---: | ---: | ---: |
| Eén gedeeld volume | 1 | −0,161833 mm | 7,411×10⁻¹⁰ |
| Volledig gevuld rooster | 1.143 | −0,121989 mm | 9,702×10⁻¹⁰ |

De release-app-route van de grote variant duurde lokaal 6,62 s, waarvan
6,41 s in Rust. Dit is een machinegebonden meting, geen prestatiegarantie.

Beide projecten zijn daarnaast in de ontwikkelapp geopend en met
**Berekenen** opgelost. Bij de grote variant toont de 3D-viewer 2.048
knopen, 5.104 staven en 1.143 volume-elementen. De resultatenweergave
meldt `matrixFreePcg`, 0,122 mm maximale verplaatsing en circa 0,012 MPa
maximale von-Mises-spanning. De app meldt ook dat staal- en betontoetsing
voor volume-elementen nog niet beschikbaar is.

## Buiging en torsie door de grote eindige-rek J2-route

`hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-buiging.ifcfem2d`
gebruikt exact dezelfde knopen, 5.104 volledige 3D-staven, 1.143 Hex8,
opleggingen en hoeklast als de grote lineaire variant. Ieder Hex8 krijgt
nu eindige-rek J2-staal (`Y=235 MPa`, `H=300 MPa`). De vloeigrens wordt bij
deze kleine belasting niet bereikt. Zo vergelijken we een niet-affiene
buig- en torsietoestand met de onafhankelijke lineaire `mixed3d`-route in
de kleine-verplaatsingslimiet.

`design-mockup/accept-connected-frame-hex8-j2-bending-app-route.mjs` laadt
beide opgeslagen projecten via de gewone app-deserialisatie. Het roept de
lineaire `native-mixed3d` en de eindige-rek `toetsbrug` via de getypeerde
app-adapter aan. Over alle 2.048 knopen is het grootste verschil
`1,198·10⁻¹⁰ m` voor translatie en `3,069·10⁻¹² rad` voor rotatie.
Over alle 1.143 Hex8 is het grootste spanningsverschil
`5,691·10⁻⁷ MPa`; alle plastische rekken blijven nul. De maximale
afwijking over de 5.104 staafeindacties is `3,310·10⁻⁴ kN of kNm`.
De eindverplaatsing is `uz=−0,121989 mm`. Beide routes sluiten het
kracht- en momentevenwicht en hebben een relatief residu onder `10⁻⁸`.
De lokale releaserun duurde 5,29 s voor lineair en 18,38 s voor eindige
rek; `automatic` koos daar `frontalWave`. Het opgeslagen J2-project is ook
in de ontwikkelapp geopend en via **Berekenen** opgelost. De viewer toont
2.048 knopen, 5.104 staven, 1.143 volumes, `frontalWave` en
`umax=0,1223 mm`.

Dit toetst het grote gedeelde Newtonstelsel onder echte buig- en
momentbelasting. De staven behouden hun elastische referentie-aswet; hun
eigen tweede-orde- of materiaalnietlineariteit is hiermee niet bewezen.

De optionele `FEM_GEOMETRIC_FRAMES=1`-variant van dezelfde acceptatieproef
zet nu `geometricFrames` aan voor alle 5.104 staven. Het grote model blijft
in de kleine-vervormingslimiet: maximaal `2,768·10⁻¹⁰ m` verschil in
translatie, `1,526·10⁻¹² rad` in rotatie en `3,296·10⁻⁸ MPa` in
Hex8-spanning tegenover de lineaire app-route. De staafacties verschillen
maximaal `4,396·10⁻⁵ kN of kNm`; plastische rek blijft nul. De route sluit
het evenwicht, kiest `frontalWave` en duurde lokaal 25,38 s. Deze proef toont
de grote gekoppelde route. De aparte
`design-mockup/accept-frame-volume-second-order-app-route.mjs` vergelijkt
een drukbelaste gekoppelde staaf op Tet4/Hex8 met een onafhankelijke
staafkolomformule: `5,267360·10⁻⁵ m` berekend tegen
`5,268134·10⁻⁵ m` analytisch. Het gebruikte staafmodel is von Karman op
een vaste referentie-as en blijft elastisch; grote rotaties en
staafplastificatie zijn nog open.

Dezelfde gekoppelde GNL/FNL-app-route accepteert nu ook een lokale
staafpuntlast. De adapter zet die met de kubische Hermite-vormfuncties om
naar consistente knoopkrachten en -momenten, bewaart de werkelijke
eindkrachten bij de resultaatweergave en past lastgevalfactoren toe.
Op de gedeelde Tet4/Hex8-wortel controleren afzonderlijke punt- en
uniforme lijnlasten de relatieve uitkragingsdoorbuiging tegen
`P·a²(3L−a)/(6EI)` en `qL⁴/(8EI)`, het wortelmoment tegen
`P·a` en `qL²/2`, plus het globale evenwicht. De gekoppelde
drie-backend-staafkolomproef gebruikt expliciet Newton-tolerantie `10⁻⁸`;
bij de standaard `10⁻⁹` liep deze specifieke belasting in de eerste
doelstap op een `1,416·10⁻⁹ kN` line-search-residu vast.

Met daarnaast `250 kN` axiale druk en aftrek van de druk-alleenrespons
geeft een onafhankelijke constante-`EI`-staafkolomoplossing voor de
middenpuntlast `1,633453·10⁻⁵ m` tipverplaatsing tegenover
`1,640370·10⁻⁵ m` in de gekoppelde kern (0,42% verschil). Voor de
uniforme lijnlast is dat `1,967942·10⁻⁵ m` tegenover
`1,971474·10⁻⁵ m` (0,18%). Beide overtreffen de eerste-orde
doorbuiging met meer dan 5%, en hun globale evenwicht sluit. Deze
controle geldt voor kleine rotaties bij stabiele druk; grootrotaties,
volglasten en bijna-instabiliteit blijven open.

`tet4-hex8-j2-raamwerk-punt-en-lijnlast.ifcfem2d` bewaart dezelfde
gekoppelde proef met beide staaflasten tegelijk en de expliciete
`10⁻⁸`-tolerantie. Het bestand kan als 3D-project in de app worden geopend.
De app-route vindt na aftrek van de druk-alleenrespons
`3,611844·10⁻⁵ m`; superpositie van de twee onafhankelijke
staafkolomreferenties geeft `3,601395·10⁻⁵ m` (0,29% verschil).
De generator staat in
`scripts/verification/generate_coupled_frame_member_load_project.mjs`.
Een extra ontlastproef met alleen deze staaflasten gebruikt het pad
`[1,0]`. De eindequivalente lasten worden nu met de **laatste**
lastfactor van de werkelijk berekende stap gecorrigeerd: bij nul
eindlast zijn alle twaalf gerapporteerde staafeindacties binnen
`10⁻⁶ kN/kNm` nul. Vóór deze correctie verscheen ondanks nul
eindlast een kunstmatige worteldwarskracht van `0,1 kN`.
Het pad `[1,0,5]` geeft in hetzelfde elastische geval dezelfde
eindacties als een rechtstreekse `[0,5]`-stap binnen
`10⁻⁶ kN/kNm`. Dit controleert de resultaatweergave van een
gekoppeld GNL/FNL-lastpad met zowel punt- als lijnlasten.

## Tweede-orde lastreeks op 5.104 staven met één gedeeld Hex8

`hex8-verbonden-raamwerk-5104-staven-gnl-j2-druk.ifcfem2d` slaat een
afzonderlijk app-project op met 2.048 knopen, 5.104 volledige 3D-staven,
één J2-Hex8 aan de wortel en vier laststappen. De 5.000 kN druk en 10 kN
dwarskracht zijn elk gelijkmatig over de zestien eindknopen verdeeld.
`scripts/verification/generate_large_second_order_frame_project.mjs`
maakt dit bestand reproduceerbaar.

`design-mockup/accept-large-frame-second-order-series.mjs` berekent vijf
gevallen via de gewone 3D-app-adapter: druk met/zonder dwarskracht, alleen
dwarskracht en trek met/zonder dwarskracht. Alle vijf gebruiken
`frontalWave`, sluiten het kracht- en momentevenwicht en hebben een vrij
relatief residu onder `5·10⁻¹²`. Omdat het ene Hex8 slechts een deel van
de wortel lokaal verstijft, veroorzaakt axiale last op zichzelf al een
kleine dwarsverplaatsing. Na aftrek van die bijdrage is de extra
dwarskrachtverplaatsing `0,15888 mm` bij druk, `0,15841 mm` zonder
axiale last en `0,15794 mm` bij trek. De richting van de tweede-orde
versterking is daarmee op de grote topologie aangetoond; de grootte is
hier slechts circa 0,3%. Een onafhankelijke gesloten oplossing voor deze
ruimtelijke roostertopologie is niet beschikbaar.

## Niet-affiene plastische Hex8 op het volledige rooster

`scripts/verification/generate_connected_frame_hex8_nonaffine_plastic_project.mjs`
maakt een opgeslagen belastingsproject
`hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-plastische-buiging.ifcfem2d`
en een project met het lastpad `[1,0]`:
`hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-plastische-buiging-ontlast.ifcfem2d`.
Beide bewaren dezelfde 2.048 knopen, 5.104 buigende/torderende staven,
1.143 Hex8, randvoorwaarden en excentrische hoeklast als de hierboven
onafhankelijk vergeleken elastische buigproef. Ieder Hex8 krijgt bewust
een lage numerieke J2-vloeigrens `Y=0,001 MPa` en lineaire verharding
`H=3.000 MPa`; dit zijn **geen ontwerpwaarden voor constructiestaal**.
De eindige-rek-volumes en tweede-orde elastische staven worden samen in
één Newtonstelsel opgelost. De opgeslagen projectkeuze leidt via de gewone
3D-app-adapter naar `combined` en `geometricFrames=true`.

`design-mockup/accept-connected-frame-hex8-nonaffine-plastic-app-route.mjs`
controleert de projectinvoer, alle resultaatlengten, het vrije residu,
kracht- en momentevenwicht en per volume de J2-grens. Van de 1.143 Hex8
hebben 1.090 plastische rek (`p_max=3,079·10⁻⁷`). Voor de gemeten
Gauss-puntgemiddelde spanning geldt `q(σ̄)≤Y+H·p_max` binnen
`10⁻⁶ MPa`; dit volgt uit convexiteit van de von-Mises-norm en de
lineaire verharding en is een onafhankelijke constitutieve controle.
De eindknoop heeft `uz=−0,137028 mm`, 12,3% meer dan de afzonderlijk
gevalideerde elastische `−0,121989 mm`. `frontalWave` levert een vrij
relatief residu van `3,325·10⁻¹⁰`, en de releaserun duurt lokaal
22,41 s.

Met `FEM_PLASTIC_UNLOAD=1` laadt dezelfde app-route het afzonderlijke
ontlastproject. De tweede doelstap heeft exact nul externe knooplasten.
Na ontlasting blijven 1.090 Hex8 plastisch, met
`p_max=5,315·10⁻⁷` en `uz=−0,005520 mm` restverplaatsing. Het vrije
residu bedraagt dan `1,336·10⁻⁸ kN`, onder de absolute
app-evenwichtsgrens `10⁻⁷ kN`; kracht- en momentevenwicht sluiten.
De releaserun duurde lokaal 42,04 s. Beide opgeslagen bestanden slagen
voor projectopslag/herladen; de verificatiesuite bevat nu 54 projecten.

Dit toont niet-affiene plastische volumevelden op een groot gedeeld
raamwerk, maar geen fysisch realistische staalvloei, plastische staven,
grote objectieve staafrotaties of onafhankelijk gesloten oplossing voor
de volledige ruimtelijke topologie. De acceptatieproef laat een begrensde
materiaal- en lastpadvariatie toe met `FEM_VOLUME_COUNT`,
`FEM_HARDENING_MPA` en `FEM_LOAD_STEPS`. Bij `H=300 MPa` en vier
stappen slagen 128 Hex8 in 33,92 s (`1,226·10⁻¹⁰` vrij residu); alle
1.143 Hex8 slagen met één stap in 23,51 s (`3,226·10⁻¹⁰` residu).
Bij de projecttolerantie `10⁻⁸` leverden twee en vier stappen op het
volledige rooster binnen respectievelijk 120 en 180 s geen einduitkomst op;
een eerdere vierstapsrun werd na acht minuten afgebroken. Een begrensde
diagnose met acht Newton-iteraties en twee cutbacks bereikte bij de eerste
halflast een klein maar nog te groot vrij residu (`7,941·10⁻⁸ kN`).
Met expliciete projecttolerantie `10⁻⁷` slagen op hetzelfde volledige rooster
twee stappen in 34,22 s en vier stappen in 55,16 s. Beide leveren
1.090 plastische Hex8, `p_max=3,341·10⁻⁷` en respectievelijk
`uz=−0,138319 mm` en `−0,138318 mm`; het uiteindelijke vrije residu is
`3,637·10⁻¹⁰` respectievelijk `4,201·10⁻¹⁰`. De expliciete tolerantie
geldt voor de tussentijdse Newton-stappen; de eindresiduen zijn veel kleiner.
Het standaardproject en de standaardoplosinstelling blijven op `10⁻⁸`.
Het aanvullende opgeslagen vierstapsproject
`hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-plastische-buiging-4-stappen.ifcfem2d`
legt `H=300 MPa`, het pad `[0,25; 0,5; 0,75; 1]` en `10⁻⁷` vast.
`FEM_PLASTIC_SOFT_FOUR_STEPS=1` laat de app-route deze opgeslagen invoer
zonder wijziging doorrekenen. Dit is een gevalideerde specifieke instelling,
geen algemene convergentiegarantie bij zachtere materialen of andere modellen.

Een vierde opgeslagen variant
`hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-punt-en-lijnlast.ifcfem2d`
voegt op de laatste langsstaaf een middenpuntlast van `−1 kN` en een
uniforme lokale lijnlast van `−1 kN/m` toe. Met
`FEM_PLASTIC_MEMBER_LOADS=1` laadt de app-route dit project ongewijzigd:
1.100 Hex8 zijn plastisch (`p_max=3,494·10⁻⁷`), de eindknoop verplaatst
`uz=−0,154229 mm` tegenover `−0,137028 mm` zonder deze staaflasten,
en het vrije residu is `2,989·10⁻¹⁰`. Kracht- en momentevenwicht en de
J2-grens sluiten; `frontalWave` duurde lokaal 24,99 s. Dit toetst de
staaflastadapter op het grote niet-affiene gedeelde stelsel, zonder
gesloten oplossing voor alle ruimtelijke veldwaarden te claimen.

## Analytische axiale patch op dezelfde grote topologie

`hex8-raamwerk-1143-volumes-5104-staven-axiaal-patch.ifcfem2d` gebruikt
dezelfde knopen, 1.143 Hex8 en 5.104 staven. Alle dwarse translatie- en
rotatievrijheidsgraden zijn vastgezet; de zestien wortelknopen zijn ook
axiaal vast. De zestien eindknoopkrachten verdelen samen 100 kN volgens
de exacte Hex8-tributaire eindvlakken en de axiale stijfheid van de zestien
langsliggers. Zo is `ux(x)=εx` op ieder knooppunt een gesloten oplossing.

Voor het zijdelings verhinderde isotrope volume geldt
`M=E(1−ν)/((1+ν)(1−2ν)) = 33.333,333 MPa`. Het volume-oppervlak is 9 m²;
de zestien staven hebben elk `A=0,16 m²` en `E=210.000 MPa`. Uit de
parallelle axiale stijfheid volgt `ε=1,193887297×10⁻⁷` en bij
`L=31,75 m` een eindverplaatsing van `0,003790592 mm`. De verwachte
volumestress is `σxx=0,003979624 MPa` en
`σyy=σzz=0,000994906 MPa`; elke langsligger draagt `4,011461 kN`.

Dezelfde app-routeproef, gestart met `FEM_ANALYTIC_PATCH=1`, vergelijkt
alle 2.048 knoopverplaatsingen, 1.143 Hex8-spanningsrecords en 5.104
staafeindkrachten met deze onafhankelijk afgeleide waarden. De grootste
afwijkingen zijn respectievelijk `2,777×10⁻¹⁷ m` en
`9,302×10⁻¹³ MPa`; het vrije residu is `9,069×10⁻¹⁰` en het globale
evenwicht sluit. De ontwikkelapp heeft ook dit bestand via **Berekenen**
opgelost en toont `umax=0,003791 mm` met `matrixFreePcg`.

## Grote eindige-rek J2-route in het elastische gebied

`hex8-raamwerk-1143-volumes-5104-staven-j2-elastische-patch.ifcfem2d`
gebruikt dezelfde axiale patch met een eindige-rek J2-wet op ieder Hex8.
De vloeigrens van 235 MPa blijft ver boven de berekende deviatorspanning;
deze proef toetst dus de gekoppelde niet-lineaire **oplosroute in haar
elastische limiet**, niet de plasticiteitsrespons. De 5.104 volledige
3D-staven blijven elastisch binnen hetzelfde Newton-stelsel.

De eerste expliciete `matrixFreeGmresLarge`-run liep op dit model na 3.000
GMRES-iteraties en dertien laststapverkleiningen vast. Ook de frontale
route met de standaard Newton-tolerantie `1e-9` bleef vlak boven die
grens steken. De app biedt nu een gevalideerde, opgeslagen
`volumeResidualTolerance`-keuze van `1e-12` tot `1e-4`; dit project
gebruikt `1e-8` en `automatic`, dat bij deze omvang de frontale backend
kiest. De Rust-kern laat een groter
frontaal model alleen toe wanneer de conservatieve opslagraming onder
256 MiB blijft. Voor de gemengde topologie worden Hex8- en staafmatrices
in knoopvolgorde gevoerd, zodat hun gedeelde translaties in dezelfde
wavefront worden geëlimineerd.

De echte app-route slaagt in circa 4 s op de lokale releasebuild met een
relatief evenwichtsresidu van `3,742×10⁻¹⁰`. Alle 2.048 knoopverplaatsingen
liggen binnen `2,466×10⁻¹³ m` van de hierboven onafhankelijk afgeleide
kleine-reklimiet, en alle 1.143 volumespanningen binnen
`4,662×10⁻¹⁰ MPa`. Geen Hex8 vertoont plastische rek. De ontwikkelapp
heeft het project eveneens via **Berekenen** opgelost en toont
`frontalWave` en `umax=0,003791 mm`.

De afzonderlijke Rust-proef `mixed3d_frame_connected_lattice_scale.rs`
vergelijkt matrixvrije, frontale en sparse resultaten zonder volume. De
hierboven beschreven patch geeft nu ook voor de grote gekoppelde
frame/Hex8-topologie een onafhankelijke lineaire referentie. De gemengde
buigbelasting heeft nog geen gesloten verplaatsingsoplossing. Gekoppelde
3D-GNL/FNL, algemene brede roosters en een gekoppelde schaalproef met veel
meer dan 1.143 volumes blijven afzonderlijke doelen.

## Grote plastische J2-belasting en volledige ontlasting

Twee extra opgeslagen app-projecten gebruiken dezelfde 2.048 knopen,
5.104 volledige 3D-staven en 1.143 gedeelde Hex8-elementen:
`hex8-raamwerk-1143-volumes-5104-staven-j2-plastische-patch.ifcfem2d`
en `hex8-raamwerk-1143-volumes-5104-staven-j2-ontlast-patch.ifcfem2d`.
Alle langsliggers hebben samen 2,56 m² doorsnede; hun afzonderlijke
oppervlakken zijn evenredig met het tributairvlak van de bijbehorende
Hex8-eindknoop. Zo blijft de exacte axiale oplossing ook na ontlasting
affien. Dwarsverplaatsingen en rotaties zijn opgelegd.

De verificatiemateriaalwaarde `Y=0,002 MPa` is bewust laag en is geen
constructieve staalsoort. Bij `E=30.000 MPa`, `ν=0,2` en lineaire harding
`H=300 MPa` geeft de onafhankelijke J2-terugkeerformule voor de belasting
van 100 kN `ε=1,278984555·10⁻⁷`, equivalente plastische rek
`p=3,167887271·10⁻⁸` en `ux(L)=0,004060776 mm`. Na volledig ontlasten
blijft `p` staan en is de elastische restvervorming
`ε=8,509725836·10⁻⁹`, dus `ux(L)=0,000270184 mm`. De berekende
omgekeerde deviatorspanning `−0,000975 MPa` blijft onder de dan geldende
vloeigrens `0,0020095 MPa`: de ontlaststap zelf is elastisch. Voor de
J2-return en hardingsdefinitie is de [Sandia LAMÉ J2-handleiding](https://www.sandia.gov/files/sierra/SM_LAME_5_28/main/models/j2_plasticity.html)
gebruikt; de parallelle staaf-/volume-referentie is afzonderlijk afgeleid.

`FEM_PLASTIC_PATCH=1` en `FEM_PLASTIC_UNLOAD=1` kiezen de twee varianten in
`design-mockup/accept-connected-frame-hex8-finite-j2-app-route.mjs`.
De test laadt de echte projectbestanden, doorloopt de normale app-adapter en
de Rust-releasebinary, en vergelijkt alle knoopverplaatsingen en Hex8-
spanningen en plastische rekken met de onafhankelijke referentie. Bij de
belaste toestand zijn de grootste afwijkingen `2,408·10⁻¹³ m`,
`4,603·10⁻¹⁰ MPa` en `6,432·10⁻¹⁶`; bij ontlasting `5,985·10⁻¹⁵ m`,
`2,963·10⁻¹¹ MPa` en `6,432·10⁻¹⁶`. Beide gebruiken `frontalWave`; de
relatieve evenwichtsresiduen zijn respectievelijk `2,474·10⁻¹⁰` en
`1,436·10⁻⁹`. De lokale release-routes duurden 3,00 en 4,71 s. Alle
47 verificatieprojecten doorlopen de opslag-/herlaadtest.

Deze axiale proef toetst het J2-historypad op grote gedeelde topologie.
De staafwet blijft lineair elastisch en de proef bewijst geen buigende
frame-GNL, constructief realistische staalplastificatie of algemene
niet-affiene 3D-plasticiteit op deze schaal.
