/**
 * MA5 (`docs/fem3d/modelado.md` §2.5 y §7, criterio 5): el aviso de casi alineados y «Alinear».
 *
 * - Los modelos limpios (los de referencia de A3, los ejemplos, las geometrías no ortogonales de G y
 *   las retículas al azar) no tienen ningún casi alineado: el aviso no sale en falso.
 * - Con ruido al azar en pilares y extremos de vigas, «Alinear» deja el modelo como estaba, bit a bit,
 *   sin mover nada más que la tolerancia en cada coordenada, y no queda ningún casi alineado.
 * - Lo que comparte una cara no avisa; un tramo casi recto se dice con su desvío; un eje guardado manda
 *   y no se mueve; las estaciones de un muro se vuelven a medir; dos vértices que acaban en el mismo
 *   punto quedan en uno.
 */
import { describe, expect, it } from "vitest";
import { MODELOS } from "../../validacion/a3/mutaciones.ts";
import { reticulaEnrasada } from "../../validacion/c2/modelos.ts";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { VERSION_ESQUEMA } from "../agente/proyecto.ts";
import { sensatezPrevia } from "../agente/sensatez.ts";
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { edificioGeometria, FAMILIAS } from "../pruebas/geometrias.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { casiAlineados, proponerAlinear, textoGrupo, TOLERANCIA_ALINEAR } from "./alinear.ts";
import { aplicar } from "./operaciones.ts";
import { EJEMPLOS, leerEjemplo } from "./serializar.test.ts";
import { moverAsa } from "./transformar.ts";

/** Un generador de números al azar con semilla (mulberry32). */
function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const copia = <T>(x: T): T => structuredClone(x);

describe("MA5: casi alineados", () => {
  it("los modelos limpios no tienen ninguno", () => {
    const modelos: [string, ModeloFisico][] = [
      ...MODELOS.map((m) => [m.nombre, m.f()] as [string, ModeloFisico]),
      ...Object.keys(EJEMPLOS).map((k) => [k, leerEjemplo(k as keyof typeof EJEMPLOS).proyecto.modelo] as [string, ModeloFisico]),
      ...FAMILIAS.flatMap((f) => [{}, { giro: 30 }, { circulares: true }, { hueco: true }].map((o) => [`${f} ${JSON.stringify(o)}`, edificioGeometria(f, o)] as [string, ModeloFisico])),
      ...Array.from({ length: 24 }, (_, i) => [`retícula ${i + 1}`, reticulaAleatoria(i + 1)] as [string, ModeloFisico]),
    ];
    for (const [nombre, m] of modelos) {
      expect(casiAlineados(m).map((g) => textoGrupo(g)), nombre).toEqual([]);
      expect(proponerAlinear(m).operacion, nombre).toBeNull();
    }
  });

  it("con ruido al azar en pilares y extremos de vigas, «Alinear» deja el modelo como estaba, sin mover nada más que la tolerancia", () => {
    const bases: [string, ModeloFisico][] = [
      ["retícula con núcleo", reticulaConNucleo()],
      ["edificio con losas", edificioObjetivoLosas(2, 4, 3)],
      ["muestrario", leerEjemplo("muestrario").proyecto.modelo],
    ];
    for (const [nombre, base] of bases)
      for (let s = 1; s <= 12; s++) {
        const r = azar(1000 * s + nombre.length);
        const m = copia(base) as unknown as { pilares: { x: number; y: number }[]; vigas: { puntos: [number, number][] }[] };
        const ruido = () => (r() < 0.5 ? -1 : 1) * (0.002 + 0.01 * r());
        let n = 0;
        for (const p of m.pilares)
          if (r() < 0.12) {
            if (r() < 0.5) p.x += ruido();
            else p.y += ruido();
            n++;
          }
        for (const v of m.vigas ?? [])
          for (const i of [0, v.puntos.length - 1])
            if (r() < 0.06) {
              const q = [...v.puntos[i]!] as [number, number];
              q[r() < 0.5 ? 0 : 1] += ruido();
              v.puntos[i] = q;
              n++;
            }
        if (!n) continue;
        const f = m as unknown as ModeloFisico;
        const caso = `${nombre}, semilla ${s}`;
        expect(casiAlineados(f).length, caso).toBeGreaterThan(0);
        const p = proponerAlinear(f);
        for (const x of p.movimientos) for (const k of [0, 1]) expect(Math.abs(x.a[k]! - x.de[k]!), caso).toBeLessThanOrEqual(TOLERANCIA_ALINEAR);
        expect(p.quedan, caso).toBe(0);
        expect(p.avisos, caso).toEqual([]);
        expect(p.modelo, caso).toEqual(base);
        // La operación del editor da lo mismo que el modelo de la propuesta
        const a = aplicar({ esquema: VERSION_ESQUEMA, modelo: f }, p.operacion!);
        expect(a.ok, caso).toBe(true);
        if (a.ok) expect(a.proyecto.modelo, caso).toEqual(base);
      }
  });

  it("un pilar enrasado con otro de otra sección (la misma cara) no avisa; sin enrasar, sí", () => {
    const base = reticulaEnrasada(1, 2, 1);
    const conPilar = (x: number) => {
      const m = copia(base) as ModeloFisico & { secciones: unknown[]; pilares: { id: string; x: number; seccion: string }[] };
      m.secciones.push({ id: "p45", material: "HA", forma: "rectangular", b: 0.45, h: 0.45 });
      const p = m.pilares.find((q) => q.id === "P0-0")!;
      p.seccion = "p45";
      p.x = x;
      return m;
    };
    // Cara exterior en −0,25, como la de P0-5 (de 50, en x = 0): 2,5 cm entre ejes
    expect(casiAlineados(conPilar(-0.025))).toEqual([]);
    const g = casiAlineados(conPilar(-0.02));
    expect(g.length).toBe(1);
    expect(g[0]!.nombre).toBe("x");
    expect(g[0]!.valor).toBe(0);
    expect(g[0]!.falta).toBeCloseTo(0.02, 12);
    expect(g[0]!.valores.find((v) => v.valor === -0.02)?.objetos).toEqual(["P0-0"]);
  });

  it("un tramo casi recto se dice con su desvío y su ángulo, y queda recto", () => {
    const base = reticulaEnrasada(1, 2, 1);
    const m = copia(base) as ModeloFisico & { vigas: { id: string; puntos: Vec2[] }[] };
    const v = m.vigas.find((x) => x.id === "X0-N1")!;
    v.puntos = [v.puntos[0]!, [v.puntos[1]![0], 0.12]];
    const g = casiAlineados(m);
    expect(g.length).toBe(1);
    expect(g[0]!.tramos.map((t) => t.id)).toEqual(["X0-N1"]);
    expect(g[0]!.tramos[0]!.desvio).toBeCloseTo(0.02, 12);
    expect(g[0]!.tramos[0]!.angulo).toBeCloseTo((Math.atan2(0.02, 12.5) * 180) / Math.PI, 9);
    expect(textoGrupo(g[0]!)).toContain("El tramo de X0-N1 de (-0,25; 0,1) a (12,25; 0,12) se desvía 2 cm (0,092°)");
    expect(proponerAlinear(m).modelo).toEqual(base);
  });

  it("un eje guardado manda y no se mueve", () => {
    const m = { ...reticulaEnrasada(1, 2, 1), ejes: [{ id: "A", desde: [-3, 0.015], hasta: [15, 0.015] }] } as ModeloFisico;
    const g = casiAlineados(m);
    expect(g.length).toBe(1);
    expect(g[0]!.valor).toBe(0.015);
    expect(g[0]!.valores.find((v) => v.ancla)?.objetos).toEqual(["A"]);
    const p = proponerAlinear(m);
    expect(p.movimientos.some((x) => x.id === "A")).toBe(false);
    expect(p.modelo.pilares!.filter((q) => q.id.endsWith("-0")).map((q) => q.y)).toEqual([0.015, 0.015, 0.015]);
    expect(p.quedan).toBe(0);
  });

  it("los huecos de un muro se vuelven a medir en su tramo", () => {
    const base = reticulaConNucleo();
    const r = moverAsa(base, { id: "NUCLEO", coleccion: "muros", ruta: ["puntos", 1], p: [12, 5] }, [12.02, 5]);
    expect(r.ok).toBe(true);
    const a = aplicar({ esquema: VERSION_ESQUEMA, modelo: base }, (r as unknown as { operacion: never }).operacion);
    expect(a.ok).toBe(true);
    const m = (a as { proyecto: { modelo: ModeloFisico } }).proyecto.modelo;
    expect(m.muros!.find((w) => w.id === "NUCLEO")!.huecos![0]!.desde).not.toBe(2.4);
    expect(proponerAlinear(m).modelo).toEqual(base);
  });

  it("dos vértices seguidos que acaban en el mismo punto quedan en uno", () => {
    const base = reticulaEnrasada(1, 2, 1);
    const m = copia(base) as ModeloFisico & { losas: { contorno: Vec2[] }[] };
    const c = m.losas[0]!.contorno;
    // Un vértice de más a 1 cm de la esquina, en el lado de abajo: al alinear el lado de la derecha, cae en ella
    m.losas[0]!.contorno = [c[0]!, c[1]!, [c[1]![0] + 0.01, c[1]![1]], c[2]!, c[3]!];
    expect(casiAlineados(m).length).toBe(1);
    const p = proponerAlinear(m);
    expect(p.modelo).toEqual(base);
  });

  it("la tolerancia manda: a 1 cm, 2 cm no son casi alineados", () => {
    const m = copia(reticulaEnrasada(1, 2, 1)) as ModeloFisico & { pilares: { x: number }[] };
    m.pilares[0]!.x += 0.02;
    expect(casiAlineados(m).length).toBe(1);
    expect(casiAlineados(m, 0.01)).toEqual([]);
  });

  it("el aviso de sensatez: lo da `validar` (sensatezPrevia), con las piezas, y el modelo alineado compila igual que el limpio", () => {
    const base = reticulaConNucleo();
    const m = copia(base) as ModeloFisico & { pilares: { id: string; x: number }[] };
    m.pilares.find((p) => p.id === "P6-5")!.x = 6.018;
    const c = sensatezPrevia(m).find((x) => x.codigo === "sensatez/casi-alineados")!;
    expect(c.estado).toBe("avisos");
    expect(c.avisos.length).toBe(1);
    expect(c.avisos[0]!.ids).toContain("P6-5");
    expect(c.avisos[0]!.mensaje).toMatch(/^Casi alineados en x = 6 \(N1, C\): 6,018 \(P6-5\) frente a .*les falta hasta 1,8 cm para coincidir/);
    expect(sensatezPrevia(base).find((x) => x.codigo === "sensatez/casi-alineados")!.estado).toBe("bien");
    expect(compilar(proponerAlinear(m).modelo).huella).toBe(compilar(base).huella);
  });
});
