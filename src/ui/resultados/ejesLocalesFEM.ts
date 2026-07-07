// ejesLocalesFEM: calculo PURO del eje local `y` de una barra en coordenadas FEM
// (Y-up). SIN React/R3F/three: testeable en Node. Lo consume el overlay de esfuerzos
// (los diagramas N/V/M se levantan en la direccion del eje local y, donde actuan
// Vy="Fy" y Mz="Mz" del contrato del solver).
//
// REPLICA DOCUMENTADA de `Pynite/Member3D.py :: T()` (wheel vendorizado
// public/pyodide/pynitefea-2.0.2-py3-none-any.whl): NO se inventa un convenio, se
// reproduce EXACTAMENTE el de PyNite para que el diagrama dibujado caiga en el mismo
// plano en el que el motor midio el esfuerzo. Tres casos:
//  - VERTICAL (Xi≈Xj y Zi≈Zj): ascendente -> y=[-1,0,0]; descendente -> y=[1,0,0].
//    (PyNite mantiene el y local en el plano XY para facilitar los porticos 2D.)
//  - HORIZONTAL (Yi≈Yj): y=[0,1,0] (la vertical global: el diagrama de una viga se
//    levanta en vertical, como se espera).
//  - INCLINADO: proj=[ΔX,0,ΔZ]; z=normalizar(Yj>Yi ? proj×x : x×proj); y=z×x.
// Y despues, si rotation≠0 (solo pilares: discretizar emite `rotation: p.angulo`),
// PyNite rota y/z alrededor de x con Rodrigues. `rotation` viaja en GRADOS (el propio
// T() hace radians(self.rotation)): la conversion a radianes ocurre AQUI, en el borde
// del modulo, y en ningun otro sitio.
//
// NO reimplementa FEM (regla de oro #1): esto es geometria de DIBUJO (donde levantar
// la ordenada), no calculo de esfuerzos.

// Un vector en coordenadas FEM (Y-up). Mismo sistema que ModeloFEM.nodes.
export type Vec3FEM = [number, number, number];

// Posicion minima de un nudo FEM (subconjunto de NodoFEM; evita acoplar el modulo
// al schema completo).
export interface PuntoFEM {
  x: number;
  y: number;
  z: number;
}

// Tolerancia para "misma coordenada" al clasificar vertical/horizontal. PyNite usa
// math.isclose (relativa); el discretizador emite coordenadas exactas (los nudos
// comparten valor, no aproximan), asi que una absoluta pequena a escala de edificio
// (nm) clasifica identico sin el caso patologico de isclose relativo cerca de 0.
const TOL = 1e-9;

function cross(a: Vec3FEM, b: Vec3FEM): Vec3FEM {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalizar(v: Vec3FEM): Vec3FEM | null {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n <= TOL) return null;
  return [v[0] / n, v[1] / n, v[2] / n];
}

// Eje local `y` (unitario, coordenadas FEM) de la barra i->j con giro `rotation`
// (GRADOS, convenio PyNite). Devuelve null si la barra es degenerada (L≈0).
// Nunca lanza.
export function ejeLocalY(
  ni: PuntoFEM,
  nj: PuntoFEM,
  rotation: number,
): Vec3FEM | null {
  const dx = nj.x - ni.x;
  const dy = nj.y - ni.y;
  const dz = nj.z - ni.z;
  const L = Math.hypot(dx, dy, dz);
  if (L <= TOL) return null;
  const x: Vec3FEM = [dx / L, dy / L, dz / L];

  let y: Vec3FEM;
  if (Math.abs(dx) <= TOL && Math.abs(dz) <= TOL) {
    // VERTICAL (caso especial explicito de PyNite). El discretizador siempre emite
    // pilares pie->cabeza (ascendente), pero se cubre el descendente por fidelidad.
    y = nj.y > ni.y ? [-1, 0, 0] : [1, 0, 0];
  } else if (Math.abs(dy) <= TOL) {
    // HORIZONTAL: y local = vertical global (el diagrama de una viga se levanta en
    // vertical). z = x×y queda en el plano XZ; no hace falta materializarlo aqui.
    y = [0, 1, 0];
  } else {
    // INCLINADO: z horizontal (paralelo al plano XZ), con el orden del producto
    // elegido por PyNite para que y tenga SIEMPRE componente ascendente.
    const proj: Vec3FEM = [dx, 0, dz];
    const zCrudo = nj.y > ni.y ? cross(proj, x) : cross(x, proj);
    const z = normalizar(zCrudo);
    if (!z) return null; // no alcanzable con L>0 y dy≠0; guard defensivo
    const yCrudo = normalizar(cross(z, x));
    if (!yCrudo) return null;
    y = yCrudo;
  }

  // Giro de la seccion alrededor del eje local x (Rodrigues). Como y ⊥ x, el termino
  // u·(u·v)(1-cos) de la formula completa es 0 y queda y' = y·cosθ + (x×y)·sinθ.
  if (rotation !== 0) {
    const theta = (rotation * Math.PI) / 180; // GRADOS -> rad (borde del modulo)
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const xy = cross(x, y);
    const girado = normalizar([
      y[0] * c + xy[0] * s,
      y[1] * c + xy[1] * s,
      y[2] * c + xy[2] * s,
    ]);
    if (!girado) return null;
    y = girado;
  }

  return y;
}
