# Verificatiebasis voor 3D-raamwerken

Deze map bevat onafhankelijke referentieberekeningen voor de 3D-raamwerksolver
van Open FEM Studio. De getallen zijn analytisch of rechtstreeks uit een
gepubliceerde stijfheidsmatrix afgeleid. De Rust-adapter wordt automatisch
tegen de gesloten oplossingen getest. Op 6 oktober 2026 zijn alle zevenentwintig
referentietests (`reference_cases`) en de elf tests van `trek_schijf_tweede_orde`
geslaagd, inclusief directe tweede orde, knik, staafrotatie en
revolute opleggingen om elke globale as. De set bewaakt ook oplegveren, opgelegde
rotaties, de kritieke-lastgrens en de geldige P-Delta-nultoestand
waarbij een belasting volledig op een geblokkeerde vrijheidsgraad staat.

De platen, schalen en de Hex8-volumes van de 3D-versie zijn tegen de NAFEMS-benchmarks
(LE1, LE2, LE3, LE5, LE6, LE10) getest; zie [`../nafems/`](../nafems/README.md).

## Openbare 3D-staalmodellen

| Projectbestand | Model en belastingen | Controle |
| --- | --- | --- |
| [`stalen-ligger-3d.ifcfem2d`](stalen-ligger-3d.ifcfem2d) | IPE200-ligger van 4 m, twee elementen, middenlast 10 kN | Beide verticale reacties 5 kN; middendoorbuiging `PL³/(48EI)`; EN 1993 bij UGT 1,5Q |
| [`stalen-ruimteportaal.ifcfem2d`](stalen-ruimteportaal.ifcfem2d) | 6 × 4 × 3,5 m, vier HEA200-kolommen en vier IPE200-dakliggers; daklast en wind in X/Y | Vier symmetrische dakreacties van 10 kN; windreacties −8/−4 kN; EN 1993 bij UGT 1,35G + 1,5W |
| [`staalgebouw-2432-staven-acht-bouwlagen.ifcfem2d`](staalgebouw-2432-staven-acht-bouwlagen.ifcfem2d) | 55 × 35 × 32 m, 2.432 3D-kolommen, liggers en gevelschoren van drie profieltypen | [Grote app-routeproef](staalgebouw-2432-staven-acceptatie.md): eerste en tweede orde, globale kracht- en momentbalans |

De eerste twee bestanden worden met de projectparser opnieuw geopend. De controle
[`test-frame3d-steel-models.mjs`](../../../design-mockup/test-frame3d-steel-models.mjs)
rekent de modellen met de 3D-solver door, toetst het globale kracht- en
momentenevenwicht en voert de staaltoets via `toetsbrug` uit. Op 30 september
2026 gaf de debug-kern `Ok` voor alle staven; de hoogste UC was 0,308 voor de
ligger en 0,093 voor het portaal. Draai de controle vanuit `design-mockup/` met
`node --import tsx test-frame3d-steel-models.mjs`. Zonder lokaal gebouwde
Rust-binaries blijft de controle beperkt tot de projectbestanden.

## Bestanden en dekking

| Bestand / geval | Controleert | Referentie |
| --- | --- | --- |
| [`cases.json`](cases.json), `axial-oblique-xyz` | axiale stijfheid en richtingscosinussen in X, Y en Z | TU Delft, extensie-element |
| `cantilever-biaxial-bending` | afzonderlijke `Iy` en `Iz`, buigingstekens, inklemmingsreacties | MIT, uitkraging met eindlast |
| `torsion-rotated-yz` | `GJ/L`, ruimtelijke rotatie en reactiekoppel | TU Delft, torsie-element |
| `simply-supported-midpoint-z` | koppeling van twee elementen, twee steunpunten, symmetrie | MIT, driepuntsbuiging |
| Rust `uniform_local_z_member_load_matches_cantilever_closed_form` | lokale gelijkmatig verdeelde staaflast, reactie en veldmoment | gesloten uitkragingsoplossing |
| Rust `member_end_release_matches_propped_cantilever_closed_form` | lokale `My`-eindrelease, reacties en nulmoment aan het scharnier | `RA=5wL/8`, `RB=3wL/8`, `MA=wL²/8`, `MB=0` |
| Rust `local_point_load_on_member_matches_simply_supported_closed_form` | lokale staafpuntlast, sprong in `Vz`, top van `My` en veldverplaatsing | `R=P/2`, `Mmax=PL/4`, `wmax=PL³/(48EI)` |
| Rust `translational_support_spring_matches_closed_form_and_reports_reaction` | globale translatieveer, parallelle ligger- en veerstijfheid, reacties in lineaire en P-Delta-analyse | `u=P/(3EI/L³+k)`, `Rveer=-ku` |
| Rust `uniform_thermal_expansion_uses_material_alpha` | vrije uniforme thermische uitzetting en materiaalafhankelijke α | `ΔL=αΔT·L` |
| Rust `prescribed_axial_displacement_matches_bar_stiffness` | opgelegde globale verplaatsing, reacties en volledig voorgeschreven P-Delta-nultoestand | `N=EAδ/L` |
| Rust `prescribed_end_rotation_matches_slope_deflection` | opgelegde globale eindrotatie, eindmomenten, dwarskrachten en evenwicht | `M₁=2EIθ/L`, `M₂=4EIθ/L`, `V=6EIθ/L²` |
| Rust `revolute_y_and_z_supports_release_only_the_selected_rotation` | revolute Y en Z, vrije gekozen rotatie en geblokkeerde overige rotaties | `θ=ML/EI` |
| Rust `torsion_mechanism_has_actionable_diagnostics` | vrij torsiemechanisme, hard afwijzen van een groot solverresidu en concrete hersteltekst | globaal residu en zes starre-lichaamsvrijheden |
| Rust `pdelta_amplifies_compression_and_stiffens_tension` | teken van geometrische stijfheid: druk versterkt en trek verstijft | vergelijking met dezelfde lineaire kolom |
| Rust `pdelta_near_and_beyond_critical_load_is_bounded` | betrouwbare P-Delta-grens bij 90% en 105% van de eerste eigenwaarde-kniklast | onafhankelijke lineaire knikfactor van hetzelfde gesegmenteerde model |
| Rust `cantilever_buckling_converges_under_mesh_refinement` | convergentie van eigenwaarde-knik bij 1, 2, 4, 8 en 16 elementen | Eulerlast `π²EI/(4L²)` voor een ingeklemde kolom |
| Rust `tests/trek_schijf_tweede_orde.rs`, de vijf tweede-ordetests (#60) | de eigen P-Δ van de adapter: uitkragende kolom, staafeindscharnier in de knikfactor, portaal met 114 en raamwerk met 600 vrije vrijheidsgraden zonder factorisatiefout, samen met schijven en trek-alleen; krachtensom exact, momentensom = `Σ N·(e_x × Δu)` | `1/(1 − N/N_cr)`, `π²EI/(4L²)`, `(4,4934)²·EI/L²`, `1/(1 − 1/α_cr)` |
| [`tu-delft-torsion-frame.json`](tu-delft-torsion-frame.json) | samengestelde stijfheidsmatrix van een 3D-raamwerk met buiging en torsie | TU Delft, uitgewerkt 3D-raamwerk |
| [`revolute-x-request.json`](revolute-x-request.json) | revolute X, torsiestijfheid, vrije rotatie en reactiekoppel via API/MCP | gesloten oplossing `θ = TL/GJ` |
| [`pdelta-nultoestand-request.json`](pdelta-nultoestand-request.json) | tweede orde bij exact nul vrije verplaatsing; reactie, convergentie en `B2=1` | direct evenwicht op de geblokkeerde vrijheidsgraad |
| [`groot-vierlaags-raam.ifcfem`](groot-vierlaags-raam.ifcfem) en [verificatie](groot-vierlaags-raam-verificatie.md) | 100 knopen, 235 staven, vier ruimtelijke belastinggevallen, volledige lineaire superpositie en GUI | onafhankelijke globale kracht- en momentbalans |
| [`staalhal-60x30.ifcfem`](staalhal-60x30.ifcfem), de standaardparameters van de generator `design-mockup/src/components/openFem3d/wizards/staalhal.ts` (wizard "Stalen hal…", MCP `open_fem_3d_staalhal_maken`), bewaakt door `design-mockup/test-open-fem3d-staalhal.mjs` | staalhal 60 × 30 m: 11 spanten (HEA 450 ingeklemd, IPE 600), gordingen IPE 160 en randliggers HEA 160 scharnierend, dak- en wandverbanden CHS 88,9×4; 165 knopen, 340 staven; permanent, sneeuw, wind dwars en wind langs | reacties per geval gelijk aan de handgetallen (540, 1008, 499,2 + 864 en 84 kN), evenwicht, doorbuiging < L/250 en zijverplaatsing goot < h/150 |
| `design-mockup/test-open-fem3d-staalhal-generator.mjs`, `test-staalhal-sidecar.mjs`, `src-tauri/crates/openaec-mcp-server/tests/staalhal_mcp.rs` | de generator met andere parameters: lessenaarsdak met scharnierende voeten, plat dak met eigen verbandvakken, spantafstand als maximum, helling in graden, wind uit de stuwdruk; het balkrooster op palen (66 palen, 75 balken, 22 poeren) en de statisch bepaalde horizontale oplegging; de keten via MCP | aantallen uit de indeling; ΣR per geval uit last × oppervlak; Σ paalreacties = Σ lasten + eigen gewicht rooster (2500 · 0,4 · 0,6 · 9,81 · 467,6 m = 2752,3 kN); q_p en c_pe met de hand uit NEN-EN 1991-1-4 |
| `design-mockup/test-open-fem3d-staalhal-pdelta.mjs` (#60) | tweede orde (P-Δ) van de stalen hal uit de wizard door de rekenweg van de app en de echte kern: de 5 gevallen en 14 standaardcombinaties van de standaardhal, de 28 UGT-varianten met scheefstand ±X/±Y (φ = 1/414,9), een lessenaarsdak met scharnierende voeten, een plat dak en de hal op een balkrooster met palen; 104 berekeningen | convergent en stabiel; ΣR per geval gelijk aan de handsom (last × oppervlak, Σ ρ·A·g·L) en per combinatie Σ γ·handsom, met scheefstand nog −richting·φ·ΣR_z; onafhankelijke krachtensom (grootste ΔF 3,1 × 10⁻¹⁰ kN, ΔM 9,6 × 10⁻⁹ kNm) |
| [3D-tekenbediening en camerafit](tekenbediening-en-camerafit.md) | knoopsnap bij twee getekende staven, selectie, passend beeld en behoud van camerapositie | GUI-proef met gemeten bedieningstijden |

Alle afmetingen, materiaalwaarden, lasten, opleggingen en verwachte knoopresultaten staan in de JSON-bestanden. `cases.json` gebruikt SI-eenheden: m, N, N·m, Pa en rad. Z blijft de verticale as van het bestaande 2D-model; Y is de extra horizontale richting. De TU Delft-referentie gebruikt kN·m voor momenten en kN·m/rad voor rotatiestijfheid.

## Bronbasis en keuzes

- De zes doorsnedewaarden `A`, `E`, `G`, `J`, `Iy` en `Iz` van een 3D-liggerelement volgen de standaardformulering van de matrixverplaatsingsmethode (McGuire, Gallagher & Ziemian, *Matrix Structural Analysis*, 2e druk, hfst. 4–5).
- De lineaire coördinatentransformatie definieert `x` van begin- naar eindknoop, `y = normalize(vecxz × x)` en `z = x × y` (zelfde bron). `vecxz` mag niet evenwijdig zijn aan de staaf.
- [TU Delft, extensie-element](https://oit.tudelft.nl/CIEM5000/2026/lecture1/single_element.html) geeft de axiale relatie `F = EA(u₂-u₁)/L`.
- [MIT, uitkraging met puntlast](https://live.ocw.mit.edu/courses/16-001-unified-engineering-materials-and-structures-fall-2021/mit16_001_f21_pset12_sol.pdf) geeft de Euler-Bernoulli-verplaatsing en helling; de twee dwarsrichtingen zijn hier afzonderlijk toegepast met `Iz` voor lokale `y`-buiging en `Iy` voor lokale `z`-buiging.
- [TU Delft, 3D-raamwerk met torsie](https://oit.tudelft.nl/CIEM5000/2026/lecture2/example.html) geeft `GJ/L`, de 5×5-matrix, de belastingvector en afgeronde eindresultaten. De JSON bewaart meer cijfers door het gepubliceerde gereduceerde stelsel exact op te lossen.
- [MIT, driepuntsbuiging](https://ocw.mit.edu/courses/3-91-mechanical-behavior-of-plastics-spring-2007/db3dd94238ceb7a9796bf5c7773afa0e_14_bdisp.pdf) geeft `δ = PL³/(48EI)` voor een in het midden belaste, vrij opgelegde ligger.

De lineaire gevallen gebruiken kleine verplaatsingen, lineair elastisch
materiaal en Euler-Bernoulli-buiging. Daarnaast toetst de geautomatiseerde set
een direct iteratief P-Delta-geval en lineaire eigenwaarde-knik. Eigengewicht,
lokale lijnlasten, lokale staafpuntlasten, oplegveren, temperatuurbelastingen en opgelegde knoopverplaatsingen lopen inmiddels door
dezelfde productieroute. Excentriciteiten en releases zijn nog geen onderdeel
van deze basis. `J` is de Saint-Venant-torsieconstante. Reacties in de JSON zijn
krachten en momenten die de oplegging op de constructie uitoefent.

## Afleiding van de controlegetallen

1. **Schuine trekstaaf.** `L=3 m`, asrichting `n=(2/3,2/3,1/3)` en `F=9000 N` langs die as. De eindverlenging is `FL/(EA)=9/700000 m`; de drie globale verplaatsingen zijn deze waarde maal `n`. Door `r × F = 0` ontstaan geen reactiemomenten.
2. **Buiging om twee assen.** Bij `L=2 m` gelden `u_y=F_yL³/(3E I_z)=1/315 m`, `u_z=F_zL³/(3E I_y)=2/315 m`, `r_y=-F_zL²/(2E I_y)=-1/210 rad` en `r_z=F_yL²/(2E I_z)=1/420 rad`. Het inklemmingsmoment volgt uit `M_A=-(r_AB × F_B)`.
3. **Schuine torsie.** `L=5 m`, asrichting `n=(0,3/5,4/5)` en `T=1000 N·m`. De eindverdraaiing is `TL/(GJ)=1/80 rad` en wijst langs `n`.
4. **Ligger met middenlast.** `L=4 m`, `P=1000 N`, dus `u_z(M)=-PL³/(48E I_y)=-1/1260 m`, `R_z(A)=R_z(B)=P/2=500 N` en `r_y(M)=0` door symmetrie. De rotatie om X is bij A alleen vastgezet om de onbelaste torsie-rigide-lichaamsmode te verwijderen.
5. **TU Delft-raamwerk.** Voor de vrije rotaties: `[[4400,1000],[1000,2400]] · [φ₂,φ₃] = [2,4]`. Exact: `φ₂=1/11950 rad`, `φ₃=39/23900 rad`. Uit `K·u-f` volgen de drie oplegreacties `20/239`, `-8/239` en `-634/239 kN·m`. Het gepubliceerde voorbeeld toont afgeronde waarden.
6. **Revolute X.** Een staaf van `3 m` met `G = E/(2(1+ν))`,
   `E = 210 GPa`, `ν = 0,3`, `J = 10⁻⁵ m⁴` en `T = 5 kNm` geeft
   `θx = TL/(GJ) = 0,0185714285714 rad`. Op knoop 1 zijn alle translaties en
   `Ry/Rz` vast; alleen `Rx` is vrij. Knoop 2 neemt een reactiekoppel van
   `5 kNm` op.
7. **P-Delta-nultoestand.** De belasting `Fz=-10 kN` staat op de geblokkeerde
   `Uz` van knoop 2. Alle vrije verplaatsingen en rotaties zijn exact nul,
   `Rz=+10 kN`, de geometrische stijfheidsbijdrage is nul en daarom is de
   tweede-ordeversterking exact `1,0`. Een uitsluitend relatieve
   convergentietoets mag deze geldige nuloplossing niet afwijzen.
8. **Vrij opgelegde staaf met middenpuntlast.** Voor een IPE200 met `L=4 m`
   en `Pz=-10 kN` op `x=2 m` geldt `Rz,A=Rz,B=5 kN`, `Vz=+5/-5 kN`,
   `My,max=PL/4=10 kNm` en `wmax=PL³/(48EI)=3,2727867779 mm`. Deze waarden
   zijn op 26 september 2026 via `model_3d_bouwen` en `rekenen` uit de echte
   Linux-desktopapp gelezen; de numerieke afwijking was kleiner dan `2·10⁻¹³`.
9. **Uitkraging met verticale eindveer.** Voor een IPE200 met `L=2 m`, een
   verticale veer `kz=370 kN/m` en `Pz=-10 kN` geldt
   `u=P/(3EI/L³+k)`. De desktopapp gaf `u=5,2693979713 mm`,
   `Rveer=1,9496772494 kN` en `Rinklem=8,0503227506 kN`. Daarmee geldt
   `Rveer=-k·u` op machineprecisie en is de totale reactie exact `10 kN`.
10. **Vrije thermische uitzetting.** Een betonnen staaf van `2 m` met
    `α=10·10⁻⁶/K` en `ΔT=30 K` hoort `αΔT·L=0,600000 mm` uit te zetten.
    De zelfstandige desktopapp gaf exact `0,6000000000000001 mm`; reacties en
    normaalkracht bleven beperkt tot `2,3·10⁻¹³ kN` numerieke afrondruis.
11. **Opgelegde axiale verplaatsing.** Voor een IPE200 met `L=2 m`,
    `E=210 GPa`, `A=2850 mm²` en `δx=1,000 mm` geldt
    `N=EAδ/L=299,25 kN`. De zelfstandige desktopapp gaf exact `ux=1,000 mm`,
    reacties `-299,25/+299,25 kN` en een constante normaalkracht van
    `299,25 kN`. Het volledig voorgeschreven model wordt als geldige
    P-Delta-nultoestand met versterkingsfactor `1,0` verwerkt.

## Geautomatiseerd bewijs

Vanuit `src-tauri`:

```bash
cargo test -p open-fem-3d --test reference_cases --offline
cargo test -p open-fem-3d --test cases_json --offline
cargo test -p open-fem-3d --test trek_schijf_tweede_orde --offline
cargo test -p open-fem-3d --test plate_cases --offline
cargo test -p openaec-mcp-server --test stdio_roundtrip --offline
```

`plate_cases` toetst de platen (MITC4-vierhoeken, contractversie 2) tegen de
plaattheorie: vrij opgelegde en ingeklemde vierkante plaat met netverfijning
(doorbuiging, veld- en inklemmoment, randdwarskracht), uitkragende strook en
wandschijf tegen de balktheorie (met afschuiving), vloer op randliggers
(evenwicht) en een geknipte ligger gelijk aan de ongeknipte. Het rekennet en
de hele keten via de kernbinary toetst `design-mockup/test-open-fem3d-platen.mjs`,
ook met randopleggingen uit het model: scharnier om X/Y langs de randen geeft
exact dezelfde plaat als de opleggingen per randknoop (doorbuiging −0,03 %
t.o.v. 0,00406·qa⁴/D), een zacht vrij opgelegde rand (alle draaiingen vrij)
+0,14 %, ingeklemde randen +0,46 % in de doorbuiging en −0,73 % in het
inklemmoment −0,0513·qa²; alleen Z-rollen wordt als mechanisme geweigerd.

De eerste opdracht voert zevenentwintig onafhankelijke adaptertests uit:

- schuine trekstaaf in X/Y/Z;
- twee-assige uitkraging met afzonderlijke `Iy` en `Iz`;
- torsie van een ruimtelijk geroteerde staaf;
- revolute X, Y en Z met analytische rotatie en reactiekoppel;
- rolhoek van 90° met het openbare contract in radialen;
- direct P-Delta met convergentie en eigenwaarde-knik;
- P-Delta met exact nul vrije verplaatsing en een niet-nulle oplegreactie;
- portaal waarbij numerieke nulmodi niet als fysieke knikmodus tellen;
- afwijzing van een ongeldig model vóór de engine-aanroep.
- lokale gelijkmatig verdeelde staaflast op een uitkraging;
- lokale `My`-eindrelease onder een gelijkmatig verdeelde last, met de gesloten
  oplegreacties en exact nul eindmoment aan het scharnier;
- lokale staafpuntlast op een vrij opgelegde staaf, inclusief veldresultaten.
- verticale oplegveer parallel aan een uitkraging, inclusief veerreactie in
  lineaire en directe tweede-ordeanalyse en afwijzing van dubbel vastgelegde DOF's.
- vrije uniforme thermische uitzetting met expliciete materiaalcoëfficiënt en
  afwijzing van een temperatuurbelasting met uitsluitend nulwaarden.
- opgelegde axiale verplaatsing met `EAδ/L`, gelijke tegengestelde reacties,
  invoercontrole en een volledig voorgeschreven directe tweede-ordeanalyse.
- opgelegde eindrotatie met de analytische slope-deflection-momenten,
  dwarskrachten en globaal evenwicht.
- vrij torsiemechanisme met een onbruikbaar solverresidu, dat hard wordt
  afgewezen met hersteltekst voor oplegging, revolute en rotatieveer.
- dezelfde gesegmenteerde kolom onder druk, zonder normaalkracht en onder trek;
  druk vergroot de zijdelingse verplaatsing en trek verkleint deze.
- dezelfde kolom op `0,90 Pcr` en `1,05 Pcr`; de eerste toestand convergeert
  met eindige waarden en sterke versterking, terwijl de tweede vóór acceptatie
  wordt afgewezen omdat `alpha_cr <= 1,0`.
- Eulerknik van een ingeklemde kolom met 1, 2, 4, 8 en 16 elementen; de
  relatieve fout daalt achtereenvolgens van `7,522·10⁻³` naar
  `5,121·10⁻⁴`, `3,277·10⁻⁵`, `2,060·10⁻⁶` en `1,290·10⁻⁷`.
- geen onterechte melding "nearly vertical" voor een ligger langs Y of een
  kolom langs Z, terwijl de overige meldingen van de kern blijven staan (#61);
- een mechanisme: de fout noemt het deel, de vrije bewegingen en wat te doen,
  ook in tweede orde (#64);
- een intern mechanisme (twee aan beide einden scharnierende staven op één lijn
  tussen twee inklemmingen) wordt als intern mechanisme gemeld;
- een portaal met ruimtelijke scharnieren dat buiten zijn vlak kan omvallen:
  een oplossing met een melding vooraan, een fout bij een last die die beweging
  aanstoot en geen melding als het goed is opgelegd;
- een trek-alleen staaf die uitvalt, telt niet mee in de opleggingscontrole;
- pendelkolommen onder een starre schijf zonder verband: de melding noemt het
  zwaaien en draaien van de schijf.

De opdracht `--test trek_schijf_tweede_orde` voert elf tests uit voor
trek-alleen staven, starre schijven en de eigen tweede orde van de adapter
(#60). De vijf tweede-ordetests, met de getallen van 6 oktober 2026:

- uitkragende kolom, `L = 4 m` in 8 elementen, `P = 0,3·N_cr` en `H = 1 kN`:
  de kopverplaatsing versterkt volgens `1/(1 − P/N_cr) = 1,4286` binnen 1 %
  (de exacte balk-kolomoplossing `3(tan μ − μ)/μ³ = 1,4228` ligt 0,4 % lager),
  `α_cr = N_cr/P = 3,333` binnen 1 %, `Rz = P`, `M = H·L + P·δ` en
  momentensom = `Σ N·(e_x × Δu)`;
- een staafeindscharnier telt mee in de knikfactor:
  `N_cr = (4,4934)²·EI/L²` (ingeklemd–scharnierend) binnen 1 %;
- portaal 8 × 5 m met de ligger in 12 elementen (114 vrije vrijheidsgraden,
  boven de grens van 64 waar de P-Δ van de externe kern faalde):
  `α_cr = 5,9474`, zijwaartse versterking 1,20064 tegen
  `1/(1 − 1/α_cr) = 1,20212`, krachtensom binnen `10⁻⁸`;
- raamwerk van 4 × 4 × 4 vakken met kruisverbanden (125 knopen, 600 vrije
  vrijheidsgraden): rekent zonder factorisatiefout, `α_cr = 64,08`,
  versterking 1,01639 in 4 iteraties, krachtensom binnen `10⁻⁷`;
- schijven, trek-alleen en tweede orde samen: per kruis in de belaste gevel
  valt de gedrukte diagonaal weg en het evenwicht sluit met het
  tweede-ordemoment.

Op het niveau van de app bewaken `test-open-fem3d-large-frame.mjs`,
`test-open-fem3d-campus-frame.mjs` (zie de verificaties van het
[staalraam](groot-staalraam-verificatie.md) en het
[vierlaagse raam](groot-vierlaags-raam-verificatie.md)) en
`test-open-fem3d-staalhal-pdelta.mjs` de tweede orde door de rekenweg van de app.
Die laatste rekent 104 P-Δ-berekeningen van de stalen hal (vier tegelijk, zoals
de app ze ook tegelijk rekent; circa 21 s, op een drukke machine tot circa 40 s): kleinste `α_cr` 17,50 (balkrooster,
UGT 6.10b sneeuw leidend), grootste versterking 1,1796 (scheefstand +X),
hoogstens 6 iteraties.

**Beperkingen van de tweede orde.** `1/(1 − N/N_cr)`, en zo ook
`1/(1 − 1/α_cr)`, is zelf een benadering. Voor de uitkragende kolom wijkt de
exacte versterking `3(tan μ − μ)/μ³`, met `μ = (π/2)·√(N/N_cr)`, er 0,4 % van af
bij `N/N_cr = 0,3`, 0,99 % bij 0,7 en 1,3 % bij 0,9: vanaf ongeveer 0,7 meer dan
1 %. De kern onderverdeelt een staaf niet: een kolom die als één staaf is
ingevoerd, krijgt de P-δ-invloed binnen de staaf alleen via de consistente
geometrische stijfheid van dat ene element (bij een ingeklemde kolom als één
element ligt `N_cr` 0,75 % te hoog, zie de Eulerknik hierboven).

De MCP-test stuurt daarnaast een volledig JSON-RPC-verzoek door de
`solve_open_fem_3d`-tool en herhaalt het revolute-X-geval. De browser-devroute
accepteert exact [`revolute-x-request.json`](revolute-x-request.json) op
`POST /api/openFem3d/solve`. Hetzelfde eindpunt accepteert
[`pdelta-nultoestand-request.json`](pdelta-nultoestand-request.json) en geeft
`converged=true`, `stable=true`, `maxAmplification=1` en `Rz=10 kN` terug.

De tweede opdracht leest de vier gevallen rechtstreeks uit `cases.json` en
controleert ieder opgegeven verplaatsings- en reactieveld. De grootste absolute
afwijkingen zijn respectievelijk `8,882·10⁻¹⁶`, `3,553·10⁻¹⁵`,
`1,110·10⁻¹⁵` en `1,084·10⁻¹⁹` in de adapteruitvoereenheden; de grootste
relatieve afwijking over alle vier gevallen is `1,561·10⁻¹⁵`. Een onafhankelijke
som van `ΣF` en `ΣM` blijft daarbij voor ieder geval onder
`3,553·10⁻¹⁵ kN/kNm`.

## Nog te verifiëren

1. Zet het gereduceerde TU Delft-geval om naar een volledig 6-DOF-model en
   vergelijk ook de gemonteerde globale stijfheidsmatrix.
2. Controleer per model zelfstandig `ΣF = 0`, `ΣM = 0` en de energie-identiteit.
3. Voeg gepubliceerde tweede-ordebenchmarks, releases en
   een revolute-oplegging in een globaal geroteerd model toe.
4. Vergelijk een selectie met een onafhankelijke tweede solver.

Voor verdere dekking blijven globale staaflastinvoer, excentriciteiten en
elementreleases nodig. Gebruik daarvoor afzonderlijke gepubliceerde
referentie-uitkomsten of een onafhankelijke tweede solver.
