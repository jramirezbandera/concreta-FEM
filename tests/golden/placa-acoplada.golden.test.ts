// =============================================================================
// GOLDEN Capa B de la LOSA ACOPLADA (F3.2) — discretizar() REAL -> motor REAL.
//
// La Capa A (acople.golden.test.ts) asevera la ESTRUCTURA de la Capa 2 (remap,
// subdivision, apoyos); aqui se asevera la FISICA del acople de punta a punta:
//
//  1) CONVERGENCIA A NAVIER: una losa con bordeApoyo LIBRE apoyada en 4 vigas
//     RIGIDISIMAS a flexion (Iy/Iz enormes) pero de torsion despreciable (J~0)
//     reproduce la placa simplemente apoyada de libro. GOTCHA deliberado: con J
//     grande las vigas EMPOTRARIAN el giro del borde via torsion y el caso
//     derivaria a placa empotrada, no SS — J pequeño = giro de borde libre.
//     La referencia se computa por la SERIE de Navier con el E/nu REALES del
//     material de catalogo (no constantes pegadas de otro golden).
//
//  2) EQUILIBRIO GLOBAL con secciones realistas (HA 30x50 / 30x30): la SUMA de
//     reacciones verticales en los 4 ARRANQUES DE PILAR iguala el peso total
//     calculado a mano (pp barras + pp losa + carga de usuario + cargas de planta
//     D-1), en ELS y en ELU (1,35·G + 1,50·Q): la carga de la losa BAJA por los
//     pilares, no por apoyos artificiales (que ya no existen: Capa A).
//
//  3) LAS VIGAS RECIBEN CARGA: el momento maximo de una viga de contorno es del
//     orden del reparto tributario (tolerancia generosa: continuidad y torsion
//     lo mueven), no ~0 (como era en el corte 1, losa aislada).
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import { discretizar } from "../../src/discretizador";
import { getMaterial } from "../../src/biblioteca";
import type { Modelo, Seccion } from "../../src/dominio";
import type { ResultadoDiscretizacion } from "../../src/discretizador";

const LADO = 4.0; // m (losa cuadrada)
const ESPESOR = 0.2; // m
const TAM_MALLA = 0.5; // m -> 8x8 quads (la malla del golden de gate: +1.5% flecha)
const Q_USUARIO = 10.0; // kN/m² en el caso Navier

// Tolerancia de MALLA + acople: el gate (malla 8x8 montada a mano) converge a +1.5%
// flecha / +2.5% Mx sobre Navier; el acople añade la flexibilidad (residual) de las
// vigas rigidas y el remap de borde. 10% caza signos/factores/ejes invertidos.
const TOL_NAVIER = 0.1;

// --- Serie de Navier (placa delgada SS, carga uniforme, losa cuadrada) --------
// w(centro)  = (16 q a⁴ / π⁶ D) ΣΣ (-1)^((m+n)/2-1) / (m·n·(m²+n²)²)   m,n impares
// Mx(centro) = (16 q a² / π⁴) ΣΣ (-1)^((m+n)/2-1) (m² + ν·n²) / (m·n·(m²+n²)²)
// Convergencia rapidisima (terminos ~1/(mn(m²+n²)²)); 99 terminos por eje sobran.
function navierCentro(q: number, a: number, D: number, nu: number): { w: number; mx: number } {
  let sw = 0;
  let sm = 0;
  for (let m = 1; m <= 99; m += 2) {
    for (let n = 1; n <= 99; n += 2) {
      const signo = ((m + n) / 2) % 2 === 1 ? 1 : -1; // sin(mπ/2)·sin(nπ/2)
      const den = m * n * (m * m + n * n) ** 2;
      sw += signo / den;
      sm += (signo * (m * m + nu * n * n)) / den;
    }
  }
  const w = ((16 * q * a ** 4) / Math.PI ** 6 / D) * sw;
  const mx = ((16 * q * a * a) / Math.PI ** 4) * sm;
  return { w, mx };
}

// Secciones del caso Navier: vigas RIGIDISIMAS a flexion/axil con torsion ~0 (giro
// de borde libre = SS); pilares rigidos para que el borde no descienda (axil).
const SEC_RIGIDA_VIGA: Seccion = {
  id: "sec-rigida-viga", nombre: "Rigida J~0", tipo: "generico",
  A: 100, Iy: 100, Iz: 100, J: 1e-8,
};
const SEC_RIGIDA_PILAR: Seccion = {
  id: "sec-rigida-pilar", nombre: "Rigida", tipo: "generico",
  A: 100, Iy: 100, Iz: 100, J: 1,
};
const SEC_VIGA_HA: Seccion = {
  id: "sec-viga-ha", nombre: "Viga 30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5 };
const SEC_PILAR_HA: Seccion = {
  id: "sec-pilar-ha", nombre: "Pilar 30x30", tipo: "hormigonRectangular", b: 0.3, h: 0.3 };

// Crujia LADO x LADO: 4 pilares de esquina (p0 cota 0 -> p1 cota 3, empotrados,
// vinculados), 4 vigas de contorno en p1 y la losa entre ellas.
function crujia(opts: {
  secciones: [Seccion, Seccion]; // [viga, pilar]
  bordeApoyo: "libre" | "simple";
  qUsuario: number;
  pesoPropio: boolean;
  // Cargas automaticas de la PLANTA del paño (v4; antes vivian en el grupo, D-1).
  cargasPlanta?: { sobrecargaUso: number; cargasMuertas: number };
}): Modelo {
  const [secViga, secPilar] = opts.secciones;
  const hipotesis: Modelo["hipotesis"] = [
    { id: "h1", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
  ];
  if (opts.pesoPropio) {
    hipotesis.unshift({
      id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true,
    });
  }
  return {
    unidades: "kN-m",
    schemaVersion: 4,
    // v4 (plantas sin grupos): SU/CM viven en la PLANTA del paño (p1, cota 3), que es
    // donde la losa las recibe. Ponerlas en p0 (sin paño) dispararia PLANTA_CARGA_SIN_PANO;
    // en p1 la Capa 2 (cargas de planta que bajan a los quads) es identica a la de grupos.
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      {
        id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A",
        sobrecargaUso: opts.cargasPlanta?.sobrecargaUso ?? 0,
        cargasMuertas: opts.cargasPlanta?.cargasMuertas ?? 0,
      },
    ],
    secciones: [secViga, secPilar],
    nudos: [
      { id: "q1", x: 0, y: 0 },
      { id: "q2", x: LADO, y: 0 },
      { id: "q3", x: LADO, y: LADO },
      { id: "q4", x: 0, y: LADO },
    ],
    pilares: (
      [
        ["pil1", 0, 0],
        ["pil2", LADO, 0],
        ["pil3", LADO, LADO],
        ["pil4", 0, LADO],
      ] as const
    ).map(([id, x, y]) => ({
      id, nombre: id.toUpperCase(), x, y,
      plantaInicial: "p0", plantaFinal: "p1",
      seccionId: secPilar.id, materialId: "HA-25", angulo: 0,
      vinculacionExterior: true, arranque: "empotrado" as const,
    })),
    vigas: (
      [
        ["v1", "q1", "q2"],
        ["v2", "q2", "q3"],
        ["v3", "q3", "q4"],
        ["v4", "q4", "q1"],
      ] as const
    ).map(([id, ni, nj]) => ({
      id, nombre: id.toUpperCase(), plantaId: "p1", nudoI: ni, nudoJ: nj,
      seccionId: secViga.id, materialId: "HA-25",
      extremoI: "empotrado" as const, extremoJ: "empotrado" as const, tirante: false,
    })),
    panos: [
      {
        id: "losa1", nombre: "Losa 1", tipo: "losa", plantaId: "p1",
        perimetro: ["q1", "q2", "q3", "q4"],
        espesor: ESPESOR, materialId: "HA-25", tamMalla: TAM_MALLA,
        bordeApoyo: opts.bordeApoyo,
      },
    ],
    muros: [],
    cargas:
      opts.qUsuario > 0
        ? [{ id: "c1", tipo: "superficial", ambito: "losa1", valor: opts.qUsuario, hipotesisId: "h1" }]
        : [],
    hipotesis,
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: opts.pesoPropio },
  };
}

function discretizarOk(modelo: Modelo) {
  const res: ResultadoDiscretizacion = discretizar(modelo);
  if (!res.ok) throw new Error("discretizar fallo: " + JSON.stringify(res.errores));
  return res;
}

// Nudo (nombre) de la malla mas cercano al centro de la losa.
function nudoCentro(res: ReturnType<typeof discretizarOk>): string {
  const nombres = new Set(res.trazabilidad.nodosDeMalla);
  let mejor = "";
  let best = Infinity;
  for (const n of res.modeloFEM.nodes) {
    if (!nombres.has(n.name)) continue;
    const d = (n.x - LADO / 2) ** 2 + (n.z - LADO / 2) ** 2;
    if (d < best) {
      best = d;
      mejor = n.name;
    }
  }
  return mejor;
}

describe("golden placa ACOPLADA Capa B (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) console.warn(`\n[GOLDEN-ACOPLE-B][SKIP] ${arranque.motivo}\n`);
  }, TIMEOUT_ARRANQUE);

  it(
    "B1 · CONVERGENCIA A NAVIER: losa libre sobre 4 vigas rigidas (J~0) ≈ placa SS de libro",
    () => {
      if (!arranque?.ok) return;
      const res = discretizarOk(
        crujia({
          secciones: [SEC_RIGIDA_VIGA, SEC_RIGIDA_PILAR],
          bordeApoyo: "libre", // ejercita la relajacion de PANO_SIN_APOYO [OV-2]
          qUsuario: Q_USUARIO,
          pesoPropio: false,
        }),
      );
      const r = arranque.motor.calcular(res.modeloFEM);

      // Referencia Navier con el E/nu REALES de HA-25 (catalogo, no constantes ajenas).
      const mat = getMaterial("HA-25")!;
      const D = (mat.E * ESPESOR ** 3) / (12 * (1 - mat.nu * mat.nu));
      const ref = navierCentro(Q_USUARIO, LADO, D, mat.nu);

      // Flecha central (ELS: factor 1,0 -> solo q). DY NEGATIVA (hacia abajo).
      const centro = nudoCentro(res);
      const dy = r.nodos[centro]["ELS"].disp[1];
      expect(dy).toBeLessThan(0);
      expect(Math.abs(dy)).toBeGreaterThan(ref.w * (1 - TOL_NAVIER));
      expect(Math.abs(dy)).toBeLessThan(ref.w * (1 + TOL_NAVIER));

      // Mx central: media de las esquinas que tocan el nudo central (los 4 quads
      // adyacentes), como hacen los isovalores. Signo consistente entre ellas.
      const quadsCentro = Object.entries(res.trazabilidad.quadANodos).filter(([, nudos]) =>
        nudos.includes(centro as never),
      );
      expect(quadsCentro.length).toBe(4);
      let suma = 0;
      for (const [quadName, nudos] of quadsCentro) {
        const esquina = nudos.indexOf(centro as never);
        suma += r.quads![quadName]["ELS"].moments[esquina][0]; // Mx
      }
      const mxCentro = suma / quadsCentro.length;
      expect(Math.abs(mxCentro)).toBeGreaterThan(ref.mx * (1 - TOL_NAVIER));
      expect(Math.abs(mxCentro)).toBeLessThan(ref.mx * (1 + TOL_NAVIER));
    },
    TIMEOUT_ARRANQUE,
  );

  it(
    "B2 · EQUILIBRIO GLOBAL: ΣV en los 4 arranques de pilar = peso total a mano (ELS y ELU con cargas de planta D-1)",
    () => {
      if (!arranque?.ok) return;
      const qUsuario = 3; // kN/m² (permanente, h1)
      const cargasPlanta = { sobrecargaUso: 2, cargasMuertas: 1 }; // kN/m² (D-1)
      const res = discretizarOk(
        crujia({
          secciones: [SEC_VIGA_HA, SEC_PILAR_HA],
          bordeApoyo: "libre",
          qUsuario,
          pesoPropio: true,
          cargasPlanta,
        }),
      );
      const r = arranque.motor.calcular(res.modeloFEM);

      // check_statics del motor: equilibrio por combo con quad_loads incluidos.
      expect(r.check_statics?.ejecutado).toBe(true);
      expect(r.check_statics?.equilibrio_ok).toBe(true);

      // Peso total a MANO (kN). Area losa = LADO².
      const rho = 25; // HA-25, kN/m³
      const area = LADO * LADO;
      const ppPilares = 4 * (0.3 * 0.3 * rho * 3); // 4 pilares de 3 m
      const ppVigas = 4 * (0.3 * 0.5 * rho * LADO); // 4 vigas de LADO m
      const ppLosa = rho * ESPESOR * area;
      const g = ppPilares + ppVigas + ppLosa + qUsuario * area + cargasPlanta.cargasMuertas * area;
      const q = cargasPlanta.sobrecargaUso * area;

      // Reacciones SOLO en los arranques de pilar (la Capa A ya lo garantiza en
      // estructura; aqui se ve en la FISICA: nada mas reacciona).
      const arranques = Object.values(res.trazabilidad.pilarANodoArranque);
      expect(arranques).toHaveLength(4);
      const sumaV = (combo: string): number => {
        let s = 0;
        for (const nodo of arranques) s += r.nodos[nodo][combo].rxn[1]; // FY
        return s;
      };
      // ELS = 1,0·(G+Q); ELU = 1,35·G + 1,50·Q. Tolerancia relativa 1e-3 (redondeos).
      expect(Math.abs(sumaV("ELS") - (g + q)) / (g + q)).toBeLessThan(1e-3);
      const elu = 1.35 * g + 1.5 * q;
      expect(Math.abs(sumaV("ELU") - elu) / elu).toBeLessThan(1e-3);
    },
    TIMEOUT_ARRANQUE,
  );

  it(
    "B3 · LAS VIGAS RECIBEN CARGA: el momento maximo de una viga de contorno es del orden del tributario",
    () => {
      if (!arranque?.ok) return;
      const qUsuario = 10;
      const res = discretizarOk(
        crujia({
          secciones: [SEC_VIGA_HA, SEC_PILAR_HA],
          bordeApoyo: "libre",
          qUsuario,
          pesoPropio: false,
        }),
      );
      const r = arranque.motor.calcular(res.modeloFEM);

      // Momento maximo |Mz| de la viga v1 en ELS, sobre TODOS sus tramos.
      const tramos = res.trazabilidad.vigaAMembers["v1"];
      expect(tramos.length).toBeGreaterThan(1); // subdividida por el acople
      let mMax = 0;
      for (const tramo of tramos) {
        const estado = r.barras[tramo]["ELS"];
        mMax = Math.max(mMax, Math.abs(estado.max_moment_z), Math.abs(estado.min_moment_z));
      }
      // Reparto tributario a 45°: cada viga recibe ~q·L²/4 = 40 kN -> viga biapoyada
      // equivalente M ≈ (q_trib_max·L²)/12..8 ≈ 13..20 kN·m. La continuidad del
      // portico, la torsion (GJ real) y el acople 2D lo mueven: tolerancia GENEROSA
      // [±50%+] — lo que se caza es el ORDEN (en el corte 1, aislado, esto era ~0).
      const mTributario = (qUsuario * LADO * LADO ** 2) / 4 / 8; // ≈ 20 kN·m
      expect(mMax).toBeGreaterThan(0.3 * mTributario);
      expect(mMax).toBeLessThan(2.5 * mTributario);
    },
    TIMEOUT_ARRANQUE,
  );
});
