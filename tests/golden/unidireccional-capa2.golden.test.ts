// GOLDEN Capa A del FORJADO UNIDIRECCIONAL (F3 corte "unidireccional", T3.1). Node PURO,
// SIN motor: asevera la ESTRUCTURA de la Capa 2 que emite discretizar() cuando un paño
// `tipo:"unidireccional"` monta VIGUETAS (members sinteticos biapoyados PV<idx>-V<k>), en
// lugar de una placa de quads. La FISICA (ΣV = presion·area, flecha 5qL⁴/384EI) es Capa B
// (motor real), fichero HERMANO tests/golden/unidireccional.golden.test.ts.
//
// Este golden es la RED DE SEGURIDAD del corte: blinda los invariantes I1-I7 del contrato
// (scratchpad/contrato-unidireccional.md) contra el JSON de Capa 2 real, sin acoplarse al
// solver. Cubre:
//   1) Forjado unidireccional AISLADO (rectangulo 4x5, "y", intereje 0.7 -> n=6, s=0.833...):
//      members PV0-V0..V5 con releases biarticulados exactos (I6), seccion VIG-0 con el swap
//      Iy<->Iz (I7), nudos PV0-N* en coordenadas exactas s·(k+½), apoyos patron spike, y
//      dist_loads FY- con Σ(w·L) = -presion·area EXACTO (I1->I2/I5).
//   2) ACOPLADO: 2 vigas de contorno en los bordes de apoyo -> extremos remapean a N* (la
//      viga se subdivide en tramos), muleta torsional SOLO en subdivisiones (no en esquinas),
//      sin apoyos aislados.
//   3) REGRESION byte a byte: un modelo mixto (portico + losa, SIN unidireccional) produce
//      EXACTAMENTE el mismo JSON que sin el corte; y el propio unidireccional es determinista
//      (reordenar la entrada -> mismo string).
//   4) VALIDACIONES de contrato: PANO_UNI_SIN_APOYO, PANO_PILAR_INTERIOR, reticular sigue
//      PANO_TIPO_NO_SOPORTADO; trazabilidad panoAMembers. (La presencia de los campos de
//      vigueta la garantiza ahora el borde Zod, no `discretizar` — T-f3-pano-schema-union.)
//   5) CM: termino del unidireccional (pesoPropio·A al centroide).
//
// Fixtures/builders LOCALES a este fichero (no se tocan tests/golden/_arnes/*).
import { describe, it, expect } from "vitest";
import { discretizar, calcularCentroMasaPlanta } from "../../src/discretizador";
import type { ResultadoDiscretizacion } from "../../src/discretizador";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";
import { seccionRectangular } from "../../src/biblioteca";
import { mToMm } from "../../src/unidades";
import type { Modelo, Pano, PanoUnidireccional, Pilar, Viga } from "../../src/dominio";
import { SCHEMA_VERSION, ID_HIP_PESO_PROPIO } from "../../src/dominio";

const MATERIAL = "HA-25";
const SECCION = "sec-viga";
const COTA = 3; // cota del paño (planta p1); la vertical FEM es Y (mapearEjes: [x, cota, y])

// mapearEjes(x,y,cota) = [x, cota, y]: la vertical es Y. Un punto de obra (px,py) a la cota
// del paño vive en el nodo FEM (x=px, y=cota, z=py).
function coordFEM(px: number, py: number, cota = COTA): [number, number, number] {
  return [px, cota, py];
}

type ResOK = Extract<ResultadoDiscretizacion, { ok: true }>;
function ok(res: ResultadoDiscretizacion): ResOK {
  if (!res.ok) {
    throw new Error(`discretizar fallo: ${JSON.stringify(res.errores, null, 2)}`);
  }
  return res;
}

// Nombre del nodo FEM en una coordenada EXACTA, o undefined si no existe.
function nombreEn(fem: ModeloFEM, [x, y, z]: [number, number, number]): string | undefined {
  return fem.nodes.find((nd) => nd.x === x && nd.y === y && nd.z === z)?.name;
}

// ============================================================================
// Builders. Un paño unidireccional AISLADO (sin vigas de contorno): las viguetas
// apoyan en nudos PROPIOS PV0-N* con el patron de apoyo del spike. Rectangulo 4x5
// (xMax-xMin=4, yMax-yMin=5). direccionViguetas="y" -> viguetas corren en Y (luz=5),
// reparto en X (B=4). intereje 0.7 -> n=round(4/0.7)=round(5.71)=6, s=4/6=0.666...
// ============================================================================

// Rectangulo de 4 nudos (0,0)-(4,0)-(4,5)-(0,5): B=4 (en X), luz=5 (en Y).
const NUDOS_RECT = [
  { id: "n1", x: 0, y: 0 },
  { id: "n2", x: 4, y: 0 },
  { id: "n3", x: 4, y: 5 },
  { id: "n4", x: 0, y: 5 },
];

function panoUni(id: string, extra?: Partial<PanoUnidireccional>): Pano {
  return {
    id,
    nombre: id.toUpperCase(),
    tipo: "unidireccional",
    plantaId: "p1",
    perimetro: ["n1", "n2", "n3", "n4"],
    materialId: MATERIAL,
    bordeApoyo: "simple",
    direccionViguetas: "y",
    intereje: 0.7,
    canto: 0.3,
    anchoNervio: 0.12,
    pesoPropio: 4,
    ...extra,
  };
}

// Forjado unidireccional AISLADO: solo el paño (sin pilares ni vigas). Sujeto por los apoyos
// nodales de borde de sus propias viguetas (bordeApoyo "simple" -> {DY} + muleta de plano).
function modeloAislado(extra?: Partial<PanoUnidireccional>): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: COTA, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [
      { id: SECCION, nombre: "Seccion 30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5 },
    ],
    nudos: NUDOS_RECT.map((n) => ({ ...n })),
    pilares: [],
    vigas: [],
    panos: [panoUni("f1", extra)],
    muros: [],
    cargas: [],
    // incluirPesoPropio ON exige la hipotesis automatica en el modelo (guard FALTA_PESO_PROPIO,
    // E1): se siembra igual que la UI la crea al activar el flag.
    hipotesis: [
      { id: ID_HIP_PESO_PROPIO, nombre: "Peso propio", tipo: "permanente", automatica: true },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

// ============================================================================
// CASO 1 · Forjado unidireccional AISLADO. n=6, s=4/6, luz=5, canto 0.30, anchoNervio 0.12.
// ============================================================================
describe("golden A · forjado unidireccional AISLADO (viguetas biapoyadas sobre nudos propios)", () => {
  const N = 6;
  const B = 4;
  const LUZ = 5;
  const S = B / N; // 0.666...
  const AREA = B * LUZ; // 20

  it("ok:true — el paño unidireccional se discretiza (no lo bloquea PANO_TIPO_NO_SOPORTADO)", () => {
    const res = discretizar(modeloAislado());
    if (!res.ok) {
      const cods = res.errores.map((e) => e.codigo);
      expect(cods).not.toContain("PANO_TIPO_NO_SOPORTADO");
      throw new Error(`deberia ser ok; errores: ${JSON.stringify(res.errores)}`);
    }
    expect(res.ok).toBe(true);
  });

  it("members PV0-V0..V5: n=6 viguetas, nombres deterministas, orden por indice k", () => {
    const fem = ok(discretizar(modeloAislado())).modeloFEM;
    const nombresPV = fem.members.filter((m) => m.name.startsWith("PV")).map((m) => m.name);
    const esperados = Array.from({ length: N }, (_, k) => `PV0-V${k}`);
    expect(nombresPV).toEqual(esperados);
    // Y estan al FINAL de members (tras los M<n> de la base, aqui ninguno): ningun member
    // "M*" precede porque no hay portico, pero el orden interno PV es por k ascendente.
    const res = ok(discretizar(modeloAislado()));
    expect(res.trazabilidad.panoAMembers?.["f1"]).toEqual(esperados);
  });

  it("cada vigueta corre en Y (luz=5) sobre nudos propios PV0-N* en x = xMin + s·(k+½)", () => {
    const res = ok(discretizar(modeloAislado()));
    const fem = res.modeloFEM;
    const porMember = new Map(fem.members.map((m) => [m.name, m]));
    const porNodo = new Map(fem.nodes.map((n) => [n.name, n]));

    for (let k = 0; k < N; k++) {
      const p = 0 + S * (k + 0.5); // x transversal de la vigueta k (reparto en X)
      const m = porMember.get(`PV0-V${k}`)!;
      const ni = porNodo.get(m.i)!;
      const nj = porNodo.get(m.j)!;
      // Ambos nudos son PROPIOS de vigueta (aislada, sin viga de contorno): prefijo PV.
      expect(m.i.startsWith("PV")).toBe(true);
      expect(m.j.startsWith("PV")).toBe(true);
      // i = extremo "a" (coord menor a lo largo de la luz -> y=0=yMin), j = "b" (y=5=yMax).
      // La vigueta corre en Y: ambos nudos comparten x=p, z(=obra-y) va de 0 a 5.
      expect(ni.x).toBeCloseTo(p, 12);
      expect(nj.x).toBeCloseTo(p, 12);
      expect(ni.y).toBe(COTA);
      expect(nj.y).toBe(COTA);
      expect(ni.z).toBeCloseTo(0, 12); // yMin (extremo a)
      expect(nj.z).toBeCloseTo(LUZ, 12); // yMax (extremo b)
      // Longitud FEM de la vigueta = luz (no el ancho B): R-7 (direccion no intercambiada).
      const L = Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z);
      expect(L).toBeCloseTo(LUZ, 12);
    }
  });

  it("I6 · release biapoyado EXACTO: Ry,Rz liberados ambos extremos; Rx (indices 3 y 9) NUNCA", () => {
    const fem = ok(discretizar(modeloAislado())).modeloFEM;
    const esperado = [
      false, false, false, false, true, true, // i: Ryi,Rzi liberados, Rxi (idx 3) false
      false, false, false, false, true, true, // j: Ryj,Rzj liberados, Rxj (idx 9) false
    ];
    for (const m of fem.members.filter((x) => x.name.startsWith("PV"))) {
      expect(m.releases).toEqual(esperado);
      // Blindaje explicito del error nº1 torsional (#8): torsion NUNCA liberada.
      expect(m.releases![3]).toBe(false); // Rxi
      expect(m.releases![9]).toBe(false); // Rxj
    }
  });

  it("I7 · seccion VIG-0 unica con swap Iy<->Iz aplicado (el canto gobierna la flexion vertical)", () => {
    const fem = ok(discretizar(modeloAislado())).modeloFEM;
    const vig = fem.sections.filter((s) => s.name.startsWith("VIG-"));
    expect(vig).toHaveLength(1); // una seccion por paño
    expect(vig[0].name).toBe("VIG-0");

    // Propiedades del rectangulo anchoNervio(0.12) x canto(0.30) por la FUENTE UNICA
    // (seccionRectangular espera mm). Convenio DOMINIO: Iy = eje fuerte (canto), Iz = debil.
    const dom = seccionRectangular(mToMm(0.12), mToMm(0.3));
    expect(dom.A).toBeCloseTo(0.036, 12); // 0.12·0.30
    // El EMISOR (discretizar) hace el swap seccionFEMParaPyNite: campo FEM Iy <- domIz,
    // Iz <- domIy. Asi el canto (domIy, mayor) queda en el campo Iz que gobierna la flexion
    // vertical de la barra horizontal (I7). Sin el swap, la vigueta se calcularia "acostada".
    expect(vig[0].A).toBeCloseTo(dom.A, 12);
    expect(vig[0].Iy).toBeCloseTo(dom.Iz, 15); // FEM Iy = eje debil (ancho)
    expect(vig[0].Iz).toBeCloseTo(dom.Iy, 15); // FEM Iz = eje fuerte (canto) -> flexion vertical
    // El canto gobierna: FEM Iz (fuerte) > FEM Iy (debil). Prueba de que NO va "acostada".
    expect(vig[0].Iz).toBeGreaterThan(vig[0].Iy);
    expect(vig[0].J).toBe(0);
    // Todos los members de vigueta referencian esa unica seccion.
    for (const m of fem.members.filter((x) => x.name.startsWith("PV"))) {
      expect(m.section).toBe("VIG-0");
      expect(m.material).toBe(MATERIAL);
    }
  });

  it("apoyos nodales de borde: patron spike (extremo a = 6 GDL; extremo b = todo menos DX)", () => {
    const res = ok(discretizar(modeloAislado()));
    const fem = res.modeloFEM;
    const porMember = new Map(fem.members.map((m) => [m.name, m]));
    const porSupport = new Map(fem.supports.map((s) => [s.node, s]));

    for (let k = 0; k < N; k++) {
      const m = porMember.get(`PV0-V${k}`)!;
      const sa = porSupport.get(m.i)!; // extremo a (i, arranque)
      const sb = porSupport.get(m.j)!; // extremo b (j, final)
      expect(sa).toBeDefined();
      expect(sb).toBeDefined();
      // Extremo a (i): APOYO_VIGUETA_AISLADA_I = restringe TODO (6 GDL).
      expect(sa).toMatchObject({ DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true });
      // Extremo b (j): APOYO_VIGUETA_AISLADA_J = todo menos DX (el axil lo fija el extremo i).
      expect(sb).toMatchObject({ DX: false, DY: true, DZ: true, RX: true, RY: true, RZ: true });
    }
    // Todos los apoyos de vigueta se registran como "apoyos de malla" (TablaReacciones los
    // agrupa/oculta). Aislado sin portico: TODO support es de un nudo propio PV*.
    const apoyosMalla = new Set(res.trazabilidad.apoyosDeMalla);
    for (const s of fem.supports) {
      expect(s.node.startsWith("PV")).toBe(true);
      expect(apoyosMalla.has(s.node)).toBe(true);
    }
  });

  it("I1/I5 · dist_loads FY con w = -(presion·s); Σ(w·L) = -presion_total·area EXACTO", () => {
    const res = ok(discretizar(modeloAislado()));
    const fem = res.modeloFEM;
    // pesoPropio=4 kN/m², incluirPesoPropio ON -> unica fuente de presion = pp tabulado, en el
    // case hip-peso-propio. w_k = -(4·s), TODAS las viguetas iguales.
    const distPV = fem.dist_loads.filter((d) => d.member.startsWith("PV"));
    expect(distPV).toHaveLength(N); // una carga por vigueta (una sola fuente de presion)
    const wEsperada = -(4 * S);
    for (const d of distPV) {
      expect(d.direction).toBe("FY"); // I5: GLOBAL FY (gravedad), no local ni FZ
      expect(d.w1).toBeCloseTo(wEsperada, 12);
      expect(d.w2).toBeCloseTo(wEsperada, 12); // uniforme (w1==w2)
      expect(d.x1).toBeNull(); // toda la barra
      expect(d.x2).toBeNull();
      expect(d.case).toBe(ID_HIP_PESO_PROPIO); // "hip-peso-propio"
      // I5: la carga gravitatoria SIEMPRE apunta hacia abajo (FY NEGATIVO). Si algun w
      // saliera positivo (carga hacia arriba) este golden FALLA -> error nº1 cazado.
      expect(d.w1).toBeLessThan(0);
    }
    // I1->I2: Σ(w·L) sobre todas las viguetas = -(presion_total · area). Cada vigueta lleva
    // w·luz = -(4·s)·5; Σ_k = -(4·5)·Σs = -(4·5)·B = -(4·area). Σ tributarios = B EXACTO (I1).
    const sumaWL = distPV.reduce((acc, d) => acc + d.w1 * LUZ, 0);
    expect(sumaWL).toBeCloseTo(-(4 * AREA), 10);
  });

  it("pesoPropio va en case hip-peso-propio y SOLO se emite con incluirPesoPropio ON (R-2)", () => {
    // Flag OFF: ningun dist_load de vigueta en el case de peso propio (gated, igual que barras/losa).
    const off = ok(discretizar(modeloAislado())); // (control ON arriba)
    void off;
    const m = modeloAislado();
    m.analisis.incluirPesoPropio = false;
    const femOff = ok(discretizar(m)).modeloFEM;
    const ppOff = femOff.dist_loads.filter(
      (d) => d.member.startsWith("PV") && d.case === ID_HIP_PESO_PROPIO,
    );
    expect(ppOff).toEqual([]); // sin peso propio -> sin dist_load de vigueta (no hay otra fuente)
  });

  it("R-3 · vigueta unica (n=1): intereje enorme -> 1 vigueta centrada, tributario = B", () => {
    // intereje 10 > B=4 -> round(4/10)=0 -> max(1,0)=1. Una sola vigueta en x = B/2 = 2.
    const fem = ok(discretizar(modeloAislado({ intereje: 10 }))).modeloFEM;
    const pv = fem.members.filter((mm) => mm.name.startsWith("PV"));
    expect(pv).toHaveLength(1);
    expect(pv[0].name).toBe("PV0-V0");
    const porNodo = new Map(fem.nodes.map((n) => [n.name, n]));
    expect(porNodo.get(pv[0].i)!.x).toBeCloseTo(2, 12); // centrada en B/2
    // Tributario = B -> w = -(4·B). Σ(w·L) sigue = -(4·area).
    const d = fem.dist_loads.find((x) => x.member === "PV0-V0" && x.case === ID_HIP_PESO_PROPIO)!;
    expect(d.w1).toBeCloseTo(-(4 * B), 12);
  });
});

// ============================================================================
// CASO 2 · ACOPLADO. Mismo forjado con 2 vigas de contorno COMPLETAS en los bordes de
// APOYO (y=0 e y=5, los que las viguetas cruzan) + pilares en las 4 esquinas. Los extremos
// de vigueta remapean a N* de las vigas de contorno subdivididas; muleta torsional SOLO en
// los nudos de subdivision nacidos de viguetas, NO en las esquinas preexistentes.
// ============================================================================

// Las viguetas corren en Y y apoyan en los bordes y=0 (extremo a) e y=5 (extremo b). Para
// que remapeen a N*, se ponen vigas de contorno EN ESOS bordes: v_inf (n1->n2, y=0) y
// v_sup (n4->n3, y=5). Pilares en las 4 esquinas para dar arranque real a la obra.
function modeloAcoplado(): Modelo {
  const esquinas: Array<[string, number, number]> = [
    ["n1", 0, 0],
    ["n2", 4, 0],
    ["n3", 4, 5],
    ["n4", 0, 5],
  ];
  const pilares: Pilar[] = esquinas.map(([, x, y], k) => ({
    id: `pil${k + 1}`,
    nombre: `P${k + 1}`,
    x,
    y,
    plantaInicial: "p0",
    plantaFinal: "p1",
    seccionId: SECCION,
    materialId: MATERIAL,
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado",
  }));
  // Vigas EN LOS BORDES DE APOYO (y=0 e y=5): esas son las que las viguetas cruzan.
  const vigas: Viga[] = (
    [
      ["vinf", "n1", "n2"], // borde y=0 (extremo a de las viguetas)
      ["vsup", "n4", "n3"], // borde y=5 (extremo b)
    ] as const
  ).map(([id, ni, nj]) => ({
    id,
    nombre: id.toUpperCase(),
    plantaId: "p1",
    nudoI: ni,
    nudoJ: nj,
    seccionId: SECCION,
    materialId: MATERIAL,
    extremoI: "empotrado",
    extremoJ: "empotrado",
    tirante: false,
  }));
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: COTA, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [
      { id: SECCION, nombre: "Seccion 30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5 },
    ],
    nudos: NUDOS_RECT.map((n) => ({ ...n })),
    pilares,
    vigas,
    panos: [panoUni("f1", { bordeApoyo: "libre" })], // libre pero apoyado por las 2 vigas
    muros: [],
    cargas: [],
    // incluirPesoPropio ON exige la hipotesis automatica (guard FALTA_PESO_PROPIO, E1).
    hipotesis: [
      { id: ID_HIP_PESO_PROPIO, nombre: "Peso propio", tipo: "permanente", automatica: true },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

describe("golden A · forjado unidireccional ACOPLADO (extremos remapean a vigas de contorno)", () => {
  const N = 6;
  const S = 4 / N;

  it("ok:true — apoyado por las 2 vigas de contorno (bordeApoyo libre NO dispara PANO_UNI_SIN_APOYO)", () => {
    const res = discretizar(modeloAcoplado());
    if (!res.ok) {
      const cods = res.errores.map((e) => e.codigo);
      expect(cods).not.toContain("PANO_UNI_SIN_APOYO");
      throw new Error(`deberia ser ok; errores: ${JSON.stringify(res.errores)}`);
    }
    expect(res.ok).toBe(true);
  });

  it("los extremos de vigueta remapean a N* estructurales (comparten nudo con la viga subdividida)", () => {
    const fem = ok(discretizar(modeloAcoplado())).modeloFEM;
    const porNodo = new Map(fem.nodes.map((n) => [n.name, n]));
    for (let k = 0; k < N; k++) {
      const m = fem.members.find((x) => x.name === `PV0-V${k}`)!;
      // Ambos extremos son N* del portico (nacidos de la subdivision de la viga de borde),
      // NO nudos propios PV*: la vigueta descarga en la viga, no en un apoyo aislado.
      expect(/^N\d+$/.test(m.i)).toBe(true);
      expect(/^N\d+$/.test(m.j)).toBe(true);
      // El N* cae EXACTAMENTE en la interseccion vigueta-borde: x = s·(k+½), z(obra-y) = 0 o 5.
      const p = S * (k + 0.5);
      const ni = porNodo.get(m.i)!;
      const nj = porNodo.get(m.j)!;
      expect(ni.x).toBeCloseTo(p, 12);
      expect(ni.z).toBeCloseTo(0, 12);
      expect(nj.x).toBeCloseTo(p, 12);
      expect(nj.z).toBeCloseTo(5, 12);
    }
  });

  it("las vigas de contorno se subdividen en tramos (vigaAMembers de longitud > 1)", () => {
    const res = ok(discretizar(modeloAcoplado()));
    const t = res.trazabilidad;
    // Cada viga de borde recibe un N* por cada vigueta que la cruza -> se trocea en N tramos.
    for (const vid of ["vinf", "vsup"]) {
      const tramos = t.vigaAMembers[vid];
      expect(tramos).toBeDefined();
      expect(tramos.length).toBeGreaterThan(1); // subdividida, no un solo member
    }
  });

  it("sin apoyos aislados de vigueta: ningun nudo propio PV*, la sujecion es del portico", () => {
    const res = ok(discretizar(modeloAcoplado()));
    const fem = res.modeloFEM;
    // Con ambos extremos en el portico, NINGUNA vigueta es "aislada": no hay nudos propios PV-N*.
    expect(fem.nodes.some((n) => n.name.startsWith("PV"))).toBe(false);
    // Ni un solo support sobre un nudo propio de vigueta (no existen).
    expect(fem.supports.some((s) => s.node.startsWith("PV"))).toBe(false);
    // Los apoyos son SOLO los arranques de pilar (pies, cota 0).
    const porNodo = new Map(fem.nodes.map((n) => [n.name, n]));
    for (const s of fem.supports) {
      // Un support de vigueta seria una muleta torsional (RX/RZ) sobre un N* de subdivision;
      // los arranques de pilar estan en cota 0. Comprobamos que TODO support estructural
      // (no muleta) esta en cota 0, y que las muletas -si las hay- solo tocan RX/RZ.
      const nodo = porNodo.get(s.node)!;
      const esMuletaPura =
        !s.DX && !s.DY && !s.DZ && !s.RY && (s.RX || s.RZ);
      if (!esMuletaPura) {
        expect(nodo.y).toBe(0); // arranque de pilar
      }
    }
  });

  it("muleta torsional SOLO en subdivisiones (no en las esquinas preexistentes sobre pilar)", () => {
    const res = ok(discretizar(modeloAcoplado()));
    const fem = res.modeloFEM;
    const porNodo = new Map(fem.nodes.map((n) => [n.name, n]));
    // Las esquinas del paño caen sobre cabezas de pilar (N* preexistentes). Un extremo de
    // vigueta interior de un borde (x = s·(k+½), nunca 0 ni 4) es una SUBDIVISION -> puede
    // llevar muleta. Ninguna vigueta k tiene x=0 ni x=4 (k+½ nunca es 0 ni n), asi que la
    // muleta -si existe- NUNCA cae sobre una esquina.
    // Cabezas de pilar = N* a cota COTA en las 4 esquinas.
    const esquinasCota = [
      coordFEM(0, 0),
      coordFEM(4, 0),
      coordFEM(4, 5),
      coordFEM(0, 5),
    ];
    const nombresEsquina = new Set(
      esquinasCota.map((c) => nombreEn(fem, c)).filter((n): n is string => n !== undefined),
    );
    for (const s of fem.supports) {
      const nodo = porNodo.get(s.node)!;
      // ¿Es una muleta torsional pura (solo RX o RZ, sin traslaciones)?
      const esMuletaTorsion = !s.DX && !s.DY && !s.DZ && !s.RY && (s.RX || s.RZ);
      if (esMuletaTorsion) {
        // Nunca sobre una esquina (cabeza de pilar: rigidez real, la muleta robaria momento).
        expect(nombresEsquina.has(s.node)).toBe(false);
        // Y su x es una posicion de subdivision s·(k+½), no una esquina (0 ni 4).
        expect(nodo.x === 0 || nodo.x === 4).toBe(false);
      }
    }
  });
});

// ============================================================================
// CASO 3 · REGRESION byte a byte + determinismo. (a) Un modelo mixto (portico + losa
// maciza, SIN unidireccional) produce EXACTAMENTE el mismo JSON antes y despues del corte
// (clonamos la tecnica del golden de losa-plana: no comparamos "antes" -no lo tenemos-,
// sino que el corte NO introduce claves/members PV/VIG en un modelo sin unidireccionales).
// (b) El propio unidireccional es determinista: reordenar la entrada -> mismo string.
// ============================================================================

// Modelo mixto SIN unidireccional: portico (2 pilares + 1 viga) + una losa maciza. Es el
// tipo de modelo cuya Capa 2 NO debe cambiar ni un byte por el corte unidireccional.
function modeloMixtoSinUni(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: COTA, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [
      { id: SECCION, nombre: "Seccion 30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5 },
    ],
    nudos: NUDOS_RECT.map((n) => ({ ...n })),
    pilares: [
      { id: "pil1", nombre: "P1", x: 0, y: 0, plantaInicial: "p0", plantaFinal: "p1", seccionId: SECCION, materialId: MATERIAL, angulo: 0, vinculacionExterior: true, arranque: "empotrado" },
      { id: "pil2", nombre: "P2", x: 4, y: 0, plantaInicial: "p0", plantaFinal: "p1", seccionId: SECCION, materialId: MATERIAL, angulo: 0, vinculacionExterior: true, arranque: "empotrado" },
      { id: "pil3", nombre: "P3", x: 4, y: 5, plantaInicial: "p0", plantaFinal: "p1", seccionId: SECCION, materialId: MATERIAL, angulo: 0, vinculacionExterior: true, arranque: "empotrado" },
      { id: "pil4", nombre: "P4", x: 0, y: 5, plantaInicial: "p0", plantaFinal: "p1", seccionId: SECCION, materialId: MATERIAL, angulo: 0, vinculacionExterior: true, arranque: "empotrado" },
    ],
    vigas: (
      [
        ["v1", "n1", "n2"],
        ["v2", "n2", "n3"],
        ["v3", "n3", "n4"],
        ["v4", "n4", "n1"],
      ] as const
    ).map(([id, ni, nj]) => ({
      id,
      nombre: id.toUpperCase(),
      plantaId: "p1",
      nudoI: ni,
      nudoJ: nj,
      seccionId: SECCION,
      materialId: MATERIAL,
      extremoI: "empotrado",
      extremoJ: "empotrado",
      tirante: false,
    })),
    panos: [
      {
        id: "losa1",
        nombre: "LOSA1",
        tipo: "losa",
        plantaId: "p1",
        perimetro: ["n1", "n2", "n3", "n4"],
        espesor: 0.2,
        materialId: MATERIAL,
        tamMalla: 1,
        bordeApoyo: "libre",
      },
    ],
    muros: [],
    cargas: [{ id: "c1", tipo: "superficial", ambito: "losa1", valor: 5, hipotesisId: "h1" }],
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

describe("golden A · REGRESION byte a byte: el corte unidireccional NO toca un modelo sin viguetas", () => {
  it("un modelo mixto (portico + losa, sin unidireccional) no emite NINGUN PV/VIG-/panoAMembers no vacio", () => {
    const res = ok(discretizar(modeloMixtoSinUni()));
    const fem = res.modeloFEM;
    // Sin members de vigueta ni seccion sintetica.
    expect(fem.members.some((m) => m.name.startsWith("PV"))).toBe(false);
    expect(fem.sections.some((s) => s.name.startsWith("VIG-"))).toBe(false);
    expect(fem.nodes.some((n) => n.name.startsWith("PV"))).toBe(false);
    expect(fem.dist_loads.some((d) => d.member.startsWith("PV"))).toBe(false);
    expect(fem.supports.some((s) => s.node.startsWith("PV"))).toBe(false);
    // panoAMembers presente (aditivo) pero VACIO (no hay paños unidireccionales).
    expect(res.trazabilidad.panoAMembers).toEqual({});
  });

  it("determinismo del modelo mixto: reordenar la entrada produce EXACTAMENTE el mismo JSON", () => {
    const a = ok(discretizar(modeloMixtoSinUni()));
    const m = modeloMixtoSinUni();
    m.nudos.reverse();
    m.pilares.reverse();
    m.vigas.reverse();
    m.panos.reverse();
    m.cargas.reverse();
    const b = ok(discretizar(m));
    // Byte a byte: mismo ModeloFEM y misma Trazabilidad tras reordenar (determinismo).
    expect(JSON.stringify(b.modeloFEM)).toBe(JSON.stringify(a.modeloFEM));
    expect(JSON.stringify(b.trazabilidad)).toBe(JSON.stringify(a.trazabilidad));
  });

  it("I4 · determinismo del unidireccional AISLADO: reordenar nudos -> el mismo JSON byte a byte", () => {
    const a = ok(discretizar(modeloAislado()));
    const m = modeloAislado();
    m.nudos.reverse(); // reordenar el perimetro no cambia la geometria resuelta
    const b = ok(discretizar(m));
    expect(JSON.stringify(b.modeloFEM)).toBe(JSON.stringify(a.modeloFEM));
    expect(JSON.stringify(b.trazabilidad)).toBe(JSON.stringify(a.trazabilidad));
  });

  it("I4 · determinismo del ACOPLADO: reordenar pilares/vigas/nudos -> el mismo JSON byte a byte", () => {
    const a = ok(discretizar(modeloAcoplado()));
    const m = modeloAcoplado();
    m.pilares.reverse();
    m.vigas.reverse();
    m.nudos.reverse();
    const b = ok(discretizar(m));
    expect(JSON.stringify(b.modeloFEM)).toBe(JSON.stringify(a.modeloFEM));
    expect(JSON.stringify(b.trazabilidad)).toBe(JSON.stringify(a.trazabilidad));
  });

  it("dos discretizaciones IDENTICAS del unidireccional producen el mismo string (sin azar)", () => {
    const a = JSON.stringify(ok(discretizar(modeloAislado())).modeloFEM);
    const b = JSON.stringify(ok(discretizar(modeloAislado())).modeloFEM);
    expect(b).toBe(a);
  });
});

// ============================================================================
// CASO 4 · VALIDACIONES de contrato. discretizar() corre validarModelo internamente y
// devuelve ok:false con los errores de obra. Aqui blindamos que los codigos correctos
// bloquean ANTES de llegar a Capa 2 (no se calcula basura plausible).
// ============================================================================
describe("golden A · validaciones de contrato del unidireccional (bloquean antes de Capa 2)", () => {
  // NOTA (T-f3-pano-schema-union): el antiguo golden "PANO_UNI_CAMPOS: unidireccional sin
  // campos -> bloquea" DESAPARECIO. La presencia y positividad de los campos de vigueta la
  // garantiza ahora el BORDE Zod (union discriminada: `PanoUnidireccionalSchema` los declara
  // obligatorios y > 0), no un chequeo en `discretizar`. Un paño uni sin esos campos ya no es
  // ni construible en TS ni parseable por ModeloSchema en import — esa cobertura vive en
  // dominio.test.ts ("PanoSchema · union discriminada"). Aqui solo se calcula sobre modelos
  // ya validos por el schema.

  it("PANO_UNI_SIN_APOYO: bordeApoyo libre + sin viga en un borde de apoyo -> bloquea", () => {
    // Aislado (sin vigas) con bordeApoyo "libre": las viguetas quedan con extremos sueltos.
    const res = discretizar(modeloAislado({ bordeApoyo: "libre" }));
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("no deberia ser ok: viguetas sin apoyo");
    expect(res.errores.map((e) => e.codigo)).toContain("PANO_UNI_SIN_APOYO");
  });

  it("PANO_PILAR_INTERIOR (fix R-4): un pilar interior bajo unidireccional -> bloquea", () => {
    // El acoplado, pero con un pilar EXTRA en el interior estricto del paño (2, 2.5). El
    // filtro relajado (losa || unidireccional) lo detecta -> PANO_PILAR_INTERIOR (DP4).
    const m = modeloAcoplado();
    m.pilares.push({
      id: "pilInt",
      nombre: "PI",
      x: 2,
      y: 2.5,
      plantaInicial: "p0",
      plantaFinal: "p1",
      seccionId: SECCION,
      materialId: MATERIAL,
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado",
    });
    const res = discretizar(m);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("no deberia ser ok: pilar interior bajo unidireccional");
    expect(res.errores.map((e) => e.codigo)).toContain("PANO_PILAR_INTERIOR");
  });

  it("DP5 · reticular sigue rechazado con PANO_TIPO_NO_SOPORTADO (solo se levanto unidireccional)", () => {
    const m = modeloAislado();
    // Mismo paño rectangular pero como reticular VALIDO (union discriminada: sus campos
    // propios, con capaCompresion). Su calculo llega en un corte posterior; en F2 se rechaza.
    m.panos = [
      {
        id: "f1",
        nombre: "F1",
        tipo: "reticular",
        plantaId: "p1",
        perimetro: ["n1", "n2", "n3", "n4"],
        materialId: MATERIAL,
        bordeApoyo: "simple",
        intereje: 0.8,
        canto: 0.3,
        anchoNervio: 0.12,
        capaCompresion: 0.05,
        pesoPropio: 4,
      },
    ];
    const res = discretizar(m);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("no deberia ser ok: reticular no soportado");
    const cods = res.errores.map((e) => e.codigo);
    expect(cods).toContain("PANO_TIPO_NO_SOPORTADO");
    // Y NO cae en un codigo de unidireccional (no es unidireccional): PANO_UNI_SIN_APOYO no sale.
    expect(cods).not.toContain("PANO_UNI_SIN_APOYO");
  });

  it("trazabilidad panoAMembers mapea el paño unidireccional a SUS members de vigueta", () => {
    const res = ok(discretizar(modeloAislado()));
    const pam = res.trazabilidad.panoAMembers ?? {};
    expect(pam["f1"]).toEqual(["PV0-V0", "PV0-V1", "PV0-V2", "PV0-V3", "PV0-V4", "PV0-V5"]);
    // Y esos members existen de verdad en la Capa 2 (el mapa no apunta a fantasmas).
    const nombres = new Set(res.modeloFEM.members.map((m) => m.name));
    for (const mm of pam["f1"]) expect(nombres.has(mm)).toBe(true);
  });
});

// ============================================================================
// CASO 5 · CENTRO DE MASAS. El termino del unidireccional = pesoPropio·A al centroide del
// rectangulo (mas CM de planta + superficiales permanentes, ninguno aqui). Es PURO (no
// motor), asi que encaja en este golden Capa A (no hay un golden de CM aparte; la funcion
// se ejerce en unit tests, y aqui verificamos el enganche del corte unidireccional).
// ============================================================================
describe("golden A · centro de masas del forjado unidireccional (pesoPropio·A al centroide)", () => {
  it("CM de la planta = centroide del rectangulo, peso = pesoPropio·area", () => {
    // Forjado aislado 4x5, pesoPropio 4 kN/m². Sin pilares/vigas -> la unica masa permanente
    // de la planta p1 es el forjado. Centroide del rectangulo (0..4, 0..5) = (2, 2.5).
    const cm = calcularCentroMasaPlanta(modeloAislado(), "p1");
    expect(cm).not.toBeNull();
    expect(cm!.x).toBeCloseTo(2, 12);
    expect(cm!.y).toBeCloseTo(2.5, 12);
    // Peso permanente = pesoPropio · area = 4 · (4·5) = 80 kN.
    expect(cm!.pesoTotal).toBeCloseTo(4 * 4 * 5, 10);
  });

  it("pesoPropio 0 -> el unidireccional no aporta masa permanente (CM null si no hay otra masa)", () => {
    const cm = calcularCentroMasaPlanta(modeloAislado({ pesoPropio: 0 }), "p1");
    // Sin pesoPropio ni cargas permanentes ni barras en la planta, no hay masa -> null.
    expect(cm).toBeNull();
  });
});
