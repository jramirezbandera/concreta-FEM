// Comandos concretos de edicion de la Capa 1, construidos con crearComandoParches
// + nuevoId(). Esta es la MUESTRA MINIMA (crear pilar, mover nudo): el resto de
// comandos por pestana llegan en feature-10..13. Cada funcion devuelve un Comando
// listo para modeloStore.ejecutar(). Reciben el `base` (modelo actual) para
// calcular el delta; el store es quien lo aplica.
import type { Modelo, Pilar, Grupo, Planta } from "../../dominio";
import { crearComandoParches } from "./comando";
import type { Comando } from "./comando";
import { nuevoId } from "../ids";

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
  borrador.cargas = borrador.cargas.filter(
    (c) =>
      !plantaIds.has(c.ambito) &&
      !pilaresFuera.has(c.ambito) &&
      !vigasFuera.has(c.ambito),
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
