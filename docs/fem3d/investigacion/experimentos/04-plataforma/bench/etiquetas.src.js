// Etiquetas: CSS2DRenderer (un <div> por etiqueta) vs troika BatchedText (SDF,
// una draw call) con fuente propia (GeistMono woff2 local). Mide el coste por frame
// con la cámara girando y cuenta peticiones de red a terceros.
import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Text, BatchedText } from "troika-three-text";
const now = () => performance.now();
function st(a) { const s = [...a].sort((x, y) => x - y); return { med: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2) }; }
function posiciones(n) { const p = []; const lado = Math.ceil(Math.cbrt(n)); for (let i = 0; i < n; i++) p.push([(i % lado) * 3, (Math.floor(i / lado) % lado) * 3, Math.floor(i / lado / lado) * 3]); return p; }
window.etiquetas = async function (n, frames = 40, que = 'css2d') {
  const W = 1280, H = 800, res = { n };
  const canvas = document.createElement("canvas"); document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas }); renderer.setSize(W, H, false);
  const gl = renderer.getContext(); const px = new Uint8Array(4);
  const cam = new THREE.PerspectiveCamera(45, W / H, 0.5, 5000); const P = posiciones(n);
  const c = Math.cbrt(n) * 1.5, R = Math.cbrt(n) * 8;
  const orbita = (i) => { const a = i / frames * 6.28; cam.position.set(c + R * Math.cos(a), c + R * Math.sin(a), c + R * 0.5); cam.lookAt(c, c, c); };
  // --- CSS2D
  if (que === 'css2d') { const scene = new THREE.Scene(); const css = new CSS2DRenderer(); css.setSize(W, H); document.body.appendChild(css.domElement);
    let t0 = now(); P.forEach((p, i) => { const d = document.createElement("div"); d.textContent = "N" + i; d.style.font = "11px monospace"; const o = new CSS2DObject(d); o.position.set(...p); scene.add(o); }); res.css2d_msCrear = +(now() - t0).toFixed(1);
    const t = []; for (let i = 0; i < frames; i++) { orbita(i); t0 = now(); renderer.render(scene, cam); css.render(scene, cam); document.body.offsetHeight; t.push(now() - t0); } res.css2d_frame = st(t);
    css.domElement.remove(); }
  // --- troika BatchedText con fuente local
  if (que === 'troika') { const scene = new THREE.Scene(); const bt = new BatchedText(); scene.add(bt);
    let t0 = now(); P.forEach((p, i) => { const tx = new Text(); tx.text = "N" + i; tx.font = new URL("./GeistMono-Regular.woff2", location.href).href; tx.fontSize = 0.6; tx.position.set(...p); bt.addText(tx); });
    const ok = await Promise.race([new Promise((r) => bt.sync(() => r(true))), new Promise((r) => setTimeout(() => r(false), 30000))]); res.troika_sincronizo = ok; res.troika_msHastaSync = +(now() - t0).toFixed(1);
    const t = []; for (let i = 0; i < frames; i++) { orbita(i); bt.quaternion.copy(cam.quaternion); t0 = now(); renderer.render(scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); t.push(now() - t0); }
    res.troika_frame = st(t); res.troika_drawCalls = renderer.info.render.calls; }
  res.peticionesTerceros = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => !u.startsWith(location.origin));
  renderer.dispose(); canvas.remove();
  return res;
};

window.troikaSimple = async function (n = 500) {
  const r = {};
  const canvas = document.createElement("canvas"); document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas }); renderer.setSize(1280, 800, false);
  const cam = new THREE.PerspectiveCamera(45, 1.6, 0.5, 5000); cam.position.set(30, 30, 30); cam.lookAt(0, 0, 0);
  const scene = new THREE.Scene();
  const font = new URL(window.FUENTE || "./GeistMono-Regular.woff2", location.href).href;
  // 1) un Text suelto
  const t1 = new Text(); t1.text = "N1"; t1.font = font; scene.add(t1);
  let t0 = now();
  r.textoSuelto = await Promise.race([new Promise((ok) => t1.sync(() => ok(+(now() - t0).toFixed(0)))), new Promise((ok) => setTimeout(() => ok("timeout 20 s"), 20000))]);
  // 2) BatchedText renderizando en bucle mientras sincroniza
  const bt = new BatchedText(); scene.add(bt); const P = posiciones(n);
  t0 = now();
  P.forEach((p, i) => { const tx = new Text(); tx.text = "N" + i; tx.font = font; tx.fontSize = 0.6; tx.position.set(...p); bt.addText(tx); });
  let listo = false; bt.sync(() => { listo = true; });
  const fin = now() + 20000;
  while (!listo && now() < fin) { renderer.render(scene, cam); await new Promise((ok) => requestAnimationFrame(ok)); }
  r.batched = listo ? +(now() - t0).toFixed(0) : "timeout 20 s";
  r.drawCalls = renderer.info.render.calls;
  r.terceros = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => !u.startsWith(location.origin));
  return r;
};
