// Test de integracion extremo a extremo (T5.1): une el ESTADO (modeloStore +
// comandos reales + resultadosStore) con la PERSISTENCIA (repositorio Dexie,
// autosave, serializacion, frontera Zod). No prueba modulos aislados (eso lo
// cubren autosave.test.ts / repositorio.test.ts): aqui validamos el PIPELINE
// completo del producto, en particular la regla de oro: importar/cargar un
// proyecto nunca rompe la app, y SOLO la Capa 1 se persiste (CLAUDE.md §12, §17).
//
// Patron fake-timers + Dexie (heredado de autosave.test.ts, CRITICO):
//   - Solo se falsifican setTimeout/clearTimeout (`toFake`). Falsificar TODOS los
//     timers cuelga fake-indexeddb (usa queueMicrotask/setImmediate para cerrar
//     transacciones). El debounce del autosave usa solo setTimeout.
//   - Tras advanceTimersByTimeAsync(ms) hay que await _esperarGuardadoAutosave()
//     para cerrar la cadena async de Dexie del guardado fire-and-forget antes de
//     leer la DB.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./esquema";
import type { ProyectoGuardado } from "./esquema";
import {
  borrarProyecto,
  cargarProyecto,
  crearProyecto,
  getProyectoActivoId,
  listarProyectos,
  setProyectoActivoId,
} from "./repositorio";
import {
  cargarProyectoEnStore,
  iniciarAutosave,
  _esperarGuardadoAutosave,
} from "./autosave";
import {
  exportarProyecto,
  exportarProyectoComoTexto,
  importarProyecto,
} from "./serializacion";
import { modeloStore } from "../estado/modeloStore";
import { resultadosStore } from "../estado/resultadosStore";
import { crearPilar, type DatosPilar } from "../estado";
import { crearModeloVacio } from "../dominio";
import type { ResultadosCalculo } from "../solver";
import type { ModeloFEM, Trazabilidad } from "../discretizador";

// Datos de un pilar valido (DatosPilar = Pilar sin id/nombre): produce una edicion
// real de la Capa 1 a traves de un comando del estado.
const DATOS_PILAR: DatosPilar = {
  x: 0,
  y: 0,
  plantaInicial: "pl1",
  plantaFinal: "pl2",
  seccionId: "s1",
  materialId: "m1",
  angulo: 0,
  vinculacionExterior: true,
  arranque: "empotrado",
};

// Edicion real de la obra via comando del estado: genera nueva referencia de
// `modelo` (lo que el autosave observa) y pasa por la pila de undo.
function crearUnPilar(): void {
  const base = modeloStore.getState().getModelo();
  modeloStore.getState().ejecutar(crearPilar(base, DATOS_PILAR));
}

// Avanza el reloj `ms` (dispara el debounce) y espera a que el guardado
// fire-and-forget termine de tocar Dexie antes de assertar la DB.
async function avanzarYGuardar(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await _esperarGuardadoAutosave();
}

// Resultados de mentira (Capa 2 / derivados): forma minima valida de
// ResultadosCalculo. NO deben acabar nunca en IndexedDB (CLAUDE.md §17).
const RESULTADOS_FALSOS: ResultadosCalculo = {
  units: "kN-m",
  analysis: { type: "linear", n_points: 2 },
  combos: ["ELU"],
  nodos: {},
  barras: {},
  check_statics: null,
};

// setResultados exige el trio (resultados + ModeloFEM + trazabilidad) desde
// feature-14: este test solo comprueba que NADA de eso se persiste, asi que el
// FEM y la traza son minimos vacios (su contenido es irrelevante aqui).
const MODELO_FEM_FALSO: ModeloFEM = {
  units: "kN-m",
  nodes: [],
  materials: [],
  sections: [],
  members: [],
  supports: [],
  node_loads: [],
  dist_loads: [],
  pt_loads: [],
  combos: [],
  analysis: { type: "linear", check_statics: false },
};

const TRAZABILIDAD_FALSA: Trazabilidad = {
  pilarAMembers: {},
  vigaAMember: {},
  pilarANodoArranque: {},
  nudoANodo: {},
};

beforeEach(() => {
  // Solo setTimeout/clearTimeout: microtasks/setImmediate reales para Dexie.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // Stores limpios antes de cada test (son singletons de modulo). descartar()
  // resetea resultadosStore para no filtrar resultados entre tests.
  modeloStore.getState().cargarModelo(crearModeloVacio());
  resultadosStore.getState().descartar();
});

afterEach(async () => {
  vi.useRealTimers();
  await db.proyectos.clear();
  await db.meta.clear();
});

describe("pipeline autosave end-to-end con recarga simulada", () => {
  it("edita con un comando real, autoguarda y recupera el modelo al recargar", async () => {
    // Proyecto activo + autosave en marcha.
    const proyecto = await crearProyecto("Edificio");
    await setProyectoActivoId(proyecto.id);
    const baja = iniciarAutosave({ debounceMs: 800 });

    try {
      // Edicion real de la obra (comando crearPilar) -> dispara autosave.
      crearUnPilar();
      const modeloEnVivo = modeloStore.getState().getModelo();
      await avanzarYGuardar(800);

      // "Recarga": reseteamos el store a vacio (como si la app arrancara de cero).
      modeloStore.getState().cargarModelo(crearModeloVacio());
      await setProyectoActivoId(undefined);
      expect(modeloStore.getState().getModelo().pilares).toHaveLength(0);

      // Releemos directamente de IndexedDB lo que dejo el autosave: deep-equal del
      // Modelo persistido (Capa 1) con el que estaba en vivo antes de recargar.
      const guardado = await cargarProyecto(proyecto.id);
      expect(guardado!.modelo).toEqual(modeloEnVivo);

      // Y por la via de producto: cargarProyectoEnStore reconstruye el store.
      const resultado = await cargarProyectoEnStore(proyecto.id);
      expect(resultado.ok).toBe(true);
      const reconstruido = modeloStore.getState().getModelo();
      expect(reconstruido.pilares).toHaveLength(1);
      expect(reconstruido.pilares[0]).toMatchObject(DATOS_PILAR);
      // El proyecto recargado queda marcado como activo.
      expect(await getProyectoActivoId()).toBe(proyecto.id);
    } finally {
      baja();
    }
  });
});

describe("roundtrip export -> import", () => {
  it("exportar a texto e importar reconstruye el mismo Modelo (deep-equal)", async () => {
    crearUnPilar();
    const modelo = modeloStore.getState().getModelo();

    const texto = exportarProyectoComoTexto("Para exportar", modelo);
    const resultado = importarProyecto(texto);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.modelo).toEqual(modelo);
    }
  });

  it("exportar como Blob e importar (via blob.text()) tambien cierra el ciclo", async () => {
    crearUnPilar();
    crearUnPilar();
    const modelo = modeloStore.getState().getModelo();

    const blob = exportarProyecto("Para exportar", modelo);
    expect(blob.type).toBe("application/json");
    const texto = await blob.text();
    const resultado = importarProyecto(texto);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.modelo).toEqual(modelo);
      expect(resultado.modelo.pilares).toHaveLength(2);
    }
  });
});

describe("import corrupto no rompe el store", () => {
  it("importarProyecto con JSON basura -> ok:false y store intacto", async () => {
    crearUnPilar();
    const antes = modeloStore.getState().getModelo();

    const resultado = importarProyecto("{ basura");
    expect(resultado.ok).toBe(false);
    // El store no cambio: misma referencia de modelo (importar es puro, no toca
    // el store; quien decide cargar es la UI, y solo si ok:true).
    expect(modeloStore.getState().getModelo()).toBe(antes);
  });

  it("importarProyecto con envoltorio de modelo invalido -> ok:false y store intacto", async () => {
    crearUnPilar();
    const antes = modeloStore.getState().getModelo();

    // Envoltorio bien formado pero con un `modelo` que no pasa ModeloSchema.
    const texto = JSON.stringify({
      formato: "concreta-proyecto",
      schemaVersion: 1,
      nombre: "Roto",
      modelo: { schemaVersion: 1, basura: true },
    });
    const resultado = importarProyecto(texto);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      // Errores en lenguaje legible (mapeo de issues de Zod), no excepcion.
      expect(resultado.errores.length).toBeGreaterThan(0);
    }
    expect(modeloStore.getState().getModelo()).toBe(antes);
  });

  it("cargarProyectoEnStore con modelo invalido en DB -> ok:false y store intacto", async () => {
    // Inyectamos un ProyectoGuardado con `modelo` invalido (IndexedDB manipulado).
    const idCorrupto = "corrupto";
    await db.proyectos.put({
      id: idCorrupto,
      nombre: "Corrupto",
      modelo: { basura: true } as never, // no es un Modelo valido
      schemaVersion: 1,
      creadoEn: 0,
      actualizadoEn: 0,
    });

    crearUnPilar();
    const antes = modeloStore.getState().getModelo();

    const resultado = await cargarProyectoEnStore(idCorrupto);
    expect(resultado.ok).toBe(false);
    // El store sobrevive: la Capa 1 en memoria no se toca si la carga no valida.
    expect(modeloStore.getState().getModelo()).toBe(antes);
  });
});

describe("biblioteca multi-proyecto", () => {
  it("listar ordena por actualizadoEn desc; borrar reduce y limpia el activo", async () => {
    const a = await crearProyecto("Antiguo");
    const b = await crearProyecto("Medio");
    const c = await crearProyecto("Reciente");

    // Forzamos timestamps deterministas (Date.now() puede colisionar en el mismo ms).
    await db.proyectos.put({ ...a, actualizadoEn: 100 });
    await db.proyectos.put({ ...b, actualizadoEn: 200 });
    await db.proyectos.put({ ...c, actualizadoEn: 300 });

    let lista = await listarProyectos();
    expect(lista.map((p) => p.id)).toEqual([c.id, b.id, a.id]);

    // Marcamos `b` como activo y lo borramos: la lista baja a 2 y el puntero se
    // limpia (borrar el activo deja la biblioteca sin proyecto activo).
    await setProyectoActivoId(b.id);
    expect(await getProyectoActivoId()).toBe(b.id);

    await borrarProyecto(b.id);
    lista = await listarProyectos();
    expect(lista.map((p) => p.id)).toEqual([c.id, a.id]);
    expect(await getProyectoActivoId()).toBeUndefined();

    // setProyectoActivoId/getProyectoActivoId coherentes con otro proyecto.
    await setProyectoActivoId(a.id);
    expect(await getProyectoActivoId()).toBe(a.id);
  });
});

describe("invariante: SOLO la Capa 1 se persiste", () => {
  it("tras un calculo simulado, los resultados NO acaban en IndexedDB", async () => {
    const proyecto = await crearProyecto("Con resultados");
    await setProyectoActivoId(proyecto.id);
    const baja = iniciarAutosave({ debounceMs: 800 });

    try {
      // Simulamos un calculo: poblamos resultadosStore (Capa 2/derivados).
      resultadosStore
        .getState()
        .setResultados(RESULTADOS_FALSOS, MODELO_FEM_FALSO, TRAZABILIDAD_FALSA);
      expect(resultadosStore.getState().resultados).not.toBeNull();

      // Y editamos la obra para disparar el autosave (poblar resultados no cambia
      // la referencia del modelo; el autosave observa solo `s.modelo`).
      crearUnPilar();
      await avanzarYGuardar(800);

      // Releemos el registro persistido: debe tener EXACTAMENTE las claves de
      // ProyectoGuardado (modelo Capa 1 + metadatos). Ningun campo de resultados,
      // deformada, reacciones ni Capa 2 (nodes/members FEM).
      const guardado = await cargarProyecto(proyecto.id);
      expect(guardado).toBeDefined();
      const claves = Object.keys(guardado as ProyectoGuardado).sort();
      expect(claves).toEqual(
        ["actualizadoEn", "creadoEn", "id", "modelo", "nombre", "schemaVersion"].sort(),
      );

      // Defensa explicita por nombre: ningun rastro de resultados/Capa 2.
      const reg = guardado as unknown as Record<string, unknown>;
      expect(reg.resultados).toBeUndefined();
      expect(reg.deformada).toBeUndefined();
      expect(reg.reacciones).toBeUndefined();
      expect(reg.esfuerzos).toBeUndefined();
      // La Capa 1 SI esta (el pilar editado se guardo).
      expect(guardado!.modelo.pilares).toHaveLength(1);
    } finally {
      baja();
    }
  });
});
