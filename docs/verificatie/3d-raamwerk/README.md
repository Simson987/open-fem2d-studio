# Verificatiebasis voor 3D-raamwerken

Deze map bevat onafhankelijke referentieberekeningen voor de 3D-raamwerksolver
van Open FEM Studio. De getallen zijn analytisch of rechtstreeks uit een
gepubliceerde stijfheidsmatrix afgeleid. De Rust-adapter wordt automatisch
tegen de gesloten oplossingen getest. Op 26 september 2026 zijn alle eenentwintig
referentietests geslaagd, inclusief directe tweede orde, knik, staafrotatie en
revolute opleggingen om elke globale as. De set bewaakt ook oplegveren, opgelegde
rotaties, de kritieke-lastgrens en de geldige P-Delta-nultoestand
waarbij een belasting volledig op een geblokkeerde vrijheidsgraad staat.

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
| [`tu-delft-torsion-frame.json`](tu-delft-torsion-frame.json) | samengestelde stijfheidsmatrix van een 3D-raamwerk met buiging en torsie | TU Delft, uitgewerkt 3D-raamwerk |
| [`revolute-x-request.json`](revolute-x-request.json) | revolute X, torsiestijfheid, vrije rotatie en reactiekoppel via API/MCP | gesloten oplossing `θ = TL/GJ` |
| [`pdelta-nultoestand-request.json`](pdelta-nultoestand-request.json) | tweede orde bij exact nul vrije verplaatsing; reactie, convergentie en `B2=1` | direct evenwicht op de geblokkeerde vrijheidsgraad |
| [`groot-vierlaags-raam.ifcfem2d`](groot-vierlaags-raam.ifcfem2d) en [verificatie](groot-vierlaags-raam-verificatie.md) | 100 knopen, 235 staven, vier ruimtelijke belastinggevallen, volledige lineaire superpositie en GUI | onafhankelijke globale kracht- en momentbalans |

Alle afmetingen, materiaalwaarden, lasten, opleggingen en verwachte knoopresultaten staan in de JSON-bestanden. `cases.json` gebruikt SI-eenheden: m, N, N·m, Pa en rad. Z blijft de verticale as van het bestaande 2D-model; Y is de extra horizontale richting. De TU Delft-referentie gebruikt kN·m voor momenten en kN·m/rad voor rotatiestijfheid.

## Bronbasis en keuzes

- [OpenSees, 3D elasticBeamColumn](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/elements/elasticBeamColumn.html) specificeert de zes doorsnedewaarden `A`, `E`, `G`, `J`, `Iy` en `Iz` voor een 3D-liggerelement.
- [OpenSees, lineaire coördinatentransformatie](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/geomTransf/Linear.html) en de [implementatie van de lokale assen](https://opensees.berkeley.edu/OpenSees/api/doxygen2/html/LinearCrdTransf3d_8cpp-source.html) definiëren `x` van begin- naar eindknoop, `y = normalize(vecxz × x)` en `z = x × y`. Het oudere OpenSees-manual bevat een tegenstrijdige verbale omschrijving van de kruisproductvolgorde; de huidige formule en broncode zijn hier gevolgd. `vecxz` mag niet evenwijdig zijn aan de staaf.
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
cargo test -p frame3d-solver --test reference_cases --offline
cargo test -p frame3d-solver --test cases_json --offline
cargo test -p openaec-mcp-server --test stdio_roundtrip --offline
```

De eerste opdracht voert eenentwintig onafhankelijke adaptertests uit:

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

De MCP-test stuurt daarnaast een volledig JSON-RPC-verzoek door de
`solve_frame3d`-tool en herhaalt het revolute-X-geval. De browser-devroute
accepteert exact [`revolute-x-request.json`](revolute-x-request.json) op
`POST /api/frame3d/solve`. Hetzelfde eindpunt accepteert
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
