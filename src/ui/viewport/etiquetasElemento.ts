// etiquetasElemento: helper PURO que deriva las etiquetas de texto de los elementos de
// obra (pilares/vigas) para rotularlos en la vista PLANTA (D7a, spec §4.1 capa 5 / §6.2).
// El lienzo no rotulaba nada (4 pilares = 4 cuadraditos anonimos); esto le da nombre.
//
// PURO (sin React/three/stores): recibe la geometria ya derivada + los datos de dominio
// necesarios (nombre, nombre de seccion) y devuelve {id, texto, x, y, z} por elemento.
// El componente EtiquetasElemento lo invoca junto a la geometria (nunca por frame,
// regla #11) y pinta cada entrada con drei <Text>.
//
// UNIDADES: x/y/z en metros de escena (los mismos que la geometria). El texto ya viene
// formateado (nombre + seccion); la conversion de unidades vive en /src/unidades y no
// toca esto (aqui solo se compone la cadena a partir de nombres ya legibles).

// Un pilar con lo justo para rotularlo: id de dominio, nombre de obra ("P1"), nombre de
// seccion ya legible ("HA 30×30" / "IPE 300") y su centro en planta a la cota superior.
export interface PilarEtiquetable {
  id: string;
  nombre: string;
  seccionNombre: string;
  cx: number;
  cy: number;
  cz: number; // cota del centro del tramo (m)
  alto: number; // altura del tramo (m); la etiqueta se posa sobre la cabeza
}

// Una viga con lo justo para rotularla: id, nombre ("V3"), nombre de seccion y sus dos
// extremos en planta a su cota. La etiqueta se coloca en el punto medio.
export interface VigaEtiquetable {
  id: string;
  nombre: string;
  seccionNombre: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  z: number; // cota de la planta (m)
}

// Etiqueta lista para pintar: id de dominio (para key/resaltado), texto y posicion en
// escena (m). `z` deja la etiqueta sobre la cara superior del elemento en vista cenital.
export interface EtiquetaElemento {
  id: string;
  texto: string;
  x: number;
  y: number;
  z: number;
}

// Elevacion de la etiqueta sobre la cota del elemento (m): la deja SOBRE la cara superior
// para que en planta cenital no quede ocluida por la caja del pilar/viga. Pequeña, del
// orden del epsilon del halo de seleccion (HALO_Z_EPS=0.03) para no despegarse.
const ETIQUETA_Z_EPS = 0.04;

// Longitud minima de viga (m) por debajo de la cual NO se anexa el nombre de la seccion:
// en vigas muy cortas "V3 · HA 30×40" se sale del tramo y se solapa con el vecino, asi
// que se rotula solo "V3". Umbral generoso (1.2 m) porque la etiqueta ocupa varios
// caracteres a ~0.24 m/car; por debajo el nombre solo ya llena el tramo. Decision D7a.
const LARGO_MIN_SECCION_VIGA = 1.2;

// Compone el texto del pilar: "P1 · HA 30×30". Si la seccion no tiene nombre util
// (cadena vacia), se rotula solo el nombre del pilar (sin el separador colgando).
function textoPilar(nombre: string, seccionNombre: string): string {
  const sec = seccionNombre.trim();
  return sec === "" ? nombre : `${nombre} · ${sec}`;
}

// Compone el texto de la viga. Anexa la seccion SOLO si el tramo es lo bastante largo
// (LARGO_MIN_SECCION_VIGA) para que "V3 · HA 30×40" quepa razonablemente; si es corto o
// la seccion no tiene nombre, rotula solo "V3". (Spec §4.1: "con la sección si cabe
// razonablemente".)
function textoViga(nombre: string, seccionNombre: string, largo: number): string {
  const sec = seccionNombre.trim();
  if (sec === "" || largo < LARGO_MIN_SECCION_VIGA) return nombre;
  return `${nombre} · ${sec}`;
}

// Deriva las etiquetas de todos los pilares visibles. La etiqueta se posa sobre la cabeza
// del pilar (cz + alto/2 + eps): en vista cenital cae justo sobre el cuadradito.
export function etiquetasPilares(pilares: readonly PilarEtiquetable[]): EtiquetaElemento[] {
  return pilares.map((p) => ({
    id: p.id,
    texto: textoPilar(p.nombre, p.seccionNombre),
    x: p.cx,
    y: p.cy,
    z: p.cz + p.alto / 2 + ETIQUETA_Z_EPS,
  }));
}

// Deriva las etiquetas de todas las vigas visibles, en el punto medio del tramo.
export function etiquetasVigas(vigas: readonly VigaEtiquetable[]): EtiquetaElemento[] {
  return vigas.map((v) => {
    const dx = v.bx - v.ax;
    const dy = v.by - v.ay;
    const largo = Math.hypot(dx, dy);
    return {
      id: v.id,
      texto: textoViga(v.nombre, v.seccionNombre, largo),
      x: (v.ax + v.bx) / 2,
      y: (v.ay + v.by) / 2,
      z: v.z + ETIQUETA_Z_EPS,
    };
  });
}
