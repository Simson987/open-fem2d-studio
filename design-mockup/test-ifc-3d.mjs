// IFC4 3D-export: reconstruct geometry and node conditions from the written
// SPF graph, including references, rather than matching only text fragments.
import assert from "node:assert/strict";
import { serializeProject, deserializeProject, PROJECT_FORMAT_VERSION_3D } from "./src/io/projectFile.ts";
import {
  bouwIfcRekenmodel, bouwIfcBoom, valideerIfc, verzamelIfcBeperkingen,
} from "./src/io/ifcExport.ts";

const model3d = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 4, y: 2, z: 3 },
    { id: 3, x: 4, y: 2, z: 6 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2 },
    { id: 2, startNodeId: 2, endNodeId: 3, rollAngleRad: Math.PI / 2,
      releases: {
        myStart: true, myEnd: true, mzStart: true, mzEnd: true,
        torsionStart: false, torsionEnd: false,
      } },
  ],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
    { nodeId: 2, ux: false, uy: false, uz: false, rx: false, ry: false, rz: false,
      springs: { kzKnPerM: 1250 } },
    { nodeId: 3, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false,
      prescribed: { uxM: 0.001, uyM: -0.002 } },
  ],
  loads: [
    { id: 1, nodeId: 2, caseId: 1, fx: 5, fy: -2, fz: -10, mx: 1.5, my: -3, mz: 0.25 },
  ],
  memberLoads: [
    { id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: -4, qzEnd: -4, startPositionM: 0, endPositionM: Math.sqrt(29) },
    { id: 2, beamId: 2, caseId: 2, qyStart: 1, qyEnd: 2, qzStart: -3, qzEnd: -5, startPositionM: 0.5, endPositionM: 2.5 },
  ],
  memberPointLoads: [
    { id: 1, beamId: 1, caseId: 2, py: 3, pz: -12, positionM: 2.5 },
  ],
  thermalLoads: [
    { id: 1, beamId: 2, caseId: 1, deltaTUniformK: 25, deltaTGradientYK: 4, deltaTGradientZK: -6 },
  ],
};
const project = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 5000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "HEA160" }],
  supports: [{ nodeId: 1, type: "fixed" }],
  plates: [], loads: [], loadCases: [
    { id: 1, name: "Permanent", type: "dead" },
    { id: 2, name: "Variabel", type: "live" },
  ], activeLoadCaseId: 1,
  selfWeightEnabled: false, nonlinearEnabled: false,
  model3d,
};
const reopened = deserializeProject(serializeProject(project));
assert.equal(reopened.version, PROJECT_FORMAT_VERSION_3D);
assert.deepEqual(reopened.model3d, model3d);
assert.deepEqual(reopened.nodes, project.nodes);
assert.deepEqual(reopened.supports, project.supports);

const input = { ...reopened, projectNaam: "Gemengd 2D/3D" };
const ifc = bouwIfcRekenmodel(input);
assert.deepEqual(valideerIfc(ifc).fouten, []);
assert.equal(bouwIfcRekenmodel(input), ifc, "3D IFC export must be deterministic");
assert.ok(!ifc.includes("NaN") && !ifc.includes("undefined"));

function splitArgs(body) {
  const result = [];
  let start = 0, depth = 0, quoted = false;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "'") {
      if (quoted && body[i + 1] === "'") { i++; continue; }
      quoted = !quoted;
    } else if (!quoted && char === "(") depth++;
    else if (!quoted && char === ")") depth--;
    else if (!quoted && depth === 0 && char === ",") {
      result.push(body.slice(start, i));
      start = i + 1;
    }
  }
  result.push(body.slice(start));
  return result;
}
const entities = new Map();
for (const [, id, type, body] of ifc.matchAll(/^#(\d+)=([A-Z0-9_]+)\((.*)\);$/gm)) {
  entities.set(Number(id), { type, args: splitArgs(body) });
}
const refs = (text) => [...text.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
const ref = (text) => {
  const ids = refs(text);
  assert.equal(ids.length, 1, `expected one IFC reference: ${text}`);
  return ids[0];
};
const entity = (id, type) => {
  const item = entities.get(id);
  assert.equal(item?.type, type, `#${id} must be ${type}`);
  return item;
};
const ofType = (type) => [...entities.entries()]
  .filter(([, item]) => item.type === type);

// Attribute counts follow IFC4 EXPRESS inheritance order.
for (const [type, count] of Object.entries({
  IFCSTRUCTURALANALYSISMODEL: 10,
  IFCSTRUCTURALPOINTCONNECTION: 9,
  IFCSTRUCTURALCURVEMEMBER: 9,
  IFCSTRUCTURALSURFACEMEMBER: 9,
  IFCBOUNDARYNODECONDITION: 7,
  IFCSTRUCTURALLOADSINGLEFORCE: 7,
  IFCSTRUCTURALLOADTEMPERATURE: 4,
  IFCSTRUCTURALLOADSINGLEDISPLACEMENT: 7,
  IFCSTRUCTURALLOADPLANARFORCE: 4,
  IFCSTRUCTURALPOINTACTION: 10,
  IFCSTRUCTURALLINEARACTION: 12,
  IFCSTRUCTURALCURVEACTION: 12,
  IFCSTRUCTURALSURFACEACTION: 12,
  IFCRELCONNECTSSTRUCTURALMEMBER: 10,
  IFCRELCONNECTSSTRUCTURALACTIVITY: 6,
})) {
  assert.ok(ofType(type).every(([, item]) => item.args.length === count), `${type} attribute count`);
}

const analyses = ofType("IFCSTRUCTURALANALYSISMODEL");
assert.equal(analyses.length, 2, "mixed file has separate 2D and 3D analyses");
const [analysis3dId, analysis3d] = analyses.find(([, item]) => item.args[5] === ".LOADING_3D.") ?? [];
assert.ok(analysis3dId);
assert.equal(analysis3d.args[6], "$", "LOADING_3D omits OrientationOf2DPlane");
assert.ok(analyses.some(([, item]) => item.args[5] === ".IN_PLANE_LOADING_2D."));

const point = (connection) => {
  const shape = entity(ref(connection.args[6]), "IFCPRODUCTDEFINITIONSHAPE");
  const topo = entity(ref(shape.args[2]), "IFCTOPOLOGYREPRESENTATION");
  const vertexId = ref(topo.args[3]);
  const vertex = entity(vertexId, "IFCVERTEXPOINT");
  const coords = entity(ref(vertex.args[0]), "IFCCARTESIANPOINT").args[0]
    .slice(1, -1).split(",").map(Number);
  return { vertexId, coords };
};
const nodesById = new Map();
const nodeIdByVertex = new Map();
for (const [connectionId, connection] of ofType("IFCSTRUCTURALPOINTCONNECTION")) {
  const match = /^'3D-knoop (\d+)'$/.exec(connection.args[2]);
  if (!match) continue;
  const id = Number(match[1]);
  const { vertexId, coords } = point(connection);
  nodesById.set(id, { connectionId, coords, condition: connection.args[7] });
  nodeIdByVertex.set(vertexId, id);
}
assert.equal(ofType("IFCSTRUCTURALPOINTCONNECTION").length, 5);
assert.deepEqual([...nodesById].map(([id, item]) => ({ id, ...{
  x: item.coords[0], y: item.coords[1], z: item.coords[2],
} })), model3d.nodes);
const connection2d = ofType("IFCSTRUCTURALPOINTCONNECTION")
  .find(([, item]) => item.args[2] === "'Knoop 1'")[1];
assert.notEqual(connection2d.args[0], entity(nodesById.get(1).connectionId, "IFCSTRUCTURALPOINTCONNECTION").args[0],
  "same numeric node ID in 2D and 3D has a different GUID");

for (const support of model3d.supports) {
  const condition = entity(ref(nodesById.get(support.nodeId).condition), "IFCBOUNDARYNODECONDITION");
  assert.deepEqual(condition.args.slice(1),
    [
      [support.ux, support.springs?.kxKnPerM, "linear"], [support.uy, support.springs?.kyKnPerM, "linear"],
      [support.uz, support.springs?.kzKnPerM, "linear"], [support.rx, support.springs?.krxKnmPerRad, "rotational"],
      [support.ry, support.springs?.kryKnmPerRad, "rotational"], [support.rz, support.springs?.krzKnmPerRad, "rotational"],
    ].map(([fixed, stiffness, kind]) => fixed
      ? "IFCBOOLEAN(.T.)"
      : stiffness === undefined ? "IFCBOOLEAN(.F.)"
        : `${kind === "linear" ? "IFCLINEARSTIFFNESSMEASURE" : "IFCROTATIONALSTIFFNESSMEASURE"}(${stiffness * 1000}.)`));
}

const membersById = new Map();
for (const [memberId, member] of ofType("IFCSTRUCTURALCURVEMEMBER")) {
  const match = /^'3D-staaf (\d+)'$/.exec(member.args[2]);
  if (!match) continue;
  const shape = entity(ref(member.args[6]), "IFCPRODUCTDEFINITIONSHAPE");
  const topo = entity(ref(shape.args[2]), "IFCTOPOLOGYREPRESENTATION");
  const edge = entity(ref(topo.args[3]), "IFCEDGE");
  membersById.set(Number(match[1]), {
    memberId,
    startNodeId: nodeIdByVertex.get(ref(edge.args[0])),
    endNodeId: nodeIdByVertex.get(ref(edge.args[1])),
    predefinedType: member.args[7],
    axis: entity(ref(member.args[8]), "IFCDIRECTION").args[0],
  });
}
assert.equal(ofType("IFCSTRUCTURALCURVEMEMBER").length, 3);
assert.deepEqual([...membersById].map(([id, member]) => ({
  id, startNodeId: member.startNodeId, endNodeId: member.endNodeId,
})), model3d.beams.map(({ id, startNodeId, endNodeId }) => ({ id, startNodeId, endNodeId })));
const verticalAxis = membersById.get(2).axis.slice(1, -1).split(",").map(Number);
assert.ok(Math.abs(verticalAxis[0]) < 1e-12 && Math.abs(verticalAxis[1] - 1) < 1e-12 && Math.abs(verticalAxis[2]) < 1e-12,
  "vertical member's rolled axis is transverse");
assert.equal(membersById.get(2).predefinedType, ".PIN_JOINED_MEMBER.",
  "een staaf met beide lokale buigrotaties aan beide einden vrij wordt als pin-joined geschreven");
const connections3d = ofType("IFCRELCONNECTSSTRUCTURALMEMBER")
  .filter(([, rel]) => [...membersById.values()].some((member) => member.memberId === ref(rel.args[4])));
assert.equal(connections3d.length, 4, "each 3D member is connected at both ends");
const releasedConnections = connections3d.filter(([, relation]) =>
  ref(relation.args[4]) === membersById.get(2).memberId);
assert.ok(releasedConnections.every(([, relation]) => relation.args[6] !== "$"),
  "3D eindscharnieren zijn expliciete randvoorwaarden op beide IFC-verbindingen");
for (const [, relation] of releasedConnections) {
  const condition = entity(ref(relation.args[6]), "IFCBOUNDARYNODECONDITION");
  assert.deepEqual(condition.args.slice(1), [
    "IFCBOOLEAN(.T.)", "IFCBOOLEAN(.T.)", "IFCBOOLEAN(.T.)",
    "IFCBOOLEAN(.T.)", "IFCBOOLEAN(.F.)", "IFCBOOLEAN(.F.)",
  ]);
}

const assignment3d = ofType("IFCRELASSIGNSTOGROUP")
  .find(([, rel]) => rel.args[6] === `#${analysis3dId}`)[1];
assert.deepEqual(new Set(refs(assignment3d.args[4])), new Set([
  ...[...nodesById.values()].map((node) => node.connectionId),
  ...[...membersById.values()].map((member) => member.memberId),
]));

const loadGroupIds = refs(analysis3d.args[7]);
assert.equal(loadGroupIds.length, 3, "ieder 3D-belastinggeval en opgelegde verplaatsingen krijgen een IFC-loadgroep");
const loadGroupsByName = new Map(loadGroupIds.map((id) => {
  const group = entity(id, "IFCSTRUCTURALLOADGROUP");
  assert.equal(group.args[5], ".LOAD_CASE.");
  return [group.args[2], id];
}));
assert.deepEqual(new Set(loadGroupsByName.keys()), new Set(["'Permanent'", "'Variabel'", "'Opgelegde verplaatsingen'"]));
const assignedByGroup = new Map([...loadGroupsByName].map(([name, id]) => [name, new Set(refs(
  ofType("IFCRELASSIGNSTOGROUP").find(([, rel]) => rel.args[6] === `#${id}`)[1].args[4],
))]));
const assignedActions = new Set([...assignedByGroup.values()].flatMap((ids) => [...ids]));
const actionRel = ofType("IFCRELCONNECTSSTRUCTURALACTIVITY")
  .find(([, rel]) => rel.args[4] === `#${nodesById.get(2).connectionId}`)[1];
const actionId = ref(actionRel.args[5]);
assert.ok(assignedActions.has(actionId));
assert.ok(assignedByGroup.get("'Permanent'").has(actionId));
const action = entity(actionId, "IFCSTRUCTURALPOINTACTION");
assert.equal(action.args[5], "$", "point action inherits the node placement");
assert.equal(action.args[6], "$", "point action inherits the node representation");
assert.equal(action.args[8], ".GLOBAL_COORDS.");
const load = entity(ref(action.args[7]), "IFCSTRUCTURALLOADSINGLEFORCE");
assert.deepEqual(load.args.slice(1), [
  "IFCFORCEMEASURE(5000.)", "IFCFORCEMEASURE(-2000.)", "IFCFORCEMEASURE(-10000.)",
  "IFCTORQUEMEASURE(1500.)", "IFCTORQUEMEASURE(-3000.)", "IFCTORQUEMEASURE(250.)",
]);
const imposedAction = ofType("IFCSTRUCTURALPOINTACTION")
  .map(([id, item]) => [id, item, entities.get(ref(item.args[7]))])
  .find(([, , payload]) => payload?.type === "IFCSTRUCTURALLOADSINGLEDISPLACEMENT");
assert.ok(imposedAction, "opgelegde 3D-verplaatsing wordt als IFC-actie geschreven");
const imposedLoad = imposedAction[2];
assert.deepEqual(imposedLoad.args.slice(1), [
  "IFCLENGTHMEASURE(0.001)", "IFCLENGTHMEASURE(-0.002)", "$", "$", "$", "$",
]);
assert.ok(assignedByGroup.get("'Opgelegde verplaatsingen'").has(imposedAction[0]));
const memberActions = [
  ...ofType("IFCSTRUCTURALLINEARACTION"),
  ...ofType("IFCSTRUCTURALCURVEACTION"),
].filter(([, item]) => /^'3D-staaflast /.test(item.args[2]));
assert.equal(memberActions.length, 2);
for (const [id, action] of memberActions) {
  assert.equal(action.args[8], ".LOCAL_COORDS.");
  assert.ok(assignedActions.has(id));
}
const member1 = memberActions.find(([, item]) => item.args[2] === "'3D-staaflast 1'")[0];
const member2 = memberActions.find(([, item]) => item.args[2] === "'3D-staaflast 2'")[0];
assert.ok(assignedByGroup.get("'Permanent'").has(member1));
assert.ok(assignedByGroup.get("'Variabel'").has(member2));
assert.equal(ofType("IFCSTRUCTURALLOADCONFIGURATION")
  .filter(([, item]) => item.args[0] === "'3D q 2'").length, 1, "deeltrapezium gebruikt een lastconfiguratie");
const linear3d = memberActions.find(([, item]) => item.type === undefined && item.args[2] === "'3D-staaflast 1'")
  ?? ofType("IFCSTRUCTURALLINEARACTION").find(([, item]) => item.args[2] === "'3D-staaflast 1'");
assert.ok(linear3d, "uniforme 3D-staaflast gebruikt een lineaire actie");
const memberPointAction = ofType("IFCSTRUCTURALPOINTACTION")
  .find(([, item]) => item.args[2] === "'3D-staafpuntlast 1'");
assert.ok(memberPointAction, "staafpuntlast gebruikt een IFC-puntactie");
assert.equal(memberPointAction[1].args[8], ".LOCAL_COORDS.");
assert.notEqual(memberPointAction[1].args[5], "$", "staafpuntlast bewaart zijn positie op de staaf");
assert.ok(assignedByGroup.get("'Variabel'").has(memberPointAction[0]));
const pointForce = entity(ref(memberPointAction[1].args[7]), "IFCSTRUCTURALLOADSINGLEFORCE");
assert.deepEqual(pointForce.args.slice(1, 4), [
  "IFCFORCEMEASURE(0)", "IFCFORCEMEASURE(3000.)", "IFCFORCEMEASURE(-12000.)",
]);
const thermalAction = ofType("IFCSTRUCTURALLINEARACTION")
  .find(([, item]) => item.args[2] === "'3D-temperatuur 1'");
assert.ok(thermalAction, "3D-temperatuurlast gebruikt een IFC-lineaire actie");
assert.equal(thermalAction[1].args[8], ".LOCAL_COORDS.");
assert.ok(assignedByGroup.get("'Permanent'").has(thermalAction[0]));
const thermalIfc = entity(ref(thermalAction[1].args[7]), "IFCSTRUCTURALLOADTEMPERATURE");
assert.deepEqual(thermalIfc.args.slice(1), [
  "IFCTHERMODYNAMICTEMPERATUREMEASURE(25.)",
  "IFCTHERMODYNAMICTEMPERATUREMEASURE(4.)",
  "IFCTHERMODYNAMICTEMPERATUREMEASURE(-6.)",
]);

const tree = bouwIfcBoom(input);
const building = tree.kinderen[0].kinderen[0];
assert.ok(building.kinderen.some((item) => item.naam.startsWith("3D-rekenmodel")));
assert.ok(verzamelIfcBeperkingen(input).some((line) => line.includes("3D-staven")));

const structureOnly = bouwIfcRekenmodel(input, { zonderLasten: true });
assert.equal((structureOnly.match(/^#\d+=IFCSTRUCTURALPOINTACTION\(/gm) ?? []).length, 0);
assert.ok(!structureOnly.includes("'3D-staaflast "));
assert.ok(!structureOnly.includes("'3D-temperatuur "));
assert.ok(structureOnly.includes(".LOADING_3D."));
assert.ok(verzamelIfcBeperkingen(input, { zonderLasten: true })
  .some((line) => line.includes("3D-belasting")));

const no3d = { ...input, model3d: undefined };
assert.equal(bouwIfcRekenmodel({ ...input, model3d: { nodes: [], beams: [] } }),
  bouwIfcRekenmodel(no3d), "empty 3D model leaves 2D IFC byte-identical");

const standalone3d = {
  ...input, nodes: [], beams: [], supports: [], loads: [], loadCases: [],
};
const standaloneIfc = bouwIfcRekenmodel(standalone3d);
assert.deepEqual(valideerIfc(standaloneIfc).fouten, []);
assert.ok(standaloneIfc.includes(".LOADING_3D."), "3D frame exports without 2D geometry");
assert.equal((standaloneIfc.match(/'3D-knoop \d+'/g) ?? []).length, 3);

const withIsolated = { ...input, model3d: {
  ...model3d,
  nodes: [...model3d.nodes, { id: 4, x: 8, y: 8, z: 8 }],
  supports: [...model3d.supports,
    { nodeId: 4, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [...model3d.loads,
    { id: 2, nodeId: 4, fx: 1, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
} };
const isolatedIfc = bouwIfcRekenmodel(withIsolated);
assert.deepEqual(valideerIfc(isolatedIfc).fouten, []);
assert.ok(!isolatedIfc.includes("'3D-knoop 4'"));
assert.ok(!isolatedIfc.includes("'3D-knooplast 2'"));
const isolatedTree = bouwIfcBoom(withIsolated);
const isolatedAnalysis = isolatedTree.kinderen[0].kinderen[0].kinderen
  .find((item) => item.naam.startsWith("3D-rekenmodel"));
assert.equal(isolatedAnalysis.kinderen.find((item) => item.naam === "3D-knopen").aantal, 3);
assert.ok(verzamelIfcBeperkingen(withIsolated)
  .some((line) => line.includes("1 losse 3D-knoop") && line.includes("1 knoopbelasting")));

const onlyIsolated = { ...input, model3d: {
  nodes: [{ id: 4, x: 8, y: 8, z: 8 }], beams: [],
  supports: [{ nodeId: 4, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [{ id: 2, nodeId: 4, fx: 1, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
} };
assert.equal(bouwIfcRekenmodel(onlyIsolated), bouwIfcRekenmodel(no3d));
assert.ok(verzamelIfcBeperkingen(onlyIsolated)
  .some((line) => line.includes("geen staven") && line.includes("niet geëxporteerd")));

const plateOnly3d = { ...input, nodes: [], beams: [], supports: [], loads: [], model3d: {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 },
    { id: 3, x: 6, y: 4, z: 0 }, { id: 4, x: 0, y: 4, z: 0 },
    { id: 5, x: 2, y: 1, z: 0 }, { id: 6, x: 4, y: 1, z: 0 },
    { id: 7, x: 4, y: 3, z: 0 }, { id: 8, x: 2, y: 3, z: 0 },
  ],
  beams: [], supports: [], loads: [],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4], thicknessM: 0.25, material: "C30/37", cornerRadiusM: 0.3,
    openings: [{ id: 1, nodeIds: [5, 6, 7, 8], cornerRadiusM: 0.15 }] }],
  surfaceLoads: [{ id: 1, plateId: 1, caseId: 1, qx: 0, qy: 0, qz: -5 }],
} };
const plateIfc = bouwIfcRekenmodel(plateOnly3d);
assert.deepEqual(valideerIfc(plateIfc).fouten, []);
assert.equal((plateIfc.match(/^#\d+=IFCSTRUCTURALSURFACEMEMBER\(/gm) ?? []).length, 1);
assert.ok(plateIfc.includes("'3D-plaat 1'"));
assert.ok(plateIfc.includes("'3D-oppervlaktelast 1'"));
assert.ok(plateIfc.includes("IFCSTRUCTURALLOADPLANARFORCE('3D-oppervlaktelast 1',IFCPLANARFORCEMEASURE(0.),IFCPLANARFORCEMEASURE(0.),IFCPLANARFORCEMEASURE(-5000.))"));
const plateLoops = [...plateIfc.matchAll(/^#\d+=IFCPOLYLOOP\((.*)\);$/gm)];
assert.equal(plateLoops.length, 2, "buitenrand en opening krijgen elk een lus");
assert.ok(plateLoops.every((match) => refs(match[1]).length > 4), "ronde randen worden met boogpunten benaderd");
const plateTree = bouwIfcBoom(plateOnly3d);
const plateAnalysis = plateTree.kinderen[0].kinderen[0].kinderen.find((item) => item.naam.startsWith("3D-rekenmodel"));
assert.equal(plateAnalysis.kinderen.find((item) => item.naam === "3D-platen").aantal, 1);
assert.equal(plateAnalysis.kinderen.find((item) => item.naam === "3D-oppervlaktebelastingen").aantal, 1);
assert.ok(verzamelIfcBeperkingen(plateOnly3d).some((line) => line.includes("3D-platen") && line.includes("analytische vlakken")));
const plateStructureOnly = bouwIfcRekenmodel(plateOnly3d, { zonderLasten: true });
assert.ok(plateStructureOnly.includes("'3D-plaat 1'"));
assert.ok(!plateStructureOnly.includes("'3D-oppervlaktelast 1'"));

assert.throws(() => bouwIfcRekenmodel({ ...input, model3d: {
  ...model3d, beams: [{ id: 1, startNodeId: 1, endNodeId: 99 }],
} }), /knoopverwijzing/);
assert.throws(() => bouwIfcRekenmodel({ ...input, model3d: {
  ...model3d, nodes: [{ id: 1, x: NaN, y: 0, z: 0 }],
} }), /ongeldige|ontbrekende/);

console.log("IFC4 3D model, mixed project, topology, 6-DOF supports and F/M loads: passed");
