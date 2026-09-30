# Voorgespannen ligger: elastische referentieberekening

`native-prestressed-beam` berekent een vrij opgelegde ligger met een rechte of
symmetrisch parabolische kabel. De invoer is in **m, kN en MPa**. Positieve
kabelexcentriciteit ligt **onder** het zwaartepunt; trekspanning en neerwaartse
doorbuiging zijn positief. De opgegeven verliesfractie reduceert de kracht
tussen overdracht en gebruikstoestand. Verlies door krimp, kruip, relaxatie,
wrijving of verankering wordt hier niet voorspeld.
`transferUniformDownwardKnPerM` en `serviceUniformDownwardKnPerM` zijn elk de
**totale** neerwaartse gelijkmatige last in die fase.

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

De [FHWA Post-Tensioned Box Girder Design Manual, vergelijking 3.23](https://www.fhwa.dot.gov/bridge/concrete/hif15016.pdf)
leidt de equivalente parabolische belasting `8Pe/L²` af. De
[FHWA PSC girder design example, stap 5.6](https://www.fhwa.dot.gov/bridge/lrfd/pscus056.cfm)
geeft de formules voor boven- en ondervezelspanning en voor de opbuiging van
een rechte kabel. De rekenkern gebruikt die relaties in SI-eenheden.

## Herhaalbare voorbeelden

```bash
cd src-tauri
cargo run -p openaec-native-fem --bin native-prestressed-beam \
  < crates/native-fem/examples/fhwa-prestressed-girder-camber.json
cargo run -p openaec-native-fem --bin native-prestressed-beam \
  < crates/native-fem/examples/parabolic-prestressed-beam.json
```

Het eerste bestand zet de FHWA-waarden voor een groep rechte strengen om:
`P=924,4 kip`, `e=31,005 in`, `L=109 ft`, `E=4200 ksi` en
`I=733320 in⁴`. De uitvoer `transfer.prestressCamberM` is circa
`-0,05055 m`, gelijk aan **1,99 inch opwaarts** in het FHWA-voorbeeld.

Het tweede bestand geeft bij overdracht `P=1000 kN`, `e_mid=0,2 m`,
`L=10 m` en dus `q_p=16 kN/m` opwaarts. Na 20% verlies is
`q_p=12,8 kN/m`. Een neerwaartse gebruikslast van `16 kN/m` geeft
`M_ext=200 kNm` in het midden; de kabel geeft daar `-160 kNm`.

## Grenzen

Dit is een lineair elastische liggerberekening voor één vrij opgelegde
overspanning met constant `EI`, constante kabelkracht per fase en een
gelijkmatig verdeelde externe last. De uitvoer bevat spanningen aan eind en
middendoorsnede, middenopbuiging en axiale verkorting. De kern doet geen
wapeningsontwerp, UGT/BGT-toets, overdrachtslengte, scheurvorming,
niet-lineaire doorsnedeanalyse, fasering of interactie met de 3D-raamwerk-FEM.
Een ontwerpberekening vereist aanvullende materiaal- en normtoetsen.
