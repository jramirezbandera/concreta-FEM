import { useMemo } from "react";
import { modeloStore } from "../../estado/modeloStore";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import { mapearReaccionAObra, type ReaccionObra } from "../../discretizador";
import { PanelFlotante } from "../primitivas";
import "./tablaReacciones.css";

// TablaReacciones (feature-14, Tarea 2.3): tabla de reacciones por APOYO de la
// combinacion activa, hudOverlay (panel flotante glass) sobre el lienzo de
// Resultados. Filas = nodos de apoyo (modeloFEM.supports); columnas = las 6
// componentes de la reaccion (FX,FY,FZ | MX,MY,MZ). Datos en mono tabular,
// alineados a la derecha (Spec Diseno UI: todo dato numerico en mono tabular).
//
// LENGUAJE DE OBRA (CLAUDE.md §2/§17): cada fila se etiqueta con el NOMBRE del
// pilar de arranque (via trazabilidad.pilarANodoArranque invertida), NUNCA con el
// id FEM del nodo ("N3"). Si un apoyo no corresponde a ningun pilar, etiqueta
// neutra ("Apoyo") sin exponer el nombre tecnico.
//
// FILTRADO POR PROCEDENCIA DE MALLA (F2.4, decision 2A): una losa genera DECENAS o
// CENTENARES de apoyos de borde (uno por nudo de malla del perimetro apoyado). Si se
// listaran uno a uno, inundarian la tabla y ahogarian los pilares (el dato que el
// arquitecto busca). Por eso los apoyos PROCEDENTES de la malla (trazabilidad.apoyosDeMalla)
// NO se listan individualmente: se AGREGAN en una unica fila resumen "Losa (borde)" con la
// SUMA de sus reacciones. Asi introducir una losa no degrada la vista de reacciones del
// portico. (El mapeo apoyo->paño concreto se difiere: una fila por losa exigiria cruzar
// panoAQuads/quadANodos; una sola fila agregada basta para no inundar y mantiene el ΣFY
// total correcto.)
//
// UNIDADES (CLAUDE.md §14): las reacciones ya vienen en el sistema interno
// (FX/FY/FZ en kN, MX/MY/MZ en kN·m). Se muestran TAL CUAL con su unidad en la
// cabecera; no hay conversion aqui (no es un borde de entrada/salida con cambio
// de sistema, solo presentacion del valor interno).
//
// [AUDITORIA D5] EJES DE OBRA, NO EJES FEM. El vector rxn del solver esta en ejes FEM
// (Y-up): rxn = [FX,FY,FZ, MX,MY,MZ]. Pero en el RESTO de la UI "Y" es el eje HORIZONTAL
// de la planta, asi que rotular la reaccion vertical como "FY" invita a leerla como una
// horizontal (lectura falsa). El remapeo FEM->obra NO se hace aqui como una permutacion
// suelta (divergiria de `mapearEjes`): lo hace el helper UNICO `mapearReaccionAObra` del
// discretizador (junto a `mapearEjes`, su inverso exacto). Este componente SOLO etiqueta
// las columnas y lee del objeto ReaccionObra que devuelve el helper. Sin conversion de
// unidades (solo permutacion): las reacciones ya vienen en el sistema interno (kN, kN·m).

// Decimales de presentacion: 2 da resolucion suficiente para verificar equilibrio
// sin ruido. Sistema interno kN/kN·m (valores tipicos de decenas a centenas).
const DECIMALES = 2;

// Columnas en EJES DE OBRA (D5). `campo` es la clave de ReaccionObra (fuente unica del
// mapeo, en el discretizador); `etiqueta` es el nombre visible. V (vertical) va primero
// (es lo que el arquitecto busca), luego las horizontales y los momentos. El resumen de
// equilibrio es "ΣV" (sumatorio de la componente V). `esMomento` decide la unidad.
const COLUMNAS: ReadonlyArray<{
  etiqueta: string;
  campo: keyof ReaccionObra;
  esMomento: boolean;
}> = [
  { etiqueta: "V", campo: "V", esMomento: false },
  { etiqueta: "Hx", campo: "Hx", esMomento: false },
  { etiqueta: "Hy", campo: "Hy", esMomento: false },
  { etiqueta: "Mx", campo: "Mx", esMomento: true },
  { etiqueta: "My", campo: "My", esMomento: true },
  { etiqueta: "Mv", campo: "Mv", esMomento: true },
];

// Formatea un valor a mono tabular con signo coherente. Redondea a DECIMALES y
// normaliza el "-0.00" residual del solver (GDL no apoyado -> reaccion ~0) a "0.00".
function fmt(v: number): string {
  const r = v.toFixed(DECIMALES);
  return r === `-${(0).toFixed(DECIMALES)}` ? (0).toFixed(DECIMALES) : r;
}

// Explicacion del "—" de los momentos del agregado de losa (B-1): la suma cruda de
// momentos de nudos distintos no es una resultante sin el termino r×F. Se muestra en el
// `title` de la celda y como nota al pie (UX-H8: antes el "—" no se explicaba).
const NOTA_MOMENTOS_LOSA =
  "Los momentos de los apoyos del borde de losa no se agregan: su suma no es una resultante.";

// Comparador NATURAL de nombres de apoyo (UX-ORDEN): ordena "P2" antes que "P10" (no
// alfabetico puro, que daria P1, P10, P2...). Intl.Collator con numeric agrupa los digitos.
const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

export function TablaReacciones() {
  // Lectura reactiva del trio de calculo y la combinacion activa. La tabla NO esta
  // en el bucle del viewport; re-render al recalcular/cambiar de combo es aceptable.
  const resultados = resultadosStore((s) => s.resultados);
  const modeloFEM = resultadosStore((s) => s.modeloFEM);
  const trazabilidad = resultadosStore((s) => s.trazabilidad);
  const vigente = resultadosStore((s) => s.vigente);
  const combinacionActiva = vistaStore((s) => s.combinacionActiva);
  // Pilares de obra para resolver el nombre legible. Lectura reactiva: si se renombra
  // un pilar la etiqueta se actualiza (aunque editar invalida resultados -> vigente).
  const pilares = modeloStore((s) => s.modelo.pilares);

  // Mapa node FEM -> nombre de pilar de arranque, invirtiendo pilarANodoArranque
  // (pilar -> node) y resolviendo el nombre de obra. Memoizado: solo depende de la
  // trazabilidad (estable por calculo) y de los nombres de pilar.
  const nodoAEtiqueta = useMemo(() => {
    const mapa: Record<string, string> = {};
    if (!trazabilidad) return mapa;
    const nombrePorId = new Map(pilares.map((p) => [p.id, p.nombre]));
    for (const [pilarId, node] of Object.entries(trazabilidad.pilarANodoArranque)) {
      const nombre = nombrePorId.get(pilarId);
      if (nombre !== undefined) mapa[node] = nombre;
    }
    return mapa;
  }, [trazabilidad, pilares]);

  // Estados guia (sin resultados o sin combo valido): panel con mensaje, sin tabla.
  if (!resultados || !modeloFEM) {
    return (
      // data-testid para E2E (feature-16): panel glass sin rol (es un <div .cx-float>);
      // mismo gancho en todos los estados del panel de reacciones para que el E2E
      // localice la tabla y acote sus aserciones sin depender del estado guia.
      <PanelFlotante
        className="cx-reacciones"
        titulo="Reacciones"
        tag="apoyos"
        data-testid="tabla-reacciones"
      >
        <p className="cx-reacciones__vacio">
          Calcula la obra para ver las reacciones en los apoyos.
        </p>
      </PanelFlotante>
    );
  }

  const combo =
    combinacionActiva !== null && resultados.combos.includes(combinacionActiva)
      ? combinacionActiva
      : null;

  if (combo === null) {
    return (
      <PanelFlotante
        className="cx-reacciones"
        titulo="Reacciones"
        tag="apoyos"
        data-testid="tabla-reacciones"
      >
        <p className="cx-reacciones__vacio">
          Elige una combinación para ver las reacciones.
        </p>
      </PanelFlotante>
    );
  }

  // Conjunto de nudos cuyo apoyo PROCEDE de la malla de un paño (F2.4): se AGREGAN, no se
  // listan uno a uno. Vacio en un portico sin losa (la tabla queda identica a antes).
  const apoyosDeMalla = new Set(trazabilidad?.apoyosDeMalla ?? []);

  // Filas individuales = apoyos ESTRUCTURALES del modelo (pilares); los de malla se
  // excluyen aqui y se agregan abajo. Para cada uno, la reaccion del combo activo; si el
  // nodo no tiene resultado (no deberia: un apoyo siempre reacciona), se omite la fila.
  const filas = modeloFEM.supports
    .filter((apoyo) => !apoyosDeMalla.has(apoyo.node))
    .map((apoyo) => {
      const rxn = resultados.nodos[apoyo.node]?.[combo]?.rxn;
      if (!rxn) return null;
      return {
        node: apoyo.node,
        etiqueta: nodoAEtiqueta[apoyo.node] ?? "Apoyo",
        // Remapeo FEM->obra en el BORDE via el helper UNICO (D5): la fila lleva ya las
        // componentes de obra (V/Hx/Hy/Mx/My/Mv), sin exponer el orden FEM.
        obra: mapearReaccionAObra(rxn),
      };
    })
    .filter(
      (f): f is { node: string; etiqueta: string; obra: ReaccionObra } => f !== null,
    )
    // Orden natural por etiqueta de apoyo (UX-ORDEN): P1, P2, P3, P4 (no P1, P4, P2, P3).
    // El agregado "Losa (borde)" no entra aqui: se renderiza siempre despues de estas filas.
    .sort((a, b) => collator.compare(a.etiqueta, b.etiqueta));

  // Agregado de los apoyos de borde de la losa (F2.4): una sola fila con la SUMA de las
  // reacciones de todos los nudos de malla apoyados. `null` si no hay losa (no se pinta la
  // fila). [AUDITORIA B-1] Se suman SOLO las FUERZAS (V/Hx/Hy): son una resultante
  // trasladable. Los MOMENTOS de nudos en posiciones distintas NO se pueden sumar sin su
  // termino r×F (la suma cruda no es el momento resultante respecto de ningun punto): con
  // borde EMPOTRADO (momentos de reaccion no nulos) la celda mostraba un numero sin sentido
  // fisico que el arquitecto podia leer como "el momento de empotramiento de la losa". Por
  // eso `filaMalla.obra` solo lleva las 3 FUERZAS; las 3 columnas de momento se pintan como
  // "—" (esMomento en COLUMNAS). Se suma en ejes FEM y se remapea una vez (equivalente a
  // sumar componente a componente en obra: la permutacion es lineal).
  let filaMalla: {
    etiqueta: string;
    obra: Pick<ReaccionObra, "V" | "Hx" | "Hy">;
  } | null = null;
  if (apoyosDeMalla.size > 0) {
    const sumaFem = [0, 0, 0, 0, 0, 0];
    let conReaccion = false;
    for (const apoyo of modeloFEM.supports) {
      if (!apoyosDeMalla.has(apoyo.node)) continue;
      const rxn = resultados.nodos[apoyo.node]?.[combo]?.rxn;
      if (!rxn) continue;
      conReaccion = true;
      // Solo las 3 fuerzas (FX,FY,FZ, indices 0-2); los momentos no se agregan.
      for (let c = 0; c < 3; c++) sumaFem[c] = (sumaFem[c] ?? 0) + (rxn[c] ?? 0);
    }
    if (conReaccion) {
      const o = mapearReaccionAObra(sumaFem);
      filaMalla = { etiqueta: "Losa (borde)", obra: { V: o.V, Hx: o.Hx, Hy: o.Hy } };
    }
  }

  // Suma de reacciones VERTICALES (ΣV): ayuda de lectura para verificar equilibrio (debe
  // igualar la carga vertical total). Incluye el agregado de la losa, asi el total cierra
  // aunque las reacciones de borde no se listen una a una. La componente vertical es `.V`.
  const sumaV =
    filas.reduce((acc, f) => acc + f.obra.V, 0) + (filaMalla ? filaMalla.obra.V : 0);

  return (
    <PanelFlotante
      className={`cx-reacciones${vigente ? "" : " cx-reacciones--obsoleto"}`}
      titulo="Reacciones"
      // El combo activo como tag mono mantiene visible a que combinacion pertenecen
      // los valores sin ocupar mas cromo.
      tag={combo}
      data-testid="tabla-reacciones"
    >
      {!vigente && (
        <p className="cx-reacciones__aviso" role="status">
          Resultados obsoletos: la obra cambió desde el último cálculo. Vuelve a calcular.
        </p>
      )}

      {filas.length === 0 && filaMalla === null ? (
        <p className="cx-reacciones__vacio">No hay apoyos con reacción que mostrar.</p>
      ) : (
        <div className="cx-reacciones__scroll">
          <table className="cx-reacciones__tabla">
            <thead>
              <tr>
                <th scope="col" className="cx-reacciones__th-apoyo">
                  Apoyo
                </th>
                {COLUMNAS.map((c) => (
                  <th key={c.etiqueta} scope="col" className="cx-reacciones__th-num">
                    <span className="cx-reacciones__col-eje">{c.etiqueta}</span>
                    {/* Unidad por columna: fuerzas (V/Hx/Hy) kN, momentos (Mx/My/Mv) kN·m. */}
                    <span className="cx-reacciones__col-ud">
                      {c.esMomento ? "kN·m" : "kN"}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.node}>
                  <th scope="row" className="cx-reacciones__td-apoyo">
                    {f.etiqueta}
                  </th>
                  {COLUMNAS.map((c) => (
                    <td key={c.etiqueta} className="cx-reacciones__td-num mono">
                      {fmt(f.obra[c.campo])}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Fila AGREGADA de los apoyos de borde de la losa (F2.4): una sola fila con
                  la suma, en vez de inundar la tabla con un apoyo por nudo de malla. */}
              {filaMalla && (
                <tr className="cx-reacciones__agregado">
                  <th scope="row" className="cx-reacciones__td-apoyo">
                    {filaMalla.etiqueta}
                  </th>
                  {COLUMNAS.map((c) => {
                    // Solo las FUERZAS del agregado se muestran; los MOMENTOS van "—" (B-1).
                    const esGuion = c.esMomento;
                    const valor = esGuion
                      ? null
                      : filaMalla!.obra[c.campo as "V" | "Hx" | "Hy"];
                    return (
                      <td
                        key={c.etiqueta}
                        className="cx-reacciones__td-num mono"
                        // El "—" se explica al pasar el raton (UX-H8); la nota al pie lo
                        // repite para quien no usa el hover.
                        title={esGuion ? NOTA_MOMENTOS_LOSA : undefined}
                      >
                        {/* [B-1] Momentos del agregado: "—" (no son resultante sin r×F). */}
                        {valor === null ? "—" : fmt(valor)}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
            <tfoot>
              {/* Resumen de equilibrio: suma de reacciones verticales (ΣV). La columna V es
                  ahora la PRIMERA numerica (D5), asi el valor cae bajo su propia columna. */}
              <tr className="cx-reacciones__resumen">
                <th scope="row" className="cx-reacciones__td-apoyo">
                  ΣV
                </th>
                <td className="cx-reacciones__td-num mono">{fmt(sumaV)}</td>
                <td colSpan={5} className="cx-reacciones__resumen-nota">
                  suma de reacciones verticales (kN)
                </td>
              </tr>
              {/* Nota al pie del "—" de los momentos de la losa (UX-H8): explica por que no
                  se agregan, en lenguaje de obra. Solo cuando hay fila de losa. */}
              {filaMalla && (
                <tr className="cx-reacciones__pie">
                  <td colSpan={7} className="cx-reacciones__pie-nota">
                    — {NOTA_MOMENTOS_LOSA}
                  </td>
                </tr>
              )}
              {/* Nota de convenio de ejes (D5): recuerda que las columnas estan en ejes de
                  OBRA (no FEM), con V = reaccion vertical. Evita la lectura falsa de "FY". */}
              <tr className="cx-reacciones__pie">
                <td colSpan={7} className="cx-reacciones__pie-nota">
                  Componentes en ejes de obra (V = vertical).
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </PanelFlotante>
  );
}
