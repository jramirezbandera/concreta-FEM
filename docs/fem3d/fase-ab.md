# Fase AB — mapas de armado y armadura base: informe

> **Fecha:** 2026-10-13. **Plan:** `armado.md` (lo fijado al empezar, con las decisiones del usuario).
>
> **Resultado:** pasan los criterios 1 a 7; el 6, con el área a la precisión de Float32 (AB-4). El 8 (puerta de uso) es del usuario.

## Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | Unidades | **Pasa.** La leyenda lleva el título «X superior · M_Ed (Wood–Armer) · kN·m/m» en planta, en 3D y en el SVG de `fem render`; la cabecera de la vista, «Armado · X superior · kN·m/m». |
| 2 | Bit a bit con las consultas | **Pasa.** `valor-armado` en el centro de los tramos de las cuatro armaduras da su estación de `fem consultar franja` (`src/visor/armado.test.ts`). En Chrome, las 71 zonas de N7 y el valor de un clic son los de Node bit a bit (`validacion/ab/out_chrome.txt`). |
| 3 | Zonas de refuerzo | **Pasa.** Partición exacta de lo que supera la base, zonas conexas, sin depender del orden, ninguna con la base en el máximo, área a 1e-9 (`src/agente/refuerzos.test.ts`). |
| 4 | Rótulos | **Pasa.** Sin base, un rótulo por pico de prominencia ≥ 5 %; con base, uno por zona con el exceso. |
| 5 | Proyecto | **Pasa.** `armado` fuera de la huella, esquema generado, validación (`armado/base`, `armado/losa`, también en `fem validar`), renombrar, borrar y renumerar losas lo siguen, deshacer (`src/agente/armaduraBase.test.ts`). En Chrome, cambiar la base no cambia la huella ni pasa por otro estado que «calculado», y las zonas nuevas salen en 0,03 s. |
| 6 | 3D | **Pasa, con salvedad.** El área de los triángulos es la de los tramos a 1e-6, no a 1e-9 (AB-4); la z es la de las láminas de la losa; con una planta, la leyenda y la escala de la planta. En Chrome, los triángulos de todas las plantas son los de Node (366), y la sonda dice el valor de Node. |
| 7 | Rendimiento | **Pasa.** En Chrome, el mapa con base sale en 1,50 s y sin base en 1,68 s; el valor de un clic, en 7 ms; ninguna tarea larga. |
| 8 | Puerta de uso | **Del usuario.** |

## 1. Qué hay

- **Proyecto (`src/agente/armaduraBase.ts`):** el campo `armado`, con una base común y otra por losa, y las funciones `baseDe`, `comprobarArmado` y `seguirLosas`. La operación `armado` del editor.
- **Zonas y picos (`src/agente/refuerzos.ts`):** tramos de las franjas, picos con su prominencia, zonas de refuerzo con su contorno y su caja. La consulta `refuerzos` y `fem consultar refuerzos --armadura`.
- **Render (`src/agente/render/armado.ts`):**
  - `mapaArmado`, común a la planta y al 3D;
  - el título de la leyenda (`Escena.tituloLeyenda`, también en el SVG);
  - lo cubierto en gris, el contorno de las zonas y los rótulos;
  - `fem render` lee la base del proyecto.
- **Visor (`src/visor/armado.ts`):**
  - los tramos en caché por resultados, planta, armadura y combinaciones;
  - los pedidos `valor-armado` y `armado3d`;
  - `datosArmado` devuelve también las zonas.
- **App (`app/src/pantallas/Armado.tsx`):**
  - planta y 3D;
  - un clic marca el valor del punto y elige su franja;
  - en la barra, el interruptor «Lo que no cubre / Todo»;
  - en Propiedades, el valor del punto, la armadura base (común y por losa), la zona o la franja (su diagrama, con la base discontinua) y «Qué se dibuja»;
  - en el panel inferior, la pestaña Refuerzos, en la que un clic elige la zona y la encuadra.
- **La base va en cada pedido** (la del proyecto que se edita), y `useProyecto` no reabre el proyecto cuando una edición sólo cambia `armado` (`soloArmado`).

## 2. Hallazgos

- **AB-1, lo cubierto tardaba 22 s en Chrome.** Un polígono con miles de anillos se orientaba en tiempo cuadrático (`orientarAnillos`): 2,1 s en Bun. Ahora cada corrida de tramos cubiertos es un polígono de un anillo, y tarda 1 ms.
- **AB-2, pilares anchos.** Entre las dos caras de un pilar no hay estaciones. Con un pilar de más de 0,5 m, el tope de un paso deja un hueco entre sus tramos, y su refuerzo salía en dos zonas. Ahora se unen los tramos de estaciones seguidas; a través de una estación que no vale (un hueco de la losa), no.
- **AB-3, el 3D enseña todas las plantas** al pasar la vista de planta a 3D, como en Losas. Rotular cada zona de cada planta (82) tapaba el dibujo, así que se rotula la mayor de cada planta; las demás, con la sonda.
- **AB-4, área a 1e-6.** Los búferes del 3D son Float32 respecto al origen, como los de I4. La geometría en Float64 sale de los mismos tramos; lo que se compara a 1e-9 es la de la planta.
- **AB-5, muchas zonas pequeñas.** En el edificio objetivo, con 20 kN·m/m en X superior, N7 tiene 71 zonas, casi todas a lo largo de las vigas y en las caras de los pilares, de 0,25 a 1 m de largo. Es lo que da el cálculo, pero la lista es larga. Agruparlas por apoyo sería una propuesta aparte.
- **AB-6, combinaciones por defecto distintas.** Sin acciones en los casos, `fem consultar` toma por defecto los casos sin mayorar, y la app, 1,4·(G + Q). Con la misma combinación dan las mismas zonas. Viene de antes de AB.
- **AB-7, `aplicar` copiaba `vistas`** en cada operación de datos. Ahora sólo las copia si cambian, porque la app compara referencias para no reabrir el proyecto.

## 3. Pendiente

- **La puerta de uso (criterio 8):** que el usuario ponga la base de una losa suya y diga si con las zonas de refuerzo puede armarla.
- **Ø y separación**, como atajo que rellena los kN·m/m (decidido, fuera de AB): la flexión simple copiada de Concreta y validada.
- **El título de la leyenda en los demás mapas** (Losas, Vigas…): cambia sus SVG.
- **Si la lista de zonas molesta (AB-5),** agruparlas por apoyo o fijar una longitud mínima.

## Cómo reproducir

- `bunx vitest run src/agente/armaduraBase.test.ts src/agente/refuerzos.test.ts src/visor/armado.test.ts` y, en `app/`, `bunx vitest run src/test/armado.test.tsx`.
- `node validacion/ab/chrome.ts` → `validacion/ab/out_chrome.txt` (con `CAPTURAS=<carpeta>`, las capturas).
- `bun cli/fem.ts consultar <proyecto> refuerzos --armadura x-sup --planta N7`.
