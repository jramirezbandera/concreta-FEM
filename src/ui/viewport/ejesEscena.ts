// ejesEscena: transformacion PURA de ejes FEM (Y-up) -> escena del viewport (Z-up).
// SIN React/R3F/three: testeable en Node. Helper compartido (DRY) por todo overlay
// que dibuje datos de la Capa 2 / resultados sobre la obra (deformada, forma modal,
// "Ver modelo de calculo").
//
// CONVENCION DE EJES (critica para que lo dibujado se superponga a la obra):
//  - El discretizador escribe los nodos FEM con mapearEjes(xPlanta,yPlanta,cota) =
//    [X, Y, Z] = [xPlanta, cota, yPlanta]  (FEM es Y-up: la vertical es Y).
//  - PERO el viewport dibuja Z-up: la planta (x,y) va a la escena (x,y) y la cota va a
//    la escena z (los pilares se colocan en pos.set(cx, cy, cz) con cz = cota).
//  - Por tanto, para llevar un nodo FEM a la escena hay que DESHACER mapearEjes:
//        escena = [FEM.x, FEM.z, FEM.y]   (intercambia Y<->Z)
//    y un desplazamiento [DX,DY,DZ] (mismo sistema FEM) sigue el mismo intercambio:
//        dispEscena = [DX, DZ, DY]
//  NO se usa mapearEjes a ciegas (ese helper va de planta->FEM, no de FEM->escena).
//  Centralizado aqui por ser el error tipico (forma girada 90 grados / "tumbada").

// Un punto/vector en coordenadas de ESCENA (Z-up), listo para three.js.
export type Vec3Escena = [number, number, number];

// Un punto FEM (Y-up) -> escena (Z-up): intercambia Y<->Z.
export function femAEscena(x: number, y: number, z: number): Vec3Escena {
  return [x, z, y];
}

// Un vector de desplazamiento FEM -> escena: mismo intercambio Y<->Z (sin cota base).
export function dispFemAEscena(dx: number, dy: number, dz: number): Vec3Escena {
  return [dx, dz, dy];
}

// Punto base FEM desplazado por (dx,dy,dz)*escala, ya en escena. Combina femAEscena +
// dispFemAEscena en un paso: es lo que hacen deformada y forma modal por estacion/nudo.
export function puntoFemDesplazadoAEscena(
  bx: number,
  by: number,
  bz: number,
  dx: number,
  dy: number,
  dz: number,
  escala: number,
): Vec3Escena {
  return [bx + dx * escala, bz + dz * escala, by + dy * escala];
}
