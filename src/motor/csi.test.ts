/**
 * Criterio 1 de E6: los ejemplos de verificación de barras de CSI (H48), SAP2000 1-004, 1-018,
 * 1-022 y 1-024, con los valores de sus PDF. Modelos y fuentes en validacion/e6/csi.ts; los valores
 * medidos, en validacion/e6/out_csi.txt.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { dentroDelRedondeo, resultados1022, resultados1024, sap1004, sap1018, sap1024, type Publicado } from "../../validacion/e6/csi.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { flexibilidad } from "../pruebas/modal.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function comprobarPublicados(lista: Publicado[]): void {
  for (const p of lista) expect(dentroDelRedondeo(p), `${p.nombre}: motor ${p.motor}, publicado ${p.valor} (${p.fuente})`).toBe(true);
}

const errorCerrada = (p: Publicado) => Math.abs((p.motor - p.cerrada!) / p.cerrada!);

describe("criterio 1 de E6: ejemplos de barras de CSI", () => {
  it("SAP2000 1-004 (ejes locales girados 30°): los 6 valores publicados y la solución cerrada a ≤ 1e-10", () => {
    const { resultados } = sap1004();
    comprobarPublicados(resultados);
    for (const p of resultados) expect(errorCerrada(p), p.nombre).toBeLessThan(1e-10);
  });

  it("SAP2000 1-018 (flexión, cortante y axil): los modelos A–D y la solución cerrada", () => {
    const { resultados } = sap1018();
    comprobarPublicados(resultados);
    // B lleva el axil ×1e4 (una penalización): pierde cifras y se queda en ~2e-9 (E6-1)
    for (const p of resultados) expect(errorCerrada(p), p.nombre).toBeLessThan(p.nombre.includes("modelo B") ? 1e-8 : 1e-10);
  });

  it("SAP2000 1-022 (pórtico plano de 7 plantas): caso LAT con los signos de SAP2000, los 7 periodos y el espectro", () => {
    comprobarPublicados(resultados1022());
  });

  it("SAP2000 1-024 (pórtico 3D con masa excéntrica): 4 periodos y la flecha con CQC, SRSS, ABS y NRC 10 %", () => {
    comprobarPublicados(resultados1024());
  });

  it("la flexibilidad condensada es simétrica (Betti) a ≤ 1e-12", () => {
    const { modelo, masas } = sap1024();
    const F = flexibilidad(modelo, masas);
    const escala = Math.max(...F.flat().map(Math.abs));
    for (let i = 0; i < F.length; i++) for (let j = 0; j < i; j++) expect(Math.abs(F[i]![j]! - F[j]![i]!) / escala).toBeLessThan(1e-12);
  });
});
