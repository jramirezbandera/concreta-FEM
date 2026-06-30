// =============================================================================
// GOLDEN de PLACA / LOSA MACIZA (F3 corte 1, FASE 2.1) — GATE de la UI.
//
// Es el guardian del motor de placas (CLAUDE.md §13): la UI de Isovalores NO empieza
// hasta que esta suite este verde. Verifica, con el MOTOR REAL PyNite (Capa B, sin
// mocks), las convenciones que Codex marco como landmines de correccion (plan F3):
//
//   1) MAGNITUD: losa cuadrada simplemente apoyada + carga uniforme -> flecha central
//      y Mx central vs la SOLUCION EXACTA DE NAVIER (placa delgada Kirchhoff, nu=0.2),
//      con tolerancia de malla documentada (el elemento DKMQ converge con la malla).
//   2) SIGNO de presion: carga gravitatoria (presion canonica POSITIVA con el orden de
//      nudos i,j,m,n del discretizador) -> flecha hacia ABAJO (DY < 0 en el centro).
//      Si saliera al reves, el signo/orden estaria invertido en el glue (F1.3).
//   3) EJES LOCALES: en una losa cuadrada simetrica, Mx ≈ My en el centro y son
//      CONSISTENTES entre quads (mismo signo, sin saltos) -> los ejes locales no se
//      voltean entre elementos adyacentes (clave para promediar a nudos en isovalores).
//   4) ESTABILIDAD EN EL PLANO: con apoyo SOLO vertical (DY) en el borde + la
//      estabilizacion en plano (DX/DZ en 2 esquinas + DX en una tercera para el giro
//      RY), `analyze` resuelve y la flecha es correcta. HALLAZGO (spike F1.3): bajo
//      `sparse=True` PyNite NO LANZA aunque falte la estabilizacion (los GDL en plano
//      quedan indeterminados pero no contaminan la flexion); por eso el golden afirma
//      el camino CORRECTO (con estabilizacion la flecha == la de referencia) en vez de
//      depender de un fallo que el solver disperso no produce. REGLA para el
//      discretizador: restringir DX y DZ en >=2 nudos NO colineales del borde (p.ej. 2
//      esquinas) + DX o DZ en un 3.er nudo no alineado, para fijar los 3 modos de
//      cuerpo rigido en plano (2 traslaciones X,Z + giro RY) sin coartar la flexion.
//   5) check_statics CON quad_loads: Sigma(presion*area) ≈ Sigma(reacciones verticales)
//      -> equilibrio_ok. Sin sumar las cargas de quad, el equilibrio daria "ok" FALSO.
//
// La Capa 2 (ModeloFEM con quads) se monta A MANO aqui (igual que el golden modal monta
// la biapoyada modal): este golden prueba el GLUE + el contrato de resultados de placa,
// NO el discretizador (eso es F1.2 / F3.1, en otro lane). El borde se valida con
// ResultadosCalculoSchema (via motor.calcular del arnes), que ya incluye `quads`.
//
// VALORES DE REFERENCIA (Navier exacto, nu=0.2, losa a=4 m, t=0.2 m, q=10 kN/m²):
//   D = E·t³/(12(1−ν²)) = 30e6·0.008/(12·0.96) = 20833.33 kN·m
//   w_max = 0.00049918 m ;  Mx_centro = My_centro = 7.07245 kN·m/m
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";

// --- Parametros de la losa (sistema interno kN-m) ----------------------------
const LADO = 4.0; // m (losa cuadrada a×a)
const ESPESOR = 0.2; // m
const E = 30e6; // kN/m² (hormigon ~C30)
const NU = 0.2;
const G = E / (2 * (1 + NU)); // kN/m²
const RHO = 25.0; // kN/m³ (no influye: no se activa peso propio aqui)
const Q = 10.0; // kN/m² (carga uniforme gravitatoria)

// --- Solucion exacta de Navier (placa delgada SS, carga uniforme, nu=0.2) ----
const D_PLACA = (E * ESPESOR ** 3) / (12 * (1 - NU * NU)); // rigidez a flexion
const W_NAVIER = 0.00049918; // m (flecha central, serie de Navier, nu=0.2)
const M_NAVIER = 7.07245; // kN·m/m (Mx=My central, nu=0.2)

// Tolerancia de MALLA: el cuadrilatero DKMQ converge a la solucion de Kirchhoff con
// el refinamiento. Con la malla del golden (8×8) el spike midio flecha +1.5% y Mx
// +2.5% sobre Navier; 8% deja holgura de convergencia pero CAZA un signo/factor/ejes
// equivocados (que darian errores >>10% o de signo). Documentada (CLAUDE.md §13).
const TOL_REL_MALLA = 0.08;

// Nº de quads por lado de la malla del golden (N×N quads, (N+1)×(N+1) nudos).
const N = 8;

// -----------------------------------------------------------------------------
// Monta la Capa 2 (ModeloFEM crudo) de la losa cuadrada simplemente apoyada con
// malla N×N de quads en el plano FEM X-Z (vertical = Y), igual orden de nudos que
// emitira el discretizador: i=(ix,iz), j=(ix+1,iz), m=(ix+1,iz+1), n=(ix,iz+1)
// (recorrido X+ luego Z+; CCW visto desde +Y). Apoyo SIMPLE en todo el borde (DY) +
// estabilizacion en plano. `presion` se aplica a todos los quads en el case "Q".
//
//   diagrama de un quad (vista desde +Y, X derecha, Z arriba):
//        n(ix,iz+1) ── m(ix+1,iz+1)
//          │               │
//        i(ix,iz)  ──  j(ix+1,iz)
// -----------------------------------------------------------------------------
function modeloFEMLosaCuadrada(opts: {
  n: number;
  presion: number;
  estabilizar: boolean;
  checkStatics: boolean;
}): ModeloFEM {
  const { n, presion, estabilizar, checkStatics } = opts;
  const h = LADO / n;
  const nombreNudo = (ix: number, iz: number) => `N_${ix}_${iz}`;

  const nodes: ModeloFEM["nodes"] = [];
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      nodes.push({ name: nombreNudo(ix, iz), x: ix * h, y: 0, z: iz * h });
    }
  }

  const quads: NonNullable<ModeloFEM["quads"]> = [];
  const quad_loads: NonNullable<ModeloFEM["quad_loads"]> = [];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const name = `Q_${ix}_${iz}`;
      quads.push({
        name,
        i: nombreNudo(ix, iz),
        j: nombreNudo(ix + 1, iz),
        m: nombreNudo(ix + 1, iz + 1),
        n: nombreNudo(ix, iz + 1),
        t: ESPESOR,
        material: "HA",
      });
      quad_loads.push({ quad: name, presion, case: "Q" });
    }
  }

  // Apoyo SIMPLE de borde: DY restringido en todos los nudos perimetrales.
  const supports: ModeloFEM["supports"] = [];
  const esBorde = (ix: number, iz: number) =>
    ix === 0 || ix === n || iz === 0 || iz === n;
  // Estabilizacion en plano: DX,DZ en 2 esquinas opuestas (fija las 2 traslaciones de
  // cuerpo rigido en plano) + DX en una 3.ª esquina (fija el giro RY). Sin coartar la
  // flexion (DY/giros de placa libres salvo el DY de borde, que es el apoyo simple).
  const flagsPlano: Record<string, { DX: boolean; DZ: boolean }> = {};
  if (estabilizar) {
    flagsPlano[nombreNudo(0, 0)] = { DX: true, DZ: true };
    flagsPlano[nombreNudo(n, 0)] = { DX: true, DZ: true };
    flagsPlano[nombreNudo(0, n)] = { DX: true, DZ: false };
  }
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      if (!esBorde(ix, iz)) continue;
      const nm = nombreNudo(ix, iz);
      const plano = flagsPlano[nm] ?? { DX: false, DZ: false };
      supports.push({
        node: nm,
        DX: plano.DX,
        DY: true, // apoyo simple del borde
        DZ: plano.DZ,
        RX: false,
        RY: false,
        RZ: false,
      });
    }
  }

  return {
    units: "kN-m",
    nodes,
    materials: [{ name: "HA", E, G, nu: NU, rho: RHO }],
    sections: [], // losa pura: sin barras -> sin secciones 1D
    members: [],
    quads,
    supports,
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    quad_loads,
    combos: [{ name: "Q", factors: { Q: 1.0 } }],
    analysis: { type: "linear", check_statics: checkStatics },
  };
}

// El centro de la losa cae en un NUDO (N par): el nudo (N/2, N/2).
const NUDO_CENTRO = `N_${N / 2}_${N / 2}`;
// El centro es la esquina `m` (xi=+1,eta=+1) del quad inferior-izquierda al centro.
const QUAD_AL_CENTRO = `Q_${N / 2 - 1}_${N / 2 - 1}`;

// =============================================================================
// CAPA B — MOTOR REAL PyNite. Magnitud + signo + ejes + estabilidad + statics.
// =============================================================================
describe("golden placa Capa B (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN-PLACA][SKIP] ${arranque.motivo}\n`);
    } else {
      const v = arranque.motor.versiones;
      console.warn(
        `\n[GOLDEN-PLACA][PAR REAL] python=${v.python} numpy=${v.numpy} scipy=${v.scipy} PyNiteFEA=${v.pynite}\n`,
      );
    }
  }, TIMEOUT_ARRANQUE);

  // ---------------------------------------------------------------------------
  // B1) MAGNITUD + SIGNO + EJES: flecha y Mx centrales vs Navier exacto, signo
  //     gravitatorio correcto, y Mx ≈ My (simetria de la losa cuadrada).
  // ---------------------------------------------------------------------------
  it(
    "losa SS + carga uniforme: flecha y Mx centrales ≈ Navier; gravedad hacia abajo; Mx≈My",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-PLACA][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      // Presion POSITIVA = gravedad (signo canonico confirmado con el motor real).
      const r = arranque.motor.calcular(
        modeloFEMLosaCuadrada({ n: N, presion: Q, estabilizar: true, checkStatics: false }),
      );

      // Borde: el resultado lleva la clave `quads` (placa) y los nudos de malla.
      expect(r.units).toBe("kN-m");
      expect(r.analysis.type).toBe("linear");
      expect(r.quads, "el resultado de una losa lleva `quads`").toBeDefined();
      const quads = r.quads!;
      expect(Object.keys(quads).length).toBe(N * N);

      // --- (2) SIGNO: flecha central hacia ABAJO (DY < 0) con presion POSITIVA -----
      const dyCentro = r.nodos[NUDO_CENTRO]["Q"].disp[1]; // disp = [DX,DY,DZ,RX,RY,RZ]
      expect(
        dyCentro,
        `gravedad (presion>0) -> flecha hacia abajo (DY<0); real=${dyCentro}`,
      ).toBeLessThan(0);

      // --- (1) MAGNITUD flecha vs Navier (valor absoluto) --------------------------
      const flecha = Math.abs(dyCentro);
      const errW = Math.abs(flecha - W_NAVIER) / W_NAVIER;
      const msgW =
        `flecha central: real=${flecha.toExponential(5)} m Navier=${W_NAVIER.toExponential(5)} m ` +
        `errRel=${(errW * 100).toFixed(2)}% (D=${D_PLACA.toFixed(1)})`;
      console.warn(`\n[GOLDEN-PLACA][flecha] ${msgW}\n`);
      expect(errW, msgW).toBeLessThan(TOL_REL_MALLA);

      // --- (1) MAGNITUD Mx central vs Navier ; (3) EJES: Mx≈My (simetria) ----------
      // El centro es la esquina `m` (3.ª, orden i,j,m,n) del quad inferior-izq al centro.
      const momCentro = quads[QUAD_AL_CENTRO]["Q"].moments[2]; // esquina m = [Mx,My,Mxy]
      const [mx, my, mxy] = momCentro;
      const errMx = Math.abs(Math.abs(mx) - M_NAVIER) / M_NAVIER;
      const msgMx =
        `Mx central: real=${mx.toFixed(4)} Navier=${M_NAVIER.toFixed(4)} kN·m/m ` +
        `errRel=${(errMx * 100).toFixed(2)}% (My=${my.toFixed(4)}, Mxy=${mxy.toFixed(4)})`;
      console.warn(`\n[GOLDEN-PLACA][Mx] ${msgMx}\n`);
      expect(errMx, msgMx).toBeLessThan(TOL_REL_MALLA);

      // (3) EJES LOCALES: en la losa cuadrada simetrica, Mx ≈ My en el centro y AMBOS
      // del MISMO signo (flexion positiva: traccion en cara inferior). Mxy ~ 0 en el
      // centro por simetria. Si los ejes locales se voltearan entre quads, Mx y My
      // discreparian groseramente o cambiarian de signo.
      expect(Math.abs(mx - my) / Math.abs(mx), "Mx ≈ My por simetria").toBeLessThan(0.02);
      expect(Math.sign(mx), "Mx y My mismo signo").toBe(Math.sign(my));
      expect(Math.abs(mxy), "Mxy ~ 0 en el centro (simetria)").toBeLessThan(0.05 * Math.abs(mx));

      // Cada quad emite 4 esquinas de momento (3 comp) y 4 de cortante (2 comp).
      const muestra = quads[QUAD_AL_CENTRO]["Q"];
      expect(muestra.moments.length).toBe(4);
      expect(muestra.shears.length).toBe(4);
      expect(muestra.moments[0].length).toBe(3);
      expect(muestra.shears[0].length).toBe(2);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // B2) EJES LOCALES CONSISTENTES entre quads adyacentes. Dos quads contiguos que
  //     comparten un borde deben dar, en sus esquinas del nudo COMPARTIDO, momentos
  //     del mismo signo y magnitud parecida (la consistencia que permite promediar a
  //     nudos en los isovalores sin saltos). Comparamos el quad central y su vecino.
  // ---------------------------------------------------------------------------
  it(
    "ejes locales consistentes: quads adyacentes dan Mx del mismo signo en el nudo compartido",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-PLACA][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const r = arranque.motor.calcular(
        modeloFEMLosaCuadrada({ n: N, presion: Q, estabilizar: true, checkStatics: false }),
      );
      const quads = r.quads!;

      // Quad A = inferior-izq al centro (Q_{c-1}_{c-1}); su esquina m (idx 2) es el nudo
      // central. Quad B = a su derecha (Q_c_{c-1}); su esquina n (idx 3) es el mismo
      // nudo central (n = (ix, iz+1) con ix=c, iz=c-1 -> (c,c)). Mismo nudo fisico.
      const c = N / 2;
      const A = quads[`Q_${c - 1}_${c - 1}`]["Q"].moments[2]; // esquina m -> nudo (c,c)
      const B = quads[`Q_${c}_${c - 1}`]["Q"].moments[3]; // esquina n -> nudo (c,c)
      // Mismo signo de Mx y My en el nudo compartido (ejes locales NO volteados).
      expect(Math.sign(A[0]), "Mx mismo signo entre quads vecinos").toBe(Math.sign(B[0]));
      expect(Math.sign(A[1]), "My mismo signo entre quads vecinos").toBe(Math.sign(B[1]));
      // Magnitudes cercanas (continuidad del campo de momentos cerca del centro).
      const relMx = Math.abs(A[0] - B[0]) / Math.max(Math.abs(A[0]), Math.abs(B[0]));
      expect(relMx, "Mx continuo entre quads vecinos").toBeLessThan(0.15);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // B3) ESTABILIDAD EN EL PLANO. Con apoyo SOLO vertical (DY) en el borde + la
  //     estabilizacion en plano (DX/DZ en 2 esquinas + DX en una 3.ª), `analyze`
  //     resuelve y la flecha == la del caso de referencia. HALLAZGO (spike F1.3): bajo
  //     `sparse=True` PyNite NO LANZA aunque se quite la estabilizacion (los modos de
  //     cuerpo rigido en plano quedan indeterminados pero NO contaminan la flexion
  //     vertical), por eso el golden afirma el camino CORRECTO en vez de esperar un
  //     fallo que el solver disperso no produce. La regla de estabilizacion (en la
  //     cabecera) es la que el discretizador debe aplicar para que el modelo sea bien
  //     planteado en plano (no quedar a merced del relleno de scipy).
  // ---------------------------------------------------------------------------
  it(
    "estabilizacion en plano: analyze resuelve y la flecha coincide con la de referencia",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-PLACA][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const conEstab = arranque.motor.calcular(
        modeloFEMLosaCuadrada({ n: N, presion: Q, estabilizar: true, checkStatics: false }),
      );
      const dyEstab = conEstab.nodos[NUDO_CENTRO]["Q"].disp[1];
      // Resuelve (no excepcion) y la flecha es fisica (hacia abajo, orden de magnitud Navier).
      expect(dyEstab).toBeLessThan(0);
      expect(Math.abs(dyEstab)).toBeGreaterThan(0.5 * W_NAVIER);
      expect(Math.abs(dyEstab)).toBeLessThan(2 * W_NAVIER);

      // Con la estabilizacion correcta, la flecha de flexion es la misma que SIN ella
      // (la estabilizacion en plano no toca la flexion vertical): confirma que la regla
      // del discretizador no introduce error en la respuesta de la losa.
      const sinEstab = arranque.motor.calcular(
        modeloFEMLosaCuadrada({ n: N, presion: Q, estabilizar: false, checkStatics: false }),
      );
      const dySin = sinEstab.nodos[NUDO_CENTRO]["Q"].disp[1];
      expect(
        Math.abs(dyEstab - dySin) / Math.abs(dyEstab),
        "la estabilizacion en plano no altera la flecha de flexion",
      ).toBeLessThan(1e-6);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // B4) check_statics CON quad_loads. ΣP (presion·area) ≈ Σreacciones verticales.
  //     Sin sumar las cargas de quad al balance, el residuo seria = Σreacciones (la
  //     carga total) y equilibrio_ok daria FALSO; con la correccion de F1.3 el residuo
  //     ~0 y equilibrio_ok = true. Ademas verifica el signo: ΣRxnFY > 0 (las reacciones
  //     sostienen la losa hacia arriba) = −ΣFy_carga (presion·area hacia abajo).
  // ---------------------------------------------------------------------------
  it(
    "check_statics incluye quad_loads: ΣP ≈ Σreacciones, equilibrio_ok",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-PLACA][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const r = arranque.motor.calcular(
        modeloFEMLosaCuadrada({ n: N, presion: Q, estabilizar: true, checkStatics: true }),
      );

      // check_statics ejecutado y equilibrio cerrado (residuo bajo tolerancia).
      expect(r.check_statics, "check_statics presente con check_statics:true").not.toBeNull();
      const cs = r.check_statics!;
      expect(cs.ejecutado).toBe(true);
      expect(
        cs.equilibrio_ok,
        `equilibrio_ok debe ser true (residuos=${JSON.stringify(cs.residuos)})`,
      ).toBe(true);
      // El residuo de fuerza es ~0 (no la carga total): demuestra que quad_loads SI
      // entra en el balance. Carga total = Q·a² = 160 kN; un residuo cercano a eso
      // delataria que las cargas de quad NO se sumaron.
      const cargaTotal = Q * LADO * LADO;
      expect(
        cs.residuos["Q"].max_fuerza,
        `residuo de fuerza ~0 (no ${cargaTotal} kN): quad_loads en el balance`,
      ).toBeLessThan(0.05 * cargaTotal);

      // Refuerzo independiente: Σreacciones verticales ≈ carga total, signo hacia arriba.
      let sumRxnFY = 0;
      for (const nodo of Object.values(r.nodos)) {
        sumRxnFY += nodo["Q"].rxn[1]; // rxn = [FX,FY,FZ,MX,MY,MZ]
      }
      expect(sumRxnFY, "Σreacciones verticales sostiene la losa (hacia arriba)").toBeGreaterThan(0);
      expect(
        Math.abs(sumRxnFY - cargaTotal) / cargaTotal,
        `ΣRxnFY (${sumRxnFY.toFixed(2)}) ≈ Q·a² (${cargaTotal})`,
      ).toBeLessThan(0.02);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // B5) BLOQUEO modal con placas (6A). El analisis modal con quads -> ErrorMotor de
  //     obra (la masa de los panos no se modela aun), NO un crash ni un resultado
  //     falso. El estatico ya corrio arriba; aqui el modal debe propagar el {ok:false}.
  // ---------------------------------------------------------------------------
  it(
    "modal con placas -> ErrorMotor de obra (la masa de los panos no se modela aun)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN-PLACA][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const conQuads = modeloFEMLosaCuadrada({
        n: N,
        presion: Q,
        estabilizar: true,
        checkStatics: false,
      });
      conQuads.analysis = { type: "modal", check_statics: false, num_modes: 4 };
      // calcularModal lanza cuando el glue devuelve {ok:false}; el mensaje debe hablar
      // de panos/masa, no un traceback de PyNite.
      expect(
        () => arranque!.ok && arranque!.motor.calcularModal(conQuads),
        "modal con placas debe propagar un ErrorMotor de obra (panos)",
      ).toThrow(/pa[nñ]os|masa/i);
    },
    TIMEOUT_ARRANQUE,
  );
});
