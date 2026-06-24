// Unit del deriver PURO deformadaGeometria (feature-14, Tarea 2.1/3.2 + Fase 2). Aunque
// vive bajo src/ui/, la funcion no toca React/R3F: el test corre en el project `jsdom`
// (include src/ui/**) pero ejercita solo logica pura. Verifica la transformacion
// FEM(Y-up) -> escena(Z-up) [FEM.x, FEM.z, FEM.y] con disp [DX,DZ,DY], la escala
// lineal, la POLILINEA flectada (deformada_global por estacion), la flecha del vano y
// los casos de borde (null / combo inexistente -> vacio, sin lanzar; fallback sin
// deformada_global -> polilinea de 2 puntos).
//
// CONSTRUIMOS UN ModeloFEM REAL discretizando un fixture de libro (no inventamos
// coordenadas a mano): asi el test queda anclado a la salida real del discretizador
// y caza si la convencion de ejes del discretizador y la del overlay se separan.
import { describe, it, expect } from "vitest";
import { discretizar } from "../../discretizador";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { fixtureBiapoyadaUDL } from "../../../tests/golden/_arnes/fixtures";
import { deformadaGeometria } from "./deformadaGeometria";

// Discretiza el fixture biapoyado (4 nodos: N1,N2 pies Y=0; N3,N4 cabezas Y=3) y
// devuelve la Capa 2. Si el fixture quedara invalido, el test debe fallar ruidoso.
function femBiapoyada(): ModeloFEM {
  const res = discretizar(fixtureBiapoyadaUDL({ L: 6, q: 10, cota: 3 }));
  if (!res.ok) throw new Error("fixture invalido en deformadaGeometria.test");
  return res.modeloFEM;
}

// Diagrama (2,n) de relleno: posiciones x uniformes [0..1], valores 0. Solo importa
// la FORMA; el deriver de geometria no lee axial/shear/moment/defl.
function diagramaRelleno(n: number): number[][] {
  const xs = Array.from({ length: n }, (_, k) => k / (n - 1));
  const vs = Array.from({ length: n }, () => 0);
  return [xs, vs];
}

// Resultados sinteticos: disp por nodo + (opcional) deformada_global por barra/combo.
// El generador permite fijar tanto el disp de cada nudo (fallback) como la deformada
// global de cada barra (ruta principal Fase 2). No usa el motor: solo la forma del
// contrato (disp = [DX,DY,DZ,RX,RY,RZ]; deformada_global = [DX[],DY[],DZ[]]).
function resultadosCon(
  combo: string,
  dispPorNodo: Record<string, [number, number, number]>,
  deformadaPorBarra: Record<string, [number[], number[], number[]]> = {},
): ResultadosCalculo {
  const nodos: ResultadosCalculo["nodos"] = {};
  for (const [nombre, [dx, dy, dz]] of Object.entries(dispPorNodo)) {
    nodos[nombre] = {
      [combo]: {
        disp: [dx, dy, dz, 0, 0, 0], // giros irrelevantes para la deformada de barras
        rxn: [0, 0, 0, 0, 0, 0],
      },
    };
  }
  const barras: ResultadosCalculo["barras"] = {};
  for (const [nombre, def] of Object.entries(deformadaPorBarra)) {
    const n = def[0].length;
    barras[nombre] = {
      [combo]: {
        axial: diagramaRelleno(n),
        shear_y: diagramaRelleno(n),
        moment_z: diagramaRelleno(n),
        defl_y: diagramaRelleno(n),
        deformada_global: def,
        max_moment_z: 0,
        min_moment_z: 0,
        max_shear_y: 0,
      },
    };
  }
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: [combo],
    nodos,
    barras,
    check_statics: null,
  };
}

// Localiza la polilinea cuyo PRIMER punto base (sin desplazar) coincide con `base`.
// Util para anclar tests al pilar M1 (N1->N3) de forma estable. Usamos escala 0 al
// generar para que el primer punto sea exactamente la base del nudo i.
function polilineaQueArrancaEn(
  geo: ReturnType<typeof deformadaGeometria>,
  base: [number, number, number],
) {
  return geo.polilineas.find(
    (pl) =>
      pl.puntos[0]![0] === base[0] &&
      pl.puntos[0]![1] === base[1] &&
      pl.puntos[0]![2] === base[2],
  );
}

describe("deformadaGeometria · proyeccion FEM(Y-up) -> escena(Z-up)", () => {
  it("lleva cada estacion a [FEM.x, FEM.z, FEM.y] + disp[DX,DZ,DY]·escala", () => {
    const fem = femBiapoyada();
    // N3 = cabeza izq en FEM (0,3,0). El pilar M1 (N1->N3) tiene deformada_global de
    // 2 estaciones: extremo i sin mover, extremo j con DY=-0.01 (descenso vertical
    // FEM). En escena la vertical es Z, asi que ese DY debe aparecer en la 3a
    // componente (intercambio Y<->Z), NO en la 2a.
    const escala = 100;
    const r = resultadosCon(
      "ELU",
      { N1: [0, 0, 0], N2: [0, 0, 0], N3: [0, -0.01, 0], N4: [0, 0, 0] },
      { M1: [[0, 0], [0, -0.01], [0, 0]] }, // [DX[],DY[],DZ[]] en estaciones i,j
    );
    const geo = deformadaGeometria(fem, r, "ELU", escala);

    // El pilar M1 arranca con base en N1 a escala 100 (extremo i con disp 0 -> base).
    const pl = polilineaQueArrancaEn(geo, [0, 0, 0]);
    expect(pl).toBeDefined();
    expect(pl!.puntos).toHaveLength(2);
    // Ultima estacion = N3 desplazado. Base de N3 en escena = [FEM.x, FEM.z, FEM.y] =
    // [0, 0, 3]. disp escena = [DX, DZ, DY]·escala = [0, 0, -0.01]·100 = [0,0,-1].
    // => [0, 0, 3 - 1] = [0, 0, 2]: el nodo BAJA en la Z de escena (vertical).
    const fin = pl!.puntos[1]!;
    expect(fin[0]).toBeCloseTo(0, 9);
    expect(fin[1]).toBeCloseTo(0, 9);
    expect(fin[2]).toBeCloseTo(2, 9);
    // La magnitud fisica es el modulo del disp SIN escalar (0.01 m).
    expect(pl!.mags[1]).toBeCloseTo(0.01, 9);
  });

  it("la escala amplifica linealmente el desplazamiento (x2 escala = x2 offset)", () => {
    const fem = femBiapoyada();
    const r = resultadosCon(
      "ELU",
      { N1: [0, 0, 0], N2: [0, 0, 0], N3: [0, -0.01, 0], N4: [0, 0, 0] },
      { M1: [[0, 0], [0, -0.01], [0, 0]] },
    );
    const g1 = deformadaGeometria(fem, r, "ELU", 100);
    const g2 = deformadaGeometria(fem, r, "ELU", 200);

    const z1 = polilineaQueArrancaEn(g1, [0, 0, 0])!.puntos[1]![2];
    const z2 = polilineaQueArrancaEn(g2, [0, 0, 0])!.puntos[1]![2];
    // base de N3 en Z = 3; offset1 = -1 (z=2), offset2 = -2 (z=1): doble offset.
    expect(3 - z1).toBeCloseTo(1, 9);
    expect(3 - z2).toBeCloseTo(2, 9);
    expect(3 - z2).toBeCloseTo((3 - z1) * 2, 9);
    // La magnitud fisica NO depende de la escala (es el disp real).
    const magFin = (g: typeof g1) => polilineaQueArrancaEn(g, [0, 0, 0])!.mags[1]!;
    expect(magFin(g1)).toBeCloseTo(magFin(g2), 12);
  });

  it("escala 0 deja la geometria sin deformar (puntos = posiciones base)", () => {
    const fem = femBiapoyada();
    const r = resultadosCon(
      "ELU",
      { N1: [0, 0, 0], N2: [0, 0, 0], N3: [0.05, -0.01, 0.02], N4: [0, 0, 0] },
      { M1: [[0, 0.05], [0, -0.01], [0, 0.02]] },
    );
    const geo = deformadaGeometria(fem, r, "ELU", 0);
    // Con escala 0 ningun punto se mueve: la ultima estacion de M1 = base de N3 en
    // escena = [0, 0, 3], pero la magnitud fisica del disp sigue siendo > 0.
    const pl = polilineaQueArrancaEn(geo, [0, 0, 0])!;
    expect(pl.puntos[1]).toEqual([0, 0, 3]);
    expect(pl.mags[1]).toBeGreaterThan(0);
  });

  it("magMin/magMax cubren el rango de magnitudes de todas las estaciones", () => {
    const fem = femBiapoyada();
    const r = resultadosCon(
      "ELU",
      { N1: [0, 0, 0], N2: [0, 0, 0], N3: [0, -0.02, 0], N4: [0, -0.01, 0] },
      {
        M1: [[0, 0], [0, -0.02], [0, 0]], // pilar izq: cabeza |disp|=0.02
        M2: [[0, 0], [0, -0.01], [0, 0]], // pilar der: cabeza |disp|=0.01
      },
    );
    const geo = deformadaGeometria(fem, r, "ELU", 1);
    expect(geo.magMin).toBeCloseTo(0, 12); // hay estaciones sin mover (pies)
    expect(geo.magMax).toBeCloseTo(0.02, 12);
  });
});

describe("deformadaGeometria · polilinea flectada (flecha del vano)", () => {
  it("una barra con deformada_global de n estaciones produce una polilinea de n puntos", () => {
    const fem = femBiapoyada();
    // La viga del fixture une las dos cabezas. La identificamos por su barra; le damos
    // 5 estaciones con flecha. Buscamos cualquier polilinea de 5 puntos.
    const nombreViga = fem.members.find((m) => {
      const ni = fem.nodes.find((n) => n.name === m.i)!;
      const nj = fem.nodes.find((n) => n.name === m.j)!;
      return ni.y === nj.y && ni.y > 0; // horizontal en cabeza (Y constante > 0)
    })!.name;
    const dx = [0, 0, 0, 0, 0];
    const dy = [0, -0.01, -0.015, -0.01, 0]; // flecha central
    const dz = [0, 0, 0, 0, 0];
    const r = resultadosCon("ELU", {}, { [nombreViga]: [dx, dy, dz] });
    const geo = deformadaGeometria(fem, r, "ELU", 1);
    const pl = geo.polilineas.find((p) => p.puntos.length === 5);
    expect(pl).toBeDefined();
    expect(pl!.mags).toHaveLength(5);
  });

  it("el punto MEDIO de la viga flectada queda por DEBAJO de la cuerda i-j (Z menor)", () => {
    const fem = femBiapoyada();
    const nombreViga = fem.members.find((m) => {
      const ni = fem.nodes.find((n) => n.name === m.i)!;
      const nj = fem.nodes.find((n) => n.name === m.j)!;
      return ni.y === nj.y && ni.y > 0;
    })!.name;
    // 3 estaciones: extremos sin mover, centro con DY mas negativo (flecha hacia abajo
    // en FEM -> Z menor en escena). escala alta para que sea claramente medible.
    const dy = [0, -0.02, 0]; // DY central mas negativo que los extremos
    const r = resultadosCon(
      "ELU",
      {},
      { [nombreViga]: [[0, 0, 0], dy, [0, 0, 0]] },
    );
    const geo = deformadaGeometria(fem, r, "ELU", 100);
    const pl = geo.polilineas.find((p) => p.puntos.length === 3)!;
    expect(pl).toBeDefined();
    // En escena Z-up la VERTICAL (altura) es la 3a componente del punto (indice 2):
    // puntoDesplazado mapea FEM Y -> escena[2]. La DY del descenso vive ahi.
    const zIni = pl.puntos[0]![2];
    const zMed = pl.puntos[1]![2];
    const zFin = pl.puntos[2]![2];
    // La cuerda i-j es horizontal (zIni == zFin); el centro cae por debajo (curva).
    expect(zIni).toBeCloseTo(zFin, 9);
    expect(zMed).toBeLessThan(zIni); // flecha: NO es una recta entre los nudos
  });

  it("los extremos de la polilinea coinciden con base_nudo + disp_nudo·escala (continuidad)", () => {
    const fem = femBiapoyada();
    // El pilar M1 (N1->N3): estacion 0 == disp del nudo i, estacion n-1 == disp del
    // nudo j (invariante garantizado por el golden). Lo reproducimos en el fixture.
    const escala = 50;
    const dispJ: [number, number, number] = [0, -0.01, 0];
    const r = resultadosCon(
      "ELU",
      {},
      { M1: [[0, 0, 0], [0, -0.005, -0.01], [0, 0, 0]] },
    );
    // Forzamos extremo j = disp conocido (continuidad con nodos[j].disp del invariante).
    r.barras.M1!.ELU!.deformada_global = [
      [0, 0, dispJ[0]],
      [0, -0.005, dispJ[1]],
      [0, 0, dispJ[2]],
    ];
    const geo = deformadaGeometria(fem, r, "ELU", escala);
    // N1 = (0,0,0) FEM -> escena (0,0,0); estacion 0 sin disp -> queda en base.
    const pl = polilineaQueArrancaEn(geo, [0, 0, 0])!;
    expect(pl).toBeDefined();
    // Estacion final = N3 (FEM 0,3,0 -> escena [0,0,3]) + disp[DX,DZ,DY]·escala.
    // disp j = (0,-0.01,0) -> escena disp = [0, 0, -0.01]·50 = [0,0,-0.5].
    const fin = pl.puntos[pl.puntos.length - 1]!;
    expect(fin[0]).toBeCloseTo(0, 9);
    expect(fin[1]).toBeCloseTo(0, 9);
    expect(fin[2]).toBeCloseTo(3 - 0.5, 9);
  });
});

describe("deformadaGeometria · fallback sin deformada_global", () => {
  it("sin deformada_global cae a polilinea de 2 puntos con disp de los nudos", () => {
    const fem = femBiapoyada();
    // disp por nodo pero SIN deformada_global en barras: ruta de fallback (2 extremos).
    const r = resultadosCon("ELU", {
      N1: [0, 0, 0],
      N2: [0, 0, 0],
      N3: [0, -0.01, 0],
      N4: [0, 0, 0],
    });
    const geo = deformadaGeometria(fem, r, "ELU", 100);
    const pl = polilineaQueArrancaEn(geo, [0, 0, 0]);
    expect(pl).toBeDefined();
    expect(pl!.puntos).toHaveLength(2); // 2 puntos: extremos i,j
    // Extremo j = N3 desplazado: [0, 0, 3 - 1] = [0,0,2].
    expect(pl!.puntos[1]![2]).toBeCloseTo(2, 9);
  });
});

describe("deformadaGeometria · casos de borde (nunca lanza, devuelve vacio)", () => {
  const vacio = { polilineas: [], magMin: 0, magMax: 0 };

  it("resultados null -> geometria vacia", () => {
    const fem = femBiapoyada();
    expect(deformadaGeometria(fem, null, "ELU", 1)).toEqual(vacio);
  });

  it("modeloFEM null -> geometria vacia", () => {
    const r = resultadosCon("ELU", { N1: [0, 0, 0] });
    expect(deformadaGeometria(null, r, "ELU", 1)).toEqual(vacio);
  });

  it("combo null -> geometria vacia", () => {
    const fem = femBiapoyada();
    const r = resultadosCon("ELU", { N1: [0, 0, 0], N2: [0, 0, 0] });
    expect(deformadaGeometria(fem, r, null, 1)).toEqual(vacio);
  });

  it("combo inexistente (no calculado) -> geometria vacia, sin lanzar", () => {
    const fem = femBiapoyada();
    const r = resultadosCon(
      "ELU",
      { N1: [0, 0, 0], N2: [0, 0, 0], N3: [0, -0.01, 0], N4: [0, 0, 0] },
      { M1: [[0, 0], [0, -0.01], [0, 0]] },
    );
    // "ELS" no esta entre los combos con resultados: cada member se omite -> vacio.
    expect(deformadaGeometria(fem, r, "ELS", 1)).toEqual(vacio);
  });

  it("nodo sin resultado en el combo (y sin deformada_global) -> ese member se omite", () => {
    const fem = femBiapoyada();
    // Solo damos disp a los nodos de UN pilar (N1,N3); N2/N4 sin resultado y SIN
    // deformada_global: la viga (N3-N4) y el pilar M2 (N2-N4) se omiten (fallback sin
    // disp), pero M1 (N1-N3) si se dibuja por fallback.
    const r = resultadosCon("ELU", { N1: [0, 0, 0], N3: [0, -0.01, 0] });
    const geo = deformadaGeometria(fem, r, "ELU", 1);
    expect(geo.polilineas).toHaveLength(1); // solo M1
  });
});
