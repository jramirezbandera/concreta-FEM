// PB-8 en un modelo mínimo: el 2 × 2 de PB (`recuadros`) con el pilar de esquina P0-0 de 40 × 40 y su
// esquina fija en el cruce de los ejes de las vigas, como P1 en la F1 del ejemplo 11 con punto fijo.
// Da el mx (caso Q) del metro de la franja L-N1:X1 en su cara (x = 0,4) con cada h.
//   bun validacion/pb5/pb8min.ts <h>[/<eps>] [<h> ...]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { Sesion } from "../../src/visor/sesion.ts";
import { recuadros } from "../pb/modelos.ts";
export function modeloPB8() {
  const m = recuadros(2, 2) as any;
  m.secciones.push({ id: "P40", material: "HA-25", forma: "rectangular", b: 0.4, h: 0.4 });
  const p = m.pilares.find((x: any) => x.id === "P0-0");
  p.seccion = "P40";
  p.fijo = "esquina-inferior-izquierda";
  return m;
}
const WASM = readFileSync(join(import.meta.dirname, "../../src/nucleo/pkg/nucleo_bg.wasm"));
if (import.meta.main) {
  await iniciarNucleo(WASM);
  for (const hA of process.argv.slice(2)) {
    const [th, te] = hA.split("/");
    const proyecto = { esquema: "concreta-fem/proyecto@1", nombre: "x", modelo: modeloPB8(), opciones: { tamanoMalla: Number(th), ...(te ? { epsSnap: Number(te) } : {}) } };
    const s = Sesion.abrir(JSON.stringify(proyecto), sha256(new Uint8Array(WASM))).sesion;
    await s.calcular();
    for (const f of ["L-N1:X1", "L-N1:Y1"]) {
      const r = s.q!.franja(f);
      const e = r.valor.estaciones.find((x: any) => x.tipo === "cara" && x.piezas.includes("P0-0") && Math.abs(x.s - 0.4) < 1e-6);
      console.log(hA, f, e ? `${e.metodo} mx ${e.medios[3].toFixed(2)} my ${e.medios[4].toFixed(2)} mxy ${e.medios[5].toFixed(2)} avisos ${e.diagnosticos.map((d: any) => d.codigo).join(",")}` : "sin estación");
    }
  }
}
