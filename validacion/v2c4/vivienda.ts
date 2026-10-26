/**
 * El lector de DXF frente a ezdxf con el DXF de la vivienda (V2c-4, `docs/fem3d/dibujo.md` §10.4,
 * criterio 1), que no se sube (datos del cliente):
 *
 *   bun validacion/v2c4/vivienda.ts [ruta.dxf]      escribe validacion/v2c4/out_vivienda.txt
 *
 * Por defecto lee `ejemplos/Proyectos/modelo.dxf`. El oráculo (`oraculo_dxf.py oraculo`) va a una
 * carpeta temporal; la salida sólo lleva los recuentos y la mayor diferencia, no la geometría.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dibujoDxf } from "../../src/dxf/aplanar.ts";
import { compararConEzdxf, type OraculoEzdxf } from "../../src/dxf/comparar.ts";

const raiz = join(import.meta.dirname, "..", "..");
const ruta = process.argv[2] ?? join(raiz, "ejemplos", "Proyectos", "modelo.dxf");
const tmp = mkdtempSync(join(tmpdir(), "v2c4-"));
const lineas: string[] = [];
const decir = (s: string) => {
  console.log(s);
  lineas.push(s);
};

try {
  const python = join(raiz, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const json = join(tmp, "oraculo.json");
  let t = performance.now();
  execFileSync(python, ["-I", join(import.meta.dirname, "oraculo_dxf.py"), "oraculo", ruta, json], { stdio: "inherit" });
  const tPy = performance.now() - t;
  const bytes = new Uint8Array(readFileSync(ruta));
  t = performance.now();
  const d = dibujoDxf(bytes);
  const tTs = performance.now() - t;
  const r = compararConEzdxf(d, JSON.parse(readFileSync(json, "utf8")) as OraculoEzdxf);

  decir(`V2c-4, criterio 1: el lector frente a ezdxf 1.4.5 con el DXF de la vivienda (${(bytes.length / 1024).toFixed(0)} kB, ${d.version}, ${d.codificacion}, $INSUNITS ${d.insunits})`);
  decir("");
  decir(`Leído en ${tTs.toFixed(1)} ms (ezdxf, con Python: ${(tPy / 1000).toFixed(1)} s).`);
  decir(`Capas: ${d.capas.map((c) => `${c.nombre} (${c.entidades}${c.oculta ? ", oculta" : ""})`).join(", ")}`);
  decir(`Segmentos rectos ${r.segmentos}, puntos para enganchar ${r.puntos}, puntos de curvas ${r.curvas}, textos ${r.textos}.`);
  decir(`Sin leer: ${JSON.stringify(d.ignoradas)}; avisos: ${d.avisos.length ? d.avisos.join(" | ") : "ninguno"}.`);
  decir(`Extensión: ${d.extension?.map((x) => x.toFixed(3)).join(", ")}`);
  decir(`Mayor diferencia relativa de lo emparejado: ${r.maximo.toExponential(2)}`);
  decir("");
  decir(r.fallos.length ? `FALLA:\n  ${r.fallos.join("\n  ")}` : "Pasa: todo coincide con ezdxf a ≤ 1e-9.");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
writeFileSync(join(import.meta.dirname, "out_vivienda.txt"), lineas.join("\n") + "\n");
