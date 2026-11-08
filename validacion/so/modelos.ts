/**
 * Fase SO (`docs/fem3d/segundo-orden.md` §9): el edificio de las pruebas del segundo orden y el modelo
 * del oráculo externo.
 *
 * Tres plantas de 3 m de 2 × 2 vanos de 6 m, 3 × 3 pilares de 40 × 40 y vigas de 30 × 50 en todas
 * las alineaciones, sin losas (diafragma rígido por planta), con las cargas como puntuales en los
 * pilares: G y Q verticales en todos y el viento (W+ hacia +X, W− hacia −X) en el pilar central.
 * Así todas las cargas del modelo analítico son nodales y las fórmulas a mano son exactas.
 *
 * El oráculo (`oraculo_pdelta.py`, OpenSeesPy 3.8 con `geomTransf PDelta`) monta el modelo analítico
 * compilado con `empotramientoCabeza: 1` (el empotramiento parcial de CYPECAD no tiene elemento en
 * OpenSees) y sin áreas de cortante (Euler–Bernoulli: la `ElasticTimoshenkoBeam` de OpenSees aplica
 * mal `-jntOffset`, E2-1), y calcula con la gravedad a varios niveles el segundo orden geométrico de
 * las hipótesis horizontales, para compararlo con el γz del motor (criterio 7).
 *
 *   bun validacion/so/modelos.ts   → validacion/so/opensees-modelos.json (no se versiona)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar, type ResultadoCompilacion } from "../../src/compilador/compilar.ts";
import type { CargaFisica, ModeloFisico, OpcionesCompilacion, SegundoOrdenEdificio } from "../../src/compilador/fisico.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";

const PLANTAS = ["F3", "F2", "F1"];
const EJES = [0, 6, 12];

export interface VarianteSO {
  G?: number;
  Q?: number;
  W?: number;
  sinViento?: boolean;
  sismo?: boolean;
  segundoOrden?: SegundoOrdenEdificio;
}

export function edificioSO(v: VarianteSO = {}): ModeloFisico {
  const G = v.G ?? 100;
  const Q = v.Q ?? 50;
  const W = v.W ?? 30;
  const pilares = EJES.flatMap((x, i) => EJES.map((y, j) => ({ id: `P${3 * i + j + 1}`, x, y, desde: "CIM", hasta: "F3", seccion: "p" })));
  const vigas = PLANTAS.flatMap((planta) => [
    ...EJES.map((y, i) => ({ id: `${planta}-H${i}`, planta, puntos: [[0, y], [12, y]] as [number, number][], seccion: "v" })),
    ...EJES.map((x, i) => ({ id: `${planta}-V${i}`, planta, puntos: [[x, 0], [x, 12]] as [number, number][], seccion: "v" })),
  ]);
  const cargas: CargaFisica[] = [];
  for (const planta of PLANTAS) {
    for (const p of pilares) {
      cargas.push({ tipo: "puntual", id: `G-${planta}-${p.id}`, caso: "G", planta, x: p.x, y: p.y, F: [0, 0, -G] });
      cargas.push({ tipo: "puntual", id: `Q-${planta}-${p.id}`, caso: "Q", planta, x: p.x, y: p.y, F: [0, 0, -Q] });
    }
    if (!v.sinViento) {
      cargas.push({ tipo: "puntual", id: `W+-${planta}`, caso: "W+", planta, x: 6, y: 6, F: [W, 0, 0] });
      cargas.push({ tipo: "puntual", id: `W--${planta}`, caso: "W-", planta, x: 6, y: 6, F: [-W, 0, 0] });
    }
  }
  return {
    plantas: [
      { id: "F3", altura: null },
      { id: "F2", altura: 3 },
      { id: "F1", altura: 3 },
      { id: "CIM", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "H", forma: "rectangular", b: 0.4, h: 0.4 },
      { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares,
    vigas,
    casos: [
      { id: "G", accion: { tipo: "G" } },
      { id: "Q", accion: { tipo: "Q", psi: "uso-A" } },
      ...(v.sinViento
        ? []
        : [
            { id: "W+", accion: { tipo: "W" as const, direccion: "X" as const, signo: 1 as const, familia: "viento", psi: "viento" as const } },
            { id: "W-", accion: { tipo: "W" as const, direccion: "X" as const, signo: -1 as const, familia: "viento", psi: "viento" as const } },
          ]),
    ],
    cargas,
    ...(v.sismo || v.segundoOrden ? { acciones: { ...(v.sismo ? { sismo: { ab: 0.16, K: 1, terreno: "II" as const, mu: 2 } } : {}), ...(v.segundoOrden ? { segundoOrden: v.segundoOrden } : {}) } } : {}),
  };
}

/** Las opciones del modelo del oráculo: sin empotramiento parcial en las cabezas. */
export const OPCIONES_ORACULO: OpcionesCompilacion = { empotramientoCabeza: 1 };

/** Los niveles de carga gravitatoria del oráculo: γ_G = 1,35·g y γ_Q = 1,05·g (ψ₀ = 0,7), con el viento a 1,5 (con g = 12, Q ≈ 0,10; con 20, ≈ 0,17). */
export const NIVELES_ORACULO = [1, 2, 4, 6, 12, 20];
export const FACTOR_VIENTO = 1.5;
export const factoresNivel = (g: number): Record<string, number> => ({ G: 1.35 * g, Q: 1.05 * g, "W+": FACTOR_VIENTO });

/** El modelo con sus barras de Euler–Bernoulli (sin áreas de cortante), como lo monta OpenSees. */
export function sinCortante(m: ModeloAnalitico): ModeloAnalitico {
  return {
    ...m,
    barras: m.barras?.map((b) => {
      const { Avy: _y, Avz: _z, ...seccion } = b.seccion;
      return { ...b, seccion };
    }),
  };
}

export interface ModeloOraculoSO {
  fisico: ModeloFisico;
  compilado: Extract<ResultadoCompilacion, { valido: true }>;
  /** El modelo analítico del oráculo: el compilado, sin áreas de cortante. */
  modelo: ModeloAnalitico;
  /** Las barras de la base de los pilares (los tramos que acaban en F1), por su índice e id. */
  bases: { indice: number; id: string }[];
  /** El maestro del diafragma de la planta alta. */
  maestroAlto: number;
}

/** El edificio del oráculo, con el multiplicador de los desplazamientos a 1 (el segundo orden geométrico es elástico). */
export function modeloOraculo(): ModeloOraculoSO {
  const fisico = edificioSO({ segundoOrden: { multiplicadorDesplazamientos: 1 } });
  const c = compilar(fisico, OPCIONES_ORACULO);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  const modelo = sinCortante(c.modelo);
  const bases = (modelo.barras ?? []).map((b, indice) => ({ indice, id: b.id })).filter((b) => /^P\d+:F1$/.test(b.id));
  const maestroAlto = modelo.nudos.findIndex((n) => n.id === "F3:maestro");
  if (bases.length !== 9 || maestroAlto < 0) throw new Error(`el modelo del oráculo no tiene lo esperado: ${bases.length} bases, maestro ${maestroAlto}`);
  return { fisico, compilado: c, modelo, bases, maestroAlto };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const m = modeloOraculo();
  const salida = { modelo: m.modelo, bases: m.bases, maestroAlto: m.maestroAlto, niveles: NIVELES_ORACULO.map((g) => ({ g, factores: factoresNivel(g) })) };
  const ruta = join(import.meta.dirname, "opensees-modelos.json");
  writeFileSync(ruta, JSON.stringify(salida));
  console.log(`${m.modelo.nudos.length} nudos, ${m.modelo.barras?.length ?? 0} barras, ${m.modelo.casos.length} casos; escrito ${ruta}`);
}
