// E2-bis: CDT a tamaño 2h y división tri -> 3 quads (tamaño final ~h) frente a la rejilla a h.
import Delaunator from 'delaunator';
import Constrainautor from '@kninnug/constrainautor';
import { performance } from 'node:perf_hooks';
import { caso, pslg, steiner, keepTri, triMetrics, triAQuads, quadMetrics, rejilla } from './geom.mjs';
const out = {};
for (const v of ['A', 'B', 'C']) {
  const c2 = caso(v, 1.0);
  const t0 = performance.now();
  const P = pslg(c2); const S = steiner(c2, P);
  const pts = [...P.pts, ...S];
  const del = Delaunator.from(pts); const con = new Constrainautor(del); con.constrainAll(P.segs.map((s) => [s.i, s.j]));
  const tris = []; for (let i = 0; i < del.triangles.length; i += 3) tris.push([del.triangles[i], del.triangles[i + 1], del.triangles[i + 2]]);
  const T = tris.filter((t) => keepTri(c2, pts, t));
  const q = triAQuads(pts, T);
  const ms = performance.now() - t0;
  const g = rejilla(caso(v, 0.5));
  out[v] = { 'tri(2h=1,0 m)': triMetrics(pts, T), 'tri->3quads (~0,5 m)': { ...quadMetrics(q.pts, q.quads), ms_total: +ms.toFixed(1) }, 'rejilla h=0,5 m': quadMetrics(g.pts, g.quads) };
}
console.log(JSON.stringify(out, null, 1));
