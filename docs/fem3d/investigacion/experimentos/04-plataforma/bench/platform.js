// Experimentos de plataforma (sin dependencias): cuota de localStorage, coste del
// fingerprint SHA-256, transferencia Worker (copia vs Transferable vs JSON),
// IndexedDB con ArrayBuffer grandes, estimación de cuota y long tasks.
const now = () => performance.now();
const r1 = (x) => +x.toFixed(1);

// ------------------------------------------------------------ localStorage
window.cuotaLocalStorage = function (ch = "a") {
  localStorage.clear();
  const trozo = ch.repeat(256 * 1024);
  let n = 0, total = 0, clave = 0;
  // llenar con trozos de 256 Ki caracteres y afinar el último con búsqueda binaria
  for (;;) {
    try { localStorage.setItem("k" + clave, trozo); total += trozo.length + ("k" + clave).length; clave++; } catch (e) { var err = e.name; break; }
  }
  let lo = 0, hi = trozo.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); try { localStorage.setItem("k" + clave, ch.repeat(mid)); lo = mid; } catch { hi = mid - 1; } }
  total += lo + ("k" + clave).length;
  localStorage.clear();
  return { caracter: ch, caracteresTotales: total, MiCaracteres: r1(total / 1048576), error: err };
};

// ------------------------------------------------------------ modelo sintético
function modeloAnalitico(nNodos, nFrames, nShells) {
  const id = (p, i) => `${p}-${i.toString(36).padStart(6, "0")}`;
  const nodes = [], frames = [], shells = [];
  for (let i = 0; i < nNodos; i++) nodes.push({ id: id("n", i), position: [Math.random() * 50, Math.random() * 50, Math.random() * 30], physicalRefs: [{ type: "slab", id: "s-1" }] });
  for (let i = 0; i < nFrames; i++) frames.push({ id: id("f", i), nodeI: id("n", i % nNodos), nodeJ: id("n", (i + 1) % nNodos), materialId: "m-1", sectionId: "sec-3", localYAxis: [0, 1, 0], physicalElementId: id("b", i >> 2), physicalStationRange: [0, 0.25] });
  for (let i = 0; i < nShells; i++) shells.push({ id: id("s", i), nodeIds: [id("n", i % nNodos), id("n", (i + 7) % nNodos), id("n", (i + 13) % nNodos)], materialId: "m-1", thickness: 0.25, localXAxis: [1, 0, 0], physicalElementId: "slab-" + (i >> 9) });
  return { schemaVersion: 1, units: "SI", nodes, frameElements: frames, shellElements: shells };
}
// Serialización canónica: claves ordenadas, sin espacios. (−0 y NaN deben resolverse ANTES.)
function canonico(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonico(v[k])).join(",") + "}";
}
async function sha(buf) { const d = await crypto.subtle.digest("SHA-256", buf); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

window.huella = async function (nNodos = 20000, nFrames = 25000, nShells = 40000) {
  const m = modeloAnalitico(nNodos, nFrames, nShells);
  let t = now(); const s = canonico(m); const tCanon = now() - t;
  t = now(); const s2 = JSON.stringify(m); const tStringify = now() - t;
  t = now(); const bytes = new TextEncoder().encode(s); const tEnc = now() - t;
  t = now(); const h = await sha(bytes); const tSha = now() - t;
  // alternativa: hash de buffers tipados (posiciones + conectividad) sin JSON
  const pos = new Float64Array(nNodos * 3); m.nodes.forEach((n, i) => pos.set(n.position, i * 3));
  const con = new Int32Array(nShells * 3 + nFrames * 2);
  t = now(); const hb = await sha(new Uint8Array(await new Blob([pos, con]).arrayBuffer())); const tShaBuf = now() - t;
  return { nNodos, nFrames, nShells, MBjson: r1(bytes.length / 1048576), msCanonico: r1(tCanon), msStringifyPlano: r1(tStringify), msTextEncoder: r1(tEnc), msSha256: r1(tSha), msTotalJsonCanonico: r1(tCanon + tEnc + tSha), MBbuffers: r1((pos.byteLength + con.byteLength) / 1048576), msShaBuffers: r1(tShaBuf), huella: h.slice(0, 16), huellaBuf: hb.slice(0, 16), igualTrasRepetir: (await sha(new TextEncoder().encode(canonico(m)))) === h, stringifyPlanoIgualCanonico: s === s2 };
};

// ------------------------------------------------------------ Worker: copia vs transferencia vs JSON
const workerSrc = `
self.onmessage = (e) => {
  const { modo, data } = e.data;
  if (modo === 'json') { const a = JSON.parse(data); self.postMessage({ modo, n: a.length }); return; }
  if (modo === 'eco-transfer') { self.postMessage({ modo, data }, [data.buffer]); return; }
  self.postMessage({ modo, n: data.length });
};`;
window.transferencia = async function (nDoubles = 6_000_000) {
  const w = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: "text/javascript" })));
  const ida = (msg, transfer) => new Promise((res) => { w.onmessage = (e) => res(e.data); w.postMessage(msg, transfer || []); });
  const out = { MB: r1((nDoubles * 8) / 1048576) };
  let a = new Float64Array(nDoubles).map((_, i) => i * 0.001);
  let t = now(); await ida({ modo: "copia", data: a }); out.msCopiaIda = r1(now() - t);
  t = now(); await ida({ modo: "transfer", data: a }, [a.buffer]); out.msTransferIda = r1(now() - t);
  out.byteLengthTrasTransferir = a.byteLength; // 0 = detached
  a = new Float64Array(nDoubles).map((_, i) => i * 0.001);
  t = now(); const s = JSON.stringify(Array.from(a)); out.msStringify = r1(now() - t); out.MBjson = r1(s.length / 1048576);
  t = now(); await ida({ modo: "json", data: s }); out.msJsonIdaYParseEnWorker = r1(now() - t);
  t = now(); JSON.parse(s); out.msJsonParseEnHiloPrincipal = r1(now() - t);
  // eco con transferencia de vuelta (lo que haría el worker FEM al devolver resultados)
  t = now(); const eco = await ida({ modo: "eco-transfer", data: a }, [a.buffer]); out.msEcoTransfer = r1(now() - t); out.ecoLongitud = eco.data.length;
  w.terminate();
  return out;
};

// ------------------------------------------------------------ IndexedDB
function abrir() {
  return new Promise((res, rej) => { const r = indexedDB.open("fem3d-bench", 1); r.onupgradeneeded = () => r.result.createObjectStore("res", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function tx(db, modo, f) { return new Promise((res, rej) => { const t = db.transaction("res", modo); const leer = f(t.objectStore("res")); t.oncomplete = () => res(leer && leer()); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); }
window.idb = async function (nDoubles = 6_000_000) {
  const db = await abrir();
  const a = new Float64Array(nDoubles).map((_, i) => Math.sin(i));
  let t = now(); await tx(db, "readwrite", (s) => { s.put({ id: "caso-1", huella: "abc", bytes: a.buffer }); }); const tW = now() - t;
  t = now(); const r = await tx(db, "readonly", (s) => { const q = s.get("caso-1"); return () => q.result; }); const tR = now() - t;
  const ok = new Float64Array(r.bytes)[12345] === a[12345];
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const persistido = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  db.close(); indexedDB.deleteDatabase("fem3d-bench");
  return { MB: r1(a.byteLength / 1048576), msEscribir: r1(tW), msLeer: r1(tR), integro: ok, cuotaEstimadaGB: est ? r1(est.quota / 1e9) : null, usoMB: est ? r1(est.usage / 1048576) : null, persisted: persistido };
};

// ------------------------------------------------------------ long tasks
window.longTasks = async function () {
  const tareas = [];
  const obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => tareas.push(r1(e.duration))));
  obs.observe({ type: "longtask", buffered: true });
  // provocar una: JSON.parse de 2M doubles en el hilo principal
  const s = JSON.stringify(Array.from(new Float64Array(2_000_000).map((_, i) => i / 7)));
  await new Promise((r) => setTimeout(r, 50));
  JSON.parse(s);
  await new Promise((r) => setTimeout(r, 200));
  obs.disconnect();
  return { soportado: PerformanceObserver.supportedEntryTypes.includes("longtask"), loaf: PerformanceObserver.supportedEntryTypes.includes("long-animation-frame"), tareasMs: tareas };
};

window.todo = async function () {
  return {
    ua: navigator.userAgent, crossOriginIsolated: self.crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory,
    localStorageAscii: window.cuotaLocalStorage("a"), localStorageNoAscii: window.cuotaLocalStorage("ñ"),
    huellaMedio: await window.huella(20000, 25000, 40000), huellaPequeno: await window.huella(2000, 2500, 4000),
    transferencia: await window.transferencia(), idb: await window.idb(), longTasks: await window.longTasks(),
  };
};
