/**
 * Las muestras de ACadSharp (fase DW, `docs/fem3d/dwg.md` §4 y DW-d): el mismo dibujo guardado por
 * AutoCAD en cada versión de DWG, con su DXF ASCII al lado. No se versionan (~25 MB): este script
 * las descarga del commit fijado, comprueba su sha256 y las deja en `validacion/dwg/.muestras/`.
 *
 *   bun validacion/dwg/muestras.ts
 *
 * Si ya están y su sha256 cuadra, no descarga nada. Lo usa también el CI.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const COMMIT_ACADSHARP = "d9f3de8c9910b602d392aa1acc72b62c095ec40e";

/** Nombre → sha256 de los bytes de GitHub (los DXF, con LF: un clon con `core.autocrlf` los cambia). Medido el 2026-11-05. */
export const MUESTRAS: Readonly<Record<string, string>> = {
  "sample_AC1014.dwg": "d1ec4519be14ac49ecab5ec024ad951271e00261a1851f623a784a97ba6ede73",
  "sample_AC1015.dwg": "8ffbdc713f5838cbbb1596a8422e2b607e5c9e79921e852cbb5abee4af76ea4e",
  "sample_AC1015_ascii.dxf": "4f7d7f0d3957d4d32c6c43e4c600eea8e90fc0fcb1b36b11256095a9789a923f",
  "sample_AC1018.dwg": "7d26f908516ec5fb89cc8054af33aff233b68a7b63208bbc5b7f9f4d9bff9866",
  "sample_AC1018_ascii.dxf": "71117bafa8f0d9816607768c8fb21676c83f99892c537711a68c24aa7e06e798",
  "sample_AC1021.dwg": "70b5efec9a3c230a9892e810154a760fe72311b1e730fb582f22950135da770a",
  "sample_AC1021_ascii.dxf": "39ebdd9a48fef7a6240a04e3b5ca6d45ba5bb30b560fb9dadf26774e1af83731",
  "sample_AC1024.dwg": "53ecc28e54ff0bbfb022989c47fd1cb16eb07a98825309b66cdf316d900fe4ce",
  "sample_AC1024_ascii.dxf": "c97e857047ad4cecd84754ea1a8638e47508e339fd489f1e895ee7332127b372",
  "sample_AC1027.dwg": "4c63508dd794d5cdfb56c60aded47928999b02619ea8c2ef435a4b74e60d24d6",
  "sample_AC1027_ascii.dxf": "4f26752008643642c37f7bab410b23cfd8b6dd9ee3aaa19746b612ea956b61e6",
  "sample_AC1032.dwg": "0e8faaca949c9429c92240082d9ea4d3524aca5baf7c7815ec439245c321b528",
  "sample_AC1032_ascii.dxf": "c2934f616ecd7097e773b85e5d6e0548d21ccc635abcc8e7276f7d4a585a7ae2",
};

export const CARPETA_MUESTRAS = join(dirname(fileURLToPath(import.meta.url)), ".muestras");

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** La muestra n, comprobada; o un error que dice cómo traerla. */
export function muestra(n: string): Uint8Array {
  const esperado = MUESTRAS[n];
  if (!esperado) throw new Error(`No hay ninguna muestra ${n}.`);
  const ruta = join(CARPETA_MUESTRAS, n);
  if (!existsSync(ruta)) throw new Error(`Falta la muestra ${n}: tráela con «bun validacion/dwg/muestras.ts».`);
  const b = new Uint8Array(readFileSync(ruta));
  if (sha256(b) !== esperado) throw new Error(`La muestra ${n} no tiene su sha256: vuelve a traerla con «bun validacion/dwg/muestras.ts».`);
  return b;
}

async function descargar(): Promise<void> {
  mkdirSync(CARPETA_MUESTRAS, { recursive: true });
  for (const [n, esperado] of Object.entries(MUESTRAS)) {
    const ruta = join(CARPETA_MUESTRAS, n);
    if (existsSync(ruta) && sha256(new Uint8Array(readFileSync(ruta))) === esperado) {
      console.log(`${n}: ya está`);
      continue;
    }
    const url = `https://raw.githubusercontent.com/DomCR/ACadSharp/${COMMIT_ACADSHARP}/samples/${n}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
    const b = new Uint8Array(await r.arrayBuffer());
    const h = sha256(b);
    if (h !== esperado) throw new Error(`${n}: sha256 ${h}, se esperaba ${esperado}`);
    writeFileSync(ruta, b);
    console.log(`${n}: ${b.length} bytes`);
  }
}

if (import.meta.main) await descargar();
