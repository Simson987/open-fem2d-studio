# Groot 3D-staalgebouw met 2.432 raamwerkstaven

Het opgeslagen project [`staalgebouw-2432-staven-acht-bouwlagen.ifcfem2d`](staalgebouw-2432-staven-acht-bouwlagen.ifcfem2d)
is een verbonden stalen raamwerk van 55 × 35 × 32 m met acht bouwlagen,
864 knopen, 768 kolomsegmenten, 1.376 vloerliggers en 288 afwisselende
gevelschoren. Alle 2.432 staven zijn volledige 3D-raamwerkelementen met
buiging en torsie. Kolommen gebruiken HEA 240, liggers IPE 240 en schoren
HEA 200, allemaal S235. De 96 voetknopen zijn volledig ingeklemd.

Op ieder knooppunt boven de begane grond werkt −3 kN in Z. Windlasten
staan op de gevels met de grootste X- en Y-coördinaat. De analytisch
gesommeerde lasten zijn +32 kN in X, +19,2 kN in Y en −2.304 kN in Z.
Eigengewicht staat in het opgeslagen project uit, zodat deze som
rechtstreeks met de oplegreacties vergeleken kan worden. Het project is
ingesteld op tweede-orde P-Δ-analyse.

De acceptatieproef controleert modelconnectiviteit, niet-nulle staaflengten,
profielverdeling, de 3D-app-adapter, aantallen uit de Rust-sidecar,
eindige knoopresultaten, vrije evenwichtsresiduen en globale kracht- en
momentbalans. Bij P-Δ worden de verplaatste lastposities gebruikt en moet
de horizontale dakdrift groter zijn dan in eerste orde. Er is geen
gesloten oplossing voor de afzonderlijke staafkrachten van dit grote model;
dit is een systeem- en evenwichtsproef, geen staaltoets volgens EN 1993.

Reproduceer en test vanuit de repository:

```bash
python3 scripts/verification/generate_steel_frame3d_2432_project.py
cd design-mockup
node --import tsx accept-frame3d-2432-steel-app-route.mjs
```

De test gebruikt de lokaal gebouwde release-`toetsbrug`. Met
`FRAME_LARGE_LINEAR_ONLY=1` draait alleen de eerste-ordecontrole. Op
12 oktober 2026 voltooide de eerste-orde-app-route in 4,25 s met maximaal
2,189 mm verplaatsing; P-Δ voltooide in 52,94 s met maximaal 2,201 mm.
Alle krachten en momenten sloten binnen de testtoleranties.
De doorlooptijden zijn metingen op één machine, geen prestatiegarantie.

Het 3D-canvas biedt **Groot staalgebouw · 2.432 3D-staven** aan als
voorbeeldknop. Die knop laadt alleen de geometrie, profielen, opleggingen
en knooplasten in het huidige project. Open het opgeslagen `.ifcfem2d`-bestand
voor exact dezelfde analyse- en eigengewichtinstellingen als de proef.
De ontwikkelapp toonde na de voorbeeldknop 864 knopen, 2.432 staven,
96 opleggingen en 768 belastingen in de verkenner.
