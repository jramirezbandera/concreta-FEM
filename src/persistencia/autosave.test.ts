// Tests de autosave (T4.1). Project `persistencia` (fake-indexeddb/auto instala
// `indexedDB`). El modeloStore y el repositorio son singletons de modulo: el store
// se resetea con cargarModelo(crearModeloVacio()) y la DB se vacia en afterEach.
//
// Patron de fake-timers + Dexie (lo que funciono, CRITICO para no caer en flaky o
// en deadlocks):
//   - Solo falsificamos setTimeout/clearTimeout (`toFake`). NO falsificamos
//     queueMicrotask/setImmediate/nextTick: Dexie + fake-indexeddb los usan para
//     completar sus transacciones. Si se falsifican TODOS los timers (defecto de
//     vi.useFakeTimers), hasta el `await crearProyecto(...)` se cuelga porque la
//     transaccion de Dexie nunca avanza. Acotar a setTimeout es lo unico que hace
//     falta: el debounce del autosave usa setTimeout y nada mas.
//   - El listener del store es SINCRONO y solo agenda un setTimeout; el callback
//     del timer hace fire-and-forget de una funcion async (lee getProyectoActivoId
//     y escribe en Dexie). Por eso usamos `vi.advanceTimersByTimeAsync(ms)`, que
//     avanza los timers Y cede el event loop para que resuelvan las promesas de
//     Dexie encadenadas (que corren sobre microtasks reales).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./esquema";
import {
  cargarProyecto,
  crearProyecto,
  getProyectoActivoId,
  listarProyectos,
  setProyectoActivoId,
} from "./repositorio";
import {
  iniciarAutosave,
  cargarProyectoEnStore,
  _esperarGuardadoAutosave,
} from "./autosave";
import { modeloStore } from "../estado/modeloStore";
import { crearPilar, type DatosPilar } from "../estado";
import { crearModeloVacio } from "../dominio";

// Datos de un pilar valido (DatosPilar = Pilar sin id/nombre). Sirve para producir
// una edicion real de la Capa 1 via comando.
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

// Edicion real de la obra a traves del store (genera nueva referencia de `modelo`,
// que es lo que dispara el autosave).
function crearUnPilar(): void {
  const base = modeloStore.getState().getModelo();
  modeloStore.getState().ejecutar(crearPilar(base, DATOS_PILAR));
}

// Avanza el reloj `ms` (dispara el debounce) y ademas espera a que el guardado
// fire-and-forget termine de tocar Dexie. advanceTimersByTimeAsync solo garantiza
// que el callback del timer ARRANCO; _esperarGuardadoAutosave cierra la cadena de
// awaits de Dexie antes de que el test lea la DB.
async function avanzarYGuardar(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await _esperarGuardadoAutosave();
}

beforeEach(() => {
  // Solo setTimeout/clearTimeout: dejar microtasks/setImmediate reales para Dexie.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // Store limpio antes de cada test (es singleton de modulo).
  modeloStore.getState().cargarModelo(crearModeloVacio());
});

afterEach(async () => {
  vi.useRealTimers();
  await db.proyectos.clear();
  await db.meta.clear();
});

describe("iniciarAutosave", () => {
  it("guarda el modelo editado tras el debounce", async () => {
    const proyecto = await crearProyecto("Edificio");
    await setProyectoActivoId(proyecto.id);

    const baja = iniciarAutosave({ debounceMs: 800 });
    try {
      crearUnPilar();
      await avanzarYGuardar(800);

      const guardado = await cargarProyecto(proyecto.id);
      expect(guardado!.modelo.pilares).toHaveLength(1);
    } finally {
      baja();
    }
  });

  it("debounce: dos ediciones rapidas -> un solo guardado con el ultimo estado", async () => {
    const proyecto = await crearProyecto("Edificio");
    await setProyectoActivoId(proyecto.id);

    const baja = iniciarAutosave({ debounceMs: 800 });
    try {
      crearUnPilar();
      await vi.advanceTimersByTimeAsync(400); // dentro de la ventana: no guarda aun
      crearUnPilar(); // re-arma el debounce
      await vi.advanceTimersByTimeAsync(400); // total 800 desde la 1a, 400 desde la 2a

      // A los 800 ms desde la 1a edicion todavia NO debe haber guardado (el
      // debounce se reinicio en la 2a): el proyecto sigue con 0 pilares.
      const intermedio = await cargarProyecto(proyecto.id);
      expect(intermedio!.modelo.pilares).toHaveLength(0);

      await avanzarYGuardar(400); // completa la ventana de la 2a edicion
      const final = await cargarProyecto(proyecto.id);
      // Un unico guardado con el estado final (2 pilares), no dos guardados.
      expect(final!.modelo.pilares).toHaveLength(2);
    } finally {
      baja();
    }
  });

  it("baja: tras dar de baja, una edicion no guarda", async () => {
    const proyecto = await crearProyecto("Edificio");
    await setProyectoActivoId(proyecto.id);

    const baja = iniciarAutosave({ debounceMs: 800 });
    baja();

    crearUnPilar();
    await vi.advanceTimersByTimeAsync(800);

    const guardado = await cargarProyecto(proyecto.id);
    expect(guardado!.modelo.pilares).toHaveLength(0);
  });

  it("baja: cancela un timer pendiente (no guarda despues de la baja)", async () => {
    const proyecto = await crearProyecto("Edificio");
    await setProyectoActivoId(proyecto.id);

    const baja = iniciarAutosave({ debounceMs: 800 });
    crearUnPilar(); // arma el timer
    await vi.advanceTimersByTimeAsync(400); // a medias de la ventana
    baja(); // debe cancelar el timer pendiente

    await vi.advanceTimersByTimeAsync(800); // el timer cancelado no debe disparar

    const guardado = await cargarProyecto(proyecto.id);
    expect(guardado!.modelo.pilares).toHaveLength(0);
  });

  it("sin proyecto activo: editar no rompe (no-op)", async () => {
    // Ningun proyecto activo. El disparo debe ser no-op silencioso.
    expect(await getProyectoActivoId()).toBeUndefined();

    const baja = iniciarAutosave({ debounceMs: 800 });
    try {
      crearUnPilar();
      // No debe lanzar ni intentar escribir: guard temprano sin proyecto activo.
      await expect(avanzarYGuardar(800)).resolves.toBeUndefined();
      expect(await listarProyectos()).toEqual([]);
    } finally {
      baja();
    }
  });

  it("proyecto borrado en carrera: guardado es no-op (no lanza)", async () => {
    const proyecto = await crearProyecto("Borrable");
    await setProyectoActivoId(proyecto.id);

    const baja = iniciarAutosave({ debounceMs: 800 });
    try {
      crearUnPilar();
      // Borramos el registro del proyecto (pero el puntero activo aun apunta a el)
      // antes de que el guardado complete: guardarModeloDeProyecto -> false.
      await db.proyectos.delete(proyecto.id);

      // No debe lanzar pese a que guardarModeloDeProyecto devuelve false.
      await expect(avanzarYGuardar(800)).resolves.toBeUndefined();
      expect(await cargarProyecto(proyecto.id)).toBeUndefined();
    } finally {
      baja();
    }
  });
});

describe("durabilidad y concurrencia (T1)", () => {
  it("si Dexie rechaza el guardado, onError se llama y el store sigue editable", async () => {
    const proyecto = await crearProyecto("Edificio");
    await setProyectoActivoId(proyecto.id);

    // Forzamos un rechazo de Dexie en el put del proyecto durante el guardado.
    const errores: unknown[] = [];
    const spy = vi
      .spyOn(db.proyectos, "get")
      .mockRejectedValueOnce(new Error("QuotaExceededError simulado"));

    const baja = iniciarAutosave({
      debounceMs: 800,
      onError: (e) => errores.push(e),
    });
    try {
      crearUnPilar();
      await avanzarYGuardar(800);

      // onError recibio el rechazo; el autosave no relanzo.
      expect(errores).toHaveLength(1);
      expect((errores[0] as Error).message).toMatch(/QuotaExceededError/);

      // El store sigue editable: una edicion mas no rompe nada.
      spy.mockRestore();
      crearUnPilar();
      await avanzarYGuardar(800);
      expect(modeloStore.getState().getModelo().pilares).toHaveLength(2);
    } finally {
      baja();
      spy.mockRestore();
    }
  });

  it("dos guardados solapados se serializan: gana el ultimo estado", async () => {
    const proyecto = await crearProyecto("Edificio");
    await setProyectoActivoId(proyecto.id);

    const baja = iniciarAutosave({ debounceMs: 800 });
    try {
      // Primera edicion -> primer guardado encolado.
      crearUnPilar();
      await vi.advanceTimersByTimeAsync(800);
      // Segunda edicion -> segundo guardado, encadenado sobre el primero.
      crearUnPilar();
      await avanzarYGuardar(800);

      // La cadena de _guardadoEnVuelo garantiza orden: el ultimo escrito es el de
      // 2 pilares (el estado final), no una version intermedia.
      const guardado = await cargarProyecto(proyecto.id);
      expect(guardado!.modelo.pilares).toHaveLength(2);
    } finally {
      baja();
    }
  });

  it("conflicto: otra pestana bumpea actualizadoEn -> onError sin machacar", async () => {
    const proyecto = await crearProyecto("Edificio");
    await setProyectoActivoId(proyecto.id);

    const errores: unknown[] = [];
    const baja = iniciarAutosave({
      debounceMs: 800,
      onError: (e) => errores.push(e),
    });
    try {
      // Primer guardado: fija la baseline conocida del autosave.
      crearUnPilar();
      await avanzarYGuardar(800);
      const trasPrimero = await cargarProyecto(proyecto.id);
      expect(trasPrimero!.modelo.pilares).toHaveLength(1);

      // "Otra pestana" escribe MAS TARDE que la baseline conocida: bumpeamos
      // actualizadoEn muy por encima sin pasar por el autosave.
      await db.proyectos.put({
        ...trasPrimero!,
        actualizadoEn: trasPrimero!.actualizadoEn + 1_000_000,
        nombre: "Editado por otra pestana",
      });

      // Siguiente autosave: detecta conflicto, NO machaca, surfacea por onError.
      crearUnPilar();
      await avanzarYGuardar(800);

      expect(errores).toHaveLength(1);
      expect(errores[0]).toMatchObject({ tipo: "conflicto", id: proyecto.id });

      // El registro ajeno NO se machaco: sigue con 1 pilar y el nombre de la otra.
      const final = await cargarProyecto(proyecto.id);
      expect(final!.modelo.pilares).toHaveLength(1);
      expect(final!.nombre).toBe("Editado por otra pestana");
    } finally {
      baja();
    }
  });
});

describe("coordinacion load-vs-timer (T5)", () => {
  it("cargar con un timer pendiente NO escribe el modelo cargado en el proyecto previo", async () => {
    // Proyecto B: guardado en DB con su propio modelo (2 pilares) ANTES de empezar,
    // para no interferir con el timer de A mas tarde.
    modeloStore.getState().cargarModelo(crearModeloVacio());
    crearUnPilar();
    crearUnPilar();
    const modeloB = modeloStore.getState().getModelo();
    const b = await crearProyecto("Proyecto B");
    await db.proyectos.put({ ...b, modelo: modeloB });

    // Proyecto A (previo, vacio en DB) y autosave en marcha sobre A.
    modeloStore.getState().cargarModelo(crearModeloVacio());
    const a = await crearProyecto("Proyecto A");
    await setProyectoActivoId(a.id);
    const baja = iniciarAutosave({ debounceMs: 800 });
    try {
      // Editamos A (1 pilar) y dejamos el timer A MEDIAS: el debounce NO ha cumplido,
      // hay un guardado pendiente que escribiria el modelo de A en el proyecto A.
      crearUnPilar();
      await vi.advanceTimersByTimeAsync(400);

      // Cargamos B: debe CANCELAR el timer pendiente de A y fijar B como activo
      // ANTES de cargar su modelo (T5).
      const r = await cargarProyectoEnStore(b.id);
      expect(r.ok).toBe(true);
      expect(await getProyectoActivoId()).toBe(b.id);
      // El store quedo con el modelo de B (2 pilares).
      expect(modeloStore.getState().getModelo().pilares).toHaveLength(2);

      // Avanzamos el reloj: el timer de A fue cancelado, no dispara ningun guardado.
      await avanzarYGuardar(800);

      // A conserva su estado original en DB (0 pilares): el timer cancelado nunca
      // escribio el modelo de A (ni el de B) en el proyecto A.
      const guardadoA = await cargarProyecto(a.id);
      expect(guardadoA!.modelo.pilares).toHaveLength(0);
      // B sigue intacto con su modelo (2 pilares).
      const guardadoB = await cargarProyecto(b.id);
      expect(guardadoB!.modelo.pilares).toHaveLength(2);
    } finally {
      baja();
    }
  });

  it("crear -> editar autosalva sin set manual del puntero activo (T5)", async () => {
    // crearProyecto deja el proyecto activo: el autosave guarda sin setProyectoActivoId.
    const proyecto = await crearProyecto("Nuevo activo");
    expect(await getProyectoActivoId()).toBe(proyecto.id);

    const baja = iniciarAutosave({ debounceMs: 800 });
    try {
      crearUnPilar();
      await avanzarYGuardar(800);

      const guardado = await cargarProyecto(proyecto.id);
      expect(guardado!.modelo.pilares).toHaveLength(1);
    } finally {
      baja();
    }
  });
});

describe("cargarProyectoEnStore", () => {
  it("round-trip: guarda un modelo y lo recarga en un store limpio", async () => {
    // Proyecto con una obra no trivial: lo guardamos via autosave.
    const proyecto = await crearProyecto("Origen");
    await setProyectoActivoId(proyecto.id);
    const baja = iniciarAutosave({ debounceMs: 800 });
    crearUnPilar();
    await avanzarYGuardar(800);
    baja();

    const guardado = await cargarProyecto(proyecto.id);
    expect(guardado!.modelo.pilares).toHaveLength(1);

    // Reseteamos el store (simula store limpio) y limpiamos el puntero activo.
    modeloStore.getState().cargarModelo(crearModeloVacio());
    await setProyectoActivoId(undefined);
    expect(modeloStore.getState().getModelo().pilares).toHaveLength(0);

    const resultado = await cargarProyectoEnStore(proyecto.id);
    expect(resultado.ok).toBe(true);
    // El store quedo con el modelo guardado.
    expect(modeloStore.getState().getModelo().pilares).toHaveLength(1);
    // Y el proyecto quedo marcado como activo.
    expect(await getProyectoActivoId()).toBe(proyecto.id);
  });

  it("id inexistente -> ok:false y store intacto", async () => {
    const resultado = await cargarProyectoEnStore("inexistente");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errores[0]).toMatch(/No existe el proyecto/);
    }
    expect(modeloStore.getState().getModelo().pilares).toHaveLength(0);
  });

  it("modelo corrupto en DB -> ok:false y store intacto (defensa en el borde)", async () => {
    // Insertamos directamente un ProyectoGuardado cuyo `modelo` es invalido
    // (sin schemaVersion ni la forma esperada): simula un IndexedDB manipulado.
    const idCorrupto = "corrupto";
    await db.proyectos.put({
      id: idCorrupto,
      nombre: "Corrupto",
      modelo: { basura: true } as never, // no es un Modelo valido
      schemaVersion: 1,
      creadoEn: 0,
      actualizadoEn: 0,
    });

    // Marca en el store antes de cargar, para comprobar que NO se toca.
    crearUnPilar();
    const antes = modeloStore.getState().getModelo();

    const resultado = await cargarProyectoEnStore(idCorrupto);
    expect(resultado.ok).toBe(false);
    // El store no cambio: misma referencia de modelo.
    expect(modeloStore.getState().getModelo()).toBe(antes);
  });
});
