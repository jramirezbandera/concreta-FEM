// capturarPng: API publica de la captura del viewport (F3) + helper de descarga.
// `capturarViewport()` es lo unico que necesita el resto de la app (lo llamara el
// boton F3 de la barra de herramientas en T4.1): solo emite por el bus, sin tocar
// three.js. La fontaneria que lee el framebuffer vive en ControlCaptura (Escena).
import { emitirCaptura } from "./hooks/capturaBus";

// API publica: dispara la captura de la vista actual. La escena la ejecuta.
export function capturarViewport(nombre?: string): void {
  emitirCaptura(nombre);
}

// Marca de tiempo legible para el nombre del fichero: 2026-06-24_18-05-32.
// Efecto de UI (no es modulo puro), por lo que `new Date()` es aceptable aqui.
function marcaDeTiempo(fecha: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const f = `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
  const h = `${p(fecha.getHours())}-${p(fecha.getMinutes())}-${p(fecha.getSeconds())}`;
  return `${f}_${h}`;
}

// Descarga un dataURL PNG como fichero: crea un <a download>, lo clica y lo
// descarta. DOM puro (sin three.js). `fecha` inyectable para tests.
export function descargarPng(dataUrl: string, nombre = "captura", fecha: Date = new Date()): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${nombre}-${marcaDeTiempo(fecha)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
