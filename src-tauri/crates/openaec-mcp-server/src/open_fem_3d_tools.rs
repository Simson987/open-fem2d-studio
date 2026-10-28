//! MCP-gereedschap voor de ruimtelijke raamwerkkern.
//!
//! Dit is een dunne protocolschil rond `open_fem_3d::solve`. De desktop-app,
//! de ontwikkelbrowser en MCP rekenen daardoor met hetzelfde versievaste
//! contract en dezelfde revisie van de externe 3D-kern.

use serde_json::{json, Value};

use super::RpcError;

const TOOL: &str = "solve_open_fem_3d";

pub(super) fn is_open_fem_3d_tool(name: &str) -> bool {
    name == TOOL
}

fn vector_schema() -> Value {
    json!({ "type": "number", "description": "Eindig getal." })
}

fn nodal_loads_schema() -> Value {
    json!({
        "type": "array", "default": [],
        "items": {
            "type": "object", "additionalProperties": false,
            "required": ["id", "nodeId", "fx", "fy", "fz", "mx", "my", "mz"],
            "properties": {
                "id": { "type": "integer", "minimum": 1 },
                "nodeId": { "type": "integer", "minimum": 1 },
                "fx": vector_schema(), "fy": vector_schema(), "fz": vector_schema(),
                "mx": vector_schema(), "my": vector_schema(), "mz": vector_schema()
            }
        }
    })
}

/// Lokale component van een lijnlast: ontbreekt = 0 (sinds de globale lijnlast, issue #80).
fn local_component_schema() -> Value {
    json!({ "type": "number", "default": 0, "description": "Eindig getal; ontbreekt = 0. Bij een globale last 0 of weglaten." })
}

fn member_loads_schema() -> Value {
    json!({
        "type": "array", "default": [],
        "description": "Trapeziumvormige lijnlasten op staven in kN/m; posities in m vanaf het staafbegin. Lokaal: qy/qz langs de staafassen y/z (een ontbrekende component is 0). Globaal (issue #80): globalDirection x, y of z met qStartKnPerM/qEndKnPerM met teken langs die globale as (z negatief = omlaag), lineair over het bereik; per meter staaflengte, of met perProjection per meter projectie van de staaf op het vlak loodrecht op de lastrichting (sneeuw op een schuine spant: per horizontale meter, dus q·|e_x × d| per staafmeter). Een globale last heeft geen lokale waarden (0 of weglaten).",
        "items": {
            "type": "object", "additionalProperties": false,
            "required": ["id", "memberId"],
            "properties": {
                "id": { "type": "integer", "minimum": 1 },
                "memberId": { "type": "integer", "minimum": 1 },
                "qyStartKnPerM": local_component_schema(), "qyEndKnPerM": local_component_schema(),
                "qzStartKnPerM": local_component_schema(), "qzEndKnPerM": local_component_schema(),
                "globalDirection": { "type": "string", "enum": ["x", "y", "z"],
                    "description": "Globale lastrichting; aanwezig = een globale lijnlast met qStartKnPerM en qEndKnPerM." },
                "qStartKnPerM": { "type": "number", "description": "Globale last aan het begin van het bereik, kN/m, met teken langs de globale as." },
                "qEndKnPerM": { "type": "number", "description": "Globale last aan het eind van het bereik, kN/m, met teken langs de globale as." },
                "perProjection": { "type": "boolean", "default": false,
                    "description": "Alleen bij een globale last: per meter projectie loodrecht op de lastrichting in plaats van per meter staaflengte." },
                "startPositionM": { "type": ["number", "null"], "minimum": 0 },
                "endPositionM": { "type": ["number", "null"], "exclusiveMinimum": 0 }
            }
        }
    })
}

fn member_point_loads_schema() -> Value {
    json!({
        "type": "array", "default": [],
        "description": "Concentrated member forces in local y/z axes. Forces are kN; position is metres from member start.",
        "items": {
            "type": "object", "additionalProperties": false,
            "required": ["id", "memberId", "pyKn", "pzKn", "positionM"],
            "properties": {
                "id": { "type": "integer", "minimum": 1 },
                "memberId": { "type": "integer", "minimum": 1 },
                "pyKn": vector_schema(), "pzKn": vector_schema(),
                "positionM": { "type": "number", "minimum": 0 }
            }
        }
    })
}

fn thermal_loads_schema() -> Value {
    json!({
        "type": "array", "default": [],
        "description": "Member temperature loads in K. Gradients are differences between the outer fibres over the local y/z section dimensions (EN 1991-1-5): deltaTGradientZK requires sections[].heightM, deltaTGradientYK requires sections[].widthM; the curvature is alpha*deltaT/heightM (or widthM).",
        "items": {
            "type": "object", "additionalProperties": false,
            "required": ["id", "memberId", "deltaTUniformK"],
            "properties": {
                "id": { "type": "integer", "minimum": 1 },
                "memberId": { "type": "integer", "minimum": 1 },
                "deltaTUniformK": vector_schema(),
                "deltaTGradientYK": { "type": "number", "default": 0 },
                "deltaTGradientZK": { "type": "number", "default": 0 }
            }
        }
    })
}

fn surface_loads_schema() -> Value {
    json!({
        "type": "array", "default": [],
        "description": "Gelijkmatige vlaklast op een hele plaat in globale assen, kN/m² (eigen gewicht: −ρ·g·t in Z).",
        "items": {
            "type": "object", "additionalProperties": false,
            "required": ["id", "plateId", "qxKnPerM2", "qyKnPerM2", "qzKnPerM2"],
            "properties": {
                "id": { "type": "integer", "minimum": 1 },
                "plateId": { "type": "integer", "minimum": 1 },
                "qxKnPerM2": vector_schema(), "qyKnPerM2": vector_schema(), "qzKnPerM2": vector_schema()
            }
        }
    })
}

/// Staaf op bedding (issue #106): dezelfde velden als `Member3D.bedding` van
/// de kern. Minstens één van beide constanten; dat keurt de kern.
fn bedding_schema() -> Value {
    json!({
        "type": "object", "additionalProperties": false,
        "required": ["widthM"],
        "description": "Staaf op bedding (Winkler): de grond steunt de staaf met veren k·b over de hele lengte; de adapter knipt de staaf zelf fijn genoeg. Geef kKnPerM3, kLateralKnPerM3 of beide. Een (bijna) verticale staaf (|ex·Z| > 0,95) krijgt alleen kLateralKnPerM3 (paal); een verticale k wordt daar geweigerd. Het resultaat geeft per staaf de zakking en de gronddruk in `bedding`.",
        "properties": {
            "kKnPerM3": { "type": "number", "exclusiveMinimum": 0,
                "description": "Beddingsconstante k in kN/m³ voor de verticale richting (globaal Z, de grond ligt onder de staaf); lijnstijfheid k·b in kN/m per m." },
            "widthM": { "type": "number", "exclusiveMinimum": 0, "description": "Contactbreedte b in m." },
            "kLateralKnPerM3": { "type": "number", "exclusiveMinimum": 0,
                "description": "Zijdelingse beddingsconstante in kN/m³: horizontaal loodrecht op de staafas, naar beide zijden, altijd lineair (ook bij compressionOnly). Bij een staaf steiler dan 45° (een (schoor)paal) rondom, in twee richtingen loodrecht op de as; bij een loodrechte paal in X en Y." },
            "compressionOnly": { "type": "boolean", "default": false,
                "description": "Alleen druk: de verticale veren vallen weg waar de staaf omhoog komt (de grond trekt niet)." }
        }
    })
}

/// Orthotrope plaat (#79, #97): dezelfde velden als `Plate3D.orthotropy` van
/// de kern. Stijfheden groter dan 0; een tikfout weigert het schema.
fn plate_orthotropy_schema() -> Value {
    json!({
        "type": "object", "additionalProperties": false,
        "required": ["eXMpa", "eYMpa", "gXyMpa"],
        "description": "Orthotrope plaat (vlakke spanning, hoofdassen langs de plaatassen; bij een verticale wand is y omhoog en x horizontaal in het vlak). Vervangt E en ν van het materiaal voor membraan (A = Q·t), buiging (D = Q·t³/12) en dwarskracht (5/6·G·t). Q11 = Ex/(1−νxy·νyx), Q22 = Ey/(1−νxy·νyx), Q12 = νxy·Ey/(1−νxy·νyx), Q66 = Gxy, νyx = νxy·Ey/Ex. Metselwerkwand (#97): eYMpa = E van het metselwerk, eXMpa ≈ 0 (bijv. 1e-6·Ey; 0 is niet toegestaan), gXyMpa = 0,4·E.",
        "properties": {
            "eXMpa": { "type": "number", "exclusiveMinimum": 0, "description": "E in plaat-x (N/mm²)." },
            "eYMpa": { "type": "number", "exclusiveMinimum": 0, "description": "E in plaat-y (N/mm²)." },
            "gXyMpa": { "type": "number", "exclusiveMinimum": 0, "description": "Schuifmodulus in het vlak (N/mm²)." },
            "nuXy": { "type": "number", "default": 0, "description": "Dwarscontractie νxy (rek in y door spanning in x); eis νxy² < Ex/Ey." },
            "gXzMpa": { "type": "number", "exclusiveMinimum": 0, "description": "Dwarskracht-schuifmodulus xz (N/mm²); standaard gXyMpa." },
            "gYzMpa": { "type": "number", "exclusiveMinimum": 0, "description": "Dwarskracht-schuifmodulus yz (N/mm²); standaard gXyMpa." }
        }
    })
}

/// Plaat op bedding (issue #107): dezelfde velden als `Plate3D.bedding` van
/// de kern. k verplicht en groter dan 0; een tikfout weigert het schema.
fn plate_bedding_schema() -> Value {
    json!({
        "type": "object", "additionalProperties": false,
        "required": ["kKnPerM3"],
        "description": "Plaat op bedding (Winkler), bijvoorbeeld een vloer op zand: de adapter zet op elke knoop van de plaatelementen een veer k·A_trib loodrecht op het plaatvlak (A_trib het tributaire oppervlak uit de elementen van die plaat). De grond ligt aan de onderzijde: tegen de plaatnormaal in (de z-as van de plaatassen; bij een vloer globaal −Z). Bij een wand legt de assenafspraak de grondzijde vast, los van de knoopvolgorde, en is zij niet te kiezen: een wand in het XZ-vlak heeft de grond aan +Y, een wand in het YZ-vlak aan −X (de diagnostics noemen haar). Ligt de grond aan de andere kant, dan zijn zakking en gronddruk van teken omgekeerd en is compressionOnly niet bruikbaar. Het resultaat geeft per plaat op bedding de zakking en de gronddruk per knoop in `plateBedding`; de grondveren staan niet bij de oplegreacties.",
        "properties": {
            "kKnPerM3": { "type": "number", "exclusiveMinimum": 0,
                "description": "Beddingsconstante k in kN/m³, loodrecht op het plaatvlak." },
            "compressionOnly": { "type": "boolean", "default": false,
                "description": "Alleen druk: de veren vallen weg waar de plaat van de grond loskomt (de grond trekt niet)." }
        }
    })
}

/// Strikt schema voor het neutrale Open FEM 3D-contract.
pub(super) fn tool_definitions() -> Vec<Value> {
    vec![json!({
        "name": TOOL,
        "description": "Analyseer een ruimtelijk 3D-model (staven en vlakke platen) met de vastgezette externe 3D-kern. Staven: standaard directe tweede orde (P-Delta); de adapter itereert daarbij zelf met een verse factorisatie per iteratie en bepaalt de eerste knikfactor alpha_cr (stabiliteitspoort; EN 1993-1-1 5.2.1 vraagt alpha_cr >= 10 voor eerste orde). Trek-alleen staven (tensionOnly) vallen per berekening weg zolang ze op druk staan; staven op bedding (bedding: Winkler-veren k·b over de lengte, optioneel zijdelings en alleen druk) geven per staaf de zakking en gronddruk terug; platen op bedding (plates[].bedding: veren k·A_trib loodrecht op de plaat, optioneel alleen druk) per plaat de zakking en gronddruk per knoop (plateBedding); verlopende staven (partSectionIds) rekenen in gelijke delen met elk hun eigen doorsnede en komen als één staaf terug; starre schijven (diaphragms) koppelen X, Y en de rotatie om Z van knopen op één hoogte. Met tensionOnlyFit worden trek-alleen staven gemonteerd onder opgegeven montagelasten (spanningsloze lengte L + Δ0); tensionOnlyCrossRule houdt van elk kruis van twee trek-alleen staven er één actief. Platen (contractversie 2): vierhoekige MITC4-schaalelementen per plaat (plates + shellElements), vlaklasten in globale assen (surfaceLoads) en staven die via intermediateNodeIds aan plaatknopen hangen; een model met platen rekent alleen lineair (analysis: linear). Het resultaat bevat knoopverplaatsingen, oplegreacties, zes snedekrachten per staaf, convergentie, eigenwaarde-knikfactoren, de inactieve trek-alleen staven (inactiveMembers) en per plaat momenten, membraan- en dwarskrachten en spanningen boven/onder in plaatassen. Eenheden: m, kN, kNm en MPa. Tekenafspraak: verplaatsingen, rotaties, knooplasten en reacties in globale rechtshandige assen X, Y, Z (Z omhoog), momenten en rotaties positief volgens de rechterhandregel om de positieve as; staafkrachten in de lokale staafassen van de 3D-kern (x van begin- naar eindknoop), met V_z = dM_y/dx. Dit wijkt af van solve_fem_model (2D): daar zijn reactiemomenten en rotaties positief tegen de klok in gezien met x naar rechts en z omhoog, dus voor een model in het XZ-vlak is M_y/r_y hier tegengesteld (portaal: reactie M_y 2D +11,03 kNm, 3D −11,03 kNm), en de staafmomenten kunnen door de andere lokale assen ook van teken verschillen (zelfde absolute waarden).",
        "inputSchema": {
            "type": "object",
            "additionalProperties": false,
            "required": ["nodes", "materials"],
            "properties": {
                "schemaVersion": { "type": "integer", "enum": [1, 2], "default": 2, "description": "2 is nodig voor platen, vlaklasten en tussenknopen; 1 is een zuiver staafmodel." },
                "analysis": { "type": "string", "enum": ["linear", "p-delta"], "default": "p-delta" },
                "nodes": {
                    "type": "array", "minItems": 2,
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "x", "y", "z"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "x": vector_schema(), "y": vector_schema(), "z": vector_schema()
                        }
                    }
                },
                "materials": {
                    "type": "array", "minItems": 1,
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "name", "eMpa", "nu"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "name": { "type": "string", "minLength": 1 },
                            "eMpa": { "type": "number", "exclusiveMinimum": 0 },
                            "nu": { "type": "number", "exclusiveMinimum": -1, "exclusiveMaximum": 0.5 },
                            "gMpa": { "type": ["number", "null"], "exclusiveMinimum": 0, "description": "Onafhankelijke schuifmodulus in MPa, bijvoorbeeld G_mean van hout; de adapter houdt G·J en G·As gelijk." },
                            "alphaPerK": { "type": ["number", "null"], "exclusiveMinimum": 0, "description": "Lineaire uitzettingscoëfficiënt in 1/K; standaard 12e-6." }
                        }
                    }
                },
                "sections": {
                    "type": "array", "default": [],
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "name", "areaM2", "iyM4", "izM4", "torsionJM4"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "name": { "type": "string", "minLength": 1 },
                            "areaM2": { "type": "number", "exclusiveMinimum": 0 },
                            "iyM4": { "type": "number", "exclusiveMinimum": 0 },
                            "izM4": { "type": "number", "exclusiveMinimum": 0 },
                            "torsionJM4": { "type": "number", "exclusiveMinimum": 0 },
                            "shearAreaYM2": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "shearAreaZM2": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "heightM": { "type": ["number", "null"], "exclusiveMinimum": 0, "description": "Real section depth along local z in m (e.g. 0.300 for IPE300); required for a temperature gradient deltaTGradientZK." },
                            "widthM": { "type": ["number", "null"], "exclusiveMinimum": 0, "description": "Real section width along local y in m; required for a temperature gradient deltaTGradientYK." }
                        }
                    }
                },
                "members": {
                    "type": "array", "default": [],
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "startNodeId", "endNodeId", "materialId", "sectionId"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "startNodeId": { "type": "integer", "minimum": 1 },
                            "endNodeId": { "type": "integer", "minimum": 1 },
                            "materialId": { "type": "integer", "minimum": 1 },
                            "sectionId": { "type": "integer", "minimum": 1 },
                            "partSectionIds": {
                                "type": "array", "minItems": 2, "maxItems": 64,
                                "description": "Verlopende staaf (issue #73): de staaf in n GELIJKE delen langs haar lengte, n = de lengte van deze lijst (2 ≤ n ≤ 64); deel i (vanaf de beginknoop) rekent met doorsnede partSectionIds[i] (ids uit sections). sectionId blijft de doorsnede van het begin. De adapter knipt de staaf op de deelgrenzen (samen met tussenknopen, bedding en globale lasten) en voegt krachten, snedekrachtlijnen, knikgegevens en resultaten weer samen tot de ene staaf; staaflasten houden hun plaats langs de hele staaf. Ontbreekt het veld, dan is de staaf prismatisch.",
                                "items": { "type": "integer", "minimum": 1 }
                            },
                            "rollAngleRad": { "type": ["number", "null"] },
                            "intermediateNodeIds": {
                                "type": "array", "default": [],
                                "description": "Knopen op de staafas tussen begin en eind (bijv. randknopen van een plaat langs de staaf). De staaf wordt daar voor de kern geknipt en in het resultaat weer één staaf.",
                                "items": { "type": "integer", "minimum": 1 }
                            },
                            "tensionOnly": {
                                "type": "boolean", "default": false,
                                "description": "Trek-alleen: de staaf doet alleen mee zolang zij niet op druk staat. Komt zij in deze berekening op druk, dan valt zij weg (normaalkracht 0) en staat zij in inactiveMembers; haar staaflasten gaan statisch gelijkwaardig naar de eindknopen."
                            },
                            "bedding": bedding_schema(),
                            "releases": {
                                "type": "object", "additionalProperties": false,
                                "properties": {
                                    "myStart": { "type": "boolean", "default": false },
                                    "myEnd": { "type": "boolean", "default": false },
                                    "mzStart": { "type": "boolean", "default": false },
                                    "mzEnd": { "type": "boolean", "default": false },
                                    "torsionStart": { "type": "boolean", "default": false },
                                    "torsionEnd": { "type": "boolean", "default": false }
                                }
                            }
                        }
                    }
                },
                "supports": {
                    "type": "array", "default": [],
                    "description": "Knoopopleggingen; true betekent geblokkeerd. Veren zijn kN/m of kNm/rad. Optionele opgelegde translaties zijn m en rotaties rad en vereisen een geblokkeerde DOF.",
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["nodeId", "ux", "uy", "uz", "rx", "ry", "rz"],
                        "properties": {
                            "nodeId": { "type": "integer", "minimum": 1 },
                            "ux": { "type": "boolean" }, "uy": { "type": "boolean" }, "uz": { "type": "boolean" },
                            "rx": { "type": "boolean" }, "ry": { "type": "boolean" }, "rz": { "type": "boolean" },
                            "kxKnPerM": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "kyKnPerM": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "kzKnPerM": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "krxKnmPerRad": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "kryKnmPerRad": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "krzKnmPerRad": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "uxPrescribedM": { "type": ["number", "null"] },
                            "uyPrescribedM": { "type": ["number", "null"] },
                            "uzPrescribedM": { "type": ["number", "null"] },
                            "rxPrescribedRad": { "type": ["number", "null"] },
                            "ryPrescribedRad": { "type": ["number", "null"] },
                            "rzPrescribedRad": { "type": ["number", "null"] }
                        }
                    }
                },
                "nodalLoads": nodal_loads_schema(),
                "memberLoads": member_loads_schema(),
                "memberPointLoads": member_point_loads_schema(),
                "thermalLoads": thermal_loads_schema(),
                "plates": {
                    "type": "array", "default": [],
                    "description": "Vlakke platen: dikte in m en een isotroop materiaal, of met orthotropy een orthotrope stijfheid in plaatassen. De elementen van een plaat liggen in één vlak.",
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "materialId", "thicknessM"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "materialId": { "type": "integer", "minimum": 1 },
                            "thicknessM": { "type": "number", "exclusiveMinimum": 0 },
                            "bedding": plate_bedding_schema(),
                            "orthotropy": plate_orthotropy_schema()
                        }
                    }
                },
                "shellElements": {
                    "type": "array", "default": [],
                    "description": "Vierhoekige, vlakke en convexe MITC4-plaatelementen; vier knopen rondgaand. Driehoeken worden geweigerd (meshen als drie vierhoeken).",
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "plateId", "nodeIds"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "plateId": { "type": "integer", "minimum": 1 },
                            "nodeIds": { "type": "array", "minItems": 4, "maxItems": 4, "items": { "type": "integer", "minimum": 1 } }
                        }
                    }
                },
                "surfaceLoads": surface_loads_schema(),
                "diaphragms": {
                    "type": "array", "default": [],
                    "description": "Starre schijven in het horizontale vlak: X, Y en de rotatie om Z van alle knopen bewegen als één star lichaam; Z en de rotaties om X en Y blijven per knoop vrij. Alle knopen binnen 1 mm op dezelfde hoogte, minstens twee knopen, een knoop in hoogstens één schijf, en hoogstens één knoop die de schijf in haar vlak (X, Y of rotatie om Z) vasthoudt.",
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "nodeIds"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "nodeIds": { "type": "array", "minItems": 2, "items": { "type": "integer", "minimum": 1 } }
                        }
                    }
                },
                "nodeLinks": {
                    "type": "array", "default": [],
                    "description": "Knoopkoppelingen (#97): de slaafknoop volgt de meesterknoop in de gekozen globale vrijheidsgraden (EqualDOF). Beide knopen liggen op dezelfde plek (binnen 1e-6 m), minstens één vrijheidsgraad, een slaaf heeft één meester en is zelf geen meester, zit in geen schijf en is in de gekoppelde vrijheidsgraden niet opgelegd. Voorbeeld: een latei die het metselwerk boven een opening alleen verticaal en loodrecht op de wand draagt, zonder de penanten horizontaal te koppelen.",
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "masterNodeId", "slaveNodeId"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "masterNodeId": { "type": "integer", "minimum": 1 },
                            "slaveNodeId": { "type": "integer", "minimum": 1 },
                            "ux": { "type": "boolean", "default": false },
                            "uy": { "type": "boolean", "default": false },
                            "uz": { "type": "boolean", "default": false },
                            "rx": { "type": "boolean", "default": false },
                            "ry": { "type": "boolean", "default": false },
                            "rz": { "type": "boolean", "default": false }
                        }
                    }
                },
                "tensionOnlyFit": {
                    "type": "object", "additionalProperties": false,
                    "description": "Montagelasten van de trek-alleen staven: de lasten die al op het frame staan als de verbanden gemonteerd worden (bijvoorbeeld de permanente belasting, factor 1). Elke trek-alleen staaf krijgt dan de spanningsloze lengte L + Δ0, met Δ0 de verlenging van haar koorde onder deze lasten, gepast tot de verbanden onder alleen deze lasten niets dragen (wat het frame zonder verbanden niet kan dragen, blijft in de verbanden). Zelfde vorm en keuring als de gewone lasten; opgelegde verplaatsingen doen niet mee. Het resultaat geeft Δ0 per staaf in tensionOnlyFit (memberId, deltaMm). Ontbreekt het veld, dan zijn de staven spanningsloos in de onvervormde stand.",
                    "properties": {
                        "nodalLoads": nodal_loads_schema(),
                        "memberLoads": member_loads_schema(),
                        "memberPointLoads": member_point_loads_schema(),
                        "thermalLoads": thermal_loads_schema(),
                        "surfaceLoads": surface_loads_schema()
                    }
                },
                "tensionOnlyCrossRule": {
                    "type": "boolean", "default": false,
                    "description": "Kruisregel: twee trek-alleen staven die elkaar in hun inwendige snijden (assen binnen 1 mm, geen gedeelde eindknoop) vormen een kruis; van elk kruis blijft altijd de staaf met de grootste normaalkracht actief, ook met een kleine drukkracht. Drie of meer staven door één punt tellen niet. Het resultaat noemt die staven in crossRuleMembers."
                },
                "maxIterations": { "type": "integer", "minimum": 1, "maximum": 1000, "default": 50 },
                "tolerance": { "type": "number", "exclusiveMinimum": 0, "default": 1e-8 },
                "bucklingModes": { "type": "integer", "minimum": 0, "maximum": 20, "default": 3 }
            }
        }
    })]
}

pub(super) async fn dispatch(name: &str, args: Value) -> Result<Value, RpcError> {
    if name != TOOL {
        return Err(RpcError::method_not_found(name));
    }
    let request: open_fem_3d::SolveRequest3D = serde_json::from_value(args)
        .map_err(|error| RpcError::invalid_params(format!("SolveRequest3D: {error}")))?;
    let result = tokio::task::spawn_blocking(move || open_fem_3d::solve(request))
        .await
        .map_err(|error| RpcError::tool_exec(format!("3D-kern kon niet worden afgerond: {error}")))?
        .map_err(RpcError::tool_exec)?;
    serde_json::to_value(result)
        .map_err(|error| RpcError::tool_exec(format!("3D-resultaat kon niet naar JSON: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_biedt_staafpuntlast_met_lokale_componenten_en_positie() {
        let definition = &tool_definitions()[0];
        let point = &definition["inputSchema"]["properties"]["memberPointLoads"];
        assert_eq!(point["type"], "array");
        assert_eq!(point["items"]["additionalProperties"], false);
        assert_eq!(point["items"]["required"], json!(["id", "memberId", "pyKn", "pzKn", "positionM"]));
        let support = &definition["inputSchema"]["properties"]["supports"]["items"];
        assert_eq!(support["properties"]["kzKnPerM"]["exclusiveMinimum"], 0);
        assert_eq!(support["properties"]["kryKnmPerRad"]["type"], json!(["number", "null"]));
        assert_eq!(support["properties"]["uxPrescribedM"]["type"], json!(["number", "null"]));
        assert_eq!(support["properties"]["rzPrescribedRad"]["type"], json!(["number", "null"]));
        let thermal = &definition["inputSchema"]["properties"]["thermalLoads"]["items"];
        assert_eq!(thermal["additionalProperties"], false);
        assert_eq!(thermal["required"], json!(["id", "memberId", "deltaTUniformK"]));
        assert_eq!(definition["inputSchema"]["properties"]["materials"]["items"]["properties"]["alphaPerK"]["exclusiveMinimum"], 0);
        assert_eq!(definition["inputSchema"]["properties"]["materials"]["items"]["properties"]["gMpa"]["exclusiveMinimum"], 0);
    }

    /// Issue #197: de MCP-weg geeft het verzoek rechtstreeks aan de kern; een
    /// afschuifoppervlak van nul wordt daar geweigerd met de doorsnede erbij,
    /// niet als "mechanisme" door een singuliere matrix.
    #[tokio::test]
    async fn afschuifoppervlak_nul_wordt_geweigerd() {
        let verzoek = |av: f64| json!({
            "schemaVersion": 2,
            "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 2, "y": 0, "z": 0 }],
            "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
            "sections": [{ "id": 1, "name": "a", "areaM2": 0.01, "iyM4": 8e-6, "izM4": 8e-6, "torsionJM4": 5e-6,
                "shearAreaYM2": av, "shearAreaZM2": 0.001 }],
            "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1 }],
            "supports": [{ "nodeId": 1, "ux": true, "uy": true, "uz": true, "rx": true, "ry": true, "rz": true }],
            "nodalLoads": [{ "id": 1, "nodeId": 2, "fx": 0, "fy": 0, "fz": -10, "mx": 0, "my": 0, "mz": 0 }]
        });
        let fout = dispatch(TOOL, verzoek(0.0)).await.expect_err("Av,y = 0 hoort geweigerd te worden");
        let tekst = format!("{fout:?}");
        assert!(tekst.contains("Av,y") && tekst.contains("doorsnede 1"), "{tekst}");
        dispatch(TOOL, verzoek(0.001)).await.expect("een geldige Av,y rekent");
    }

    #[test]
    fn schema_biedt_platen_strikt_aan() {
        let definition = &tool_definitions()[0];
        let properties = &definition["inputSchema"]["properties"];
        for field in ["plates", "shellElements", "surfaceLoads"] {
            assert_eq!(properties[field]["items"]["additionalProperties"], false, "{field}");
        }
        assert_eq!(properties["plates"]["items"]["required"], json!(["id", "materialId", "thicknessM"]));
        assert_eq!(properties["shellElements"]["items"]["properties"]["nodeIds"]["minItems"], 4);
        assert_eq!(properties["shellElements"]["items"]["properties"]["nodeIds"]["maxItems"], 4);
        assert_eq!(
            properties["surfaceLoads"]["items"]["required"],
            json!(["id", "plateId", "qxKnPerM2", "qyKnPerM2", "qzKnPerM2"]),
        );
        assert_eq!(properties["members"]["items"]["properties"]["intermediateNodeIds"]["type"], "array");
        assert_eq!(properties["schemaVersion"]["enum"], json!([1, 2]));
    }

    #[test]
    fn schema_kent_trek_alleen_en_starre_schijven_strikt() {
        let definition = &tool_definitions()[0];
        let member = &definition["inputSchema"]["properties"]["members"]["items"];
        assert_eq!(member["properties"]["tensionOnly"]["type"], "boolean");
        assert_eq!(member["properties"]["tensionOnly"]["default"], false);
        let diaphragm = &definition["inputSchema"]["properties"]["diaphragms"];
        assert_eq!(diaphragm["type"], "array");
        assert_eq!(diaphragm["items"]["additionalProperties"], false);
        assert_eq!(diaphragm["items"]["required"], json!(["id", "nodeIds"]));
        assert_eq!(diaphragm["items"]["properties"]["nodeIds"]["minItems"], 2);
        // Het schema en het contract van de kern horen dezelfde velden te kennen.
        let request: open_fem_3d::SolveRequest3D = serde_json::from_value(json!({
            "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 1, "y": 0, "z": 0 }],
            "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
            "sections": [{ "id": 1, "name": "a", "areaM2": 0.01, "iyM4": 1e-5, "izM4": 1e-5, "torsionJM4": 1e-5 }],
            "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1, "tensionOnly": true }],
            "diaphragms": [{ "id": 1, "nodeIds": [1, 2] }]
        })).expect("tensionOnly en diaphragms horen in het contract");
        assert!(request.members[0].tension_only);
        assert_eq!(request.diaphragms[0].node_ids, vec![1, 2]);
        let tikfout = serde_json::from_value::<open_fem_3d::SolveRequest3D>(json!({
            "nodes": [], "materials": [], "sections": [], "members": [],
            "diaphragms": [{ "id": 1, "nodeId": [1, 2] }]
        }));
        assert!(tikfout.is_err(), "een tikfout in een schijfveld hoort geweigerd te worden");
    }

    /// Orthotrope plaat (#79, #97): strikt object, drie stijfheden verplicht;
    /// de kern leest het veld en weigert een tikfout.
    #[test]
    fn schema_kent_orthotrope_plaat_strikt() {
        let definition = &tool_definitions()[0];
        let schema = &definition["inputSchema"]["properties"]["plates"]["items"]["properties"]["orthotropy"];
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["required"], json!(["eXMpa", "eYMpa", "gXyMpa"]));
        let velden: Vec<&str> = schema["properties"].as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(velden.len(), 6);
        let plaat = |orthotropy: Value| json!({
            "schemaVersion": 2, "analysis": "linear",
            "nodes": [], "materials": [],
            "plates": [{ "id": 1, "materialId": 1, "thicknessM": 0.1, "orthotropy": orthotropy }]
        });
        let gelezen = serde_json::from_value::<open_fem_3d::SolveRequest3D>(
            plaat(json!({ "eXMpa": 0.005, "eYMpa": 5000, "gXyMpa": 2000 }))).unwrap();
        let o = gelezen.plates[0].orthotropy.as_ref().unwrap();
        assert_eq!((o.e_x_mpa, o.e_y_mpa, o.g_xy_mpa, o.nu_xy, o.g_xz_mpa), (0.005, 5000.0, 2000.0, 0.0, None));
        assert!(serde_json::from_value::<open_fem_3d::SolveRequest3D>(
            plaat(json!({ "eXMpa": 1, "eYMpa": 5000, "gxyMpa": 2000 }))).is_err());
    }

    /// Knoopkoppelingen (#97): strikt; de kern leest ze en weigert een tikfout.
    #[test]
    fn schema_kent_knoopkoppelingen_strikt() {
        let definition = &tool_definitions()[0];
        let item = &definition["inputSchema"]["properties"]["nodeLinks"]["items"];
        assert_eq!(item["additionalProperties"], false);
        assert_eq!(item["required"], json!(["id", "masterNodeId", "slaveNodeId"]));
        let gelezen = serde_json::from_value::<open_fem_3d::SolveRequest3D>(json!({
            "nodes": [], "materials": [],
            "nodeLinks": [{ "id": 1, "masterNodeId": 1, "slaveNodeId": 2, "uz": true }]
        })).unwrap();
        assert!(gelezen.node_links[0].uz && !gelezen.node_links[0].ux);
        assert!(serde_json::from_value::<open_fem_3d::SolveRequest3D>(json!({
            "nodes": [], "materials": [], "nodeLinks": [{ "id": 1, "masterNode": 1, "slaveNodeId": 2 }]
        })).is_err());
    }

    /// Staaf op bedding (#106): strikt object met widthM verplicht, de vier
    /// velden van het contract; de kern leest het veld en weigert een tikfout.
    #[test]
    fn schema_kent_staaf_op_bedding_strikt() {
        let definition = &tool_definitions()[0];
        let bedding = &definition["inputSchema"]["properties"]["members"]["items"]["properties"]["bedding"];
        assert_eq!(bedding["type"], "object");
        assert_eq!(bedding["additionalProperties"], false);
        assert_eq!(bedding["required"], json!(["widthM"]));
        let velden: Vec<&str> = bedding["properties"].as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(velden.len(), 4);
        for veld in ["kKnPerM3", "widthM", "kLateralKnPerM3", "compressionOnly"] {
            assert!(velden.contains(&veld), "{veld}");
        }
        for veld in ["kKnPerM3", "widthM", "kLateralKnPerM3"] {
            assert_eq!(bedding["properties"][veld]["exclusiveMinimum"], 0, "{veld}");
        }
        assert_eq!(bedding["properties"]["compressionOnly"]["default"], false);
        let verzoek = json!({
            "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 6, "y": 0, "z": 0 }],
            "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
            "sections": [{ "id": 1, "name": "a", "areaM2": 0.01, "iyM4": 1e-5, "izM4": 1e-5, "torsionJM4": 1e-5 }],
            "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1,
                "bedding": { "kKnPerM3": 50000, "widthM": 0.6, "compressionOnly": true } }]
        });
        let gelezen = serde_json::from_value::<open_fem_3d::SolveRequest3D>(verzoek)
            .unwrap_or_else(|fout| panic!("bedding hoort in het contract: {fout}"));
        let bedding = gelezen.members[0].bedding.as_ref().expect("bedding gelezen");
        assert_eq!((bedding.k_kn_per_m3, bedding.width_m, bedding.compression_only), (Some(50000.0), 0.6, true));
        let tikfout = serde_json::from_value::<open_fem_3d::SolveRequest3D>(json!({
            "nodes": [], "materials": [], "sections": [],
            "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1,
                "bedding": { "kKnPerm3": 50000, "widthM": 0.6 } }]
        }));
        assert!(tikfout.is_err(), "een tikfout in een beddingveld hoort geweigerd te worden");
    }

    /// Verlopende staaf (#73): `partSectionIds` is een lijst van 2 tot 64
    /// doorsnede-id's (gehele getallen ≥ 1); de kern leest het veld.
    #[test]
    fn schema_kent_verlopende_staaf_strikt() {
        let definition = &tool_definitions()[0];
        let delen = &definition["inputSchema"]["properties"]["members"]["items"]["properties"]["partSectionIds"];
        assert_eq!(delen["type"], "array");
        assert_eq!((delen["minItems"].clone(), delen["maxItems"].clone()), (json!(2), json!(64)));
        assert_eq!(delen["items"], json!({ "type": "integer", "minimum": 1 }));
        assert!(delen["description"].as_str().unwrap().contains("GELIJKE delen"));
        let gelezen = serde_json::from_value::<open_fem_3d::SolveRequest3D>(json!({
            "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 6, "y": 0, "z": 0 }],
            "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
            "sections": [
                { "id": 1, "name": "a", "areaM2": 0.01, "iyM4": 1e-4, "izM4": 1e-5, "torsionJM4": 1e-6 },
                { "id": 2, "name": "b", "areaM2": 0.008, "iyM4": 6e-5, "izM4": 8e-6, "torsionJM4": 8e-7 }
            ],
            "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1, "partSectionIds": [1, 2] }]
        })).unwrap_or_else(|fout| panic!("partSectionIds hoort in het contract: {fout}"));
        assert_eq!(gelezen.members[0].part_section_ids.as_deref(), Some(&[1usize, 2][..]));
    }

    /// Plaat op bedding (#107): strikt object met kKnPerM3 verplicht en de
    /// twee velden van het contract. De kern leest het veld en weigert een
    /// tikfout.
    #[test]
    fn schema_kent_plaat_op_bedding_strikt() {
        let definition = &tool_definitions()[0];
        let bedding = &definition["inputSchema"]["properties"]["plates"]["items"]["properties"]["bedding"];
        assert_eq!(bedding["type"], "object");
        assert_eq!(bedding["additionalProperties"], false);
        assert_eq!(bedding["required"], json!(["kKnPerM3"]));
        let velden: Vec<&str> = bedding["properties"].as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(velden.len(), 2);
        assert!(velden.contains(&"kKnPerM3") && velden.contains(&"compressionOnly"));
        assert_eq!(bedding["properties"]["kKnPerM3"]["exclusiveMinimum"], 0);
        assert_eq!(bedding["properties"]["compressionOnly"]["default"], false);
        assert_eq!(definition["inputSchema"]["properties"]["plates"]["items"]["required"], json!(["id", "materialId", "thicknessM"]),
            "bedding blijft optioneel");
        let verzoek = |bedding: Value| json!({
            "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }],
            "materials": [{ "id": 1, "name": "C30/37", "eMpa": 33000, "nu": 0.2 }],
            "sections": [], "members": [],
            "plates": [{ "id": 1, "materialId": 1, "thicknessM": 0.25, "bedding": bedding }]
        });
        let gelezen = serde_json::from_value::<open_fem_3d::SolveRequest3D>(verzoek(json!({ "kKnPerM3": 20000, "compressionOnly": true })))
            .unwrap_or_else(|fout| panic!("plates[].bedding hoort in het contract: {fout}"));
        let bedding = gelezen.plates[0].bedding.as_ref().expect("de kern leest de bedding");
        assert!(bedding.k_kn_per_m3 == 20000.0 && bedding.compression_only);
        let tikfout = serde_json::from_value::<open_fem_3d::SolveRequest3D>(verzoek(json!({ "kKnPerm3": 20000 })));
        assert!(tikfout.is_err(), "een tikfout in een plaatbeddingveld hoort geweigerd te worden");
    }

    /// Globale lijnlast (#80): globalDirection (x, y, z), qStartKnPerM,
    /// qEndKnPerM en perProjection; de lokale qy/qz zijn niet meer verplicht
    /// (ontbreekt = 0). Het contract van de kern leest een globale last en
    /// weigert een tikfout.
    #[test]
    fn schema_kent_globale_lijnlast_strikt() {
        let definition = &tool_definitions()[0];
        let items = &definition["inputSchema"]["properties"]["memberLoads"]["items"];
        assert_eq!(items["additionalProperties"], false);
        assert_eq!(items["required"], json!(["id", "memberId"]));
        assert_eq!(items["properties"]["globalDirection"]["enum"], json!(["x", "y", "z"]));
        assert_eq!(items["properties"]["qStartKnPerM"]["type"], "number");
        assert_eq!(items["properties"]["qEndKnPerM"]["type"], "number");
        assert_eq!(items["properties"]["perProjection"]["type"], "boolean");
        assert_eq!(items["properties"]["perProjection"]["default"], false);
        for veld in ["qyStartKnPerM", "qyEndKnPerM", "qzStartKnPerM", "qzEndKnPerM"] {
            assert_eq!(items["properties"][veld]["default"], 0, "{veld}");
        }
        let verzoek = |last: Value| json!({
            "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 4, "y": 0, "z": 3 }],
            "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
            "sections": [{ "id": 1, "name": "a", "areaM2": 0.01, "iyM4": 1e-5, "izM4": 1e-5, "torsionJM4": 1e-5 }],
            "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1 }],
            "memberLoads": [last]
        });
        let globaal = json!({ "id": 1, "memberId": 1, "globalDirection": "z", "qStartKnPerM": -2, "qEndKnPerM": -2,
            "perProjection": true, "startPositionM": 0, "endPositionM": 5 });
        let gelezen = serde_json::from_value::<open_fem_3d::SolveRequest3D>(verzoek(globaal))
            .unwrap_or_else(|fout| panic!("een globale lijnlast hoort in het contract: {fout}"));
        assert_eq!(gelezen.member_loads.len(), 1);
        assert_eq!(gelezen.member_loads[0].global_direction, Some(open_fem_3d::GlobalDirection3D::Z));
        assert!(gelezen.member_loads[0].per_projection);
        let tikfout = serde_json::from_value::<open_fem_3d::SolveRequest3D>(verzoek(json!({
            "id": 1, "memberId": 1, "globalDirecton": "z", "qStartKnPerM": -2, "qEndKnPerM": -2
        })));
        assert!(tikfout.is_err(), "een tikfout in een lastveld hoort geweigerd te worden");
    }

    #[test]
    fn schema_kent_montagelasten_en_kruisregel_strikt() {
        let definition = &tool_definitions()[0];
        let properties = &definition["inputSchema"]["properties"];
        let fit = &properties["tensionOnlyFit"];
        assert_eq!(fit["type"], "object");
        assert_eq!(fit["additionalProperties"], false);
        // Dezelfde vorm als de gewone lasten.
        for field in ["nodalLoads", "memberLoads", "memberPointLoads", "thermalLoads", "surfaceLoads"] {
            assert_eq!(fit["properties"][field], properties[field], "{field}");
            assert_eq!(fit["properties"][field]["items"]["additionalProperties"], false, "{field}");
        }
        assert_eq!(properties["tensionOnlyCrossRule"]["type"], "boolean");
        assert_eq!(properties["tensionOnlyCrossRule"]["default"], false);
        let request: open_fem_3d::SolveRequest3D = serde_json::from_value(json!({
            "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 1, "y": 0, "z": 0 }],
            "materials": [{ "id": 1, "name": "S235", "eMpa": 210000, "nu": 0.3 }],
            "tensionOnlyFit": { "nodalLoads": [{ "id": 1, "nodeId": 2, "fx": 0, "fy": 0, "fz": -1, "mx": 0, "my": 0, "mz": 0 }] },
            "tensionOnlyCrossRule": true
        })).expect("tensionOnlyFit en tensionOnlyCrossRule horen in het contract");
        assert_eq!(request.tension_only_fit.unwrap().nodal_loads.len(), 1);
        assert!(request.tension_only_cross_rule);
        let tikfout = serde_json::from_value::<open_fem_3d::SolveRequest3D>(json!({
            "nodes": [], "materials": [], "tensionOnlyFit": { "nodalLoad": [] }
        }));
        assert!(tikfout.is_err(), "een tikfout in de montagelasten hoort geweigerd te worden");
    }
}
