// Unit del deriver PURO modalGeometria (F2b). Vive bajo src/ui/ pero no toca React/R3F:
// corre en el project `jsdom` (include src/ui/**) ejercitando solo logica pura. Verifica
// la transformacion FEM(Y-up) -> escena(Z-up) [FEM.x, FEM.z, FEM.y] con disp [DX,DZ,DY],
// la interpolacion NUDO-A-NUDO (segmento recto), la RENORMALIZACION por el maximo
// desplazamiento del modo (que neutraliza la escala/signo arbitrarios de PyNite) y los
// casos de borde (null / modo inexistente -> vacio, sin lanzar).
//
// CONSTRUIMOS UN ModeloFEM REAL discretizando un fixture de libro: el test queda anclado
// a la salida real del discretizador y caza si la convencion de ejes se separa.
import { describe, it, expect } from "vitest";
import { discretizar } from "../../discretizador";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosModales } from "../../solver";
import { fixtureBiapoyadaUDL } from "../../../tests/golden/_arnes/fixtures";
import { modalGeometria } from "./modalGeometria";

// Discretiza el fixture biapoyado (4 nodos: N1,N2 pies Y=0; N3,N4 cabezas Y=3) en modo
// MODAL y devuelve la Capa 2. Si el fixture quedara invalido, el test debe fallar ruidoso.
function femBiapoyada(): ModeloFEM {
  const res = discretizar(fixtureBiapoyadaUDL({ L: 6, q: 10, cota: 3 }), {
    modal: { numModos: 4 },
  });
  if (!res.ok) throw new Error("fixture invalido en modalGeometria.test");
  return res.modeloFEM;
}

// Forma modal sintetica: 1 modo (numero 1) con forma por nudo dada (6 GDL). Los nudos
// no incluidos quedan sin forma (el deriver los omite). No usa el motor: solo la forma
// del contrato (ResultadosModales).
function modosCon(
  numero: number,
  forma: Record<string, [number, number, number, number, number, number]>,
): ResultadosModales {
  return {
    units: "kN-m",
    analysis: { type: "modal", num_modes: 1 },
    frecuencias: [4.5],
    modos: [{ numero, frecuencia: 4.5, nodos: forma }],
  };
}

// Localiza el segmento cuyo PRIMER punto base (sin desplazar) coincide con `base`.
function segmentoQueArrancaEn(
  geo: ReturnType<typeof modalGeometria>,
  base: [number, number, number],
) {
  return geo.segmentos.find(
    (s) =>
      s.puntos[0][0] === base[0] &&
      s.puntos[0][1] === base[1] &&
      s.puntos[0][2] === base[2],
  );
}

describe("modalGeometria · proyeccion FEM(Y-up) -> escena(Z-up)", () => {
  it("lleva el nudo j a [FEM.x, FEM.z, FEM.y] + dispNorm[DX,DZ,DY]·escala", () => {
    const fem = femBiapoyada();
    // N3 = cabeza izq en FEM (0,3,0). Damos al pilar M1 (N1->N3) una forma modal con N3
    // moviendose en DY (vertical FEM); como es el MAXIMO del modo, su disp normalizado
    // sera 1 en esa direccion. En escena la vertical es Z (3a componente).
    const escala = 1;
    const modos = modosCon(1, {
      N1: [0, 0, 0, 0, 0, 0],
      N3: [0, -2, 0, 0, 0, 0], // DY = -2 (el unico/maximo desplazamiento del modo)
    });
    const geo = modalGeometria(fem, modos, 1, escala);

    // El segmento de M1 arranca en N1 (sin disp) -> base (0,0,0).
    const seg = segmentoQueArrancaEn(geo, [0, 0, 0]);
    expect(seg).toBeDefined();
    // N3 base escena = [FEM.x, FEM.z, FEM.y] = [0,0,3]. dispNorm = (DY/max) = -2/2 = -1.
    // En escena el DY va a la 3a componente: [0, 0, 3 + (-1)·1] = [0,0,2]: BAJA en Z.
    const fin = seg!.puntos[1];
    expect(fin[0]).toBeCloseTo(0, 9);
    expect(fin[1]).toBeCloseTo(0, 9);
    expect(fin[2]).toBeCloseTo(2, 9);
    // Magnitud normalizada del extremo j = 1 (es el maximo del modo).
    expect(seg!.mags[1]).toBeCloseTo(1, 9);
    // Extremo i (N1) sin desplazamiento: magnitud 0.
    expect(seg!.mags[0]).toBeCloseTo(0, 9);
  });

  it("renormaliza por el MAXIMO desplazamiento del modo (escala/signo arbitrarios)", () => {
    const fem = femBiapoyada();
    // Dos formas modales que difieren SOLO por un factor global (k) y signo: tras
    // renormalizar por el maximo, la geometria dibujada debe ser identica.
    const base = {
      N1: [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number],
      N3: [0, -1, 0, 0, 0, 0] as [number, number, number, number, number, number],
    };
    const escalada = {
      N1: [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number],
      N3: [0, 7, 0, 0, 0, 0] as [number, number, number, number, number, number], // ×-7
    };
    const g1 = modalGeometria(fem, modosCon(1, base), 1, 1);
    const g2 = modalGeometria(fem, modosCon(1, escalada), 1, 1);

    const z1 = segmentoQueArrancaEn(g1, [0, 0, 0])!.puntos[1][2];
    const z2 = segmentoQueArrancaEn(g2, [0, 0, 0])!.puntos[1][2];
    // base k=1 normaliza -1/1 = -1 -> z = 3-1 = 2. base k=-7 normaliza 7/7 = +1 -> z =
    // 3+1 = 4. El SIGNO arbitrario sigue importando (no lo cancelamos: no hay criterio
    // de fase canonico), pero la AMPLITUD esta renormalizada: |3-z| = 1 en ambos.
    expect(Math.abs(3 - z1)).toBeCloseTo(1, 9);
    expect(Math.abs(3 - z2)).toBeCloseTo(1, 9);
    // magMax ~ 1 tras renormalizar, independientemente del factor de entrada.
    expect(g1.magMax).toBeCloseTo(1, 9);
    expect(g2.magMax).toBeCloseTo(1, 9);
  });

  it("la escala amplifica linealmente la forma renormalizada (x2 escala = x2 offset)", () => {
    const fem = femBiapoyada();
    const modos = modosCon(1, {
      N1: [0, 0, 0, 0, 0, 0],
      N3: [0, -1, 0, 0, 0, 0],
    });
    const g1 = modalGeometria(fem, modos, 1, 1);
    const g2 = modalGeometria(fem, modos, 1, 2);
    const off1 = 3 - segmentoQueArrancaEn(g1, [0, 0, 0])!.puntos[1][2];
    const off2 = 3 - segmentoQueArrancaEn(g2, [0, 0, 0])!.puntos[1][2];
    expect(off1).toBeCloseTo(1, 9);
    expect(off2).toBeCloseTo(2, 9);
  });

  it("interpola NUDO-A-NUDO: cada barra es un segmento recto de 2 puntos", () => {
    const fem = femBiapoyada();
    const modos = modosCon(1, {
      N1: [0, 0, 0, 0, 0, 0],
      N2: [0, 0, 0, 0, 0, 0],
      N3: [0, -1, 0, 0, 0, 0],
      N4: [0, -0.5, 0, 0, 0, 0],
    });
    const geo = modalGeometria(fem, modos, 1, 1);
    // Todo segmento tiene exactamente 2 puntos (recta entre nudos: nunca curva).
    expect(geo.segmentos.length).toBeGreaterThan(0);
    for (const s of geo.segmentos) {
      expect(s.puntos).toHaveLength(2);
      expect(s.mags).toHaveLength(2);
    }
  });

  it("escala 0 deja la forma sin deformar (puntos = posiciones base)", () => {
    const fem = femBiapoyada();
    const modos = modosCon(1, {
      N1: [0, 0, 0, 0, 0, 0],
      N3: [0.1, -1, 0.2, 0, 0, 0],
    });
    const geo = modalGeometria(fem, modos, 1, 0);
    // N3 base escena = [0,0,3]; con escala 0 no se mueve.
    const seg = segmentoQueArrancaEn(geo, [0, 0, 0])!;
    expect(seg.puntos[1]).toEqual([0, 0, 3]);
  });
});

describe("modalGeometria · casos de borde (nunca lanza, devuelve vacio)", () => {
  const vacio = { segmentos: [], magMin: 0, magMax: 0 };

  it("modos null -> geometria vacia", () => {
    const fem = femBiapoyada();
    expect(modalGeometria(fem, null, 1, 1)).toEqual(vacio);
  });

  it("modeloFEM null -> geometria vacia", () => {
    const modos = modosCon(1, { N1: [0, 0, 0, 0, 0, 0] });
    expect(modalGeometria(null, modos, 1, 1)).toEqual(vacio);
  });

  it("modo inexistente (numero fuera de rango) -> geometria vacia, sin lanzar", () => {
    const fem = femBiapoyada();
    const modos = modosCon(1, { N1: [0, 0, 0, 0, 0, 0], N3: [0, -1, 0, 0, 0, 0] });
    // El modo 5 no existe (solo hay el numero 1): no dibuja nada.
    expect(modalGeometria(fem, modos, 5, 1)).toEqual(vacio);
  });

  it("nudo sin forma modal en el modo -> ese member se omite", () => {
    const fem = femBiapoyada();
    // Solo damos forma a los nudos del pilar M1 (N1,N3); N2/N4 sin forma: la viga y el
    // pilar M2 se omiten, pero M1 se dibuja.
    const modos = modosCon(1, {
      N1: [0, 0, 0, 0, 0, 0],
      N3: [0, -1, 0, 0, 0, 0],
    });
    const geo = modalGeometria(fem, modos, 1, 1);
    expect(geo.segmentos).toHaveLength(1); // solo M1
  });

  it("modo sin traslacion (solo giros) -> norm=1, forma plana, no lanza (sin /0)", () => {
    const fem = femBiapoyada();
    // Forma con solo giros (RX/RY/RZ): traslacion nula en todos los nudos. El deriver no
    // debe dividir por cero; la forma queda en base (mags 0).
    const modos = modosCon(1, {
      N1: [0, 0, 0, 1, 0, 0],
      N3: [0, 0, 0, 0, 1, 0],
    });
    const geo = modalGeometria(fem, modos, 1, 5);
    const seg = segmentoQueArrancaEn(geo, [0, 0, 0])!;
    expect(seg).toBeDefined();
    // Sin traslacion: el nudo j queda en su base [0,0,3] (los giros no se dibujan).
    expect(seg.puntos[1]).toEqual([0, 0, 3]);
    expect(seg.mags[0]).toBe(0);
    expect(seg.mags[1]).toBe(0);
  });
});
