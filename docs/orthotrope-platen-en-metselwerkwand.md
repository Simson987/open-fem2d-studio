# Orthotrope platen en de metselwerkwand (#79, #97)

## Probleem

De 3D-kern (externe kern, MITC4) rekent platen isotroop: één E en één ν. De besluiten in #97
vragen een wandplaat met E verticaal = E metselwerk, E horizontaal ≈ 0 en G > 0; CLT (#79) vraagt
ook verschillende stijfheden per richting. Eén voorziening voor beide: een orthotrope schaal.

## Onderzoek

- `open-fem-3d` maakt per plaatelement een `SolverQuadElement` (knopen, materiaal-id, dikte). De kern
  stelt de stijfheid op in `element::quad::mitc4_local_stiffness(coords, E, ν, t)`: EAS-7-membraan,
  Mindlin-buiging, ANS-dwarskracht (Bathe–Dvorkin) en een boorstijfheid. De materiaalmatrices staan
  hard in die functie. De assemblage roept haar op drie plaatsen aan (`assembly.rs` 2×, `sparse_assembly.rs`).
- De kern kent geen element met een vrij op te geven stijfheidsmatrix. Een veer (`ConnectorElement`)
  verbindt maar twee knopen. Isotrope elementen optellen geeft altijd weer een isotrope plaat, dus
  E_x ≠ E_y is zonder ingreep in de kern niet te maken.
- Plaatkrachten rekent de adapter al zelf terug (`shell.rs`, met `quad_stresses` van de kern). De
  spanningen in de kernuitvoer gebruikt hij niet.

## Ontwerp

1. **Kern (kleine eigen wijziging).** De kern staat als kopie van dezelfde revisie in
   `vendor/dedaliano-engine`, ingehaakt met `[patch]` in `src-tauri/Cargo.toml`. `SolverQuadElement`
   krijgt het optionele veld `constitutive` met de matrices A (membraan), D (buiging) en S
   (dwarskracht), plus een referentie voor de boorstijfheid, alle in de eigen elementassen. Zonder dat
   veld loopt het ongewijzigde isotrope pad. `mitc4_local_stiffness_general` volgt dezelfde formulering
   met volle 3×3-matrices. Met isotrope matrices geeft zij de bronmatrix tot 1·10⁻¹⁶ relatief
   (test `algemene_mitc4_met_isotrope_matrices_is_de_bron`). Alle wijzigingen staan in
   `vendor/dedaliano-engine/OPEN-FEM-WIJZIGINGEN.md`.
2. **Adapter.** `Plate3D.orthotropy` = {E_x, E_y, G_xy, ν_xy, G_xz?, G_yz?} in **plaatassen**: bij een
   verticale plaat wijst y omhoog. `orthotroop.rs` bouwt daarmee Q (vlakke spanning, Reddy §3.3),
   A = Q·t, D = Q·t³/12 en S = 5/6·G·t, en draait die per element naar de elementassen (de x-as van
   het element ligt langs rand 0→1). Een omgekeerde omloop is een spiegeling; die wordt ook
   opgevangen. Bij het terugrekenen leveren de kernfuncties met E = 1 en ν = 0 de rekken en
   krommingen, en geven A, D en S de krachten. Het contract blijft versie 2: het veld is optioneel.
3. **Metselwerkwand.** Een verticale 3D-plaat met `masonry` = {volumegewicht, E verticaal}. De
   solver geeft haar `orthotropy` met E_y = E, E_x = 10⁻⁶·E en G = 0,4·E (NEN-EN 1996-1-1 §3.7.3).
   - **E_x is 10⁻⁶·E, niet E/1000.** Met E/1000 werkt een wand van 2,5 m hoog nog merkbaar mee met een
     slappe stalen funderingsbalk: het balkmoment kwam 11 % onder q·L²/8 uit. Met 10⁻⁶ is het verschil
     0,3 % (test `metselwerkwand_werkt_niet_mee_met_de_funderingsbalk`). Precies 0 maakt de
     EAS-condensatie singulier.
   - **Eigen gewicht** is een vlaklast γ·t (kN/m²) in −Z, op de bestaande route voor het eigen gewicht
     van platen.
   - **Latei:** een gewone staaf van het model, met doorsnede, materiaal, toetsing en rapport zoals
     elke staaf. Hij ligt op de bovenrand van de opening en loopt aan beide zijden met de
     opleglengte de wand in. Het net deelt de knopen op zijn as. Omdat E_x ≈ 0, draagt het model het
     metselwerk boven de opening via de latei af naar de penanten.
   - **Lastspreiding boven de opening** (open punt in #97). Met E_x ≈ 0 kan het model geen boog
     vormen. Het rekenmodel legt daarom altijd de **volle hoogte** op de latei. Dat is veilig voor de
     latei, en de penanten krijgen dezelfde totale last. De keuze per opening (standaard „driehoek
     60°", anders „volle hoogte") geldt voor de **lateibelasting in de lateitoets**: de
     ontwerpkrachten M en V en de oplegdruk op het metselwerk.
     - Driehoek: het eigen gewicht van een driehoek met basis L_eff en tophoeken van 60°
       (hoogte L_eff·√3/2).
     - Voorwaarde: het metselwerk boven de latei is minstens zo hoog als die driehoek. Is dat niet
       zo, dan valt de toets terug op de volle hoogte (met melding), want dan reikt de last op de
       wandkop binnen de driehoek.
     - Lokale horizontale stijfheid boven de latei is niet gekozen: de boogdruk moet dan door
       penanten met E_x ≈ 0 worden opgenomen. Dat hangt af van de netfijnheid en is niet analytisch te
       controleren.
4. **Koppeling met de metselwerktoets (#98).** Per wand neemt de toets de normaalkracht per meter over
   uit de wandplaat (n_yy boven, midden en onder, minst gunstig over de lengte), en per latei de
   oplegkracht als geconcentreerde last (§6.1.3). Dat gaat via
   `design-mockup/src/lib/metselwerkUit3d.ts`.

## Niet in deze stap

- De CLT-opbouw (gelaagde A, D en S per laagopbouw) en de plaattypenbibliotheek van #79. De
  voorziening in kern en adapter is er wel. De TS-kant weigert hout en CLT nog
  (`openFem3dPlateMaterial.ts`).
- Spanningen in de kernuitvoer, de massamatrix en de geometrische stijfheid blijven isotroop. De
  adapter gebruikt ze niet, en platen rekenen geen tweede orde.
