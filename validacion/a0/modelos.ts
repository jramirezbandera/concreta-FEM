/**
 * Modelos físicos válidos de C1–C5 para el criterio 1 de A0 (el esquema de `proyecto.json` los
 * acepta todos): las referencias congeladas, los modelos hechos a mano, los de validación y una
 * batería al azar con losas, muros y forjados.
 */
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../../src/pruebas/forjadosAleatorios.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";
import { edificioObjetivo } from "../c1/banco.ts";
import { MODELOS_CONGELADOS_C1 } from "../c1/congelar.ts";
import { casosMano } from "../c1/mano.ts";
import { fisico1022 } from "../c1/modelos.ts";
import { MODELOS_CONGELADOS_C2 } from "../c2/congelar.ts";
import { losaPlanaFisica } from "../c2/losaPlana.ts";
import { edificioObjetivoLosas, reticulaEnrasada } from "../c2/modelos.ts";
import { MODELOS_CONGELADOS_C3 } from "../c3/congelar.ts";
import { edificioObjetivoMuros, reticulaConNucleo } from "../c3/modelos.ts";
import { losaMurosFisico, sotanoFisico, vigaMuroFisico, voladizoFisico } from "../c3/oraculos.ts";
import { MODELOS_CONGELADOS_C4 } from "../c4/congelar.ts";
import { casosManoC4 } from "../c4/mano.ts";
import { edificioReticular, edificioUnidireccional } from "../c4/modelos.ts";
import { MODELOS_CONGELADOS_C5 } from "../c5/congelar.ts";
import { conAcciones, conPropuesta, losaPilaresMezclados, reticularH25 } from "../c5/modelos.ts";

export interface ModeloValido {
  nombre: string;
  fisico: ModeloFisico;
  opciones?: OpcionesCompilacion;
}

export function modelosValidos(): ModeloValido[] {
  const r: ModeloValido[] = [];
  for (const [fase, lista] of [
    ["C1", MODELOS_CONGELADOS_C1],
    ["C2", MODELOS_CONGELADOS_C2],
    ["C3", MODELOS_CONGELADOS_C3],
    ["C4", MODELOS_CONGELADOS_C4],
    ["C5", MODELOS_CONGELADOS_C5],
  ] as const)
    for (const [nombre, f] of Object.entries(lista)) {
      const { fisico, opciones } = f();
      r.push({ nombre: `congelado ${fase} ${nombre}`, fisico, ...(opciones ? { opciones } : {}) });
    }
  casosMano().forEach((c, i) => r.push({ nombre: `a mano C1 ${i + 1}`, fisico: c.fisico, opciones: c.opciones }));
  casosManoC4().forEach((c, i) => r.push({ nombre: `a mano C4 ${i + 1}`, fisico: c.fisico, opciones: c.opciones }));
  r.push(
    { nombre: "1-022", fisico: fisico1022() },
    { nombre: "edificio objetivo C1", fisico: edificioObjetivo(2, 3, 2) },
    { nombre: "edificio objetivo con losas", fisico: edificioObjetivoLosas(2, 3, 2) },
    { nombre: "retícula enrasada", fisico: reticulaEnrasada() },
    { nombre: "losa plana H25", fisico: losaPlanaFisica() },
    { nombre: "edificio objetivo con muros", fisico: edificioObjetivoMuros(2, 3, 2) },
    { nombre: "retícula con núcleo", fisico: reticulaConNucleo() },
    { nombre: "voladizo", fisico: voladizoFisico() },
    { nombre: "sótano", fisico: sotanoFisico() },
    { nombre: "losa y muros", fisico: losaMurosFisico() },
    { nombre: "viga y muro", fisico: vigaMuroFisico() },
    { nombre: "edificio reticular", fisico: edificioReticular(2, 3, 2) },
    { nombre: "edificio unidireccional", fisico: edificioUnidireccional(2, 3, 2) },
    { nombre: "pilares mezclados con propuesta y acciones", fisico: conAcciones(conPropuesta(losaPilaresMezclados())) },
    { nombre: "reticular H25", fisico: conPropuesta(reticularH25()) },
  );
  for (let s = 1; s <= 10; s++) {
    r.push({ nombre: `al azar ${s}`, fisico: fisicoAleatorio(s) });
    r.push({ nombre: `al azar ${s} con losas`, fisico: conLosasAleatorias(fisicoAleatorio(s), s) });
    r.push({ nombre: `al azar ${s} con muros`, fisico: conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(s), s), s) });
    r.push({ nombre: `al azar ${s} con forjados`, fisico: conForjadosAleatorios(fisicoAleatorio(s), s) });
  }
  return r;
}
