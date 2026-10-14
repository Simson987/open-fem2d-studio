# Windnormen: inventaris voor issue #69

Peildatum: 2026-10-09. Dit document is de bron- en implementatieadministratie
voor de internationale windgenerator. Een vermelde norm is **niet** automatisch
vrijgegeven als rekenroute. Een rekenroute wordt pas selecteerbaar wanneer de
geldige editie, nationale keuzes, kaartgegevens, gebruiksrechten, voorbeelden,
combinatieregels en 2D/3D-pariteit zijn gecontroleerd.

## Gemeenschappelijk gegevenscontract

Voor **iedere** route zijn deze gegevens nodig:

1. Toepassingsgebied, jurisdictie, uitgave, wijzigingen en peildatum van de
   toepasselijkheid. Nationale of regionale vaststelling is apart vast te leggen.
2. Basiswindsnelheid of basisdruk inclusief definitie van middelingsduur,
   referentiehoogte, terugkeerperiode, risico-/gevolgklasse en een herleidbare
   bron voor de kaartwaarde. Een ontbrekende kaartwaarde is een invoerfout.
3. Terrein- en hoogteprofiel, topografie/orografie, windrichting en eventuele
   seizoens- en dynamische/resonantiecorrectie.
4. Buiten- en binnendrukcoëfficiënten, zones, referentieoppervlakken, vrijstaande
   daken en drukrichting. De route levert een oppervlaktebelasting en metadata
   voor dezelfde 2D- en 3D-lastafdracht.
5. De toepasselijke UGT/BGT- of andere normcombinaties, plus rapportvermelding
   van alle waarden, aannames en bronverwijzingen.
6. Beschikbaarheid en licentie van normtekst, kaartdata en uitgewerkte
   voorbeelden. Voor commerciële of anderszins beperkte bronnen worden geen
   kaarten of tabellen zonder toestemming in de repository overgenomen.

Het huidige Nederlandse `NEN-EN 1991-1-4+NB`-pad blijft de enige uitgewerkte
route. De toekomstige neutrale kern krijgt expliciete eenheden en een
`codeId`, `edition`, `jurisdiction`, `source`, `referenceWind`, `pressureProfile`,
`zones`, `coefficients`, `direction`, `loadCases` en `combinationRule`.
Een standaardwaarde uit de Nederlandse bijlage mag nooit stilzwijgend voor
een andere jurisdictie worden gebruikt.

## CEN-landen

[CEN noemt 34 lidlanden](https://www.cencenelec.eu/about-cen/); de
[ledenlijst](https://www.cencenelec.eu/media/CEN-CENELEC/Events/Webinars/2025/2025-09-08_webinar_unlocking_cra_iec62443-series-for-cra.pdf)
bevestigt de onderstaande landen. Volgens het
[JRC](https://eurocodes.jrc.ec.europa.eu/resources/eurocodes-your-country)
staan nationale keuzes gewoonlijk in een nationale bijlage van de nationale
normalisatie-instelling. Lidmaatschap bewijst niet welke editie of bijlage
juridisch op een concreet project van toepassing is. `Te verifiëren` betekent
dat de bijlage en alle NDP's nog moeten worden vastgesteld; de route is uit.

| ISO | Land | Route | Bijlage/NDP's |
| --- | --- | --- | --- |
| AT | Oostenrijk | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| BE | België | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| BG | Bulgarije | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| HR | Kroatië | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| CY | Cyprus | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| CZ | Tsjechië | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| DK | Denemarken | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| EE | Estland | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| FI | Finland | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| FR | Frankrijk | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| DE | Duitsland | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| GR | Griekenland | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| HU | Hongarije | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| IS | IJsland | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| IE | Ierland | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| IT | Italië | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| LV | Letland | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| LT | Litouwen | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| LU | Luxemburg | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| MT | Malta | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| NL | Nederland | NEN-EN 1991-1-4 + NB | Bestaande route; editie en kaartrechten auditen |
| NO | Noorwegen | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| PL | Polen | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| PT | Portugal | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| MK | Noord-Macedonië | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| RO | Roemenië | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| RS | Servië | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| SK | Slowakije | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| SI | Slovenië | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| ES | Spanje | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| SE | Zweden | EN 1991-1-4 + nationale bijlage | Te verifiëren |
| CH | Zwitserland | EN-route onderzoeken; lokale ontwerpregels apart verifiëren | Te verifiëren |
| TR | Turkije | EN-route onderzoeken; lokale ontwerpregels apart verifiëren | Te verifiëren |
| GB | Verenigd Koninkrijk | EN 1991-1-4 + nationale bijlage | Te verifiëren |

De [tweede generatie Eurocodes](https://eurocodes.jrc.ec.europa.eu/second-generation-eurocodes)
heeft volgens het JRC een uiterste nationale publicatiedatum van 30 september
2027 en een uiterste intrekkingsdatum voor conflicterende eerste-generatieteksten
van 30 maart 2028. Elke landroute moet daarom een **uitgave** en een
**toepassingsdatum** dragen, zonder globale automatische omschakeling.

## Andere hoofdregio's

| Gebied | Bevestigde bron / status | Eerst te verifiëren |
| --- | --- | --- |
| VS | [ASCE/SEI 7-22](https://www.asce.org/publications-and-news/codes-and-standards/asce-sei-7-22); de [ASCE Hazard Tool](https://www.asce.org/publications-and-news/asce-hazard-tool/about/) levert locatiespecifieke windsnelheden als 3-secondenvlaag op 10 m voor exposure C. De [API](https://www.asce.org/publications-and-news/asce-hazard-tool/api) biedt 7-22-winddata met een sleutel en een afzonderlijk prijs-/gebruikstraject | Plaatselijke codeadoptie, API-overeenkomst en kaartrechten, risicocategorie, hoofdstukken 26–31, combinaties en voorbeeld; de gratis interactieve tool is geen toestemming om data in de app te bundelen |
| Canada | [NBC 2025](https://nrc.canada.ca/en/certifications-evaluations-standards/codes-canada/codes-canada-publications/national-building-code-canada-2025) is als [gratis PDF](https://nrc-publications.canada.ca/eng/view/object/?id=adf1ad94-7ea8-4b08-a19f-653ebb7f45f6) bij NRC beschikbaar; de [structurele commentaren](https://www.nrc.canada.ca/en/certifications-evaluations-standards/codes-canada/codes-canada-publications/structural-commentaries-users-guide-national-building-code-canada-2020-part-4-division-b) zijn voor NBC 2020. [Ontario Regulation 163/24](https://www.ontario.ca/laws/regulation/240163) adopteert NBC 2020 met Ontario-wijzigingen, dus de proefkern NBC 2025 is daar geen geldende projectroute | Adoptie per provincie/territorium en vergunning, kaartwaarde q, tabellen/drukzones, combinaties, uitgewerkt voorbeeld en gebruiksrechten |
| Australië en Nieuw-Zeeland | [AS/NZS 1170.2:2021](https://www.standards.org.au/news/update-to-the-go-to-combined-wind-actions-standard) | Landelijke wijzigingen/adoptie, windregio's, kaartrechten, combinaties |
| India | [IS 875 (Part 3):2015](https://standards.bis.gov.in/website/standard-details?encryptedId=eyJpdiI6Ik9ZZXZxVC9pWkJhZWorZjFBejJmb3c9PSIsInZhbHVlIjoidjZkeXJEeEpHeS9oT1dPQnR3cWVrdz09IiwibWFjIjoiMWZhYzY4MGUxOGRjNmZkNzQ5ZWUyZWNhM2NhMDZmM2IzNDIxMDc2NTdjMzJkYWEzMzc5ZjM5OTM5OGRkN2NlYSIsInRhZyI6IiJ9) met wijzigingen 2016 en 2020, door BIS herzien in 2025 | Kaart, alle factoren, gebruiksrechten, voorbeeld |
| Japan | [AIJ Recommendations for Loads on Buildings (2015)](https://www.aij.or.jp/books/productId/590069/) en [AIJ-Wind2015](https://news-sv.aij.or.jp/kouzou/s10/AIJ_Wind.html) | Status van nieuwere editie, ontwerpbereik, datarechten, voorbeeld |
| China | [GB 50009-2012](https://sjw.nanjing.gov.cn/tzgg/202308/P020230816631671814813.pdf) (gebouwbelastingen) wordt in de officiële [Shenzhen-windrichtlijn](https://zjj.sz.gov.cn/attachment/1/1374/1374421/10938283.pdf) naast de verplichte [GB 55001-2021](https://zjj.nc.gov.cn/nczfbzglj/yhbl/202404/809c293719804313a5f715512234e2e6.shtml) genoemd; die laatste geldt sinds 1 januari 2022 en gaat bij strijdige bepalingen voor | Verifieer de actuele landelijke en lokale regels per project, de windkaart en regionale aanvullingen, de combinatievoorschriften, rekenvoorbeelden en rechten op hergebruik. De [openbare SAMR-database](https://openstd.samr.gov.cn/bzgk/std/std_list?p.p1=0&p.p2=%E5%BB%BA%E7%AD%91%E7%BB%93%E6%9E%84%E8%BD%BD%E8%8D%B7%E8%A7%84%E8%8C%83gb50009-2012&p.p90=circulation_date&p.p91=desc) sluit bouwstandaarden expliciet uit; geen 0 treffers als bewijs van vervallen editie gebruiken |
| Zuid-Afrika | De [Government Gazette van 2017](https://www.gov.za/sites/default/files/gcis_document/201710/41164gen807.pdf) vermeldt `SANS 10160-3:2017`, editie 2, voor wind op gebouwen en industriële constructies; [SABS](https://www.sabs.co.za/purchase-standard) verkoopt de normen | Actuele uitgave en wijzigingen bij SABS controleren (een [recente Eskom-aanbesteding](https://www.etenders.gov.za/home/Download?blobName=d707f571-aa81-4d24-a4fb-9aec29bd03a1.pdf&downloadedFileName=Technical+Specification.pdf) noemt 2019), evenals kaart- en tabelrechten, dynamisch toepassingsgebied, combinaties en uitgewerkt voorbeeld |
| Brazilië | [ABNT NBR 6123:2023](https://site.abece.com.br/em-vigor-a-nova-nbr-6123/) (*Forças devidas ao vento em edificações*) is op 20 december 2023 gepubliceerd ter vervanging van de editie 1988; [ABNT verkoopt de norm via haar catalogus](https://www.abntcatalogo.com.br/pnm.aspx?Q=MVV2emxDaHQ5UEoyVTVnczBrVDBPVm5Gamw4dzczeG5HMzJjczU1ZTBMMD0=) | Controleer eventuele correcties en lokale toepassing, windkaart, factoren, dynamische methode, combinaties, uitgewerkt voorbeeld en software-/kaartrechten. De norm is via aankoop beschikbaar; neem geen tabellen of kaart zonder toestemming over |
| Zuid-Korea | De [officiële KDS-catalogus](https://standard.go.kr/KSCI/technologyIntro/getTechnologyDetailView.do?trgId=0000000026&trgReformNo=0006) noemt `KDS 41 12 00` (ontwerpbelastingen voor gebouwen) als onderdeel van de bouwconstructieregels | Windhoofdstuk en geldige revisie apart vaststellen; kaarten, gebruiksrechten, combinaties en voorbeeld |
| Mexico | De [autoriteit van Mexico-Stad](https://www.isc.cdmx.gob.mx/directores-res/cursos-de-actualizacion-2022/normas-tecnicas-complementarias-2023) publiceert de NTC 2023; de [federale publicatie](https://dof.gob.mx/normasOficiales/9463/sedatu/sedatu.html) verwijst voor regionale windsnelheden naar het windhandboek van CFE | Per deelstaat/gemeente toepasselijke regel en editie, CFE-kaartrechten, NTC-windbijlage, combinaties en voorbeeld; Mexico-Stad niet als landelijke standaard behandelen |
| Saoedi-Arabië | Het [Saudi Building Code Center](https://sbc.gov.sa/ar/bc/pages/buildingcode/BCDetails.aspx?codeId=501&year=2018) noemt `SBC 301` voor constructieve belastingen, aardbevingen en wind en vermeldt de 2024-uitgave met toepassing vanaf 30 juni 2025 | Geldige editie per project, windkaart, volledige methode, rechten, combinaties en voorbeeld; niet gelijkstellen aan ASCE zonder nationale wijzigingen te controleren |
| Oman | Het [Ministerie van Huisvesting en Ruimtelijke Ordening](https://mohup.gov.om/en/open-data/building-code) publiceert de `2025 Oman Building Code`. [Hoofdstuk 16 en de referentielijst](https://mohup.gov.om/pdf/open-data/codes/buildings.pdf) bevatten lokale basiswindsnelheden per stad en risicocategorie in tabel 1609.1.1 en verwijzen voor de windbepalingen naar ASCE/SEI 7-16 met Supplement 1 | Inwerkingtreding en plaatselijke toepassing per vergunning verifiëren, evenals terreincategorie, cyclooncriteria, combinaties, rekenvoorbeeld en rechten op hergebruik van de stadstabel. De Omani waarden zijn geen ASCE/SEI 7-22-kaartwaarden |
| VAE — Dubai | [Dubai Municipality](https://www.dm.gov.ae/municipality-business/planning-and-construction/dubai-building-code-2/) publiceert de `Dubai Building Code (2021)` met voorbehouden rechten. Dezelfde instantie biedt ook een afzonderlijke [Dubai Wind Code](https://dmpmedia.dm.gov.ae/uploads/2020/11/DubaiWindCode6-2.pdf) aan, maar de PDF draagt expliciet `Draft Copy` en het jaartal 2013 | Eerst vaststellen welke windbepalingen en versie onder de geldende DBC zijn aangewezen, en of de oudere concepttekst nog toepasselijk is. Daarna basiswind, combinaties, voorbeeld en software-/datarechten controleren; de concepttekst niet als vrijgegeven berekenroute behandelen |
| VAE — Abu Dhabi | De [DMT-bibliotheek BINAA](https://binaa.dmt.gov.ae/) biedt de `Abu Dhabi International Building Code` (ADIBC) als afzonderlijke bouwcode aan; ook de [officiële constructeurskwalificatie](https://pages.dmt.gov.ae/en/Structural-Engineering-Consultants-Exam) noemt ADIBC als bron. De [ADIBC-uitgave van 2013](https://www.dmt.gov.ae/-/media/Project/DMT/DMT/Codes/ADIBC_2013_bookmarked.pdf) is beschikbaar, maar bewijst niet welke editie nu geldt | Geldige ADIBC-editie en vergunningsregels in de actuele bibliotheek verifiëren; daarna het windhoofdstuk, de lokale windsnelheid, aangewezen IBC/ASCE-uitgave, combinaties, voorbeeld en hergebruikrechten. Geen Dubai- of historische 2013-waarden stilzwijgend overnemen |
| Qatar | De [Qatar General Organization for Standardization](https://qcs.qs.gov.qa/QCS2024/QCSProfile/files/basic-html/page3.html) vermeldt `QS 27:2024`, *Qatar Construction Specifications 2024*, als technische leidraad en Qatarese standaard die `QS 27:2014` vervangt. De [officiële omslag](https://qcs.qs.gov.qa/QCS2024/QCSProfile/files/basic-html/page1.html) noemt `All rights reserved`; de [documentgeschiedenis](https://qcs.qs.gov.qa/QCS2024/QCSProfile/files/basic-html/page16.html) noemt de nieuwe standaard vrijwillig | Per project en vergunning vaststellen welke technische windregels gelden. Windhoofdstuk, kaartwaarden, terrein, drukcoëfficiënten, combinaties, rekenvoorbeeld en hergebruikrechten zijn niet geverifieerd; de QCS-editie alleen is nog geen berekenroute |
| Bahrein | Het officiële [Benayat-portaal](https://www.benayat.bh/building-permits/public/building-codes) vermeldt `Building Code v2.0` met publicatiedatum 14 augustus 2024. Het [ministerie](https://www.mun.gov.bh/newportal/en/node/4249) noemt de bijgewerkte uniforme bouwvergunningsleidraad versie 2.0 voor het land | Eerst de constructieve windbepalingen en hun geldige versie uit de volledige bouwcode halen; daarna basiswind/kaart, terrein, coëfficiënten, combinaties, uitgewerkt voorbeeld en software-/datarechten vaststellen. De portaalvermelding bewijst geen specifieke windmethode |
| Overige Golfstaten en regio's | Landelijke of lokale windroutes nog niet voldoende geïnventariseerd | Per rechtsgebied norm, editie, lokale adoptie en kaartbron; Dubai en Abu Dhabi zijn afzonderlijke routes, en Qatar/Bahrein zijn nog niet als berekenroute vrijgegeven |
| Algemeen kader | [ISO 4354:2009](https://www.iso.org/cms/live/live/en/sites/isoorg/contents/data/standard/03/88/38882.html) is volgens ISO nog gepubliceerd en in revisie | Geen landcode of kaartbron; alleen gebruiken na expliciete projectkeuze |

## Voorlopige implementatievolgorde

### Canada: vastgestelde eerste rekenstap

In de officiële [NBC 2025 Volume 1, Divisie B §4.1.7.1–4.1.7.3](https://nrc-publications.canada.ca/eng/view/ft/?id=adf1ad94-7ea8-4b08-a19f-653ebb7f45f6)
staat voor de statische procedure `p = Iw q Ce Ct Cg Cp` en voor binnendruk
`pi = Iw q Cei Ct Cgi Cpi`. `q` heeft hier een jaarlijkse
overschrijdingskans van 1/500; dit is geen Nederlandse `q_p` en geen
ASCE-driesecondenvlaag. Open en ruw terrein hebben afzonderlijke
hoogteprofielen; tussenliggende terreinen vergen een passende interpolatie.
Voor dynamisch gevoelige gebouwen volstaat deze statische procedure voor de
hoofddraagconstructie niet. De gratis leesbaarheid van de PDF is nog geen
bevestiging van hergebruik van kaart- en tabeldata in software. Daarom is
alleen een formulekern met expliciet opgegeven bronwaarde in voorbereiding;
de Canadese route blijft uit de keuzelijst tot de volledige vrijgavepoort is
gehaald.
De kern bevat inmiddels ook de afzonderlijke `C_p`-formules voor de
hoofddraagconstructie uit §4.1.7.5(2)–(3), met de afstand vanaf de loefrand
voor het dak. De alternatieve `C_g C_p`-tabellen voor lage gebouwen uit
§4.1.7.6, lokale bekledingszones, binnendrukklassen en hun datarechten zijn
nog niet geïmplementeerd.
De topografiekern volgt §4.1.7.4 voor een tweedimensionale heuvel,
tweedimensionale steilrand en driedimensionale axiaalsymmetrische heuvel. De invoer
legt hoogte, halve-hoogteafstand, afstand en zijde van de top en hoogte boven
maaiveld vast. `Lh` is minstens `2Hh`; buiten de invloedslengte wordt de
snelheidstoename op nul begrensd. De functie geeft `Ct`, de snelheidstoename
en de normbron terug. De projectroute wordt hiermee nog niet vrijgegeven.
Voor de hoofddraagconstructie berekent een envelopfunctie beide grenzen van
de binnendrukcoëfficiënt, zodat de maatgevende positieve en negatieve
nettodruk zichtbaar zijn. De coëfficiëntgrenzen en hun bron worden expliciet
aangeleverd. Voor het rechthoekige vlakplan kan ook een van de drie
gebouwopeningsklassen uit §4.1.7.7 worden gekozen. De klasse vereist
projectbewijs voor de verdeling en omvang van kleine openingen, het ontbreken
van significante openingen of stormvaste sluiting, dan wel het open blijven
van grote openingen. De tabelgrenzen en bewijsbron reizen met elk drukgeval
mee; de klasse wordt nog niet automatisch uit de modelgeometrie afgeleid.
De [NRC-publicatie](https://nrc-publications.canada.ca/eng/view/ft/?id=adf1ad94-7ea8-4b08-a19f-653ebb7f45f6)
vermeldt dat commerciële reproductie van beschermd NBC-materiaal toestemming
vereist; hergebruik van tabellen en kaarten is daarom nog een vrijgavepunt.
De referentiehoogten voor buiten- en binnendruk worden volgens §4.1.7.3(6)–(7)
uit de gebouwgeometrie afgeleid: lage gebouwen gebruiken de dakmiddelhoogte
met een ondergrens van 6 m; andere gebouwen onderscheiden loef-, lij- en
zijgevel/dak. Voor gebouwen hoger dan 20 m vraagt een dominante opening
expliciet om de middelhoogte van die opening. De gekozen hoogten en bron
reizen met de drukuitkomst mee; dit maakt de Canadese route nog niet selecteerbaar.
Een zuiver druk- en vlakplan combineert nu de bestaande NBC-kern voor een
rechthoekig gebouw met plat dak waarvoor H ≤ 20 m en H kleiner is dan beide
plattegrondmaten. Het plan gebruikt de statische §4.1.7.5-coëfficiënten voor
de hoofddraagconstructie, niet de alternatieve laagbouwmethode §4.1.7.6.
Het vereist een onderbouwde laagste eigenfrequentie van minstens 1 Hz, de
expliciete uitsluiting van wake-/kanaaleffecten, een herleidbare q-waarde,
Ct en beide opgegeven c_pi-grenzen. Voor elk van de vier richtingen blijven de
binnendrukgevallen samenhangend over alle gevels en beide dakstroken. UGT en
BGT hebben afzonderlijke gevalsleutels en eigen belangfactoren; beide reeksen
kunnen gezamenlijk op de 3D-schil worden geprojecteerd zonder elkaar te
overschrijven. Een
2D-spantstrook wordt uit hetzelfde vlakplan geprojecteerd; zijn kracht is
analytisch vergeleken met de overeenkomstige uitgesneden 3D-vlakkracht.
Het vlakplan wordt nu ook op vier volledige rechthoekige gevelpanelen en één
plat dakpaneel van een 3D-model geprojecteerd. De bestaande triangulatie
verwijdert openingen en knipt beide dakzones exact; onvolledige of verkeerd
gerichte vlakken worden afgewezen. Een krachtproef vergelijkt de resulterende
netto 3D-krachten met het normatieve vlakplan, inclusief de ontbrekende
oppervlakken van de openingen. De 3D-toepasser kan dit plan nu omzetten naar
windbelastinggevallen en driehoekige modelbelastingen. Hij bewaart de
afzonderlijke buiten- en binnendruk, herkomst en drukafleiding voor het rapport.
Een afzonderlijk zuiver combinatieplan volgt nu NBC 2025 tabellen 4.1.3.2.-A
en 4.1.3.4 voor gewone D/L/S/W-belastingen zonder kraan of aardbeving. Het
maakt beide UGT-waarden van D, leidende en begeleidende L/S/W-gevallen en
de niet-kruipende BGT-doorbuigingsgevallen. Elk windgeval blijft samenhangend;
UGT en BGT gebruiken afzonderlijke wind- én sneeuwgevallen vanwege hun
verschillende belangfactoren volgens tabellen 4.1.7.1. en 4.1.6.2. Voor
iedere sneeuwverdeling verwacht het plan een eigen UGT/BGT-paar. Het vormt
per combinatie hoogstens één sneeuwverdeling, zodat de verplichte volledige
en gedeeltelijke sneeuwbelastingen uit §4.1.6.3 niet bij elkaar worden opgeteld.
Voor §4.1.7.9(1) is daarnaast een afzonderlijk horizontaal actieplan aanwezig:
de volledige hoofdassen (a), 75% met ±15% excentriciteit (b), gelijktijdig
75% op twee hoofdassen (c), en gelijktijdig 56% met beide excentriciteiten (d).
Het 3D-modelplan levert deze F_x-, F_y- en M_z-acties mee, met de gebruikte
drukgevalsleutels en normbron. De krachten komen uit de werkelijk geprojecteerde
geveldriehoeken na aftrek van openingen; ook de kantelmomenten M_x en M_y
om de gebouwvoet volgen uit de werkelijke hoogte van elke driehoek. Een
asymmetrische opening draagt haar eigen M_z bij, naast de normatieve ±15%-offset.
Het telt bewust geen complete drukvelden op: dat zou de verticale dakdruk
dubbeltellen. Met een expliciet onderbouwd overdrachtspad via ondersteunde
basisknopen en bestaande starre schijven kan het 3D-modelplan de b/c/d-acties
nu als afzonderlijke knooplastgevallen genereren. Basisknopen vragen een
horizontale X- en Y-oplegging of positieve veerstijfheid in beide richtingen;
een uitsluitend verticale oplegging wordt afgewezen. Elke geveldriehoek draagt
naar de twee omvattende niveaus af; een krachtcontrole bewaakt F_x, F_y,
kanteling en torsie. De gegenereerde knooplasten bewaren hun norm- en
overdrachtsbron voor het rapport en blijven bij hergeneratie stabiel.
Dit is een globale lastafdracht voor het hoofddraagsysteem, geen controle
van lokale gevelstaven. De b/c/d-gevallen krijgen nu ook afzonderlijke
UGT/BGT-combinaties met D/L/S/W volgens de ondersteunde NBC-tabelrijen;
een combinatie kiest hoogstens één volledig of gedeeltelijk windgeval.
Het plan weigert overige lastsoorten, ontbrekende grensstaatgevallen en ongemarkeerde
niet-windlasten. Een afzonderlijke 3D-bouwsteen maakt nu in één stap het
NBC-drukplan, de echte schilpaneellasten, stabiele belastinggevallen en de
bijbehorende combinaties. Voor één rechthoekig plat dak kan die bouwsteen ook
de UGT/BGT-sneeuwdruk volgens §4.1.6.2 en de gelijkmatige plus opgegeven
gedeeltelijke verdelingen volgens §4.1.6.3 op echte 3D-dakvlakken zetten.
De projectinvoer moet voor S_s, S_r, C_w, C_T, afwezigheid van extra
sneeuwophoping en de voor constructiedelen gekozen sneden een bron leveren.
Het dakplan gebruikt C_b uit de afmetingen, C_s = C_a = 1, en weigert onder
meer een te hoge S_r of onbewezen sneden. De drukafleiding blijft bij elk
gegenereerd vlak bewaard. Hij weigert bestaande gegenereerde lasten uit een
andere norm, zodat die niet ongemerkt worden vervangen. De bouwsteen is nog
niet aangesloten op de projectopslag of de interface. De API/MCP biedt
`model3d.nbc2025.previewWind` als proefberekening voor UGT/BGT-druk, exacte
schildriehoeklasten, projectieresultanten en §4.1.7.9-acties. Dit commando
wijzigt het project niet en vraagt expliciete projectbronnen voor q, Ct, Cpi
en de eigenfrequentie.
Automatische keuze en onafhankelijke controle van de voor elk constructiedeel
maatgevende sneeuwverdeling ontbreken nog; de invoerder moet deze sneden
onderbouwen. Extra sneeuwophoping en afwijkende dakvormen blijven buiten dit
beperkte plan; ook daarom blijft de route gesloten.
De NBC-route is nog niet selecteerbaar als projectnorm in de interface of API. Provinciale
adoptie, kaart-/tabelrechten, gecontroleerde openingsclassificatie, volledige
combinatiedekking en een
gepubliceerd volledig rekenvoorbeeld ontbreken voor een vrijgegeven route.

1. Bestaande Nederlandse route isoleren achter hetzelfde broncontract; uitkomst
   en rapport bit voor bit vergelijken met de huidige 2D- en 3D-generator.
2. Andere CEN-bijlagen invoeren zodra editie, NDP's, kaartdata en rechten per
   land beschikbaar zijn. Begin met landen waarvoor een verifieerbaar
   uitgewerkt voorbeeld en toepasbare kaartgegevens bestaan.
3. ASCE/SEI 7-22, AS/NZS 1170.2 en NBC als afzonderlijke rekenmodules;
   deze methoden zijn geen parameterwissel op de Eurocode-formules.
4. India, Japan, China, Zuid-Afrika en Brazilië na de bron- en licentiecontrole;
   daarna de overige rechtsgebieden. Herorden dit met werkelijk projectgebruik.

Per route is de vrijgavepoort: primaire normbron en toepassingsgebied,
gedocumenteerde invoer en bronrechten, gepubliceerd rekenvoorbeeld,
analytische druk-/krachtsom, identieke 2D/3D-projectie, rapport, API/MCP,
combinaties en volledige CI. Tot die tijd blijft de route zichtbaar als
inventaris, maar niet als berekenbare keuze.
