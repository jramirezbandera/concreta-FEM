// Depuración de PB-5: mx, my y mxy medios (caso Q) de una estación de franja con el código de una carpeta
//   bun validacion/pb5/estacion.ts <raíz> <franja> <s> <h>[/<eps>] [<pilar>] [interiores]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { recuadros } from "../pb/modelos.ts";
const [raizA, fr, sA, hA, pA, intA] = process.argv.slice(2);
const raiz = resolve(raizA!);
const { sha256 } = await import(join(raiz, "src/compilador/huella.ts"));
const { iniciarNucleo } = await import(join(raiz, "src/nucleo/index.ts"));
const { Sesion } = await import(join(raiz, "src/visor/sesion.ts"));
const WASM = readFileSync(join(raiz, "src/nucleo/pkg/nucleo_bg.wasm"));
await iniciarNucleo(WASM);
const [th, te] = hA!.split("/");
const fis = pA === "pf" ? structuredClone((await import("../sombra/ejemplo11/modelo.ts")).modelo("pf").modelo) : recuadros(2, 2, { pilar: JSON.parse(pA ?? "0.45"), interiores: intA === "interiores" });
const proyecto = { esquema: "concreta-fem/proyecto@1", nombre: "x", modelo: fis, opciones: { tamanoMalla: Number(th), ...(te ? { epsSnap: Number(te) } : {}) } };
const a = Sesion.abrir(JSON.stringify(proyecto), sha256(new Uint8Array(WASM)));
const s = a.sesion;
await s.calcular();
const r = s.q!.franja(fr!);
for (const e of r.valor.estaciones) {
  if (Math.abs(e.s - Number(sA)) > 1e-6 || e.tipo === "paso") continue;
  const nc = e.medios.length / 3;
  const m = [...e.medios].map((x: number) => x.toFixed(2));
  console.log(hA, e.valido, JSON.stringify(e.diagnosticos.map((d: any) => d.codigo)), e.tipo, e.lado, e.metodo, "dist", e.distanciaMuestras.toFixed(3), "ventana", e.ventana?.map((x: number) => x.toFixed(3)), "ancho", e.anchoEnLosa.toFixed(3), "Q [mx,my,mxy]:", m.slice(3, 6).join(" "), "G:", m.slice(0, 3).join(" "), nc);
}
