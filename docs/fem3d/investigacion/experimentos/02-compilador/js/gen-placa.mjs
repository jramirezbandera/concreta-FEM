// Genera mallas de una placa cuadrada 6 x 6 m para el ensayo en PyNite:
// (1) CDT con retícula triangular a tamaño H y división tri -> 3 quads; (2) rejilla.
import Delaunator from 'delaunator';
import Constrainautor from '@kninnug/constrainautor';
import { writeFileSync } from 'node:fs';
import { pslg, steiner, keepTri, triAQuads, quadMetrics } from './geom.mjs';
const out = {};
for (const H of [1.0, 0.5]) {
  const c = { boundary: [[0, 0], [6, 0], [6, 6], [0, 6]], hole: [[-10, -10], [-9, -10], [-9, -9], [-10, -9]], beams: [], columns: [[3, 3]], h: H };
  const P = pslg(c); const S = steiner(c, P);
  const pts = [...P.pts, ...S];
  const del = Delaunator.from(pts); const con = new Constrainautor(del);
  con.constrainAll(P.segs.filter((s) => s.tag === 'borde').map((s) => [s.i, s.j]));
  const tris = []; for (let i = 0; i < del.triangles.length; i += 3) tris.push([del.triangles[i], del.triangles[i + 1], del.triangles[i + 2]]);
  const T = tris.filter((t) => keepTri(c, pts, t));
  const q = triAQuads(pts, T);
  out[`triquad_H${H}`] = { pts: q.pts, quads: q.quads, metricas: quadMetrics(q.pts, q.quads) };
}
writeFileSync('../py/mallas-placa.json', JSON.stringify(out));
for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v.metricas));
