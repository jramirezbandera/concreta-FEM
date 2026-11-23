/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.16): el armado en barras de las losas, en el 3D. Los
 * refuerzos de cada losa (`armado.forjados`), barra a barra, en la cota de su cara: los superiores a
 * un recubrimiento de la cara de arriba, en rojo, y los inferiores a uno de la de abajo, en azul; y el
 * contorno de lo que cubre cada uno (rellenarlo taparía las barras). Con la estructura de los diagramas del 3D (`Diagramas3D`): los
 * superiores van como «positivos» y los inferiores como «negativos», que se pintan con esos colores.
 *
 * - Una armadura por separación (maciza, ábacos): una barra cada separación de lado a lado del
 *   refuerzo. Una por nervio (reticular): una barra por cada nervio paralelo a las barras que cae en
 *   el refuerzo, en el eje del nervio.
 * - Todo recortado con la losa. La base no se dibuja (es de toda la losa: está en la leyenda de la
 *   planta).
 *
 * Las coordenadas, en Float32 respecto a `origen` (el del alámbrico), Z hacia arriba. Puro: sin IO.
 */
import type { ArmadoProyecto } from "../agente/armaduraBase.ts";
import { regionesLosas, trozosEnLosa } from "../agente/render/armado.ts";
import { nerviosLosa } from "../compilador/abacos.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { DATOS_ARMADO, type ArmadoForjado, type DatosArmado } from "../comprobaciones/armado.ts";
import { refuerzosDibujados } from "../comprobaciones/dibujoArmado.ts";
import type { CaraDibujada } from "./armadoPlanta.ts";
import type { Diagramas3D } from "./diagramas3d.ts";

/** Como mucho, tantas barras por refuerzo (con más, una de cada k: el dibujo sólo enseña dónde van). */
const BARRAS_MAXIMAS = 120;

/** El armado de las losas de una planta (null: todas) en el 3D. */
export function armadoLosas3D(f: ModeloFisico, origen: [number, number, number], armado: ArmadoProyecto | undefined, datos: DatosArmado | undefined, o: { planta: string | null; cara?: CaraDibujada }): Diagramas3D {
  const cara = o.cara ?? "todas";
  const rec = (datos?.recubrimiento ?? DATOS_ARMADO.recubrimiento) / 1000;
  // La cara de arriba de cada losa: la cota de su planta más su desnivel (como el sólido)
  const cotas = cotasPlantas(f.plantas ?? []);
  const indice = new Map((f.plantas ?? []).map((p, i) => [p.id, i]));
  const regiones = regionesLosas(f.losas);
  const lineas: number[] = [];
  const signo: number[] = [];
  const rel = (p: Vec2, zz: number, a: number[]) => a.push(p[0] - origen[0], p[1] - origen[1], zz - origen[2]);
  let refuerzos = 0;
  let losas = 0;
  for (const l of f.losas ?? []) {
    if (o.planta !== null && l.planta !== o.planta) continue;
    const a = armado?.forjados?.[l.id] as ArmadoForjado | undefined;
    const cota = cotas[indice.get(l.planta) ?? -1];
    if (!a || cota === null || cota === undefined) continue;
    const arriba = cota + (l.desnivel ?? 0);
    const region = regiones.get(l.id);
    const nervios = l.reticular ? nerviosLosa(l) : [];
    let algo = false;
    for (const x of refuerzosDibujados(l.eje1, a)) {
      if (cara !== "todas" && x.cara !== cara) continue;
      const superior = x.cara === "superior";
      const zz = superior ? arriba - rec : arriba - l.espesor + rec;
      algo = true;
      refuerzos++;
      const tramo = (p: Vec2, q: Vec2) => {
        rel(p, zz, lineas);
        rel(q, zz, lineas);
        signo.push(superior ? 1 : 0);
      };
      // Lo que cubre: su contorno, en lo que cae en la losa
      for (let i = 0; i < 4; i++) for (const [p, q] of trozosEnLosa(region, x.zona[i]!, x.zona[(i + 1) % 4]!)) tramo(p, q);
      // Las barras: en t, cada separación o en los nervios paralelos a ellas
      const ts: number[] = [];
      const barras = a.refuerzos?.[x.indice]?.barras;
      if (barras && "n" in barras && barras.n !== undefined && nervios.length) {
        for (const [p, q] of nervios) {
          const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
          const L = Math.hypot(dx, dy);
          if (!(L > 0) || Math.abs(dx * x.n[0] + dy * x.n[1]) > 1e-6 * L) continue;
          const t = p[0] * x.n[0] + p[1] * x.n[1];
          if (t >= x.t[0] - 1e-6 && t <= x.t[1] + 1e-6 && !ts.some((u) => Math.abs(u - t) < 1e-6)) ts.push(t);
        }
      } else {
        const sep = barras && "separacion" in barras && barras.separacion ? barras.separacion / 1000 : 0.2;
        const n = Math.max(1, Math.floor((x.t[1] - x.t[0]) / sep + 1e-9));
        const t0 = (x.t[0] + x.t[1]) / 2 - (n * sep) / 2 + sep / 2;
        for (let k = 0; k < n; k++) ts.push(t0 + k * sep);
      }
      const paso = Math.max(1, Math.ceil(ts.length / BARRAS_MAXIMAS));
      for (let k = 0; k < ts.length; k += paso) {
        const t = ts[k]!;
        const en = (s: number): Vec2 => [s * x.d[0] + t * x.n[0], s * x.d[1] + t * x.n[1]];
        for (const [p, q] of trozosEnLosa(region, en(x.s[0]), en(x.s[1]))) tramo(p, q);
      }
    }
    if (algo) losas++;
  }
  const notas = [
    refuerzos
      ? `Los refuerzos de ${losas === 1 ? "la losa" : `las ${losas} losas`}${o.planta === null ? "" : ` de ${o.planta}`}, barra a barra (con muchas, una de cada pocas) a un recubrimiento de su cara, y lo que cubre cada uno. La armadura base no se dibuja: es de toda la losa.`
      : "No hay refuerzos que dibujar en las losas de lo que se ve.",
  ];
  return {
    esfuerzo: "My",
    unidad: "",
    origen,
    escala: { m: 1, valor: 1 },
    positivo: new Float32Array(0),
    negativo: new Float32Array(0),
    lineas: Float32Array.from(lineas),
    signoLinea: Uint8Array.from(signo),
    extremos: [],
    piezas: [],
    ejes: new Float32Array(0),
    ejePieza: new Uint32Array(0),
    ejeS: new Float64Array(0),
    conjunto: { descripcion: "El armado del proyecto", n: 0 },
    leyenda: [
      { estilo: "diagrama-positivo", texto: "Refuerzo superior: sus barras y lo que cubre" },
      { estilo: "diagrama-negativo", texto: "Refuerzo inferior: sus barras y lo que cubre" },
    ],
    notas,
  };
}
