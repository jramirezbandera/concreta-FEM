// Tests de la capa de estado (feature-7): los cuatro stores separados + integracion
// del undo/redo en modeloStore + invalidacion de resultados + subscribeWithSelector.
// Proyecto "node" (sin DOM): los stores Zustand son singletons de modulo, asi que se
// resetea todo el estado en beforeEach para que cada test sea independiente.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  modeloStore,
  seleccionStore,
  vistaStore,
  resultadosStore,
  crearPilar,
  moverNudo,
} from "./index";
import { crearModeloVacio } from "../dominio";
import type { Modelo } from "../dominio";
import type { DatosPilar } from "./comandos/comandosModelo";
import { siguienteNombre } from "./comandos/comandosModelo";
import type { Pilar } from "../dominio";
import type { ResultadosCalculo } from "../solver";
import type { ModeloFEM, Trazabilidad } from "../discretizador";
import type { Plantilla } from "../ui/viewport/dxf/tiposDxf";

// --- Datos de prueba ---------------------------------------------------------

const datosPilar: DatosPilar = {
  x: 0,
  y: 0,
  plantaInicial: "p0",
  plantaFinal: "p1",
  seccionId: "s1",
  materialId: "m1",
  angulo: 0,
  vinculacionExterior: true,
  arranque: "empotrado",
};

// Modelo con un nudo para poder moverlo (coalescing). Copia del vacio + un nudo.
function modeloConNudo(): Modelo {
  return { ...crearModeloVacio(), nudos: [{ id: "n1", x: 0, y: 0 }] };
}

// ResultadosCalculo minimo pero COMPLETO y valido segun el contrato (resultados.ts):
// combos nonempty, n_points entero positivo, sin nodos/barras (records vacios),
// check_statics null. Se construye real (no cast) para que el test de invalidacion
// arranque de un estado "vigente" autentico.
function resultadosMinimos(): ResultadosCalculo {
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos: ["ELU"],
    nodos: {},
    barras: {},
    check_statics: null,
  };
}

// ModeloFEM minimo vacio: setResultados exige el trio (resultados + FEM + traza)
// porque los tres provienen del mismo calculo (feature-14, tarea 0.3).
function modeloFEMMinimo(): ModeloFEM {
  return {
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
}

function trazabilidadMinima(): Trazabilidad {
  return {
    pilarAMembers: {},
    vigaAMember: {},
    pilarANodoArranque: {},
    nudoANodo: {},
  };
}

// Reset completo de los cuatro stores antes de cada test.
beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  seleccionStore.getState().limpiar();
  seleccionStore.getState().setHover(null);
  vistaStore.getState().setPestanaActiva("entradaPilares");
  vistaStore.getState().setModoVista("planta");
  vistaStore.getState().setGrupoActivo(null);
  vistaStore.getState().setPlantaActiva(null);
  vistaStore.getState().setCombinacionActiva(null);
  // descartar (no limpiar): reset TOTAL de resultados para aislar cada test, ya que
  // limpiar() solo baja la bandera y conserva los resultados (D5).
  resultadosStore.getState().descartar();
});

// --- 1 · Init ----------------------------------------------------------------

describe("Init: cuatro stores separados", () => {
  it("modeloStore arranca con crearModeloVacio() (deep-equal)", () => {
    // Tras el reset es trivialmente vacio; comprobamos forma exacta.
    expect(modeloStore.getState().modelo).toEqual(crearModeloVacio());
    expect(modeloStore.getState().getModelo()).toEqual(crearModeloVacio());
  });

  it("los cuatro stores son objetos distintos y exponen su API", () => {
    expect(modeloStore).not.toBe(seleccionStore);
    expect(seleccionStore).not.toBe(vistaStore);
    expect(vistaStore).not.toBe(resultadosStore);
    expect(typeof modeloStore.getState().ejecutar).toBe("function");
    expect(seleccionStore.getState().seleccion).toEqual([]);
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
    expect(resultadosStore.getState().resultados).toBeNull();
  });

  it("solo modeloStore participa en undo (los otros no tienen pila)", () => {
    // Habilitacion expuesta como estado booleano (no metodo) reflejo de la pila.
    expect(typeof modeloStore.getState().puedeDeshacer).toBe("boolean");
    expect("puedeDeshacer" in seleccionStore.getState()).toBe(false);
    expect("puedeDeshacer" in vistaStore.getState()).toBe(false);
    expect("puedeDeshacer" in resultadosStore.getState()).toBe(false);
  });
});

// --- 2-3 · Crear pilar -> deshacer/rehacer -----------------------------------

describe("ejecutar/deshacer/rehacer con delta", () => {
  it("crear pilar -> deshacer => estado identico al previo (deep-equal)", () => {
    const previo = structuredClone(modeloStore.getState().getModelo());
    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(cmd);
    expect(modeloStore.getState().modelo.pilares).toHaveLength(1);

    modeloStore.getState().deshacer();
    expect(modeloStore.getState().getModelo()).toEqual(previo);
  });

  it("rehacer => vuelve al estado con el pilar (deep-equal al post-ejecutar)", () => {
    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(cmd);
    const conPilar = structuredClone(modeloStore.getState().getModelo());

    modeloStore.getState().deshacer();
    modeloStore.getState().rehacer();
    expect(modeloStore.getState().getModelo()).toEqual(conPilar);
  });

  it("el pilar creado lleva nombre derivado P{n} e id generado", () => {
    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(cmd);
    const pilar = modeloStore.getState().modelo.pilares[0];
    expect(pilar.nombre).toBe("P1");
    expect(pilar.id).toMatch(/[0-9a-f-]{36}/);
  });
});

// --- 7 · puedeDeshacer/puedeRehacer ------------------------------------------

describe("puedeDeshacer/puedeRehacer: estado reactivo reflejo de la pila", () => {
  it("vacio al inicio", () => {
    expect(modeloStore.getState().puedeDeshacer).toBe(false);
    expect(modeloStore.getState().puedeRehacer).toBe(false);
  });

  it("ejecutar => puedeDeshacer; deshacer => puedeRehacer", () => {
    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(cmd);
    expect(modeloStore.getState().puedeDeshacer).toBe(true);
    expect(modeloStore.getState().puedeRehacer).toBe(false);

    modeloStore.getState().deshacer();
    expect(modeloStore.getState().puedeDeshacer).toBe(false);
    expect(modeloStore.getState().puedeRehacer).toBe(true);
  });

  it("ejecutar un comando nuevo limpia la pila de rehacer", () => {
    const c1 = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(c1);
    modeloStore.getState().deshacer();
    expect(modeloStore.getState().puedeRehacer).toBe(true);

    const c2 = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(c2);
    expect(modeloStore.getState().puedeRehacer).toBe(false);
  });

  it("cargarModelo limpia el historial de undo", () => {
    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(cmd);
    expect(modeloStore.getState().puedeDeshacer).toBe(true);

    modeloStore.getState().cargarModelo(crearModeloVacio());
    expect(modeloStore.getState().puedeDeshacer).toBe(false);
    expect(modeloStore.getState().puedeRehacer).toBe(false);
  });

  it("el estado booleano dispara la suscripcion del selector (sin truco)", () => {
    // Verifica el contrato que consume Brandbar: suscribirse a `puedeDeshacer`
    // basta para reaccionar a ejecutar/deshacer, sin observar el modelo entero.
    const cb = vi.fn();
    const unsub = modeloStore.subscribe((s) => s.puedeDeshacer, cb);

    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(cmd);
    expect(cb).toHaveBeenLastCalledWith(true, false);

    modeloStore.getState().deshacer();
    expect(cb).toHaveBeenLastCalledWith(false, true);
    unsub();
  });
});

// --- 6 · Coalescing de moverNudo ---------------------------------------------

describe("Coalescing: rafaga de moverNudo del mismo nudo = un paso de undo", () => {
  beforeEach(() => {
    modeloStore.getState().cargarModelo(modeloConNudo());
  });

  it("varios moverNudo del mismo nudo se deshacen de una vez", () => {
    const m = () => modeloStore.getState().getModelo();
    modeloStore.getState().ejecutar(moverNudo(m(), "n1", 1, 1));
    modeloStore.getState().ejecutar(moverNudo(m(), "n1", 2, 2));
    modeloStore.getState().ejecutar(moverNudo(m(), "n1", 3, 3));
    expect(modeloStore.getState().modelo.nudos[0]).toMatchObject({ x: 3, y: 3 });

    modeloStore.getState().deshacer();
    expect(modeloStore.getState().modelo.nudos[0]).toMatchObject({ x: 0, y: 0 });
    // No quedan mas pasos de esa rafaga.
    expect(modeloStore.getState().puedeDeshacer).toBe(false);
  });
});

// --- 4 · Invalidacion de resultados ------------------------------------------

describe("Invalidacion: editar Capa 1 marca no vigente PERO conserva resultados (D5)", () => {
  it("ejecutar un comando pone vigente=false pero conserva los resultados", () => {
    resultadosStore.getState().setResultados(resultadosMinimos(), modeloFEMMinimo(), trazabilidadMinima());
    expect(resultadosStore.getState().vigente).toBe(true);
    expect(resultadosStore.getState().resultados).not.toBeNull();

    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(cmd);

    // Enmienda spec: la deformada obsoleta sigue disponible (F14 la pinta en gris).
    expect(resultadosStore.getState().vigente).toBe(false);
    expect(resultadosStore.getState().resultados).not.toBeNull();
  });

  it("deshacer y rehacer tambien bajan la bandera (conservando resultados)", () => {
    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(cmd);

    resultadosStore.getState().setResultados(resultadosMinimos(), modeloFEMMinimo(), trazabilidadMinima());
    modeloStore.getState().deshacer();
    expect(resultadosStore.getState().vigente).toBe(false);
    expect(resultadosStore.getState().resultados).not.toBeNull();

    resultadosStore.getState().setResultados(resultadosMinimos(), modeloFEMMinimo(), trazabilidadMinima());
    modeloStore.getState().rehacer();
    expect(resultadosStore.getState().vigente).toBe(false);
    expect(resultadosStore.getState().resultados).not.toBeNull();
  });

  it("cargarModelo DESCARTA los resultados del todo (reset al cambiar de obra)", () => {
    resultadosStore.getState().setResultados(resultadosMinimos(), modeloFEMMinimo(), trazabilidadMinima());
    modeloStore.getState().cargarModelo(crearModeloVacio());
    expect(resultadosStore.getState().vigente).toBe(false);
    expect(resultadosStore.getState().resultados).toBeNull();
  });
});

// --- 5 · subscribeWithSelector -----------------------------------------------

describe("subscribeWithSelector: dispara solo al cambiar el slice observado", () => {
  it("modeloStore.subscribe(selector, cb) reacciona al cambiar el modelo", () => {
    const cb = vi.fn();
    const unsub = modeloStore.subscribe((s) => s.modelo.pilares.length, cb);

    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(cmd);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(1, 0);
    unsub();
  });

  it("seleccionStore: el selector de hover NO dispara al cambiar la seleccion", () => {
    const cbHover = vi.fn();
    const unsub = seleccionStore.subscribe((s) => s.hoverId, cbHover);

    // Cambiar otro slice (seleccion) no debe disparar el cb de hover.
    seleccionStore.getState().seleccionar(["a"]);
    expect(cbHover).not.toHaveBeenCalled();

    // Cambiar el slice observado si dispara.
    seleccionStore.getState().setHover("x");
    expect(cbHover).toHaveBeenCalledTimes(1);
    expect(cbHover).toHaveBeenCalledWith("x", null);
    unsub();
  });

  it("vistaStore: selector de pestana ignora cambios de modoVista", () => {
    const cb = vi.fn();
    const unsub = vistaStore.subscribe((s) => s.pestanaActiva, cb);

    vistaStore.getState().setModoVista("3d");
    expect(cb).not.toHaveBeenCalled();

    vistaStore.getState().setPestanaActiva("resultados");
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });
});

// --- Cobertura breve: seleccionStore -----------------------------------------

describe("seleccionStore: acciones", () => {
  it("seleccionar reemplaza la seleccion", () => {
    seleccionStore.getState().seleccionar(["a", "b"]);
    expect(seleccionStore.getState().seleccion).toEqual(["a", "b"]);
  });

  it("alternar anade y quita un id", () => {
    seleccionStore.getState().alternar("a");
    expect(seleccionStore.getState().seleccion).toEqual(["a"]);
    seleccionStore.getState().alternar("b");
    expect(seleccionStore.getState().seleccion).toEqual(["a", "b"]);
    seleccionStore.getState().alternar("a");
    expect(seleccionStore.getState().seleccion).toEqual(["b"]);
  });

  it("limpiar vacia la seleccion (no toca hover)", () => {
    seleccionStore.getState().seleccionar(["a"]);
    seleccionStore.getState().setHover("h");
    seleccionStore.getState().limpiar();
    expect(seleccionStore.getState().seleccion).toEqual([]);
    expect(seleccionStore.getState().hoverId).toBe("h");
  });

  it("setHover fija y borra el hover", () => {
    seleccionStore.getState().setHover("h");
    expect(seleccionStore.getState().hoverId).toBe("h");
    seleccionStore.getState().setHover(null);
    expect(seleccionStore.getState().hoverId).toBeNull();
  });
});

// --- Cobertura breve: vistaStore ---------------------------------------------

describe("vistaStore: setters", () => {
  it("cambia pestana, modo de vista, grupo, planta y combinacion", () => {
    vistaStore.getState().setPestanaActiva("isovalores");
    vistaStore.getState().setModoVista("mosaico");
    vistaStore.getState().setGrupoActivo("g1");
    vistaStore.getState().setPlantaActiva("p1");
    vistaStore.getState().setCombinacionActiva("ELU");

    const s = vistaStore.getState();
    expect(s.pestanaActiva).toBe("isovalores");
    expect(s.modoVista).toBe("mosaico");
    expect(s.grupoActivoId).toBe("g1");
    expect(s.plantaActivaId).toBe("p1");
    expect(s.combinacionActiva).toBe("ELU");
  });
});

// --- feature-11 · herramienta activa + defaults de pilar ----------------------

describe("vistaStore: introduccion grafica de pilares (feature-11)", () => {
  // Reset de los campos nuevos (los beforeEach globales no los tocan).
  beforeEach(() => {
    vistaStore.getState().setHerramienta("seleccion");
    vistaStore.getState().setSnapActivo(true);
    vistaStore.getState().setDefaultsPilar({
      seccionId: null,
      materialId: null,
      arranque: "empotrado",
      vinculacionExterior: true,
      angulo: 0,
    });
  });

  it("valores iniciales coinciden con el contrato", () => {
    const s = vistaStore.getState();
    expect(s.herramienta).toBe("seleccion");
    expect(s.snapActivo).toBe(true);
    expect(s.defaultsPilar).toEqual({
      seccionId: null,
      materialId: null,
      arranque: "empotrado",
      vinculacionExterior: true,
      angulo: 0,
    });
  });

  it("setHerramienta y setSnapActivo cambian el estado", () => {
    vistaStore.getState().setHerramienta("pilar");
    expect(vistaStore.getState().herramienta).toBe("pilar");

    vistaStore.getState().setSnapActivo(false);
    expect(vistaStore.getState().snapActivo).toBe(false);
  });

  it("setDefaultsPilar hace merge parcial sin borrar los demas campos", () => {
    vistaStore.getState().setDefaultsPilar({ seccionId: "s1", arranque: "articulado" });

    const s = vistaStore.getState();
    expect(s.defaultsPilar).toEqual({
      seccionId: "s1",
      materialId: null,
      arranque: "articulado",
      vinculacionExterior: true,
      angulo: 0,
    });
  });

  it("el selector de herramienta ignora cambios de snapActivo (subscribeWithSelector)", () => {
    const cb = vi.fn();
    const unsub = vistaStore.subscribe((s) => s.herramienta, cb);

    vistaStore.getState().setSnapActivo(false);
    expect(cb).not.toHaveBeenCalled();

    vistaStore.getState().setHerramienta("pilar");
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith("pilar", "seleccion");
    unsub();
  });
});

// --- feature-12 · herramienta "viga" + defaults de viga -----------------------

describe("vistaStore: introduccion grafica de vigas (feature-12)", () => {
  // Reset de los campos nuevos (los beforeEach globales no los tocan).
  beforeEach(() => {
    vistaStore.getState().setHerramienta("seleccion");
    vistaStore.getState().setDefaultsViga({
      seccionId: null,
      materialId: null,
      extremoI: "empotrado",
      extremoJ: "empotrado",
      tirante: false,
    });
  });

  it("valor inicial de defaultsViga coincide con el contrato", () => {
    expect(vistaStore.getState().defaultsViga).toEqual({
      seccionId: null,
      materialId: null,
      extremoI: "empotrado",
      extremoJ: "empotrado",
      tirante: false,
    });
  });

  it('la herramienta admite el modo "viga"', () => {
    vistaStore.getState().setHerramienta("viga");
    expect(vistaStore.getState().herramienta).toBe("viga");
  });

  it("setDefaultsViga hace merge parcial sin borrar los demas campos", () => {
    vistaStore
      .getState()
      .setDefaultsViga({ seccionId: "s1", extremoJ: "articulado", tirante: true });

    const s = vistaStore.getState();
    expect(s.defaultsViga).toEqual({
      seccionId: "s1",
      materialId: null,
      extremoI: "empotrado",
      extremoJ: "articulado",
      tirante: true,
    });
  });
});

// --- feature-13 · diálogo de hipótesis + defaults de carga --------------------

describe("vistaStore: andamiaje de cargas/hipótesis (feature-13)", () => {
  // Reset de los campos nuevos (los beforeEach globales no los tocan).
  beforeEach(() => {
    vistaStore.getState().cerrarDialogo();
    vistaStore.getState().setDefaultsCarga({
      tipo: "lineal",
      valor: 0,
      hipotesisId: null,
    });
  });

  it("valor inicial de defaultsCarga coincide con el contrato", () => {
    expect(vistaStore.getState().defaultsCarga).toEqual({
      tipo: "lineal",
      valor: 0,
      hipotesisId: null,
    });
  });

  it('abrirDialogo admite el diálogo "hipotesis"', () => {
    vistaStore.getState().abrirDialogo("hipotesis");
    expect(vistaStore.getState().dialogoActivo).toBe("hipotesis");
    vistaStore.getState().cerrarDialogo();
    expect(vistaStore.getState().dialogoActivo).toBeNull();
  });

  it("setDefaultsCarga hace merge parcial sin borrar los demas campos", () => {
    vistaStore.getState().setDefaultsCarga({ valor: 5, hipotesisId: "h1" });

    const s = vistaStore.getState();
    expect(s.defaultsCarga).toEqual({
      tipo: "lineal",
      valor: 5,
      hipotesisId: "h1",
    });
  });
});

// --- feature-14 · controles de visualizacion de resultados --------------------

describe("vistaStore: visualizacion de resultados (feature-14)", () => {
  // Reset de los campos nuevos a su valor por defecto (los beforeEach globales no
  // los tocan): escala 1, sin animar, magnitud "momento".
  beforeEach(() => {
    vistaStore.getState().setDeformadaEscala(1);
    vistaStore.getState().setAnimando(false);
    vistaStore.getState().setMagnitudDiagrama("momento");
  });

  it("valores iniciales por defecto del bloque de resultados", () => {
    const s = vistaStore.getState();
    expect(s.deformadaEscala).toBe(1);
    expect(s.animando).toBe(false);
    expect(s.magnitudDiagrama).toBe("momento");
  });

  it("setDeformadaEscala / setAnimando / setMagnitudDiagrama cambian su campo", () => {
    vistaStore.getState().setDeformadaEscala(250);
    vistaStore.getState().setAnimando(true);
    vistaStore.getState().setMagnitudDiagrama("flecha");

    const s = vistaStore.getState();
    expect(s.deformadaEscala).toBe(250);
    expect(s.animando).toBe(true);
    expect(s.magnitudDiagrama).toBe("flecha");
  });

  it("el selector de escala ignora cambios de magnitud (subscribeWithSelector)", () => {
    const cb = vi.fn();
    const unsub = vistaStore.subscribe((s) => s.deformadaEscala, cb);

    vistaStore.getState().setMagnitudDiagrama("cortante");
    expect(cb).not.toHaveBeenCalled();

    vistaStore.getState().setDeformadaEscala(2);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(2, 1);
    unsub();
  });
});

// --- feature-14 · resultadosStore: trio + vigente/limpiar/descartar -----------

describe("resultadosStore: trio de calculo + semantica vigente/limpiar/descartar", () => {
  it("setResultados guarda los TRES (resultados, modeloFEM, trazabilidad) y vigente=true", () => {
    const r = resultadosMinimos();
    const fem = modeloFEMMinimo();
    const traza = trazabilidadMinima();
    resultadosStore.getState().setResultados(r, fem, traza);

    const s = resultadosStore.getState();
    expect(s.resultados).toBe(r);
    expect(s.modeloFEM).toBe(fem);
    expect(s.trazabilidad).toBe(traza);
    expect(s.vigente).toBe(true);
  });

  it("limpiar baja la bandera vigente PERO conserva el trio (deformada obsoleta)", () => {
    resultadosStore
      .getState()
      .setResultados(resultadosMinimos(), modeloFEMMinimo(), trazabilidadMinima());
    resultadosStore.getState().limpiar();

    const s = resultadosStore.getState();
    expect(s.vigente).toBe(false);
    // El trio sigue disponible: F14 pinta la deformada en gris con aviso.
    expect(s.resultados).not.toBeNull();
    expect(s.modeloFEM).not.toBeNull();
    expect(s.trazabilidad).not.toBeNull();
  });

  it("descartar resetea el trio entero a null (cambio de obra)", () => {
    resultadosStore
      .getState()
      .setResultados(resultadosMinimos(), modeloFEMMinimo(), trazabilidadMinima());
    resultadosStore.getState().descartar();

    const s = resultadosStore.getState();
    expect(s.vigente).toBe(false);
    expect(s.resultados).toBeNull();
    expect(s.modeloFEM).toBeNull();
    expect(s.trazabilidad).toBeNull();
  });
});

// --- feature-15 · plantillas DXF en vistaStore --------------------------------

// Plantilla minima valida (geometria vacia: el store no inspecciona entidades).
// `id` parametrizable para cubrir varias en lista; el resto son valores neutros.
function plantillaMinima(id: string): Plantilla {
  return {
    id,
    nombre: id,
    nombreArchivo: `${id}.dxf`,
    plantaId: "p1",
    entidades: [],
    transform: { x: 0, y: 0, escala: 1, rotacion: 0, opacidad: 0.5 },
    visible: true,
    bloqueado: false,
    creadaEn: 0,
  };
}

describe("vistaStore: plantillas DXF (feature-15)", () => {
  // Reset de los campos nuevos (los beforeEach globales no los tocan).
  beforeEach(() => {
    vistaStore.getState().setPlantillas([]);
    vistaStore.getState().setPlantillaActiva(null);
  });

  it("valores iniciales: lista vacia y sin plantilla activa", () => {
    const s = vistaStore.getState();
    expect(s.plantillas).toEqual([]);
    expect(s.plantillaActivaId).toBeNull();
  });

  it("setPlantillas reemplaza la lista; addPlantilla hace append", () => {
    vistaStore.getState().setPlantillas([plantillaMinima("a")]);
    expect(vistaStore.getState().plantillas.map((p) => p.id)).toEqual(["a"]);

    vistaStore.getState().addPlantilla(plantillaMinima("b"));
    expect(vistaStore.getState().plantillas.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("quitarPlantilla filtra por id", () => {
    vistaStore
      .getState()
      .setPlantillas([plantillaMinima("a"), plantillaMinima("b")]);
    vistaStore.getState().quitarPlantilla("a");
    expect(vistaStore.getState().plantillas.map((p) => p.id)).toEqual(["b"]);
  });

  it("quitar la plantilla activa limpia plantillaActivaId", () => {
    vistaStore
      .getState()
      .setPlantillas([plantillaMinima("a"), plantillaMinima("b")]);
    vistaStore.getState().setPlantillaActiva("a");
    vistaStore.getState().quitarPlantilla("a");

    const s = vistaStore.getState();
    expect(s.plantillas.map((p) => p.id)).toEqual(["b"]);
    expect(s.plantillaActivaId).toBeNull();
  });

  it("quitar una plantilla que NO es la activa conserva plantillaActivaId", () => {
    vistaStore
      .getState()
      .setPlantillas([plantillaMinima("a"), plantillaMinima("b")]);
    vistaStore.getState().setPlantillaActiva("b");
    vistaStore.getState().quitarPlantilla("a");
    expect(vistaStore.getState().plantillaActivaId).toBe("b");
  });

  it("actualizarPlantilla hace merge superficial de nivel 1 sobre la plantilla por id", () => {
    vistaStore
      .getState()
      .setPlantillas([plantillaMinima("a"), plantillaMinima("b")]);
    vistaStore.getState().actualizarPlantilla("a", { visible: false });

    const a = vistaStore.getState().plantillas.find((p) => p.id === "a");
    expect(a?.visible).toBe(false);
    // No toca otros campos ni otras plantillas.
    expect(a?.nombre).toBe("a");
    expect(vistaStore.getState().plantillas.find((p) => p.id === "b")?.visible).toBe(
      true,
    );
  });

  it("actualizarPlantilla con parche.transform PARCIAL mergea transform (no lo reemplaza)", () => {
    vistaStore.getState().setPlantillas([plantillaMinima("a")]);
    // La UI manda solo { transform: { escala } }: x/y/rotacion/opacidad se conservan.
    vistaStore.getState().actualizarPlantilla("a", { transform: { escala: 2 } });

    const t = vistaStore.getState().plantillas.find((p) => p.id === "a")?.transform;
    expect(t).toEqual({ x: 0, y: 0, escala: 2, rotacion: 0, opacidad: 0.5 });
  });

  it("setPlantillaActiva fija y borra el id activo", () => {
    vistaStore.getState().setPlantillaActiva("a");
    expect(vistaStore.getState().plantillaActivaId).toBe("a");
    vistaStore.getState().setPlantillaActiva(null);
    expect(vistaStore.getState().plantillaActivaId).toBeNull();
  });
});

// --- D2 · siguienteNombre / crearPilar tras borrados --------------------------

describe("siguienteNombre: deriva del mayor numero en uso, no del recuento", () => {
  // Helper: pilar minimo con solo el nombre relevante para el calculo de nombre.
  const conNombre = (nombre: string): Pilar => ({ ...datosPilar, id: nombre, nombre });

  it("modelo vacio => P1", () => {
    expect(siguienteNombre("P", [])).toBe("P1");
  });

  it("['P1','P3'] => P4 (max+1; deja el hueco P2, es correcto)", () => {
    expect(siguienteNombre("P", [conNombre("P1"), conNombre("P3")])).toBe("P4");
  });

  it("tras borrar P2 (quedan P1,P3) el siguiente NO es P3 (no colisiona)", () => {
    const next = siguienteNombre("P", [conNombre("P1"), conNombre("P3")]);
    expect(next).not.toBe("P3");
    expect(next).toBe("P4");
  });

  it("nombres sin sufijo numerico cuentan como 0", () => {
    expect(siguienteNombre("P", [conNombre("P")])).toBe("P1");
  });

  it("crearPilar sobre modelo vacio asigna P1", () => {
    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    modeloStore.getState().ejecutar(cmd);
    expect(modeloStore.getState().modelo.pilares[0].nombre).toBe("P1");
  });
});

// --- D4 · Guard del invariante de base ----------------------------------------

describe("ejecutar: guard de dev del invariante de base", () => {
  it("lanza si el comando se construyo sobre un modelo distinto al actual", () => {
    // Comando construido sobre el modelo vacio inicial.
    const obsoleto = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    // Otra edicion cambia el modelo del store (el base de `obsoleto` queda viejo).
    modeloStore
      .getState()
      .ejecutar(crearPilar(modeloStore.getState().getModelo(), datosPilar));
    // Vitest corre con DEV=true: el guard esta activo y detecta el desajuste.
    expect(() => modeloStore.getState().ejecutar(obsoleto)).toThrow(
      /modelo distinto al actual/,
    );
  });

  it("no lanza si el comando se despacha de inmediato (base == modelo actual)", () => {
    const cmd = crearPilar(modeloStore.getState().getModelo(), datosPilar);
    expect(() => modeloStore.getState().ejecutar(cmd)).not.toThrow();
  });
});
