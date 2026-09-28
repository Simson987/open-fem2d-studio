# 3D-plaat: lijn- en cirkelboogcontour

De knop **Boogrand** gebruikt een beginpunt, een aangeklikt punt op de boog en een eindpunt. De rand is nu de unieke cirkelboog door die drie punten. Voorheen werd een kwadratische Bézierlijn gebruikt; die liep doorgaans niet door het aangeklikte stuurpunt. De getekende preview en de uiteindelijke plaatextrusie gebruiken dezelfde cirkelconstructie. Drie punten op één lijn worden geweigerd omdat zij geen unieke cirkel bepalen.

De geautomatiseerde proef [`test-frame3d-plates-views.mjs`](../../../design-mockup/test-frame3d-plates-views.mjs) toetst de boog op de buitenrand en in een opening, een verticaal 3D-werkvlak, een boog langer dan 180°, opslag van randsegmenten en de werkelijke uitsparing in de mesh. Een straal door het midden van de opening mag de plaat niet raken; een straal naast de opening moet haar wel raken. Een opening die de buitenrand raakt wordt geweigerd.

In de GUI is een plaat in bovenaanzicht getekend met een gebogen onderrand en drie rechte randen. De boog ging zichtbaar door het aangeklikte middelste punt. Daarna is een opening met een cirkelboog en drie rechte randen getekend. Na het naar binnen verplaatsen van de bovenste openingsknopen werd het gat zichtbaar als open canvas. Een tweede opening die de buitenrand raakte werd niet toegevoegd: het aantal openingen bleef één en de app meldde **“moet volledig binnen de plaat liggen, zonder de buitenrand te raken.”** De tijdelijke tekenknopen werden daarbij verwijderd.

Dit verifieert tekenen, geometrie, selectie en meshweergave. De 3D-plaatkernel voor krachten en vervormingen is nog niet aangesloten; de applicatie blokkeert een berekening met platen daarom expliciet.
