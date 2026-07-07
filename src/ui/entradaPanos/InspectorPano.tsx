// InspectorPano (F3): panel flotante sobre el lienzo que edita el paño SELECCIONADO con
// COMMIT EN VIVO. Espejo de InspectorViga, SOLO-PROPIEDADES: la geometria (perimetro) la
// fija la introduccion grafica en planta, NO este formulario. Visible solo cuando hay
// EXACTAMENTE un paño seleccionado. Vocabulario de obra (Paño, Material, Espesor, Tamaño
// de malla, Apoyo de borde); cero jerga FEM.
//
// INVARIANTE DEL `base` (CLAUDE.md §10): los comandos se construyen contra el modelo
// ACTUAL leido justo antes de ejecutar, nunca contra la copia del render.
//
// UNIDADES (CLAUDE.md §14): espesor y tamaño de malla se editan en mm (CampoLongitudMm,
// conversion en el borde); el material por id; el apoyo de borde enum.
import { useEffect, useMemo, useState } from "react";
import { PanelFlotante, Boton, SelectMaterial } from "../primitivas";
import {
  CampoBordeApoyo,
  CampoLongitudMm,
  CampoDireccionViguetas,
  CampoPesoPropio,
} from "./camposPano";
import { Dialogo } from "../dialogos/Dialogo";
import { SeccionCargaSuperficial } from "./SeccionCargaSuperficial";
import {
  validarPano,
  type DatosPanoUI,
  type ErrorCampo,
} from "../dialogos/validacionesPano";
import {
  modeloStore,
  seleccionStore,
  vistaStore,
  editarPano,
  eliminarPano,
} from "../../estado";
import type { CambiosPano } from "../../estado";
import type { Modelo, Pano, Nudo } from "../../dominio";
import { cargasDeAmbito } from "../../dominio";
// FUENTE UNICA [2A] de las cargas automaticas de grupo (F3.2, D-1): la MISMA que
// usa el discretizador para emitirlas. La linea informativa del inspector no puede
// divergir de lo que el calculo aplica.
import { cargasPlantaDePano, CASE_CM_PLANTA } from "../../discretizador/cargasPlanta";
// FUENTE UNICA (F2.3, losa plana; afinado en code-review #2): el MISMO calculo de
// acople que usa el discretizador decide que pilares interiores recogen la losa.
// Es puro (malla en memoria acotada por CAP_QUADS, sin FEM/solver/IO) y se memoiza
// por modelo+seleccion. La nota de honestidad sobre el momento en cabeza de pilar
// no puede divergir de lo que el calculo realmente acopla: el detector geometrico
// a secas (pilaresInterioresBajoPano) sobre-disparaba en paños BLOQUEADOS (pilares
// juntos, cap de malla) donde no hay losa plana calculable.
import { calcularAcoples } from "../../discretizador/acople";
import "./inspectorPano.css";

function leerModelo() {
  return modeloStore.getState().getModelo();
}

function errorDe(errores: ErrorCampo[], campo: string): string | undefined {
  return errores.find((e) => e.campo === campo)?.mensaje;
}

// Construye los DatosPanoUI completos a partir del paño actual y un parche del campo
// editado. validarPano valida el CONJUNTO. El nombre no se edita aqui (solo-propiedades)
// pero forma parte del contrato de validacion (unicidad). El `tipo` y los campos uni
// viajan tambien para que validarPano aplique las reglas del forjado unidireccional.
function datosDesde(pano: Pano, cambios: Partial<DatosPanoUI>): DatosPanoUI {
  // La union discriminada por `tipo` estrecha que campos porta cada variante: espesor/tamMalla
  // solo la losa; direccionViguetas/intereje/canto/anchoNervio/pesoPropio solo la unidireccional.
  // DatosPanoUI (contrato de UI, corte 1) trata la losa como el caso base: espesor/tamMalla
  // OBLIGATORIOS. Para una variante sin ellos (unidireccional) se emiten 0 de placeholder
  // (los campos de placa estan ocultos en su UI y validarPano no los mira bajo unidireccional).
  const uni = pano.tipo === "unidireccional" ? pano : null;
  return {
    nombre: pano.nombre,
    tipo: uni ? "unidireccional" : "losa",
    materialId: pano.materialId,
    espesor: pano.tipo === "losa" ? pano.espesor : 0,
    tamMalla: pano.tipo === "losa" ? pano.tamMalla : 0,
    bordeApoyo: pano.bordeApoyo,
    direccionViguetas: uni ? uni.direccionViguetas : undefined,
    intereje: uni ? uni.intereje : undefined,
    canto: uni ? uni.canto : undefined,
    anchoNervio: uni ? uni.anchoNervio : undefined,
    pesoPropio: uni ? uni.pesoPropio : undefined,
    ...cambios,
  };
}

// Cuenta las cargas que arrastraria borrar el paño (mismo criterio que eliminarPano).
function contarCargasDelPano(modelo: Modelo, panoId: string): number {
  return cargasDeAmbito(modelo, panoId).length;
}

// Dimensiones del paño para el bloque solo-lectura D8b: ancho × alto (m) del rectangulo
// que envuelve su perimetro (bounding box de los nudos del contorno). En el corte 1 el
// paño ES un rectangulo de ejes, asi que ancho/alto del bounding box son sus dimensiones
// reales. UNIDADES internas en m (sin conversion: las coordenadas van en m). Devuelve
// null si el perimetro no resuelve a nudos suficientes (import inconsistente).
interface DimensionesPano {
  ancho: number; // m (extension en X)
  alto: number; // m (extension en Y)
}

function dimensionesDePano(nudos: Nudo[], pano: Pano): DimensionesPano | null {
  const puntos = pano.perimetro
    .map((id) => nudos.find((n) => n.id === id))
    .filter((n): n is Nudo => n !== undefined);
  if (puntos.length < 2) return null;
  const xs = puntos.map((p) => p.x);
  const ys = puntos.map((p) => p.y);
  const ancho = Math.max(...xs) - Math.min(...xs);
  const alto = Math.max(...ys) - Math.min(...ys);
  return { ancho, alto };
}

// Formatea un valor en metros a 2 decimales (bloque geometrico D8b, mono tabular).
function fmt2(v: number): string {
  return v.toFixed(2);
}

// Formatea una presion (kN/m²) con coma decimal es-ES y 2 decimales fijos, como el
// resto de cifras normativas de la UI ("1,35", "2,00").
function fmtCarga(v: number): string {
  return v.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Estado vacio del inspector (auditoria UX-C6): en la pestana de Isovalores (donde el
// paño es el editor principal) con la herramienta "seleccion" y sin paño seleccionado,
// el dock mostraba solo "Ayudas" sin guiar a que seleccionar un paño abre su editor.
// En vez de desaparecer (return null), rinde una seccion de estado vacio en el cromo
// plano del dock (patron de PanelDiagramas / InspectorPilar). En la pestana de vigas el
// paño acompaña a la viga (editor principal), asi que alli NO muestra estado vacio: lo
// cubre el de InspectorViga y dos "Selecciona…" apilados serian ruido.
function EstadoVacioPano({ mensaje }: { mensaje: string }) {
  return (
    <PanelFlotante className="cx-inspector-pano" titulo="Propiedades">
      <p className="cx-inspector-vacio">{mensaje}</p>
    </PanelFlotante>
  );
}

export function InspectorPano() {
  const seleccion = seleccionStore((s) => s.seleccion);
  const panos = modeloStore((s) => s.modelo.panos);
  // Nudos del perimetro: para el bloque de dimensiones D8b. Suscripcion ligera.
  const nudos = modeloStore((s) => s.modelo.nudos);
  // Modelo completo para la linea de cargas de planta (F3.4; antes de grupo): la
  // fuente unica `cargasPlantaDePano` necesita plantas. Re-render por edicion de
  // obra: aceptable (cromo HUD visible solo con un paño seleccionado, fuera del lienzo).
  const modelo = modeloStore((s) => s.modelo);
  // Contexto de UI para el estado vacio: solo en Isovalores (editor principal del paño)
  // y con la herramienta de seleccion.
  const pestanaActiva = vistaStore((s) => s.pestanaActiva);
  const herramienta = vistaStore((s) => s.herramienta);

  const [errores, setErrores] = useState<ErrorCampo[]>([]);
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string;
    mensaje: string;
    onConfirmar: () => void;
  } | null>(null);

  const panoId = seleccion.length === 1 ? seleccion[0] : null;
  const pano = panoId ? panos.find((p) => p.id === panoId) ?? null : null;
  // Tipo del paño: gobierna que campos y notas se muestran. Un paño legacy sin `tipo`
  // uni se trata como losa.
  const esUni = pano?.tipo === "unidireccional";

  // Cargas automaticas de la planta que este paño recibira (F3.4; antes de grupo),
  // con la misma fuente que el discretizador. [] si la planta no aporta (linea
  // ausente, GAP-H).
  const cargasPlanta = pano ? cargasPlantaDePano(modelo, pano) : [];

  // Losa PLANA (F2.3; code-review #2): la nota de honestidad se muestra SOLO si el
  // calculo acoplara de verdad pilares interiores a la malla. `pilaresAcoplados` ya
  // es [] con 1 solo pilar (DP1: el paño ni calcula); el paño queda FUERA de porPano
  // si el mallado fallo por el cap (PANO_DEMASIADOS_PILARES); y un par de cabezas en
  // la misma celda (pilaresJuntos) bloquea en validaciones, asi que tambien silencia
  // la nota. Mejora ademas el caso acoplado-por-vigas + 1 pilar interior: antes
  // (umbral >=2 interiores) la nota no salia aunque ese pilar SI queda acoplado.
  // Residuo asumido: losa "libre" sobre pilares COLINEALES (bloqueada por
  // PANO_PILARES_INSUFICIENTES) aun la mostraria; ese gate vive en validaciones y
  // duplicarlo aqui podria divergir.
  const acoples = useMemo(
    () => (panoId ? calcularAcoples(modelo) : null),
    [modelo, panoId],
  );
  // La nota de losa plana (pilares interiores acoplados) NO aplica a unidireccional:
  // ahi un pilar interior BLOQUEA el paño (PANO_PILAR_INTERIOR, DP4), no lo acopla.
  const esLosaPlana =
    pano !== null &&
    !esUni &&
    acoples !== null &&
    !acoples.pilaresJuntos.has(pano.id) &&
    (acoples.porPano.get(pano.id)?.pilaresAcoplados.length ?? 0) > 0;

  // Al cambiar de paño seleccionado, limpia los errores de la anterior.
  useEffect(() => {
    setErrores([]);
  }, [panoId]);

  // Sin un paño aplicable (0 seleccionados, multiseleccion, o id no-paño): el
  // inspector no edita nada. En Isovalores con herramienta "seleccion" muestra un
  // estado vacio que guia (UX-C6); en cualquier otro contexto se repliega a null
  // (en la pestana de vigas el editor principal es la viga).
  if (!pano) {
    if (pestanaActiva === "isovalores" && herramienta === "seleccion") {
      const mensaje =
        seleccion.length > 1
          ? `${seleccion.length} elementos seleccionados. Edítalos de uno en uno.`
          : "Selecciona un paño para editar sus propiedades.";
      return <EstadoVacioPano mensaje={mensaje} />;
    }
    return null;
  }

  // Commit generico de un campo: construye DatosPanoUI con el parche, valida, refleja
  // solo los errores de los campos tocados y despacha si pasan. No-op si no cambia.
  const commit = (
    campos: ReadonlyArray<keyof DatosPanoUI>,
    cambios: Partial<DatosPanoUI>,
    parche: CambiosPano,
  ) => {
    const m = leerModelo();
    const actual = m.panos.find((p) => p.id === pano.id);
    if (!actual) return;
    const datos = datosDesde(actual, cambios);
    const errs = validarPano(m, pano.id, datos);
    const camposSet = new Set<string>(campos);
    const errsCampo = errs.filter((e) => camposSet.has(e.campo));
    setErrores((prev) => [
      ...prev.filter((e) => !camposSet.has(e.campo)),
      ...errsCampo,
    ]);
    if (errsCampo.length > 0) return;
    // Comparacion laxa (el paño es una union discriminada; keyof Pano solo cubre los campos
    // comunes). Se lee el campo del paño actual como registro para el chequeo "sin cambio".
    const actualRec = actual as Record<string, unknown>;
    const parcheRec = parche as Record<string, unknown>;
    const sinCambio = Object.keys(parcheRec).every((k) => actualRec[k] === parcheRec[k]);
    if (sinCambio) return;
    modeloStore.getState().ejecutar(editarPano(m, pano.id, parche));
  };

  // --- Borrado ---------------------------------------------------------------
  const ejecutarBorrar = () => {
    modeloStore.getState().ejecutar(eliminarPano(leerModelo(), pano.id));
    seleccionStore.getState().limpiar();
  };

  const borrar = () => {
    const m = leerModelo();
    const nCargas = contarCargasDelPano(m, pano.id);
    if (nCargas === 0) {
      ejecutarBorrar();
      return;
    }
    const frase = nCargas === 1 ? "1 carga asociada" : `${nCargas} cargas asociadas`;
    setConfirmacion({
      titulo: `Eliminar el paño ${pano.nombre}`,
      mensaje: `Se eliminará el paño ${pano.nombre} y ${frase}. Podrás deshacerlo con Ctrl+Z.`,
      onConfirmar: ejecutarBorrar,
    });
  };

  // D8b: dimensiones del paño (ancho × alto, solo lectura). Del bounding box de su
  // perimetro (modelo.nudos). El bloque no se pinta si el perimetro no resuelve.
  const dimensiones = dimensionesDePano(nudos, pano);

  // Variantes ESTRECHADAS por `tipo` (union discriminada): cada bloque de campos lee solo los
  // que su variante porta. `esUni` (booleano) NO estrecha `pano` en TS, por eso se derivan
  // estas referencias. La losa maciza es la variante con espesor/tamMalla; la unidireccional
  // la de viguetas. Un paño reticular no tiene UI de edicion aqui (no se ofrece en creacion).
  const panoLosa = pano.tipo === "losa" ? pano : null;
  const panoUni = pano.tipo === "unidireccional" ? pano : null;

  return (
    <>
      <PanelFlotante
        className="cx-inspector-pano"
        titulo={`Paño ${pano.nombre}`}
        tag="losa"
      >
        {/* Tipo del paño en solo-lectura (cabecera de propiedades): el tipo lo fija la
            introduccion grafica (el selector del panel de creacion), no se cambia aqui
            para no alterar la geometria/campos de un paño ya colocado. Etiqueta de obra. */}
        <div className="cx-inspector-pano__geom">
          <span className="cx-inspector-pano__geom-etq">Tipo</span>
          <span className="cx-inspector-pano__geom-val">
            {esUni ? "Forjado unidireccional" : "Losa maciza"}
          </span>
        </div>

        {/* D8b: dimensiones del paño (solo lectura). Ancho × alto en m (2 decimales,
            mono). Derivadas de la geometria en planta; no se editan aqui. */}
        {dimensiones ? (
          <div className="cx-inspector-pano__geom">
            <span className="cx-inspector-pano__geom-etq">Dimensiones</span>
            <span className="cx-inspector-pano__geom-val">
              {fmt2(dimensiones.ancho)} × {fmt2(dimensiones.alto)} m
            </span>
          </div>
        ) : null}

        <SelectMaterial
          etiqueta="Material"
          valor={pano.materialId}
          onCambio={(id) => commit(["materialId"], { materialId: id }, { materialId: id })}
        />
        {errorDe(errores, "materialId") ? (
          <div className="cx-campo__error" role="alert">
            {errorDe(errores, "materialId")}
          </div>
        ) : null}

        {/* Campos de la LOSA MACIZA: espesor + tamaño de malla. Solo bajo la variante losa
            (la vigueta no es una placa mallada; el reticular no se edita aqui). */}
        {panoLosa ? (
          <>
            <CampoLongitudMm
              etiqueta="Espesor"
              valorM={panoLosa.espesor}
              onValorM={(m) => commit(["espesor"], { espesor: m }, { espesor: m })}
              error={errorDe(errores, "espesor")}
            />
            <CampoLongitudMm
              etiqueta="Tamaño de malla"
              valorM={panoLosa.tamMalla}
              onValorM={(m) => commit(["tamMalla"], { tamMalla: m }, { tamMalla: m })}
              error={errorDe(errores, "tamMalla")}
            />
          </>
        ) : null}

        {/* Campos del forjado UNIDIRECCIONAL: direccion de viguetas, intereje, canto,
            ancho de nervio y peso propio. Solo bajo la variante "unidireccional". Commit en
            vivo (mismo patron que el resto de campos del inspector). */}
        {panoUni ? (
          <>
            <CampoDireccionViguetas
              className="cx-inspector-pano__campo"
              valor={panoUni.direccionViguetas}
              onValor={(v) =>
                commit(["direccionViguetas"], { direccionViguetas: v }, { direccionViguetas: v })
              }
            />
            <CampoLongitudMm
              etiqueta="Intereje"
              valorM={panoUni.intereje}
              onValorM={(m) => commit(["intereje"], { intereje: m }, { intereje: m })}
              error={errorDe(errores, "intereje")}
            />
            <CampoLongitudMm
              etiqueta="Canto"
              valorM={panoUni.canto}
              onValorM={(m) => commit(["canto"], { canto: m }, { canto: m })}
              error={errorDe(errores, "canto")}
            />
            <CampoLongitudMm
              etiqueta="Ancho de nervio"
              valorM={panoUni.anchoNervio}
              onValorM={(m) => commit(["anchoNervio"], { anchoNervio: m }, { anchoNervio: m })}
              error={errorDe(errores, "anchoNervio")}
            />
            <CampoPesoPropio
              className="cx-inspector-pano__campo"
              valor={panoUni.pesoPropio}
              onValor={(v) => commit(["pesoPropio"], { pesoPropio: v }, { pesoPropio: v })}
              error={errorDe(errores, "pesoPropio")}
            />
          </>
        ) : null}

        <CampoBordeApoyo
          className="cx-inspector-pano__campo"
          valor={pano.bordeApoyo}
          onValor={(v) => commit([], { bordeApoyo: v }, { bordeApoyo: v })}
        />

        {esUni ? (
          /* Nota de honestidad del forjado unidireccional (sustituye a la de la losa):
             reparto en UNA direccion (las viguetas descargan en sus dos bordes de
             apoyo; los bordes paralelos no reciben carga), biapoyadas (empotrado se
             comporta como apoyado) y deuda de los esfuerzos por vigueta. El bordeApoyo
             "empotrado" no empotra el giro bajo unidireccional (DP3 del contrato). */
          <p className="cx-note">
            El forjado reparte en una dirección: las viguetas descargan en sus dos bordes
            de apoyo (los bordes paralelos no reciben carga). Son biapoyadas: un borde
            empotrado se comporta como apoyado. Los esfuerzos de cada vigueta aún no se
            consultan por separado.
          </p>
        ) : (
          /* UX-C9 (reescrita en F3.2; ampliada en F2.3): la losa DESCARGA en el
             portico cuando su contorno coincide con vigas, y ademas en los pilares que
             queden por DENTRO de su superficie (losa plana, pilares acoplados); el
             bordeApoyo queda como fallback de los bordes sin viga. Lenguaje de obra,
             sin sobre-prometer. */
          <p className="cx-note">
            La losa descarga en las vigas y pilares de su contorno cuando los comparte, y
            también en los pilares que queden por dentro de su superficie; en los bordes
            sin viga se usa el apoyo de borde elegido.
          </p>
        )}

        {/* Nota de honestidad (F2.3, losa plana): cuando la losa se apoya en pilares
            interiores, el pico de momento sobre la cabeza del pilar depende del
            tamaño de malla y no converge (deuda T-f3-losa-plana-momento-local); la
            flecha y el axil del pilar SI son fiables. Advertencia CUALITATIVA en
            lenguaje de obra: no promete un valor, avisa de lo que aun no es de diseño.
            El armado a punzonamiento sobre el pilar llega en una fase posterior. */}
        {esLosaPlana ? (
          <p className="cx-note">
            Esta losa se apoya en pilares por dentro de su superficie. La flecha y la
            carga que baja por cada pilar son fiables; en cambio, el momento justo sobre
            la cabeza del pilar es orientativo (varía al afinar el tamaño de malla). El
            dimensionado de la losa sobre el pilar (punzonamiento) llegará en una fase
            posterior.
          </p>
        ) : null}

        {/* Linea informativa de cargas de PLANTA (F3.4; antes de grupo): lo que este
            paño recibe automaticamente de su planta, con la MISMA fuente que el
            calculo (cargasPlantaDePano). Ausente si la planta no aporta (valores a 0). */}
        {cargasPlanta.length > 0 ? (
          <p className="cx-note cx-inspector-pano__grupo">
            Recibe además, de su planta:{" "}
            {cargasPlanta
              .map(
                (cg) =>
                  `${fmtCarga(cg.presion)} kN/m² de ${
                    cg.case === CASE_CM_PLANTA ? "cargas muertas" : "sobrecarga de uso"
                  }`,
              )
              .join(" y ")}
            .
          </p>
        ) : null}

        <SeccionCargaSuperficial panoId={pano.id} />

        <div className="cx-inspector-pano__acciones">
          <Boton variante="ghost" onClick={borrar}>
            Eliminar paño
          </Boton>
        </div>
      </PanelFlotante>

      <Dialogo
        open={confirmacion !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmacion(null);
        }}
        titulo={confirmacion?.titulo ?? ""}
        pie={
          <>
            <Boton variante="ghost" onClick={() => setConfirmacion(null)}>
              Cancelar
            </Boton>
            <Boton
              variante="danger"
              onClick={() => {
                confirmacion?.onConfirmar();
                setConfirmacion(null);
              }}
            >
              Eliminar
            </Boton>
          </>
        }
      >
        <p className="cx-inspector-pano__confirmar-texto">{confirmacion?.mensaje}</p>
      </Dialogo>
    </>
  );
}
