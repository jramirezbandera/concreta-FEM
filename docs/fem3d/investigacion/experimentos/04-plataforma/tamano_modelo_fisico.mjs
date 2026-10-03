// Tamaño en localStorage de un PhysicalModel (§6) de edificio medio, y cuánto
// ocupa al pasar por el contenedor de proyectos de Concreta (la clave viva +
// su copia como cadena dentro del ProyectoFile archivado, que escapa comillas).
// Uso: node tamano_modelo_fisico.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { compressToEncodedURIComponent, compressToUTF16 } = require("D:/PROGRAMACION/Concreta EST/wt/feat-fem3d/node_modules/lz-string");
const uuid = () => crypto.randomUUID();
function modelo(plantas, pilaresPorPlanta, vigasPorPlanta, muros) {
  const storeys = Array.from({ length: plantas + 1 }, (_, i) => ({ id: uuid(), name: i ? `Planta ${i}` : "Cimentación", elevation: i * 3.2, levelOrder: i }));
  const materials = [{ id: uuid(), name: "HA-30", kind: "concrete", E: 28576790000, nu: 0.2, rho: 2500 }, { id: uuid(), name: "B500S", kind: "steel", E: 2e11, nu: 0.3, rho: 7850 }];
  const sections = Array.from({ length: 8 }, (_, i) => ({ id: uuid(), name: `R${30 + 5 * i}x${30 + 5 * i}`, shape: "rect", b: 0.3 + 0.05 * i, h: 0.3 + 0.05 * i }));
  const columns = [], beams = [], slabs = [], walls = [], loads = [];
  for (let k = 0; k < plantas; k++) {
    for (let c = 0; c < pilaresPorPlanta; c++) {
      const x = (c % 8) * 5.15, y = Math.floor(c / 8) * 4.85;
      columns.push({ id: uuid(), name: `P${c + 1}`, fromStoreyId: storeys[k].id, toStoreyId: storeys[k + 1].id, axis: { start: [x, y, k * 3.2], end: [x, y, (k + 1) * 3.2] }, sectionId: sections[c % 8].id, materialId: materials[0].id, orientation: [1, 0, 0] });
    }
    for (let b = 0; b < vigasPorPlanta; b++) {
      const x = (b % 7) * 5.15, y = Math.floor(b / 7) * 4.85;
      beams.push({ id: uuid(), name: `V${k + 1}.${b + 1}`, storeyId: storeys[k + 1].id, axis: [[x, y, (k + 1) * 3.2], [x + 5.15, y, (k + 1) * 3.2]], sectionId: sections[(b + 3) % 8].id, materialId: materials[0].id, endReleases: { i: { rz: false }, j: { rz: false } } });
    }
    slabs.push({ id: uuid(), name: `Forjado ${k + 1}`, storeyId: storeys[k + 1].id, boundary: [[0, 0], [36.05, 0], [36.05, 24.25], [0, 24.25]], openings: [[[10.3, 4.85], [13.3, 4.85], [13.3, 7.85], [10.3, 7.85]]], elevation: (k + 1) * 3.2, thickness: 0.3, materialId: materials[0].id, mesh: { targetSize: 0.5, maxAspectRatio: 3, formulationPreference: "quad" } });
    loads.push({ id: uuid(), kind: "area", targetId: slabs[k].id, caseId: "G2", value: -2000 }, { id: uuid(), kind: "area", targetId: slabs[k].id, caseId: "Q", value: -3000 });
  }
  for (let m = 0; m < muros; m++) walls.push({ id: uuid(), name: `M${m + 1}`, fromStoreyId: storeys[0].id, toStoreyId: storeys[plantas].id, baseline: [[0, m * 4.85, 0], [5.15, m * 4.85, 0]], openings: [], thickness: 0.25, materialId: materials[0].id, mesh: { targetSize: 0.5 } });
  const loadCases = ["G1", "G2", "Q", "W+X", "W-X", "W+Y", "W-Y", "S"].map((id) => ({ id, name: id, actionType: id[0] }));
  return { schemaVersion: 1, projectId: uuid(), revision: 42, storeys, materials, sections, columns, beams, slabs, walls, supports: columns.slice(0, pilaresPorPlanta).map((c) => ({ id: uuid(), columnId: c.id, fixity: "empotrado" })), loadCases, loads, analysisSettings: { tolerance: 1e-6 } };
}
for (const [nombre, args] of [["pequeño (3 pl, 16 pil, 24 vig)", [3, 16, 24, 2]], ["medio (8 pl, 40 pil, 70 vig)", [8, 40, 70, 4]], ["grande (15 pl, 80 pil, 140 vig)", [15, 80, 140, 8]]]) {
  const m = modelo(...args);
  const json = JSON.stringify(m);
  const archivado = JSON.stringify({ claves: { "concreta-fem3d": json } }); // cadena dentro de cadena
  const lzUri = compressToEncodedURIComponent(json);
  const lz16 = compressToUTF16(json);
  const total = json.length + archivado.length;
  console.log(`${nombre}: ${m.columns.length} pilares, ${m.beams.length} vigas`);
  console.log(`  JSON ${(json.length / 1024).toFixed(0)} Ki car · en el ProyectoFile archivado ${(archivado.length / 1024).toFixed(0)} Ki car · clave viva + archivo ${(total / 1024).toFixed(0)} Ki car = ${((100 * total) / 5242880).toFixed(1)} % del tope medido en Chrome (5 Mi car)`);
  console.log(`  lz-string URI ${(lzUri.length / 1024).toFixed(0)} Ki car (enlace) · lz-string UTF16 ${(lz16.length / 1024).toFixed(0)} Ki car`);
}
