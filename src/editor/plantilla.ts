/**
 * Proyecto nuevo del editor (V2a, §6.1): una planta sobre la cimentación, HA-30 y los casos G (sólo
 * el peso propio, que calcula el programa), CM (las cargas muertas del usuario, con la misma acción)
 * y Q (uso A), para empezar a meter pilares, vigas y losas.
 */
import { VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";

export function proyectoNuevo(nombre?: string): Proyecto {
  return {
    esquema: VERSION_ESQUEMA,
    ...(nombre ? { nombre } : {}),
    modelo: {
      plantas: [
        { id: "N1", altura: null },
        { id: "Cim", altura: 3 },
      ],
      materiales: [{ id: "HA-30", tipo: "hormigon", fck: 30 }],
      secciones: [],
      casos: [
        { id: "G", nombre: "Peso propio", pesoPropio: true, accion: { tipo: "G" } },
        { id: "CM", nombre: "Cargas muertas", accion: { tipo: "G" } },
        { id: "Q", nombre: "Uso", accion: { tipo: "Q", psi: "uso-A" } },
      ],
    },
  };
}
