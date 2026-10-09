/**
 * Criterio 3 de A4 (`docs/fem3d/agente.md` §10): en los edificios objetivo de 7 plantas, el tiempo
 * de cada vista por planta (escena, SVG y PNG, con el cálculo hecho), el tamaño de las imágenes y
 * el de `informe.html`.
 *
 *   bun validacion/a4/banco.ts > validacion/a4/out_banco.txt
 */
import { cpus } from "node:os";
import { conjuntoPorDefecto, escenaASvg, ResultadosRender, VISTAS, vistaAxiles, vistaCampo, vistaCargas, vistaDiagnosticos, vistaDiagramas, vistaMalla, vistaModelo, type Campo, type Escena, type Vista } from "../../src/agente/render/index.ts";
import { resumen } from "../../src/agente/consultas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { svgAPng } from "../../cli/png.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioObjetivoMuros } from "../c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../c4/modelos.ts";
import { prepararNucleo, proyectoDe, revisarProyecto } from "../a3/revisar.ts";

const MODELOS: [string, ModeloFisico][] = [
  ["losas y vigas", edificioObjetivoLosas()],
  ["muros", edificioObjetivoMuros()],
  ["reticular", edificioReticular()],
  ["unidireccional", edificioUnidireccional()],
];

await prepararNucleo();
console.log(`# validacion/a4/banco.ts — ${new Date().toISOString().slice(0, 10)}, ${cpus()[0]?.model.trim()}, Bun ${process.versions.bun}`);
console.log("# Segundos por planta y vista: el peor de las plantas (escena + SVG + PNG). Tamaños: el mayor SVG y PNG.");
let peor = 0;
for (const [nombre, f] of MODELOS) {
  const t0 = performance.now();
  const c = compilar(f);
  if (!c.valido) throw new Error(nombre);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(nombre);
  const q = new Consultas(f, c, k.casos);
  const res = resumen(proyectoDe(f), c);
  if (!res.valido) throw new Error(nombre);
  const r = new ResultadosRender(q, c);
  const cj = { desplazamientos: conjuntoPorDefecto(q, res.valor, "desplazamientos"), esfuerzos: conjuntoPorDefecto(q, res.valor, "esfuerzos") };
  console.log(`\n## ${nombre}: ${c.modelo.nudos.length} nudos, compilar y calcular ${((performance.now() - t0) / 1000).toFixed(1)} s; combinaciones: ${cj.esfuerzos.descripcion}`);
  const d = { huella: c.huella };
  const escena = (v: Vista, planta: string): Escena[] => {
    switch (v) {
      case "modelo":
        return [vistaModelo(f, planta, d)];
      case "cargas":
        return f.casos.map((x) => vistaCargas(f, planta, x.id, d));
      case "diagnosticos":
        return [vistaDiagnosticos(f, planta, c.diagnosticos, d)];
      case "malla":
        return [vistaMalla(r, planta, d)];
      case "vigas-my":
      case "vigas-vz":
        return [vistaDiagramas(r, planta, v === "vigas-my" ? "My" : "Vz", cj.esfuerzos, d)];
      case "pilares-n":
        return [vistaAxiles(r, planta, cj.esfuerzos, d)];
      default:
        return [vistaCampo(r, planta, v as Campo, v === "uz" ? cj.desplazamientos : cj.esfuerzos, d)];
    }
  };
  console.log("vista          peor s   planta   SVG KB   PNG KB   lado px");
  for (const v of VISTAS) {
    let [tmax, pmax, svgMax, pngMax, lado] = [0, "", 0, 0, 0];
    for (const pl of f.plantas) {
      const t = performance.now();
      const es = escena(v, pl.id);
      let n = 0;
      for (const e of es) {
        const s = escenaASvg(e);
        const png = await svgAPng(s.svg);
        svgMax = Math.max(svgMax, s.svg.length);
        pngMax = Math.max(pngMax, png.length);
        lado = Math.max(lado, s.encuadre.ancho, s.encuadre.alto);
        n++;
      }
      // cargas: por caso
      const dt = (performance.now() - t) / 1000 / Math.max(1, n);
      if (dt > tmax) [tmax, pmax] = [dt, pl.id];
    }
    peor = Math.max(peor, tmax);
    console.log(`${v.padEnd(14)} ${tmax.toFixed(2).padStart(6)}   ${pmax.padEnd(6)} ${(svgMax / 1024).toFixed(0).padStart(7)} ${(pngMax / 1024).toFixed(0).padStart(8)} ${String(lado).padStart(9)}`);
  }
  const rev = revisarProyecto(proyectoDe(f));
  if (!rev.valido) throw new Error(nombre);
  console.log(`informe.html: ${(rev.revision.html.length / 1024 / 1024).toFixed(2)} MB (${rev.revision.documento.filter((b) => b.tipo === "figura").length} figuras); revisar ${rev.segundos.toFixed(1)} s`);
}
console.log(`\nPeor tiempo por planta y vista: ${peor.toFixed(2)} s (criterio: ≤ 2 s)`);
