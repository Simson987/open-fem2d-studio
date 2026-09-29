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
| 18 knopen, 6 staven, 1 plaat met boogopening en oppervlaktebelasting: lasten verbergen vóór optimalisatie | 77,1 ms volledige scène-opbouw, 18 draw calls |
| Zelfde model na optimalisatie: lasten verbergen en terugzetten | 23,6 ms en 22,7 ms voor alleen de conditielaag; 0 en weer 9 selecteerbare lastobjecten |
| Zelfde model: oppervlaktebelasting na terugzetten via label selecteren | Belasting 1 geselecteerd; label bleef buiten de plaatopening |
| Plaat met gebogen opening: staaf tekenen tussen twee bestaande contourknopen in isometrisch aanzicht | Staaf 7 verbindt K11 en K10 exact; geen extra knopen; 6,2 ms incrementele staafopbouw en 0,1 ms knoopsnap |
| De nieuwe staaf met profielvolume op de zichtbare hartlijn aanklikken | Staaf 7 geselecteerd in 0,6 ms; een klik in het naastliggende plaatvlak selecteert de plaat |
| Op staaf 7 een lijnlast toevoegen en één lastpijl aanklikken | Last 8 over 10,5 m aangemaakt; één pijl selecteerde de volledige last in 1,7 ms |
| Schuin 3D-aanzicht, alle snaps uit: staaf vlak naast twee knopen van een verticale plaat tekenen, vóór correctie | Twee nieuwe knopen op circa Y = −10,5 m, hoewel de zichtbare plaat op Y = 0 m stond |
| Zelfde handeling na correctie | Twee afzonderlijke nieuwe knopen op Y = 0 m; het actieve tekenvlak was de plaat (normaal 0,1,0); 17,5 ms incrementele opbouw |
| Zelfde schuine aanzicht met knoopsnap weer aan | Staaf tussen K12 en K13 zonder extra knopen; 14,8 ms incrementele opbouw |
| Schuin 3D-aanzicht, snaps uit: twee klikken midden op een verticale plaat, vóór correctie | Nieuwe knopen op Y = −4,50 en −2,71 m; de zichtbare plaat lag op Y = 0 m |
| Zelfde handeling na correctie | K14 en K15 beide op Y = 0 m en staaf 7 tussen beide; tekenvlaknormaal (0,1,0), snapverwerking 0,10 en 0,20 ms |
| Isometrisch aanzicht, snaps uit: opening met twee rechte randen en één boog in verticale plaat | Opening 1 gesloten; K16–K20 alle op Y = 0 m; uitsparing zichtbaar in de plaat |
| Selectie in en naast de gebogen opening | Klik in uitsparing selecteerde niets (0,7 ms); klik op aangrenzende plaat selecteerde plaat 1 (0,9 ms) |
| Profielvolume uit en weer aan bij dezelfde plaat | Camera en doel bleven exact gelijk; weergaveverversing 24,8 en 33,0 ms |
| View “Boogopening iso” herstellen na vooraanzicht en verborgen knoopnummers | Oorspronkelijke cameracoördinaten en knoopnummers hersteld |
| Staafstart op de plek van een verborgen plaat, snaps uit | Camerawerkvlak (normaal 0,0,1); plaatvlak werd niet gebruikt, 0,10 ms snapverwerking |
| Zelfde plaat weer zichtbaar en staafstart binnen het plaatvlak | Plaatwerkvlak (normaal 0,1,0), nieuwe knoop op Y = 0 m, 0,20 ms snapverwerking; dubbele plaat-raycast bij klikken verwijderd |
| Isometrisch aanzicht, zoom op lege canvasruimte links van het model, vóór correctie | Eén zoomstap schoof vrijwel het hele raamwerk buiten het canvas |
| Zelfde zoom in een vers geladen build na correctie | Raamwerk bleef zichtbaar; anker `bounds-center`, 7,2 ms wielverwerking. Terugzoomen gebruikte hetzelfde anker; zoom op zichtbare geometrie gebruikte `geometry` (10,9 ms) |
| Voorbeeldmodel met 9 knopen en 6 staven: vanaf K3 een 3D-staaf naar een leeg punt tekenen | K10 op (0, 6, 5) m en staaf 7 (K3–K10) verschenen; 0,5 ms snapverwerking en 22,5 ms incrementele opbouw (`append-node-beam`) |
| De zojuist getekende profielstaaf in het canvas selecteren | Staaf 7 als geheel geselecteerd; 1,1 ms pick. Een eerste klik net boven het profiel selecteerde niets, zoals verwacht bij selectie op het profielvolume. |
| Vooraanzicht XZ: plaat met rechte randen en een boog maken in bestaand raamwerk | Plaat 1 gesloten op Y = 3 m, met vier randsegmenten waarvan één boog; 3,5 ms geometrie en 15,0 ms incrementele opbouw (`append-plate`). |
| In dezelfde plaat een opening met rechte randen en een boog tekenen | Opening 1 werd zichtbaar; klik in de uitsparing selecteerde niets (0,6 ms), klik op de aangrenzende plaat selecteerde plaat 1 (0,7 ms). |
| Na omschakelen naar isometrisch aanzicht profielvolumes en platen uit/aan zetten | Camerapositie `51,955772;36,955772;30,254123` m en doel `18;3;6` m bleven exact gelijk; platen verversen duurde 3,6 en 4,2 ms. |
| In hetzelfde aanzicht met het wiel op de gebogen plaat in- en uitzoomen | Zoomanker `geometry`; 15,4 ms en 6,2 ms wielverwerking. Camera en doel kwamen na terugzoomen exact op hun beginwaarden terug. |
| Plaat en knopen verbergen en op de oude plaatpositie klikken | Geen selectie (0,1 ms pick); na herstellen bleven camera en doel onveranderd. |
| Voorbeeldmodel met 13 knopen, 6 staven en 1 plaat: oppervlaktebelasting toevoegen | 7,1 ms voor alleen de oppervlaktebelasting; 9 selecteerbare lastobjecten. |
| Dezelfde belasting wijzigen van qz = −5 naar −7 kN/m² | 5,5 ms voor alleen de oppervlaktebelasting; label en eigenschappen tonen −7. |
| Belastingen verbergen en terugzetten | 19,9 en 29,0 ms voor de conditielaag; 0 en daarna weer 9 selecteerbare lastobjecten. |
| Tweede oppervlaktebelasting op dezelfde plaat in belastinggeval Q toevoegen | 10,9 ms voor alleen de oppervlaktebelasting; camera bleef op `18;-27,596945;2,5` m. Bij terugschakelen naar G verscheen alleen de G-belasting. |
| Geselecteerde Q-oppervlaktebelasting verbergen door naar G te wisselen, en G-belasting verbergen via Model-weergave | De verborgen belasting werd uit de selectie verwijderd; het eigenschappenpaneel toonde weer de neutrale selectietekst. |
| Model-weergave: op een plaat bij de cursor in- en weer uitzoomen | Zoomanker `geometry`, 6,7 en 6,0 ms; camera `18;-27,596945;2,5` m en doel `18;0;2,5` m kwamen exact terug. |
| In ingezoomd vooraanzicht een staaf van plaatknoop K13 naar K12 tekenen | Staaf 7 (K13–K12) verscheen zonder nieuwe knopen; 20,2 ms incrementele opbouw (`append-beam`). |
| In hetzelfde aanzicht profiel en selectiekader proberen | Klik midden op het zichtbare profiel selecteerde staaf 7; kader om het hele profiel selecteerde staaf 7 en beide eindknopen (0,7 ms). Een onvolledig kader selecteerde niets, overeenkomstig de huidige volledige-insluitingsregel. |
| Op plaat 1, boven staaf 7, een opening met drie rechte randen en één boog tekenen | K14–K18 lagen alle op Y = 0 m; de boog gebruikte K16 als stuurpunt. Opening 1 sloot in 6,8 ms (`update-plate`), waarvan 1,6 ms plaatgeometrie. |
| De nieuwe opening in vooraanzicht selecteren en naar isometrisch aanzicht wisselen | Klik in de uitsparing gaf geen selectie (0,2 ms), klik op plaat ernaast selecteerde plaat 1 (0,3 ms); de gebogen uitsparing bleef in het 3D-aanzicht zichtbaar. |

De lange constructie liet vóór de wijziging in commit `169ca9d5` bij snel
inzoomen nabij het uiteinde soms een leeg canvas zien. De zoom gebruikte de
diepte van het cameradoel in plaats van het zichtbare model. De wielzoom
verankert nu op geraakte geometrie of de modelbegrenzing. Dezelfde handeling
liet de constructie na de wijziging zichtbaar; ook in het vooraanzicht van een
gebogen plaat bleef het aangewezen punt onder de cursor.

Nog te meten: continue framesnelheid tijdens pannen/roteren, modellen met
duizenden zichtbare profielen en platen, en vergelijking op andere GPU's.
De eerste keer tonen van lasten na het openen van een model waarin ze al
verborgen waren, blijft een volledige opbouw (89,1 ms in dit testmodel);
daarna blijven de plaatmesh en lastsymbolen bij zichtbaarheidsschakels bestaan.
