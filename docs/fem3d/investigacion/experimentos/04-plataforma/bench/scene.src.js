// Banco de pruebas del visor 3D: edificio sintético de barras + láminas.
// Compara representaciones de barras (InstancedMesh, malla fusionada, LineSegments,
// LineSegments2 y el ingenuo «un Mesh por barra») y de láminas (color por vértice
// vs rampa en textura), y mide construcción, tiempo de frame y picking
// (Raycaster lineal, three-mesh-bvh y GPU picking por ID).
// Se empaqueta con esbuild a bench/scene.js. Expone window.bench(cfg).
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, LineSegmentsBVH } from "three-mesh-bvh";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const now = () => performance.now();

// ---------------------------------------------------------------- modelo
function edificio({ plantas, nx, ny, vano = 5, h = 3, div }) {
  const bars = [];
  for (let k = 0; k < plantas; k++) {
    const z0 = k * h, z1 = (k + 1) * h;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) bars.push([i * vano, j * vano, z0, i * vano, j * vano, z1]);
    for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny; j++) bars.push([i * vano, j * vano, z1, (i + 1) * vano, j * vano, z1]);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny - 1; j++) bars.push([i * vano, j * vano, z1, i * vano, (j + 1) * vano, z1]);
  }
  const B = new Float32Array(bars.length * 6);
  bars.forEach((b, n) => B.set(b, n * 6));
  // Losas: un rectángulo por planta, div x div cuadriláteros partidos en 2 triángulos.
  const Lx = (nx - 1) * vano, Ly = (ny - 1) * vano;
  const nTri = plantas * div * div * 2;
  const P = new Float32Array(nTri * 9);
  const V = new Float32Array(nTri); // valor por elemento (p. ej. Mx), con signo
  const VN = new Float32Array(nTri * 3); // valor nodal (suavizado) por vértice
  const campo = (x, y) => Math.sin((2 * Math.PI * x) / (2 * vano)) * Math.sin((2 * Math.PI * y) / (2 * vano)) * (1 + x / Lx);
  let t = 0;
  for (let k = 0; k < plantas; k++) {
    const z = (k + 1) * h;
    for (let a = 0; a < div; a++) for (let b = 0; b < div; b++) {
      const x0 = (a / div) * Lx, x1 = ((a + 1) / div) * Lx, y0 = (b / div) * Ly, y1 = ((b + 1) / div) * Ly;
      for (const tri of [[[x0, y0], [x1, y0], [x1, y1]], [[x0, y0], [x1, y1], [x0, y1]]]) {
        let cx = 0, cy = 0;
        tri.forEach(([x, y], q) => { P.set([x, y, z], t * 9 + q * 3); VN[t * 3 + q] = campo(x, y); cx += x / 3; cy += y / 3; });
        V[t] = campo(cx, cy);
        t++;
      }
    }
  }
  return { B, nBars: bars.length, P, V, VN, nTri };
}

// ---------------------------------------------------------------- paletas
// cividis (Nuñez, Anderton y Renslow 2018), muestreado en 9 puntos.
const CIVIDIS = ["#00204d", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8779", "#a69d75", "#c4b56c", "#e4cf5b", "#ffea46"];
function rampa(hexes, n) {
  const cs = hexes.map((h) => new THREE.Color(h));
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), s = u * (cs.length - 1), k = Math.min(Math.floor(s), cs.length - 2), f = s - k;
    out.push(cs[k].clone().lerp(cs[k + 1], f));
  }
  return out;
}

// ---------------------------------------------------------------- barras
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3();
const UPZ = new THREE.Vector3(0, 0, 1), D = new THREE.Vector3();
function matrizBarra(B, n, ancho) {
  const a = new THREE.Vector3(B[n * 6], B[n * 6 + 1], B[n * 6 + 2]);
  const b = new THREE.Vector3(B[n * 6 + 3], B[n * 6 + 4], B[n * 6 + 5]);
  D.subVectors(b, a); const L = D.length(); D.normalize();
  Q.setFromUnitVectors(UPZ, D); S.set(ancho, ancho, L); T.copy(a);
  return M.compose(T, Q, S);
}
function cajaUnidad() {
  const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0, 0.5); return g; // z de 0 a 1
}

function barrasInstanced(mod) {
  const g = cajaUnidad();
  const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial(), mod.nBars);
  const c = new THREE.Color();
  for (let n = 0; n < mod.nBars; n++) { m.setMatrixAt(n, matrizBarra(mod.B, n, 0.3)); m.setColorAt(n, c.setHSL((n % 7) / 7, 0.4, 0.5)); }
  m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
  return m;
}
function barrasNaive(mod) {
  const g = cajaUnidad(), mat = new THREE.MeshLambertMaterial({ color: 0x8899aa });
  const grp = new THREE.Group();
  for (let n = 0; n < mod.nBars; n++) { const m = new THREE.Mesh(g, mat); matrizBarra(mod.B, n, 0.3).decompose(m.position, m.quaternion, m.scale); grp.add(m); }
  return grp;
}
function barrasFusionadas(mod) {
  // Una sola geometría con 12 triángulos por barra y un atributo barId por vértice
  // (el id sobrevive a la reordenación del índice que hace three-mesh-bvh).
  const base = cajaUnidad().toNonIndexed();
  const bp = base.getAttribute("position"), nv = bp.count;
  const pos = new Float32Array(mod.nBars * nv * 3), col = new Float32Array(mod.nBars * nv * 3), ids = new Float32Array(mod.nBars * nv);
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let n = 0; n < mod.nBars; n++) {
    const mm = matrizBarra(mod.B, n, 0.3); c.setHSL((n % 7) / 7, 0.4, 0.5);
    for (let i = 0; i < nv; i++) {
      v.fromBufferAttribute(bp, i).applyMatrix4(mm); const o = (n * nv + i) * 3;
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z; col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; ids[n * nv + i] = n;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.setAttribute("barId", new THREE.BufferAttribute(ids, 1));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}
function barrasLineas(mod) {
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(mod.B, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x334455 }));
}
function barrasFat(mod, w, h) {
  const g = new LineSegmentsGeometry(); g.setPositions(mod.B);
  const mat = new LineMaterial({ color: 0x334455, linewidth: 3, worldUnits: false }); mat.resolution.set(w, h);
  return new LineSegments2(g, mat);
}

// ---------------------------------------------------------------- láminas
function laminaColorVertice(mod, nBandas, vmax) {
  // Color CONSTANTE por triángulo (dato bruto por elemento), bandas discretas.
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(mod.P, 3));
  const r = rampa(CIVIDIS, nBandas), col = new Float32Array(mod.nTri * 9);
  for (let t = 0; t < mod.nTri; t++) {
    const u = Math.min(nBandas - 1, Math.max(0, Math.floor(((mod.V[t] / vmax + 1) / 2) * nBandas)));
    for (let q = 0; q < 3; q++) col.set([r[u].r, r[u].g, r[u].b], t * 9 + q * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}
function laminaTextura(mod, nBandas, vmax) {
  // Valor nodal (suavizado) en uv.x y rampa 1D con NearestFilter: la GPU interpola
  // el VALOR y la textura cuantiza → isobandas nítidas sin colores intermedios falsos.
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(mod.P, 3));
  const uv = new Float32Array(mod.nTri * 6);
  for (let i = 0; i < mod.nTri * 3; i++) { uv[i * 2] = (mod.VN[i] / vmax + 1) / 2; uv[i * 2 + 1] = 0.5; }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const r = rampa(CIVIDIS, nBandas), data = new Uint8Array(nBandas * 4);
  // Los bytes de una textura sRGB van en sRGB (THREE.Color guarda lineal desde r152).
  const srgb = {}; r.forEach((c, i) => { c.getRGB(srgb, THREE.SRGBColorSpace); data.set([Math.round(srgb.r * 255), Math.round(srgb.g * 255), Math.round(srgb.b * 255), 255], i * 4); });
  const tex = new THREE.DataTexture(data, nBandas, 1); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
}
function laminaColorNodalInterpolado(mod, nBandas, vmax) {
  // Lo que NO hay que hacer: color por vértice a partir del valor nodal → la GPU
  // interpola RGB entre bandas y pinta colores que no existen en la leyenda.
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(mod.P, 3));
  const r = rampa(CIVIDIS, nBandas), col = new Float32Array(mod.nTri * 9);
  for (let i = 0; i < mod.nTri * 3; i++) {
    const u = Math.min(nBandas - 1, Math.max(0, Math.floor(((mod.VN[i] / vmax + 1) / 2) * nBandas)));
    col.set([r[u].r, r[u].g, r[u].b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

// ---------------------------------------------------------------- medición
function stats(a) {
  const s = [...a].sort((x, y) => x - y);
  return { med: +s[Math.floor(s.length / 2)].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), media: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) };
}

window.bench = async function (cfg) {
  const W = cfg.w || 1280, H = cfg.h || 800;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!cfg.capturar });
  renderer.setSize(W, H, false);
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const info = { webgl2: renderer.capabilities.isWebGL2, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), three: THREE.REVISION };

  let t0 = now();
  const mod = edificio(cfg.modelo);
  const tModelo = now() - t0;
  const res = { info, modelo: { barras: mod.nBars, triangulosLamina: mod.nTri, msGenerar: +tModelo.toFixed(1) }, variantes: {} };

  const camera = new THREE.PerspectiveCamera(45, W / H, 0.5, 2000); camera.up.set(0, 0, 1);
  const ctr = new THREE.Vector3((cfg.modelo.nx - 1) * 2.5, (cfg.modelo.ny - 1) * 2.5, cfg.modelo.plantas * 1.5);
  const R = Math.max(cfg.modelo.nx, cfg.modelo.ny) * 5 * 1.6 + cfg.modelo.plantas * 2;
  const pix = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pix);

  async function medir(nombre, construir, { picking = [], idScene = null } = {}) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6)); const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(1, 2, 3); scene.add(dl);
    t0 = now(); const objs = construir(); const tBuild = now() - t0; objs.forEach((o) => scene.add(o));
    // primer render: compila shaders y sube buffers
    camera.position.set(ctr.x + R, ctr.y - R, ctr.z + R * 0.6); camera.lookAt(ctr);
    t0 = now(); renderer.render(scene, camera); sync(); const tFirst = now() - t0;
    const tiempos = [];
    for (let i = 0; i < (cfg.frames || 60); i++) {
      const a = (i / 60) * Math.PI * 2; camera.position.set(ctr.x + R * Math.cos(a), ctr.y + R * Math.sin(a), ctr.z + R * 0.6); camera.lookAt(ctr);
      t0 = now(); renderer.render(scene, camera); sync(); tiempos.push(now() - t0);
    }
    const r = { msConstruir: +tBuild.toFixed(1), msPrimerFrame: +tFirst.toFixed(1), frame: stats(tiempos), drawCalls: renderer.info.render.calls, triangulos: renderer.info.render.triangles, lineas: renderer.info.render.lines, geometriasGPU: renderer.info.memory.geometries };
    // picking en puntos aleatorios deterministas
    camera.position.set(ctr.x + R, ctr.y - R, ctr.z + R * 0.6); camera.lookAt(ctr); camera.updateMatrixWorld();
    const ray = new THREE.Raycaster(); ray.params.Line.threshold = 0.2; const nd = new THREE.Vector2();
    // Puntos de picking: proyección en pantalla de centros de barras y de triángulos
    // elegidos al azar (semilla fija) → el rayo apunta a geometría real, como un clic.
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const puntos = []; const pv = new THREE.Vector3();
    while (puntos.length < (cfg.picks || 100)) {
      if (puntos.length % 2 === 0) { const n = Math.floor(rnd() * mod.nBars); pv.set((mod.B[n*6]+mod.B[n*6+3])/2, (mod.B[n*6+1]+mod.B[n*6+4])/2, (mod.B[n*6+2]+mod.B[n*6+5])/2); }
      else { const t = Math.floor(rnd() * mod.nTri); pv.set((mod.P[t*9]+mod.P[t*9+3]+mod.P[t*9+6])/3, (mod.P[t*9+1]+mod.P[t*9+4]+mod.P[t*9+7])/3, (mod.P[t*9+2]+mod.P[t*9+5]+mod.P[t*9+8])/3); }
      pv.project(camera); if (Math.abs(pv.x) < 0.98 && Math.abs(pv.y) < 0.98) puntos.push([(pv.x + 1) / 2, (1 - pv.y) / 2]);
    }
    for (const pk of picking) {
      if (pk.prep) { t0 = now(); pk.prep(objs); r[`msPrep_${pk.nombre}`] = +(now() - t0).toFixed(1); }
      ray.firstHitOnly = !!pk.firstHitOnly;
      const tp = []; let aciertos = 0;
      for (const [u, v] of puntos) {
        nd.set(u * 2 - 1, -(v * 2 - 1)); ray.setFromCamera(nd, camera);
        t0 = now(); const hits = ray.intersectObjects(pk.objetos ? pk.objetos(objs) : objs, true); tp.push(now() - t0); if (hits.length) aciertos++;
      }
      r[`pick_${pk.nombre}`] = { ...stats(tp), aciertos };
    }
    if (idScene) {
      // GPU picking: escena de ids, render de 1×1 px con setViewOffset y readPixels.
      t0 = now(); const ids = idScene(objs); r.msPrepGpuPick = +(now() - t0).toFixed(1);
      const rt = new THREE.WebGLRenderTarget(1, 1); const tp = []; let aciertos = 0;
      for (const [u, v] of puntos) {
        t0 = now();
        camera.setViewOffset(W, H, Math.floor(u * W), Math.floor(v * H), 1, 1);
        renderer.setRenderTarget(rt); renderer.render(ids, camera); renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, pix); renderer.setRenderTarget(null);
        camera.clearViewOffset();
        tp.push(now() - t0); const id = pix[0] | (pix[1] << 8) | (pix[2] << 16); if (id !== 0xffffff) aciertos++;
      }
      r.pick_gpu = { ...stats(tp), aciertos }; rt.dispose();
    }
    if (cfg.capturar && pickCaptura(nombre)) r.png = canvas.toDataURL("image/png");
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    renderer.renderLists.dispose();
    return r;
  }
  const pickCaptura = (n) => (cfg.capturar || []).includes(n);
  const vmax = 2;
  const idColor = (n) => new THREE.Color().setRGB((n & 255) / 255, ((n >> 8) & 255) / 255, ((n >> 16) & 255) / 255, THREE.SRGBColorSpace);
  const sceneIdsLamina = (mesh) => {
    // ids por triángulo como color plano (sin luces, sin tone mapping)
    const g = mesh.geometry.clone(); const col = new Float32Array(mod.nTri * 9);
    for (let t = 0; t < mod.nTri; t++) { const c = idColor(t + 1); for (let q = 0; q < 3; q++) col.set([c.r, c.g, c.b], t * 9 + q * 3); }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const s = new THREE.Scene(); s.background = new THREE.Color(0xffffff);
    s.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false })));
    return s;
  };

  const vs = cfg.variantes;
  if (vs.includes("naive")) res.variantes.naive = await medir("naive", () => [barrasNaive(mod)], { picking: [{ nombre: "raycastLineal" }] });
  if (vs.includes("instanced")) res.variantes.instanced = await medir("instanced", () => [barrasInstanced(mod)], { picking: [{ nombre: "raycastLineal" }] });
  if (vs.includes("fusionada")) res.variantes.fusionada = await medir("fusionada", () => [barrasFusionadas(mod)], {
    picking: [
      { nombre: "raycastLineal" },
      { nombre: "bvh", prep: (o) => { o[0].geometry.computeBoundsTree(); o[0].raycast = acceleratedRaycast; }, firstHitOnly: true },
    ],
  });
  if (vs.includes("lineas")) res.variantes.lineas = await medir("lineas", () => [barrasLineas(mod)], {
    picking: [
      { nombre: "raycastLineal" },
      { nombre: "bvh", prep: (o) => { o[0].geometry.computeBoundsTree({ type: LineSegmentsBVH }); o[0].raycast = acceleratedRaycast; }, firstHitOnly: true },
    ],
  });
  if (vs.includes("fat")) res.variantes.fat = await medir("fat", () => [barrasFat(mod, W, H)], { picking: [{ nombre: "raycastLineal" }] });
  if (vs.includes("lamina")) res.variantes.lamina = await medir("lamina", () => [laminaColorVertice(mod, 10, vmax)], {
    picking: [
      { nombre: "raycastLineal" },
      { nombre: "bvh", prep: (o) => { o[0].geometry.computeBoundsTree(); o[0].raycast = acceleratedRaycast; }, firstHitOnly: true },
      { nombre: "bvhIndirect", prep: (o) => { o[0].geometry.disposeBoundsTree(); o[0].geometry.setIndex(null); o[0].geometry.computeBoundsTree({ indirect: true }); }, firstHitOnly: true },
    ],
    idScene: (o) => sceneIdsLamina(o[0]),
  });
  if (vs.includes("laminaTextura")) res.variantes.laminaTextura = await medir("laminaTextura", () => [laminaTextura(mod, 10, vmax)]);
  if (vs.includes("laminaInterp")) res.variantes.laminaInterp = await medir("laminaInterp", () => [laminaColorNodalInterpolado(mod, 10, vmax)]);
  if (vs.includes("mixto")) res.variantes.mixto = await medir("mixto", () => [barrasFusionadas(mod), laminaColorVertice(mod, 10, vmax), barrasFat(mod, W, H)]);
  if (performance.memory) res.heapMB = +(performance.memory.usedJSHeapSize / 1048576).toFixed(1);
  renderer.dispose(); canvas.remove();
  return res;
};

// Prueba de la reordenación del índice: ¿sigue valiendo faceIndex→elemento tras computeBoundsTree?
// Se lanza un rayo vertical por el centroide de cada triángulo y se compara el
// faceIndex devuelto con el índice ORIGINAL del triángulo (= id de elemento).
window.pruebaIndice = function () {
  const mod = edificio({ plantas: 1, nx: 3, ny: 3, div: 8 });
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  const centro = (t) => new THREE.Vector3((mod.P[t*9]+mod.P[t*9+3]+mod.P[t*9+6])/3, (mod.P[t*9+1]+mod.P[t*9+4]+mod.P[t*9+7])/3, 10);
  function cuenta(prep) {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(mod.P.slice(), 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    prep(g, m);
    let ok = 0, okResuelto = 0;
    for (let t = 0; t < mod.nTri; t++) {
      ray.set(centro(t), new THREE.Vector3(0, 0, -1));
      const h = ray.intersectObject(m)[0]; if (!h) continue;
      if (h.faceIndex === t) ok++;
      // resolución correcta: con índice, el triángulo original es idx[3f]/3 (geometría no indexada de origen)
      const idx = g.index ? g.index.array : null;
      const orig = idx ? Math.floor(idx[h.faceIndex * 3] / 3) : h.faceIndex;
      if (orig === t) okResuelto++;
    }
    return { triangulos: mod.nTri, faceIndexIgualAlOriginal: ok, resolviendoPorIndice: okResuelto, tieneIndice: !!g.index };
  }
  return {
    sinBvh: cuenta(() => {}),
    bvhNormal: cuenta((g, m) => { g.computeBoundsTree(); m.raycast = acceleratedRaycast; }),
    bvhIndirect: cuenta((g, m) => { g.computeBoundsTree({ indirect: true }); m.raycast = acceleratedRaycast; }),
  };
};

// Bandas: ¿cuántos píxeles pintan un color que NO está en la leyenda?
// Vista cenital ortográfica de una losa con un campo que cambia de signo.
window.bandas = function () {
  const mod = edificio({ plantas: 1, nx: 3, ny: 3, div: 6 }); // malla gruesa: 72 triángulos
  const W = 600, H = 600, nB = 10, vmax = 2;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true }); renderer.setSize(W, H, false);
  const cam = new THREE.OrthographicCamera(-0.2, 10.2, 10.2, -0.2, 0.1, 100); cam.position.set(0, 0, 50); cam.lookAt(0, 0, 0);
  const leyenda = rampa(CIVIDIS, nB).map((c) => { const s = c.clone().convertLinearToSRGB(); return [s.r * 255, s.g * 255, s.b * 255]; });
  const out = {};
  for (const [nombre, f] of [["porElemento", laminaColorVertice], ["texturaNodal", laminaTextura], ["colorNodalInterpolado", laminaColorNodalInterpolado]]) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff);
    const m = f(mod, nB, vmax); m.position.z = -3; scene.add(m);
    renderer.render(scene, cam);
    const px = new Uint8Array(W * H * 4); const gl = renderer.getContext(); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let fuera = 0, total = 0; const distintos = new Set();
    for (let i = 0; i < W * H; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
      if (r > 250 && g > 250 && b > 250) continue; total++; distintos.add((r << 16) | (g << 8) | b);
      let dmin = 1e9; for (const [lr, lg, lb] of leyenda) dmin = Math.min(dmin, Math.abs(r - lr) + Math.abs(g - lg) + Math.abs(b - lb));
      if (dmin > 6) fuera++;
    }
    out[nombre] = { pixeles: total, coloresDistintos: distintos.size, pctFueraDeLeyenda: +((100 * fuera) / total).toFixed(1), png: canvas.toDataURL("image/png") };
  }
  renderer.dispose(); canvas.remove();
  return out;
};
