# Gecombineerd plaat–raam–volume-acceptatiemodel

[`combined-plate-frame-solid-acceptance.json`](combined-plate-frame-solid-acceptance.json) is een versieerde, machineleesbare specificatie. De geometrie is één conceptueel model: een uitkragend dek op `z=3 m`, een kolom van `z=0` tot `3 m`, en een funderingsvolume van `z=-1` tot `0 m`. **De uitvoerbare stappen rekenen deze componenten afzonderlijk door.** Een gekoppelde raam–plaat–volume-FEM met één globale stijfheidsmatrix, gedeelde randvoorwaarden en wederzijdse krachtsoverdracht bestaat hier nog niet.

Alle invoer gebruikt m, kN en MPa. Het dek meet `2 × 1 × 0,2 m` en heeft een onderste betonlaag van `0,18 m` en een bovenste staallaag van `0,02 m`. De elastische referentielaag heeft respectievelijk `E=30` en `200 GPa`, beide met `ν=0,2`. De plaat is langs `x=0` ingeklemd. De basisdruk is `−4 kN/m²`, op het rechter bovenkwadrant komt `−12 kN/m²` erbij, en langs de vrije rand loopt de lijnlast van `−2` naar `−6 kN/m`. De exacte aangebrachte dwarskracht is `−18 kN`; de eerste momenten `∫xq dA + ∫xl ds` en `∫yq dA + ∫yl ds` zijn `−25` en `−65/6 kNm`. Een horizontale randkracht van `+10 kN` en het pad `[0, 0,5, 1, 0,25, 0, 1]` staan ook in de specificatie.

De gewone, kleine test:

```bash
cd src-tauri
cargo test -p openaec-native-fem --offline --test combined_plate_frame_solid_acceptance
```

De uitvoerbare testfasen en hun werkelijke reikwijdte:

| Fase | Controle | Grens |
| --- | --- | --- |
| Asymmetrische elastische Q4-plaat | Onafhankelijke dikte-integralen voor A/B/D; identieke twee lineaire backends; `4×2` en `8×4` roosters; verticale reacties `+18 kN` en beide globale eerste momenten `+25` en `+65/6 kNm`. Bij de x-ascontrole wordt het teken van de gerapporteerde `thetaX`-reactie omgezet omdat `thetaX=−w,y`. | De membraanverlenging wordt **lokaal** tot `N=0` gecondenseerd. Er zijn geen globale `u,v`-plaatvrijheidsgraden of plastische vezeltoestanden. Twee roosters met <15% hoekzakkingverschil zijn slechts een eerste verfijningspoort. |
| Homogene geometrische shell | Horizontale +10 kN, dwarslast −18 kN en beide reactieresultanten; in-vlak verplaatsing en negatieve zakking. | Deze route gebruikt één homogene materiaallaag. Zij bewijst geen asymmetrische A/B/D- of scheur/plastische koppeling. |
| 3D-kolom | Afzonderlijke Euler–Bernoulli P-Delta-vergelijking met 10 kN zijwaartse last en 100 kN drukkracht; versterkte zijverplaatsing en globale reacties. | Kolomkopkrachten komen niet uit de plaat, en de voet is niet aan het volume gekoppeld. |
| Tet4-volume-GNL | Drie keer eindige eenvoudige schering (`γ, −γ, γ`); onafhankelijke Green-rek `E_xz=γ/2`, `E_zz=γ²/2` en eerste Piola-tractie inclusief kubische term. | Dit is een voorgeschreven-vervormingspatch voor St Venant–Kirchhoff, geen belast funderingscontact of staal-/betonontwerp. |
| Tet4 eindige-rek-J2 | Isochore rek `F=diag(exp(a),exp(−a),1)` met `a=0,003`; halve stap, piek, 10% ontlasting en herbelasting. Plastische rek, eerste Piola-spanningen en vlakreactie sluiten op de onafhankelijke gesloten Hencky/J2-retour. Bij ontlasten blijft de plastische historie behouden. | Dit is een afzonderlijke, verplaatsingsgestuurde staalcoupon op hetzelfde volume. Hij is niet gekoppeld aan het dek, de kolom of de betonnen schadecoupon. |
| Tet4-betonschade | Zwakke helft scheurt; sterke helft blijft intact; afzonderlijk opgegeven breukenergie en scheurbandbreedte; belasting–ontlasting–herbelasting. | Constitutieve coupon met opgelegde randvervormingen; geen betonplaat-buiging of gecombineerde GNL/FNL. |
| 2D-raam, voorgespannen ligger, dwarskracht en scheurwijdte | De bestaande JSON-voorbeelden worden met de publieke Rust-API's uitgevoerd. Parabolische voorspanning levert `16 kN/m` equivalente opwaartse belasting bij overdracht. De dwarskrachtvoorbeelden controleren bezwijkweerstand zonder en met beugels; de scheurwijdte krijgt een afzonderlijk ingevoerde spanning van de gescheurde doorsnede. | Dit zijn zelfstandige referenties, geen krachten uit het gecombineerde dek. Verliespercentage en scheurspanning zijn expliciete invoer. |

De betonnen plaatlaag bevat een `concreteCracking`-**plaatsaanduiding** met een restspanningsratio. Die bestaande 2D-wet heeft geen plaat-scheurbandlengte of breukenergie-regularisatie en wordt door de staalvezelplaat terecht geweigerd. De nieuwe afzonderlijke betonnen materiaalpunt- en diktevezelkern vereist een expliciete in-vlakse scheurbandbreedte. De fixture legt een voorgestelde breukenergie vast, maar laat de karakteristieke plaatlengte bewust `null` totdat een onderbouwde definitie en mesh-objectiviteitstest bestaan. De nieuwe staalplastische hybride-buigroute wordt afzonderlijk gevalideerd; de staalwet is in deze gecombineerde fixture nog doelinvoer omdat het dek hier niet met die route of met het raam en volume wordt gekoppeld.

De genegeerde test `coupled_plate_frame_solid_non_linear_acceptance_gate` mag pas actief worden zodra één pad de opgegeven belastingstappen, gelaagde materiaalhistorie, membraan/buig-GNL, scheur- en plastische zones en compatibele raam–plaat–volume-interfaces oplost. Dan zijn minimaal nodig: gedeelde verplaatsingen, gelijke maar tegengestelde interfacekrachten, globale evenwichtscontrole per stap, rollback na afgewezen Newtonstap, en verfijning van de scheur-/plastische zones.

## Expliciete grote-volumepoort

De normale test hierboven bouwt geen enorm model. De reeds aanwezige genegeerde release-tests worden apart gestart vanuit `src-tauri` met voldoende RAM:

```bash
cargo test -p openaec-native-fem --offline --release --test volume_finite_j2_250k_validation -- --ignored --nocapture
cargo test -p openaec-native-fem --offline --release --test volume_hex8_250k_general_validation -- --ignored --nocapture
cargo test -p openaec-native-fem --offline --release --test volume_hex8_250k_cavity_validation -- --ignored --nocapture
cargo test -p openaec-native-fem --offline --release --test volume_hex8_250k_five_valent_validation -- --ignored --nocapture
```

De eerste proef omvat 257.250 plastische Tet4-elementen, 139.968 vrijheidsgraden en vier threads met een gesloten Hencky/J2-affiene referentie. De algemene Hex8-proef omvat 250.047 vervormde cellen met drie materialen; de holteproef 260.416 cellen rond een centrale uitsparing; de vijfwaardige doorsnedeproef toetst een afzonderlijke topologie. Elk rapport controleert zijn eigen rek-, spannings-, reactie- en residucriteria. Deze voorbeelden tonen **schaalbaarheid van hun specifieke volumesolvers**. Ze bewijzen geen gekoppelde plaat–raam–volume-oplossing, willekeurige belastingen/topologieën, materiaalregularisatie of volledige constructieve validatie.
