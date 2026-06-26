// Tipos de runtime de la costura E2E (feature-16, T0.1). Viven SOLO en /e2e (NO en
// src/**): describen los globals que la app inyecta bajo VITE_E2E y que T0.2/T0.4
// implementan (src/test-harness/e2eBridge.ts, src/test-harness/mockSolver.ts).
//
// Este fichero es el contrato que congela T0.1 para T0.2/T0.4. Si cambia la firma
// de `window.__concreta`, cambia aqui y en el bridge a la vez.

// Control del mock del solver (D5/D7): el spec resuelve/falla el calculo a voluntad
// y comprueba cuantas veces se invoco al motor (p. ej. "motor NO llamado" en
// validacion fallida, #16). `fallar` recibe el error de motor que la UI mostrara.
export interface ControlMockSolver {
  resolver(): void;
  fallar(e: unknown): void;
  contadorLlamadas(): number;
}

// Resumen del Modelo (Capa 1) para asertar sin tocar el store ni el DOM del arbol.
export interface ResumenModelo {
  pilares: number;
  vigas: number;
  cargas: number;
}

// Lectura del estado de obra para resolver referencias en los specs (T0.2). Los specs
// crean grupos/plantas por el DIALOGO REAL (UI) y luego necesitan los ids de planta
// para crearPilar/crearViga; este accesor los expone sin hurgar en el store interno.
// Solo id/nombre (y grupoId en plantas): lo justo para localizar por nombre y resolver.
export interface EstadoObra {
  grupos: { id: string; nombre: string }[];
  plantas: { id: string; nombre: string; grupoId: string }[];
}

// Puente de test: despacha COMANDOS de dominio ya existentes (no reimplementa nada).
// Devuelto por `bridge(page)` para usar dentro de `page.evaluate`.
export interface ConcretaE2E {
  crearPilar(p: {
    x: number;
    y: number;
    plantaInicial: string;
    plantaFinal: string;
    seccionId?: string;
    materialId?: string;
  }): string;
  crearViga(p: {
    plantaId: string;
    xi: number;
    yi: number;
    xj: number;
    yj: number;
    seccionId?: string;
    materialId?: string;
  }): string;
  anadirCargaLineal(p: { elementoId: string; valor: number; hipotesisId: string }): string;
  // Abre el inspector seleccionando por id, sin picking en el canvas.
  seleccionar(ids: string[]): void;
  deshacer(): void;
  rehacer(): void;
  resumenModelo(): ResumenModelo;
  // Lectura de grupos/plantas creados por el dialogo real (resuelve ids de planta para
  // crearPilar/crearViga). Ampliacion aditiva del contrato (T0.2).
  estadoObra(): EstadoObra;
  // Motor (control del mock, D5/D7): instala el ParWorker falso y devuelve su control.
  usarMockSolver(): ControlMockSolver;
}

declare global {
  interface Window {
    // Flag leido por la app en el arranque (lo fija addInitScript ANTES del bundle):
    // si es true, la app instala el mock del solver antes de `usePrecargaMotor` (D2).
    __E2E_MOCK?: boolean;
    // Costura de dominio (solo bajo VITE_E2E, import dinamico): la monta T0.2.
    __concreta?: ConcretaE2E;
  }
}

// `export {}` no: este fichero declara un modulo (tiene `export interface`), asi que
// el `declare global` ya aumenta el global sin necesidad de `export {}` extra.
