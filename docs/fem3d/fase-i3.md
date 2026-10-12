# Fase I3: el sólido, los filtros y las vistas guardadas

> **Qué es.** La tercera fase de la interfaz v4 (`interfaz.md`): el 3D sólido de §6 (las secciones extruidas de todas las piezas), los modos sólido y translúcido de §5.2, los filtros de §5.3 (rango de plantas, tipos, aislar, ocultar y caja de sección), la profundidad del alzado y las vistas guardadas en el proyecto que I2 dejó para aquí. Lo fijado al empezar está en `interfaz.md` §16. **Fecha:** 2026-10-12.
>
> **Estado:** pasan los cinco criterios de §16.1. Falta la puerta de uso del usuario, que también tiene que revisar las propuestas de §16 (sobre todo, qué se recorta de cada pieza bajo la losa, I3-1, y que en Resultados el sólido se pinte translúcido, I3-8).

## 1. Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | Volumen, en Node | **Pasa** (`src/visor/solido.test.ts`, 73 tests en 14 modelos: los cuatro de V1, la retícula con núcleo, el edificio con muros de C3, el reticular y el unidireccional de C4, las cinco familias de G con hueco y un modelo con todo lo raro). Cada pieza es cerrada (su volumen con dos orígenes distintos difiere ≤ 1e-9) y con la normal hacia fuera; su volumen es el de sus datos menos lo que tapa la losa, calculado con `momentosInterseccion` y `fraccionEnRegiones` de `poligonos.ts`, a ≤ 1e-9; por planta, Σ γ·(V dibujado + lo tapado) es el peso esperado de A3 de pilares, vigas, losas macizas y muros a ≤ 1e-9, y lo que se quita a las vigas rectangulares de hormigón es el solape de C2-g (a 1e-9 con vigas rectas; 0,14 % en la planta circular, con quiebros); el reticular, a ≤ 2,5 % de la fórmula (−0,03 % en el grande); los búferes, iguales con las listas al revés |
| 2 | Rendimiento | **Pasa** (`validacion/i3/out_chrome.txt`, RTX 4060 Ti a 120 Hz). Edificio objetivo: el sólido llega en ~0,2 s sin tareas largas; orbitar el sólido, el translúcido y con la caja, a una mediana de 8,3 ms entre fotogramas; filtrar y mover la caja, sin tareas largas. Reticular grande (300 790 triángulos): llega en ~1,3 s (lo hace el worker), sin tareas largas en el hilo principal, y se orbita a 8,3 ms |
| 3 | En Chrome, lo pintado es lo de Node | **Pasa.** Los triángulos y las aristas que llegan al motor tienen el sha256 de los de la sesión en Node (edificio y reticular); con aislar (H), ocultar (Ctrl+H), mostrarlo todo (Mayús+H), un rango de plantas y sin losas, la lista de triángulos que se pintan es la del filtro en Node; un clic sobre el pilar de la fachada que mira a la cámara lo elige; la caja empieza alrededor de lo elegido y arrastrar su asa mueve su cara lo que el cursor recorre (10 m) |
| 4 | Vistas guardadas | **Pasa** (`src/editor/editor.test.ts` y `app/src/test/i3.test.tsx`): guardar, renombrar y borrar son la operación `vistas` del editor, que pasa el esquema (nombres no vacíos y sin repetir), no cambia la huella y se deshace hasta los bytes del principio; el fichero las lleva tras las opciones y se vuelve a leer igual; en la app, el navegador las lista, las renombra y las borra (Ctrl+Z la devuelve), y abrir una deja la vista activa con su modo y sus filtros |
| 5 | No se pierde nada | **Pasa.** Los 1 524 tests del repo y los 29 de DOM de `app/` pasan; los bancos de I1, I2 (adaptado: su 3D se pone en alámbrico, que es lo que mide) e I4 dan lo mismo |

## 2. Lo que hay

- **Puro, en `src/visor/solido.ts`** (pedido `solido`; la sesión lo hace una vez y da una copia, porque se va por Transferable):
  - `descomponer`: descomposición en trapecios de una huella (anillos, par-impar) con capas (las losas y los paños de la planta, cada una con su espesor), en el sistema de la pieza; `prismas`: las caras de cada celda con sus intervalos de cota y las paredes donde el vecino no tiene esa cota. Así la superficie sale cerrada, sin caras dentro, y el volumen es exacto.
  - `barrido`: las barras horizontales de sección I, T o circular, por tramos de su eje con la sección recortada bajo la losa y sus tapas.
  - `huellasInglete`: los quiebros de vigas y muros a inglete (cada huella mide b·L) y el muro cerrado unido también en su primer punto.
  - `formaSeccion`: el polígono de cada sección con su área (el círculo de 32 lados de la misma área, la I con el alma del área del catálogo).
  - `aristasDe`: en cada plano, el borde de la suma con signo de sus caras (dos caras que se tapan no dejan borde), y de esos bordes los que separan planos de más de 30° (un círculo, sólo sus tapas). Las claves de planos y líneas, por un hash numérico de sus enteros cuantizados.
  - `solido`: triángulos (en abanico de cada cara convexa) con su objeto y su planta, y aristas, en Float32 respecto al origen del alámbrico.
- **La geometría analítica** (`geometria3D`) lleva el objeto físico de cada barra y lámina, para filtrar también el analítico.
- **El proyecto** (`src/agente/proyecto.ts`) admite `vistas` (`VistaGuardada`: tipo, planta o eje, modo, proyección, color, profundidad, cámara y filtros), fuera del modelo; el esquema se regeneró y el del modelo físico no cambia. El editor tiene la operación `vistas`.
- **En la app:**
  - **Vista 3D** (`vistas/vista3d.ts`): modos sólido (por defecto en las vistas nuevas), translúcido (35 %, con los ejes encima), alámbrico y analítico; color por material, sección o planta; en sólido se elige con un rayo contra los triángulos que se ven y dentro de la caja; los filtros rehacen índices, no geometría; la caja son seis planos de recorte comunes a todos los materiales del 3D (siempre seis, lejos sin caja: encenderla no recompila nada) con asas en sus caras;
  - **la celda** (`vistas/Zona.tsx`): el selector de los cuatro modos; en la barra, la caja de sección, las opciones de la vista (color, tipos y rango de plantas) y guardar la vista; en la cabecera, un chip por filtro, que lo quita; en un alzado, la profundidad (0,25 a 5 m);
  - **atajos** (`App.tsx`): H aísla lo elegido en el 3D activo (otra vez, lo suelta), Ctrl+H lo oculta y Mayús+H lo muestra todo (la caja se queda);
  - **navegador** (`armazon/VistasGuardadas.tsx`), en Modelo y en Cargas: las vistas guardadas, para abrirlas en la vista activa (con su cámara: la celda rehace su vista), renombrarlas y borrarlas.
- **Tiempos del sólido en el worker:** edificio objetivo, 19 936 triángulos y 15 372 aristas en 0,12 s; reticular grande (V2 de C4), 300 790 y 166 397 en ~1,4 s (la mitad, las aristas); unidireccional grande (V3), 123 648 y 71 596 en 0,6 s.

## 3. Hallazgos

- **I3-1. Lo que se dibuja no es siempre lo que pesa.** El sólido no repite lo que tapa la losa de la cabeza de un pilar o de un tramo de muro, ni lo que tapa una losa a una viga de cualquier sección. El peso de A3 (y el del compilador) sí cuenta la cabeza del pilar (A-9: del lado de la seguridad), reparte el solape de un muro mitad en la planta de arriba y mitad en la de abajo (C3-g: el dibujo lo quita entero en la cabeza de cada tramo, así que por planta difieren y en total coinciden) y sólo descuenta el descuelgue en las vigas rectangulares de hormigón (C2-g). Por eso el criterio 1 compara lo dibujado más lo tapado con A3, y lo tapado de las vigas rectangulares de hormigón con el solape de A3.
- **I3-2. A3 mide el solape de una viga con quiebros con la huella a escuadra.** El dibujo une los tramos a inglete (cada huella mide b·L, sin huecos ni solapes en el quiebro), así que el solape con la losa difiere en los quiebros: 0,14 % en la planta circular de G.
- **I3-3. El reticular dibujado y su fórmula.** Con los nervios a su intereje desde el origen, partidos en los cruces y fuera de los ábacos, el volumen del reticular grande queda a −0,03 % de la fórmula de A3 (C4-i); la diferencia es de los bordes.
- **I3-4. Three calcula la esfera envolvente aunque no se recorte por el frustum.** La usa para ordenar lo que pinta: con 300 000 triángulos eran ~40 ms en el hilo principal al llegar el sólido. Se le da hecha desde la caja del sólido. Con eso, los colores en bytes y sin un búfer de normales (sombreado plano en el shader), la llegada del reticular grande no tiene tareas largas.
- **I3-5. El polygonOffset de las caras dejaba ver aristas de detrás.** Depende de la pendiente de la cara en pantalla, así que, vista de lado, una cara se iba más atrás que los 5 cm a los que están los nervios bajo la capa de un reticular: su rejilla se veía a través de la capa. Ahora las caras no se desplazan y las aristas se acercan a la cámara 2·10⁻⁴ de su distancia (en el shader).
- **I3-6. Arrastrar un asa con la dirección en pantalla de 1 m se desvía con la perspectiva** (10 m de arrastre daban 9,4 m). La cara sigue el punto del eje de la cara más cercano al rayo del cursor.
- **I3-7. El sólido es caro en el reticular, y casi todo son aristas.** ~5 600 cajas de nervio por planta: 300 790 triángulos y 166 397 aristas. Orbitarlo va a 120 fps en sobremesa; en un móvil no se ha medido.
- **I3-8. En Resultados, el sólido tapa los resultados.** Si una vista 3D está en sólido, en Resultados se pinta translúcida (§16 lo deja así; el usuario lo revisa).
- **I3-9. Las vistas guardadas no siguen los renombrados.** Están fuera del modelo, así que renombrar una planta o un eje no las cambia: al abrir la vista, una planta o un eje que ya no existen se cambian por el primero.

## 4. Validación

- `src/visor/solido.test.ts`: cierre, volúmenes, contraste con A3, búferes y aristas.
- `src/editor/editor.test.ts`: la operación `vistas`.
- `app/src/test/i3.test.tsx`: modos, opciones, chips, atajos H, profundidad del alzado y vistas guardadas en la app.
- `validacion/i3/chrome.ts` (`out_chrome.txt`): el edificio objetivo y el reticular grande en Chrome; con `--perfil`, el perfil de CPU de la llegada del reticular. `validacion/i3/sondeo.ts`: tamaños y tiempos del sólido en los modelos de V1, C3 y C4.

## 5. Pendiente

- **Del usuario:** la puerta de uso de I3 y las propuestas de §16: qué se recorta bajo la losa (I3-1), el sólido translúcido en Resultados (I3-8), los colores y la caja.
- **Fuera de I3 (§16):** tapar el corte de la caja; la cimentación y los símbolos de los arranques; los apoyos lineales en el sólido; aislar en la planta y el alzado; el valor bajo el cursor sobre el sólido.
- **Técnico:** medir el sólido del reticular grande en un móvil (I3-7); que las vistas guardadas sigan los renombrados (I3-9).
