// =============================================================================
// GOLDEN del CENTRO DE RIGIDEZ (CR) (F3.1) — el GATE de la Fase 2 (UI).
//
// El CR es un calculo AUXILIAR e INDEPENDIENTE (no por-combo, no modal): por
// planta se fabrica un diafragma rigido (mecanismo del spike F0.1: desplazamiento
// de cuerpo rigido impuesto) y se mide el punto donde una fuerza lateral no produce
// giro del forjado. Esta suite lo ejercita con el MOTOR REAL PyNite (par del
// proyecto, arnes offline de feature-6) y asevera las INVARIANCIAS fisicas que
// distinguen un CR correcto de un diafragma mal fabricado (CLAUDE.md §13).
//
// POR QUE Capa 2 directa (ModeloFEM base + plantasInfo a mano) y NO una obra de
// Capa 1: este golden valida el GLUE `calcular_cr` (F1.2, mecanismo del diafragma),
// que es lo que la Fase 2 (UI) consumira. La construccion de la Capa 2 desde la obra
// (`prepararModeloCR`, F1.1) tiene su propio unit/golden en el lane discretizador.
// Aqui montamos la MISMA Capa 2 que `prepararModeloCR` produciria (4 pilares
// empotrados + vigas de atado, maestro = centroide), que es ademas el caso de la
// fixture commiteada del spike (src/solver/spikes/cr_diafragma_fixture.json).
//
// VALORES DE REFERENCIA (verificados por el spike sobre el par Pyodide REAL,
// numpy 2.2.5 / scipy 1.14.1, y commiteados en la fixture):
//   - Simetrica (4 pilares 30x30 iguales, planta 5x5): CR == centroide == (0,0);
//     K_diafragma ≈ diag(19584.4, 19584.4, 251873.4), cond ≈ 12.86; INVARIANTE a la
//     posicion del maestro y a la escala de rigidez E.
//   - Asimetrica (pilar de la esquina (+2.5,+2.5) a 60x60): CR = (+1.5585, +1.5585)
//     (desplazado al lado RIGIDO, signo correcto).
//   - Degenerado (1 pilar): cond -> inf -> CR null (no determinable), sin NaN/crash.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";
import type { PlantaInfoCR } from "../../src/discretizador/modeloCR";

// --- Parametros del caso canonico (identicos al spike F0.1) ------------------
const E = 2.7e7; // kN/m2 (~27 GPa, hormigon)
const G = 1.125e7; // kN/m2
const NU = 0.2;
const RHO = 25.0; // kN/m3 (el CR no usa masa, pero el material lo pide)
const H = 3.0; // altura de planta (m)
const SEMI = 2.5; // semilado -> planta 5x5 centrada en el origen de obra
// Pilar 30x30 (base) y 60x60 (rigidizado del caso asimetrico).
const A30 = 0.09;
const I30 = 0.3 ** 4 / 12; // 6.75e-4
const J30 = 2.25e-4;
const A60 = 0.36;
const I60 = 0.6 ** 4 / 12; // 1.08e-2
const J60 = 1.8e-3;

// Esquinas del forjado en el plano X-Z (obra x=X_FEM, y=Z_FEM). Empotradas en base.
const ESQUINAS: ReadonlyArray<readonly [number, number]> = [
  [SEMI, SEMI],
  [SEMI, -SEMI],
  [-SEMI, SEMI],
  [-SEMI, -SEMI],
];
const ARISTAS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
];

// CR esperado (m) de la asimetrica: desplazado al lado rigido (== valor del spike,
// verificado sobre el par Pyodide real). La simetrica == centroide == (0,0) se
// asevera directo (|CR| < TOL_SIMETRICO).
const CR_ASIMETRICO = { x: 1.5584780183, y: 1.5584780183 };
// Tolerancia de la simetrica: el CR sale ~1e-16 (cero numerico); banda holgada para
// el cambio de build numpy/scipy local<->Pyodide. El asimetrico se asevera con
// toBeCloseTo(...,3) (≈ 0.5 mm), mucho mas fino que la diferencia con el mec.1 (0.42 m).
const TOL_SIMETRICO = 1e-6;

// Construye la Capa 2 BASE del forjado (lo que prepararModeloCR produciria): 4
// pilares empotrados (H=3) + vigas de atado perimetrales, una o dos plantas.
// `rigidoEn`: indice del pilar 60x60 (null = simetrico). `nivel`: sufijo de id +
// cota Y, para apilar plantas.
function nudosForjado(rigidoEn: number | null, nivel: number) {
  const Y = nivel * H;
  const nodes: ModeloFEM["nodes"] = [];
  const members: ModeloFEM["members"] = [];
  const supports: ModeloFEM["supports"] = [];
  const cabezas: string[] = [];
  const suf = `_${nivel}`;
  for (let k = 0; k < ESQUINAS.length; k++) {
    const [x, z] = ESQUINAS[k];
    const pie = `P${k}b${suf}`;
    const cab = `P${k}t${suf}`;
    // El pie de la planta nivel>1 es la cabeza del nivel inferior (continuidad del
    // pilar); para nivel 1 el pie esta en cimentacion (Y=0) y se empotra.
    nodes.push({ name: cab, x, y: Y, z });
    if (nivel === 1) {
      nodes.push({ name: pie, x, y: 0, z });
      supports.push({
        node: pie,
        DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true,
      });
    }
    const iNode = nivel === 1 ? pie : `P${k}t_${nivel - 1}`;
    const sec = rigidoEn !== null && k === rigidoEn ? "S60" : "S30";
    members.push({
      name: `C${k}${suf}`,
      i: iNode, j: cab,
      material: "C", section: sec,
      rotation: 0, tension_only: false, comp_only: false, releases: null,
    });
    cabezas.push(cab);
  }
  for (const [i, j] of ARISTAS) {
    members.push({
      name: `V${i}_${j}${suf}`,
      i: cabezas[i], j: cabezas[j],
      material: "C", section: "S30",
      rotation: 0, tension_only: false, comp_only: false, releases: null,
    });
  }
  return { nodes, members, supports, cabezas, Y };
}

// ModeloFEM base de una planta (la del spike/fixture).
function modeloUnaPlanta(rigidoEn: number | null = null): ModeloFEM {
  const f = nudosForjado(rigidoEn, 1);
  return {
    units: "kN-m",
    nodes: f.nodes,
    materials: [{ name: "C", E, G, nu: NU, rho: RHO }],
    sections: [
      { name: "S30", A: A30, Iy: I30, Iz: I30, J: J30 },
      { name: "S60", A: A60, Iy: I60, Iz: I60, J: J60 },
    ],
    members: f.members,
    supports: f.supports,
    node_loads: [], dist_loads: [], pt_loads: [], combos: [],
    analysis: { type: "linear", check_statics: false },
  };
}

// plantasInfo de una planta: sus 4 cabezas + maestro (por defecto el centroide).
function plantaInfo(
  cabezas: string[],
  plantaId: string,
  Y: number,
  maestro?: { x: number; z: number },
): PlantaInfoCR {
  return {
    plantaId,
    nodos: cabezas,
    maestro: { x: maestro?.x ?? 0, y: Y, z: maestro?.z ?? 0 },
  };
}

describe("golden CR (motor real PyNite) — diafragma rigido / centro de rigidez", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN-CR][SKIP] ${arranque.motivo}\n`);
    } else {
      const v = arranque.motor.versiones;
      console.warn(
        `\n[GOLDEN-CR][PAR REAL] python=${v.python} numpy=${v.numpy} scipy=${v.scipy} PyNiteFEA=${v.pynite}\n`,
      );
    }
  }, TIMEOUT_ARRANQUE);

  // ---------------------------------------------------------------------------
  // 1) SIMETRICO -> CR == centroide == (0,0). Reproduce la fixture commiteada.
  // ---------------------------------------------------------------------------
  it(
    "planta simetrica: CR == centroide (0,0) (reproduce la fixture del spike)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-CR][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const fem = modeloUnaPlanta(null);
      const f = nudosForjado(null, 1);
      const r = arranque.motor.calcularCR(fem, [plantaInfo(f.cabezas, "p1", f.Y)]);

      expect(r.units).toBe("kN-m");
      expect(r.analysis.type).toBe("centroRigidez");
      const cr = r.cr_por_planta["p1"];
      expect(cr, "la clave de la planta debe sobrevivir el cruce").toBeDefined();
      expect(cr.x).not.toBeNull();
      expect(cr.y).not.toBeNull();
      expect(Math.abs(cr.x!), `CR.x ≈ 0 (real=${cr.x})`).toBeLessThan(TOL_SIMETRICO);
      expect(Math.abs(cr.y!), `CR.y ≈ 0 (real=${cr.y})`).toBeLessThan(TOL_SIMETRICO);
      // El glue emite SOLO {x,y}; ex/ey los rellena F1.3 (aqui null por .nullish()).
      expect(cr.ex).toBeNull();
      expect(cr.ey).toBeNull();
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 2) INVARIANTE A LA POSICION DEL MAESTRO. El maestro es solo el punto de
  //    referencia; el CR fisico no debe depender de el. Lo movemos lejos.
  // ---------------------------------------------------------------------------
  it(
    "CR invariante a la posicion del maestro (centroide, descentrado, muy lejos)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-CR][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const fem = modeloUnaPlanta(null);
      const f = nudosForjado(null, 1);
      for (const maestro of [
        { x: 0, z: 0 },
        { x: 1.7, z: -0.9 },
        { x: -3.1, z: 2.2 },
      ]) {
        const r = arranque.motor.calcularCR(fem, [
          plantaInfo(f.cabezas, "p1", f.Y, maestro),
        ]);
        const cr = r.cr_por_planta["p1"];
        expect(
          Math.abs(cr.x!),
          `CR.x ≈ 0 con maestro (${maestro.x},${maestro.z}) (real=${cr.x})`,
        ).toBeLessThan(TOL_SIMETRICO);
        expect(
          Math.abs(cr.y!),
          `CR.y ≈ 0 con maestro (${maestro.x},${maestro.z}) (real=${cr.y})`,
        ).toBeLessThan(TOL_SIMETRICO);
      }
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 3) INVARIANTE A LA ESCALA DE RIGIDEZ. El mecanismo elegido no usa rigidez de
  //    penalizacion; escalar E del material no debe mover el CR de la simetrica.
  // ---------------------------------------------------------------------------
  it(
    "CR invariante a la escala de rigidez E (x0.1, x1, x100, x1000)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-CR][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const f = nudosForjado(null, 1);
      for (const factor of [0.1, 1, 100, 1000]) {
        const fem = modeloUnaPlanta(null);
        fem.materials = [{ name: "C", E: E * factor, G: G * factor, nu: NU, rho: RHO }];
        const r = arranque.motor.calcularCR(fem, [plantaInfo(f.cabezas, "p1", f.Y)]);
        const cr = r.cr_por_planta["p1"];
        expect(
          Math.abs(cr.x!),
          `CR.x ≈ 0 con E x${factor} (real=${cr.x})`,
        ).toBeLessThan(TOL_SIMETRICO);
        expect(
          Math.abs(cr.y!),
          `CR.y ≈ 0 con E x${factor} (real=${cr.y})`,
        ).toBeLessThan(TOL_SIMETRICO);
      }
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 4) ASIMETRICO -> CR se desplaza al LADO RIGIDO con el SIGNO correcto. El pilar
  //    de la esquina (+2.5,+2.5) es 60x60: el CR debe ir a (+,+).
  // ---------------------------------------------------------------------------
  it(
    "planta asimetrica: CR se desplaza al lado rigido (+,+) con signo correcto",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-CR][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const fem = modeloUnaPlanta(0); // pilar 0 = esquina (+2.5,+2.5) rigidizado
      const f = nudosForjado(0, 1);
      const r = arranque.motor.calcularCR(fem, [plantaInfo(f.cabezas, "p1", f.Y)]);
      const cr = r.cr_por_planta["p1"];
      expect(cr.x).not.toBeNull();
      expect(cr.y).not.toBeNull();
      // Signo: ambos POSITIVOS (hacia el pilar rigido).
      expect(cr.x!, `CR.x > 0 (lado rigido) (real=${cr.x})`).toBeGreaterThan(0.5);
      expect(cr.y!, `CR.y > 0 (lado rigido) (real=${cr.y})`).toBeGreaterThan(0.5);
      // Valor: coincide con el spike (1.5585 m) — caza el mec.1 (arana=1.974) y el
      // signo invertido.
      expect(cr.x!).toBeCloseTo(CR_ASIMETRICO.x, 3);
      expect(cr.y!).toBeCloseTo(CR_ASIMETRICO.y, 3);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 5) DEGENERADO (1 pilar) -> CR null (no determinable), sin NaN ni crash. La
  //    clave de la planta SIEMPRE presente con x/y = null.
  // ---------------------------------------------------------------------------
  it(
    "planta degenerada (1 pilar): CR null, sin NaN ni crash; la clave persiste",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-CR][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const fem: ModeloFEM = {
        units: "kN-m",
        nodes: [
          { name: "Pb", x: 0, y: 0, z: 0 },
          { name: "Pt", x: 0, y: H, z: 0 },
        ],
        materials: [{ name: "C", E, G, nu: NU, rho: RHO }],
        sections: [{ name: "S30", A: A30, Iy: I30, Iz: I30, J: J30 }],
        members: [
          {
            name: "C", i: "Pb", j: "Pt", material: "C", section: "S30",
            rotation: 0, tension_only: false, comp_only: false, releases: null,
          },
        ],
        supports: [
          { node: "Pb", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true },
        ],
        node_loads: [], dist_loads: [], pt_loads: [], combos: [],
        analysis: { type: "linear", check_statics: false },
      };
      const r = arranque.motor.calcularCR(fem, [
        { plantaId: "p1", nodos: ["Pt"], maestro: { x: 0, y: H, z: 0 } },
      ]);
      const cr = r.cr_por_planta["p1"];
      expect(cr, "la clave de la planta degenerada DEBE existir").toBeDefined();
      expect(cr.x, "CR.x de planta degenerada = null").toBeNull();
      expect(cr.y, "CR.y de planta degenerada = null").toBeNull();
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 6) AISLAMIENTO ENTRE PLANTAS (edificio de 2 plantas, ambas simetricas): cada
  //    planta da su propio CR coherente (== su centroide (0,0)), sin contaminarse.
  // ---------------------------------------------------------------------------
  it(
    "edificio de 2 plantas simetricas: cada planta da CR == centroide (aislamiento)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-CR][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const f1 = nudosForjado(null, 1);
      const f2 = nudosForjado(null, 2);
      const fem: ModeloFEM = {
        units: "kN-m",
        nodes: [...f1.nodes, ...f2.nodes],
        materials: [{ name: "C", E, G, nu: NU, rho: RHO }],
        sections: [
          { name: "S30", A: A30, Iy: I30, Iz: I30, J: J30 },
          { name: "S60", A: A60, Iy: I60, Iz: I60, J: J60 },
        ],
        members: [...f1.members, ...f2.members],
        supports: [...f1.supports, ...f2.supports],
        node_loads: [], dist_loads: [], pt_loads: [], combos: [],
        analysis: { type: "linear", check_statics: false },
      };
      const r = arranque.motor.calcularCR(fem, [
        plantaInfo(f1.cabezas, "p1", f1.Y),
        plantaInfo(f2.cabezas, "p2", f2.Y),
      ]);
      for (const id of ["p1", "p2"]) {
        const cr = r.cr_por_planta[id];
        expect(cr, `clave ${id} presente`).toBeDefined();
        expect(
          Math.abs(cr.x!),
          `${id}: CR.x ≈ 0 (real=${cr.x})`,
        ).toBeLessThan(TOL_SIMETRICO);
        expect(
          Math.abs(cr.y!),
          `${id}: CR.y ≈ 0 (real=${cr.y})`,
        ).toBeLessThan(TOL_SIMETRICO);
      }
    },
    TIMEOUT_ARRANQUE,
  );
});
