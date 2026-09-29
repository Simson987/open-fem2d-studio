# 3D-GUI: handmatige verificatie en prestatienulmeting

Datum: 29 september 2026. Getest in de bestaande dev-app op een canvas van
800 × 480 CSS-pixels, met de meetwaarden uit `ThreeFrameCanvas`.
Dit zijn tijden voor afzonderlijke browseracties, geen FPS-meting of garantie
voor andere apparaten.

| Model en actie | Waarneming |
| --- | --- |
| 306 knopen, 206 staven, 238 lasten: kopie van 153 knopen en 103 staven | 75,7 ms scene-opbouw, 16 draw calls |
| Zelfde model: passend beeld | 1,2 ms cameratekening; alle constructieknopen bleven binnen het canvas |
| Zelfde model: 136 permanente lasten tonen | 60,2 ms opbouw, 55,7 ms render, 19 draw calls |
| Zelfde model: lijnlast selecteren met één klik | Belasting 157 als geheel geselecteerd; 1,2 ms pick |
| Zelfde model: lasten verbergen en opnieuw op dezelfde plek klikken | 0 selecteerbare lastobjecten; geen verborgen last geselecteerd |
| Zelfde model: tweemaal inzoomen bij een eindknoop | Knoop bleef binnen circa 2 px op dezelfde schermplek; de camera herstelde exact na terugzoomen |
| 3D-plaat met rechte randen en één boog tekenen | Plaat 2 gesloten; 5,2 ms opbouw en 0,5 ms plaatgeometrie |
| Die plaat opnieuw selecteren via het canvas | Hele plaat geselecteerd; 0,4 ms pick |

De lange constructie liet vóór de wijziging in commit `169ca9d5` bij snel
inzoomen nabij het uiteinde soms een leeg canvas zien. De zoom gebruikte de
diepte van het cameradoel in plaats van het zichtbare model. De wielzoom
verankert nu op geraakte geometrie of de modelbegrenzing. Dezelfde handeling
liet de constructie na de wijziging zichtbaar; ook in het vooraanzicht van een
gebogen plaat bleef het aangewezen punt onder de cursor.

Nog te meten: continue framesnelheid tijdens pannen/roteren, modellen met
duizenden zichtbare profielen en platen, en vergelijking op andere GPU's.
