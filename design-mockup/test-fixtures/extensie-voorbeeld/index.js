// Testextensie voor Open FEM Studio (zie docs/extensies.md): leest het
// verzonnen tekstformaat .demofem en geeft een 2D-projectdocument terug.
//
// Regels (maten in mm, krachten in kN):
//   knoop <id> <x> <z>
//   staaf <id> <van> <naar> <profiel> <materiaal>
//   oplegging <knoop> <inklemming|scharnier|rol>
//   last <knoop> <Fz>            (negatief = omlaag)
//   # commentaar
// Een onbekende regel komt als waarschuwing in het importverslag.
(function () {
  const OPLEGGING = { inklemming: "fixed", scharnier: "pinned", rol: "zRoller" };

  async function importFile({ fileName, bytes }) {
    const tekst = new TextDecoder("utf-8").decode(bytes);
    const nodes = [], beams = [], supports = [], loads = [];
    const messages = [];
    tekst.split(/\r?\n/).forEach((regel, index) => {
      const delen = regel.trim().split(/\s+/);
      if (delen[0] === "" || delen[0].startsWith("#")) return;
      const getal = (i) => Number(delen[i]);
      switch (delen[0]) {
        case "knoop":
          nodes.push({ id: getal(1), x: getal(2), z: getal(3) });
          break;
        case "staaf":
          beams.push({
            id: getal(1), from: getal(2), to: getal(3),
            profile: delen[4].replace(/^([A-Z]+)(\d)/, "$1 $2"), material: delen[5],
          });
          break;
        case "oplegging":
          supports.push({ nodeId: getal(1), type: OPLEGGING[delen[2]] ?? "pinned" });
          break;
        case "last":
          loads.push({ id: loads.length + 1, type: "pointForce", caseId: 1, nodeId: getal(1), fx: 0, fz: getal(2) });
          break;
        default:
          messages.push({ level: "warning", text: `Regel ${index + 1} niet herkend en overgeslagen: "${regel.trim()}".` });
      }
    });
    messages.unshift({
      level: "info",
      text: `${fileName}: ${nodes.length} knopen, ${beams.length} staven, ${supports.length} opleggingen, ${loads.length} lasten.`,
    });
    return {
      project: {
        format: "open-fem-studio-v2",
        version: 2,
        modelDimension: "2d",
        nodes, beams, supports, plates: [], loads,
        loadCases: [{ id: 1, name: "Permanent (G)", type: "dead" }],
        activeLoadCaseId: 1,
        selfWeightEnabled: false,
      },
      messages,
    };
  }

  globalThis.openFemExtension = { importFile };
})();
