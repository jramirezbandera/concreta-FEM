/**
 * Resumen de C1: los valores medidos de los criterios 1 a 4 (los tests sólo comprueban que
 * quedan por debajo de su tolerancia).
 *
 *   bun validacion/c1/resumen.ts > validacion/c1/out_resumen.txt
 */
import { compilar } from "../../src/compilador/compilar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { compararModelos } from "../../src/pruebas/compilador.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { planos, relacionInvertir, relacionOrden, relacionPartirCargas, relacionPartirVigas, relacionPlano, relacionRuido, valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { dentroDelRedondeo, IN, KIP, sap1022 } from "../e6/csi.ts";
import { casosMano } from "./mano.ts";
import { fisico1022 } from "./modelos.ts";

const e = (x: number) => x.toExponential(1);
const SEMILLAS = [1, 2, 5, 6, 9, 13, 14, 17, 21, 25, 29, 30];

console.log("Criterio 1: SAP2000 1-022 como modelo físico");
{
  const r = valido(compilar(fisico1022()));
  const [lat] = casosValidos(calcular(r.modelo, { solver: "perfil" }));
  const n22 = r.mapeo.nudosPilar["izquierda@N7"]!;
  const b1 = r.mapeo.piezas.izquierda![0]!;
  const fuente = "SAP2000 1-022, p. 6";
  for (const p of [
    { nombre: "Ux nudo 22 (in)", valor: 1.45076, decimales: 5, motor: lat!.u[6 * n22]! / IN, fuente },
    { nombre: "axil pilar 1 (kip)", valor: 69.99, decimales: 2, motor: lat!.esfuerzosBarras[12 * b1]! / KIP, fuente },
    { nombre: "momento pilar 1 en el nudo 1 (k·in)", valor: 2324.68, decimales: 2, motor: lat!.esfuerzosBarras[12 * b1 + 4]! / (KIP * IN), fuente },
  ])
    console.log(`  ${p.nombre}: publicado ${p.valor}, compilado ${p.motor.toFixed(p.decimales + 2)} (${dentroDelRedondeo(p) ? "dentro del redondeo" : "FUERA"})`);
  const c = compararModelos(r.modelo, sap1022().modelo);
  console.log(`  frente al modelo a mano de E6: u ${e(c.u)}, esfuerzos ${e(c.barras)} (${c.nBarras} barras)`);
}

console.log("\nCriterio 2: modelos físicos frente a su modelo analítico hecho a mano");
for (const caso of casosMano()) {
  const r = valido(compilar(caso.fisico));
  const c = compararModelos(r.modelo, caso.mano);
  console.log(`  ${caso.nombre}\n    u ${e(c.u)}, reacciones ${e(c.reacciones)}, esfuerzos ${e(c.barras)}; ${c.nudos} nudos y ${c.nBarras} barras; avisos: ${r.diagnosticos.map((d) => d.codigo).join(", ") || "ninguno"}`);
}

console.log(`\nCriterio 3: relaciones metamórficas, peor valor en ${SEMILLAS.length} semillas`);
{
  let orden = true;
  const plano = new Map<string, number>();
  let ruidoGeom = 0;
  let topoGeom = true;
  let topoSnap = true;
  let avisosSnap = 0;
  let partir = 0;
  let partidas = 0;
  let invertir = 0;
  let cargas = 0;
  for (const s of SEMILLAS) {
    orden &&= relacionOrden(fisicoAleatorio(s), s);
    for (const diafragma of [true, false]) {
      for (const { nombre, t } of planos()) {
        const x = relacionPlano(fisicoAleatorio(s, { diafragma }), t);
        plano.set(nombre, Math.max(plano.get(nombre) ?? 0, x.u, x.reacciones, x.barras));
      }
    }
    const g = relacionRuido(fisicoAleatorio(s), s, 1e-8);
    ruidoGeom = Math.max(ruidoGeom, g.u);
    topoGeom &&= g.topologia;
    const n = relacionRuido(fisicoAleatorio(s), s, 0.015, true);
    topoSnap &&= n.topologia && n.codigos.every((c) => c === "topologia/fusion");
    avisosSnap += n.codigos.length;
    const p = relacionPartirVigas(fisicoAleatorio(s, { diafragma: false }));
    partir = Math.max(partir, p.u, p.reacciones);
    partidas += p.partidas;
    const i = relacionInvertir(fisicoAleatorio(s));
    invertir = Math.max(invertir, i.u, i.barras);
    cargas = Math.max(cargas, relacionPartirCargas(fisicoAleatorio(s)));
  }
  console.log(`  reordenar las listas: ${orden ? "el mismo modelo analítico, mapeo y diagnósticos, bit a bit" : "DISTINTO"}`);
  for (const [k, v] of plano) console.log(`  ${k} (con y sin diafragma): ${e(v)}`);
  console.log(`  ruido de 1e-8 m: ${topoGeom ? "misma topología" : "TOPOLOGÍA DISTINTA"}, u ${e(ruidoGeom)}`);
  console.log(`  ruido de ±1,5 cm en las vigas: ${topoSnap ? "misma topología" : "TOPOLOGÍA DISTINTA"}, ${avisosSnap} avisos de fusión`);
  console.log(`  partir ${partidas} vigas en dos (sin diafragma): ${e(partir)}`);
  console.log(`  invertir las vigas: ${e(invertir)}`);
  console.log(`  partir las cargas repartidas: ${e(cargas)}`);
}

console.log("\nCriterio 4: sin pérdidas (resultante física frente a analítica) y equilibrio del motor");
{
  let f = 0;
  let m = 0;
  let eq = 0;
  let n = 0;
  for (const s of SEMILLAS) {
    for (const diafragma of [true, false]) {
      const r = valido(compilar(fisicoAleatorio(s, { diafragma })));
      f = Math.max(f, r.estadisticas.sinPerdidas.fuerzas);
      m = Math.max(m, r.estadisticas.sinPerdidas.momentos);
      for (const c of casosValidos(calcular(r.modelo, { solver: "perfil" }))) eq = Math.max(eq, c.equilibrio.fuerzas, c.equilibrio.momentos);
      n++;
    }
  }
  console.log(`  ${n} modelos aleatorios: sin pérdidas ${e(f)} en fuerzas y ${e(m)} en momentos; equilibrio del motor ${e(eq)}`);
}
