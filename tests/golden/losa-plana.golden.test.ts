// =============================================================================
// GOLDEN Capa B de la LOSA PLANA sobre PILARES (F2.3 / T-f3-losa-plana) —
// discretizar() REAL -> motor REAL PyNite. Cierra el corazon del corte "losa
// maciza sobre pilares": la losa YA NO queda AISLADA (corte 1), sino que DESCARGA
// SU PESO EN LOS PILARES INTERIORES a los que se acopla (F2.0/F2.1/F2.2).
//
// El golden de GATE (placa.golden.test.ts) monta la Capa 2 A MANO: no ve el SIGNO
// ni el ORDEN que produce el discretizador, ni el ACOPLE cabeza<->N*. Como en el
// corte 1 (placa-discretizada.golden), aqui se construye la OBRA (Capa 1), se pasa
// por `discretizar()` REAL y por el motor REAL, y se afirma la FISICA de punta a
// punta. Convencion de signos: presion de quad POSITIVA = hacia ABAJO (gravedad),
// OPUESTA a la FY de barras; un signo invertido daria una losa que "sube" (DY>0).
//
// CASOS:
//  1) LA LOSA DESCARGA EN EL PILAR (corazon del corte): losa sobre 4 pilares
//     interiores (sin vigas, bordes libres). DY<0 en el centro; axil>0 en cada
//     pilar (recibe carga); ΣV (reacciones de los arranques) ≈ carga total (pp
//     barras + pp losa + superficial), con tolerancia de equilibrio.
//  2) check_statics OK con quad_loads (equilibrio global del modelo acoplado).
//  3) §5.7 (DP3) — PILAR PASANTE DE OTRO GRUPO: un pilar cuyas plantas inicial/final
//     son de un grupo B pero cuyo tramo cruza la cota del paño (grupo A) comparte el
//     N* de esa cota y recoge la losa igual (axil>0). Unico respaldo del invariante
//     "el N* de la cabeza siempre existe" cuando depende de que el pasante pertenezca
//     a modelo.plantas (grupo = organizativo, no estructural).
//  4) CONVERGENCIA de flecha al afinar la malla (la flecha SI es fiable; el momento
//     local sobre el pilar NO -> NO se asevera, es dependiente de malla, spike /
//     T-f3-losa-plana-momento-local).
//  5) LA RED ANTES DEL MOTOR: 2 pilares interiores COLINEALES (bordes libres) ->
//     `discretizar` `ok:false` con PANO_PILARES_INSUFICIENTES, y el pipeline NO llega
//     al motor. Es la red que ataja el mecanismo que el solver disperso NO caza: con 2
//     apoyos (siempre colineales) el plano de la losa BASCULA y PyNite devuelve basura
//     silenciosa (flecha ~ -12 cm sin lanzar; medido en F2.3). Validaciones lo BLOQUEA
//     con mensaje de obra ANTES de calcular. La sujecion AUTONOMA por pilares exige
//     >=3 NO colineales (hayTresNoColineales, validaciones.ts).
//
// UNIDADES (kN, m; presion de quad kN/m²). E/nu/ρ REALES de HA-25 (catalogo,
// getMaterial), no constantes pegadas. Ejes: planta (x,y)->global (X,Z); cota->Y
// vertical; gravedad = FY global NEGATIVA -> DY<0.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import { discretizar } from "../../src/discretizador";
import { getMaterial } from "../../src/biblioteca";
import type { Modelo, Seccion } from "../../src/dominio";
import type { ResultadoDiscretizacion } from "../../src/discretizador";
import type { ResultadosCalculo } from "../../src/solver/resultados";

const ESPESOR = 0.2; // m (losa)
const H_PLANTA = 3.0; // m (altura de pilar entre cota 0 y cota 3)

// Pilar de hormigon 30x30 (real): recoge la losa por AXIL.
const SEC_PILAR_HA: Seccion = {
  id: "sec-pilar-ha",
  nombre: "Pilar 30x30",
  tipo: "hormigonRectangular",
  b: 0.3,
  h: 0.3,
};

type ResDiscretizado = ReturnType<typeof discretizar> & { ok: true };

// discretizar() y explotar si falla (misma politica que los otros goldens Capa B). Tras
// el fix de F2.3 (validaciones.ts relaja PANO_SIN_APOYO cuando hay >=3 pilares acoplados
// NO colineales, helper hayTresNoColineales), una losa de bordes libres sobre >=3
// pilares en esquina discretiza `ok:true` y llega al motor.
function discretizarOk(modelo: Modelo): ResDiscretizado {
  const res: ResultadoDiscretizacion = discretizar(modelo);
  if (!res.ok) throw new Error("discretizar fallo: " + JSON.stringify(res.errores));
  return res;
}

// Nudo (nombre) de la malla mas cercano al centro de la losa (X-Z FEM = x-y obra).
function nudoCentro(res: ResDiscretizado, cx: number, cz: number): string {
  const deMalla = new Set(res.trazabilidad.nodosDeMalla);
  let mejor = "";
  let best = Infinity;
  for (const n of res.modeloFEM.nodes) {
    if (!deMalla.has(n.name)) continue;
    const d = (n.x - cx) ** 2 + (n.z - cz) ** 2;
    if (d < best) {
      best = d;
      mejor = n.name;
    }
  }
  return mejor;
}

// Pico de |axil| (N, kN) de un PILAR (de sus tramos, de su diagrama axial (2,n)).
function picoAxilPilar(
  res: ResDiscretizado,
  r: ResultadosCalculo,
  pilarId: string,
  combo: string,
): number {
  let pico = 0;
  for (const tramo of res.trazabilidad.pilarAMembers[pilarId]) {
    for (const a of r.barras[tramo][combo].axial[1]) {
      if (Math.abs(a) > pico) pico = Math.abs(a);
    }
  }
  return pico;
}

// -----------------------------------------------------------------------------
// Modelo canonico: losa cuadrada `lado`x`lado` sobre `pilares` interiores, sin
// vigas de contorno (bordes libres). Los pilares (cota 0 -> cota 3, empotrados +
// vinculados) reciben la losa por acople de cabeza; su arranque reacciona.
// -----------------------------------------------------------------------------
function losaSobrePilares(opts: {
  lado: number;
  tamMalla: number;
  pilares: { id: string; x: number; y: number }[];
  qUsuario: number; // kN/m² superficial (permanente)
  pesoPropio: boolean;
}): Modelo {
  const L = opts.lado;
  const hipotesis: Modelo["hipotesis"] = [
    { id: "h1", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
  ];
  if (opts.pesoPropio) {
    hipotesis.unshift({
      id: "hip-peso-propio",
      nombre: "Peso propio",
      tipo: "permanente",
      automatica: true,
    });
  }
  return {
    unidades: "kN-m",
    schemaVersion: 3,
    grupos: [
      { id: "g1", nombre: "Grupo 1", categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: H_PLANTA, grupoId: "g1" },
      { id: "p1", nombre: "Planta 1", cota: H_PLANTA, altura: H_PLANTA, grupoId: "g1" },
    ],
    secciones: [SEC_PILAR_HA],
    nudos: [
      { id: "q1", x: 0, y: 0 },
      { id: "q2", x: L, y: 0 },
      { id: "q3", x: L, y: L },
      { id: "q4", x: 0, y: L },
    ],
    pilares: opts.pilares.map((p) => ({
      id: p.id,
      nombre: p.id.toUpperCase(),
      x: p.x,
      y: p.y,
      plantaInicial: "p0",
      plantaFinal: "p1",
      seccionId: SEC_PILAR_HA.id,
      materialId: "HA-25",
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado" as const,
    })),
    vigas: [],
    panos: [
      {
        id: "losa1",
        nombre: "Losa 1",
        tipo: "losa",
        plantaId: "p1",
        perimetro: ["q1", "q2", "q3", "q4"],
        espesor: ESPESOR,
        materialId: "HA-25",
        tamMalla: opts.tamMalla,
        bordeApoyo: "libre",
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

describe("golden losa PLANA sobre pilares Capa B (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) console.warn(`\n[GOLDEN-LOSA-PLANA][SKIP] ${arranque.motivo}\n`);
  }, TIMEOUT_ARRANQUE);

  it(
    "L1 · LA LOSA DESCARGA EN EL PILAR: DY<0, axil>0 en cada pilar, ΣV(arranques) = carga total",
    () => {
      if (!arranque?.ok) return;
      const LADO = 6.0;
      const TAM = 1.0; // -> 6x6 quads; lineas de control x,y ∈ {1,5} ya en la rejilla
      const qUsuario = 5.0; // kN/m² (permanente, h1)
      // Pilares cerca de las 4 ESQUINAS (voladizo perimetral de 1 m, luz interior 4 m):
      // el vano central flecta hacia ABAJO de forma clasica. Con pilares muy hacia
      // dentro (p.ej. 2..4 sobre lado 6) los voladizos de 2 m DOMINAN y el centro SUBE
      // (medido: DY>0, fisica real, no bug) — geometria descartada para el corazon.
      const pilares = [
        { id: "pil1", x: 1, y: 1 },
        { id: "pil2", x: 5, y: 1 },
        { id: "pil3", x: 1, y: 5 },
        { id: "pil4", x: 5, y: 5 },
      ];
      const res = discretizarOk(
        losaSobrePilares({ lado: LADO, tamMalla: TAM, pilares, qUsuario, pesoPropio: true }),
      );
      // La Capa 2 lleva quads y quad_loads con presion POSITIVA (hacia abajo).
      expect(res.modeloFEM.quads?.length ?? 0).toBeGreaterThan(0);
      for (const ql of res.modeloFEM.quad_loads!) {
        expect(ql.presion, "presion de quad gravitatoria POSITIVA (hacia abajo)").toBeGreaterThan(0);
      }

      const r = arranque.motor.calcular(res.modeloFEM);

      // 1) FLECHA: DY<0 en el centro en TODA combinacion (todas gravitatorias).
      const centro = nudoCentro(res, LADO / 2, LADO / 2);
      expect(centro).not.toBe("");
      for (const combo of r.combos) {
        const dy = r.nodos[centro][combo].disp[1];
        expect(dy, `combo ${combo}: DY centro < 0; real=${dy}`).toBeLessThan(0);
      }

      // 2) AXIL: cada pilar RECIBE carga (axil de compresion > 0 en magnitud) en ELS.
      const combo = "ELS";
      const axiles = pilares.map((p) => picoAxilPilar(res, r, p.id, combo));
      for (let i = 0; i < pilares.length; i++) {
        expect(axiles[i], `pilar ${pilares[i].id}: axil>0 (recoge la losa); real=${axiles[i]}`).toBeGreaterThan(0);
      }

      // 3) EQUILIBRIO: ΣV (reacciones verticales de los arranques de pilar) = carga total.
      const mat = getMaterial("HA-25")!;
      const rho = mat.peso; // kN/m³ real de HA-25 (catalogo), no pegado
      const areaLosa = LADO * LADO;
      const ppPilares = pilares.length * (0.3 * 0.3 * rho * H_PLANTA);
      const ppLosa = rho * ESPESOR * areaLosa;
      const gTotal = ppPilares + ppLosa + qUsuario * areaLosa; // todo permanente -> ELS=1,0

      const arranques = Object.values(res.trazabilidad.pilarANodoArranque);
      expect(arranques).toHaveLength(pilares.length);
      let sumaV = 0;
      for (const nodo of arranques) sumaV += r.nodos[nodo][combo].rxn[1]; // FY
      const errRel = Math.abs(sumaV - gTotal) / gTotal;
      expect(errRel, `ΣV=${sumaV} vs carga=${gTotal} (errRel=${errRel})`).toBeLessThan(1e-3);

      // 4) check_statics del motor: equilibrio global con quad_loads incluidos.
      expect(r.check_statics?.ejecutado).toBe(true);
      expect(r.check_statics?.equilibrio_ok).toBe(true);

      // Trazas para el informe.
      console.log(
        `\n[L1] centro=${centro} DY(ELS)=${r.nodos[centro]["ELS"].disp[1].toExponential(3)} m; ` +
          `axiles(ELS)=[${axiles.map((a) => a.toFixed(2)).join(", ")}] kN; ` +
          `ΣV=${sumaV.toFixed(3)} carga=${gTotal.toFixed(3)} errRel=${errRel.toExponential(2)}\n`,
      );
    },
    TIMEOUT_ARRANQUE,
  );

  // Modelo §5.7: losa (grupo A, cota 3) sobre 4 pilares de ESQUINA. 3 son NORMALES de
  // grupo A (cota 0 -> cota 3, rematan en la losa). El 4º es de grupo B: `remateB` fija
  // su cota de cabeza. Con remateB=6 es un PASANTE GENUINO (cotas 0->6 saltando la cota
  // del paño: se trocea en cota 3 aunque cota 3 no sea planta de grupo B). Con remateB=3
  // remata EN la losa (comparte el N* de la planta de grupo A). En ambos, grupo B nunca
  // tiene una planta en cota 3 -> el N* a esa cota nace de que la planta pA1 esta en
  // modelo.plantas (invariante §2.2). 4 esquinas no colineales sujetan el plano.
  function losaConPilarOtroGrupo(remateB: 3 | 6): Modelo {
    const LADO = 6.0;
    const plantasB =
      remateB === 6
        ? [
            { id: "pB0", nombre: "Cim B", cota: 0, altura: 6, grupoId: "gB" },
            { id: "pB1", nombre: "Planta B (cota 6)", cota: 6, altura: 3, grupoId: "gB" },
          ]
        : [
            { id: "pB0", nombre: "Cim B", cota: 0, altura: 3, grupoId: "gB" },
            { id: "pB1", nombre: "Planta B (cota 3)", cota: 3, altura: 3, grupoId: "gB" },
          ];
    return {
      unidades: "kN-m",
      schemaVersion: 3,
      grupos: [
        { id: "gA", nombre: "Grupo A", categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
        { id: "gB", nombre: "Grupo B", categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      ],
      plantas: [
        // Grupo A: planta del paño en cota 3 (y su cimentacion en cota 0).
        { id: "pA0", nombre: "Cim A", cota: 0, altura: 3, grupoId: "gA" },
        { id: "pA1", nombre: "Planta A (paño)", cota: 3, altura: 3, grupoId: "gA" },
        ...plantasB,
      ],
      secciones: [SEC_PILAR_HA],
      nudos: [
        { id: "q1", x: 0, y: 0 },
        { id: "q2", x: LADO, y: 0 },
        { id: "q3", x: LADO, y: LADO },
        { id: "q4", x: 0, y: LADO },
      ],
      pilares: [
        // 3 pilares NORMALES de grupo A (cota 0 -> cabeza cota 3), en tres esquinas.
        ...(
          [
            ["pilA1", 1, 1],
            ["pilA2", 5, 1],
            ["pilA3", 1, 5],
          ] as const
        ).map(([id, x, y]) => ({
          id,
          nombre: id.toUpperCase(),
          x,
          y,
          plantaInicial: "pA0",
          plantaFinal: "pA1",
          seccionId: SEC_PILAR_HA.id,
          materialId: "HA-25",
          angulo: 0,
          vinculacionExterior: true,
          arranque: "empotrado" as const,
        })),
        // Pilar de grupo B en la 4ª esquina (5,5): sus dos plantas son de gB.
        {
          id: "pilPasante",
          nombre: "PILPASANTE",
          x: 5,
          y: 5,
          plantaInicial: "pB0",
          plantaFinal: "pB1",
          seccionId: SEC_PILAR_HA.id,
          materialId: "HA-25",
          angulo: 0,
          vinculacionExterior: true,
          arranque: "empotrado",
        },
      ],
      vigas: [],
      panos: [
        {
          id: "losa1",
          nombre: "Losa 1",
          tipo: "losa",
          plantaId: "pA1", // planta del paño = grupo A, cota 3
          perimetro: ["q1", "q2", "q3", "q4"],
          espesor: ESPESOR,
          materialId: "HA-25",
          tamMalla: 1.0,
          bordeApoyo: "libre",
        },
      ],
      muros: [],
      cargas: [{ id: "c1", tipo: "superficial", ambito: "losa1", valor: 5, hipotesisId: "h1" }],
      hipotesis: [
        { id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true },
        { id: "h1", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
      ],
      analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
    };
  }

  it(
    "L2a · §5.7 (DP3) INVARIANTE: un pilar PASANTE de otro grupo (0->6) se trocea en la cota del paño y crea el N* compartido",
    () => {
      // Este es el respaldo del invariante §2.2/§5.7: el N* de la cabeza a la cota del
      // paño existe PORQUE cotasDePilar trocea por TODA planta de modelo.plantas en el
      // rango, SIN mirar el grupo del pilar. El pasante de grupo B (cotas 0->6) salta la
      // cota 3 (que NO es planta de grupo B), pero se trocea ahi porque pA1 (grupo A,
      // cota 3) esta en modelo.plantas. Es puro discretizador -> NO necesita el motor
      // (la cabeza libre a cota 6, fuera de la losa, harIa singular el modelo: artefacto
      // de modelado, no del acople; la FISICA del acople de otro grupo se prueba en L2b).
      const res = discretizarOk(losaConPilarOtroGrupo(6));

      // El pasante se troceo en la cota intermedia (cota 3): >=2 tramos pie->cabeza.
      const tramosPasante = res.trazabilidad.pilarAMembers["pilPasante"];
      expect(
        tramosPasante.length,
        "el pasante de grupo B se troceo en la cota del paño (>=2 tramos)",
      ).toBeGreaterThan(1);

      // El N* de su cabeza a la cota del paño existe en la Capa 2 (obra x=5,y=5,cota=3 ->
      // FEM x=5, z=5, y=3). Este es el nudo que el acople remapea a los quads de la losa.
      const nudoPasanteCota3 = res.modeloFEM.nodes.find(
        (n) => Math.abs(n.x - 5) < 1e-6 && Math.abs(n.z - 5) < 1e-6 && Math.abs(n.y - 3) < 1e-6,
      );
      expect(
        nudoPasanteCota3,
        "N* del pasante de otro grupo en la cota del paño (x=5,z=5,y=3) existe",
      ).toBeDefined();

      // Y ese nudo esta EN los quads de la losa (el acople lo unio): el pasante recoge
      // la losa por comparticion de N*, aunque sea de otro grupo (grupo = organizativo).
      const enQuads = new Set<string>();
      for (const q of res.modeloFEM.quads ?? []) enQuads.add(q.i).add(q.j).add(q.m).add(q.n);
      expect(
        enQuads.has(nudoPasanteCota3!.name),
        "el N* del pasante es esquina de algun quad de la losa (acoplado)",
      ).toBe(true);

      console.log(
        `\n[L2a §5.7] pasante(0->6) tramos=${tramosPasante.length}; N*cabeza=${nudoPasanteCota3!.name} en quads=${enQuads.has(nudoPasanteCota3!.name)}\n`,
      );
    },
  );

  it(
    "L2b · §5.7 (DP3) FISICA: un pilar de OTRO grupo que remata en la losa recoge la carga (axil>0) igual que uno del grupo del paño",
    () => {
      if (!arranque?.ok) return;
      // El pasante de grupo B remata EN la cota del paño (cota 3): su cabeza es un N*
      // compartido con la planta pA1 (grupo A), sin cabeza libre superior -> modelo
      // estable resoluble. Prueba la FISICA del DP3: el pilar de otro grupo recoge la
      // losa por AXIL exactamente como los normales (grupo = organizativo, no estructural).
      const res = discretizarOk(losaConPilarOtroGrupo(3));
      const r = arranque.motor.calcular(res.modeloFEM);

      const axilPasante = picoAxilPilar(res, r, "pilPasante", "ELS");
      const axilNormal = picoAxilPilar(res, r, "pilA1", "ELS");
      expect(axilPasante, `pilar de grupo B recoge la losa: axil>0; real=${axilPasante}`).toBeGreaterThan(0);
      expect(axilNormal, `pilar de grupo A recoge la losa: axil>0; real=${axilNormal}`).toBeGreaterThan(0);
      // Simetria de la crujia: el de otro grupo recoge lo mismo que uno del grupo del paño.
      expect(Math.abs(axilPasante - axilNormal) / axilNormal).toBeLessThan(1e-6);

      // Equilibrio global OK con el pilar de otro grupo en juego.
      expect(r.check_statics?.equilibrio_ok).toBe(true);

      console.log(
        `\n[L2b §5.7] axilPasante(grupoB)=${axilPasante.toFixed(2)} kN; axilNormal(grupoA)=${axilNormal.toFixed(2)} kN\n`,
      );
    },
    TIMEOUT_ARRANQUE,
  );

  it(
    "L3 · CONVERGENCIA: al afinar la malla, la flecha central se ESTABILIZA (el momento local NO se asevera)",
    () => {
      if (!arranque?.ok) return;
      const motor = arranque.motor; // narrowing estable para el closure
      const LADO = 6.0;
      // Misma geometria estable que L1 (esquinas 1..5); tam 1.0 y 0.5 caen en la rejilla.
      const pilares = [
        { id: "pil1", x: 1, y: 1 },
        { id: "pil2", x: 5, y: 1 },
        { id: "pil3", x: 1, y: 5 },
        { id: "pil4", x: 5, y: 5 },
      ];
      const flechaCon = (tam: number): number => {
        const res = discretizarOk(
          losaSobrePilares({ lado: LADO, tamMalla: tam, pilares, qUsuario: 5, pesoPropio: true }),
        );
        const r = motor.calcular(res.modeloFEM);
        const centro = nudoCentro(res, LADO / 2, LADO / 2);
        return r.nodos[centro]["ELS"].disp[1];
      };

      const dyGrueso = flechaCon(1.0); // 6x6
      const dyFino = flechaCon(0.5); // 12x12

      // Ambas hacia abajo, mismo orden de magnitud (converge, no diverge). La malla
      // fina refina; el cambio relativo es acotado (NO afirmamos un valor de momento
      // local: es dependiente de malla, T-f3-losa-plana-momento-local).
      expect(dyGrueso).toBeLessThan(0);
      expect(dyFino).toBeLessThan(0);
      const cambioRel = Math.abs(dyFino - dyGrueso) / Math.abs(dyFino);
      expect(cambioRel, `flecha grueso=${dyGrueso} fino=${dyFino} cambioRel=${cambioRel}`).toBeLessThan(0.5);

      console.log(
        `\n[L3] DY(1.0)=${dyGrueso.toExponential(3)} DY(0.5)=${dyFino.toExponential(3)} ` +
          `cambioRel=${(Math.abs(dyFino - dyGrueso) / Math.abs(dyFino) * 100).toFixed(1)}%\n`,
      );
    },
    TIMEOUT_ARRANQUE,
  );

  it(
    "L4 · LA RED ANTES DEL MOTOR: 2 pilares interiores COLINEALES (bordes libres) BLOQUEAN con PANO_PILARES_INSUFICIENTES (no llega al motor)",
    () => {
      // NO depende del motor: es puro discretizador (la red que evita calcular basura).
      // Con 2 apoyos (siempre colineales: 2 puntos = 1 recta) el plano de la losa BASCULA
      // y el solver disperso devuelve basura silenciosa (medido: flecha ~ -12 cm sin
      // lanzar). Validaciones lo ataja ANTES del motor con un error de obra.
      const res = discretizar(
        losaSobrePilares({
          lado: 6.0,
          tamMalla: 1.0,
          // Dos pilares interiores en la MISMA linea y=3 (colineales), sin vigas.
          pilares: [
            { id: "pil1", x: 2, y: 3 },
            { id: "pil2", x: 4, y: 3 },
          ],
          qUsuario: 5.0,
          pesoPropio: true,
        }),
      );

      // discretizar FALLA (ok:false): el pipeline NO produce Capa 2 -> NO llega al motor.
      expect(res.ok, "2 pilares colineales: discretizar debe BLOQUEAR (ok:false)").toBe(false);
      if (res.ok) return; // narrowing para TS (ya fallo el expect si era true)
      const codigos = res.errores.map((e) => e.codigo);
      expect(
        codigos,
        `debe emitir PANO_PILARES_INSUFICIENTES; codigos=${JSON.stringify(codigos)}`,
      ).toContain("PANO_PILARES_INSUFICIENTES");
      // El error apunta al paño y su mensaje esta en lenguaje de obra (nombra el paño y
      // guia a >=3 no alineados / un apoyo de borde), sin jerga FEM.
      const err = res.errores.find((e) => e.codigo === "PANO_PILARES_INSUFICIENTES")!;
      expect(err.elementoTipo).toBe("pano");
      expect(err.mensaje).toMatch(/pilares|alineados|borde/i);
      expect(err.mensaje).not.toMatch(/quad|N\*|drilling|release|nodo/i);

      console.log(`\n[L4] 2 colineales -> ok=${res.ok} codigos=${JSON.stringify(codigos)}\n`);
    },
  );

  it(
    "L4b · robustez del mecanismo: 3 pilares ALINEADOS tambien BLOQUEAN (colinealidad, no solo el conteo)",
    () => {
      // 3 pilares en la misma recta y=3: aunque son >=3, siguen ALINEADOS -> la losa
      // bascula igual. hayTresNoColineales debe seguir devolviendo false -> bloquea.
      const res = discretizar(
        losaSobrePilares({
          lado: 6.0,
          tamMalla: 1.0,
          pilares: [
            { id: "pil1", x: 1, y: 3 },
            { id: "pil2", x: 3, y: 3 },
            { id: "pil3", x: 5, y: 3 },
          ],
          qUsuario: 5.0,
          pesoPropio: true,
        }),
      );
      expect(res.ok, "3 pilares alineados: discretizar debe BLOQUEAR (ok:false)").toBe(false);
      if (res.ok) return;
      expect(res.errores.map((e) => e.codigo)).toContain("PANO_PILARES_INSUFICIENTES");
    },
  );
});
