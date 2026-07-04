// Geometria de snapping del discretizador (Capa 1 -> Capa 2): tolerancia +
// helpers PUROS de mapeo de ejes y clave de posicion.
//
// Modulo HOJA (sin imports de proyecto) para ser FUENTE UNICA del criterio de
// "mismo nodo" sin crear ciclos. Lo consumen:
//  - discretizar.ts (snapping de nodos al numerar la Capa 2),
//  - validaciones.ts (rechazo de viga degenerada: dos extremos que colapsarian
//    en el MISMO nodo FEM -> barra de longitud cero),
//  - la UI de introduccion grafica (comandosModelo/imanViga/colocacionVigaLogica)
//    para resolver/coincidir nudos.
// El criterio de igualdad de nodos es la CLAVE de rejilla (clavePosicion), no la
// distancia euclidea: dos puntos distintos en euclideo pueden caer en la misma
// celda (p. ej. en diagonal). Comparar siempre por clave para no divergir del
// snapping real del solver. No duplicar este criterio en ningun otro sitio.

// Tolerancia de snapping geometrico de nodos (m). Dos puntos cuya clave de rejilla
// coincide se consideran el mismo nudo (comparten geometria). Explicita y nombrada
// para que el determinismo de la numeracion sea auditable.
export const TOL_NODO = 1e-3; // m

// Coordenada FEM global de un punto. #18 (Y vertical): la planta (x,y) que el
// arquitecto dibuja va al plano horizontal global (X,Z); la cota/altura es la
// vertical global Y. Convencion de uso fijada aqui y blindada con test.
export function mapearEjes(
  xPlanta: number,
  yPlanta: number,
  cota: number,
): [number, number, number] {
  return [xPlanta, cota, yPlanta]; // [X, Y, Z]
}

// Vector de reaccion (o de cualquier magnitud de 6 GDL) en EJES DE OBRA. Espejo EXACTO
// de `mapearEjes` para las componentes de fuerza/momento: es su INVERSO sobre los 3 ejes.
// El solver entrega la reaccion en ejes FEM (Y-up) como
//   rxnFem = [FX, FY, FZ, MX, MY, MZ]
// y mapearEjes fija FEM (X,Y,Z) = (x_obra, cota_vertical, y_obra). Por tanto, en ejes de
// obra (mismo intercambio que mapearEjes, aplicado por separado a fuerzas y momentos):
//   FUERZAS:  V  (vertical)   = FY   ·  Hx (obra x) = FX   ·  Hy (obra y) = FZ
//   MOMENTOS: Mx (vuelco s/obra-x) = MX  ·  My (vuelco s/obra-y) = MZ  ·  Mv (torsor
//             vertical) = MY
// Es SOLO permutacion (sin conversion de unidades): la fuente UNICA del mapeo FEM->obra de
// reacciones. La UI (TablaReacciones) lo consume y solo etiqueta; asi no diverge del mapeo
// de posiciones. `mapearReaccionAObra` compuesto con la construccion de ejes de mapearEjes
// es la identidad (test de identidad-inversa en geometria.test.ts).
export interface ReaccionObra {
  V: number; // vertical (= FY fem)
  Hx: number; // horizontal obra-X (= FX fem)
  Hy: number; // horizontal obra-Y (= FZ fem)
  Mx: number; // vuelco sobre obra-x (= MX fem)
  My: number; // vuelco sobre obra-y (= MZ fem)
  Mv: number; // torsor sobre el eje vertical (= MY fem)
}

export function mapearReaccionAObra(
  rxnFem: readonly number[],
): ReaccionObra {
  const [FX = 0, FY = 0, FZ = 0, MX = 0, MY = 0, MZ = 0] = rxnFem;
  return { V: FY, Hx: FX, Hy: FZ, Mx: MX, My: MZ, Mv: MY };
}

// Cuantizacion de UNA coordenada a la celda de la rejilla de snapping: el atomo
// del criterio de igualdad geometrica (clavePosicion lo compone por eje). Publica
// para que el acople paño<->portico (F3.2, acople.ts) compare cotas y coordenadas
// de arista con EXACTAMENTE el mismo criterio de celda que el snapping de nodos
// (nunca |Δ|<TOL, que diverge en la frontera de celda, [AUDITORIA M-4]).
export function cuantizar(c: number, tol: number = TOL_NODO): number {
  const r = Math.round(c / tol);
  return r === 0 ? 0 : r; // evita el -0 para coordenadas negativas pequeñas
}

// Igualdad de UNA coordenada (cota, x o y de obra) por celda de rejilla. Espejo
// escalar de `mismaPosicionEnPlanta`: el UNICO predicado valido de "misma
// coordenada" fuera del discretizador (no duplicar con |a-b|<TOL).
export function mismaCoordenada(a: number, b: number): boolean {
  return cuantizar(a) === cuantizar(b);
}

// Clave determinista de un punto para snapping. Cuantiza cada coordenada a la
// rejilla de TOL_NODO (round(c/tol)) y la usa como clave de igualdad. Dos puntos
// dentro de una celda comparten clave => mismo nudo. La clave es estable e
// independiente del orden de insercion (clave por geometria, no por id de dominio).
export function clavePosicion(
  [x, y, z]: [number, number, number],
  tol: number,
): string {
  return `${cuantizar(x, tol)}|${cuantizar(y, tol)}|${cuantizar(z, tol)}`;
}

// [AUDITORIA M-4] Igualdad de nudo EN PLANTA con el criterio REAL del snapping
// (clave de rejilla), para UI/comandos. Antes comandosModelo/imanViga/
// colocacionVigaLogica replicaban el predicado con DISTANCIA EUCLIDEA < TOL_NODO,
// que diverge de la clave en la frontera de celda (dos puntos a <TOL en celdas
// distintas NO colapsan en el FEM; a >TOL en la misma celda SI): la UI podia
// creer "unido" lo que el solver separa (mecanismo silencioso) o viceversa. Este
// helper es el UNICO predicado valido de "mismo nudo" fuera del discretizador.
// La cota es irrelevante para la igualdad en planta (se compara a cota 0).
export function mismaPosicionEnPlanta(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return (
    clavePosicion(mapearEjes(a.x, a.y, 0), TOL_NODO) ===
    clavePosicion(mapearEjes(b.x, b.y, 0), TOL_NODO)
  );
}

// [F2.3/T-f3-losa-plana] ¿Hay al menos TRES puntos NO colineales entre los dados?
// Una placa de bordes libres apoyada SOLO en puntos (cabezas de pilar) necesita >=3
// apoyos no alineados para no bascular: dos apoyos definen un eje de giro libre
// (mecanismo), y >=3 colineales comparten esa misma recta. El motor NO caza este
// mecanismo bajo el solver disperso (devuelve basura silenciosa: flecha absurda sin
// lanzar), asi que validaciones DEBE guardarlo ANTES (validaciones.ts, PANO_SIN_APOYO).
//
// CRITERIO (robusto a la longitud del segmento base, NUNCA |Δ|<TOL suelto): existe un
// punto cuya DISTANCIA PERPENDICULAR a la recta de otros dos supera TOL_NODO. Se usa el
// area del triangulo (doble = |producto vectorial|) dividida por la base: distancia =
// 2·area / |base|. Comparar el area cruda con un umbral fijo NO seria coherente (el area
// escala con la longitud del segmento); la distancia perpendicular si es una tolerancia
// geometrica homogenea, la misma escala que TOL_NODO (1 mm). Puntos duplicados (misma
// posicion) tienen base ~0 y nunca definen recta: se saltan (no aportan no-colinealidad).
//
// PURO y determinista: O(n^3) sobre el nº de puntos (siempre pequeño: pilares interiores
// de un paño). Con <3 puntos devuelve false por definicion (no puede haber 3 no colineales).
export function hayTresNoColineales(
  puntos: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  if (puntos.length < 3) return false;
  for (let i = 0; i < puntos.length; i++) {
    for (let j = i + 1; j < puntos.length; j++) {
      const a = puntos[i];
      const b = puntos[j];
      const baseX = b.x - a.x;
      const baseY = b.y - a.y;
      const base = Math.hypot(baseX, baseY);
      if (base <= TOL_NODO) continue; // a y b coinciden: no definen recta
      for (let k = j + 1; k < puntos.length; k++) {
        const c = puntos[k];
        // Doble del area del triangulo abc = |(b-a) x (c-a)|; distancia perp = 2A/base.
        const areaDoble = Math.abs(baseX * (c.y - a.y) - baseY * (c.x - a.x));
        if (areaDoble / base > TOL_NODO) return true; // c fuera de la recta ab
      }
    }
  }
  return false;
}
