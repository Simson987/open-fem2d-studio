# Vierkantsmesh en plaatvoorbeelden

De Python-generator `examples/plate_cases.py` maakt vijf herhaalbare verzoeken.
Alle grootheden zijn **m, kN en MPa**. Voer de Rust-binaries uit vanuit de
repositoryroot, na `cargo build -p openaec-native-fem --bins` in `src-tauri`:

```bash
echo '{"originX":0,"originY":0,"widthM":2,"heightM":2,"cellSizeM":1,"materialId":1,"thicknessM":0.1}' |
  src-tauri/target/debug/native-square-mesh
```

De uitvoer bevat vier exacte vierkanten, negen knopen en de ID's van de
vier buitenranden. Afmetingen die geen geheel aantal cellen vormen worden
afgewezen.

```bash
python3 src-tauri/crates/native-fem/examples/plate_cases.py quad_patch |
  src-tauri/target/debug/native-quad2d
python3 src-tauri/crates/native-fem/examples/plate_cases.py quad_variable_e |
  src-tauri/target/debug/native-quad2d
python3 src-tauri/crates/native-fem/examples/plate_cases.py hybrid_navier |
  src-tauri/target/debug/native-hybrid-plate
python3 src-tauri/crates/native-fem/examples/plate_cases.py hybrid_fnl_cantilever |
  src-tauri/target/debug/native-hybrid-plate
python3 src-tauri/crates/native-fem/examples/plate_cases.py cement_2021_cantilever |
  src-tauri/target/debug/native-hybrid-plate
```

| Geval | Berekening en controle |
| --- | --- |
| `quad_patch` | Eén Q4-schijfelement, E=1000 MPa, t=0,1 m, trek F=100 kN op de rechterrand. De spanning is F/t=1 MPa; de rechterrand verplaatst 0,001 m. |
| `quad_variable_e` | Dezelfde trekproef, nu E(0)=1000 MPa en E(0,002)=800 MPa. Bij piekbelasting volgt uit F/t=E(rek)×rek de rek 0,0011270 en E=887,30 MPa. Na ontlasten is de verplaatsing circa nul, terwijl de lagere modulus bewaard blijft. |
| `hybrid_navier` | Vierzijdig vrij opgelegde vierkante buigplaat: a=2 m, t=0,1 m, E=30 GPa, ν=0,2, q=1 kN/m². De klassieke middenzakking 0,00406qa⁴/D is 2,49446×10⁻⁵ m. Het 6×6 rooster geeft 2,39106×10⁻⁵ m (4,1% verschil). |
| `hybrid_fnl_cantilever` | Twee vierhoekige buigelementen met een afnemende E(vezelrek)-curve en een belast/ontlast-pad. De maximale vezelrek en de effectieve E blijven na ontlasten per element bewaard; de uitkraging keert bij deze secantwet elastisch terug naar nulverplaatsing. |
| `cement_2021_cantilever` | Gebaseerd op figuur 14 van Braam en Blaauwendraad: 10 m breed, 8 m uitkraging, t=0,6 m, q=30 kN/m² en ν=0,2. In dit voorbeeld is **E=30 GPa aangenomen**. Het 2 m rooster geeft bij het eerste elementcentrum (1 m vanaf inklemming) v_y=210 kN/m, gelijk aan q×(8−1). Het berekent geen beugelwapening. |

## Elementformulering en grenzen

Het [Cement-artikel *Wapenen van schijven en platen*](https://struct4u.com/app/uploads/2022/11/struct4u_2021_cement_artikel.pdf)
(p. 22–23) beschrijft een vierhoekig hybride Kirchhoff-element met 12
knoopvrijheidsgraden, kubische zakking langs elke rand, lineaire normale
randrotatie en 17 onafhankelijke momentparameters. `native-hybrid-plate`
implementeert een zelfstandige 17-parameter variant: kwadratische momenten
die lokaal in evenwicht zijn, condenseerd via complementaire energie.
`native-quad2d` is een afzonderlijk standaard Q4-**schijf**element voor
vlakspanning, met 2×2 Gauss-integratie, Green-Lagrange GNL en staal-/beton-FNL.

De hybride buigplaat heeft een **secantmodulus-omhulling**: de invoer
`modulusCurves` koppelt hoofdvezelrek aan een positieve, niet-toenemende E.
De hoogste absolute vezelrek per element blijft gedurende `loadPath` bewaard.
Dat is een eigen FNL-uitbreiding van de elastische hybride plaat, geen
scheurmodel of plastische doorsnedewet van Blaauwendraad. Opgegeven
`pressureKnM2` wordt voorlopig als gelijke knooplast per vierhoek aangebracht;
dit convergeert bij roosterverfijning, maar is geen exacte consistente
vlaklastvector. Een kwantitatieve XFEM4U-vergelijking, dwarskrachtwapening,
scheurwijdte, breukenergie-regularisatie, ortotropie en GNL-buiging ontbreken.

De Navier-referentie voor de vrij opgelegde vierkante plaat is ook gebruikt in
de [ScadSoft verificatie van een vierzijdig opgelegde plaat](https://scadsoft.com/tests_scad/en/index/test/46).
Voor de Cement-plaat is de dwarskrachtlijn de controle; het artikel levert geen
openbare knoopverplaatsingen om een volledige implementatievergelijking te doen.
