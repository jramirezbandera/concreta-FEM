// diagramaAnotaciones: helpers PUROS de DiagramaBarra para las anotaciones de maximo y
// minimo (UX-H5) y la unidad del hover. Extraidos del componente para poder testearlos sin
// cargar Plotly (~1 MB, no disponible en jsdom): NO importan plotly.js. El componente
// mapea el resultado a `Partial<Annotations>[]` (el unico tipado Plotly vive alli).

// Un extremo del diagrama: valor y posicion (m) donde se alcanza.
export interface Extremo {
  valor: number;
  posicion: number;
}

export interface ExtremosDiagrama {
  max: Extremo;
  min: Extremo;
}

// Forma neutra de una anotacion (sin acoplar a los tipos de Plotly): el componente la
// traduce a Partial<Annotations>. `y` ancla verticalmente el texto sobre/bajo el punto.
export interface AnotacionExtremo {
  x: number;
  y: number;
  texto: string;
  // "top" para el maximo (texto encima), "bottom" para el minimo (texto debajo): evita que
  // las etiquetas tapen la traza.
  anclaje: "top" | "bottom";
}

// Extrae la unidad del texto entre parentesis de la etiqueta del eje ("Momento (kN·m)" ->
// "kN·m"). Sin parentesis, cadena vacia (el hover no añade unidad). Toma el ULTIMO grupo
// entre parentesis por si el nombre llevara otros.
export function extraerUnidad(etiquetaY: string): string {
  const m = /\(([^)]*)\)\s*$/.exec(etiquetaY);
  return m ? m[1]!.trim() : "";
}

// Calcula el maximo y el minimo de la serie con su posicion. null si no hay serie o las
// longitudes no casan (defensivo: nunca deberia, pero no queremos anotar basura).
export function calcularExtremos(
  posiciones: readonly number[],
  valores: readonly number[],
): ExtremosDiagrama | null {
  if (valores.length === 0 || posiciones.length !== valores.length) return null;
  let max: Extremo = { valor: valores[0]!, posicion: posiciones[0]! };
  let min: Extremo = { valor: valores[0]!, posicion: posiciones[0]! };
  for (let i = 1; i < valores.length; i++) {
    const v = valores[i]!;
    if (v > max.valor) max = { valor: v, posicion: posiciones[i]! };
    if (v < min.valor) min = { valor: v, posicion: posiciones[i]! };
  }
  return { max, min };
}

// Formatea un valor con la unidad para la anotacion/hover, en 3 cifras significativas
// (coherente con el hovertemplate %{y:.3g}). Ej: "45.0 kN·m". Sin unidad, solo el numero.
export function fmtValor(v: number, unidad: string): string {
  // toPrecision(3) da notacion cientifica para |v| grande; para los rangos tipicos de
  // esfuerzos (decenas/centenas) da "45.0". Se recorta el "+0"/ceros de mas si aparece.
  const num = Number.parseFloat(v.toPrecision(3)).toString();
  return unidad ? `${num} ${unidad}` : num;
}

// Construye las anotaciones (max y min) en forma neutra. Devuelve [] si no hay extremos.
// Si max y min coinciden (diagrama plano), una sola marca (evita dos etiquetas encima).
export function anotacionesExtremos(
  extremos: ExtremosDiagrama | null,
  unidad: string,
): AnotacionExtremo[] {
  if (!extremos) return [];
  const { max, min } = extremos;
  const anot: AnotacionExtremo[] = [
    { x: max.posicion, y: max.valor, texto: fmtValor(max.valor, unidad), anclaje: "top" },
  ];
  // Solo añade el minimo si difiere del maximo (por valor Y posicion): en un diagrama plano
  // o de un solo punto, max===min y basta una marca.
  if (min.valor !== max.valor || min.posicion !== max.posicion) {
    anot.push({
      x: min.posicion,
      y: min.valor,
      texto: fmtValor(min.valor, unidad),
      anclaje: "bottom",
    });
  }
  return anot;
}
