# Testbewijs 3D-raamwerk — 26 september 2026

## Doelcontrole 12-uursbouw

| Vereiste | Gezaghebbend bewijs | Oordeel |
| --- | --- | --- |
| 3D-raamwerkkern met zes vrijheidsgraden | `open-fem-3d`, gesloten oplossingen, evenwicht en 22 groene Rust-tests | Behaald |
| Directe tweede orde en knik | P-Delta-, kritieke-last-, nulstand- en Eulerconvergentietests | Behaald |
| Solverarchitectuur en gebruikerskeuze | versievaste adapter voor de externe 3D-kern, capabilityrouter en solverkeuze in Instellingen | Behaald |
| Verificatieberekeningen | `cases.json`, 3D-torsie, twee-assige buiging, veren, releases, temperatuur en opgelegde verplaatsing | Behaald |
| GUI, IFC, MCP en compacte rapportage | native desktopproeven, 47 MCP-tools, IFC4-regressies en vaste rapportaanzichten | Behaald |
| Staal-, beton- en kniktoetsing | EN 1993/EN 1992-adapters, twaalf groene 3D-adaptertests en volledige MCP-regressie | Behaald binnen de hieronder genoemde beperkingen |
| Bouw- en gebruikerskwaliteit | TypeScript, Vite, volledige native debugbuild, GUI-bediening, foutpaden en projectroundtrip groen | Behaald |
| Reviewbaar resultaat | één schone lokale commit; branch staat precies één commit vóór `origin/master` | Behaald; externe push wacht op expliciete toestemming |

De controle hierboven geldt voor betrouwbare **3D-raamwerken**. De latere
productfasen voor een volledige plaat-, schaal- en volumekern staan bewust in
de actielijst en worden hieronder niet als gerealiseerde raamwerkfunctionaliteit
voorgesteld.

## Rekenkern

- Rust-referentieset `open-fem-3d`: **21/21 geslaagd**.
- Alle vier gepubliceerde gevallen uit `cases.json` worden daarnaast rechtstreeks
  ingelezen en volledig vergeleken. Grootste absolute afwijking:
  `3,553·10⁻¹⁵`; grootste relatieve afwijking: `1,561·10⁻¹⁵`. De onafhankelijk
  herberekende globale kracht- en momentbalans sluit tot maximaal
  `3,553·10⁻¹⁵ kN/kNm`.
- Referenties: schuine trekstaaf, twee-assige buiging, ruimtelijke torsie,
  revolute X/Y/Z, opgelegde rotatie met slope-deflection, lokale staafrol,
  directe P-Delta, knik, numerieke nulmodus en P-Delta met exact nul vrije
  verplaatsing.
- Een vrij torsiemechanisme dat door de engine als een numeriek getal werd
  teruggegeven (`rx≈1,76·10¹⁴ rad`, residu `0,825`) wordt nu aan de adaptergrens
  hard geweigerd met concrete hersteltekst voor rotatie- en torsieblokkering.
- De geometrische-stijfheidstest vergelijkt één gesegmenteerde kolom lineair,
  onder `25 kN` druk en onder `25 kN` trek: druk vergroot de zijdelingse
  verplaatsing, trek verkleint deze en B2 blijft voor trek begrensd op `1,0`.
- Dezelfde kolom is doorgerekend op `0,90 Pcr` en `1,05 Pcr`, waarbij `Pcr`
  uit de eerste fysieke eigenwaarde van precies dat model volgt. De eerste
  toestand convergeert met eindige uitkomsten en `B2>2`; de tweede wordt met
  een gerichte instabiliteitsmelding afgewezen. Daarmee kan een omgeklapte,
  postkritische oplossing niet meer als stabiel resultaat worden geaccepteerd.
- De Eulerkniklast van een ingeklemde kolom is bij 1, 2, 4, 8 en 16 elementen
  vergeleken met `π²EI/(4L²)=259,077115529 kN`. De rekenwaarden convergeren van
  `261,025978408` naar `259,077148938 kN`; de relatieve fout daalt monotoon van
  `7,522·10⁻³` naar `1,290·10⁻⁷`.
- De lokale lijnlast en een lokale staafpuntlast op willekeurige positie lopen
  door het productcontract en leveren veldresultaten met lastdiscontinuïteiten.
- Een lokale `My`-eindrelease is onder een gelijkmatig verdeelde last getoetst
  aan `RA=5wL/8`, `RB=3wL/8`, `MA=wL²/8` en `MB=0`.
- Productiebinary opnieuw gebouwd na de P-Delta-correctie.
- Browser-API met `pdelta-nultoestand-request.json`: alle vrije verplaatsingen
  nul, `Rz=10 kN`, evenwicht akkoord, één geldige iteratie en `B2=1,0`.
- De volledige Rust-workspace is met een schrijfbare, geïsoleerde testcache
  uitgevoerd: alle unit-, integratie-, stdio-, rapport- en documentatietests
  zijn geslaagd. De MCP-roster is daarbij opnieuw vastgelegd op 45 tools.

## 3D beton en staal

- TypeScript-regressieset `--filter=openFem3d`: **10/10 bestanden geslaagd**.
- De EN 1992-adapter geeft `N`, `Vy`, `Vz`, `T`, `My` en `Mz` aan beide
  staafeinden door, bewaart doorsnede, betonklasse en wapeningskorf bij
  projectroundtrip en bij de omzetting van 2D naar 3D. Dezelfde roundtriptest
  bewaakt de §5.8-invoer voor schoring, kniklengten om beide assen en kruip.
- De 3D-unity-checklaag combineert EN 1992 en EN 1993, gebruikt voor staal
  uitsluitend UGT-toetsen voor de kleur en toont `NotApplicable` grijs.
- Bestaande Rust-referentieset van de betonkern: **6/6 geslaagd**.

## GUI en uitdraai

- X-, Y- en Z-rol blokkeren elk precies de genoemde globale translatie en
  laten alle rotaties vrij. De eigenschappenkaart biedt daarnaast de zes
  afzonderlijke `Ux/Uy/Uz/Rx/Ry/Rz`-schakelaars. Een geometrische regressietest
  controleert dat ieder rolsymbool langs de bijbehorende globale as wordt
  getekend.
- De begin- en eindknoop van een 3D-staaf zijn nu in Eigenschappen te kiezen.
  Herverbinden bewaart profiel, releases, norminvoer en gekoppelde staaflasten;
  dezelfde knoop en twee knopen op dezelfde positie worden als nulstaaf geweigerd.

Handmatig end-to-end gecontroleerd in de ontwikkelbuild:

1. gemengd 3D-model met vijf staalstaven en één betonstaaf;
2. tweede-ordeanalyse en knik;
3. EN 1992-resultaat voor doorsnede `300x600`, beton `C30/37` en de opgeslagen
   wapeningskorf;
4. Eigenschappen-tab EN 1992 met status, UC, maatgevende toets, normartikel,
   wapening en niet-uitgevoerde controles;
5. compact rapport met randvoorwaarden, knoopbelastingen, rekenmethode,
   knik, EN 1993, EN 1992, de zes maatgevende deeltoetsen per betonstaaf,
   alle zes staafkrachtcomponenten en reacties;
6. 3D-view met afzonderlijke `EN 1992 · UC`- en `EN 1993 · UC`-labels,
   kleurklassen en een legenda;
7. zichtbaarheidsschakelaar voor de unity-checklaag.
8. §5.8-kolominvoer in de 3D-eigenschappen; met een geschoorde kolom werd na
   herberekenen `UC beton = 0,16` en de slankheidsgrens als maatgevend gemeld.

De productie-Vite-build is geslaagd. De bestaande bundelwaarschuwingen over
grote chunks en gemengd statisch/dynamisch importeren zijn geen buildfouten.

### Desktopreferentie: staafpuntlast

De zelfstandige Linux/Tauri-app is na de bronwijzigingen opnieuw gebouwd. Via
de beveiligde lokale GUI-bediening is een vrij opgelegde IPE200 van `4 m`
ingevoerd met één lokale puntlast `Pz=-10 kN` op `2 m`. De app gaf:

| Grootheid | Desktopapp | Gesloten oplossing |
| --- | ---: | ---: |
| `Rz` links / rechts | `5,000 / 5,000 kN` | `P/2 = 5,000 kN` |
| `Vz` voor / na de last | `+5,000 / -5,000 kN` | `+P/2 / -P/2` |
| `My,max` | `10,000 kNm` | `PL/4 = 10,000 kNm` |
| `wmax` | `3,2727867779414184 mm` | `PL³/(48EI) = 3,272786777941417 mm` |

De GUI meldde één staafpuntlast, tekende de discontinuïteit op drie stations
rond `x/L=0,5`, berekende 24 combinaties en toonde `My`/`Vz`-extremen in de
3D-resultaatlaag. Projectroundtrip, IFC4-structurele export, browserbediening,
MCP-schema en directe solverroute zijn voor dezelfde lastsoort automatisch getest.

### Desktopreferentie: oplegveer

In de opnieuw gebouwde zelfstandige Linux/Tauri-app is een IPE200-uitkraging
van `2 m` ingevoerd met een verticale eindveer `kz=370 kN/m` en een knooplast
`Pz=-10 kN`. De app bevestigde één oplegveer en gaf:

| Grootheid | Desktopapp | Onafhankelijke controle |
| --- | ---: | ---: |
| `uz` eindknoop | `-5,2693979713 mm` | `-P/(3EI/L³+k)` |
| `Rz` veer | `1,9496772494 kN` | `-k·uz = 1,9496772494 kN` |
| `Rz` inklemming | `8,0503227506 kN` | `P-Rveer = 8,0503227506 kN` |
| `ΣRz` | `10,0000000000 kN` | `10 kN` |

Dezelfde route berekende 24 combinaties. De veer loopt door projectopslag,
2D→3D-omzetting, lint en eigenschappen, solver, reacties, 3D-symbolen,
compact rapport, IFC4, GUI-bediening en MCP-schema.

### Desktopreferentie: temperatuurbelasting

Een betonnen staaf `300×600` van `2 m` is aan het begin ingeklemd en aan het
einde alleen axiaal vrijgelaten. Met `C30/37`, `α=10·10⁻⁶/K` en een uniforme
`ΔT=30 K` gaf de opnieuw gebouwde desktopapp:

| Grootheid | Desktopapp | Gesloten oplossing |
| --- | ---: | ---: |
| `ux` eindknoop | `0,6000000000000001 mm` | `αΔT·L = 0,6000000000 mm` |
| `N` | `2,3·10⁻¹³ kN` | `0 kN` |
| `Rx` begin | `-2,3·10⁻¹³ kN` | `0 kN` |

De GUI meldde één temperatuurbelasting en berekende 24 combinaties. Uniforme
ΔT en lokale y/z-gradiënten lopen door projectopslag, 2D→3D-omzetting,
lint/eigenschappen, solver, 3D-symbolen, rapport, IFC4, GUI-API en MCP. De
uitzettingscoëfficiënt is `12·10⁻⁶/K` voor staal, `10·10⁻⁶/K` voor beton en
`5·10⁻⁶/K` voor hout parallel aan de vezel.

### Desktopreferentie: opgelegde knoopverplaatsing

Een IPE200 van `2 m` is aan beide uiteinden volledig vastgelegd; aan knoop 2
is globaal `Ux=1,000 mm` opgelegd. Zonder gewone belasting gaf de opnieuw
gebouwde desktopapp:

| Grootheid | Desktopapp | Gesloten oplossing |
| --- | ---: | ---: |
| `ux` knoop 2 | `1,000000 mm` | `δ = 1,000000 mm` |
| `Rx` knoop 1 / 2 | `-299,250 / +299,250 kN` | `±EAδ/L` |
| `N` staaf | `299,250 kN` | `210 GPa · 2850 mm² · 1 mm / 2 m` |

De GUI meldde één opgelegde verplaatsing en berekende 24 combinaties. De
functie loopt door projectopslag, eigenschappen, canvas, Explorer, solver,
rapport, IFC4 `IfcStructuralLoadSingleDisplacement`, GUI-API en beide
MCP-schema's. Een volledig voorgeschreven model gebruikt de bewezen lineaire
oplossing als geldige P-Delta-nultoestand met versterkingsfactor `1,0`.

### Desktopfoutpad: vrij torsiemechanisme

Een IPE200 van `3 m` is in de zelfstandige desktopapp aan beide uiteinden
scharnierend opgelegd en belast met `Mx=5 kNm`. Daardoor is de gezamenlijke
rotatie om de staafas niet geblokkeerd. De app weigert dit model nu en bewaart
de fout ook na de mislukte rekengang in de GUI-status. De melding benoemt:

- mechanisme of singuliere stijfheidsmatrix;
- de benodigde onafhankelijke translatie- en rotatieblokkeringen;
- torsie om de staafas;
- inklemming, passende revolute-oplegging of rotatieveer als herstelopties.

De lineaire regressievariant bewaakt daarnaast dat een engine-uitkomst met
`rx≈1,76·10¹⁴ rad` en relatief residu `0,825` niet als geldig resultaat wordt
doorgegeven. TypeScript-typecontrole, productie-Vite-build, de native
Tauri-debugbuild en de GUI-proef zijn na deze wijziging opnieuw geslaagd.

### Desktopgrens: kritieke druklast

In de opnieuw gebouwde zelfstandige app is een IPE200-kolom van `4 m` met acht
elementen en een kleine horizontale storingslast doorgerekend. Bij `25 kN`
druk gaf de basislasttoestand `alpha_cr=1,8394513099` en een geldige
P-Delta-oplossing. De daaruit volgende kritieke last is
`Pcr=45,98628275 kN`.

Daarna is via dezelfde GUI-route `1,05·Pcr=48,2856 kN` ingevoerd. De app wees
de berekening af met `alpha_cr=0,952381` en een concrete instabiliteitsmelding
over het bereiken van de kritieke last en mogelijke herstelmaatregelen. De
melding bleef na de mislukte rekengang in de GUI-status staan en het oude
resultaat werd niet als geldig behouden.

### Desktop- en MCP-proef: 3D-subknoop

In de opnieuw gebouwde zelfstandige app is een IPE300-staaf van `6 m` op
`x=3 m` geknipt. De app maakte knoop 3 en staaf 2 aan en behield materiaal,
profiel en lokale profielrotatie op beide staafdelen. Een trapeziumlast van
`-4` naar `-6 kN/m` tussen `x=1` en `x=5 m` werd exact verdeeld als:

| Staafdeel | Bereik | qz begin | qz einde |
| --- | ---: | ---: | ---: |
| 1 | `1–3 m` | `-4 kN/m` | `-5 kN/m` |
| 2 | `0–2 m` | `-5 kN/m` | `-6 kN/m` |

De gerichte regressie controleert daarnaast puntlasten links, precies op en
rechts van het knippunt, dubbele temperatuurbelasting, hergebruik van een
bestaande knoop en het behoud van uitsluitend de oorspronkelijke buitenste
moment- en torsievrijgaven. De gesplitste constructie rekende in de native app
24 combinaties door.

Daarna is dezelfde handeling via de werkelijke MCP-stdio-server uitgevoerd.
`tools/list` gaf destijds 46 tools inclusief `gui_split_3d_member`; de MCP-route bouwde
het model in de draaiende app, knipte de staaf, las knoop 3, staven 1/2 en
`qz=-5 kN/m` op het knippunt terug en voerde aansluitend `gui_solve` uit. Die
rekengang leverde 24 combinaties en `70,9121285537 mm` maximale verplaatsing.
De uitkomst is een P-Delta-berekening; de toegevoegde tussenknoop is daarbij
ook een elementverfijning, zodat een kleine wijziging ten opzichte van één
lang element fysisch en numeriek verwacht is.

### Desktop- en MCP-proef: platen, openingen en oppervlaktebelasting

De zelfstandige desktopbuild is opnieuw opgebouwd en gestart met een vlakke
plaat van `6 × 4 m`, `250 mm` dik, beton `C30/37`, een buitenrandstraal van
`0,30 m` en een opening van `2 × 2 m` met een hoekstraal van `0,15 m`. De
plaat werd via de echte GUI-bediening geselecteerd. Het eigenschappenpaneel
toonde de vier hoekknopen, dikte, randstraal, materiaal en één opening; de
lintopdrachten **Opening** en **Oppervlaktelast** waren beschikbaar. Met de
lastlaag aan was `qz = -5,000 kN/m²` zichtbaar, terwijl selectie en camera
behouden bleven.

De MCP-stdio-proef gaf `47` tools, waaronder `gui_select_3d_plate`. Via
`gui_build_3d_model` is hetzelfde model in de draaiende desktopapp opgebouwd;
de teruggelezen toestand bevatte exact één plaat en één oppervlaktebelasting.
De geselecteerde plaat kwam terug met `cornerRadiusM=0,3`, `thicknessM=0,25`
en de opening met `cornerRadiusM=0,15`.

De gerichte TypeScript-regressie controleert daarnaast planheid, een niet-nul
plaatoppervlak, werkelijke geëxtrudeerde geometrie met afgeronde buitenrand en
opening, CRUD voor oppervlaktebelastingen, selectie, kopiëren met last,
projectopslag en opgeslagen 3D-viewsets. De gecombineerde 3D/projectreeks gaf
`58 geslaagd, 0 gefaald`; de GUI-bedieningsreeks gaf `19 geslaagd, 0 gefaald`.
De TypeScript-typecontrole, productie-Vite-build, native Rust-build, de `40`
MCP-binaire tests en de MCP-stdio-contracttest waren eveneens groen.

Bij de afsluitende volledige MCP-regressie bleek de drie-wegenkruistabel de
nieuwe GUI-gereedschappen `gui_select_3d_plate` en `gui_split_3d_member` nog
niet als bewuste bedieningsuitzondering te noemen. De tabel is aangevuld en de
volledige crate-suite is daarna opnieuw uitgevoerd met de productie-Node-runtime:
alle unit-, integratie-, sidecar-, schema-, foutpad-, drie-wegen- en
stdio-tests slaagden. De afzonderlijke `open-fem-3d`-suite gaf `22`
geslaagde referentie- en JSON-tests. Ook de TypeScript-typecontrole, Vite-build
en volledige native debugbuild zijn na deze correctie opnieuw groen uitgevoerd.
Een afsluitende losse uitvoering van alle twaalf 3D-adaptertests vond nog een
verouderde verwachting dat een lastpijl de staaf selecteerde. De gebruikersfunctie
selecteert inmiddels bewust de lijn- of staafpuntlast zelf; de regressie bewaakt
nu die eis en alle twaalf tests zijn daarna afzonderlijk groen uitgevoerd.

De IFC4-export is aansluitend uitgebreid met `IfcStructuralSurfaceMember`,
`IfcFaceSurface`, een binnenlus per opening en `IfcStructuralSurfaceAction`
met `IfcStructuralLoadPlanarForce`. De ronde hoeken volgen dezelfde
kwadratische kromme als de viewer en worden in IFC met tien rechte segmenten
per hoek benaderd. Een plaatmodel zonder staven wordt nu ook geëxporteerd.
De gerichte 3D-IFC-graaftest controleert referenties, lussen, eenheden,
lastgroep en structurele export zonder lasten. Daarnaast bleven de twee
bestaande IFC-regressies groen met respectievelijk `210` en `109` controles.

De raamwerkrekenkern accepteert platen nog niet. Daarom blokkeert de app nu
iedere 3D-rekengang zodra een plaat of oppervlaktebelasting aanwezig is, met
de expliciete melding dat plaatkernel en mesh nog niet zijn aangesloten. De
native GUI-proef bevestigde deze foutmelding. Zo kan een gemengd model geen
schijnbaar geldig resultaat geven waarin de plaat en haar last stil ontbreken.
De compacte uitdraai blijft in die toestand wel bruikbaar als invoerrapport:
die vermeldt platen, openingen en oppervlaktebelastingen en markeert duidelijk
dat er nog geen plaatresultaten zijn berekend.

## Expliciete beperkingen van deze tussenstand

- De 3D-route berekent afzonderlijke belastinggevallen en NEN-EN 1990-
  combinaties. Een grafische omhullende over alle combinaties ontbreekt nog.
- Resultaatstations langs de staaf zijn aanwezig voor verdeelde lasten en
  puntlasten, inclusief stations direct vóór en na een lastsprong.
- De gewone EN 1992-liggerdoorsnedetoetsen gebruiken nu `My` en `Vz`.
  `Mz` telt mee in de dubbele-buigingstoets van §5.8 zodra volledige
  kolomgegevens aanwezig zijn. De afzonderlijke `Vy`-doorsnedetoets,
  EN 1992-torsie en torsie-dwarskrachtinteractie zijn nog niet geïmplementeerd.
- De bestaande betonkern kan kolomtoetsen uitvoeren wanneer de kolominvoer is
  vastgelegd, maar de ruimtelijke `N-My-Mz`-route en §5.8-uitkomsten vragen nog
  een onafhankelijk gepubliceerd 3D-referentiegeval.
- Platen, afgeronde openingen en oppervlaktebelastingen zijn nu volledig
  modelleerbaar, selecteerbaar, opslaanbaar en zichtbaar. Ze worden nog niet
  gemesht of meegenomen in de FEM-matrix; plaatspanningen, vervormingen en
  resultaatgradients vragen daarom nog een geverifieerde plaatkernel.
- De compacte HTML-uitdraai is aanwezig. Een vaste 3D-figuur in de PDF en een
  golden PDF-vergelijking zijn nog open.
