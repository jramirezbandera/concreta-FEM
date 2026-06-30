import { useMemo } from "react";
import { modeloStore } from "../../estado/modeloStore";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
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

// Decimales de presentacion: 2 da resolucion suficiente para verificar equilibrio
// sin ruido. Sistema interno kN/kN·m (valores tipicos de decenas a centenas).
const DECIMALES = 2;

// Las 6 componentes en el orden FIJO de rxn = [FX,FY,FZ,MX,MY,MZ] (resultados.ts).
// FY es la VERTICAL del sistema interno (eje Y arriba): de ahi el resumen de ΣFY.
const COLUMNAS: ReadonlyArray<{ etiqueta: string; indice: number }> = [
  { etiqueta: "FX", indice: 0 },
  { etiqueta: "FY", indice: 1 },
  { etiqueta: "FZ", indice: 2 },
  { etiqueta: "MX", indice: 3 },
  { etiqueta: "MY", indice: 4 },
  { etiqueta: "MZ", indice: 5 },
];

// Formatea un valor a mono tabular con signo coherente. Redondea a DECIMALES y
// normaliza el "-0.00" residual del solver (GDL no apoyado -> reaccion ~0) a "0.00".
function fmt(v: number): string {
  const r = v.toFixed(DECIMALES);
  return r === `-${(0).toFixed(DECIMALES)}` ? (0).toFixed(DECIMALES) : r;
}

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
        rxn,
      };
    })
    .filter((f): f is { node: string; etiqueta: string; rxn: number[] } => f !== null);

  // Agregado de los apoyos de borde de la losa (F2.4): una sola fila con la SUMA de las
  // reacciones de todos los nudos de malla apoyados. `null` si no hay losa (no se pinta la
  // fila). Recorre las 6 componentes para sumar fuerzas y momentos por igual.
  let filaMalla: { etiqueta: string; rxn: number[] } | null = null;
  if (apoyosDeMalla.size > 0) {
    const suma = [0, 0, 0, 0, 0, 0];
    let conReaccion = false;
    for (const apoyo of modeloFEM.supports) {
      if (!apoyosDeMalla.has(apoyo.node)) continue;
      const rxn = resultados.nodos[apoyo.node]?.[combo]?.rxn;
      if (!rxn) continue;
      conReaccion = true;
      for (let c = 0; c < 6; c++) suma[c]! += rxn[c] ?? 0;
    }
    if (conReaccion) filaMalla = { etiqueta: "Losa (borde)", rxn: suma };
  }

  // Suma de reacciones verticales (ΣFY): ayuda de lectura para verificar equilibrio (debe
  // igualar la carga vertical total). Incluye el agregado de la losa, asi el total cierra
  // aunque las reacciones de borde no se listen una a una. Index 1 = FY (vertical).
  const sumaFY =
    filas.reduce((acc, f) => acc + (f.rxn[1] ?? 0), 0) +
    (filaMalla ? (filaMalla.rxn[1] ?? 0) : 0);

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
                    {/* Unidad por columna: fuerzas (FX/FY/FZ) kN, momentos (MX/MY/MZ) kN·m. */}
                    <span className="cx-reacciones__col-ud">
                      {c.indice < 3 ? "kN" : "kN·m"}
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
                      {fmt(f.rxn[c.indice] ?? 0)}
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
                  {COLUMNAS.map((c) => (
                    <td key={c.etiqueta} className="cx-reacciones__td-num mono">
                      {fmt(filaMalla!.rxn[c.indice] ?? 0)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
            <tfoot>
              {/* Resumen de equilibrio: suma de reacciones verticales (ΣFY). El valor
                  cae bajo la columna FY (vacia la de FX) para alinear con su columna. */}
              <tr className="cx-reacciones__resumen">
                <th scope="row" className="cx-reacciones__td-apoyo">
                  ΣFY
                </th>
                <td className="cx-reacciones__td-num" aria-hidden="true" />
                <td className="cx-reacciones__td-num mono">{fmt(sumaFY)}</td>
                <td colSpan={4} className="cx-reacciones__resumen-nota">
                  suma de reacciones verticales (kN)
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </PanelFlotante>
  );
}
