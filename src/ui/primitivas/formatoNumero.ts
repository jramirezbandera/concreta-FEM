// Formateo de numeros para PRESENTACION en la UI (es-ES, coma decimal). NO es
// conversion de unidades (esa vive en /src/unidades, en los bordes): aqui el numero
// ya esta en su unidad de presentacion y solo se le da forma legible. Modulo aparte
// del componente para no romper react-refresh (only-export-components).

// qk (sobrecarga de uso) con coma decimal y un decimal fijo: "2,0", "5,0". Se usa en
// las opciones del SelectUso y en la nota contextual del dialogo de grupos (UX-D2).
export function formatearQk(qk: number): string {
  return qk.toLocaleString("es-ES", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
