// Comandos concretos de edicion de la Capa 1, construidos con crearComandoParches
// + nuevoId(). Esta es la MUESTRA MINIMA (crear pilar, mover nudo): el resto de
// comandos por pestana llegan en feature-10..13. Cada funcion devuelve un Comando
// listo para modeloStore.ejecutar(). Reciben el `base` (modelo actual) para
// calcular el delta; el store es quien lo aplica.
import type {
  Modelo,
  Pilar,
  Viga,
  Nudo,
  Pano,
  Grupo,
  Planta,
  Carga,
  Hipotesis,
  OpcionesAnalisis,
} from "../../dominio";
import { crearComandoParches } from "./comando";
import type { Comando } from "./comando";
import { nuevoId } from "../ids";
import { TOL_NODO } from "../../discretizador/discretizar";
import { esHipotesisAutomatica } from "../../dominio";

// Datos del pilar que aporta el llamante: todo Pilar salvo id (interno, lo genera
// el comando) y nombre (visible CYPECAD "P{n}", derivado del nº de pilares).
export type DatosPilar = Omit<Pilar, "id" | "nombre">;

// Deriva el siguiente nombre visible "{prefijo}{n}" del numero MAYOR en uso, no del
// recuento: tras borrar un pilar intermedio el recuento colisionaria (CLAUDE.md §5).
// Pilares sin sufijo numerico cuentan como 0. Punto de reuso para F10-13.
export function siguienteNombre(
  prefijo: string,
  existentes: { nombre: string }[],
): string {
  let maxSufijo = 0;
  for (const { nombre } of existentes) {
    if (!nombre.startsWith(prefijo)) continue;
    const m = /(\d+)$/.exec(nombre);
    const sufijo = m ? Number(m[1]) : 0;
    if (sufijo > maxSufijo) maxSufijo = sufijo;
  }
  return `${prefijo}${maxSufijo + 1}`;
}

export function crearPilar(base: Modelo, datos: DatosPilar): Comando {
  // id opaco fijado AQUI (se reutiliza en redo via el delta); nombre visible
  // derivado del mayor numero en uso (no del recuento). No es el id (CLAUDE.md §5).
  const id = nuevoId();
  const nombre = siguienteNombre("P", base.pilares);
  const pilar: Pilar = { id, nombre, ...datos };

  const { comando } = crearComandoParches(
    base,
    `Crear pilar ${nombre}`,
    (borrador) => {
      borrador.pilares.push(pilar);
    },
  );
  return comando;
}

// Edita propiedades de un pilar (merge superficial de `cambios`). No toca id ni
// nombre (visible, lo gestiona el sistema). Pilar inexistente => no-op, igual que
// editarGrupo/editarPlanta. El delta solo recoge los campos que cambian.
export function editarPilar(
  base: Modelo,
  pilarId: string,
  cambios: Partial<Omit<Pilar, "id" | "nombre">>,
): Comando {
  const { comando } = crearComandoParches(base, "Editar pilar", (borrador) => {
    const pilar = borrador.pilares.find((p) => p.id === pilarId);
    if (pilar) Object.assign(pilar, cambios);
  });
  return comando;
}

// Elimina un pilar y, en la MISMA receta (un solo paso de undo), purga las cargas
// cuyo ambito apunta a ese pilar (mismo criterio que purgarPlantas filtra por
// ambito). Los NUDOS no se tocan: son geometria compartida e inocua si nadie los
// referencia (el discretizador hace su propio snapping).
export function eliminarPilar(base: Modelo, pilarId: string): Comando {
  const { comando } = crearComandoParches(base, "Eliminar pilar", (borrador) => {
    borrador.pilares = borrador.pilares.filter((p) => p.id !== pilarId);
    borrador.cargas = borrador.cargas.filter((c) => c.ambito !== pilarId);
  });
  return comando;
}

// Mueve un pilar en planta (solo x/y). coalesceKey por pilar: una rafaga de
// arrastre del MISMO pilar se fusiona en un solo paso de undo (igual que
// moverNudo). Distintos pilares => distinta key => no coalescen.
export function moverPilar(
  base: Modelo,
  pilarId: string,
  x: number,
  y: number,
): Comando {
  const { comando } = crearComandoParches(
    base,
    "Mover pilar",
    (borrador) => {
      const pilar = borrador.pilares.find((p) => p.id === pilarId);
      if (pilar) {
        pilar.x = x;
        pilar.y = y;
      }
    },
    `moverPilar:${pilarId}`,
  );
  return comando;
}

// --- Vigas (feature-12, entrada de vigas) ------------------------------------

// Datos de la viga que aporta el llamante: todo Viga salvo id (interno) y nombre
// (visible "V{n}"), y con los extremos dados como ExtremoViga (nudo existente o
// coordenadas a resolver) en vez de los ids nudoI/nudoJ ya resueltos.
export type DatosViga = {
  plantaId: string;
  i: ExtremoViga;
  j: ExtremoViga;
  seccionId: string;
  materialId: string;
  extremoI: "empotrado" | "articulado";
  extremoJ: "empotrado" | "articulado";
  tirante: boolean;
};

// Extremo de viga: o un nudo ya existente (por id) o un punto en planta (x,y) que
// el comando resolvera reusando un nudo cercano o creando uno nuevo. Permite que el
// llamante (introduccion grafica) trabaje en coordenadas sin gestionar nudos.
export type ExtremoViga = { nudoId: string } | { x: number; y: number };

// Resuelve un extremo a un id de nudo SOBRE el borrador Immer (misma receta que la
// viga => un solo paso de undo). Si viene como {nudoId} se usa tal cual. Si viene
// como {x,y}: se reusa el primer nudo a distancia euclidea < TOL_NODO (la misma
// tolerancia de snapping del discretizador, importada para no divergir); si no hay
// ninguno, se hace push de un Nudo nuevo. Los nudos recien creados en esta misma
// receta ya estan en borrador.nudos, de modo que un segundo extremo en el mismo
// punto reusa el del primero (coherencia I/J sin crear duplicados).
function resolverExtremo(borrador: Modelo, extremo: ExtremoViga): string {
  if ("nudoId" in extremo) return extremo.nudoId;
  const { x, y } = extremo;
  const existente = borrador.nudos.find(
    (n) => Math.hypot(n.x - x, n.y - y) < TOL_NODO,
  );
  if (existente) return existente.id;
  const nudo: Nudo = { id: nuevoId(), x, y };
  borrador.nudos.push(nudo);
  return nudo.id;
}

export function crearViga(base: Modelo, datos: DatosViga): Comando {
  // id/nombre fijados AQUI (igual que crearPilar): se reutilizan en redo via el
  // delta. nombre visible "V{n}" por el mayor sufijo en uso (no el recuento).
  const id = nuevoId();
  const nombre = siguienteNombre("V", base.vigas);

  // Una sola receta: resolver/crear los nudos de los extremos Y empujar la viga.
  // Asi crear nudos + viga es UN unico paso de undo (deshacer borra ambos).
  const { comando } = crearComandoParches(
    base,
    `Crear viga ${nombre}`,
    (borrador) => {
      const nudoI = resolverExtremo(borrador, datos.i);
      const nudoJ = resolverExtremo(borrador, datos.j);
      const viga: Viga = {
        id,
        nombre,
        plantaId: datos.plantaId,
        nudoI,
        nudoJ,
        seccionId: datos.seccionId,
        materialId: datos.materialId,
        extremoI: datos.extremoI,
        extremoJ: datos.extremoJ,
        tirante: datos.tirante,
      };
      borrador.vigas.push(viga);
    },
  );
  return comando;
}

// Edita propiedades de una viga (merge superficial de `cambios`). No toca id ni
// nombre. Viga inexistente => no-op (espejo de editarPilar). El delta solo recoge
// los campos que cambian.
export function editarViga(
  base: Modelo,
  vigaId: string,
  cambios: Partial<Omit<Viga, "id" | "nombre">>,
): Comando {
  const { comando } = crearComandoParches(base, "Editar viga", (borrador) => {
    const viga = borrador.vigas.find((v) => v.id === vigaId);
    if (viga) Object.assign(viga, cambios);
  });
  return comando;
}

// Fuente UNICA de "¿este nudo lo usa ALGUIEN?" sobre un modelo (o borrador Immer): lo
// referencia una viga (nudoI/nudoJ) o un paño (perimetro). Un Pilar se posiciona por
// x/y y NO referencia nudos, asi que no entra. Centraliza la DEPENDENCIA INVERSA de
// nudos para que eliminarViga y eliminarPano no borren un nudo que el otro tipo usa
// (la guarda eliminarViga<->paño que F3 exige): un solo sitio que enumere los duenos.
function nudoEnUso(modelo: Modelo, nudoId: string): boolean {
  for (const v of modelo.vigas) {
    if (v.nudoI === nudoId || v.nudoJ === nudoId) return true;
  }
  for (const p of modelo.panos) {
    if (p.perimetro.includes(nudoId)) return true;
  }
  return false;
}

// Elimina una viga y, en la MISMA receta (un solo paso de undo), purga las cargas
// cuyo ambito apunta a esa viga (espejo de eliminarPilar) Y los nudos que queden
// HUERFANOS (ni una viga ni un PAÑO restante los usa). En este modelo los nudos solo
// nacen de vigas/paños (el Pilar se posiciona por x/y, no referencia nudos), asi que
// un nudo que nadie usa es un "punto suelto" puro: inocuo para el calculo pero ruido
// que se acumula al editar. Se limpia AQUI, en la misma receta (un solo undo restaura
// viga + cargas + nudos). GUARDA eliminarViga<->paño (F3): la dependencia inversa la
// resuelve `nudoEnUso`, que tambien cuenta los nudos del perimetro de los paños, de
// modo que borrar una viga NUNCA orfana un nudo que un paño referencia.
export function eliminarViga(base: Modelo, vigaId: string): Comando {
  const { comando } = crearComandoParches(base, "Eliminar viga", (borrador) => {
    const i = borrador.vigas.findIndex((v) => v.id === vigaId);
    if (i === -1) return; // viga inexistente: no-op (no toca nudos ni cargas)
    borrador.vigas.splice(i, 1);
    borrador.cargas = borrador.cargas.filter((c) => c.ambito !== vigaId);
    borrador.nudos = borrador.nudos.filter((n) => nudoEnUso(borrador, n.id));
  });
  return comando;
}

// --- Paños losa (F3 corte 1, entrada de losa maciza) -------------------------

// Datos del paño que aporta el llamante: todo Pano salvo id (interno) y nombre
// (visible "F{n}", forjado), y con el perimetro dado como puntos (x,y) a resolver en
// nudos PROPIOS en vez de ids ya resueltos. Espejo de DatosViga: la introduccion
// grafica trabaja en coordenadas; el comando crea los nudos. UNIDADES internas en m.
export type DatosPano = {
  tipo: Pano["tipo"];
  plantaId: string;
  // Perimetro del paño como puntos en planta (m). Corte 1: 4 esquinas (rectangulo).
  perimetro: { x: number; y: number }[];
  espesor: number; // m
  materialId: string;
  tamMalla: number; // m
  bordeApoyo: Pano["bordeApoyo"];
};

// Resuelve un punto del perimetro a un id de nudo SOBRE el borrador Immer (misma receta
// que el paño => un solo paso de undo). Espejo de resolverExtremo de vigas: reusa un
// nudo a <TOL_NODO o crea uno nuevo. Aunque corte 1 es AISLADO (la malla no comparte
// con el portico), el paño SI tiene nudos propios de OBRA en sus esquinas y dos esquinas
// que cayeran en el mismo punto deben compartir nudo (coherencia: nunca dos nudos a la
// misma posicion en una misma receta).
function resolverPuntoPerimetro(borrador: Modelo, punto: { x: number; y: number }): string {
  const { x, y } = punto;
  const existente = borrador.nudos.find(
    (n) => Math.hypot(n.x - x, n.y - y) < TOL_NODO,
  );
  if (existente) return existente.id;
  const nudo: Nudo = { id: nuevoId(), x, y };
  borrador.nudos.push(nudo);
  return nudo.id;
}

export function crearPano(base: Modelo, datos: DatosPano): Comando {
  // id/nombre fijados AQUI (se reutilizan en redo via el delta). Nombre visible "F{n}"
  // (forjado, estilo CYPECAD) por el mayor sufijo en uso (no el recuento).
  const id = nuevoId();
  const nombre = siguienteNombre("F", base.panos);

  // Una sola receta: resolver/crear los nudos del perimetro Y empujar el paño. Asi
  // crear nudos + paño es UN unico paso de undo (deshacer borra ambos).
  const { comando } = crearComandoParches(
    base,
    `Crear paño ${nombre}`,
    (borrador) => {
      const perimetro = datos.perimetro.map((p) =>
        resolverPuntoPerimetro(borrador, p),
      );
      const pano: Pano = {
        id,
        nombre,
        tipo: datos.tipo,
        plantaId: datos.plantaId,
        perimetro,
        espesor: datos.espesor,
        materialId: datos.materialId,
        tamMalla: datos.tamMalla,
        bordeApoyo: datos.bordeApoyo,
      };
      borrador.panos.push(pano);
    },
  );
  return comando;
}

// Edita propiedades de un paño (merge superficial de `cambios`). No toca id, nombre ni
// perimetro (la geometria la fija la introduccion grafica, no el inspector, espejo de
// editarViga). Paño inexistente => no-op. El delta solo recoge los campos que cambian.
export function editarPano(
  base: Modelo,
  panoId: string,
  cambios: Partial<Omit<Pano, "id" | "nombre" | "perimetro">>,
): Comando {
  const { comando } = crearComandoParches(base, "Editar paño", (borrador) => {
    const pano = borrador.panos.find((p) => p.id === panoId);
    if (pano) Object.assign(pano, cambios);
  });
  return comando;
}

// Elimina un paño y, en la MISMA receta (un solo paso de undo), purga las cargas cuyo
// ambito apunta a ese paño (cargas superficiales) Y los nudos del perimetro que queden
// HUERFANOS (ninguna viga ni otro paño restante los usa). Espejo de eliminarViga: los
// nudos compartidos (con una viga, o con otro paño) se conservan; solo se borran los
// puntos sueltos que solo este paño usaba.
export function eliminarPano(base: Modelo, panoId: string): Comando {
  const { comando } = crearComandoParches(base, "Eliminar paño", (borrador) => {
    const i = borrador.panos.findIndex((p) => p.id === panoId);
    if (i === -1) return; // paño inexistente: no-op (no toca nudos ni cargas)
    borrador.panos.splice(i, 1);
    borrador.cargas = borrador.cargas.filter((c) => c.ambito !== panoId);
    // Nudos que siguen en uso por ALGUNA viga o paño superviviente. Solo se purgan los
    // que ya no usa nadie (espejo de eliminarViga, ahora con dependencia de paño).
    borrador.nudos = borrador.nudos.filter((n) =>
      nudoEnUso(borrador, n.id),
    );
  });
  return comando;
}

// --- Cargas e Hipotesis (feature-13, cargas/hipotesis/combinaciones) ---------

// Datos de la carga que aporta el llamante: todo Carga salvo id (interno, lo
// genera el comando). La carga referencia su hipotesis (hipotesisId) y su ambito
// (id del elemento sobre el que actua); la integridad la garantiza el llamante.
export type DatosCarga = Omit<Carga, "id">;

export function crearCarga(base: Modelo, datos: DatosCarga): Comando {
  // id opaco fijado AQUI (se reutiliza en redo via el delta). Las cargas no tienen
  // nombre visible: se listan por su ambito/hipotesis, no por un identificador.
  const id = nuevoId();
  const carga: Carga = { id, ...datos };

  const { comando } = crearComandoParches(base, "Crear carga", (borrador) => {
    // E2(b): una carga de usuario NUNCA puede vivir en una hipotesis AUTOMATICA (seria
    // doble cómputo: el discretizador ya genera ese peso). No-op seguro, mismo patron
    // que editar/eliminar inexistente. La UI no la ofrece, pero el comando lo blinda;
    // el discretizador y el import (.json) tienen su propia red. Se identifica la
    // automatica por su FLAG (predicado sobre la hipotesis destino), no por el id.
    const destino = borrador.hipotesis.find((h) => h.id === carga.hipotesisId);
    if (destino !== undefined && esHipotesisAutomatica(destino)) return;
    borrador.cargas.push(carga);
  });
  return comando;
}

// Edita propiedades de una carga (merge superficial de `cambios`). No toca id.
// Carga inexistente => no-op (espejo de editarPilar/editarViga). El delta solo
// recoge los campos que cambian.
export function editarCarga(
  base: Modelo,
  cargaId: string,
  cambios: Partial<Omit<Carga, "id">>,
): Comando {
  const { comando } = crearComandoParches(base, "Editar carga", (borrador) => {
    const carga = borrador.cargas.find((c) => c.id === cargaId);
    if (!carga) return;
    // E2(b): no permitir reasignar una carga a una hipotesis AUTOMATICA (peso propio).
    // Si `cambios` intenta apuntar ahi, se descarta SOLO ese campo (`hipotesisId`) y
    // se aplica el resto del lote (valor/tipo): un edit batcheado no pierde su valor
    // por venir con una reasignacion invalida. La automatica se identifica por su FLAG
    // (predicado sobre la hipotesis destino), no por el id. Si tras quitarlo no queda
    // ningun cambio, no-op seguro.
    let efectivos = cambios;
    if (cambios.hipotesisId !== undefined) {
      const destino = borrador.hipotesis.find((h) => h.id === cambios.hipotesisId);
      if (destino !== undefined && esHipotesisAutomatica(destino)) {
        const resto = { ...cambios };
        delete resto.hipotesisId;
        efectivos = resto;
      }
    }
    if (Object.keys(efectivos).length === 0) return;
    Object.assign(carga, efectivos);
  });
  return comando;
}

export function eliminarCarga(base: Modelo, cargaId: string): Comando {
  const { comando } = crearComandoParches(base, "Eliminar carga", (borrador) => {
    borrador.cargas = borrador.cargas.filter((c) => c.id !== cargaId);
  });
  return comando;
}

// Datos de la hipotesis que aporta el llamante: todo Hipotesis salvo id (interno) y
// `automatica` (una hipotesis creada por el usuario NUNCA es automatica: solo el
// sistema siembra la automatica `hip-peso-propio`). El nombre puede venir vacio: en
// ese caso se deriva "Hipotesis {n}" del mayor sufijo en uso (mismo criterio que
// grupos/pilares); si viene con nombre, se respeta.
export type DatosHipotesis = Omit<Hipotesis, "id" | "automatica">;

export function crearHipotesis(base: Modelo, datos: DatosHipotesis): Comando {
  const id = nuevoId();
  // Nombre vacio => derivamos "Hipotesis {n}" por el mayor sufijo en uso (no el
  // recuento), igual que crearGrupo/crearPilar. Con nombre dado, se respeta.
  const nombre = datos.nombre.trim()
    ? datos.nombre
    : siguienteNombre("Hipotesis ", base.hipotesis);
  // automatica:false SIEMPRE: el usuario no puede crear una hipotesis automatica.
  const hipotesis: Hipotesis = { ...datos, id, nombre, automatica: false };

  const { comando } = crearComandoParches(
    base,
    `Crear hipotesis ${nombre}`,
    (borrador) => {
      borrador.hipotesis.push(hipotesis);
    },
  );
  return comando;
}

// Edita propiedades de una hipotesis (merge superficial de `cambios`). No toca id.
// Hipotesis inexistente => no-op. El delta solo recoge los campos que cambian.
//
// INVARIANTE DE DOMINIO (F2a): la hipotesis AUTOMATICA (`automatica:true`, peso
// propio) no se edita: sus datos los define el sistema. Si el id apunta a una
// automatica, no-op seguro (mismo patron que editar inexistente). Ademas `automatica`
// nunca se cambia desde aqui (no esta en los `cambios` aceptados por la UI; si
// llegara por otra via, se respeta el del modelo).
export function editarHipotesis(
  base: Modelo,
  hipotesisId: string,
  cambios: Partial<Omit<Hipotesis, "id" | "automatica">>,
): Comando {
  const { comando } = crearComandoParches(
    base,
    "Editar hipotesis",
    (borrador) => {
      const hipotesis = borrador.hipotesis.find((h) => h.id === hipotesisId);
      if (!hipotesis) return;
      if (esHipotesisAutomatica(hipotesis)) return; // invariante: la automatica no se edita
      Object.assign(hipotesis, cambios);
    },
  );
  return comando;
}

// Elimina una hipotesis y, en la MISMA receta (un solo paso de undo), purga las
// cargas que la referencian (hipotesisId). Espejo de como eliminarPilar/eliminarViga
// purgan cargas por ambito: sin esto quedarian cargas huerfanas que reventarian
// aguas abajo en el discretizador.
//
// INVARIANTE DE DOMINIO (F2a, regresion critica): la hipotesis AUTOMATICA de peso
// propio NO se elimina (la genera el sistema; borrarla con el flag activo dejaria el
// modelo desincronizado, que E1 bloquearia). Si el id apunta a una automatica, no-op
// seguro: no se toca el modelo.
export function eliminarHipotesis(base: Modelo, hipotesisId: string): Comando {
  const { comando } = crearComandoParches(
    base,
    "Eliminar hipotesis",
    (borrador) => {
      const hipotesis = borrador.hipotesis.find((h) => h.id === hipotesisId);
      if (!hipotesis || esHipotesisAutomatica(hipotesis)) return; // invariante: no borrar la automatica
      borrador.hipotesis = borrador.hipotesis.filter(
        (h) => h.id !== hipotesisId,
      );
      borrador.cargas = borrador.cargas.filter(
        (c) => c.hipotesisId !== hipotesisId,
      );
    },
  );
  return comando;
}

// --- Opciones de analisis (feature-F2.4, dialogo "Opciones de análisis") -----

// Edita las opciones de analisis de la obra (merge superficial de `cambios`: tipo
// de analisis, comprobarEstatica, incluirPesoPropio). Es estado de OBRA (Capa 1,
// `modelo.analisis`), asi que su edicion es un comando reversible (undo/redo) y,
// como cualquier edicion del modelo, invalida los resultados vigentes (lo hace
// modeloStore.ejecutar via resultadosStore.limpiar). El delta solo recoge los
// campos que cambian; un cambio identico produce parches vacios (no ensucia el undo
// si el llamante ya filtra no-ops, como hace el dialogo).
export function editarAnalisis(
  base: Modelo,
  cambios: Partial<OpcionesAnalisis>,
): Comando {
  const { comando } = crearComandoParches(
    base,
    "Editar opciones de análisis",
    (borrador) => {
      Object.assign(borrador.analisis, cambios);
    },
  );
  return comando;
}

// --- Grupos (feature-10, dialogo de Grupos y Plantas) ------------------------

// Datos del grupo que aporta el llamante: todo Grupo salvo id (interno) y nombre
// (visible "G{n}", derivado del mayor numero en uso).
export type DatosGrupo = Omit<Grupo, "id" | "nombre">;
// Idem para planta: nombre visible "Planta {n}".
export type DatosPlanta = Omit<Planta, "id" | "nombre">;

export function crearGrupo(base: Modelo, datos: DatosGrupo): Comando {
  // id opaco fijado AQUI (se reutiliza en redo via el delta); nombre visible
  // derivado del mayor numero en uso (no del recuento). No es el id (CLAUDE.md §5).
  const id = nuevoId();
  const nombre = siguienteNombre("G", base.grupos);
  const grupo: Grupo = { id, nombre, ...datos };

  const { comando } = crearComandoParches(
    base,
    `Crear grupo ${nombre}`,
    (borrador) => {
      borrador.grupos.push(grupo);
    },
  );
  return comando;
}

export function editarGrupo(
  base: Modelo,
  grupoId: string,
  cambios: Partial<Omit<Grupo, "id">>,
): Comando {
  const { comando } = crearComandoParches(base, "Editar grupo", (borrador) => {
    const grupo = borrador.grupos.find((g) => g.id === grupoId);
    if (grupo) Object.assign(grupo, cambios);
  });
  return comando;
}

// Integridad referencial de Capa 1: borra un conjunto de plantas Y todo lo que las
// referencia, sobre el MISMO borrador Immer (un solo paso de undo). Eliminar una
// planta deja sin sentido los pilares que la tocan (plantaInicial/Final), las vigas
// de esa planta, y las cargas aplicadas sobre la planta o sobre cualquiera de esos
// elementos. Sin esto, F11-13 dejarian referencias huerfanas que reventarian aguas
// abajo en el discretizador (revision de ingenieria F10).
//
// Los NUDOS no se tocan a proposito: son geometria compartida (otras vigas vivas
// pueden usarlos) y un nudo no referenciado es inocuo (nadie apunta mal a el); el
// discretizador hace su propio snapping. Quitar un nudo compartido SI romperia una
// viga superviviente, asi que se dejan.
function purgarPlantas(borrador: Modelo, plantaIds: Set<string>): void {
  const pilaresFuera = new Set<string>();
  borrador.pilares = borrador.pilares.filter((p) => {
    const fuera = plantaIds.has(p.plantaInicial) || plantaIds.has(p.plantaFinal);
    if (fuera) pilaresFuera.add(p.id);
    return !fuera;
  });
  const vigasFuera = new Set<string>();
  borrador.vigas = borrador.vigas.filter((v) => {
    const fuera = plantaIds.has(v.plantaId);
    if (fuera) vigasFuera.add(v.id);
    return !fuera;
  });
  // Paños (F3): un paño pertenece a una planta; eliminar la planta arrastra sus paños
  // (y, abajo, sus cargas superficiales). Mismo criterio que vigas.
  const panosFuera = new Set<string>();
  borrador.panos = borrador.panos.filter((pa) => {
    const fuera = plantaIds.has(pa.plantaId);
    if (fuera) panosFuera.add(pa.id);
    return !fuera;
  });
  borrador.cargas = borrador.cargas.filter(
    (c) =>
      !plantaIds.has(c.ambito) &&
      !pilaresFuera.has(c.ambito) &&
      !vigasFuera.has(c.ambito) &&
      !panosFuera.has(c.ambito),
  );
  borrador.plantas = borrador.plantas.filter((p) => !plantaIds.has(p.id));
}

export function eliminarGrupo(base: Modelo, grupoId: string): Comando {
  // Cascada en UNA sola receta: quitar el grupo, sus plantas y todo lo que cuelga
  // de ellas (pilares/vigas/cargas) en el mismo delta -> un unico paso de undo.
  const { comando } = crearComandoParches(base, "Eliminar grupo", (borrador) => {
    const plantaIds = new Set(
      borrador.plantas.filter((p) => p.grupoId === grupoId).map((p) => p.id),
    );
    borrador.grupos = borrador.grupos.filter((g) => g.id !== grupoId);
    purgarPlantas(borrador, plantaIds);
  });
  return comando;
}

// --- Plantas (feature-10) ----------------------------------------------------

export function crearPlanta(base: Modelo, datos: DatosPlanta): Comando {
  const id = nuevoId();
  // Prefijo con espacio: produce "Planta 1". startsWith("Planta ") casa y el
  // regex /(\d+)$/ extrae el sufijo numerico correctamente.
  const nombre = siguienteNombre("Planta ", base.plantas);
  const planta: Planta = { id, nombre, ...datos };

  const { comando } = crearComandoParches(
    base,
    `Crear planta ${nombre}`,
    (borrador) => {
      borrador.plantas.push(planta);
    },
  );
  return comando;
}

export function editarPlanta(
  base: Modelo,
  plantaId: string,
  cambios: Partial<Omit<Planta, "id">>,
): Comando {
  const { comando } = crearComandoParches(base, "Editar planta", (borrador) => {
    const planta = borrador.plantas.find((p) => p.id === plantaId);
    if (planta) Object.assign(planta, cambios);
  });
  return comando;
}

export function eliminarPlanta(base: Modelo, plantaId: string): Comando {
  // Misma integridad referencial que eliminarGrupo, para una sola planta: arrastra
  // sus pilares/vigas/cargas en el mismo delta (un paso de undo).
  const { comando } = crearComandoParches(base, "Eliminar planta", (borrador) => {
    purgarPlantas(borrador, new Set([plantaId]));
  });
  return comando;
}

export function moverNudo(
  base: Modelo,
  nudoId: string,
  x: number,
  y: number,
): Comando {
  // coalesceKey por nudo: una rafaga de arrastre del MISMO nudo se fusiona en un
  // solo paso de undo (PilaUndo). Distintos nudos => distinta key => no coalescen.
  const { comando } = crearComandoParches(
    base,
    "Mover nudo",
    (borrador) => {
      const nudo = borrador.nudos.find((n) => n.id === nudoId);
      if (nudo) {
        nudo.x = x;
        nudo.y = y;
      }
    },
    `moverNudo:${nudoId}`,
  );
  return comando;
}
