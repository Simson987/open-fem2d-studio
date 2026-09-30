# Migratie van de FEM Studio-solver naar Rust

Doel: dezelfde modelinvoer, analyses, resultaten en foutafhandeling in Rust
beschikbaar maken, waarna de app de Rust-kern kan gebruiken. Een CLI-proef is
nog geen vervanging van de app-solver.

## Huidige stand

| Deel | Rust-kern | Nog open voor vervanging van de app-solver |
| --- | --- | --- |
| 3D-raamwerk | 12-DOF-staven, lineair/P-Δ, eenvoudige FNL | Verdeelde en thermische lasten, scharnieren, veren, opgelegde verplaatsingen, eigenknik, materiaalhistorie en schaalbare stabiliteitstoets. |
| 2D-schijf | CST en Q4, Green-Lagrange GNL, staal-J2, betonschade, E(rek) | Alle bestaande combinaties van elementen/randvoorwaarden, gekoppelde staven en externe validatie van de FNL-wetten. |
| 2D-buigplaat | DKT en 4-knoops hybride Kirchhoff, E(rek) | GNL-buiging, gescheurde betonstijfheid, niet-uniforme lasten, orthotropie en betrouwbare dwarskrachtherleiding aan alle randen. |
| Wapeningscontrole | Verticale dwarskrachtwapening, huidtrek en EC2-scheurwijdte als aparte UGT/BGT-postprocessen | Nationale bijlage, belastingscombinaties, detaillering, scheurhistorie en toetsing van gecombineerde membraan- en plaatkrachten. |
| Lineaire algebra | Dicht tot 600 DOF; ijle Jacobi-PCG tot 20.000 DOF voor symmetrisch positieve grote 2D-matrices | Robuuste factorisatie/inertiecontrole, preconditioner voor slecht geconditioneerde modellen en benchmark op grote productiemodellen. |
| App-koppeling | TypeScript-invoeradapters en aparte Rust-CLI's | Eén gedeeld modelcontract en daadwerkelijke aanroep vanuit de app; gelijkwaardige resultaattypen, foutmeldingen en rapportage. |

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
