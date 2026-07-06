// RotulosElemento: rotula los elementos de obra en la vista PLANTA (D7a, spec §4.1/§6.2).
// Pilares "P1 · HA 30×30" sobre la cabeza; vigas "V3" (o "V3 · seccion" si cabe) en el
// punto medio. Solo en planta (en 3D el texto flotante es ruido; decision D7a).
//
// El helper PURO que genera {texto, posicion} vive en ./etiquetasElemento; este componente
// solo lo pinta con drei <Text>. Nombres de fichero distintos a proposito (RotulosElemento
// .tsx vs etiquetasElemento.ts) para evitar la colision por casing de Windows/TS.
//
// RENDIMIENTO (regla #11): las etiquetas se DERIVAN junto a la geometria (useMemo sobre la
// geometria ya derivada + el modelo), NUNCA por frame. La geometria se reconstruye solo al
// cambiar modelo/grupo/planta (useGeometriaModelo), asi que las etiquetas tambien. El
// resaltado (acento si seleccionado) usa una suscripcion ligera a la seleccion (accion del
// usuario, no alta frecuencia), no un tinte por frame. Cada <Text> NO es raycasteable
// (raycast={null}): no estorba al picking de la geometria ni de la colocacion.
//
// FUENTE/TAMANO: se usa la fuente por defecto de troika (Roboto, bundled, offline). Geist
// Mono self-hosted es woff2 (src/styles/fonts); troika (opentype.js) no carga woff2 de
// forma fiable, asi que NO se pasa `font` para no arriesgar el render del lienzo.
// TODO(T-etiquetas-mono): servir un TTF/woff de Geist Mono para pasarlo como `font` y
// unificar la tipografia de datos del lienzo con la de los paneles. El tamaño va en
// UNIDADES DE MUNDO (0.24 m): legible a zoom de trabajo normal (una planta de ~10 m ocupa
// buena parte del viewport) sin tapar la geometria; en unidades de mundo el texto escala
// con el zoom como el resto del dibujo (comportamiento CAD esperado).
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invalidate } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { modeloStore, seleccionStore, vistaStore } from "../../estado";
import type { Modelo } from "../../dominio";
import { hexToken } from "./colores";
import { ENFASIS_PLENO, type EnfasisPestana } from "./enfasisPestana";
import { useGeometriaModelo, type GeometriaModelo } from "./hooks/useGeometriaModelo";
import { nombreSeccion } from "./nombreSeccion";
import {
  etiquetasPilares,
  etiquetasVigas,
  type EtiquetaElemento,
} from "./etiquetasElemento";

// Tamaño del texto en metros de mundo (ver cabecera). ~0.24 m: un rotulo comodo sobre una
// planta de varios metros sin invadir el dibujo.
const TAM_TEXTO_M = 0.24;

// --- Suscripciones ligeras (sin re-render por frame) --------------------------

// True solo en vista planta: las etiquetas solo se dibujan ahi (D7a). subscribeWithSelector
// -> re-render solo al conmutar de modo, nunca por frame.
function useEnPlanta(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modoVista, cb),
    () => vistaStore.getState().modoVista === "planta",
    () => vistaStore.getState().modoVista === "planta",
  );
}

// Set de ids seleccionados (para pintar en acento). Suscripcion a la seleccion: cambia por
// accion del usuario (clic), no por frame. Devuelve el MISMO Set mientras la seleccion no
// cambie de referencia (useSyncExternalStore exige snapshot estable).
function useSeleccion(): readonly string[] {
  return useSyncExternalStore(
    (cb) => seleccionStore.subscribe((s) => s.seleccion, cb),
    () => seleccionStore.getState().seleccion,
    () => seleccionStore.getState().seleccion,
  );
}

// Une la geometria visible con los nombres de dominio (nombre + seccion) para producir las
// etiquetas. PURO respecto a stores: recibe la geometria y el modelo ya leidos. La
// geometria ya viene filtrada por grupo/planta, asi que basta con buscar cada elemento por
// id para recuperar su nombre y su seccion.
function derivarEtiquetas(
  geo: GeometriaModelo,
  modelo: Modelo,
): { pilares: EtiquetaElemento[]; vigas: EtiquetaElemento[] } {
  const pilarPorId = new Map(modelo.pilares.map((p) => [p.id, p]));
  const vigaPorId = new Map(modelo.vigas.map((v) => [v.id, v]));

  const pilares = etiquetasPilares(
    geo.pilares.flatMap((g) => {
      const dom = pilarPorId.get(g.id);
      if (!dom) return []; // geometria sin dominio (no deberia): se omite
      return [
        {
          id: g.id,
          nombre: dom.nombre,
          seccionNombre: nombreSeccion(dom.seccionId, modelo.secciones),
          cx: g.cx,
          cy: g.cy,
          cz: g.cz,
          alto: g.alto,
        },
      ];
    }),
  );

  const vigas = etiquetasVigas(
    geo.vigas.flatMap((g) => {
      const dom = vigaPorId.get(g.id);
      if (!dom) return [];
      return [
        {
          id: g.id,
          nombre: dom.nombre,
          seccionNombre: nombreSeccion(dom.seccionId, modelo.secciones),
          ax: g.ax,
          ay: g.ay,
          bx: g.bx,
          by: g.by,
          z: g.z,
        },
      ];
    }),
  );

  return { pilares, vigas };
}

// Un rotulo de texto no raycasteable. Color en acento si el elemento esta seleccionado
// (spec §6.2), --text-2 en reposo. anchorX/Y="center" lo centra sobre el punto.
function Rotulo({
  etiqueta,
  seleccionado,
}: {
  etiqueta: EtiquetaElemento;
  seleccionado: boolean;
}) {
  const color = seleccionado ? hexToken("accentLine") : hexToken("text2");
  return (
    <Text
      position={[etiqueta.x, etiqueta.y, etiqueta.z]}
      fontSize={TAM_TEXTO_M}
      color={color}
      anchorX="center"
      anchorY="middle"
      // No captura el puntero: el picking de la geometria/colocacion debe atravesarlo.
      raycast={() => null}
    >
      {etiqueta.texto}
    </Text>
  );
}

// `enfasis` (UX-1.4): los rotulos de un tipo ATENUADO por la pestana activa se ocultan
// (texto a pleno color sobre geometria gris = incoherente). Default: todo pleno, para
// no obligar a los montajes existentes/tests a pasar el prop.
export function RotulosElemento({
  enfasis = ENFASIS_PLENO,
}: {
  enfasis?: EnfasisPestana;
} = {}) {
  const enPlanta = useEnPlanta();
  const geo = useGeometriaModelo();
  const seleccion = useSeleccion();

  // Deriva las etiquetas junto a la geometria (no por frame): recomputa cuando cambia la
  // geometria (que ya depende de modelo/grupo/planta). El modelo se lee con getState() en
  // el mismo memo; su referencia cambia con la geometria (misma suscripcion en el hook).
  const { pilares, vigas } = useMemo(
    () => derivarEtiquetas(geo, modeloStore.getState().modelo),
    [geo],
  );

  const selSet = useMemo(() => new Set(seleccion), [seleccion]);

  // Pinta un frame al cambiar etiquetas/seleccion/visibilidad/enfasis (frameloop=
  // "demand": montar texto o cambiar su color no programa frame por si solo).
  useEffect(() => {
    invalidate();
  }, [pilares, vigas, selSet, enPlanta, enfasis]);

  if (!enPlanta) return null;

  return (
    <group>
      {enfasis.pilares === "pleno" &&
        pilares.map((e) => (
          <Rotulo key={e.id} etiqueta={e} seleccionado={selSet.has(e.id)} />
        ))}
      {enfasis.vigas === "pleno" &&
        vigas.map((e) => (
          <Rotulo key={e.id} etiqueta={e} seleccionado={selSet.has(e.id)} />
        ))}
    </group>
  );
}
