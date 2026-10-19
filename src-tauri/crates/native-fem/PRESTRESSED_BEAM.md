# Voorgespannen ligger: elastische referentieberekening

`native-prestressed-beam` berekent een vrij opgelegde ligger met een rechte of
symmetrisch parabolische kabel. De invoer is in **m, kN en MPa**. Positieve
kabelexcentriciteit ligt **onder** het zwaartepunt; trekspanning en neerwaartse
doorbuiging zijn positief. De opgegeven verliesfractie reduceert de kracht
tussen overdracht en gebruikstoestand. Verlies door krimp, kruip, relaxatie,
wrijving of verankering wordt hier niet voorspeld.
De app opent deze berekening via **Inzicht → Voorgespannen ligger**. Dit scherm
maakt twee gelijke E-segmenten invoerbaar, plus de rechte/parabolische
kabelgeometrie, uniforme overdrachts- en gebruikslast en de expliciete
EC2-beugelparameters. De Rust-uitvoer verschijnt per fase en per station.
Puntlasten, gedeeltelijke lijnlasten en een willekeurig aantal E-segmenten zijn
wel in de Rust/API-invoer beschikbaar, maar nog niet in dit invoerscherm.
`transferUniformDownwardKnPerM` en `serviceUniformDownwardKnPerM` zijn elk de
**totale** neerwaartse gelijkmatige last in die fase.
Geconcentreerde lasten kunnen per fase als `transferPointLoads` en
`servicePointLoads` worden opgegeven. `positionM` ligt strikt tussen de
opleggingen; `downwardKn` is neerwaarts positief en mag negatief zijn voor
opwaarts gerichte last.
Gedeeltelijke of verlopende verdeelde lasten kunnen per fase als
`transferLineLoads` en `serviceLineLoads` worden opgegeven. Elk segment gebruikt
`startM`, `endM`, `startDownwardKnPerM` en `endDownwardKnPerM`; segmentgrenzen
mogen samenvallen met de opleggingen. Intensiteiten worden lineair tussen beide
eindwaarden geïnterpoleerd; overlap met andere lastsegmenten telt op.
De doorsnedestijfheid kan ruimtelijk variëren met `stiffnessSegments`: een
geordende, aaneengesloten reeks over de volledige overspanning met per segment
`startM`, `endM` en `eMpa`. De doorsnede-inertie blijft voor alle segmenten
gelijk. De solver integreert `M(x)/(E(x)I)` per segment voor opbuiging en
doorbuiging; axiale verkorting gebruikt de overeenkomstige som van `Lᵢ/EᵢA`.
Momenten en oplegreacties volgen uit evenwicht en veranderen niet door E. Op een
interne segmentgrens rapporteert `effectiveEMpa` de modulus aan de rechterzijde.
Dit is lineair-elastische, stukgewijs constante E; het is geen niet-lineaire
materiaalwet of tijdsafhankelijke kruipberekening.

Voor de kabel geldt

`e(x) = e_end + 4(e_mid - e_end) x (L - x) / L²`.

De equivalente gelijkmatig verdeelde opwaartse last is
`q_p = 8 P (e_mid - e_end) / L²`. Een constante excentriciteit geeft daarnaast
een eindmoment `P e_end`; de parabolische component geeft eindschuifkrachten
met grootte `4 P (e_mid - e_end) / L`. Deze belastingen zijn onderdelen van
één equivalent evenwichtsstelsel, en mogen niet apart als extra kabelkracht
worden opgeteld. De doorsnedespanning op een positie volgt uit
`-P/A ± P e/S ± M_ext/S`. De opbuiging in het midden is
`-P L² [e_end/8 + 5(e_mid-e_end)/48]/(EI)`; voor een neerwaartse
uniforme last is de doorbuiging `+5 q L⁴/(384 EI)`.

Elke fase geeft daarnaast vijf stations op `x/L = 0, 0.25, 0.5, 0.75, 1`.
Per station bevat `stations` de lokale kabelhoogte, externe-, voorspan- en
totale momentresultante, dwarskracht, boven- en ondervezelspanning en
voorspan-, externe en totale doorbuiging. De dwarskracht volgt uit de afgeleide
van de totale momentlijn; de gerapporteerde tekens volgen de positieve
`x`-richting. Per belastingsfase bevat het resultaat daarnaast externe
steunreacties (`externalLeftReactionKn`, `externalRightReactionKn`) en totale
steunreacties (`leftReactionKn`, `rightReactionKn`), positief neerwaarts.
De totale waarden bevatten de equivalente verticale kabelkracht; de externe
waarden tellen uitsluitend de opgegeven lasten op. Met `stationsXM` kan de aanvraag extra doorsneden in meter vanaf
de linker oplegging opgeven. De Rust-kern sorteert en dedupliceert die posities
en voegt altijd beide opleggingen toe; posities buiten de overspanning en
niet-eindige waarden worden geweigerd. Zonder extra posities gebruikt `stations`
het vaste raster. Daarnaast geeft `criticalStations` de opleggingen, de
zero-shear-snede voor moment en vezelspanning en alle interne nulpunten van de
doorbuigingshelling. Die nulpunten kunnen buiten het midden liggen. De kritieke
stations zijn gebaseerd op de respons van dit model met uniforme, lineaire
segment- en puntlasten plus een rechte of parabolische kabel. Puntlastposities worden
opgenomen in `criticalStations`; op zo'n station meldt `shearKn` de
rechterwaarde en zijn `shearBeforePointLoadKn`/`shearAfterPointLoadKn` beide
snedekrachten expliciet beschikbaar. De solver zoekt daarnaast interne
nulpunten van de dwarskracht en doorbuigingshelling. Voor de dwarskrachtomhulling
neemt hij ook interne dwarskrachtsextremen op waar de netto verdeelde last nul
is. Op ieder glad belastingsinterval is het moment maximaal derdegraads en de
dwarskracht maximaal tweedegraads; de solver isoleert hun nulpunten voor de
moment- en doorbuigingsextremen. Dit is geen volledige ontwerpcontrole.

De [FHWA Post-Tensioned Box Girder Design Manual, vergelijking 3.23](https://www.fhwa.dot.gov/bridge/concrete/hif15016.pdf)
leidt de equivalente parabolische belasting `8Pe/L²` af. De
[FHWA PSC girder design example, stap 5.6](https://www.fhwa.dot.gov/bridge/lrfd/pscus056.cfm)
geeft de formules voor boven- en ondervezelspanning en voor de opbuiging van
een rechte kabel. De rekenkern gebruikt die relaties in SI-eenheden.

De gedeelde `crackWidth`-solver toetst daarnaast EC2 7.3.4 voor betonstaal en
gebonden voorspanning. Hij gebruikt de bestaande normformules voor het
rekverschil, de effectieve wapening `As + Ap′,eff`, de maximale scheurafstand
en de scheurwijdte. Voor voorgespannen doorsneden levert de constructeur de
spanningsverandering `Δσp` uit de gescheurde doorsnede, samen met de
neutrale-lijnpositie, hechtende staaloppervlakken en de volgens de gekozen
normuitgave bepaalde effectieve voorspanstaalbijdrage `Ap′,eff`, dekking,
staaf-/strengdiameter, steek en materiaal- en grenswaarden. De kernel berekent
die doorsnedetoestand of spanningsverandering niet uit de liggerlasten; deze
controle mag dus niet als automatische scheurtoets van de liggerrespons worden
gelezen. Een verzoek loopt via de gewone FEM-dispatch met `kind: "crackWidth"`.
Het fixturebestand `examples/ec2-bonded-prestress-crack-width.json` is een
handmatig nagelopen formulevoorbeeld: met `A′p,eff=588 mm²`, `Δσp=120 MPa`,
`Ac,eff=45 000 mm²` en `ρp,eff=0,013067` geeft de spanningsvloer
`εsm−εcm=0,00036`. De NB-bovengrens op `sr,max` is `273,6 mm`; daarmee volgt
`wk=0,0985 mm` en bij `wmax=0,20 mm` een unity check van `0,4925`. Dit is een
rekenfixture, geen representatieve liggerberekening.

## Herhaalbare voorbeelden

```bash
cd src-tauri
cargo run -p openaec-native-fem --bin native-prestressed-beam \
  < crates/native-fem/examples/fhwa-prestressed-girder-camber.json
cargo run -p openaec-native-fem --bin native-prestressed-beam \
  < crates/native-fem/examples/parabolic-prestressed-beam.json
cargo run -p openaec-native-fem --bin native-prestressed-beam \
  < crates/native-fem/examples/ec2-prestressed-shear-example-6-3.json
cargo run -p openaec-native-fem --bin native-prestressed-beam \
  < crates/native-fem/examples/ec2-prestressed-shear-links-example-6-4.json
cargo run -p openaec-native-fem --bin native-prestressed-beam \
  < crates/native-fem/examples/point-loaded-prestressed-beam.json
cargo run -p openaec-native-fem --bin native-prestressed-beam \
  < crates/native-fem/examples/partially-loaded-prestressed-beam.json
```

Het eerste bestand zet de FHWA-waarden voor een groep rechte strengen om:
`P=924,4 kip`, `e=31,005 in`, `L=109 ft`, `E=4200 ksi` en
`I=733320 in⁴`. De uitvoer `transfer.prestressCamberM` is circa
`-0,05055 m`, gelijk aan **1,99 inch opwaarts** in het FHWA-voorbeeld.

Het tweede bestand geeft bij overdracht `P=1000 kN`, `e_mid=0,2 m`,
`L=10 m` en dus `q_p=16 kN/m` opwaarts. Na 20% verlies is
`q_p=12,8 kN/m`. Een neerwaartse gebruikslast van `16 kN/m` geeft
`M_ext=200 kNm` in het midden; de kabel geeft daar `-160 kNm`.
Het voorbeeld vraagt ook expliciet stations op `x=2,5 m` en `x=7,5 m`.

Het puntlastvoorbeeld heeft een vrij opgelegde ligger met `L=10 m`,
`EI=600 000 kNm²` en een puntlast van `12 kN` in het midden. De handberekening
geeft `R_A=R_B=6 kN`, `M_mid=PL/4=30 kNm`, `V=+6/-6 kN` aan weerszijden van
de last en `δ_mid=PL³/(48EI)=1/2400 m`. De Rust-fixture controleert deze
waarden en dat de gebruikslast niet in de overdrachtsfase terechtkomt.

Het gedeeltelijke-lastvoorbeeld gebruikt een driehoekslast die van `0` tot
`20 kN/m` oploopt tussen `x=2` en `x=7 m` op een `10 m` ligger. De resultante is
`50 kN` met zwaartepunt op `x=16/3 m`, dus `RA=70/3 kN` en `RB=80/3 kN`.
Op `x=5 m` volgt `M=296/3 kNm` en `V=16/3 kN`; de Green-functie-integraal geeft
bij `EI=600000 kNm²` `δ=0,00159683333333333 m`. Deze fixture toetst daarnaast
de maatgevende stations tegen een fijn gerasterde respons.

Het derde bestand (`ec2-prestressed-shear-example-6-3.json`) voert de
voorgespannen-betoncontrole zonder dwarskrachtbeugels uit naast de liggerstaat.
De effectieve kabelkracht levert `σcp`; `fctd`, `vmin`, `k1`, de lijfbreedte,
hoogte en effectieve diepte zijn expliciete invoer. Per station worden de
gescheurde en ongescheurde `VRd,c`-takken én hun benuttingen tegen de berekende
dwarskracht gerapporteerd. Invoerparameters volgen [EC2 Worked Examples,
voorbeeld 6.3](https://www.theconcreteinitiative.eu/images/ECP_Documents/Eurocode2_WorkedExamples.pdf),
dat voor `bw=100 mm`, `h=200 mm`, `d=175 mm`, `σcp=5 MPa` en `fctd=1,66 MPa`
respectievelijk `24,08 kN` en `44,33 kN` geeft. Beide takken blijven zichtbaar:
deze berekening bepaalt niet zelf of de doorsnede gescheurd is.

De optionele `shearLinks`-invoer ontwerpt verticale beugels per stationsnede
met de variabele-hoek vakwerkmethode. `cotTheta`, `alphaCw`, `nu1`, `fcd` en
`fywd` zijn expliciete norm-/materiaalkeuzen. De uitvoer geeft de benodigde
`Asw/s`, de betondrukdiagonaalgrens `VRd,max` en—wanneer zowel beugeloppervlak
als steek zijn opgegeven—`VRd,s`, de maatgevende `VRd` en benutting. Het
voorbeeldbestand `ec2-prestressed-shear-links-example-6-4.json` gebruikt
`VEd=600 kN`, `bw=200 mm`, `z=675 mm`, `fywd=391 MPa` en `cotTheta=1,8` en
reproduceert `Asw/s=1,263 mm²/mm` en `VRd,max≈600 kN` uit [EC2 Worked Examples,
voorbeeld 6.4](https://www.theconcreteinitiative.eu/images/ECP_Documents/Eurocode2_WorkedExamples.pdf).
Dat gepubliceerde voorbeeld is niet voorgespannen; de fixture gebruikt daarom
een verwaarloosbare kracht en `alphaCw=1` om de beugelvergelijkingen los van
prestresscorrecties te verifiëren.

## Grenzen

Dit is een lineair elastische liggerberekening voor één vrij opgelegde
overspanning met constante of segmentgewijze `EI`, constante kabelkracht per fase, gelijkmatig
verdeelde externe lasten, lineaire lastsegmenten en geconcentreerde puntlasten.
De uitvoer bevat spanningen aan eind en
middendoorsnede, middenopbuiging en axiale verkorting. De kern doet geen
langswapeningsontwerp, overdrachtslengte, automatische scheurwijdte op basis van de
liggerrespons, niet-lineaire
doorsnedeanalyse, fasering of interactie met de 3D-raamwerk-FEM. De optionele
`shearWithoutLinks`-controle is beperkt tot de twee `VRd,c`-takken van het
aangehaalde voorbeeld; zij ontwerpt geen beugels, controleert geen `VRd,max`,
toetst geen scheurwijdte en kiest geen tak namens de gebruiker. De
servicebelasting-/combinatiekeuze, doorsnedetoestand en nationale bijlage
blijven expliciete ontwerpbeslissingen. `shearLinks` bepaalt geen optimale
`cot(theta)`, minimumbeugelwapening of maximale beugelafstand en controleert
geen verankering/detailering; de gebruiker moet die overige eisen afzonderlijk
verifiëren.
