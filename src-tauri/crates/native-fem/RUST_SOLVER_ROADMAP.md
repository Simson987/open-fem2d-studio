# Migratie van de FEM Studio-solver naar Rust

Doel: dezelfde modelinvoer, analyses, resultaten en foutafhandeling in Rust
beschikbaar maken, waarna de app de Rust-kern kan gebruiken. Een CLI-proef is
nog geen vervanging van de app-solver.

## Huidige stand

| Deel | Rust-kern | Nog open voor vervanging van de app-solver |
| --- | --- | --- |
| 2D-raamwerk | 6-DOF-staven, lineair/P-Δ, axiale staal- en beton-FNL met lastpad, uniforme thermiek en temperatuurgradiënten, oplegveren en buigscharnieren. De app gebruikt Rust voor expliciete lineaire, P-Δ- en afzonderlijke axiale FNL-keuze. Materiaalwet per staaf, lastpad en temperatuurverschil over een opgegeven hoogte worden in het project bewaard. De adapter verwerkt scheefstand in beide richtingen voor knoop-, staafpunt- en lijnlasten. | Historische buigdoorsneden, bedding en gekoppelde staaf-plaatmodellen; onafhankelijke validatie van gecombineerde GNL/FNL voor representatieve raamwerken en thermische gradiënten in grotere modellen. |
| 3D-raamwerk | 12-DOF-staven, lineair/P-Δ, eenvoudige FNL met optioneel axiaal staal-/betonlastpad, eigenknik tot 120 vrije DOF, lokale lijn-, staafpunt- en thermische lasten, globale veren, opgelegde verplaatsingen/rotaties en My/Mz/torsiescharnieren. Uniforme temperatuur kan ook samen met axiale FNL-geschiedenis en gecombineerd GNL/FNL; thermische mechanische rek wordt per laststap onderscheiden. | Temperatuurgradiënten met FNL, historische vezel-/buigrespons, volledig gevalideerd gecombineerd GNL/FNL-lastpad en schaalbare knik- en stabiliteitstoets. |
| 2D-schijf | CST en Q4, Green-Lagrange GNL, staal-J2, betonschade, E(rek) | Alle bestaande combinaties van elementen/randvoorwaarden, gekoppelde staven en externe validatie van de FNL-wetten. |
| 2D-buigplaat | DKT en 4-knoops hybride Kirchhoff, E(rek), per vierhoek bilineaire plaatdruk, exacte vierkantsmesher en Q4-rechthoekmesher met begrensde celmaat en rechthoekige openingen | GNL-buiging, gescheurde betonstijfheid, hogere-orde of lijnlasten, orthotropie, willekeurige contouren of gekromde openingen en betrouwbare dwarskrachtherleiding aan alle randen. |
| Wapeningscontrole | Verticale dwarskrachtwapening, huidtrek en EC2-scheurwijdte als aparte UGT/BGT-postprocessen | Nationale bijlage, belastingscombinaties, detaillering, scheurhistorie en toetsing van gecombineerde membraan- en plaatkrachten. |
| Lineaire algebra | Dicht tot 600 DOF; ijle Jacobi-PCG tot 20.000 DOF voor symmetrisch positieve grote 2D-matrices | Robuuste factorisatie/inertiecontrole, preconditioner voor slecht geconditioneerde modellen en benchmark op grote productiemodellen. |
| App-koppeling | Eén getypeerde dispatcher via Tauri, toetsbrug en MCP; TypeScript-client en invoeradapters; de 3D-analyseknop gebruikt de native kern bij expliciete eerste-orde-, P-Δ- of FNL-keuze met invoer voor staalverharding en betonscheuren, FNL-eindscharnieren, getoetste snedekrachtlijnen en knikfactoren. Een losse rechthoekige 3D-buigplaat in een willekeurig vlak rekent lineair of met expliciete FNL-secant-E(rek), lastpad en bewaarde maximale vezelrek via het Rust Q4-mesh en het Rust hybride element; normaalgerichte oppervlaktebelasting, buiten- en openingshoekopleggingen en volledige vrije/scharnierende/ingeklemde buitenranden, plaatmomenten, alle randreacties en roostervervorming verschijnen in app en rapport. Ook rechthoekige openingen worden in Rust gemesht. Een expliciete UGT- of BGT-wapeningsspecificatie bereikt ook de Rust-plaatkern; elementgewijze dwarskracht-, langswapening- en scheurresultaten staan in de app en het rapport. | Alle 2D/3D-modelopties en resultaattypen gelijk maken; gekoppelde staaf-plaatassemblage, willekeurige contouren en gekromde openingen, gedeeltelijke of elastische plaatrandopleggingen, GNL-buiging en gevalideerde gescheurde/plastische plaatdoorsneden uitbreiden. |

## Volgorde en acceptatie

1. **Matrix en roosters:** elke nieuwe backend krijgt een analytische proef,
   een groot rooster boven de oude grens en een foutproef voor mechanismen.
   Gerealiseerd: Q4-rekproef 882 DOF en hybride Navier-plaat 675 DOF. De
   volledige ijle stabiliteitscontrole staat nog open.
2. **Invoercontract:** leg per element en last vast hoe het app-model naar
   Rust-eenheden wordt vertaald. Wijs niet-ondersteunde onderdelen expliciet af.
3. **Elementen en koppelingen:** migreer de nog ontbrekende functies van de
   huidige `design-mockup/src/core/solver` en `src/components/fem/solver`.
   Vergelijk voor elk onderdeel knoopverplaatsingen, reacties, elementkrachten
   en convergentie met de huidige solver en een onafhankelijke referentie.
4. **Niet-lineariteit:** toets lastpad, ontlasten, materiaaltoestand, P-Δ en
   convergentiefouten afzonderlijk. Voor beton is objectieve meshregularisatie
   nodig voordat berekende scheurvorming als ontwerpresultaat kan gelden.
5. **App en rapport:** schakel pas per analysevorm om wanneer dezelfde
   modelinvoer door de Rust-kern gaat en de bestaande project-, rapport- en
   toetsworkflow haar resultaten kan gebruiken. Houd ongedekte gevallen
   zichtbaar totdat ze ondersteund en gevalideerd zijn.

Een onderdeel is pas afgerond als het in de app werkt, geautomatiseerde
vergelijkingstests doorstaat en de ondersteunde/niet-ondersteunde invoer
duidelijk is. De huidige branch blijft experimenteel tot die poort is gehaald.
