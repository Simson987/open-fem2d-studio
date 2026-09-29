# Wateraccumulatie: eerste 2D-rekenmodule

## Bron en reikwijdte

De rekenaanpak volgt het terugkoppelingseffect dat Johan Blaauwendraad beschrijft in [*Praktische methode om wateraccumulatie te toetsen*](https://gratis-publicaties.bouwenmetstaal.nl/pdf_serve/?n=Wateraccumulatie+%28Technisch+dossier+%231%29-1.pdf&p=pdf&pub=176-1.pdf), *Bouwen met Staal* (2006), p. 8–17: water veroorzaakt zakking, waardoor meer water op het dak blijft staan.

De huidige module berekent één vrij opgelegde 2D-dakligger en zijn meewerkende dakstrook. Dit is een numerieke evenwichtsberekening, geen volledige NPR 6703-toets. Dakplaten, gordingen, doorlopende velden, afvoercapaciteit en een sterktecontrole van de gehele constructie vallen buiten deze eerste versie.

## Rekenmodel

- De gebruiker geeft overspanning, meewerkende breedte, `EI`, waterpeil, afschot, zeeg en eventuele begindoorbuiging op.
- Het dakprofiel wordt in 32 Euler-Bernoulli-liggerelementen verdeeld.
- Op positie `x` is de waterdiepte `h(x) = max(0, peil − dakhoogte(x) + zakking(x))`.
- De neerwaartse lijnlast is `q(x) = γwater · breedte · h(x)`, met standaard `γwater = 10 kN/m³`, gelijk aan Blaauwendraads voorbeelden.
- Last en vervorming worden herhaald totdat de grootste verandering in zakking kleiner is dan `10⁻⁸ m`. Bij divergentie wordt geen ontwerpresultaat getoond. Een niet-convergerende iteratie bij vast waterpeil bewijst op zichzelf geen fysieke instabiliteit.
- Met de optionele stijfheidsfactor `γM` rekent de module met `EI/γM`. De keuzen `1,0` en `1,3` maken Blaauwendraads twee berekeningen in voorbeeld 1 vergelijkbaar. De factor `1,3` komt uit de regelgeving die hij in 2006 bespreekt; de keuzelijst is geen uitspraak over de vandaag geldende norm.
- Het gerapporteerde stijfheidgetal gebruikt voor de volledig natte, vrij opgelegde ligger `EIcr = γwater · breedte · L⁴ / π⁴`. Blaauwendraads vereenvoudigde zuiger-veermodel gebruikt `96` in plaats van `π⁴`; zijn artikel vermeldt het verschil van circa 1,5%.
- `n < 1` betekent niet automatisch instabiliteit bij afschot: een deels droog dak kan nog een stabiel evenwicht hebben. Daarom beslist de iteratieve berekening over de status; `n` is een waarschuwing en vergelijkingsgetal.
- Het resultatenscherm toont ook het geborgen watervolume. Bij `n ≤ 1` en een gevonden evenwicht meldt het scherm expliciet dat de wateropvoergrens nog niet is vastgesteld. Dit volgt uit het onderscheid tussen sterkte en een mogelijk grenspunt in Blaauwendraads artikel; een enkel convergent peil bepaalt de maximale waterstand niet.

## Verificatie

Voorbeeld 1 uit Blaauwendraads artikel: `L = 15 m`, breedte `5 m`, `EI = 70.900 kNm²`, begindoorbuiging `16 mm`, waterpeil `100 mm`. De publicatie noemt voor de onafhankelijke computerberekening `M = 253 kNm`; deze module vindt circa `254 kNm`. De automatische test controleert daarnaast reactiekrachtevenwicht, zeeg, afschot en divergentie bij onvoldoende stijfheid.

Met `γM = 1,3` stijgt het berekende moment van circa `254` naar `308 kNm`, ruim 20% zoals de publicatie voor zijn vereenvoudigde model beschrijft. Een tweede test legt vast dat bij `n < 1` een hellend, deels droog dak wél kan convergeren. De numerieke resultaten hoeven niet exact gelijk te zijn aan Blaauwendraads handmodel, dat doorbuigingen en waterdiepten tot equivalente gelijkmatig verdeelde waarden vereenvoudigt.

## Nog nodig voor een volledige dakanalyse

Blaauwendraad behandelt ook spanten, gordingen en dakplaten als samengesteld stijfheidssysteem, het kritieke dakplaatveld langs de lage dakrand, een stabiliteitsgrens bij slappe hellende daken en de waterhoogte die uit noodafvoeren volgt. De huidige liggerstrook rekent die onderdelen niet mee. Voor een toets zijn daarnaast de toepasselijke actuele norm, belastingscombinaties en sterktecontrole nodig.

## Vervolg op Blaauwendraads publicaties

Zijn [HERON-artikel uit 2006](https://www.heronjournal.nl/51-23/4.pdf) onderscheidt bezwijken door sterkte bij voldoende stijve daken van een grenspunt bij zeer slappe daken. De [bijstelling uit 2009](https://doi.org/10.1016/j.jcsr.2008.03.004) waarschuwt dat de vereenvoudigde verdeling van geborgen water over gordingen en dakplaten te ongunstig kan uitpakken wanneer alle onderdelen vrij zijn opgelegd. Daarom gebruiken we die vereenvoudiging niet als generieke FEM-belastingverdeling.

In zijn latere [HERON-artikel over een instructiemodel](https://heronjournal.nl/67-2/3.pdf) adviseert Blaauwendraad bij een grenspunt de berekening te sturen met het **watervolume** in plaats van de waterstand. Dat is de volgende stap voor de 2D-kern: per toegevoegd watervolume tegelijk het waterpeil en de vervormde ligger oplossen, de evenwichtstak volgen en een maximaal opvoerbaar waterpeil bepalen. Pas daarna kan de software bij een niet-convergerende berekening onderscheid maken tussen een werkelijk grenspunt en een numeriek probleem. Voor samengestelde daken moeten de dakplaat- en gordingvervorming en hun eigen waterberging apart worden gemodelleerd.

### Uitwerking van de volumegestuurde berekening

Voor de huidige liggerstrook is de volumevoorwaarde `V = breedte · ∫ max(0, peil − dakhoogte(x) + zakking(x)) dx`. Bij elke volumestap zijn **peil en knoopverplaatsingen tegelijk onbekend**. De liggervergelijking en deze volumevoorwaarde moeten dus samen worden opgelost; alleen het ingevoerde peil achteraf bijstellen geeft geen betrouwbare evenwichtstak. Volg vanaf een vrijwel droog dak het toenemende volume en registreer per stap peil, natte lengte, moment en vervorming. Een lokaal maximum van `peil(V)` is de wateropvoergrens van dit 2D-model; het verloop moet ook na dat maximum kunnen worden gevolgd. Controleer de residuen van zowel krachtenevenwicht als volume en herhaal de berekening met fijnere elementen en kleinere volumestappen rond de grens.

Het bestaande scherm rekent nog met een **vast waterpeil**. De melding ‘geen convergent evenwicht’ mag daarom niet als aangetoonde bezwijktoestand worden gebruikt. Een volumegestuurde uitkomst is bovendien pas een daktoets als ook afvoerpeil, sterkte en de vervorming en waterberging van gordingen en dakplaten zijn meegenomen. Het [HERON-dossier over evaluatie van rekenmethoden](https://www.heronjournal.nl/51-23/5.pdf) waarschuwt dat eenvoudige 2D-benaderingen voor complexe daken onjuiste uitkomsten kunnen geven.

De waarden uit de module worden voorlopig niet automatisch als belastinggeval aan het volledige 2D-FEM-model toegevoegd. Daarvoor moeten dakstroken, lastenverdeling en afvoerscenario's expliciet in het projectmodel worden vastgelegd.
