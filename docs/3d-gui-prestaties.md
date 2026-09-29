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
| Zeven platen met boogopening in 3D kopiëren, daarna de groep van zeven nogmaals | 28 platen, 261 knopen en 56 oppervlaktebelastingen (28 per belastinggeval); alle uitsparingen bleven zichtbaar. Bij 14 platen 132,1 ms volledige opbouw (77,2 ms WebGL-render); bij 28 platen 90,8 ms (42,6 ms WebGL-render). Dit zijn losse metingen, met variatie door de renderfase. |
| Passend beeld op het model met 28 platen | 4,6 ms cameratekening bij 74 draw calls; de volledige rij platen bleef in het canvas. Zoom op de laatste plaat duurde 7,6–9,7 ms per stap. |
| In de klein geprojecteerde boogopening van plaat 28 klikken, vóór selectiecorrectie | De 14px-selectiezone van een randknoop koos K258/K261 terwijl de klik op de witte uitsparing lag. |
| Dezelfde handeling na een 7px-selectiezone, met behoud van 14px tekensnap | Midden in de uitsparing gaf geen selectie; zichtbare K254 werd op 0,31 px afstand wel geselecteerd. Staaf tekenen vanaf circa 10 px naast K254 gebruikte nog steeds K254 als begin, zonder nieuwe knoop. |
| 28 platen met boogopening: van G naar Q wisselen vóór laagverversing | 142,6 ms volledige scène-opbouw; de 28 plaatlastlabels werden opnieuw opgebouwd. |
| Zelfde model na laagverversing: tussen G, Q en Model wisselen | G↔Q gebruikte `conditions` (53,4–77,9 ms), naar Model 18,2 ms; camera bleef exact gelijk. Geselecteerde G-plaatlast 55 werd bij Q losgelaten en Q-plaatlast 56 verscheen. |
| Zelfde model: lasten via Weergave verbergen en terugzetten | 25,7 en 70,8 ms voor de conditielaag; 0 en opnieuw 28 zichtbare plaatlastlabels, zonder verplaatsing van de camera. |
| 28 platen en 261 knopen: staaf tussen bestaande K254 en K253 tekenen | Staaf 8 zonder nieuwe knopen; 9,4 ms incrementele staafopbouw. Het zichtbare profiel was daarna in 0,6 ms selecteerbaar. |
| Zelfde model ingezoomd op plaat 28, alle snaps uit: staaf vanaf twee vrije punten in de plaat tekenen | K262 op (19,974; 135; 10,250) m en K263 op (17,142; 135; 9,930) m; beide liggen op het plaatvlak Y = 135 m. Staaf 9 verscheen met `append-node-beam` in 6,8 ms; snapverwerking 0,2 ms. De actieve tekenvlakbron was `beam-plate` met normaal (0,1,0). Na de controle zijn alle snaps weer aangezet. |
| 28 platen, 263 knopen en 9 staven: op plaat 28 bij de cursor in- en uitzoomen | Zoomanker `geometry`; 22,0 ms voor de eerste ingezoomde stap en 5,3 ms voor terugzoomen. Camera `(25,626232; 137,107863; 13,549842)` m en doel `(18,795589; 130,277220; 8,670811)` m kwamen exact terug; labels waren na iedere stap weer zichtbaar. |
| Zelfde model: view “Groot model plaat 28” opslaan, naar vooraanzicht wisselen, knoopnummers verbergen en view herstellen | De oorspronkelijke isometrische camera en doel kwamen exact terug; knoopnummers stonden weer aan. De view bleef in de lijst met opgeslagen 3D-weergaven. |
| 28 platen: met rastersnap maar zonder knoopsnap staaf 10 op plaat 28 tekenen, van 264 naar 265 knopen | K264 op (20,5; 135; 10) m en K265 op (18; 135; 9,5) m; beide punten bleven op Y = 135 m. Bij 265 knopen veranderde de knooplabelstap van 11 naar 12: vóór correctie 123,5 ms volledige opbouw (`node-labels` fallback), na correctie 12,7 ms `append-node-beam`. Alle 23 knooplabels volgden de nieuwe stap, inclusief K265 en zonder het oude K254-label. Knoopsnap is daarna weer aangezet. |
| Ingezoomde plaat 28: profiel van staaf 10 door halftransparante plaat selecteren | Raycast raakte eerst de plaat op 2,306 m en daarna het profiel op 2,577 m. Vóór correctie werd de plaat gekozen; daarna staaf 10 in 0,8 ms, ook na de dieptebegrenzing. Een klik naast het profiel koos nog steeds plaat 28 (0,4 ms); een klik in de gebogen opening koos niets (0,2 ms). |
| 28 gekopieerde platen met gebogen openingen: een nieuwe plaat met boogrand tekenen | Vóór correctie werd de contour geweigerd door een ongeldige randknoop in plaat 2: kopiëren had de getekende contouren niet naar de nieuwe knoopnummers vertaald. Na herstel van kopiëren én bestaande kopieën ontstond plaat 29 met vier segmenten en één boog. De plaat werd geselecteerd en getekend; incrementele `append-plate`-opbouw duurde 7,2 ms. De regressietest omvat ook een gekopieerde boogcontour en boogopening. |
| Plaat 29: rechthoekige opening tekenen en selectie controleren | Vier nieuwe knopen (K271–K274) vormden opening 1. De uitsparing was wit in de 3D-weergave. Klik in de uitsparing hief de plaatselectie op; klik op het aangrenzende plaatvlak selecteerde plaat 29 in 0,3 ms. De bijgewerkte plaatlaag gebruikte `update-plate` in 5,2 ms. |
| Bij ingezoomde plaat 29 knoopnummers verbergen en terugzetten via Weergave | De 3D-camera bleef exact op positie `(12,275089; 131,421150; 10,740528)` m en doel `(9,459784; 128,605845; 8,729595)` m. Het uitschakelen ververste alleen `node-labels` in 4,2 ms. Zoeken op `platen` liet alleen de optie Platen zien; het filter is daarna gewist. |
| Plaat 29 met boogrand en opening via het 3D-lint kopiëren | Met ΔZ = 2 m ontstond plaat 30. De geselecteerde kopie heeft vier randsegmenten, één boog en één opening; negen contourknopen K275–K283 werden meegekopieerd. De oorspronkelijke plaat en haar uitsparing bleven zichtbaar. |
| Op de opening van plaat 29 een staaf tussen bestaande K271 en K272 tekenen | Staaf 11 (IPE 200) werd met knoopsnap op beide openingsknopen geplaatst zonder nieuwe knopen; `append-beam` duurde 6,1 ms. Het zichtbare profiel was daarna met één klik op het plaatvlak selecteerbaar. |
| Staaf 11 een lokale z-lijnlast in geval Q geven | Het snelle veld toonde −2,5 kN/m maar sloeg vóór de correctie ten onrechte de standaardwaarde −5 kN/m op: de veldnamen misten de `q`. Na correctie werd `qz = −2,5→−2,5 kN/m` opgeslagen; omzetten naar lokale y en terug, en een tijdelijk variabel eind van −4 kN/m, gaven telkens de ingevoerde waarden. |
| Dezelfde lijnlast toevoegen, wijzigen en verwijderen in het model met 30 platen | Vóór gerichte verversing veroorzaakte een wijziging volledige opbouwen van circa 80–130 ms. Daarna ververste alleen de conditielaag: 21,8–24,4 ms voor wijzigen, 22,3 ms voor toevoegen en 22,6 ms voor verwijderen. De camera bleef op dezelfde positie. De tijdelijke tweede lijnlast is na de test verwijderd. |
| Bij de belaste staaf 11 op plaat 29 één stap in- en uitzoomen rond de cursor | Beide wielacties ankerden op `geometry` en duurden 5,8 en 6,8 ms. De camera keerde exact terug naar positie `(12,275089; 131,421150; 10,740528)` m en doel `(9,459784; 128,605845; 8,729595)` m; de last bleef zichtbaar. |
| Belastingpijl 8 selecteren, naar Model schakelen en op dezelfde plaats klikken, daarna Q herstellen | De zichtbare pijlpunt koos staafbelasting 8. Model maakte de last onzichtbaar, wiste de lastselectie en bracht het aantal aanklikbare lastobjecten op nul in 8,4 ms; dezelfde klik koos alleen plaat 29. Na terugschakelen naar Q koos de klik opnieuw staafbelasting 8. |
| Met links een selectiekader rond de opening van plaat 29 slepen | De groep bevatte vier knopen en staaf 11. De plaat viel buiten het getrokken kader en werd terecht niet opgenomen. Camera en doel bleven exact ongewijzigd; de linkermuisactie draaide het beeld niet. |
| Staaf 11 met beide openingsknopen 0,5 m in X verplaatsen en ongedaan maken | K271/K272 veranderden van X = 6,5/5,5 naar 7,0/6,0 m. Opening en staaf bleven zichtbaar en geldig. Ongedaan maken herstelde beide coördinaten exact. Verplaatsen en herstellen vroegen nog een volledige scène-opbouw van 90,3 en 72,1 ms; dit is een overgebleven optimalisatiepunt voor gedeelde plaat- en staafknopen. |
| Nieuw model met 320 knopen, 192 staven en 8 platen: plaatknoop K37 0,5 m verplaatsen en terugzetten | Voor de gerichte plaatverversing duurde de volledige scène-opbouw 113,2 en 109,0 ms. Daarna gebruikte dezelfde GUI-actie `move-nodes`: 15,8 ms voor verplaatsen en 14,6 ms voor ongedaan maken. Plaat 1 bleef aanwezig en was na inzoomen opnieuw via het canvas selecteerbaar. De knoopcoördinaten keerden exact terug en de camera bleef op positie `(210,241262; 349,991262; 147,279473)` m met doel `(15,25; 155; 8)` m. |
| Zelfde model: staafknoop K3 met zichtbare staafnummers 0,5 m verplaatsen en terugzetten | Met lokale staafassen tijdelijk verborgen werkte de incrementele route in 9,7 en 7,9 ms. De schermposities van de betrokken staafnummers veranderden mee; K3 keerde terug naar `(0; 0; 5)` m. Daarna zijn de lokale staafassen weer aangezet, zonder cameraverplaatsing. |
| Zelfde model: staafknoop K3 met zichtbare lokale staafassen verplaatsen en terugzetten | De drie lokale aslijnen werden bij de betrokken staven bijgewerkt via `move-nodes` in 11,0 en 11,7 ms. K3 keerde terug naar `(0; 0; 5)` m; de camera bleef gelijk. |
| Zelfde model na tekenen van staaf 193 tussen bestaande plaatknopen K38 en K37 | Het model had 320 knopen, 193 staven en 8 platen. Verplaatsen van gedeelde knoop K37 met 0,5 m in X en ongedaan maken gebruikte `move-nodes` in 6,3 en 7,3 ms, met lokale assen aan. Plaat en staaf bleven zichtbaar; K37 keerde terug naar `(-5,5; 15; 16)` m en de ingezoomde camera bleef op `(24,461721; 67,954864; 25,191545)` m met doel `(10,809388; 54,302532; 15,439879)` m. |
| Zelfde model: staafnummers via Weergave uit- en weer aanzetten, daarna K3 verplaatsen | Het terugzetten van de nummers ververste alleen `beam-labels` in 11,4 ms. Na verplaatsen van K3 veranderden de schermposities van nummers (1) en (3) mee via `move-nodes` in 6,3 ms; ongedaan maken duurde 6,6 ms. K3 keerde terug naar `(0; 0; 5)` m. |

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
