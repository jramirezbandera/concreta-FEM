/**
 * SVG → PNG para `fem render` (A4, `docs/fem3d/agente.md` §10), con @resvg/resvg-wasm (MPL-2.0) y
 * las fuentes Roboto 2.138 (Apache-2.0) de `cli/fuentes/`, sin fuentes del sistema: el mismo SVG da
 * el mismo PNG en cualquier máquina. Las fuentes se comprueban por su sha256 al cargarlas.
 *
 * Es IO (lee el WASM y las fuentes), así que vive en la CLI y no en `src/agente/`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

export const FUENTES: Record<string, string> = {
  "Roboto-Regular.ttf": "f3edb8058e523f5612bfd99d0745e661568ad85e1b6217bc62f786fabae624c6",
  "Roboto-Bold.ttf": "2ca2b3bfc2c2d43fa8f2b7227982d735fd537ecf113a4c56cc2d292bcc3106c8",
};

let listo: Promise<Uint8Array[]> | null = null;

function iniciar(): Promise<Uint8Array[]> {
  return (listo ??= (async () => {
    const wasm = readFileSync(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm"));
    await initWasm(wasm);
    return Object.entries(FUENTES).map(([nombre, sha]) => {
      const b = new Uint8Array(readFileSync(join(import.meta.dirname, "fuentes", nombre)));
      const h = createHash("sha256").update(b).digest("hex");
      if (h !== sha) throw new Error(`cli/fuentes/${nombre} no es la versionada (sha256 ${h})`);
      return b;
    });
  })());
}

export async function svgAPng(svg: string): Promise<Uint8Array> {
  const fontBuffers = await iniciar();
  const r = new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: "Roboto" }, shapeRendering: 2, textRendering: 1, imageRendering: 0 });
  const img = r.render();
  const png = img.asPng();
  img.free();
  r.free();
  return png;
}
