/**
 * Lo que el gestor de casos explica de cada acción y de cada campo: qué es, qué hace en las
 * combinaciones y qué vale cada opción. Sólo texto; los números (γ y ψ) son los que usa el
 * generador: γ de la tabla 4.1 del DB SE (`GAMMA_G` y `coeficientes` de
 * `src/combinaciones/generador.ts`) y ψ de `src/combinaciones/psi.ts`, leídos de allí.
 */
import type { AccionCaso } from "../../../src/compilador/fisico.ts";
import { psiDe, type PsiNombrado } from "../../../src/combinaciones/psi.ts";

export type TipoAccion = AccionCaso["tipo"];

export interface InfoAccion {
  nombre: string;
  /** En pocas palabras, para la lista de opciones. */
  breve: string;
  /** Qué es, con ejemplos. */
  que: string;
  /** Cómo entra en las combinaciones CTE/NCSE. */
  combinaciones: string;
  /** Las columnas de la tabla Casos que pide, además de las comunes. */
  campos: readonly string[];
}

export const ACCIONES: Record<TipoAccion, InfoAccion> = {
  G: {
    nombre: "Permanente",
    breve: "peso, solados, tabiques, empujes",
    que: "Actúa siempre con el mismo valor: el peso de la estructura, solados, tabiques, cerramientos, el empuje del terreno.",
    combinaciones: "Entra en todas. En ELU se mayora por 1,35 si es desfavorable y por 0,80 si es favorable (todas las permanentes a la vez); en las demás situaciones, por 1.",
    campos: ["permanente"],
  },
  Q: {
    nombre: "Sobrecarga de uso",
    breve: "personas, muebles, vehículos",
    que: "Lo que pesa lo que hay y quien está en el edificio: personas, muebles, vehículos. Su valor sale de la categoría de uso (DB SE-AE, tabla 3.1).",
    combinaciones: "Variable: como principal, por 1,5; acompañando a otra, por 1,5·ψ0. En ELS frecuente y casi permanente, por ψ1 y ψ2. Favorable, no entra.",
    campos: ["psi"],
  },
  S: {
    nombre: "Nieve",
    breve: "peso de la nieve en cubiertas",
    que: "El peso de la nieve en cubiertas (DB SE-AE 3.5). Sus ψ dependen de la altitud: por encima de 1000 m pesa más tiempo.",
    combinaciones: "Variable, como el uso: 1,5 de principal y 1,5·ψ0 de acompañante.",
    campos: ["psi"],
  },
  W: {
    nombre: "Viento",
    breve: "presión del viento, por dirección y sentido",
    que: "La presión del viento en fachadas y cubiertas (DB SE-AE 3.3), en una dirección y un sentido. Se define un caso por dirección y sentido (±X, ±Y).",
    combinaciones: "Variable. Los casos de una familia se excluyen: en cada combinación entra un solo sentido. ψ2 = 0: no entra en la casi permanente ni con sismo.",
    campos: ["psi", "familia", "direccion", "signo"],
  },
  T: {
    nombre: "Temperatura",
    breve: "dilataciones por temperatura",
    que: "Dilataciones y contracciones por cambios de temperatura (DB SE-AE 3.4).",
    combinaciones: "Variable, con ψ 0,6 / 0,5 / 0.",
    campos: ["psi"],
  },
  E: {
    nombre: "Sismo",
    breve: "sismo NCSE-02, por dirección",
    que: "La acción sísmica de la NCSE-02 en una dirección horizontal.",
    combinaciones: "Sólo en la situación sísmica, sin mayorar: el 100 % de una dirección con el 30 % de la otra, con las permanentes y ψ2 de las variables.",
    campos: ["direccion", "familia"],
  },
  A: {
    nombre: "Accidental",
    breve: "impacto, explosión",
    que: "Impacto, explosión u otra acción excepcional (DB SE-AE 4).",
    combinaciones: "Sólo en la situación extraordinaria, sin mayorar, con ψ1 de la variable principal y ψ2 de las demás.",
    campos: ["familia"],
  },
  N: {
    nombre: "Nocional",
    breve: "desplome inicial: horizontal desde un caso vertical",
    que: "Fuerza horizontal ficticia que representa el desplome inicial de los pilares: una fracción del peso de un caso vertical.",
    combinaciones: "Sólo en ELU persistente, con el factor de su caso de origen y el sentido del viento que haya en la combinación.",
    campos: ["direccion", "signo", "derivadoDe"],
  },
};

export interface InfoCampo {
  titulo: string;
  /** Qué es y qué hace. */
  que: string;
  /** Lo que vale cada opción, por el texto de la celda. */
  opciones?: readonly [string, string][];
}

const USOS_PSI: readonly [PsiNombrado, string][] = [
  ["uso-A", "residencial: viviendas, hoteles"],
  ["uso-B", "administrativo: oficinas"],
  ["uso-C", "público: aulas, restaurantes, salas"],
  ["uso-D", "comercial: tiendas"],
  ["uso-E", "garaje de vehículos ligeros"],
  ["uso-G", "cubierta sólo de mantenimiento"],
  ["nieve-hasta-1000", "nieve a ≤ 1000 m de altitud"],
  ["nieve-mas-de-1000", "nieve a > 1000 m de altitud"],
  ["viento", "viento"],
  ["temperatura", "temperatura"],
];

const coma = (x: number) => String(x).replace(".", ",");

/** Por clave de columna de la tabla Casos (`src/editor/tablas.ts`). */
export const CAMPOS_CASO: Record<string, InfoCampo> = {
  id: { titulo: "id", que: "El nombre corto con que lo citan las cargas y las combinaciones. Cambiarlo cambia también las cargas que lo usan." },
  nombre: { titulo: "nombre", que: "Una descripción libre para reconocerlo en las listas. No cuenta para el cálculo." },
  pesoPropio: {
    titulo: "peso propio",
    que: "Con «sí», el peso de pilares, vigas, losas y muros, que se saca del modelo, va a este caso. Sólo uno puede llevarlo; los solados y tabiques van aparte, como cargas.",
    opciones: [
      ["sí", "este caso lleva el peso de las piezas"],
      ["no", "sólo las cargas que se le pongan"],
    ],
  },
  tipo: {
    titulo: "acción",
    que: "Qué tipo de acción es para el CTE. Decide los coeficientes γ y ψ con que se mayora y con qué otros casos se combina. Sin acción, el caso se calcula y se puede consultar, pero no entra en las combinaciones.",
    opciones: (Object.entries(ACCIONES) as [TipoAccion, InfoAccion][]).map(([k, a]) => [k, `${a.nombre.toLowerCase()}: ${a.breve}`]),
  },
  psi: {
    titulo: "ψ",
    que: "Coeficientes de simultaneidad de la tabla 4.2 del DB SE. ψ0: la parte que cuenta cuando acompaña a otra variable. ψ1: valor frecuente (situación accidental, ELS frecuente). ψ2: valor casi permanente (flechas a largo plazo y sismo). Se eligen por su nombre o se escriben «ψ0 ψ1 ψ2».",
    opciones: USOS_PSI.map(([k, t]) => {
      const p = psiDe(k);
      return [k, `${t} · ψ ${coma(p.psi0)} / ${coma(p.psi1)} / ${coma(p.psi2)}`];
    }),
  },
  familia: {
    titulo: "familia",
    que: "Un nombre común a los casos que no pueden actuar a la vez, como el viento en +X, −X, +Y y −Y. En cada combinación entra como mucho uno de la familia. Vacía, el caso va suelto.",
  },
  permanente: {
    titulo: "permanente",
    que: "Sólo en una acción G: la fila de la tabla 4.1 del DB SE, que da su γ en ELU.",
    opciones: [
      ["peso", "peso propio y cargas muertas · γ 1,35 desfavorable, 0,80 favorable"],
      ["empuje", "empuje del terreno · γ 1,35 / 0,70"],
      ["agua", "presión del agua · γ 1,20 / 0,90"],
    ],
  },
  direccion: {
    titulo: "dirección",
    que: "Viento, sismo y nocional: el eje global en que empuja. Con sismo, la otra dirección entra al 30 %.",
    opciones: [
      ["X", "según el eje X global"],
      ["Y", "según el eje Y global"],
    ],
  },
  signo: {
    titulo: "signo",
    que: "Viento y nocional: el sentido, hacia +eje o −eje. El generador empareja la nocional con el viento del mismo sentido.",
    opciones: [
      ["1", "hacia +X o +Y"],
      ["-1", "hacia −X o −Y"],
    ],
  },
  derivadoDe: {
    titulo: "deriva de",
    que: "Sólo en una nocional: el caso vertical (G, Q o S) cuyo peso la genera. Entra en cada combinación con el mismo factor que ese caso.",
  },
  duracion: {
    titulo: "duración",
    que: "Clase de duración de la carga (DB SE-M, tabla 2.2). Sólo cambia el kmod de la madera; para hormigón y acero no cuenta. Vacía, la de su acción.",
    opciones: [
      ["permanente", "más de 10 años · por defecto en G"],
      ["larga", "de 6 meses a 10 años"],
      ["media", "de 1 semana a 6 meses · por defecto en Q"],
      ["corta", "menos de 1 semana · por defecto en S, W y T"],
      ["instantanea", "por defecto en E y A"],
    ],
  },
};
