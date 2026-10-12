# Fase I1: armazón de la interfaz v4

> **Qué es.** La primera fase de la interfaz v4 (`interfaz.md`): la app de V1 y V2a reorganizada en espacios de trabajo, con barra de herramientas, navegador, propiedades y panel inferior plegables, carril de plantas y paleta de órdenes. El dibujo de la planta y del 3D sigue siendo el de V1; su grafismo es de I2. Lo que se fijó al empezar está en `interfaz.md` §13. **Fecha:** 2026-10-12.
>
> **Estado:** pasan los cuatro criterios de §13.1. El 2 lleva el fallo que ya tenía V1 en su criterio 4 (V1-3), igual que antes. Falta la puerta de uso del usuario.

## 1. Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | El dibujo manda: en Modelo, con los paneles por defecto y nada elegido, la vista ocupa ≥ 70 % en 1920×1080 y ≥ 60 % en 1366×768 | **Pasa:** 72,8 % y 63,0 % (`validacion/i1/out_chrome.txt`) |
| 2 | No se pierde nada de V1 ni de V2a | **Pasa.** Los tests de DOM de V1 y V2a pasan cambiando sólo cómo se llega a cada pantalla (17 de 17 en `app/`). Los bancos de Chrome, adaptados a los nuevos sitios, dan los mismos sha256 en los cuatro proyectos (V1) y la misma huella de lo guardado (V2a). El único FALLA es el de V1-3 (la primera magnitud SPR de una planta, 579 ms frente a 592 ms en V1). La lista, en §2 |
| 3 | Lo que no vale nunca se enseña como válido | **Pasa:** las reglas de V1 no se tocan (`useProyecto`), y Resultados y Revisión no se abren sin un cálculo de esta huella. El test de DOM de V2a lo comprueba tras editar |
| 4 | Fluidez: cambiar de espacio, modo o panel sin tareas largas de más de 50 ms (edificio objetivo) | **Pasa:** 23 pasos (espacios, modos, 3D, tablas, plegar y abrir, paleta, temas) y ninguna tarea larga |

## 2. Dónde está ahora cada cosa

| V1 / V2a | I1 |
|---|---|
| Cabecera: seis pantallas | Barra superior: cuatro espacios (Modelo, Cargas, Resultados, Revisión). Las pantallas de resultados son modos de Resultados |
| Deshacer, rehacer, guardar, estado, calcular, abrir, tema | Igual, en la barra superior. Además, «Buscar u ordenar» (Ctrl+K) |
| Pie | Barra de estado, con lo mismo más las unidades |
| Modelo · panel izquierdo: proyecto (nombre y descripción), recuentos | Navegador: proyecto y objetos por tipo (los de la planta activa, desplegables; un clic elige) |
| Modelo · lista de plantas | Carril de plantas en la vista (también AvPág y RePág) |
| Modelo · vista modelo, diagnósticos o malla | Cabecera de la vista, en Modelo |
| Modelo · vista cargas y su caso | Espacio Cargas: el caso activo en la barra y los casos en el navegador |
| Modelo · resumen de la planta, equilibrio, hipótesis | Propiedades, sin nada elegido |
| Modelo · casos | Navegador de Cargas |
| Modelo · Planta / 3D | Barra de Modelo, a la derecha |
| Modelo · inspector y formulario | Propiedades, con algo elegido (se abren solas al elegir) |
| Modelo · diagnósticos | Panel inferior, pestaña Diagnósticos |
| V2a · tablas | Panel inferior, pestaña Tablas. Pilar, Viga, Losa y Apoyo de la barra abren su tabla en la fila nueva; Plantas, Materiales y Secciones, la suya |
| V2a · copiar a plantas y borrar | En la tabla, como antes, y en la barra para lo elegido (A plantas, Borrar) |
| Losas · magnitud | Barra: Magnitud |
| Losas · combinaciones | Barra: Combinaciones (lo mismo en los cuatro modos) |
| Losas · valor en el punto, extremos, flechas, equilibrio | Propiedades |
| Losas · tabla de combinaciones | Panel inferior |
| Vigas · esfuerzo | Barra: Esfuerzo |
| Vigas · lista de piezas | Navegador de Diagramas |
| Vigas · alzado de la pieza y estación | Panel inferior, pestaña Alzado (abierta por defecto) |
| Vigas · en la estación, vanos | Propiedades |
| Pilares · ν > 0,65 en la planta | Propiedades |
| Pilares · cuadro de la planta | Panel inferior, pestaña Cuadro (abierta por defecto) |
| Pilares · pilar elegido por tramos | Propiedades |
| Desplomes · escala | Barra: Escala de la deformada |
| Desplomes · tabla por planta | Panel inferior, pestaña Desplomes por planta |
| Desplomes · perfil del maestro, plantas que pasan | Propiedades |
| Revisión · índice | Navegador |
| Revisión · firma, identidad, comprobaciones | Propiedades. Además, el estado de la firma y «Orden de firmar» (copia la orden) en la barra |

## 3. Hallazgos

- **I1-1. El panel inferior se cerraba solo.** Un proyecto sin pilares abre las tablas por defecto. Al meter el primer pilar el defecto cambiaba y el panel se plegaba en mitad del trabajo. Lo encontró el test de DOM de V2a. Ahora el defecto se decide al entrar en el espacio.
- **I1-2. Con los dos paneles laterales abiertos no se llega al 70 %.** En 1920×1080 se queda en un 61 % (calculado con los anchos de los paneles: 1372×924 px). Por eso, en Modelo y Cargas las propiedades empiezan plegadas y se abren al elegir. En Resultados y Revisión empiezan abiertas, porque allí son la mitad de la información.
- **I1-3. V1-3 sigue igual.** La primera magnitud SPR de una planta (M11 tras uz) tarda unos 580 ms, por encima de los 500 del criterio 4 de V1. Es la recuperación SPR en el worker, no la interfaz. Sigue como pendiente técnico (C5-4).
- **I1-4. Los rótulos de A4 se salen de la caja de la escena.** Por la izquierda quedaban bajo el carril de plantas. El dibujo deja ahora 128 px a la izquierda y 36 arriba. Lo de fondo, que los rótulos dependan del zoom, es de I2.
- **I1-5. Chrome headless toma el tema oscuro del sistema.** El banco de I1 fuerza el claro, y el recorrido pasa por los dos.

## 4. Validación

- `app/src/test/`: los tests de DOM de V1 (`pantallas.test.tsx`, ahora sobre los modos) y de V2a (`editor.test.tsx`). Este último comprueba además que sin cálculo no se entra en Resultados ni en Revisión, y que la paleta encuentra las tablas.
- `validacion/i1/chrome.ts` (`out_chrome.txt`): criterios 1 y 4. Con `--capturas <carpeta>`, una PNG por espacio y modo.
- `validacion/v1/chrome.ts` y `validacion/v2a/chrome.ts`: adaptados a los nuevos sitios; sus `out_chrome.txt`, de nuevo.

## 5. Pendiente

- **Del usuario:** la puerta de uso, que es usar la app con un proyecto suyo y decir qué le falta o le sobra del armazón.
- **I2:** el motor de vistas (planta y alzado en WebGL con el grafismo de §8, ViewCube, 1/2/4 vistas, rótulos por zoom y ejes de replanteo).
