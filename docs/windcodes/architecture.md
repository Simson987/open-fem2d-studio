# Ontwerp van normroutes voor wind (issue #69)

## Bestaande snijvlakken

De huidige bron is op vier plaatsen aan de Nederlandse route gekoppeld:

- `design-mockup/src/lib/wind/windEurocode.ts` bevat de berekening van
  `q_p(z)` en de EN/NB-coëfficiënten, met een bronvermelding per waarde.
- `design-mockup/src/lib/wind/windGenerator.ts` zet de 2D-geometrie om in
  zones, lijnlasten, gevallen en combinaties. Het roept `berekenStuwdruk`
  op meerdere plaatsen rechtstreeks aan.
- `design-mockup/src/components/openFem3d/openFem3dWindGeneration.ts` en
  `openFem3dFacadeWindLoads.ts` maken 3D-zones en vlakken en roepen dezelfde
  drukberekening rechtstreeks aan.
- `design-mockup/src/api/commands/model3dEnvelopeLoads.ts` accepteert nu
  Nederlandse windgebieden en EN-terreincategorieën zonder normidentiteit.

De twee geometrische adapters blijven bestaan. Hun gemeenschappelijke invoer
wordt een **normatief druk- en zoneplan**; het omzetten van een oppervlakteplan
naar een lijnlast of een 3D-belastingvlak hoort buiten de normmodule.

## Contract

Een route heeft een stabiele identiteit: `codeId`, `edition`, `jurisdiction`,
`effectiveFrom`/`effectiveTo` waar bekend, `source` en `dataLicense`.
Een project bewaart deze identiteit samen met de expliciet ingevoerde of
geautoriseerd opgehaalde kaartwaarde. Een herberekening met een andere editie
is een zichtbare projectwijziging; de app mag een oudere projectfile niet
stilzwijgend naar de nieuwste uitgave omzetten.

De invoer is een discriminated union per route. Voor de Nederlandse route zijn
dat bijvoorbeeld windgebied, terrein, gekozen bron van `q_p`, gebouwgeometrie
en eventuele handmatige druk. Een ASCE-route krijgt eigen risicocategorie,
kaart-/locatiewaarde, exposure en procedure. Geen veld van een route mag
heimelijk een standaardwaarde uit een andere route krijgen.

Elke module levert:

| Deel | Contract |
| --- | --- |
| Referentiewind | Waarde met fysieke eenheid, middelingsduur, terugkeerperiode/risicobasis, bron en herkomst van kaart-/locatiegegevens |
| Drukprofiel | Druk of equivalente normgrootheid als functie van hoogte, richting en terrein; bronregels per factor |
| Zonering | Gevel-/dakvlakken, begrenzingen en oppervlaktes, met rekenrichting en editiebron |
| Coëfficiënten | Uitwendige en inwendige druk, vorm, wrijving en dynamische correctie voor de toepasselijke geometrie |
| Lastplan | Karakteristieke krachten/vlaklasten in kN en kN/m² met tekenafspraak, richting, gevalsleutel en volledige afleiding |
| Combinaties | Routegebonden combinatievoorschrift; niet de Nederlandse NB-combinaties als impliciete standaard |

De toepassingslaag projecteert **hetzelfde lastplan** op het 2D-spant en de
3D-schil. Zo kunnen een analytische krachtcontrole en een 2D/3D-
vergelijking dezelfde normuitkomst verifiëren. Het rapport, API en MCP lezen
dezelfde afleiding uit dat plan; zij voeren geen eigen normformules uit.

## Vrijgave- en migratievolgorde

1. Leg de route-identiteit bij de bestaande Nederlandse instellingen vast.
   Oudere bestanden migreren expliciet naar de historische NL-route; een
   project zonder bekende jurisdictie krijgt een melding en vraagt een keuze.
2. Splits de pure normberekening van geometrische projectie. Vergelijk het
   Nederlandse resultaat voor de bestaande referentievoorbeelden exact met
   het huidige gedrag, inclusief handmatig ingevoerde stuwdruk.
3. Maak de project-/UI-/API-keuze routegebonden. Een geïnventariseerde maar
   nog niet geïmplementeerde route wordt afgewezen met een concrete melding;
   geen terugval naar Nederland.
4. Voeg per route de officiële brondata, de nationale keuzes, het gepubliceerde
   rekenvoorbeeld, de combinatieafleiding en de 2D/3D-pariteit toe. Pas daarna
   kan de route in de keuzelijst als berekenbaar verschijnen.

De eerste implementatiestap bewaart `windCodeId` in `projectInfo.uitgangspunten`,
laat de 2D-generator deze projectkeuze volgen en toont de route in het rapport.
Bij het openen van een ouder bestand zonder route wordt de historische NL-route
expliciet aan de generator doorgegeven. Een onbekende opgeslagen route blijft
zichtbaar en wordt bij het genereren geweigerd; zij wordt niet naar NL omgezet.
De 3D-dialoog leest dezelfde projectroute en initialiseert windgebied en
terrein uit de projectuitgangspunten. Het API/MCP-commando leest de route uit
het projectdocument en weigert een afwijkende expliciete route.
Bij 3D-generatie reist de daadwerkelijk gebruikte route ook mee met elk
gegenereerd windgeval en windvlak. Het rapport vergelijkt die opgeslagen route
met de huidige projectkeuze; bij een verschil meldt het dat opnieuw genereren
nodig is. Bestanden uit de periode vóór dit kenmerk hebben alleen de
historische NL-route als mogelijke bron.
Elk nieuw 3D-windvlak bewaart daarnaast zijn gebruikte referentiehoogte en
drukafleiding. Het 3D-rapport groepeert gelijke afleidingen en toont de
formuleregels en hun bron zonder de druk opnieuw uit mogelijk gewijzigde
projectinstellingen te berekenen. Oudere windvlakken zonder deze herkomst
blijven leesbaar en krijgen een melding om de windlasten opnieuw te genereren.
De toegepaste constructiefactor `c_s·c_d` wordt eveneens per windvlak
opgeslagen en naast `c_pe`, `c_pi`, `q_ref` en de uiteindelijke vlaklast in
de 3D-rapporttabel getoond. Bij oudere windvlakken zonder deze factor
blijft de kolom onbekend (`—`) in plaats van impliciet 1 aan te nemen.
Voor `c_pi` bewaren nieuwe 3D-windvlakken nu ook de afleiding: bij een
dominante gevel de openingsverhouding met achtergrondlekkage, de per zone
gewogen buitenvormfactor en de toegepaste factor; zonder aantoonbare
dominantie de bron van de beide standaardvarianten. Het rapport groepeert
gelijke afleidingen en vraagt voor oude vlakken zonder herkomst een nieuwe
windgeneratie. De laststerkte zelf wordt niet opnieuw uit deze rapportregels
berekend.
Ook 2D-windgevallen bewaren nu de gebruikte route. De idempotentiecontrole
werkt oude gevallen zonder herkomst één keer bij en laat daarna identieke
herberekeningen ongemoeid.
Nieuwe 2D-windgevallen bewaren tevens de gebruikte basisdruk met haar
referentiehoogte en formuleregels. Kolomlasten van vrijstaande daken bewaren
hun afwijkende druk op de eigen kolomhoogte. Het 2D-rapport groepeert die
opgeslagen afleidingen; oude gevallen zonder drukafleiding blijven leesbaar
en krijgen een melding om opnieuw te genereren.
Bij handmatige basisdruk kan de gebruiker nu de bron van de ingevoerde waarde
opgeven. Deze bron wordt met elk gegenereerd windgeval en de afwijkende
kolomdruk opgeslagen en in het rapport getoond; een lege bron behoudt de
historische algemene vermelding voor oudere projectinstellingen.
De 3D-schillastengenerator kan dezelfde handmatige stuwdruk als alternatief
voor windgebied en terreincategorie ontvangen via dialoog en API/MCP. De
ingevoerde waarde is op alle referentiehoogten gelijk; de bron en hoogte
worden per gevel- en dakbelastingvlak opgeslagen en door het 3D-rapport
uitgelezen. Dit kiest nog geen buitenlandse normroute: de projectroute moet
de bestaande Nederlandse route zijn en de gebruiker onderbouwt de druk.
Ook de per geval gebruikte windzones, coëfficiënten, nettodrukken en
lijnlasten worden nu in het 2D-project bewaard en in de lastentabellen van
het rapport getoond. Een oud geval zonder die gegevens krijgt een aparte
melding; gewijzigde projectinstellingen herschrijven de bewaarde afleiding
niet stilzwijgend.
De 2D-generator accepteert nu ook een expliciete constructiefactor `c_s·c_d`.
Deze schaalt de gebouw- en vrijstaande-daklasten, terwijl de fysieke basisdruk
`q_p` ongewijzigd blijft. De gebruikte factor wordt per windgeval opgeslagen
en in het rapport getoond; oude windgevallen zonder dit gegeven vragen een
nieuwe generatie. Bij gebouwen vanaf 15 m blijft een waarschuwing staan om de
gekozen factor aan §6.3 te toetsen.
Voor gesloten 2D-gebouwen bewaart elk windgeval ook de gekozen `c_pi` met zijn
normbron of de opgegeven herkomst van een handmatige waarde. Het rapport leest
die bewaarde waarde en bron in plaats van de huidige dialooginstellingen.
Vrijstaande daken hebben geen binnendruk; oude gebouwgevallen zonder de
herkomst krijgen een melding om opnieuw te genereren.
De tekenafspraak voor netto druk is in `windPressureBalance.ts` gedeeld:
positief naar binnen, positief naar buiten als tegengestelde grootheid. De
bestaande Nederlandse 2D- en 3D-projecties gebruiken dezelfde
coëfficiëntenbalans; de Canadese kern gebruikt de balans van afzonderlijk
berekende buiten- en binnendruk. Dit is de eerste code-neutrale rekenstap,
maar de zonering en lastafdracht zijn nog routegebonden.
`windSurfacePressurePlan.ts` legt nu voor elk Nederlands 2D- en 3D-zonevlak
de route, gevalsleutel, vlakidentiteit, zone, coëfficiëntbron, drukbasis en
getekende nettodruk in één code-neutraal object vast voordat de geometrische
projectie plaatsvindt. Het contract ondersteunt ook routes die buiten- en
binnendruk op verschillende hoogten berekenen. De Canadese pure kern blijft
ongewijzigd en is nog geen selecteerbare route; een volgende stap moet zijn
normdrukken in een volledig geval- en zoneplan opnemen.
De staalhalwizard gebruikt eveneens de historische Nederlandse windroute. Bij
toepassen op een bestaand project weigert hij daarom een andere opgeslagen
windroute vóór enige modelwijziging; de knop toont die blokkade ook in de UI.
Een zelfstandig gegenereerd staalhalbestand bewaart nu de volledige
standaarduitgangspunten met deze route-ID; opgegeven andere uitgangspunten
blijven behouden. Alleen oudere bestanden zonder route volgen nog de
historische migratieregel. Dit is geen implementatie van een buitenlandse
staalhalroute.

**Nog niet opgelost:** de huidige Nederlandse drukberekening gebruikt de
algemene EN-terreincategorieën en heeft de Nederlandse NB-stuwdruktabel niet
ingebouwd; de bestaande broncode meldt dit al. Nieuwe 2D-windgevallen en
3D-windvlakken bewaren nu expliciet of de druk uit het EN-terreinprofiel komt
of handmatig is opgegeven. Beide rapporten tonen deze methode; oudere
bestanden zonder methode tonen een onbekende historische herkomst. Een
handmatig ingevoerde druk is niet automatisch een geverifieerde NB-tabelwaarde:
de gebruiker moet de bron afzonderlijk onderbouwen. De nog ontbrekende
NB-tabel wordt hiermee niet als berekenbare route voorgesteld.
Een eerste kruisproef vergelijkt de totale gevelkracht van één rechthoekig
gebouw tussen de 2D-spant- en 3D-schilprojectie voor beide windrichtingen,
beide binnendruktekens, handmatige en berekende druk en een constructiefactor.
Dit verifieert de gevelpariteit voor die geometrie, nog niet de dakzonering of
andere normroutes.
Een tweede kruisproef vergelijkt de totale platdakkracht over een 2D-spantstrook
met precies dezelfde uitgesneden strook van een 3D-dakvlak. Zij dekt de
binnenstrook en randzone F, beide binnendruktekens, omgekeerde windrichting,
handmatige en berekende druk en een constructiefactor. Voor een symmetrisch zadeldak
met 15° helling is ook de totale verticale daklast van de middelste 2D-strook
vergeleken met dezelfde 3D-strook, inclusief de aparte loef- en lijzones.
Andere dakhoeken, langswind en asymmetrische daken blijven buiten die proef.
