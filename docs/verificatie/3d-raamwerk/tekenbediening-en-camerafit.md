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
