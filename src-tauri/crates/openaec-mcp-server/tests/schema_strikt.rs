//! Strikt schema en strikte invoer voor `check_steel_beam`, voor de
//! betontools (`check_concrete_beam`, `concrete_mn_kappa`) en voor de
//! houttools (`check_timber_beams`, `check_clt_beams`) en de aluminiumtoets
//! (`check_aluminium_beams`, issue #5) en de toets voor koudgevormde profielen
//! (`check_koudgevormd_beams`, issue #4).
//!
//! Waarom deze test bestaat: het oude schema zette `additionalProperties` op
//! `true` en verzweeg vijf velden met `#[serde(default)]`. Een client die dat
//! schema volgde liet `q_equiv_n_per_mm` en `z_a_mm` op nul vallen en toetste
//! kip daarmee **gunstiger** dan de app — onveilig aan de verkeerde kant. En
//! omdat nergens `deny_unknown_fields` stond, werd een tikfout in een veldnaam
//! volledig stil genegeerd: de toetsing liep door met een standaardwaarde.
//!
//! De test drijft de echte binary over stdio, net als `stdio_roundtrip.rs`.

use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");

/// Lees één regel JSON-RPC en ontleed hem. Ruime timeout: de eerste aanroep
/// initialiseert de profielendatabase.
async fn lees_bericht<R>(reader: &mut R) -> Value
where
    R: AsyncBufReadExt + Unpin,
{
    let mut regel = String::new();
    let n = timeout(Duration::from_secs(30), reader.read_line(&mut regel))
        .await
        .expect("timeout bij het wachten op een antwoord")
        .expect("read_line mislukt");
    assert!(n > 0, "EOF op stdout — de server is onverwacht gestopt");
    serde_json::from_str(regel.trim())
        .unwrap_or_else(|e| panic!("ongeldige JSON-RPC-regel {regel:?}: {e}"))
}

async fn schrijf(stdin: &mut ChildStdin, waarde: Value) {
    let mut regel = serde_json::to_string(&waarde).unwrap();
    regel.push('\n');
    stdin.write_all(regel.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();
}

/// Start de server en doe de `initialize`-handshake.
async fn start_server() -> (Child, ChildStdin, BufReader<ChildStdout>) {
    let mut child = Command::new(BIN_PATH)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("server starten");
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut reader = BufReader::new(stdout);

    schrijf(
        &mut stdin,
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "schema-strikt-test", "version": "0.0.0" }
            }
        }),
    )
    .await;
    let resp = lees_bericht(&mut reader).await;
    assert_eq!(resp["id"], 1);
    assert!(resp["error"].is_null(), "initialize gaf een fout: {resp:?}");

    (child, stdin, reader)
}

/// Geldige invoer: het referentieportaal, kolom HEB160 S235 — dezelfde
/// getallen als `steel-check/tests/portal_beam2.rs`, zodat hier geen enkel
/// getal verzonnen is.
fn geldige_invoer() -> Value {
    json!({
        "beam_id": 2,
        "profile_name": "HEB160",
        "steel_grade": "S235",
        "length_m": 2.5,
        "forces_envelope": [
            { "combination_id": 22, "position_mm": 0.0,
              "forces": { "n_ed": -233.911, "vy_ed": 0.0, "vz_ed": 17.357,
                          "mt_ed": 0.0, "my_ed": -63.139, "mz_ed": 0.0 } },
            { "combination_id": 21, "position_mm": 0.0,
              "forces": { "n_ed": -232.435, "vy_ed": 0.0, "vz_ed": 19.817,
                          "mt_ed": 0.0, "my_ed": -66.036, "mz_ed": 0.0 } },
            { "combination_id": 11, "position_mm": 0.0,
              "forces": { "n_ed": -201.988, "vy_ed": 0.0, "vz_ed": 17.184,
                          "mt_ed": 0.0, "my_ed": -57.423, "mz_ed": 0.0 } }
        ],
        "lateral_bracing": { "top_flange_positions": [], "bottom_flange_positions": [] },
        "buckling_length_y_m": 2.5,
        "buckling_length_z_m": 2.5,
        "deflection_limit_class": "Floor",
        "deflection_limit_numerator": 333,
        "deflection_actual_max_mm": 0.0,
        "is_cantilever": false,
        "consequence_class": "CC1",
        "pre_camber_mm": 0.0,
        "deflection_permanent_mm": 0.0,
        "q_equiv_n_per_mm": 0.0,
        "z_a_mm": 0.0
    })
}

/// Roep één tool aan en geef het `result`-object terug.
async fn roep_tool_aan(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    id: u32,
    tool: &str,
    argumenten: Value,
) -> Value {
    schrijf(
        stdin,
        json!({
            "jsonrpc": "2.0", "id": id, "method": "tools/call",
            "params": { "name": tool, "arguments": argumenten }
        }),
    )
    .await;
    let resp = lees_bericht(reader).await;
    assert_eq!(resp["id"], id);
    resp["result"].clone()
}

async fn roep_check_aan(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    id: u32,
    argumenten: Value,
) -> Value {
    roep_tool_aan(stdin, reader, id, "check_steel_beam", argumenten).await
}

/// Eén tooldefinitie uit `tools/list`.
async fn tooldefinitie(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    id: u32,
    naam: &str,
) -> Value {
    schrijf(
        stdin,
        json!({ "jsonrpc": "2.0", "id": id, "method": "tools/list", "params": {} }),
    )
    .await;
    let resp = lees_bericht(reader).await;
    resp["result"]["tools"]
        .as_array()
        .expect("tools is een array")
        .iter()
        .find(|t| t["name"] == naam)
        .unwrap_or_else(|| panic!("{naam} ontbreekt in tools/list"))
        .clone()
}

/// De foutmelding zoals de client hem te zien krijgt.
fn foutmelding(result: &Value) -> String {
    result["content"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string()
}

// ── 1. Het schema zelf ──────────────────────────────────────────────────────

#[tokio::test]
async fn schema_van_check_steel_beam_is_volledig_en_strikt() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    schrijf(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }),
    )
    .await;
    let resp = lees_bericht(&mut reader).await;
    let tools = resp["result"]["tools"]
        .as_array()
        .expect("tools is een array");
    let tool = tools
        .iter()
        .find(|t| t["name"] == "check_steel_beam")
        .expect("check_steel_beam ontbreekt in tools/list");
    let schema = &tool["inputSchema"];
    let props = &schema["properties"];

    // Onbekende velden worden geweigerd — spiegelt deny_unknown_fields.
    assert_eq!(
        schema["additionalProperties"], false,
        "check_steel_beam moet additionalProperties: false hebben"
    );

    // De velden met #[serde(default)] stonden niet in het oude schema.
    // `deflection_add_limit_numerator` kwam er in september 2026 bij, toen de
    // w_add-noemer van een vaste 150 naar de klassewaarde uit
    // NEN-EN 1990:2002/NB:2019 A1.4.3(3) ging; zonder dit veld in het schema
    // kan een client de referentie-noemer niet meer opgeven en wordt hij door
    // `additionalProperties: false` zelfs geweigerd.
    for veld in [
        "pre_camber_mm",
        "deflection_permanent_mm",
        "deflection_add_limit_numerator",
        "deflection_notes",
        "q_equiv_n_per_mm",
        "z_a_mm",
        "custom_section",
        // De staafstand noemt de flenzen in wereldtermen bij een staande
        // staaf; zonder dit veld in het schema weigert `additionalProperties:
        // false` een client die hem meestuurt.
        "staafstand",
        // De waarschuwing bij een naar links hellende staaf dicht bij 75°, waar
        // de bovenflens van het bovenvlak naar het ondervlak springt.
        "staafstand_notities",
        // De staafeinden (vrij, doorlopend) en de toelichting bij een
        // doorgaande lijn; zonder deze velden in het schema neemt de kern een
        // vrij eind stil als gaffel.
        "staafeinden",
        "staaf_notities",
        // Het eindprofiel van een verlopende staaf (ontwerp 15-09-2026, §5);
        // zonder dit veld in het schema weigert `additionalProperties: false`
        // een client die een verlopende staaf wil laten toetsen.
        "profile_end",
        // Een trek-alleen staaf (windverband): alleen trek wordt getoetst;
        // zonder dit veld in het schema weigert `additionalProperties: false`
        // een client die hem meestuurt.
        "tension_only",
        // De nettodoorsnede voor 6.2.3 (6.7); zonder dit veld in het schema
        // kan een client geen gaten in de aansluiting opgeven.
        "a_net_mm2",
        // De eindafwerking van massief rond (#226).
        "draadeind",
        // De bijkomende zakking per combinatie bepaald en de lengte van het
        // getoetste deel (een doorgaande lijn met een overstek); zonder deze
        // velden in het schema weigert `additionalProperties: false` de invoer
        // die `check_fem_model` en de app voor zo'n staaf bouwen.
        "deflection_add_mm",
        "deflection_length_m",
        // Een vrij eind in een tweede-orde-berekening met scheefstand: L in
        // plaats van 2·L; zonder dit veld in het schema weigert
        // `additionalProperties: false` de invoer van `check_fem_model`.
        "zijdelingse_knik_in_analyse",
    ] {
        assert!(
            props[veld].is_object(),
            "veld '{veld}' ontbreekt in het schema; een client laat het dan op de standaardwaarde vallen"
        );
    }
    assert_eq!(
        props["staafeinden"]["properties"]["begin"]["enum"],
        json!(["Gaffel", "Vrij", "Doorlopend"])
    );

    // Enums die de kern werkelijk kent. `FloorBrittlePartitions` hoort bij het
    // eerste gedachtestreepje van A1.4.3(3) (vloeren die scheurgevoelige
    // scheidingswanden dragen, w2 + w3 ≤ ℓ_rep/500).
    assert_eq!(
        props["deflection_limit_class"]["enum"],
        json!([
            "Floor",
            "FloorBrittlePartitions",
            "Roof",
            "Cantilever",
            "Custom"
        ])
    );
    assert_eq!(
        props["consequence_class"]["enum"],
        json!(["CC1", "CC2", "CC3"])
    );
    assert_eq!(
        props["steel_grade"]["enum"],
        json!(["S235", "S275", "S355", "S420", "S460"])
    );

    // lateral_bracing: beide arrays verplicht, geen extra velden.
    let bracing = &props["lateral_bracing"];
    assert_eq!(bracing["additionalProperties"], false);
    assert_eq!(
        bracing["required"],
        json!(["top_flange_positions", "bottom_flange_positions"])
    );
    assert!(bracing["properties"]["top_flange_positions"]["items"].is_object());
    assert!(bracing["properties"]["bottom_flange_positions"]["items"].is_object());

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── 2. Het gedrag van de server op geldige en ongeldige invoer ──────────────

#[tokio::test]
async fn geldige_invoer_wordt_gewoon_getoetst() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    let result = roep_check_aan(&mut stdin, &mut reader, 10, geldige_invoer()).await;
    assert_eq!(
        result["isError"],
        false,
        "geldige invoer moet gewoon rekenen, kreeg: {}",
        foutmelding(&result)
    );
    let checks = result["structuredContent"]["checks"]
        .as_array()
        .expect("resultaat moet een 'checks'-array bevatten");
    assert!(!checks.is_empty(), "er is geen enkele toets uitgevoerd");

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn tikfout_in_veldnaam_wordt_geweigerd_in_plaats_van_stil_genegeerd() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    // q_equiv_n_per_m in plaats van q_equiv_n_per_mm. Vóór deze fix rekende de
    // server door met q = 0 en viel de kiptoets gunstiger uit.
    let mut invoer = geldige_invoer();
    let obj = invoer.as_object_mut().unwrap();
    obj.remove("q_equiv_n_per_mm");
    obj.insert("q_equiv_n_per_m".to_string(), json!(12.5));

    let result = roep_check_aan(&mut stdin, &mut reader, 11, invoer).await;
    let melding = foutmelding(&result);
    assert_eq!(
        result["isError"], true,
        "een onbekend veld moet een fout geven, kreeg een resultaat: {result}"
    );
    assert!(
        melding.contains("q_equiv_n_per_m"),
        "de melding moet het onbekende veld noemen, kreeg: {melding}"
    );
    assert!(
        melding.contains("unknown field"),
        "de melding moet aangeven dat het veld onbekend is, kreeg: {melding}"
    );

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn leeg_lateral_bracing_geeft_een_begrijpelijke_fout() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    let mut invoer = geldige_invoer();
    invoer["lateral_bracing"] = json!({});

    let result = roep_check_aan(&mut stdin, &mut reader, 12, invoer).await;
    let melding = foutmelding(&result);
    assert_eq!(
        result["isError"], true,
        "'lateral_bracing: {{}}' moet een fout geven, kreeg: {result}"
    );
    assert!(
        melding.contains("top_flange_positions"),
        "de melding moet zeggen welk veld ontbreekt, kreeg: {melding}"
    );

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn onbekend_veld_in_lateral_bracing_wordt_geweigerd() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    let mut invoer = geldige_invoer();
    // Enkelvoud in plaats van meervoud: zonder deny_unknown_fields zou dit
    // "missing field top_flange_positions" heten en niet de tikfout noemen.
    invoer["lateral_bracing"] = json!({
        "top_flange_position": [0.5],
        "bottom_flange_positions": []
    });

    let result = roep_check_aan(&mut stdin, &mut reader, 13, invoer).await;
    let melding = foutmelding(&result);
    assert_eq!(result["isError"], true, "kreeg: {result}");
    assert!(
        melding.contains("top_flange_position"),
        "de melding moet het onbekende veld noemen, kreeg: {melding}"
    );

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── 3. De betontools ────────────────────────────────────────────────────────
//
// `ConcreteBeamCheckInput`, `MnKappaRequest`, `ReinforcementCage` en `RebarRow`
// staan alle vier op `#[serde(deny_unknown_fields)]`. Het schema moet dat
// spiegelen én alle velden noemen: laat een schema een veld met
// `#[serde(default)]` weg, dan wordt het door `additionalProperties: false`
// zelfs geweigerd en kan een client het niet meer opgeven.

/// De referentiedoorsnede: 300 × 500, C30/37, B500B, dekking 30, beugel Ø8,
/// onder 3Ø16, boven 2Ø12 — dezelfde als in `concrete-check/tests/`.
fn geldige_betoninvoer() -> Value {
    json!({
        "beam_id": 7,
        "section": { "b_mm": 300, "h_mm": 500 },
        "concrete_class": "C30/37",
        "reinforcement_grade": "B500B",
        "cage": {
            "cover_mm": 30,
            "stirrup_diameter_mm": 8,
            "top": { "count": 2, "diameter_mm": 12 },
            "bottom": { "count": 3, "diameter_mm": 16 }
        },
        "length_m": 5,
        "forces_envelope": [
            { "combination_id": 1, "position_mm": 2500,
              "forces": { "n_ed": 0, "vy_ed": 0, "vz_ed": 0,
                          "mt_ed": 0, "my_ed": 100, "mz_ed": 0 } }
        ]
    })
}

#[tokio::test]
async fn schema_van_check_concrete_beam_is_volledig_en_strikt() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    let tool = tooldefinitie(&mut stdin, &mut reader, 20, "check_concrete_beam").await;
    let schema = &tool["inputSchema"];
    let props = &schema["properties"];

    assert_eq!(
        schema["additionalProperties"], false,
        "check_concrete_beam moet additionalProperties: false hebben"
    );

    // Elk veld van ConcreteBeamCheckInput, ook de tien met #[serde(default)].
    // De vijf voor `reinforcement_zones` horen bij de toetsen buiten 6.1
    // (dwarskracht, scheurbeheersing, slankheid, detaillering): ze zijn
    // optioneel, maar een client die ze niet in het schema ziet staan, stuurt
    // ze nooit mee - en dan blijft de halve toetsing ongedaan zonder dat
    // iemand het merkt. Voor `reinforcement_zones` geldt hetzelfde met een
    // ander gevolg: die client wordt stilzwijgend met EEN korf over de hele
    // staaf doorgerekend terwijl hij de wapening per zone heeft opgegeven.
    for veld in [
        "beam_id",
        "section",
        "concrete_class",
        "reinforcement_grade",
        "cage",
        "length_m",
        "forces_envelope",
        "n_strips",
        "steel_branch",
        "design_situation",
        "apply_min_eccentricity",
        "sls_frequent_envelope",
        "exposure_class",
        "structural_class",
        "aggregate_size_mm",
        "structural_system",
        "bar_spacing_mm",
        "reinforcement_zones",
        // §5.8. `column` draagt het ontwerpbesluit geschoord/ongeschoord en de
        // kniklengte; ontbreekt het in het schema, dan stuurt een client het
        // nooit mee en blijft de slankheidsgrens ongetoetst bij een staaf die
        // wél normaaldruk draagt — precies de toets die zegt of er nog een
        // tweede-orde-berekening moet volgen. `sls_quasi_permanent_envelope`
        // is de DERDE omhullende, alleen voor M₀Eqp in (5.19); zonder haar
        // blijft φ_ef onbekend en valt λ_lim terug op A = 0,7.
        "sls_quasi_permanent_envelope",
        "column",
        // De eerste-orde-momenten voor §5.8 na een tweede-orde-berekening
        // (r_m, M₀Ed van (5.19)); zonder dit veld weigert
        // `additionalProperties: false` het en rekent een client na een
        // P-Δ-berekening r_m en φ_ef met tweede-orde-momenten.
        "first_order_envelope",
        // Noemt bij een staande staaf de zijden in wereldtermen; zonder dit
        // veld in het schema weigert `additionalProperties: false` het.
        "staafstand",
        // De waarschuwing bij een naar links hellende staaf dicht bij 75°, waar
        // de bovenwapening van het bovenvlak naar het ondervlak springt.
        "staafstand_notities",
        // De nationale bijlage waarmee getoetst wordt (normnaad, september
        // 2026): zij bepaalt gamma_C, gamma_S, alpha_cc en de dekkingseisen.
        "bijlage",
    ] {
        assert!(
            props[veld].is_object(),
            "veld '{veld}' ontbreekt in het schema van check_concrete_beam"
        );
    }
    // `detail` (#229) is GEEN veld van ConcreteBeamCheckInput: de tool leest
    // het zelf en haalt het eruit vóór de strikte invoer gelezen wordt. Het
    // staat daarom wel in het schema, met alleen deze twee waarden.
    assert_eq!(props["detail"]["enum"], json!(["volledig", "samenvatting"]));
    assert_eq!(
        props.as_object().unwrap().len(),
        24 + 1,
        "het schema kent een veld dat ConcreteBeamCheckInput weigert"
    );

    // HET KOLOMBLOK. `bracing` en `buckling_length` zijn er VERPLICHT zodra het
    // blok bestaat: §5.8.1 noemt geschoord uitdrukkelijk een aanname in de
    // berekening, en een standaardwaarde zou dat besluit stilzwijgend nemen.
    // De twee §9.5-keuzen zijn juist optioneel — hun toets komt dan als
    // NotApplicable terug in plaats van dat de ruimste tak wordt aangenomen.
    let kolom = &props["column"];
    assert_eq!(kolom["additionalProperties"], false);
    assert_eq!(kolom["required"], json!(["bracing", "buckling_length"]));
    assert_eq!(
        kolom["properties"]["bracing"]["enum"],
        json!(["Geschoord", "Ongeschoord"])
    );
    // De twee wegen naar l₀, en niet meer dan twee: de gevallen f) en g) van
    // figuur 5.7 vragen k = (θ/M)·(EI/l) en staan er bewust niet in.
    let l0 = &kolom["properties"]["buckling_length"]["oneOf"];
    assert_eq!(l0.as_array().unwrap().len(), 2);
    assert_eq!(l0[0]["properties"]["soort"]["const"], "Figuur57");
    assert_eq!(
        l0[0]["properties"]["geval"]["enum"],
        json!([
            "ScharnierendScharnierend",
            "Console",
            "IngeklemdScharnierend",
            "TweezijdigIngeklemdGeschoord",
            "TweezijdigIngeklemdOngeschoord"
        ]),
        "alleen de vijf vakjes van figuur 5.7 met een VASTE l₀; f) en g) geven een bereik"
    );
    assert_eq!(l0[1]["properties"]["soort"]["const"], "Opgegeven");

    // DE TWEEDE AS (§5.8.9). Drie optionele velden die er MOETEN staan: met
    // `additionalProperties: false` zou een cliënt die de schoring om z wél
    // opgeeft, stilzwijgend met die van het rekenvlak worden doorgerekend.
    for veld in ["bracing_z", "buckling_length_z", "m0_edz_knm"] {
        assert!(
            kolom["properties"][veld].is_object(),
            "veld '{veld}' ontbreekt in het schema van `column`"
        );
    }
    assert_eq!(
        kolom["properties"]["bracing_z"]["enum"],
        json!(["Geschoord", "Ongeschoord"])
    );
    let l0z = &kolom["properties"]["buckling_length_z"]["oneOf"];
    assert_eq!(
        l0z.as_array().unwrap().len(),
        2,
        "om z dezelfde twee wegen naar l₀"
    );
    assert_eq!(
        l0z[0]["properties"]["geval"]["enum"], l0[0]["properties"]["geval"]["enum"],
        "beide assen kennen dezelfde vakjes van figuur 5.7"
    );
    assert!(
        !kolom["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str().unwrap().ends_with("_z")),
        "de velden om z zijn optioneel: leeg = de keuze van het rekenvlak, met melding"
    );

    // DE WAPENINGSZONES. Twee gescheiden lijsten, allebei optioneel en allebei
    // strikt: een tikfout in een zoneveld mag niet stil op een standaard
    // terugvallen. Zonder deze regels zou een schema dat het veld wel noemt
    // maar de lijsten niet, elke zone alsnog wegfilteren.
    let zones = &props["reinforcement_zones"];
    assert_eq!(zones["additionalProperties"], false);
    assert!(
        zones["required"].is_null(),
        "beide zonelijsten horen optioneel te zijn: leeg = de korf geldt over de hele staaf"
    );
    let langs = &zones["properties"]["longitudinal"]["items"];
    assert_eq!(langs["additionalProperties"], false);
    assert_eq!(
        langs["required"],
        json!(["side", "row", "x_start_mm", "x_end_mm"]),
        "zijde, rij en de twee maten zijn de dragende gegevens van een langswapeningszone"
    );
    assert_eq!(
        langs["properties"]["side"]["enum"],
        json!(["Bottom", "Top"])
    );
    // De twee UITVOERINGSgegevens van 8.4 die niemand kan afleiden.
    assert_eq!(
        langs["properties"]["bar_shape"]["enum"],
        json!(["Recht", "AndersDanRecht"])
    );
    assert_eq!(
        langs["properties"]["casting_position"]["enum"],
        json!([
            "Onderzijde",
            "Bovenzijde",
            "Glijbekisting",
            "GoedAangetoond"
        ])
    );
    let beugel = &zones["properties"]["stirrups"]["items"];
    assert_eq!(beugel["additionalProperties"], false);
    assert_eq!(
        beugel["required"],
        json!([
            "x_start_mm",
            "x_end_mm",
            "spacing_mm",
            "legs",
            "diameter_mm"
        ]),
        "in een beugelzone zijn alle vijf de gegevens verplicht - anders zou de \
         dwarskrachttoets op dat stuk stilzwijgend uitvallen"
    );

    // De frequente BGT-combinatie is een ANDERE combinatie dan de
    // UGT-omhullende, en het schema hoort dat te zeggen: een client die de
    // twee verwisselt krijgt een geloofwaardige maar verkeerde scheurwijdte.
    let bgt = props["sls_frequent_envelope"]["description"]
        .as_str()
        .expect("sls_frequent_envelope heeft een beschrijving");
    assert!(
        bgt.contains("6.15"),
        "de beschrijving noemt uitdrukking (6.15) niet: {bgt}"
    );
    assert!(
        bgt.contains("NIET de UGT"),
        "de beschrijving waarschuwt niet voor de verwisseling met de UGT-omhullende"
    );

    // De doorsnede: een vorm met benoemde maten, en ook zij weigert onbekende
    // velden. `b_w_mm` en `h_f_mm` zijn niet in het schema verplicht — dat kan
    // een JSON-schema niet per vorm — maar ze moeten er wél in staan, anders
    // filtert `additionalProperties: false` een T weg voordat de kern hem ziet.
    let sec = &props["section"];
    assert_eq!(sec["additionalProperties"], false);
    assert_eq!(sec["required"], json!(["b_mm", "h_mm"]));
    assert_eq!(
        sec["properties"]["shape"]["enum"],
        json!(["Rectangle", "Tee", "Ell"])
    );
    for veld in [
        "shape",
        "b_mm",
        "h_mm",
        "b_w_mm",
        "h_f_mm",
        "flange_at_bottom",
    ] {
        assert!(
            sec["properties"][veld].is_object(),
            "veld '{veld}' ontbreekt in het doorsnedeschema"
        );
    }
    assert_eq!(sec["properties"].as_object().unwrap().len(), 6);

    // De enums die de kern werkelijk kent (serde schrijft de varianten uit).
    assert_eq!(
        props["steel_branch"]["enum"],
        json!(["Horizontal", "Inclined"])
    );
    assert_eq!(
        props["design_situation"]["enum"],
        json!(["PersistentTransient", "Accidental"])
    );

    // De korf: geen standaardwaarden, dus de vier dragende velden verplicht.
    let cage = &props["cage"];
    assert_eq!(cage["additionalProperties"], false);
    assert_eq!(
        cage["required"],
        json!(["cover_mm", "stirrup_diameter_mm", "top", "bottom"])
    );
    for zijde in ["top", "bottom"] {
        let rij = &cage["properties"][zijde];
        assert_eq!(rij["additionalProperties"], false);
        assert_eq!(rij["required"], json!(["count", "diameter_mm"]));
    }
    // De beugelvelden staan er wél in, maar niet als verplicht: ze dragen
    // §6.2.3 en §9.2.2 en zouden door `additionalProperties: false` worden
    // weggefilterd als het schema ze niet noemde.
    for veld in [
        "stirrup_spacing_mm",
        "stirrup_legs",
        "stirrup_leg_spacing_mm",
        "stirrup_fywk_mpa",
    ] {
        assert!(
            cage["properties"][veld].is_object(),
            "veld '{veld}' ontbreekt in het korfschema"
        );
    }
    // De DEKKING PER ZIJDE (4.4.1.1(1)P) om dezelfde reden: optioneel, maar
    // wél in het schema. Zou hij ontbreken, dan filtert
    // `additionalProperties: false` de zijden weg en rekent de client
    // stilzwijgend met één dekking rondom — precies de fout waarvoor deze
    // velden zijn gemaakt.
    for veld in ["cover_top", "cover_bottom", "cover_sides"] {
        let zijde = &cage["properties"][veld];
        assert!(
            zijde.is_object(),
            "veld '{veld}' ontbreekt in het korfschema"
        );
        assert_eq!(zijde["additionalProperties"], false, "{veld}");
        // `null` moet toegestaan blijven: zo zegt een client "deze zijde volgt
        // het element".
        assert_eq!(zijde["type"], json!(["object", "null"]), "{veld}");
        assert!(zijde["properties"]["cover_mm"].is_object(), "{veld}");
        assert!(zijde["properties"]["exposure_class"].is_object(), "{veld}");
        assert_eq!(zijde["properties"].as_object().unwrap().len(), 2, "{veld}");
        // Niets van een zijde is verplicht: alleen de dekking, alleen de
        // klasse of geen van beide zijn alle drie geldige opgaven.
        assert!(zijde.get("required").is_none(), "{veld}");
    }
    // De ZIJSTAVEN van een kolomkorf, om dezelfde reden: zonder dit veld
    // filtert `additionalProperties: false` ze weg en rekent de client met een
    // kolom die de helft van zijn wapening mist. Dat is geen veilige kant —
    // A_s,max van §9.5.2(3) wordt daarmee te ruim.
    let zijstaven = &cage["properties"]["sides"];
    assert!(
        zijstaven.is_object(),
        "veld 'sides' ontbreekt in het korfschema"
    );
    assert_eq!(zijstaven["additionalProperties"], false);
    assert_eq!(zijstaven["type"], json!(["object", "null"]));
    assert_eq!(zijstaven["required"], json!(["count", "diameter_mm"]));
    assert_eq!(cage["properties"].as_object().unwrap().len(), 12);

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn schema_van_concrete_mn_kappa_is_volledig_en_strikt() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    let tool = tooldefinitie(&mut stdin, &mut reader, 21, "concrete_mn_kappa").await;
    let schema = &tool["inputSchema"];
    let props = &schema["properties"];

    assert_eq!(schema["additionalProperties"], false);
    for veld in [
        "bijlage",
        "section",
        "concrete_class",
        "reinforcement_grade",
        "cage",
        "n_ed_kn",
        "moment_sign",
        "n_strips",
        "steel_branch",
        "design_situation",
        "interaction_points",
    ] {
        assert!(
            props[veld].is_object(),
            "veld '{veld}' ontbreekt in het schema van concrete_mn_kappa"
        );
    }
    assert_eq!(
        props.as_object().unwrap().len(),
        11,
        "het schema kent een veld dat MnKappaRequest weigert"
    );

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn geldige_betoninvoer_wordt_gewoon_getoetst() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    let result = roep_tool_aan(
        &mut stdin,
        &mut reader,
        22,
        "check_concrete_beam",
        geldige_betoninvoer(),
    )
    .await;
    assert_eq!(
        result["isError"],
        false,
        "geldige invoer moet gewoon rekenen, kreeg: {}",
        foutmelding(&result)
    );
    let checks = result["structuredContent"]["checks"]
        .as_array()
        .expect("resultaat moet een 'checks'-array bevatten");
    assert!(!checks.is_empty(), "er is geen enkele toets uitgevoerd");

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn tikfout_in_een_betonveld_wordt_geweigerd() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    // n_stripes in plaats van n_strips: zonder deny_unknown_fields zou de
    // toetsing doorlopen met 50 stroken terwijl de aanroeper er 200 vroeg.
    let mut invoer = geldige_betoninvoer();
    invoer
        .as_object_mut()
        .unwrap()
        .insert("n_stripes".into(), json!(200));

    let result = roep_tool_aan(&mut stdin, &mut reader, 23, "check_concrete_beam", invoer).await;
    let melding = foutmelding(&result);
    assert_eq!(result["isError"], true, "kreeg een resultaat: {result}");
    assert!(
        melding.contains("n_stripes") && melding.contains("unknown field"),
        "de melding moet het onbekende veld noemen, kreeg: {melding}"
    );

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Een korf zonder dekking is geen korf met dekking 0: `ReinforcementCage`
/// kent geen standaardwaarden, dus dit hoort een fout te zijn en geen
/// stilzwijgend gunstiger geplaatste wapening.
#[tokio::test]
async fn onvolledige_wapeningskorf_wordt_geweigerd() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    let mut invoer = geldige_betoninvoer();
    invoer["cage"].as_object_mut().unwrap().remove("cover_mm");

    let result = roep_tool_aan(&mut stdin, &mut reader, 24, "check_concrete_beam", invoer).await;
    let melding = foutmelding(&result);
    assert_eq!(result["isError"], true, "kreeg een resultaat: {result}");
    assert!(
        melding.contains("cover_mm"),
        "de melding moet zeggen welk veld ontbreekt, kreeg: {melding}"
    );

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Een onbekende sterkteklasse in `concrete_mn_kappa` levert een toolfout met
/// de reden, en geen leeg diagram — leeg zou als "geen capaciteit" lezen.
#[tokio::test]
async fn onbekende_sterkteklasse_geeft_een_leesbare_fout() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    let result = roep_tool_aan(
        &mut stdin,
        &mut reader,
        25,
        "concrete_mn_kappa",
        json!({
            "section": { "b_mm": 300, "h_mm": 500 },
            "concrete_class": "C24", "reinforcement_grade": "B500B",
            "cage": geldige_betoninvoer()["cage"]
        }),
    )
    .await;
    let melding = foutmelding(&result);
    assert_eq!(result["isError"], true, "kreeg een resultaat: {result}");
    assert!(
        melding.contains("C24"),
        "de melding moet de afgewezen klasse noemen, kreeg: {melding}"
    );

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── 4. De houttools ─────────────────────────────────────────────────────────
//
// `TimberBeamCheckInput`, `CltBeamCheckInput`, `CltLayup` en `CltLayer` staan
// sinds september 2026 op `#[serde(deny_unknown_fields)]`. Daarvóór werd een
// tikfout in een optioneel veld stil genegeerd — gemeten: `kcr` in plaats van
// `k_cr` gaf dwarskracht-UC 1,066 in plaats van 1,591, en
// `deflection_quasi_perm_m` liet de kruipterm van §7.2 wegvallen.

/// Een houten staaf 96 × 450 C24 met het krachtsverloop uit de audit — geen
/// verzonnen getallen, en er wordt hier ook geen unity check vastgelegd.
fn geldige_houtinvoer() -> Value {
    let punt = |x: f64, n: f64, vz: f64, my: f64| {
        json!({ "combination_id": 12, "position_mm": x,
                "forces": { "n_ed": n, "vy_ed": 0.0, "vz_ed": vz, "mt_ed": 0.0, "my_ed": my, "mz_ed": 0.0 } })
    };
    json!({
        "beam_id": 2, "width_mm": 96.0, "height_mm": 450.0, "strength_class": "C24",
        "service_class": "Sc1", "load_duration": "MediumTerm", "length_m": 6.342,
        "forces_envelope": [punt(0.0, -57.64, 75.568, -67.176), punt(3688.0, -57.64, 0.0, 72.170)],
        "buckling_length_y_m": 6.342, "buckling_length_z_m": 1.268,
        "deflection_inst_mm": -20.0
    })
}

fn geldige_cltinvoer() -> Value {
    json!({
        "beam_id": 7,
        "layup": { "width_mm": 1000.0, "layers": [
            { "thickness_mm": 40, "orientation": "Longitudinal", "strength_class": "C24" },
            { "thickness_mm": 20, "orientation": "Transverse",   "strength_class": "C24" },
            { "thickness_mm": 40, "orientation": "Longitudinal", "strength_class": "C24" }
        ] },
        "service_class": "Sc1", "load_duration": "MediumTerm", "length_m": 5.0,
        "forces_envelope": [
            { "combination_id": 12, "position_mm": 0.0,
              "forces": { "n_ed": 0.0, "vy_ed": 0.0, "vz_ed": 10.0, "mt_ed": 0.0, "my_ed": 0.0, "mz_ed": 0.0 } },
            { "combination_id": 12, "position_mm": 2500.0,
              "forces": { "n_ed": 0.0, "vy_ed": 0.0, "vz_ed": 0.0, "mt_ed": 0.0, "my_ed": 20.0, "mz_ed": 0.0 } }
        ]
    })
}

#[tokio::test]
async fn schema_van_de_houttools_is_strikt_op_elk_niveau() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    let hout = tooldefinitie(&mut stdin, &mut reader, 30, "check_timber_beams").await;
    let staaf = &hout["inputSchema"]["properties"]["inputs"]["items"];
    assert_eq!(
        staaf["additionalProperties"], false,
        "check_timber_beams moet een onbekend staafveld weigeren, net als de kern"
    );
    // Met `additionalProperties: false` is een veld dat het schema niet noemt
    // voor een client niet meer op te geven — `custom_section` ontbrak.
    assert!(
        staaf["properties"]["custom_section"].is_object(),
        "custom_section ontbreekt"
    );
    // De nationale bijlage hoort erbij (normnaad, september 2026): zij bepaalt
    // gamma_M, k_cr en de doorbuigingsnoemers van deze toetsing.
    assert!(
        staaf["properties"]["bijlage"].is_object(),
        "bijlage ontbreekt"
    );
    assert_eq!(
        staaf["properties"].as_object().unwrap().len(),
        39,
        "het schema van de houten staaf hoort precies deze 39 velden van TimberBeamCheckInput te kennen
         (25 + load_duration_per_combination + staaf_notities + width_end_mm + height_end_mm + bijlage
         + deflection_quasi_perm_fin_mm + is_cantilever + zijdelingse_knik_in_analyse + schuine_rand
         + ruimtelijk + deflection_not_applicable_reason + deflection_add_mm + pre_camber_mm + staafeinden);
         de spiegeltest in timber_tools.rs leest de velden uit het type zelf (issue #210)"
    );
    // Issue #206: zonder deze twee kon een client een staaf niet als deel van
    // een 3D-raamwerk toetsen.
    assert!(staaf["properties"]["ruimtelijk"].is_object(), "ruimtelijk ontbreekt");
    assert!(
        staaf["properties"]["deflection_not_applicable_reason"].is_object(),
        "deflection_not_applicable_reason ontbreekt"
    );
    // Issue #205: de staafeinden, met het doorlopende eind.
    assert_eq!(
        staaf["properties"]["staafeinden"]["properties"]["eind"]["enum"],
        json!(["Gaffel", "Vrij", "Doorlopend"])
    );
    // Issue #253: de schuine rand voor 6.4.2 is voor een client op te geven.
    assert_eq!(staaf["properties"]["schuine_rand"]["enum"], json!(["Boven", "Onder", "Beide"]));
    // Issue #200: w₃ per BGT-combinatie is voor een client op te geven.
    assert!(staaf["properties"]["deflection_add_mm"].is_object(), "deflection_add_mm ontbreekt");
    // Issue #23: de langeduurzakking van 2.2.3(4) is voor een client op te geven.
    assert!(
        staaf["properties"]["deflection_quasi_perm_fin_mm"].is_object(),
        "deflection_quasi_perm_fin_mm ontbreekt"
    );

    let clt = tooldefinitie(&mut stdin, &mut reader, 31, "check_clt_beams").await;
    let cstaaf = &clt["inputSchema"]["properties"]["inputs"]["items"];
    // Issue #210: w₃ per BGT-combinatie is ook voor CLT op te geven.
    assert!(cstaaf["properties"]["deflection_add_mm"].is_object(), "CLT: deflection_add_mm ontbreekt");
    assert_eq!(cstaaf["additionalProperties"], false, "CLT-staaf");
    assert!(
        cstaaf["properties"]["deflection_quasi_perm_fin_mm"].is_object(),
        "CLT: deflection_quasi_perm_fin_mm ontbreekt"
    );
    assert_eq!(
        cstaaf["properties"]["layup"]["additionalProperties"], false,
        "opbouw"
    );
    assert_eq!(
        cstaaf["properties"]["layup"]["properties"]["layers"]["items"]["additionalProperties"],
        false,
        "laag"
    );

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn geldige_hout_en_cltinvoer_wordt_gewoon_getoetst() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    for (id, tool, invoer) in [
        (32, "check_timber_beams", geldige_houtinvoer()),
        (33, "check_clt_beams", geldige_cltinvoer()),
    ] {
        let result = roep_tool_aan(
            &mut stdin,
            &mut reader,
            id,
            tool,
            json!({ "inputs": [invoer] }),
        )
        .await;
        assert_eq!(
            result["isError"],
            false,
            "{tool}: geldige invoer moet gewoon rekenen, kreeg: {}",
            foutmelding(&result)
        );
        let checks = result["structuredContent"]["results"][0]["checks"]
            .as_array()
            .unwrap_or_else(|| panic!("{tool}: geen checks-array in {result}"));
        assert!(
            !checks.is_empty(),
            "{tool}: er is geen enkele toets uitgevoerd"
        );
    }

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Issue #206: `ruimtelijk` en `deflection_not_applicable_reason` zijn langs
/// de MCP-weg op te geven en doen wat het schema belooft: de staaf rekent als
/// deel van een 3D-raamwerk, en de doorbuiging wordt met de reden niet
/// getoetst terwijl de sterktetoetsen doorlopen.
#[tokio::test]
async fn ruimtelijk_en_bgt_reden_gaan_door_check_timber_beams() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    let mut invoer = geldige_houtinvoer();
    invoer["ruimtelijk"] = json!(true);
    invoer["deflection_not_applicable_reason"] = json!("quasi-blijvende BGT-combinatie ontbreekt (testreden)");
    let result =
        roep_tool_aan(&mut stdin, &mut reader, 60, "check_timber_beams", json!({ "inputs": [invoer] })).await;
    assert_eq!(result["isError"], false, "geldige invoer moet rekenen, kreeg: {}", foutmelding(&result));
    let checks = result["structuredContent"]["results"][0]["checks"].as_array().expect("checks");
    let toets = |id: &str| checks.iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("{id} ontbreekt"));
    for id in ["deflection_w_fin", "deflection_w_add"] {
        let data = &toets(id)["kind"]["data"];
        assert_eq!(data["status"], "NotApplicable", "{id}");
        assert!(data["uc"].is_null(), "{id}: geen UC zonder toets");
        assert!(
            data["notes"].as_array().unwrap().iter().any(|n| n.as_str().unwrap().contains("testreden")),
            "{id}: de reden staat in de notities"
        );
    }
    assert!(toets("6.1.6_bending")["kind"]["data"]["uc"].is_object(), "de sterktetoets loopt door");
    // Ruimtelijk: knik om z is uitbuigen in het rekenvlak van een 3D-berekening.
    let kolom = serde_json::to_string(&toets("6.3.2_column_stability")["kind"]["data"]).unwrap();
    assert!(!kolom.contains("UIT het vlak van het model"), "ruimtelijk telt: {kolom}");

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn tikfout_in_een_houtveld_wordt_geweigerd_in_plaats_van_stil_genegeerd() {
    let (mut child, mut stdin, mut reader) = start_server().await;

    // Drie tikfouten uit de audit, elk in een veld met een standaardwaarde.
    for (i, tikfout, waarde) in [
        (0u32, "kcr", json!(0.67)),
        (1, "deflection_quasi_perm_m", json!(-15.0)),
        (2, "perform_ltb_chek", json!(false)),
    ] {
        let mut invoer = geldige_houtinvoer();
        invoer
            .as_object_mut()
            .unwrap()
            .insert(tikfout.into(), waarde);
        let result = roep_tool_aan(
            &mut stdin,
            &mut reader,
            40 + i,
            "check_timber_beams",
            json!({ "inputs": [invoer] }),
        )
        .await;
        let melding = foutmelding(&result);
        assert_eq!(
            result["isError"], true,
            "`{tikfout}` gaf een resultaat: {result}"
        );
        assert!(
            melding.contains(tikfout) && melding.contains("unknown field"),
            "de melding moet het onbekende veld `{tikfout}` noemen, kreeg: {melding}"
        );
    }

    // CLT: op de staaf én diep in de opbouw.
    let mut op_staaf = geldige_cltinvoer();
    op_staaf
        .as_object_mut()
        .unwrap()
        .insert("kcr".into(), json!(0.67));
    let mut in_laag = geldige_cltinvoer();
    in_laag["layup"]["layers"][0]
        .as_object_mut()
        .unwrap()
        .insert("orientatie".into(), json!("Longitudinal"));
    for (i, (wat, invoer, veld)) in [("staaf", op_staaf, "kcr"), ("laag", in_laag, "orientatie")]
        .into_iter()
        .enumerate()
    {
        let result = roep_tool_aan(
            &mut stdin,
            &mut reader,
            50 + i as u32,
            "check_clt_beams",
            json!({ "inputs": [invoer] }),
        )
        .await;
        let melding = foutmelding(&result);
        assert_eq!(
            result["isError"], true,
            "CLT {wat}: kreeg een resultaat: {result}"
        );
        assert!(
            melding.contains(veld),
            "CLT {wat}: de melding moet `{veld}` noemen: {melding}"
        );
    }

    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Het rapportschema noemt de nationale bijlage (normnaad, issue #17): de PDF
/// haalt de normaanduidingen uit haar rij, dus een client moet het veld kunnen
/// vinden — met dezelfde enum als elk ander gereedschap.
#[tokio::test]
async fn rapportschema_noemt_de_nationale_bijlage() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let rapport = tooldefinitie(&mut stdin, &mut reader, 41, "generate_steel_report_pdf").await;
    let veld = &rapport["inputSchema"]["properties"]["bijlage"];
    assert_eq!(
        veld["type"], "string",
        "bijlage ontbreekt in het schema van generate_steel_report_pdf"
    );
    assert_eq!(
        veld["enum"],
        serde_json::json!(nationale_bijlage::BIJLAGEN_GEVULD)
    );
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Het rapportschema noemt de windomschrijving (issue #16). Het schema staat
/// op `additionalProperties: true`, dus een client KAN het veld altijd
/// meesturen — maar een veld dat het schema niet noemt, vindt een client niet.
#[tokio::test]
async fn rapportschema_noemt_de_windomschrijving() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let rapport = tooldefinitie(&mut stdin, &mut reader, 40, "generate_steel_report_pdf").await;
    assert_eq!(
        rapport["inputSchema"]["properties"]["wind_toelichting"]["type"], "string",
        "wind_toelichting ontbreekt in het schema van generate_steel_report_pdf"
    );
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Het rapportschema noemt de herkomst van de toetskrachten (issue #199):
/// `toetskrachten` uit `check_fem_model`, streng (`additionalProperties:
/// false`, net als `report::ToetskrachtenRapport` met `deny_unknown_fields`).
#[tokio::test]
async fn rapportschema_noemt_de_toetskrachten() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let rapport = tooldefinitie(&mut stdin, &mut reader, 43, "generate_steel_report_pdf").await;
    let veld = &rapport["inputSchema"]["properties"]["toetskrachten"];
    assert_eq!(veld["type"], "object", "toetskrachten ontbreekt in het schema van generate_steel_report_pdf");
    assert_eq!(veld["additionalProperties"], json!(false));
    assert_eq!(veld["required"], json!(["noemer", "tweede_orde_combinaties"]));
    let check = tooldefinitie(&mut stdin, &mut reader, 44, "check_fem_model").await;
    assert!(
        check["description"].as_str().unwrap_or("").contains("`toetskrachten`"),
        "check_fem_model noemt het veld toetskrachten in zijn beschrijving"
    );
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Het rapportschema noemt de taal van de datum (issue #20), met precies de
/// vier codes die `report::RapportTaal` bij het lezen aanneemt.
#[tokio::test]
async fn rapportschema_noemt_de_taal_van_de_datum() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let rapport = tooldefinitie(&mut stdin, &mut reader, 42, "generate_steel_report_pdf").await;
    let veld = &rapport["inputSchema"]["properties"]["taal"];
    assert_eq!(
        veld["type"], "string",
        "taal ontbreekt in het schema van generate_steel_report_pdf"
    );
    let codes: Vec<&str> = report::RapportTaal::ALLE.iter().map(|t| t.code()).collect();
    assert_eq!(veld["enum"], serde_json::json!(codes));
    assert_eq!(veld["default"], report::RapportTaal::default().code());
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Het kenmerk `eigenGewicht` van een belastinggeval (issue #42) staat in het
/// STRIKTE schema van de belastinggevallen, in elke tool die een model
/// aanneemt: `additionalProperties: false` op het geval, en het veld zelf
/// alleen `true`. Zonder het veld in het schema zou een client het kenmerk
/// niet kunnen meesturen (strikt = geweigerd); met `false` toegestaan zou
/// "geen kenmerk" twee spellingen hebben, en stuurt een model met
/// `eigenGewicht: false` het eigen gewicht stil naar het eerste blijvende
/// geval. De rekenkant staat in `eigen_gewicht_geval_mcp.rs`.
#[tokio::test]
async fn schema_van_de_belastinggevallen_kent_het_kenmerk_eigen_gewicht_strikt() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    for (i, naam) in ["solve_fem_model", "check_fem_model", "validate_fem_model"]
        .iter()
        .enumerate()
    {
        let tool = tooldefinitie(&mut stdin, &mut reader, 60 + i as u32, naam).await;
        let geval = &tool["inputSchema"]["properties"]["model"]["properties"]["loadCases"]["items"];
        assert_eq!(
            geval["additionalProperties"],
            json!(false),
            "{naam}: het schema van een belastinggeval hoort strikt te zijn: {geval}"
        );
        let veld = &geval["properties"]["eigenGewicht"];
        assert_eq!(
            veld["type"],
            json!("boolean"),
            "{naam}: eigenGewicht ontbreekt: {geval}"
        );
        assert_eq!(
            veld["enum"],
            json!([true]),
            "{naam}: alleen true is toegestaan: {veld}"
        );
        let zelf_gewicht =
            &tool["inputSchema"]["properties"]["model"]["properties"]["selfWeightEnabled"];
        assert!(
            zelf_gewicht["description"]
                .as_str()
                .unwrap_or("")
                .contains("eigenGewicht"),
            "{naam}: selfWeightEnabled hoort naar het kenmerk te verwijzen: {zelf_gewicht}"
        );
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}
/// Belastingvlakken in het 3D-model van de app (`gui_build_3d_model`): het
/// schema zoals een client het via `tools/list` ziet, is strikt op elk niveau.
/// Zonder `additionalProperties: false` zou een tikfout als `distrbution` stil
/// wegvallen, en zonder vaste keuzelijsten zou een onbekende lastrichting pas
/// in de app opvallen. De app keurt hetzelfde nog eens in
/// `parseOpenFem3DModel`; de afdracht zelf bewaakt
/// design-mockup/test-open-fem3d-belastingvlak.mjs.
#[tokio::test]
async fn schema_van_de_belastingvlakken_in_het_3d_model_is_strikt() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 90, "gui_build_3d_model").await;
    let schema = &tool["inputSchema"];
    assert_eq!(schema["additionalProperties"], json!(false));
    let vlakken = &schema["properties"]["load_panels"];
    assert_eq!(vlakken["type"], json!("array"));
    let vlak = &vlakken["items"];
    assert_eq!(vlak["additionalProperties"], json!(false), "een belastingvlak hoort strikt te zijn: {vlak}");
    assert_eq!(vlak["required"], json!(["nodes", "q", "direction", "distribution"]));
    assert_eq!(vlak["properties"]["direction"]["enum"], json!(["gravity", "normal", "verticalSurface"]));
    assert_eq!(vlak["properties"]["distribution"]["enum"], json!(["oneWay", "twoWay"]));
    assert_eq!(vlak["properties"]["span_direction"]["additionalProperties"], json!(false));
    assert_eq!(vlak["properties"]["span_direction"]["required"], json!(["x", "y", "z"]));
    for veld in ["nodes", "case_id", "q", "direction", "distribution", "span_direction", "excluded_beams"] {
        assert!(vlak["properties"].get(veld).is_some(), "{veld} ontbreekt in het schema van een belastingvlak");
    }
    let beschrijving = vlakken["description"].as_str().unwrap_or("");
    for woord in ["HORIZONTAL PROJECTION", "per m² panel", "45-degree", "nearest beam"] {
        assert!(beschrijving.contains(woord), "de beschrijving hoort {woord:?} uit te leggen: {beschrijving}");
    }
    let weergave = tooldefinitie(&mut stdin, &mut reader, 91, "gui_configure_3d_view").await;
    assert_eq!(
        weergave["inputSchema"]["properties"]["visibility"]["properties"]["loadPanels"]["type"],
        json!("boolean"),
        "de zichtbaarheid van de belastingvlakken hoort schakelbaar te zijn"
    );
    assert_eq!(
        weergave["inputSchema"]["properties"]["visibility"]["properties"]["levelMarks"]["type"],
        json!("boolean"),
        "de peilmaten bij de levels horen los van het stramien schakelbaar te zijn (issue #92)"
    );
    // De grootte van knopen en opleggingen (issue #82): een getal in % van de
    // automatische maat, 25–400; het strikte schema laat geen andere sleutel door.
    let zicht = &weergave["inputSchema"]["properties"]["visibility"];
    assert_eq!(zicht["additionalProperties"], json!(false));
    for sleutel in ["nodeSizePercent", "supportSizePercent"] {
        assert_eq!(zicht["properties"][sleutel]["type"], json!("number"), "{sleutel} hoort een getal te zijn");
        assert_eq!(zicht["properties"][sleutel]["minimum"], json!(25), "{sleutel}: ondergrens 25 %");
        assert_eq!(zicht["properties"][sleutel]["maximum"], json!(400), "{sleutel}: bovengrens 400 %");
    }
    // De plaatweergave (issue #78): één keuze uit volume, surface en mesh; een
    // andere tekst laat het strikte schema niet door.
    assert_eq!(zicht["properties"]["plateDisplay"]["type"], json!("string"));
    assert_eq!(
        zicht["properties"]["plateDisplay"]["enum"],
        json!(["volume", "surface", "mesh"]),
        "de plaatweergave hoort een van drie standen te zijn (issue #78)"
    );
    // De section box (issue #86): strikt op elk niveau. Zonder
    // `additionalProperties: false` viel een tikfout als `max` (in plaats van
    // `max_m`) stil weg en kreeg de doos de modelgrenzen.
    let doos = &weergave["inputSchema"]["properties"]["section_box"];
    assert_eq!(doos["additionalProperties"], json!(false), "{doos}");
    assert_eq!(doos["required"], json!(["enabled"]), "aan/uit is verplicht");
    assert_eq!(doos["properties"]["enabled"]["type"], json!("boolean"));
    assert_eq!(doos["properties"]["fit"]["enum"], json!(["model", "selection"]));
    let punt = &weergave["inputSchema"]["$defs"]["pointM"];
    assert_eq!(punt["additionalProperties"], json!(false), "{punt}");
    assert_eq!(punt["required"], json!(["x", "y", "z"]));
    for grens in ["min_m", "max_m"] {
        assert_eq!(doos["properties"][grens]["$ref"], json!("#/$defs/pointM"), "{grens}");
    }
    // De explode (issue #198): strikt. Een tikfout als `amount` (in plaats van
    // `amount_mm`) of een andere modus mag niet stil een standaardwaarde geven.
    let explode = &weergave["inputSchema"]["properties"]["explode"];
    assert_eq!(explode["additionalProperties"], json!(false), "{explode}");
    assert_eq!(explode["properties"]["mode"]["enum"], json!(["levels", "elementTypes"]));
    assert_eq!(explode["properties"]["amount_mm"]["type"], json!("number"));
    assert_eq!(explode["properties"]["amount_mm"]["minimum"], json!(0));
    assert_eq!(explode["properties"]["amount_mm"]["maximum"], json!(10000));
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Staaf op bedding (issue #106) over de echte binary: het schema van
/// `solve_open_fem_3d` (members[].bedding) en van `gui_build_3d_model`
/// (beams[].bedding) is strikt, `gui_configure_3d_view` kent de laag
/// Gronddruk, een tikfout in een beddingveld wordt geweigerd, en een vrije
/// balk van 6 m onder een gelijkmatige last q = 30 kN/m op k·b = 50 000 ·
/// 0,6 = 30 000 kN/m² zakt overal q/(k·b) = 1 mm, met Σ veerkrachten = q·L.
#[tokio::test]
async fn staaf_op_bedding_via_mcp_is_strikt_en_rekent() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 120, "solve_open_fem_3d").await;
    let bedding = &tool["inputSchema"]["properties"]["members"]["items"]["properties"]["bedding"];
    assert_eq!(bedding["additionalProperties"], json!(false), "{bedding}");
    assert_eq!(bedding["required"], json!(["widthM"]));
    for veld in ["kKnPerM3", "widthM", "kLateralKnPerM3", "compressionOnly"] {
        assert!(bedding["properties"].get(veld).is_some(), "{veld} ontbreekt");
    }
    let bouw = tooldefinitie(&mut stdin, &mut reader, 121, "gui_build_3d_model").await;
    let app = &bouw["inputSchema"]["properties"]["beams"]["items"]["properties"]["bedding"];
    assert_eq!(app["additionalProperties"], json!(false), "{app}");
    assert_eq!(app["required"], json!(["width_m"]));
    let weergave = tooldefinitie(&mut stdin, &mut reader, 122, "gui_configure_3d_view").await;
    assert_eq!(weergave["inputSchema"]["properties"]["visibility"]["properties"]["groundPressure"]["type"], json!("boolean"));

    let verzoek = json!({
        "analysis": "linear",
        "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 6, "y": 0, "z": 0 }],
        "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
        "sections": [{ "id": 1, "name": "balk", "areaM2": 0.0149, "iyM4": 2.517e-4, "izM4": 8.56e-5, "torsionJM4": 1.85e-6 }],
        "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1,
            "bedding": { "kKnPerM3": 50000, "widthM": 0.6 } }],
        "supports": [{ "nodeId": 1, "ux": true, "uy": true, "uz": false, "rx": true, "ry": false, "rz": true }],
        "nodalLoads": [],
        "memberLoads": [{ "id": 1, "memberId": 1, "qyStartKnPerM": 0, "qyEndKnPerM": 0, "qzStartKnPerM": -30, "qzEndKnPerM": -30,
            "startPositionM": 0, "endPositionM": 6 }],
        "bucklingModes": 0
    });
    let uit = roep_tool_aan(&mut stdin, &mut reader, 123, "solve_open_fem_3d", verzoek.clone()).await;
    assert_eq!(uit["isError"], json!(false), "{uit}");
    let lid = &uit["structuredContent"]["bedding"][0];
    assert_eq!(lid["memberId"], json!(1), "{uit}");
    let punten = lid["points"].as_array().expect("punten");
    assert!(punten.len() >= 3);
    for punt in punten {
        let zakking = punt["settlementM"].as_f64().unwrap();
        assert!((zakking - 0.001).abs() <= 0.01 * 0.001, "zakking {zakking} op t = {}", punt["t"]);
    }
    let som = lid["totalReactionKn"].as_f64().unwrap();
    assert!((som - 180.0).abs() < 1e-6, "Σ veerkrachten {som}");
    // Een tikfout in een beddingveld: het contract weigert onbekende velden.
    let mut tikfout = verzoek;
    tikfout["members"][0]["bedding"] = json!({ "kKnPerm3": 50000, "widthM": 0.6 });
    schrijf(&mut stdin, json!({
        "jsonrpc": "2.0", "id": 124, "method": "tools/call",
        "params": { "name": "solve_open_fem_3d", "arguments": tikfout }
    })).await;
    let antwoord = lees_bericht(&mut reader).await;
    let melding = antwoord["error"]["message"].as_str().map(str::to_owned)
        .unwrap_or_else(|| foutmelding(&antwoord["result"]));
    assert!(melding.contains("kKnPerm3"), "{antwoord}");
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Lijnlast in een globale richting (issue #80) over de echte binary: het
/// schema van `solve_open_fem_3d` kent globalDirection, qStartKnPerM,
/// qEndKnPerM en perProjection strikt, een tikfout in een lastveld wordt
/// geweigerd, en een vrij opgelegde schuine spant (4 m horizontaal, 3 m
/// omhoog) onder sneeuw q = 2 kN/m per horizontale meter heeft ΣRz = q·4 m =
/// 8 kN; per staafmeter (zonder perProjection) q·5 m = 10 kN.
#[tokio::test]
async fn globale_lijnlast_via_mcp_is_strikt_en_rekent() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 130, "solve_open_fem_3d").await;
    let last = &tool["inputSchema"]["properties"]["memberLoads"]["items"];
    assert_eq!(last["additionalProperties"], json!(false), "{last}");
    assert_eq!(last["required"], json!(["id", "memberId"]));
    assert_eq!(last["properties"]["globalDirection"]["enum"], json!(["x", "y", "z"]));
    for veld in ["qStartKnPerM", "qEndKnPerM", "perProjection"] {
        assert!(last["properties"].get(veld).is_some(), "{veld} ontbreekt");
    }

    let verzoek = |per_projectie: bool| json!({
        "analysis": "linear",
        "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 4, "y": 0, "z": 3 }],
        "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
        "sections": [{ "id": 1, "name": "spant", "areaM2": 0.00538, "iyM4": 8.356e-5, "izM4": 6.04e-6, "torsionJM4": 2.01e-7 }],
        "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1 }],
        "supports": [
            { "nodeId": 1, "ux": true, "uy": true, "uz": true, "rx": true, "ry": false, "rz": true },
            { "nodeId": 2, "ux": false, "uy": true, "uz": true, "rx": false, "ry": false, "rz": false }
        ],
        "nodalLoads": [],
        "memberLoads": [{ "id": 1, "memberId": 1, "globalDirection": "z", "qStartKnPerM": -2, "qEndKnPerM": -2,
            "perProjection": per_projectie, "startPositionM": 0, "endPositionM": 5 }],
        "bucklingModes": 0
    });
    // Een tikfout in een lastveld: het contract weigert onbekende velden (ook een kern van vóór #80).
    let mut tikfout = verzoek(true);
    tikfout["memberLoads"][0] = json!({ "id": 1, "memberId": 1, "globalDirecton": "z", "qStartKnPerM": -2, "qEndKnPerM": -2 });
    schrijf(&mut stdin, json!({
        "jsonrpc": "2.0", "id": 131, "method": "tools/call",
        "params": { "name": "solve_open_fem_3d", "arguments": tikfout }
    })).await;
    let antwoord = lees_bericht(&mut reader).await;
    let melding = antwoord["error"]["message"].as_str().map(str::to_owned)
        .unwrap_or_else(|| foutmelding(&antwoord["result"]));
    assert!(melding.contains("globalDirecton"), "{antwoord}");

    for (id, per_projectie, verwacht) in [(132, true, 8.0), (133, false, 10.0)] {
        schrijf(&mut stdin, json!({
            "jsonrpc": "2.0", "id": id, "method": "tools/call",
            "params": { "name": "solve_open_fem_3d", "arguments": verzoek(per_projectie) }
        })).await;
        let antwoord = lees_bericht(&mut reader).await;
        let uit = &antwoord["result"];
        assert_eq!(uit["isError"], json!(false), "{antwoord}");
        let som: f64 = uit["structuredContent"]["reactions"].as_array().expect("reacties").iter()
            .map(|r| r["fz"].as_f64().unwrap()).sum();
        assert!((som - verwacht).abs() < 1e-6, "ΣRz {som}, verwacht {verwacht} (per projectie: {per_projectie})");
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Verlopende staaf (issue #73) over de echte binary: het schema van
/// `solve_open_fem_3d` kent `partSectionIds` (2 tot 64 doorsnede-id's), en een
/// uitkrager van 4 m in twee gelijke delen (I₁ = 2·10⁻⁴ m⁴ aan de inklemming,
/// I₂ = 5·10⁻⁵ m⁴ aan het vrije eind) onder P = 10 kN zakt aan het eind
///   w = P/E·[ (4³ − 2³)/3 / I₁ + 2³/3 / I₂ ] = 10/2,1·10⁸ · 146 666,7 = 6,984 mm
/// (alleen buiging, exact: het verzoek geeft geen afschuifoppervlak mee), met
/// het inklemmingsmoment P·L = 40 kNm op de ene staaf.
#[tokio::test]
async fn verlopende_staaf_via_mcp_is_strikt_en_rekent() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 140, "solve_open_fem_3d").await;
    let delen = &tool["inputSchema"]["properties"]["members"]["items"]["properties"]["partSectionIds"];
    assert_eq!(delen["type"], json!("array"), "{delen}");
    assert_eq!((delen["minItems"].clone(), delen["maxItems"].clone()), (json!(2), json!(64)));
    assert_eq!(delen["items"]["minimum"], json!(1));

    let verzoek = json!({
        "analysis": "linear",
        "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 4, "y": 0, "z": 0 }],
        "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
        "sections": [
            { "id": 1, "name": "begin", "areaM2": 0.01, "iyM4": 2e-4, "izM4": 2e-5, "torsionJM4": 1e-6 },
            { "id": 2, "name": "eind", "areaM2": 0.006, "iyM4": 5e-5, "izM4": 5e-6, "torsionJM4": 5e-7 }
        ],
        "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1, "partSectionIds": [1, 2] }],
        "supports": [{ "nodeId": 1, "ux": true, "uy": true, "uz": true, "rx": true, "ry": true, "rz": true }],
        "nodalLoads": [{ "id": 1, "nodeId": 2, "fx": 0, "fy": 0, "fz": -10, "mx": 0, "my": 0, "mz": 0 }],
        "bucklingModes": 0
    });
    schrijf(&mut stdin, json!({
        "jsonrpc": "2.0", "id": 141, "method": "tools/call",
        "params": { "name": "solve_open_fem_3d", "arguments": verzoek }
    })).await;
    let antwoord = lees_bericht(&mut reader).await;
    // De server linkt de kern als crate: hij kent partSectionIds altijd.
    assert!(antwoord["error"].is_null(), "{antwoord}");
    let uit = &antwoord["result"];
    assert_eq!(uit["isError"], json!(false), "{antwoord}");
    let verplaatsingen = uit["structuredContent"]["displacements"].as_array().unwrap();
    assert_eq!(verplaatsingen.len(), 2, "alleen de modelknopen, geen grensknoop van de delen: {verplaatsingen:?}");
    let eind = verplaatsingen.iter().find(|d| d["nodeId"] == json!(2)).unwrap()["uz"].as_f64().unwrap();
    let verwacht = 10.0 / 2.1e8 * ((64.0 - 8.0) / 3.0 / 2e-4 + 8.0 / 3.0 / 5e-5);
    assert!(((-eind) - verwacht).abs() <= 1e-12 * verwacht, "zakking {eind}, verwacht −{verwacht}");
    let krachten = uit["structuredContent"]["memberForces"].as_array().unwrap();
    assert_eq!(krachten.len(), 1, "de delen zijn weer één staaf: {krachten:?}");
    let moment = krachten[0]["myStartKnm"].as_f64().unwrap();
    assert!((moment.abs() - 40.0).abs() < 1e-12 * 40.0, "inklemmingsmoment {moment}");
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Trek-alleen en starre schijven over de echte binary: het schema van
/// `solve_open_fem_3d` is strikt, een tikfout in een schijfveld wordt
/// geweigerd en een kruisverband levert precies één inactieve diagonaal.
/// Portaal 6 × 4 m met scharnierende voeten en ligger, H = 12 kN: de
/// trekdiagonaal draagt H·d/L = 12·√52/6 = 14,4222 kN.
#[tokio::test]
async fn trek_alleen_en_schijven_via_mcp_zijn_strikt_en_rekenen() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 95, "solve_open_fem_3d").await;
    let schema = &tool["inputSchema"];
    assert_eq!(schema["properties"]["members"]["items"]["properties"]["tensionOnly"]["type"], json!("boolean"));
    assert_eq!(schema["properties"]["diaphragms"]["items"]["additionalProperties"], json!(false));
    assert_eq!(schema["properties"]["diaphragms"]["items"]["required"], json!(["id", "nodeIds"]));

    let scharnier = json!({ "myStart": true, "myEnd": true, "mzStart": true, "mzEnd": true });
    let voet = |id: u64| json!({ "nodeId": id, "ux": true, "uy": true, "uz": true, "rx": true, "ry": false, "rz": true });
    let verzoek = json!({
        "analysis": "linear",
        "nodes": [
            { "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 6, "y": 0, "z": 0 },
            { "id": 3, "x": 0, "y": 0, "z": 4 }, { "id": 4, "x": 6, "y": 0, "z": 4 }
        ],
        "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
        "sections": [
            { "id": 1, "name": "kolom", "areaM2": 0.01, "iyM4": 8e-5, "izM4": 8e-5, "torsionJM4": 5e-6 },
            { "id": 2, "name": "verband", "areaM2": 0.001, "iyM4": 1e-6, "izM4": 1e-6, "torsionJM4": 2e-6 }
        ],
        "members": [
            { "id": 1, "startNodeId": 1, "endNodeId": 3, "materialId": 1, "sectionId": 1 },
            { "id": 2, "startNodeId": 2, "endNodeId": 4, "materialId": 1, "sectionId": 1 },
            { "id": 3, "startNodeId": 3, "endNodeId": 4, "materialId": 1, "sectionId": 1, "releases": scharnier },
            { "id": 4, "startNodeId": 1, "endNodeId": 4, "materialId": 1, "sectionId": 2, "releases": scharnier, "tensionOnly": true },
            { "id": 5, "startNodeId": 2, "endNodeId": 3, "materialId": 1, "sectionId": 2, "releases": scharnier, "tensionOnly": true }
        ],
        "supports": [voet(1), voet(2)],
        "nodalLoads": [{ "id": 1, "nodeId": 3, "fx": 12, "fy": 0, "fz": 0, "mx": 0, "my": 0, "mz": 0 }],
        "bucklingModes": 0
    });
    let uit = roep_tool_aan(&mut stdin, &mut reader, 96, "solve_open_fem_3d", verzoek.clone()).await;
    assert_eq!(uit["isError"], json!(false), "{uit}");
    let resultaat = &uit["structuredContent"];
    assert_eq!(resultaat["inactiveMembers"], json!([5]), "{resultaat}");
    assert_eq!(resultaat["tensionOnlyRounds"], json!(2), "een statuswissel en een bevestiging");
    let n4 = resultaat["memberForces"].as_array().unwrap().iter()
        .find(|f| f["memberId"] == json!(4)).unwrap()["nStartKn"].as_f64().unwrap();
    assert!((n4 - 12.0 * 52f64.sqrt() / 6.0).abs() < 1e-9, "N diagonaal {n4}");

    // Een tikfout in een schijfveld: het contract weigert onbekende velden.
    let mut tikfout = verzoek;
    tikfout["diaphragms"] = json!([{ "id": 1, "nodeId": [3, 4] }]);
    schrijf(&mut stdin, json!({
        "jsonrpc": "2.0", "id": 97, "method": "tools/call",
        "params": { "name": "solve_open_fem_3d", "arguments": tikfout }
    })).await;
    let antwoord = lees_bericht(&mut reader).await;
    let melding = antwoord["error"]["message"].as_str().map(str::to_owned)
        .unwrap_or_else(|| foutmelding(&antwoord["result"]));
    assert!(melding.contains("nodeId"), "{antwoord}");
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Montagelasten en kruisregel via MCP: hetzelfde scharnierende portaal met
/// P = 100 kN op beide koppen (de permanente last, ook de montagelast) en
/// H = 12 kN. Zonder strips verkorten de kolommen P·h/(E·A) = 100·4/(2,1·10⁶)
/// m en gaat het frame niet opzij, dus beide strips passen op Δ0 = −s·P·h/(E·A)
/// met s = 4/√52: −0,105 662 mm. Onder G + H draagt G dan niets in de strips en
/// staat strip 5 op druk; strip 4 draagt H/cos θ = 14,4222 kN (het portaal met
/// één strip is statisch bepaald). De kruisregel is hier niet nodig.
#[tokio::test]
async fn montage_en_kruisregel_via_mcp_zijn_strikt_en_rekenen() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 98, "solve_open_fem_3d").await;
    let schema = &tool["inputSchema"];
    assert_eq!(schema["properties"]["tensionOnlyFit"]["additionalProperties"], json!(false));
    assert_eq!(schema["properties"]["tensionOnlyCrossRule"]["type"], json!("boolean"));

    let scharnier = json!({ "myStart": true, "myEnd": true, "mzStart": true, "mzEnd": true });
    let voet = |id: u64| json!({ "nodeId": id, "ux": true, "uy": true, "uz": true, "rx": true, "ry": false, "rz": true });
    let g = json!([
        { "id": 1, "nodeId": 3, "fx": 0, "fy": 0, "fz": -100, "mx": 0, "my": 0, "mz": 0 },
        { "id": 2, "nodeId": 4, "fx": 0, "fy": 0, "fz": -100, "mx": 0, "my": 0, "mz": 0 }
    ]);
    let mut lasten = g.as_array().unwrap().clone();
    lasten.push(json!({ "id": 3, "nodeId": 3, "fx": 12, "fy": 0, "fz": 0, "mx": 0, "my": 0, "mz": 0 }));
    let verzoek = json!({
        "analysis": "linear",
        "nodes": [
            { "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 6, "y": 0, "z": 0 },
            { "id": 3, "x": 0, "y": 0, "z": 4 }, { "id": 4, "x": 6, "y": 0, "z": 4 }
        ],
        "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
        "sections": [
            { "id": 1, "name": "kolom", "areaM2": 0.01, "iyM4": 8e-5, "izM4": 8e-5, "torsionJM4": 5e-6 },
            { "id": 2, "name": "verband", "areaM2": 0.001, "iyM4": 1e-6, "izM4": 1e-6, "torsionJM4": 2e-6 }
        ],
        "members": [
            { "id": 1, "startNodeId": 1, "endNodeId": 3, "materialId": 1, "sectionId": 1 },
            { "id": 2, "startNodeId": 2, "endNodeId": 4, "materialId": 1, "sectionId": 1 },
            { "id": 3, "startNodeId": 3, "endNodeId": 4, "materialId": 1, "sectionId": 1, "releases": scharnier },
            { "id": 4, "startNodeId": 1, "endNodeId": 4, "materialId": 1, "sectionId": 2, "releases": scharnier, "tensionOnly": true },
            { "id": 5, "startNodeId": 2, "endNodeId": 3, "materialId": 1, "sectionId": 2, "releases": scharnier, "tensionOnly": true }
        ],
        "supports": [voet(1), voet(2)],
        "nodalLoads": lasten,
        "tensionOnlyFit": { "nodalLoads": g },
        "tensionOnlyCrossRule": true,
        "bucklingModes": 0
    });
    let uit = roep_tool_aan(&mut stdin, &mut reader, 99, "solve_open_fem_3d", verzoek.clone()).await;
    assert_eq!(uit["isError"], json!(false), "{uit}");
    let resultaat = &uit["structuredContent"];
    assert_eq!(resultaat["inactiveMembers"], json!([5]), "{resultaat}");
    let n4 = resultaat["memberForces"].as_array().unwrap().iter()
        .find(|f| f["memberId"] == json!(4)).unwrap()["nStartKn"].as_f64().unwrap();
    assert!((n4 - 12.0 * 52f64.sqrt() / 6.0).abs() < 1e-6, "N diagonaal {n4}");
    let verwacht_mm = -(4.0 / 52f64.sqrt()) * 100.0 * 4.0 / (2.1e8 * 0.01) * 1000.0;
    let fit = resultaat["tensionOnlyFit"].as_array().expect("tensionOnlyFit in het resultaat");
    assert_eq!(fit.len(), 2);
    for (regel, id) in fit.iter().zip([4, 5]) {
        assert_eq!(regel["memberId"], json!(id));
        let delta = regel["deltaMm"].as_f64().unwrap();
        assert!((delta - verwacht_mm).abs() < 1e-6 * verwacht_mm.abs(), "Δ0 staaf {id}: {delta} tegen {verwacht_mm}");
    }
    assert!(resultaat.get("crossRuleMembers").is_none(), "de regel was niet nodig: {resultaat}");
    let meldingen = resultaat["diagnostics"].as_array().unwrap();
    assert!(meldingen.iter().any(|m| m.as_str().unwrap().contains("de regel was nergens nodig")), "{meldingen:?}");

    // Een tikfout in de montagelasten: het contract weigert onbekende velden.
    let mut tikfout = verzoek;
    tikfout["tensionOnlyFit"] = json!({ "nodalLoad": [] });
    schrijf(&mut stdin, json!({
        "jsonrpc": "2.0", "id": 100, "method": "tools/call",
        "params": { "name": "solve_open_fem_3d", "arguments": tikfout }
    })).await;
    let antwoord = lees_bericht(&mut reader).await;
    let melding = antwoord["error"]["message"].as_str().map(str::to_owned)
        .unwrap_or_else(|| foutmelding(&antwoord["result"]));
    assert!(melding.contains("nodalLoad"), "{antwoord}");
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── De stalen hal ───────────────────────────────────────────────────────────

/// Alle objectniveaus van een schema, met hun pad.
fn objectniveaus(pad: &str, schema: &Value, uit: &mut Vec<(String, Value)>) {
    if let Some(eigenschappen) = schema.get("properties").and_then(Value::as_object) {
        uit.push((pad.to_owned(), schema.clone()));
        for (k, v) in eigenschappen {
            objectniveaus(&format!("{pad}.{k}"), v, uit);
        }
    }
}

/// `open_fem_3d_staalhal_maken` en `gui_build_3d_steel_hall` zijn op ELK
/// objectniveau strikt (`additionalProperties: false`), delen hetzelfde
/// halschema, en dat schema draagt de standaardwaarden van de voorbeeldhal.
/// Dat de velden gelijk zijn aan de poort van de generator bewaakt de
/// unittest `schema_spiegelt_de_veldpoort_van_de_generator`; dat de
/// standaardwaarden die van de generator zijn, `tests/staalhal_mcp.rs`.
#[tokio::test]
async fn schema_van_de_staalhal_is_strikt_op_elk_niveau() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 70, "open_fem_3d_staalhal_maken").await;
    let gui = tooldefinitie(&mut stdin, &mut reader, 71, "gui_build_3d_steel_hall").await;
    let mut niveaus = Vec::new();
    objectniveaus("inputSchema", &tool["inputSchema"], &mut niveaus);
    assert!(niveaus.len() >= 13, "te weinig objectniveaus: {}", niveaus.len());
    for (pad, niveau) in &niveaus {
        assert_eq!(niveau["additionalProperties"], json!(false), "{pad} is niet strikt");
    }
    let hal = &tool["inputSchema"]["properties"]["hal"];
    assert_eq!(&gui["inputSchema"]["properties"]["hal"], hal, "één halschema voor MCP en bediening");
    assert_eq!(gui["inputSchema"]["additionalProperties"], json!(false));
    let p = &hal["properties"];
    assert_eq!(p["lengteMm"]["default"], json!(60000.0));
    assert_eq!(p["breedteMm"]["default"], json!(30000.0));
    assert_eq!(p["goothoogteMm"]["default"], json!(8000.0));
    assert_eq!(p["profielen"]["properties"]["kolom"]["properties"]["profiel"]["default"], json!("HEA 450"));
    assert_eq!(p["fundering"]["properties"]["type"]["enum"], json!(["opleggingen", "balkrooster"]));
    assert_eq!(p["lasten"]["properties"]["wind"]["properties"]["bron"]["enum"], json!(["handmatig", "stuwdruk"]));
    assert_eq!(tool["inputSchema"]["properties"]["analyse"]["enum"], json!(["linear", "p-delta"]));
    // Issue #199: `analyse` geldt alleen voor de resultaten; de toets rekent
    // altijd P-Delta met scheefstand, en de beschrijvingen zeggen dat.
    eis_toetsbeschrijving(&tool);
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// De beschrijvingen van een 3D-tool met toets (staalhal, IFC-import): de
/// toets rekent altijd tweede orde met scheefstand in vier richtingen, los van
/// `analyse`, en weigert bij divergentie zonder terugval op eerste orde.
fn eis_toetsbeschrijving(tool: &Value) {
    let tekst = tool["description"].as_str().unwrap_or("");
    for woord in [
        "ALTIJD zelf tweede orde (P-Delta) met scheefstand",
        "+X, −X, +Y en −Y",
        "toetsanalyse",
        "geweigerd",
        "nooit teruggevallen op eerste orde",
    ] {
        assert!(tekst.contains(woord), "de toolbeschrijving noemt \"{woord}\" niet: {tekst}");
    }
    let analyse = tool["inputSchema"]["properties"]["analyse"]["description"].as_str().unwrap_or("");
    assert!(analyse.contains("RESULTATEN") && analyse.contains("P-Delta met scheefstand"), "{analyse}");
    let toetsen = tool["inputSchema"]["properties"]["toetsen"]["description"].as_str().unwrap_or("");
    assert!(toetsen.contains("P-Delta") && toetsen.contains("scheefstand"), "{toetsen}");
}

/// De gui-tools voor rekenen en toetsen zeggen dat de toetskrachten ook in 3D
/// altijd tweede orde met scheefstand zijn (issue #199), dat de resultaten in
/// 3D het analysetype volgen, en welke velden de toets beschrijven.
#[tokio::test]
async fn gui_toolbeschrijvingen_noemen_de_toets_in_2d_en_3d() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let analyse = tooldefinitie(&mut stdin, &mut reader, 160, "gui_set_analysis").await;
    let a = analyse["description"].as_str().unwrap_or("");
    assert!(a.contains("in 2D and in 3D alike") && a.contains("+X, −X, +Y and −Y"), "{a}");
    for (id, naam) in [(161, "gui_solve"), (162, "gui_run_checks")] {
        let t = tooldefinitie(&mut stdin, &mut reader, id, naam).await;
        let d = t["description"].as_str().unwrap_or("");
        for woord in ["+X, −X, +Y and −Y", "`toetsanalyse`", "`toetsAlphaCr`", "`toetsmeldingen`", "TOETSING_ONMOGELIJK"] {
            assert!(d.contains(woord), "{naam} noemt {woord:?} niet: {d}");
        }
        assert!(d.contains("linear"), "{naam}: de 3D-resultaten volgen het analysetype: {d}");
        assert!(!d.contains("For 3D it runs the P-Delta frame analysis"), "{naam}: {d}");
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Een tikfout in de toolargumenten (`rekenen` in plaats van `reken`) wordt
/// GEWEIGERD, niet genegeerd: anders zou de client een model zonder
/// berekening terugkrijgen terwijl hij er om vroeg.
#[tokio::test]
async fn tikfout_in_de_staalhalargumenten_wordt_geweigerd() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let uit = roep_tool_aan(&mut stdin, &mut reader, 72, "open_fem_3d_staalhal_maken", json!({ "rekenen": true })).await;
    assert_eq!(uit["isError"], json!(true), "{uit}");
    let melding = foutmelding(&uit);
    assert!(melding.contains("unknown field") && melding.contains("rekenen"), "{melding}");
    assert_eq!(uit["structuredContent"]["error_code"], json!("ARGUMENT_ONGELDIG"));
    let detail = roep_tool_aan(&mut stdin, &mut reader, 73, "open_fem_3d_staalhal_maken", json!({ "detail": "alles" })).await;
    assert_eq!(detail["isError"], json!(true), "{detail}");
    let gui = roep_tool_aan(&mut stdin, &mut reader, 74, "gui_build_3d_steel_hall", json!({ "hall": {} })).await;
    assert_eq!(gui["isError"], json!(true), "{gui}");
    assert!(foutmelding(&gui).contains("unknown field"), "{}", foutmelding(&gui));
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── 3D-platen via solve_open_fem_3d ─────────────────────────────────────────

/// Een vierkante vloer 4×4 m (2×2 MITC4-elementen), in de hoeken vast en
/// vlaklast −5 kN/m²: Σ Rz = 5·16 = 80 kN.
fn plaatverzoek() -> Value {
    let mut nodes = Vec::new();
    for j in 0..3 {
        for i in 0..3 {
            nodes.push(json!({ "id": 1 + j * 3 + i, "x": 2.0 * i as f64, "y": 2.0 * j as f64, "z": 0.0 }));
        }
    }
    let id = |i: usize, j: usize| 1 + j * 3 + i;
    let mut elements = Vec::new();
    for j in 0..2 {
        for i in 0..2 {
            elements.push(json!({
                "id": elements.len() + 1, "plateId": 1,
                "nodeIds": [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]
            }));
        }
    }
    let supports: Vec<Value> = [id(0, 0), id(2, 0), id(2, 2), id(0, 2)].iter().map(|n| json!({
        "nodeId": n, "ux": true, "uy": true, "uz": true, "rx": false, "ry": false, "rz": false
    })).collect();
    json!({
        "schemaVersion": 2,
        "analysis": "linear",
        "nodes": nodes,
        "materials": [{ "id": 1, "name": "C30/37", "eMpa": 33000.0, "nu": 0.2 }],
        "plates": [{ "id": 1, "materialId": 1, "thicknessM": 0.2 }],
        "shellElements": elements,
        "surfaceLoads": [{ "id": 1, "plateId": 1, "qxKnPerM2": 0.0, "qyKnPerM2": 0.0, "qzKnPerM2": -5.0 }],
        "supports": supports,
        "bucklingModes": 0
    })
}

#[tokio::test]
async fn solve_open_fem_3d_rekent_platen_en_weigert_een_tikfout() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 70, "solve_open_fem_3d").await;
    let props = &tool["inputSchema"]["properties"];
    for veld in ["plates", "shellElements", "surfaceLoads"] {
        assert_eq!(props[veld]["items"]["additionalProperties"], json!(false), "{veld} hoort strikt te zijn");
    }
    let uitkomst = roep_tool_aan(&mut stdin, &mut reader, 71, "solve_open_fem_3d", plaatverzoek()).await;
    assert!(uitkomst["isError"] != json!(true), "plaatmodel rekent niet: {}", foutmelding(&uitkomst));
    let tekst = foutmelding(&uitkomst);
    let resultaat: Value = serde_json::from_str(&tekst).expect("resultaat is JSON");
    let som: f64 = resultaat["reactions"].as_array().unwrap().iter().map(|r| r["fz"].as_f64().unwrap()).sum();
    assert!((som - 80.0).abs() < 1e-6, "Σ Rz = {som}");
    assert_eq!(resultaat["schemaVersion"], json!(2));
    assert_eq!(resultaat["plates"][0]["plateId"], json!(1));
    assert!(resultaat["shellNodes"].as_array().is_some_and(|v| v.len() == 9));

    let mut tikfout = plaatverzoek();
    tikfout["plates"][0] = json!({ "id": 1, "materialId": 1, "thickness": 0.2 });
    let fout = roep_tool_aan(&mut stdin, &mut reader, 72, "solve_open_fem_3d", tikfout).await;
    assert_eq!(fout["isError"], json!(true), "een tikfout in een plaatveld hoort geweigerd te worden");

    let mut tweede_orde = plaatverzoek();
    tweede_orde["analysis"] = json!("p-delta");
    let fout = roep_tool_aan(&mut stdin, &mut reader, 73, "solve_open_fem_3d", tweede_orde).await;
    assert!(foutmelding(&fout).contains("P-Delta"), "{}", foutmelding(&fout));
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Plaat op bedding (issue #107) over de echte binary: het schema van
/// `solve_open_fem_3d` (plates[].bedding) en van `gui_build_3d_model`
/// (plates[].bedding) is strikt, en een tikfout in een beddingveld wordt
/// geweigerd. Een vloer van 4 × 4 m (2 × 2 MITC4-elementen), alleen in haar
/// vlak gesteund, onder q = 5 kN/m² op k = 20 000 kN/m³: overal een zakking
/// q/k = 0,25 mm en gronddruk q (afrondingsruis, 10⁻⁹) en Σ veerkrachten
/// q·A = 80 kN.
#[tokio::test]
async fn plaat_op_bedding_via_mcp_is_strikt_en_rekent() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 170, "solve_open_fem_3d").await;
    let bedding = &tool["inputSchema"]["properties"]["plates"]["items"]["properties"]["bedding"];
    assert_eq!(bedding["additionalProperties"], json!(false), "{bedding}");
    assert_eq!(bedding["required"], json!(["kKnPerM3"]));
    for veld in ["kKnPerM3", "compressionOnly"] {
        assert!(bedding["properties"].get(veld).is_some(), "{veld} ontbreekt");
    }
    let bouw = tooldefinitie(&mut stdin, &mut reader, 171, "gui_build_3d_model").await;
    let app = &bouw["inputSchema"]["properties"]["plates"]["items"]["properties"]["bedding"];
    assert_eq!(app["additionalProperties"], json!(false), "{app}");
    assert_eq!(app["required"], json!(["k_kn_per_m3"]));

    // De vloer van plaatverzoek, maar alleen in haar vlak gesteund: verticaal draagt de grond.
    let mut verzoek = plaatverzoek();
    verzoek["plates"][0]["bedding"] = json!({ "kKnPerM3": 20000.0 });
    verzoek["supports"] = json!([
        { "nodeId": 1, "ux": true, "uy": true, "uz": false, "rx": false, "ry": false, "rz": false },
        { "nodeId": 3, "ux": false, "uy": true, "uz": false, "rx": false, "ry": false, "rz": false }
    ]);
    let uit = roep_tool_aan(&mut stdin, &mut reader, 172, "solve_open_fem_3d", verzoek.clone()).await;
    let melding = foutmelding(&uit);
    assert!(uit["isError"] != json!(true), "plaat op bedding rekent niet: {melding}");
    let resultaat: Value = serde_json::from_str(&melding).expect("resultaat is JSON");
    let vloer = &resultaat["plateBedding"][0];
    assert_eq!(vloer["plateId"], json!(1), "{resultaat}");
    let knopen = vloer["nodes"].as_array().expect("knopen");
    assert_eq!(knopen.len(), 9, "elke knoop van de vloer");
    for knoop in knopen {
        let zakking = knoop["settlementM"].as_f64().unwrap();
        assert!((zakking - 0.00025).abs() <= 1e-9 * 0.00025, "zakking {zakking} op knoop {}", knoop["nodeId"]);
        let druk = knoop["pressureKnPerM2"].as_f64().unwrap();
        assert!((druk - 5.0).abs() <= 1e-9 * 5.0, "gronddruk {druk} op knoop {}", knoop["nodeId"]);
        assert_eq!(knoop["active"], json!(true));
    }
    let som = vloer["totalReactionKn"].as_f64().unwrap();
    assert!((som - 80.0).abs() < 1e-9 * 80.0, "Σ veerkrachten {som}");
    assert_eq!(vloer["liftedFraction"].as_f64(), Some(0.0));
    // Een tikfout in een beddingveld: het schema weigert onbekende velden.
    let mut tikfout = verzoek;
    tikfout["plates"][0]["bedding"] = json!({ "kKnPerm3": 20000.0 });
    schrijf(&mut stdin, json!({
        "jsonrpc": "2.0", "id": 173, "method": "tools/call",
        "params": { "name": "solve_open_fem_3d", "arguments": tikfout }
    })).await;
    let antwoord = lees_bericht(&mut reader).await;
    let melding = antwoord["error"]["message"].as_str().map(str::to_owned)
        .unwrap_or_else(|| foutmelding(&antwoord["result"]));
    assert!(melding.contains("kKnPerm3"), "{antwoord}");
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── De import van een IFC4-analysemodel ─────────────────────────────────────

/// `open_fem_3d_ifc_importeren` en `gui_import_ifc_analysis_model` zijn op ELK
/// objectniveau strikt, het pad is verplicht en de keuze van het analysemodel
/// (naam of volgnummer vanaf 1) is in beide hetzelfde schema. Dat de import
/// zelf klopt, bewaakt `tests/ifc_import_mcp.rs`.
#[tokio::test]
async fn schema_van_de_ifc_import_is_strikt_op_elk_niveau() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 80, "open_fem_3d_ifc_importeren").await;
    let gui = tooldefinitie(&mut stdin, &mut reader, 81, "gui_import_ifc_analysis_model").await;
    for (naam, schema) in [("open_fem_3d_ifc_importeren", &tool["inputSchema"]), ("gui_import_ifc_analysis_model", &gui["inputSchema"])] {
        let mut niveaus = Vec::new();
        objectniveaus("inputSchema", schema, &mut niveaus);
        assert!(!niveaus.is_empty(), "{naam} heeft geen objectniveau");
        for (pad, niveau) in &niveaus {
            assert_eq!(niveau["additionalProperties"], json!(false), "{naam}: {pad} is niet strikt");
        }
    }
    assert_eq!(tool["inputSchema"]["required"], json!(["pad"]));
    assert_eq!(gui["inputSchema"]["required"], json!(["path"]));
    assert_eq!(
        tool["inputSchema"]["properties"]["analysemodel"], gui["inputSchema"]["properties"]["analysis_model"],
        "één schema voor de keuze van het analysemodel"
    );
    let keuze = &tool["inputSchema"]["properties"]["analysemodel"]["oneOf"];
    assert_eq!(keuze[0]["type"], json!("string"));
    assert_eq!(keuze[1]["minimum"], json!(1));
    assert_eq!(tool["inputSchema"]["properties"]["analyse"]["enum"], json!(["linear", "p-delta"]));
    assert_eq!(tool["inputSchema"]["properties"]["gevolgklasse"]["enum"], json!(["CC1", "CC2", "CC3"]));
    eis_toetsbeschrijving(&tool);
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Een tikfout in de argumenten (`rekenen`, `analysis-model`) wordt GEWEIGERD:
/// anders zou de client een import zonder berekening, of van het verkeerde
/// analysemodel, terugkrijgen terwijl hij iets anders vroeg.
#[tokio::test]
async fn tikfout_in_de_ifc_importargumenten_wordt_geweigerd() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let uit = roep_tool_aan(&mut stdin, &mut reader, 82, "open_fem_3d_ifc_importeren",
        json!({ "pad": "C:/bestaat/niet.ifc", "rekenen": true })).await;
    assert_eq!(uit["isError"], json!(true), "{uit}");
    let melding = foutmelding(&uit);
    assert!(melding.contains("unknown field") && melding.contains("rekenen"), "{melding}");
    assert_eq!(uit["structuredContent"]["error_code"], json!("ARGUMENT_ONGELDIG"));
    let zonder = roep_tool_aan(&mut stdin, &mut reader, 83, "open_fem_3d_ifc_importeren", json!({})).await;
    assert_eq!(zonder["isError"], json!(true), "zonder pad: {zonder}");
    let nul = roep_tool_aan(&mut stdin, &mut reader, 84, "open_fem_3d_ifc_importeren",
        json!({ "pad": "C:/bestaat/niet.ifc", "analysemodel": 0 })).await;
    assert_eq!(nul["isError"], json!(true), "analysemodel 0: {nul}");
    let gui = roep_tool_aan(&mut stdin, &mut reader, 85, "gui_import_ifc_analysis_model",
        json!({ "path": "C:/x.ifc", "analysis-model": 1 })).await;
    assert_eq!(gui["isError"], json!(true), "{gui}");
    assert!(foutmelding(&gui).contains("unknown field"), "{}", foutmelding(&gui));
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── De app starten (issue #109) ─────────────────────────────────────────────

/// `gui_start_app` heeft één optioneel argument, `timeout_s` (5–300 s), en
/// weigert al het andere: een tikfout (`timeout`) mag niet stil de standaard
/// van 60 s opleveren, en zeker geen ander gedrag. De weigering komt vóór er
/// iets gestart of gezocht wordt.
#[tokio::test]
async fn schema_van_gui_start_app_is_strikt() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 90, "gui_start_app").await;
    let s = &tool["inputSchema"];
    assert_eq!(s["type"], json!("object"));
    assert_eq!(s["additionalProperties"], json!(false));
    assert!(s.get("required").is_none() || s["required"] == json!([]), "{s}");
    let t = &s["properties"]["timeout_s"];
    assert_eq!(t["type"], json!("integer"));
    assert_eq!(t["minimum"], json!(5));
    assert_eq!(t["maximum"], json!(300));
    assert_eq!(t["default"], json!(60));
    assert_eq!(s["properties"].as_object().unwrap().len(), 1, "alleen timeout_s");
    let beschrijving = tool["description"].as_str().unwrap();
    assert!(beschrijving.contains("OPENAEC_APP"), "{beschrijving}");
    assert!(beschrijving.contains("AI assistant (MCP)"), "{beschrijving}");

    let tikfout = roep_tool_aan(&mut stdin, &mut reader, 91, "gui_start_app", json!({ "timeout": 10 })).await;
    assert_eq!(tikfout["isError"], json!(true), "{tikfout}");
    assert!(foutmelding(&tikfout).contains("unknown field"), "{}", foutmelding(&tikfout));
    assert_eq!(tikfout["structuredContent"]["error_code"], json!("ARGUMENT_ONGELDIG"));
    for buiten in [json!({ "timeout_s": 1 }), json!({ "timeout_s": 301 })] {
        let uit = roep_tool_aan(&mut stdin, &mut reader, 92, "gui_start_app", buiten.clone()).await;
        assert_eq!(uit["isError"], json!(true), "{buiten}: {uit}");
        assert_eq!(uit["structuredContent"]["error_code"], json!("ARGUMENT_ONGELDIG"), "{buiten}");
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── Aluminium (NEN-EN 1999-1-1, issue #5) ──────────────────────────────────

/// I 200×100×6×10 in EN AW-6063 T6, de ligger van
/// `aluminium-check/tests/handberekening.rs`; er wordt hier geen UC vastgelegd.
fn geldige_aluminiuminvoer() -> Value {
    json!({
        "beam_id": 4, "section_name": "ALU-I 200x100x6x10",
        "doorsnede": { "vorm": "IProfiel", "h_mm": 200.0, "b_mm": 100.0, "tw_mm": 6.0, "tf_mm": 10.0 },
        "legering": "EN AW-6063 T6", "lasstatus": "Geen", "length_m": 3.0,
        "forces_envelope": [
            { "combination_id": 1, "position_mm": 0.0,
              "forces": { "n_ed": -100.0, "vy_ed": 0.0, "vz_ed": 20.0, "mt_ed": 0.0, "my_ed": 10.0, "mz_ed": 0.0 } }
        ],
        "buckling_length_y_m": 3.0, "buckling_length_z_m": 1.5
    })
}

#[tokio::test]
async fn schema_van_check_aluminium_beams_is_strikt_op_elk_niveau() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 60, "check_aluminium_beams").await;
    assert_eq!(tool["inputSchema"]["additionalProperties"], false, "omhulsel");
    let staaf = &tool["inputSchema"]["properties"]["inputs"]["items"];
    assert_eq!(staaf["additionalProperties"], false, "staaf");
    assert_eq!(staaf["properties"].as_object().unwrap().len(), 12,
        "precies de 12 velden van AluminiumBeamCheckInput (spiegeltest in aluminium_tools.rs)");
    // De lasstatus is verplicht en heeft geen standaard (issue #5: nooit stil ongelast).
    assert!(staaf["required"].as_array().unwrap().contains(&json!("lasstatus")));
    assert!(staaf["properties"]["lasstatus"].get("default").is_none());
    for variant in staaf["properties"]["doorsnede"]["oneOf"].as_array().unwrap() {
        assert_eq!(variant["additionalProperties"], false, "doorsnedevariant {variant}");
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn aluminiuminvoer_rekent_en_een_tikfout_wordt_geweigerd() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let result = roep_tool_aan(&mut stdin, &mut reader, 61, "check_aluminium_beams",
        json!({ "inputs": [geldige_aluminiuminvoer()] })).await;
    assert_eq!(result["isError"], false, "geldige invoer: {}", foutmelding(&result));
    let r = &result["structuredContent"]["results"][0];
    assert!(!r["checks"].as_array().unwrap().is_empty());
    // Kip en 6.3.3 zijn niet geïmplementeerd: deze staaf mag niet "Ok" zijn.
    assert_eq!(r["status"], "NotApplicable");

    for (i, (pad, tikfout)) in [("staaf", "zijdelings_gestuend"), ("doorsnede", "t_mm")].into_iter().enumerate() {
        let mut invoer = geldige_aluminiuminvoer();
        let doel = if pad == "staaf" { &mut invoer } else { &mut invoer["doorsnede"] };
        doel.as_object_mut().unwrap().insert(tikfout.into(), json!(1));
        let result = roep_tool_aan(&mut stdin, &mut reader, 62 + i as u32, "check_aluminium_beams",
            json!({ "inputs": [invoer] })).await;
        assert_eq!(result["isError"], true, "{pad}: `{tikfout}` gaf een resultaat: {result}");
        assert!(foutmelding(&result).contains(tikfout), "{pad}: {}", foutmelding(&result));
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// `check_fem_model` kent geen `nonlinear` meer (issue #199): de UGT-toets
/// rekent altijd tweede orde (P-Δ) met scheefstand. Het schema biedt het
/// veld niet aan, en een client die het toch stuurt krijgt ARGUMENT_ONGELDIG in
/// plaats van een stil genegeerde vlag — wie hem stuurt, verwacht er iets van.
/// `solve_fem_model` houdt `nonlinear`: daar gaat het om de resultaten. De
/// beschrijving van `check_fem_model` noemt de toetsanalyse en de nieuwe
/// uitvoervelden, zodat een client weet waar hij ze leest.
#[tokio::test]
async fn check_fem_model_kent_geen_nonlinear_en_noemt_de_toetsanalyse() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let check = tooldefinitie(&mut stdin, &mut reader, 120, "check_fem_model").await;
    let s = &check["inputSchema"];
    assert_eq!(s["additionalProperties"], json!(false));
    assert!(s["properties"].get("nonlinear").is_none(), "check_fem_model biedt `nonlinear` aan: {s}");
    let beschrijving = check["description"].as_str().unwrap_or("");
    for woord in [
        "TOETSKRACHTEN", "P-Delta", "scheefstand", "model_analysis_type", "afgedwongen",
        "analyse_toelichting", "scheefstand_toelichting", "TOETSING_GEWEIGERD", "detail.toets_geweigerd",
    ] {
        assert!(beschrijving.contains(woord), "de beschrijving van check_fem_model noemt {woord:?} niet");
    }
    let solve = tooldefinitie(&mut stdin, &mut reader, 121, "solve_fem_model").await;
    assert!(
        solve["inputSchema"]["properties"]["nonlinear"].is_object(),
        "solve_fem_model hoort `nonlinear` te houden (de resultaten)"
    );
    assert!(
        !solve["description"].as_str().unwrap_or("").contains("Sluitstuk is `steel_check_inputs`"),
        "solve_fem_model levert geen toetsinvoer meer"
    );

    // De argumenten worden vóór de sidecar gelezen: hier is geen Node nodig.
    let uit = roep_tool_aan(
        &mut stdin,
        &mut reader,
        122,
        "check_fem_model",
        json!({ "model": { "nodes": [], "beams": [], "supports": [], "loadCases": [] }, "nonlinear": true }),
    )
    .await;
    assert_eq!(uit["isError"], json!(true), "{uit}");
    assert_eq!(uit["structuredContent"]["error_code"], json!("ARGUMENT_ONGELDIG"), "{uit}");
    assert!(foutmelding(&uit).contains("nonlinear"), "{}", foutmelding(&uit));
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── Eigen factoren, bewust gekozen (issue #196) ──────────────────────────────

/// De combinaties van `solve_fem_model` en `check_fem_model` kennen
/// `bevestigdeFactoren` (bewust gekozen eigen factoren, zoals `load_fem_project`
/// ze teruggeeft), en blijven verder strikt: geen ander veld erbij. Zonder het
/// veld in het schema kon een cliënt die combinaties niet ongewijzigd
/// teruggeven, en kwam de FOUT terug. Wat de server ermee doet, staat in
/// `eigen_factoren_mcp.rs` (die vraagt Node; deze test niet).
#[tokio::test]
async fn combinaties_kennen_de_bevestigde_eigen_factoren_strikt() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    for (i, naam) in ["solve_fem_model", "check_fem_model"].iter().enumerate() {
        let tool = tooldefinitie(&mut stdin, &mut reader, 200 + i as u32, naam).await;
        let item = &tool["inputSchema"]["properties"]["combinations"]["items"];
        assert_eq!(item["additionalProperties"], json!(false), "{naam}: {item}");
        let mut velden: Vec<&str> = item["properties"].as_object().unwrap().keys().map(String::as_str).collect();
        velden.sort_unstable();
        assert_eq!(velden, ["bevestigdeFactoren", "factors", "formula", "id", "name", "type"], "{naam}");
        let veld = &item["properties"]["bevestigdeFactoren"];
        assert_eq!(veld["type"], json!("object"), "{naam}: {veld}");
        assert_eq!(veld["additionalProperties"], json!({ "type": "number" }), "{naam}: {veld}");
        assert!(veld["description"].as_str().unwrap_or("").contains("PRECIES"), "{naam}: {veld}");
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── Metselwerk (NEN-EN 1996-1-1, issue #98) ────────────────────────────────

/// De voorbeeldwand van `metselwerk-check/tests/handberekening.rs` (alleen
/// verticale belasting); er wordt hier geen UC vastgelegd.
fn geldige_metselwerkinvoer() -> Value {
    let nw = |w: f64| json!({ "waarde": w, "bron": "testwaarde" });
    json!({
        "wand_id": 1, "naam": "KZS 120",
        "materiaal": {
            "steensoort": "Kalkzandsteen", "steengroep": "Groep1", "mortel": "Lijm",
            "f_b_mpa": 20.0, "k": nw(0.8), "langsvoeg": false, "gamma_m": nw(1.7),
            "k_e": nw(1000.0), "phi_inf": nw(1.5), "stootvoegen_gevuld": false
        },
        "geometrie": { "t_mm": 120.0, "h_m": 2.6, "l_m": 3.6,
            "steunranden": { "soort": "TweeVerticaleRanden", "l_m": 3.0 }, "betonvloeren": true },
        "verticaal": { "n_boven_kn_m": 60.0, "m_boven_knm_m": 0.6, "n_midden_kn_m": 65.0,
            "m_midden_knm_m": 0.3, "n_onder_kn_m": 70.0, "m_onder_knm_m": 0.0 }
    })
}

#[tokio::test]
async fn schema_van_check_masonry_walls_is_strikt_op_elk_niveau() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 70, "check_masonry_walls").await;
    assert_eq!(tool["inputSchema"]["additionalProperties"], false, "omhulsel");
    let wand = &tool["inputSchema"]["properties"]["inputs"]["items"];
    assert_eq!(wand["additionalProperties"], false, "wand");
    for veld in ["materiaal", "geometrie", "verticaal", "afschuiving", "buiging"] {
        assert_eq!(wand["properties"][veld]["additionalProperties"], false, "{veld}");
    }
    let mat = &wand["properties"]["materiaal"];
    // K en γ_M zijn verplicht en hebben geen standaard (NDP, alleen met bron).
    for veld in ["k", "gamma_m", "langsvoeg", "stootvoegen_gevuld"] {
        assert!(mat["required"].as_array().unwrap().contains(&json!(veld)), "{veld} verplicht");
        assert!(mat["properties"][veld].get("default").is_none(), "{veld} zonder standaard");
    }
    assert_eq!(mat["properties"]["k"]["additionalProperties"], false, "normwaarde");
    for variant in wand["properties"]["geometrie"]["properties"]["steunranden"]["oneOf"].as_array().unwrap() {
        assert_eq!(variant["additionalProperties"], false, "steunrandvariant {variant}");
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn metselwerkinvoer_rekent_en_een_tikfout_wordt_geweigerd() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let result = roep_tool_aan(&mut stdin, &mut reader, 71, "check_masonry_walls",
        json!({ "inputs": [geldige_metselwerkinvoer()] })).await;
    assert_eq!(result["isError"], false, "geldige invoer: {}", foutmelding(&result));
    let r = &result["structuredContent"]["results"][0];
    assert!(r["checks"].as_array().unwrap().iter().any(|c| c["id"] == "druk_midden"));
    assert_eq!(r["status"], "Ok");

    for (i, (pad, tikfout)) in [("wand", "verticaa"), ("materiaal", "f_vk_0"), ("steunranden", "l_mm")].into_iter().enumerate() {
        let mut invoer = geldige_metselwerkinvoer();
        let doel = match pad {
            "wand" => &mut invoer,
            "materiaal" => &mut invoer["materiaal"],
            _ => &mut invoer["geometrie"]["steunranden"],
        };
        doel.as_object_mut().unwrap().insert(tikfout.into(), json!(1));
        let result = roep_tool_aan(&mut stdin, &mut reader, 72 + i as u32, "check_masonry_walls",
            json!({ "inputs": [invoer] })).await;
        assert_eq!(result["isError"], true, "{pad}: `{tikfout}` gaf een resultaat: {result}");
        assert!(foutmelding(&result).contains(tikfout), "{pad}: {}", foutmelding(&result));
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

// ── Koudgevormde profielen (NEN-EN 1993-1-3, issue #4) ─────────────────────

/// C 200×70×20×2 r1,5 in S350GD, de ligger van
/// `koudgevormd-check/tests/handberekening.rs`; er wordt hier geen UC vastgelegd.
fn geldige_koudgevormde_invoer() -> Value {
    json!({
        "beam_id": 5, "section_name": "KV-C 200x70x20x2 r1.5",
        "doorsnede": { "vorm": "CProfiel", "h_mm": 200.0, "b_mm": 70.0, "c_mm": 20.0, "t_mm": 2.0, "r_mm": 1.5 },
        "staalsoort": "S350GD", "length_m": 3.0,
        "forces_envelope": [
            { "combination_id": 1, "position_mm": 0.0,
              "forces": { "n_ed": 0.0, "vy_ed": 0.0, "vz_ed": 5.0, "mt_ed": 0.0, "my_ed": 8.0, "mz_ed": 0.0 } }
        ],
        "buckling_length_y_m": 3.0, "buckling_length_z_m": 3.0
    })
}

#[tokio::test]
async fn schema_van_check_koudgevormd_beams_is_strikt_op_elk_niveau() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let tool = tooldefinitie(&mut stdin, &mut reader, 210, "check_koudgevormd_beams").await;
    assert_eq!(tool["inputSchema"]["additionalProperties"], false, "omhulsel");
    let staaf = &tool["inputSchema"]["properties"]["inputs"]["items"];
    assert_eq!(staaf["additionalProperties"], false, "staaf");
    assert_eq!(staaf["properties"].as_object().unwrap().len(), 12,
        "precies de 12 velden van KoudgevormdBeamCheckInput (spiegeltest in koudgevormd_tools.rs)");
    for variant in staaf["properties"]["doorsnede"]["oneOf"].as_array().unwrap() {
        assert_eq!(variant["additionalProperties"], false, "doorsnedevariant {variant}");
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn koudgevormde_invoer_rekent_en_een_tikfout_wordt_geweigerd() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let result = roep_tool_aan(&mut stdin, &mut reader, 211, "check_koudgevormd_beams",
        json!({ "inputs": [geldige_koudgevormde_invoer()] })).await;
    assert_eq!(result["isError"], false, "geldige invoer: {}", foutmelding(&result));
    let r = &result["structuredContent"]["results"][0];
    assert!(!r["checks"].as_array().unwrap().is_empty());
    // Kip is niet geïmplementeerd en de staaf is niet gesteund opgegeven.
    assert_eq!(r["status"], "NotApplicable");

    for (i, (pad, tikfout)) in [("staaf", "zijdelings_gestuend"), ("doorsnede", "tw_mm")].into_iter().enumerate() {
        let mut invoer = geldige_koudgevormde_invoer();
        let doel = if pad == "staaf" { &mut invoer } else { &mut invoer["doorsnede"] };
        doel.as_object_mut().unwrap().insert(tikfout.into(), json!(1));
        let result = roep_tool_aan(&mut stdin, &mut reader, 212 + i as u32, "check_koudgevormd_beams",
            json!({ "inputs": [invoer] })).await;
        assert_eq!(result["isError"], true, "{pad}: `{tikfout}` gaf een resultaat: {result}");
        assert!(foutmelding(&result).contains(tikfout), "{pad}: {}", foutmelding(&result));
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}
