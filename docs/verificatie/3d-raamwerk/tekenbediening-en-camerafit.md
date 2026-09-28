# 3D-tekenbediening en camerafit

GUI-proef op 28 september 2026 met een klein 3D-model: tien knopen, een plaat
met gebogen buitenrand en opening, en twee toegevoegde staven. De proef gebruikt
de draaiende ontwikkelapp in een canvas van ongeveer 801 × 482 pixels.

| Handeling | Waarneming |
| --- | --- |
| Staaf tekenen tussen bestaande knopen 5 en 4 | Staaf 1 verschijnt; het aantal knopen blijft tien. Gemeten opbouw: 27,4 ms bij de eerste actie. |
| Staaf 1 aanklikken | De eigenschappen van staaf 1 verschijnen; selectie 0,8 ms en objectpicking 0,3 ms. De camera blijft staan. |
| `Passend beeld` | Camerafstand gaat van 2,000000 naar 2,630496; de volledige plaat en staven passen zichtbaar tussen de canvasheader en statusregel. |
| Tweede staaf tekenen tussen bestaande knopen 1 en 3 | Staaf 2 verschijnt; nog steeds tien knopen. Gemeten opbouw: 5,8 ms na opwarming. |
| Profielvolume uit- en weer inschakelen in **Weergave** | Beide omschakelingen tonen de juiste geometrie. Camerapositie en doel blijven gelijk. |

De camerafit reserveert ruimte voor de vaste bediening boven en onder het
canvas. Dit voorkomt dat een klein, plat model tegen de kopregel komt, ook
wanneer de eerdere minimumafstand van twee meter werd gebruikt.

De tijden zijn diagnostische browsermetingen van dit ene model en geen
prestatiegarantie. De bestaande geautomatiseerde 3D-conditie- en rookproeven,
TypeScriptcontrole en productiebuild zijn na de wijziging geslaagd.

## Cursorzoom, profielselectie en resultaatlabels

Een nieuwe GUI-proef gebruikte het standaardmodel met negen knopen, zes staven
en de stalen ligger **IPE330**. Bij een wielstap omhoog boven het rechterdeel
van het model verschoof de camera naar die cursorpositie. Het X-aslabel vlak
bij de cursor verplaatste daarbij circa 10 px horizontaal en 7 px verticaal,
terwijl het profiel veel groter werd. Wielzoomen gebruikt nu de cursor als
zoomanker.

In het selectiegereedschap leverde een klein kader dat slechts een deel van de
IPE330 bevatte **geen selectie** op. Een kader om het volledige geprojecteerde
profiel selecteerde staaf 3 en de twee eindknopen in 0,4 ms; de camerapositie
bleef gelijk. Een klik net naast de ligger maakte de selectie leeg, terwijl een
klik op het stalen profiel de eigenschappen van staaf 3 opende (picking 1,7 ms,
selectie 0,9 ms). De geometrieproef
[`test-frame3d-box-selection.mjs`](../../../design-mockup/test-frame3d-box-selection.mjs)
toetst ook de doorsnede in plaats van uitsluitend de hartlijn, en de
profielbatches die grote modellen gebruiken.
Een batch met 235 profielvolumes werd in de zelfstandige geometrieproef in
4,2 ms binnen een volledig kader geselecteerd; dit is een diagnostische
meting op de testmachine, geen ontwerplimiet.

In een berekend 3D-model overlapten vooraf 17 paren van 19 resultaat- en
toetslabels. De bijgewerkte weergave liet zeven resultaat- en toetslabels
zonder onderlinge overlap zien; samen met assen en profielnamen waren tien
labels zichtbaar zonder overlap. Ook na het wisselen van resultaatweergave en
zoomen bleef de zichtbare tekst vrij van overlap. Een nieuwe indeling van de
labels nam in deze proef 0,3 tot 1,9 ms in beslag. Minder dringende labels
worden alleen op het scherm verborgen; de resultaten en profielgegevens
blijven via selectie beschikbaar.
