// =============================================================================
// e2eBridge.ts - costura de test `window.__concreta` (feature-16, T0.2, decisiones
// D2/D6/D8).
//
// PARA QUE: el viewport es un canvas R3F (WebGL); el picking/colocacion ocurren
// DENTRO de Three.js, no en el DOM, y Playwright no puede dispararlos. Esta costura
// despacha COMANDOS DE DOMINIO YA EXISTENTES (modeloStore.ejecutar) para que los
// specs construyan la obra sin tocar el canvas. NO reimplementa nada de dominio
// (CLAUDE.md regla de oro #1): solo adapta comandos -> contrato de test.
//
// SOLO BAJO VITE_E2E (D8): main.tsx hace un import DINAMICO de este modulo gateado en
// import.meta.env.VITE_E2E. En produccion esa rama es constante-falsa, asi que Vite
// hace tree-shake del import y el harness (y el mockSolver que arrastra) DESAPARECEN
// del bundle. Por eso este modulo no debe ser importado estaticamente desde src/**.
//
// AISLAMIENTO DEL SOLVER (D2): si window.__E2E_MOCK es true (lo fija addInitScript de
// Playwright ANTES de que arranque el bundle), montar() instala el mock del solver
// AQUI, en el arranque, ANTES de que App monte y dispare usePrecargaMotor. Asi el
// worker real (Pyodide) nunca arranca. instalarMockSolver() ya hace __resetWorker(),
// de modo que la proxima obtenerProxy() de la app usa la fabrica mock.
// =============================================================================

import { modeloStore, seleccionStore } from "../estado";
import {
  crearPilar,
  crearViga,
  crearCarga,
  type DatosPilar,
  type DatosViga,
} from "../estado";
import { listarSecciones, listarMateriales } from "../biblioteca";
import { instalarMockSolver, type ControlMockSolver } from "./mockSolver";

// Material por defecto: el primero del catalogo (los materiales NO se persisten en el
// Modelo; el discretizador los resuelve contra la biblioteca por id, asi que basta el
// id de catalogo). Mismo que preselecciona PanelHerramientaPilar/Viga.
const MATERIAL_POR_DEFECTO = listarMateriales()[0]?.id ?? "";

// Seccion por defecto: id de una seccion de OBRA que el bridge REGISTRA en
// modelo.secciones al montar (ver asegurarSeccionPorDefecto). OJO: a diferencia de
// los materiales, el discretizador resuelve las secciones contra modelo.secciones
// (NO contra el catalogo): un seccionId de catalogo "suelto" produciria REF_SECCION y
// la obra no se podria calcular. Por eso el bridge siembra una seccion de obra
// `perfilMetalico` que referencia el primer perfil del catalogo y reparte SU id.
const SECCION_POR_DEFECTO = "sec-e2e-defecto";

// Siembra (una vez) la seccion de obra por defecto en modelo.secciones, si no existe
// ya. Se hace por cargarModelo (no por comando: es estado de andamiaje, no una accion
// de obra deshacible). Idempotente: un segundo crearPilar/crearViga no la duplica.
// El perfil referenciado es el primero del catalogo (perfilMetalico -> getSeccion ok).
function asegurarSeccionPorDefecto(): void {
  const st = modeloStore.getState();
  const actual = st.getModelo();
  if (actual.secciones.some((s) => s.id === SECCION_POR_DEFECTO)) return;
  const perfilId = listarSecciones()[0]?.id ?? "";
  st.cargarModelo({
    ...actual,
    secciones: [
      ...actual.secciones,
      { id: SECCION_POR_DEFECTO, nombre: "Sección E2E", tipo: "perfilMetalico", perfilId },
    ],
  });
}

// Singleton del control del mock (D2/D5): se crea UNA vez (en montar() si __E2E_MOCK,
// o perezosamente en usarMockSolver() si el spec no instalo por flag). Reinstalar
// arrancaria un par-worker nuevo y perderia el contador/llamadas en vuelo, asi que
// se guarda y se reutiliza.
let controlMock: ControlMockSolver | null = null;

// Guarda de idempotencia: montar() puede llamarse mas de una vez (StrictMode doble
// efecto, recarga del modulo en dev). Solo el primer montaje hace trabajo.
let montado = false;

// Resuelve seccion/material del pilar: usa el id del spec si viene; si no, el primero
// del catalogo. El resto de campos toma valores sensatos de obra (arranque empotrado,
// con vinculacion exterior) como hace el PanelHerramientaPilar.
function datosPilar(p: {
  x: number;
  y: number;
  plantaInicial: string;
  plantaFinal: string;
  seccionId?: string;
  materialId?: string;
}): DatosPilar {
  return {
    x: p.x,
    y: p.y,
    plantaInicial: p.plantaInicial,
    plantaFinal: p.plantaFinal,
    seccionId: p.seccionId ?? SECCION_POR_DEFECTO,
    materialId: p.materialId ?? MATERIAL_POR_DEFECTO,
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado",
  };
}

// Resuelve los datos de viga: los extremos van como coordenadas {x,y}; crearViga
// reusa o crea los nudos en la MISMA receta (un solo paso de undo), igual que la
// introduccion grafica de F12. Extremos empotrados por defecto.
function datosViga(p: {
  plantaId: string;
  xi: number;
  yi: number;
  xj: number;
  yj: number;
  seccionId?: string;
  materialId?: string;
}): DatosViga {
  return {
    plantaId: p.plantaId,
    i: { x: p.xi, y: p.yi },
    j: { x: p.xj, y: p.yj },
    seccionId: p.seccionId ?? SECCION_POR_DEFECTO,
    materialId: p.materialId ?? MATERIAL_POR_DEFECTO,
    extremoI: "empotrado",
    extremoJ: "empotrado",
    tirante: false,
  };
}

// Asegura el control del mock instalado (perezoso): si el spec no fijo __E2E_MOCK
// pero llama usarMockSolver() en runtime, instalamos en ese momento. instalarMockSolver
// hace __resetWorker(), asi que el proximo calcular() usa el mock aunque la app ya
// hubiera tocado el solver.
function asegurarMock(): ControlMockSolver {
  if (!controlMock) controlMock = instalarMockSolver();
  return controlMock;
}

// Lee el Modelo (Capa 1) actual. getModelo() es la fuente unica de la obra; aqui solo
// se leen recuentos/ids, nunca se muta fuera de los comandos.
function modelo() {
  return modeloStore.getState().getModelo();
}

export function montar(): void {
  if (montado) return;
  montado = true;

  // (a) Mock del solver ANTES del render (D2): si el flag de addInitScript esta puesto,
  // instala el par-worker falso antes de que App monte y dispare usePrecargaMotor. El
  // worker real nunca arranca.
  if (window.__E2E_MOCK === true) {
    controlMock = instalarMockSolver();
  }

  // (b) Contrato de la costura: cada metodo despacha un comando existente. Las
  // mutaciones de obra pasan SIEMPRE por modeloStore.ejecutar (un paso de undo,
  // invalidacion de resultados, todo gratis). Los ids generados se devuelven leyendo
  // el ultimo elemento empujado (los comandos hacen push al final del array).
  window.__concreta = {
    crearPilar(p): string {
      // Si el spec no fija seccion, garantiza la seccion de obra por defecto en
      // modelo.secciones ANTES de crear (el discretizador la resuelve contra la obra).
      if (!p.seccionId) asegurarSeccionPorDefecto();
      modeloStore.getState().ejecutar(crearPilar(modelo(), datosPilar(p)));
      const pilares = modelo().pilares;
      return pilares[pilares.length - 1]!.id;
    },

    crearViga(p): string {
      if (!p.seccionId) asegurarSeccionPorDefecto();
      modeloStore.getState().ejecutar(crearViga(modelo(), datosViga(p)));
      const vigas = modelo().vigas;
      return vigas[vigas.length - 1]!.id;
    },

    anadirCargaLineal(p): string {
      // Carga lineal sobre un elemento (ambito = id de pilar/viga). El tipo es
      // "lineal" (la UI de F1 solo introduce cargas lineales, memoria feature-13).
      modeloStore.getState().ejecutar(
        crearCarga(modelo(), {
          tipo: "lineal",
          ambito: p.elementoId,
          valor: p.valor,
          hipotesisId: p.hipotesisId,
        }),
      );
      const cargas = modelo().cargas;
      return cargas[cargas.length - 1]!.id;
    },

    seleccionar(ids: string[]): void {
      // Abre el inspector por seleccion directa (sin picking en el canvas): los
      // inspectores se autocontrolan por seleccionStore.seleccion (memoria feature-11/12).
      seleccionStore.getState().seleccionar(ids);
    },

    deshacer(): void {
      modeloStore.getState().deshacer();
    },

    rehacer(): void {
      modeloStore.getState().rehacer();
    },

    resumenModelo() {
      const m = modelo();
      return {
        pilares: m.pilares.length,
        vigas: m.vigas.length,
        cargas: m.cargas.length,
      };
    },

    estadoObra() {
      // Accesor de LECTURA (ampliacion aditiva del contrato): los specs crean
      // grupos/plantas por el DIALOGO REAL (UI), pero luego necesitan los ids de
      // planta para crearPilar/crearViga. Esto los expone sin que el spec tenga que
      // hurgar en el store. Solo id/nombre/grupoId: lo justo para resolver referencias.
      const m = modelo();
      return {
        grupos: m.grupos.map((g) => ({ id: g.id, nombre: g.nombre })),
        plantas: m.plantas.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          grupoId: p.grupoId,
        })),
      };
    },

    usarMockSolver(): ControlMockSolver {
      // Devuelve el control ya instalado en montar() (camino normal con __E2E_MOCK);
      // si el spec no fijo el flag, lo instala perezosamente. No reinstala: reusar el
      // mismo control conserva el contador de llamadas.
      return asegurarMock();
    },
  };

  // La senal app-ready (data-testid="app-ready", D6) la pinta App cuando
  // vistaStore.persistenciaLista es true: el bridge no la toca. Aqui solo dejamos
  // constancia en dev de que la costura esta montada (depuracion manual con VITE_E2E).
  if (import.meta.env.DEV) {
     
    console.info("[e2eBridge] window.__concreta montado (VITE_E2E)");
  }
}
