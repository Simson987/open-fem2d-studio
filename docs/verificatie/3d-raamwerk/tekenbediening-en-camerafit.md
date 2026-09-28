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

Bij een gedraaide ronde doorsnede kon de conservatieve boundingbox groter
zijn dan het werkelijk getekende profiel. Daardoor werd een volledig zichtbaar
omkaderde ligger soms toch niet geselecteerd. De snelle boundingbox blijft
voor de meeste liggers volstaan; in grensgevallen controleert de selectie nu
de echte profielvertices. De regressieproef dekt zowel een losse ligger als
een GPU-batch. In de GUI bleef een gedeeltelijk kader over de IPE-ligger leeg;
een kader dat de zichtbare stalen liggers volledig omsloot selecteerde beide
liggers (en drie omkaderde knopen) in 0,7 ms. De batchproef met 235 staven
duurde na opwarming 4,3 ms.

In een berekend 3D-model overlapten vooraf 17 paren van 19 resultaat- en
toetslabels. De bijgewerkte weergave liet zeven resultaat- en toetslabels
zonder onderlinge overlap zien; samen met assen en profielnamen waren tien
labels zichtbaar zonder overlap. Ook na het wisselen van resultaatweergave en
zoomen bleef de zichtbare tekst vrij van overlap. Een nieuwe indeling van de
labels nam in deze proef 0,3 tot 1,9 ms in beslag. Minder dringende labels
worden alleen op het scherm verborgen; de resultaten en profielgegevens
blijven via selectie beschikbaar.

## Verborgen knopen tijdens staaftekenen

Met **Knopen** uitgeschakeld in **Weergave** en het staafgereedschap actief,
werd in het standaardmodel (negen knopen, zes staven) van knoop 3 naar de
positie van knoop 5 getekend. Vóór de correctie won de profielhit van de
knoopsnap: de bestaande staaf werd vlak bij het uiteinde gesplitst en er
ontstond een vrijwel samenvallende extra knoop (tien knopen, acht staven).
Na de correctie bleef het model op **negen knopen** en kwam er precies **één
staaf** bij. De nieuwe staaf eindigde op knoop 5; de toevoeging duurde in
deze GUI-proef 8,0 ms.

Daarna is op het midden van een bestaande staaf geklikt. Zonder knoop in de
snapzone werd die staaf nog steeds gesplitst en een aansluitende staaf
getekend: tien knopen en negen staven. De knoopsnap krijgt dus alleen
voorrang waar daadwerkelijk een bestaande knoop onder de cursor ligt.

## Groot model: selectie, snelheid en labels

Het bestaande vierlaagse verificatiemodel is opnieuw in de GUI geopend:
**100 knopen, 235 staven, 25 opleggingen en 72 lasten**. Een kader om de
volledige constructie selecteerde alle 235 stalen profielvolumes in 3,7 ms;
de verborgen knopen bleven buiten de selectie. De eerste volledige
scèneopbouw duurde 26,8 ms en gebruikte vijf tekenopdrachten. Een wielzoom
verschoof cameradoel en positie naar de cursor en tekende het gezoomde beeld
in 7,2 ms. Dit zijn eenmalige diagnostische metingen op de testmachine.

Met knoop- en staafnummers aan overlapten vóór de correctie vijf zichtbare
labels de canvasheader en één label de statusregel. De labelindeling houdt
nu ook de header, fitknop, status, toetslegenda en tijdelijke bedienpanelen
vrij. Bij dezelfde gezoomde stand bleven 67 nummerlabels zichtbaar en was
er **geen overlap** met die schermdelen; de indeling duurde 5,9 ms. Na
berekenen gaf de daklast opnieuw `umax = 0,09559 mm`. Met resultaat- en
toetslabels aan bleef de overlap ook na `Passend beeld` en een wissel naar
dwarskracht Vy nul. In die zwaardere resultaatstand duurde de labelindeling
13,2 tot 16,3 ms. Deze meting kwam uit een tussentijds vernieuwde
ontwikkelviewer waarin 359 label-elementen aanwezig waren. Na een volledige
herlaadbeurt had hetzelfde berekende model 140 label-elementen. Een
vervolgproef met die schone viewer liet de verborgen labels tijdens de
indeling ongemoeid en wijzigde hun CSS-status alleen waar nodig. Vier
opeenvolgende in- en uitzoomacties duurden voor de labelindeling 3,1–7,0 ms;
telkens bleef de overlap nul en kwamen labels bij inzoomen weer terug.
Voor- en isometrisch aanzicht (4,1 en 5,6 ms) en wisselen tussen wind en
daklast (6,9 en 5,6 ms) bleven eveneens zonder overlap. Bij de wissel van
belastinggeval bleef de camerapositie gelijk. Deze tijden zijn diagnostisch
en afhankelijk van de zichtbaarheidsinstellingen.

## Plaat met lijn- en boogranden

In het 3D-bovenaanzicht is een plaat getekend met drie rechte randsegmenten
en één boog via een afzonderlijk stuurpunt. Na sluiting toonde de GUI één
selecteerbare plaat met vier segmenten, één boog en een dikte van 0,2 m.
De toevoeging duurde 10,5 ms, waarvan 1,3 ms voor de plaatgeometrie.
Daarna is in hetzelfde vlak een opening met drie lijnen en één boog
getekend. De opening verscheen als echt gat; het bijwerken van de plaat
duurde 4,9 ms, waarvan 1,6 ms voor de geometrie. Een klik in het gat
selecteerde niets, een klik op het resterende plaatvlak selecteerde de
plaat in 0,3 ms.

Bij het toevoegen van een oppervlaktebelasting bleek het lastteken in de
opening te liggen: de oude positie was het gemiddelde van de buitenste
contourknopen en hoeft geen plaatmateriaal te zijn. De positie komt nu uit
een driehoek van het werkelijk gemeshte plaatvlak. In een schoon geladen
proefmodel met een gebogen buitenrand en opening stond de lastpijl zichtbaar
op het materiaal en was hij afzonderlijk selecteerbaar (1,4 ms hit-test).
De geometrieproef in
[`test-frame3d-plates-views.mjs`](../../../design-mockup/test-frame3d-plates-views.mjs)
controleert met raycasting dat de lastpositie ook bij een gebogen opening
op de plaat ligt.
