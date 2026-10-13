/**
 * Fase F, criterio 4 (`docs/fem3d/franjas.md`): convergencia con la malla del momento de la franja en
 * la cara de un pilar interior (el metro centrado en él, F-h) y en la de la franja vecina, en la losa
 * plana de 3 × 3 vanos de los tests (pilares de 30 × 30, q = 10 kN/m²), con h de 0,75 a 0,1875.
 *
 * Uso: bun validacion/f/convergencia.ts [anchos, p. ej. 1,0.5] → validacion/f/out_convergencia.txt
 */
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico } from "../../src/compilador/fisico.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const pilares = [];
for (const x of [0, 6, 12, 18]) for (const y of [0, 5, 10, 15]) pilares.push({ id: `P${x}-${y}`, x, y, desde: "C", hasta: "P1", seccion: "p" });
const f: ModeloFisico = {
  plantas: [{ id: "P1", altura: null }, { id: "C", tipo: "sotano", altura: 3 }],
  materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
  secciones: [{ id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
  pilares,
  losas: [{ id: "L", planta: "P1", contorno: [[-0.5, -0.5], [18.5, -0.5], [18.5, 15.5], [-0.5, 15.5]], espesor: 0.25, material: "HA" }],
  casos: [{ id: "Q" }],
  cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -10] }],
};
const anchos = (process.argv[2] ?? "1,0.5").split(",").map(Number);
const filas: (number | string)[][] = [];
for (const ancho of anchos)
  for (const h of [0.75, 0.5, 0.375, 0.25, 0.1875]) {
    const op = { tamanoMalla: h, anchoFranja: ancho };
    const r = compilar(f, op);
    if (!r.valido) throw new Error("no");
    const casos = casosValidos(calcular(r.modelo));
    const ef = new EsfuerzosFranjas(validar(f, resolverOpciones(op), new Diagnosticos())!, r, casos, { cortes: new Cortes(r.modelo) });
    // La cara x = 6,15 (lado +1) del pilar P6-5: la franja X que lo toca (ventana) y su vecina
    const fx = ef.franjas("L").filter((x) => x.direccion === 1);
    const v = fx.flatMap((x) => ef.estaciones(x.id)!.estaciones.map((e) => ({ x, e }))).filter(({ e }) => e.tipo === "cara" && Math.abs(e.s - 6.15) < 1e-9 && e.lado === 1);
    const ven = v.find(({ e }) => e.ventana && e.piezas.includes("P6-5"))!;
    const t = (ven.e.ventana![0] + ven.e.ventana![1]) / 2;
    const vec = v.find(({ x }) => x.t0 > t + 0.5)!;
    filas.push([ancho, h, r.modelo.nudos.length, ven.e.medios[0]!, vec.e.medios[0]!, vec.x.id]);
  }
const lineas = ["# Fase F: convergencia del momento en la cara de un pilar interior (P6-5, cara x = 6,15)", "", "ancho (m) | h (m) | nudos | mx del metro centrado en el pilar (kN·m/m) | frente al de h = 0,1875 | mx de la franja vecina | frente al de h = 0,1875"];
for (const [ancho, h, nn, v, w, id] of filas) {
  const ref = filas.find((x) => x[0] === ancho && x[1] === 0.1875)!;
  lineas.push(`${ancho} | ${h} | ${nn} | ${(v as number).toFixed(2)} | ${(100 * ((v as number) / (ref[3] as number) - 1)).toFixed(1)} % | ${(w as number).toFixed(2)} (${id}) | ${(100 * ((w as number) / (ref[4] as number) - 1)).toFixed(1)} %`);
}
const texto = lineas.join("\n") + "\n";
console.log(texto);
writeFileSync(join(import.meta.dirname, "out_convergencia.txt"), texto);
