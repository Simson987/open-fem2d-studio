# Gedeelde Hex8- en 3D-raamwerkknooppunten

De generator `scripts/verification/generate_coupled_hex_frame_towers.py` maakt
twee opgeslagen Open FEM Studio-projecten met dezelfde geometrische opzet:
een Hex8-funderingsplaat met een ruimtelijk staalraam dat op de bovenste
volumeknopen aansluit. Elke staaf heeft axiale, buig- en torsievrijheidsgraden;
de Hex8-elementen hebben alleen translatievrijheidsgraden. De onderzijde van
het volume is translatoir vast. Op elke dakknoop werken 0,1 kN in X en
−1,0 kN in Z; eigen gewicht staat uit.

| Project | Knopen | Hex8 | Volledige 3D-staven | Vrijheidsgraden |
| --- | ---: | ---: | ---: | ---: |
| `hex8-raamwerk-koppeling-klein.ifcfem2d` | 36 | 4 | 42 | 189 |
| `hex8-raamwerk-koppeling-groot.ifcfem2d` | 1.183 | 432 | 1.443 | 5.577 |

`design-mockup/test-frame3d-coupled-hex-frame-grid-app-route.mjs` voert beide
projecten via de gewone TypeScript-adapter en de releaseversie van de
getypeerde Rust-dispatcher uit. De kleine proef vergelijkt `sparseDirect`,
`frontalWave` en `matrixFreePcg`: alle 36 knopen komen binnen 10⁻⁷ m/rad
overeen. Voor beide projecten toetst de proef alle knoop- en staafresultaten
op eindigheid, alle Hex8-resultaten op spanning, het vrije residu en de
globale kracht- en momentbalans. De reacties sluiten op de opgelegde
0,9/9 kN respectievelijk 16,9/169 kN daklasten.

De grote proef slaagt met `matrixFreePcg` op vier threads in 305 iteraties
en een relatief residu van 7,02×10⁻¹⁰. Dit is een lineair elastische
acceptatieproef. Zij valideert nog geen geometrisch of fysisch niet-lineaire
frame/volume-koppeling en heeft voor de grote geometrie geen onafhankelijke
gesloten verplaatsingsoplossing.

Het grote project is ook via de gewone **Berekenen**-knop in de ontwikkelapp
geopend en opgelost. De viewer toont 1.183 knopen, 1.443 staven en 432 Hex8;
het actieve belastinggeval geeft 0,2196 mm maximale verplaatsing en circa
0,009 MPa maximale von-Mises-spanning in het volume. De app toont terecht
dat een constructieve staal- of betontoets voor volume-elementen nog ontbreekt.
