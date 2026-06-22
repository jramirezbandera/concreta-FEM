// Pila de undo/redo del patron Command. Solo el modeloStore (Capa 1) la usa
// (CLAUDE.md §10: unico origen en la pila de undo). Mantiene dos pilas de
// comandos y delega la mutacion real del modelo en el `aplicador` que le pasa el
// store al ejecutar/deshacer/rehacer (asi la pila no conoce el store).
import type { Comando, AplicadorParches } from "./comando";

export class PilaUndo {
  private deshacerStack: Comando[] = [];
  private rehacerStack: Comando[] = [];

  // maxDepth acota la pila de deshacer: en sesiones largas de modelado la memoria
  // de undo no debe crecer sin limite. Solo se descartan los pasos mas antiguos.
  constructor(private maxDepth = 200) {}

  // Ejecuta un comando: lo aplica y lo apila para poder deshacerlo. Cualquier
  // accion nueva invalida la rama de rehacer (rama de historial abandonada).
  ejecutar(comando: Comando, aplicador: AplicadorParches): void {
    comando.aplicar(aplicador);
    this.rehacerStack = [];

    // Coalescing: si el comando entrante comparte coalesceKey con el tope de la
    // pila, fusionamos en vez de apilar. Una rafaga (p.ej. arrastrar un nudo) se
    // convierte en UN solo paso de undo: conservamos el `revertir` del primero
    // (estado inicial de la rafaga) y adoptamos el `aplicar` del nuevo (estado
    // final). Asi un undo salta de golpe al estado previo a toda la rafaga.
    const tope = this.deshacerStack[this.deshacerStack.length - 1];
    if (
      tope &&
      comando.coalesceKey !== undefined &&
      tope.coalesceKey === comando.coalesceKey
    ) {
      this.deshacerStack[this.deshacerStack.length - 1] = {
        etiqueta: comando.etiqueta,
        coalesceKey: comando.coalesceKey,
        aplicar: comando.aplicar,
        revertir: tope.revertir,
      };
      return;
    }

    this.deshacerStack.push(comando);
    // Cap de profundidad: solo crece esta rama (coalescing reemplaza el tope, no
    // apila). Si superamos el limite, descartamos el paso mas antiguo.
    if (this.deshacerStack.length > this.maxDepth) {
      this.deshacerStack.shift();
    }
  }

  deshacer(aplicador: AplicadorParches): void {
    const comando = this.deshacerStack.pop();
    if (!comando) return;
    comando.revertir(aplicador);
    this.rehacerStack.push(comando);
  }

  rehacer(aplicador: AplicadorParches): void {
    const comando = this.rehacerStack.pop();
    if (!comando) return;
    comando.aplicar(aplicador);
    this.deshacerStack.push(comando);
  }

  puedeDeshacer(): boolean {
    return this.deshacerStack.length > 0;
  }

  puedeRehacer(): boolean {
    return this.rehacerStack.length > 0;
  }

  // Limpia ambas pilas: lo usa el store al cargar un modelo nuevo (historial sin
  // sentido sobre otra obra).
  limpiar(): void {
    this.deshacerStack = [];
    this.rehacerStack = [];
  }
}
