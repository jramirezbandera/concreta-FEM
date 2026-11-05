/**
 * DWG dañados (fase DW, `docs/fem3d/dwg.md` §5, criterio 4): las muestras con 1 a 4 bytes cambiados
 * al azar, 2 000 veces por versión. En cada una, o lo dice (`ErrorDxf` o un objeto en `fallos`) o
 * sale exactamente el mismo dibujo aplanado; cualquier otra cosa es un fallo.
 *
 *   bun validacion/dwg/danados.ts [veces]
 *
 * La prueba de vitest (`src/dwg/dwg.test.ts`) hace una tanda de 300; ésta es la larga.
 */
import { aplanarDxf, type DibujoDxf } from "../../src/dxf/aplanar.ts";
import { ErrorDxf } from "../../src/dxf/lector.ts";
import { leerDwg } from "../../src/dwg/lector.ts";
import { muestra } from "./muestras.ts";

const veces = Number(process.argv[2] ?? 2000);
const firma = (d: DibujoDxf) => JSON.stringify(d, (_, x) => (ArrayBuffer.isView(x) ? Array.from(x as Float64Array) : x));
let malos = 0;

for (const v of ["AC1014", "AC1015"]) {
  const original = muestra(`sample_${v}.dwg`);
  const bien = firma(aplanarDxf(leerDwg(original)));
  let semilla = 7;
  const azar = () => {
    semilla = (semilla * 1103515245 + 12345) >>> 0;
    return semilla / 2 ** 32;
  };
  const r = { error: 0, conFallos: 0, igual: 0, distintoSinAviso: 0, otraExcepcion: 0 };
  let maximo = 0;
  for (let k = 0; k < veces; k++) {
    const b = original.slice();
    for (let i = 0, n = 1 + Math.floor(azar() * 4); i < n; i++) b[Math.floor(azar() * b.length)]! ^= 1 + Math.floor(azar() * 255);
    const t0 = performance.now();
    try {
      const d = leerDwg(b);
      if (d.fallos.length > 0) r.conFallos++;
      else if (firma(aplanarDxf(d)) === bien) r.igual++;
      else r.distintoSinAviso++;
    } catch (e) {
      if (e instanceof ErrorDxf) r.error++;
      else {
        r.otraExcepcion++;
        console.log(`${v} #${k}:`, e);
      }
    }
    maximo = Math.max(maximo, performance.now() - t0);
  }
  console.log(`${v}: ${veces} ficheros → ErrorDxf ${r.error}, con objetos en fallos ${r.conFallos}, el mismo dibujo ${r.igual}, distinto sin aviso ${r.distintoSinAviso}, otra excepción ${r.otraExcepcion} (el más lento, ${maximo.toFixed(0)} ms)`);
  malos += r.distintoSinAviso + r.otraExcepcion;
}

console.log(malos === 0 ? "Pasa." : `NO PASA: ${malos}.`);
if (malos > 0) process.exitCode = 1;
