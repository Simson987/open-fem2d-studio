# Groot 3D staalraam — verificatie en GUI-proef

Het project [`groot-staalraam.ifcfem2d`](groot-staalraam.ifcfem2d) bevat een raamwerk met drie niveaus op z = 0, 3,5 en 7 m. Op ieder niveau staan 4 × 4 knopen op x = 0, 3, 6, 9 m en y = 0, 4, 8, 12 m. Alle 16 voetknopen zijn ingeklemd. De 32 kolommen zijn HEA 200, de 72 liggers IPE 200; het materiaal is S235. Eigen gewicht staat voor deze afzonderlijke verificatie uit.

`test-frame3d-large-frame.mjs` controleert het projectbestand, bouwt via dezelfde TypeScript-adapter als de GUI de solverinvoer en rekent met de lokaal gebouwde Rust-kern. De kracht- en momentensommen hieronder volgen rechtstreeks uit de opgegeven lasten en knoopcoördinaten; ze gebruiken geen solveruitkomsten als verwachte waarde.

| Belastinggeval | Aangebracht | Verwachte som steunreacties | Verwacht steunmoment over (0,0,0) |
| --- | --- | --- | --- |
| Daklast | 16 × Fz = −20 kN | Fz = +320 kN, Fx = Fy = 0 | Mx = +1920 kNm, My = −1440 kNm, Mz = 0 |
| Horizontaal | 16 × Fx = +2 kN op z = 7 m | Fx = −32 kN, Fy = Fz = 0 | Mx = 0, My = −224 kNm, Mz = +192 kNm |
| Liggerlast | 12 × qz = −2 kN/m op 3 m | Fz = +72 kN, Fx = Fy = 0 | Mx = +432 kNm, My = −324 kNm, Mz = 0 |

Bij het steunmoment zijn zowel de reactiekoppels als de momenten van reactiekrachten om de oorsprong meegenomen. Onder de symmetrische daklast draagt ieder van de 16 voeten +20 kN verticaal. De lineaire solver leverde voor alle drie gevallen deze sommen binnen 10⁻⁴ kN en 10⁻³ kNm; de afzonderlijke verticale reacties onder de daklast weken minder dan 10⁻⁵ kN van 20 kN af. Relatieve lineaire solverresiduen lagen tussen 6,8 × 10⁻¹⁶ en 1,5 × 10⁻¹³.

De combinatie van daklast en horizontale last convergeerde in de tweede-orde-kern in drie iteraties. De gemelde amplificatie was 1,00669. **Verificatiepunt:** de som van de horizontale reacties was −32,17978 kN bij +32 kN aangebrachte kracht: 0,17978 kN, of 0,56%, onbalans. De tweede-orde-uitvoer heeft bovendien geen intern evenwichtsobject. Daarmee is deze combinatie nog niet onafhankelijk op evenwicht geverifieerd; gebruik haar niet als bewijs voor een ontwerpberekening totdat de reacties in de kern zijn herleid en gecorrigeerd. Convergentie alleen is hiervoor onvoldoende.

In de ontwikkel-GUI is het project geopend, zijn de 48 knopen, 104 staven, 16 opleggingen en 44 lasten zichtbaar, en is een IPE 200-volume door een muisklik als afzonderlijke staaf geselecteerd. De drie belastinggevallen zijn via de GUI berekend en de lijnlast is zichtbaar bij zijn eigen belastinggeval. Bij deze modelgrootte gebruikt de viewer profielinstancing: zes tekenopdrachten voor de ongelaste geometrie. Bij zichtbare daklast waren dat 38; een resultaatbeeld met moment My vroeg eerst 612 tekenopdrachten. Na batching vanaf 100 staven vroeg hetzelfde beeld 200 tekenopdrachten en circa 94 ms scène-opbouw, tegen circa 122 ms ervoor. Het aantal tegelijk getoonde unity-checklabels daalde van 104 naar 15. Deze tijden zijn lokale GUI-metingen, geen gegarandeerde grenswaarde op andere hardware.

De verificatie omvat globale statica, opslag en ophalen van het 3D-project, een convergentiecontrole en de GUI-weergave. Zij bewijst geen volledige normtoetsing, geen plaat- of volumeelementen en geen algemene geldigheid van de tweede-orde-reacties.
