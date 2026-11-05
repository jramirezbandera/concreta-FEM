/**
 * El DWG frente al DXF del mismo dibujo (fase DW, `docs/fem3d/dwg.md` §5, criterios 1 y 3):
 * entidad a entidad por su handle (el código 5, que los dos guardan), con el tipo, la capa y los
 * códigos de grupo que lee `aplanar.ts`; las capas, `$INSUNITS` y el orden del espacio modelo.
 *
 * Lo usan la prueba con las muestras de AutoCAD (`dwg.test.ts`) y la comparación con los DWG del
 * usuario (`validacion/dwg/`). Puro.
 */

import { type Dxf, type Entidad, nums, texto } from "../dxf/lector.ts";
import type { Dwg } from "./lector.ts";

/** Los códigos geométricos de cada tipo traducido: los que tienen que estar en los dos y valer lo mismo. */
export const CODIGOS_TIPO: Readonly<Record<string, readonly number[]>> = {
  LINE: [10, 20, 30, 11, 21, 31, 39, 210, 220, 230],
  CIRCLE: [10, 20, 30, 40, 39, 210, 220, 230],
  ARC: [10, 20, 30, 40, 50, 51, 39, 210, 220, 230],
};

export interface ComparacionDwg {
  /** Entidades emparejadas por handle. */
  emparejadas: number;
  /** El mayor error relativo, max(|a − b|) / max(1, |a|, |b|), y dónde. */
  errorMaximo: number;
  donde: string;
  fallos: string[];
}

export function compararDwgConDxf(dwg: Dwg, dxf: Dxf, tol = 1e-12): ComparacionDwg {
  const fallos: string[] = [];
  const fallo = (s: string) => {
    if (fallos.length < 50) fallos.push(s);
  };

  if (dwg.insunits !== dxf.insunits) fallo(`$INSUNITS: DWG ${dwg.insunits}, DXF ${dxf.insunits}`);

  const capas = (d: Dxf) => d.capas.map((c) => `${c.nombre}${c.apagada ? " apagada" : ""}${c.congelada ? " congelada" : ""}`);
  const cw = capas(dwg);
  const cx = capas(dxf);
  if (cw.join("|") !== cx.join("|")) fallo(`capas: DWG [${cw.join(", ")}], DXF [${cx.join(", ")}]`);

  const porHandle = new Map<string, Entidad>();
  for (const e of dxf.entidades) porHandle.set(texto(e, 5), e);

  let errorMaximo = 0;
  let donde = "";
  let emparejadas = 0;
  const vistos = new Set<string>();
  for (const w of dwg.entidades) {
    const h = texto(w, 5);
    vistos.add(h);
    const x = porHandle.get(h);
    if (!x) {
      fallo(`${w.tipo} ${h}: no está en el espacio modelo del DXF`);
      continue;
    }
    emparejadas++;
    if (x.tipo !== w.tipo) fallo(`${h}: tipo DWG ${w.tipo}, DXF ${x.tipo}`);
    if (x.capa !== w.capa) fallo(`${w.tipo} ${h}: capa DWG «${w.capa}», DXF «${x.capa}»`);
    for (const c of CODIGOS_TIPO[w.tipo] ?? []) {
      const a = nums(w, c);
      const b = nums(x, c);
      if (a.length !== b.length) {
        fallo(`${w.tipo} ${h}: el código ${c} sale ${a.length} veces en el DWG y ${b.length} en el DXF`);
        continue;
      }
      for (let i = 0; i < a.length; i++) {
        const e = Math.abs(a[i]! - b[i]!) / Math.max(1, Math.abs(a[i]!), Math.abs(b[i]!));
        if (!(e <= tol)) fallo(`${w.tipo} ${h}: código ${c}: DWG ${a[i]}, DXF ${b[i]}`);
        if (e > errorMaximo) {
          errorMaximo = e;
          donde = `${w.tipo} ${h} código ${c}`;
        }
      }
    }
  }

  // Lo del DXF de los tipos traducidos que no salió del DWG
  for (const x of dxf.entidades)
    if (x.tipo in CODIGOS_TIPO && !vistos.has(texto(x, 5))) fallo(`${x.tipo} ${texto(x, 5)}: está en el DXF y no salió del DWG`);

  // El orden: el de los handles del DWG, frente al del DXF con sólo esos
  const ordenDxf = dxf.entidades.map((e) => texto(e, 5)).filter((h) => vistos.has(h));
  const ordenDwg = dwg.entidades.map((e) => texto(e, 5)).filter((h) => porHandle.has(h));
  const k = ordenDwg.findIndex((h, i) => h !== ordenDxf[i]);
  if (k >= 0) fallo(`orden: la ${k + 1}.ª entidad es ${ordenDwg[k]} en el DWG y ${ordenDxf[k]} en el DXF`);

  return { emparejadas, errorMaximo, donde, fallos };
}
