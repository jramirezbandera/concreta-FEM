/**
 * Worker de las plantillas DXF (V2c-4, `docs/fem3d/dibujo.md` §10): lee un DXF (`src/dxf/`) sin
 * parar la página. Los arrays de lo leído vuelven por Transferable.
 */
import { dibujoDxf, type DibujoDxf } from "../../../src/dxf/aplanar.ts";
import { ErrorDxf } from "../../../src/dxf/lector.ts";

export type PedidoDxf = { id: number; bytes: Uint8Array };
export type RespuestaDxf = { id: number; ok: true; dibujo: DibujoDxf } | { id: number; ok: false; mensaje: string };

interface AmbitoWorker {
  onmessage: ((e: MessageEvent<PedidoDxf>) => void) | null;
  postMessage(m: RespuestaDxf, transferir?: Transferable[]): void;
}

const ambito = globalThis as unknown as AmbitoWorker;

ambito.onmessage = (e) => {
  const { id, bytes } = e.data;
  try {
    const d = dibujoDxf(bytes);
    const arrays = [d.grupos, d.lineas, d.grupoLineas, d.curvas, d.grupoCurvas, d.puntos, d.tipoPuntos, d.grupoPuntos];
    ambito.postMessage({ id, ok: true, dibujo: d }, arrays.map((a) => a.buffer));
  } catch (x) {
    ambito.postMessage({ id, ok: false, mensaje: x instanceof ErrorDxf ? x.message : `No se pudo leer el DXF: ${x instanceof Error ? x.message : String(x)}` });
  }
};
