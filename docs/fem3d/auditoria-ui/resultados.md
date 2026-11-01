# Auditoría UX/UI: Cargas, Resultados y Revisión

**Fecha:** 2026-11-01. **Ámbito:** los espacios Cargas, Resultados (todos sus modos) y Revisión, el panel inferior y la barra de estado.

**Cómo se probó:**
- Navegador sin interfaz de gstack, a 1600×900, con una pasada a 1366×768 y otra en tema oscuro.
- Ejemplos: `vivienda` (el principal), `muestrario` (viento, sismo, muros, unidireccional) y `edificio` (para medir las esperas).
- **Aviso sobre el entorno:** en `localhost:5180` la página se recargaba sola cada pocos minutos. Es el HMR de Vite: otras sesiones están editando `src/`. Por eso casi todo se verificó en el despliegue de GitHub Pages (`https://jramirezbandera.github.io/concreta-FEM/`, compilado desde `c65b28b`). Entre ese commit y HEAD sólo cambia la documentación. Las primeras capturas (01–05) son de localhost.
- Las capturas están en `C:/Users/javie/AppData/Local/Temp/claude/d--PROGRAMACION-Concreta-FEM/0145a65a-536f-4c1a-bd43-d6b6eb76a5bd/scratchpad/auditoria/resultados/`. Abajo se citan sólo por su nombre de fichero.

---

## Severidad alta

### R-01 · La «Envolvente de una situación» de los mapas de losas no es una envolvente
**Severidad:** alta
**Dónde:** Resultados · Losas, selector de combinaciones (`app/src/componentes/comunes.tsx:80`, el optgroup «Envolvente de una situación»).

**Qué pasa:**
- Al elegir «ELU-SIS (16)», el mapa no es la envolvente. Es una sola combinación: la que da el mayor |valor| en la planta (aquí ELU-SIS-14).
- El usuario lee el valor de un punto creyendo que es el pésimo de las 16 combinaciones, y no lo es.
- Ejemplo verificado en el muestrario, PL1, M22, clic en el mismo punto L2 (5,98; 10,78):
  - con «ELU-SIS (16)», −43,6 kN·m/m;
  - con ELU-SIS-5, −50,3 kN·m/m.
- El mapa de «envolvente» se queda un 13 % por debajo, del lado inseguro.
- Los extremos rotulados van todos a (6,00; 0,15), y el negativo del borde opuesto queda escondido.
- Propiedades sí dice «Se dibuja ELU-SIS-14: la de mayor |valor|…», pero el selector dice «Envolvente».
- Diagramas, en cambio, sí dibuja las dos curvas de la envolvente («envolvente de 8»). La misma palabra significa dos cosas según el modo.
- Es una decisión documentada (`fase-v1.md:70`, `fase-a4.md:80`), pero la experiencia engaña.

**Propuesta:**
- Para M/V/F, dibujar la envolvente de verdad: dos mapas (máx./mín.) o el de mayor |valor| punto a punto, con la combinación de cada punto en el clic.
- Si no, renombrar la opción a «La pésima de ELU-SIS (una combinación)».
- Y que el valor del clic dé también el máximo y el mínimo de la situación en ese punto.

**Captura:** `54-env-sis-punto.png`, `53-sis5-punto.png`, `18-env-elu.png`
**Verificado:** navegador

### R-02 · Una carga se dibuja con un signo y se edita con el contrario
**Severidad:** alta
**Dónde:** Cargas · planta, alzado y Propiedades (rótulos de `src/agente/render/cargas.ts`; formulario y lista de `app/src/pantallas/CargasPieza.tsx`).

**Qué pasa:**
- En el dibujo, la carga muerta sale como «CM-CUB-S: -2 kN/m²». La leyenda dice «valor solo es la componente Z (negativa, hacia abajo)».
- Al elegirla, Propiedades dice «↓ Gravedad, q = 2 kN/m²» y explica «Hacia abajo, en positivo: 2 son 2 kN/m² de peso. En negativo, hacia arriba».
- La lista «Forjado · sus cargas» la da como «Superficie 2,00 kN/m²».
- Tras cambiar q a 3, el dibujo pasa a «-3 kN/m²».
- Un usuario que se guíe por el dibujo y teclee «-3» mete una carga hacia arriba. Lo pararía, como mucho, el aviso de sensatez «cargas hacia arriba», y sólo en G/Q/S.

**Propuesta:** un solo convenio de cara al usuario.
- Rotular las cargas de gravedad sin signo y con flecha («CM-CUB-S ↓ 2 kN/m²»).
- Usar el signo sólo para las componentes globales («Fz = −2»), diciendo cuál es.

**Captura:** `13-clic-carga-sup.png`, `14-props-forjado-cargas.png`, `42-combis-0.png` (−3 en el dibujo, q = 3 en el formulario)
**Verificado:** navegador

---

## Severidad media

### R-03 · Tras cualquier cambio, «Combinaciones 0» y un mensaje falso
**Severidad:** media
**Dónde:** panel inferior · Combinaciones, en Modelo y Cargas (`app/src/espacios/Modelo.tsx:798`; el estado sin calcular trae `combinaciones: []`, en `src/visor/sesion.ts:431`).

**Qué pasa:**
- Se cambia el valor de una carga sin tocar los casos.
- La pestaña pasa a «Combinaciones 0» y dice «Sin combinaciones: los casos no llevan su acción (tipo, ψ y familia), así que no hay combinaciones CTE/NCSE».
- Es falso: los casos siguen con su acción. Las 19 combinaciones vuelven al pulsar Calcular.
- Pasa también al abrir el proyecto, mientras compila.

**Propuesta:**
- Generar las combinaciones desde los casos (es puro y no necesita el cálculo).
- Si no se puede, decir «Se verán al calcular» y reservar el mensaje de la acción para cuando de verdad falte.

**Captura:** `42-combis-0.png`, `41-resultados-obsoletos.png`
**Verificado:** navegador y código

### R-04 · La «altura de planta» significa dos cosas distintas
**Severidad:** media
**Dónde:**
- Revisión: tabla Modelo y aviso `sensatez/altura`.
- Diagnósticos.
- Resultados · Deformada: tabla de desplomes.

**Qué pasa:** en la vivienda (PB 0,00, CUB +3,40, CUB-S +4,30):
- el informe da «CUB · altura 0,9» y «PB · altura 3,4»;
- el aviso dice «La planta CUB tiene 0,9 m de altura… ¿está en cm o es la de otra planta?»;
- la tabla de desplomes da «CUB · h 3,40 m» y «CUB-S · h 0,90 m».

El dato del modelo es la altura hasta la planta de encima (`fisico.ts:11`). Un ingeniero entiende la de su tramo bajo ella, como hace la tabla de desplomes. El aviso acusa a la planta equivocada.

**Propuesta:** usar en todos los textos la altura del tramo bajo la planta (de su cota a la de abajo), o rotular «altura hasta la planta de encima». El aviso debería nombrar el tramo («entre CUB y CUB-S: 0,9 m»).

**Captura:** `23-deformada.png`, `45-revision.png`, `48-diagnosticos.png`
**Verificado:** navegador y código

### R-05 · Las reacciones salen por defecto por casos sueltos
**Severidad:** media
**Dónde:** Resultados · Reacciones (`app/src/pantallas/Reacciones.tsx:174`).

**Qué pasa:**
- «Por defecto» es «Reacciones · envolvente de casos (3)»: de cada pilar, el caso con mayor |Fz|, que siempre es G.
- «Extremos: mayor hacia arriba 202,1 kN · P11» no dice que es sólo G. Es fácil tomarlo como la reacción de cálculo.
- La pestaña «Totales por combinación» lista G, Q y N, que son casos.
- La leyenda dice «De las 3 combinaciones de casos».

**Propuesta:**
- Por defecto, la ELS característica (o GEO) para cimentación, como en desplomes.
- O la tabla por casos en columnas (G | Q | N), como hace el informe en «Cargas en cimentación».
- Corregir los rótulos a «por caso».
- Que «Extremos» diga el caso o la combinación.

**Captura:** `25-reacciones.png`, `26-reacciones-totales.png`
**Verificado:** navegador

### R-06 · El cuadro de pilares mezcla combinaciones sin decirlo
**Severidad:** media
**Dónde:** Resultados · Pilares, «Cuadro bajo …» y detalle del pilar (`app/src/pantallas/Pilares.tsx:204, 252`).

**Qué pasa:**
- Cada columna es el extremo de una combinación distinta. Ejemplo del muestrario, P1: N −268 (ELU-PT-30), |My| 31,4 (ELU-PT-6), |Mz| 32,0 (ELU-PT-52).
- No son esfuerzos concomitantes. Un pilar se dimensiona con ternas N–My–Mz de una misma combinación, y un N bajo con un M alto puede ser el pésimo.
- La nota sólo dice «el mayor de las dos, con su signo».

**Propuesta:**
- Por pilar, las ternas concomitantes de las combinaciones pésimas (N máx., N mín., My máx., Mz máx. con sus concomitantes).
- Como mínimo, un rótulo claro: «Extremos de combinaciones distintas: no son concomitantes».

**Captura:** `55-pilares-3d.png`, `21-pilares.png`, `22-pilar-P13.png`
**Verificado:** navegador

### R-07 · Columnas «|My|», «|Mz|» y «|Vz|» con valores negativos, y sin unidades
**Severidad:** media
**Dónde:**
- Cuadro de pilares (`Pilares.tsx:204-205`): sin unidades.
- Detalle de pilar (`Pilares.tsx:252-253`).
- Vanos de una viga (`Vigas.tsx:466`).

**Qué pasa:**
- La cabecera dice valor absoluto y las celdas traen signo: P15 «|MZ| −4,2», P16 «−6,2», vano 2 de Z-CUB-S-1 «|VZ| −48,4».
- En el cuadro de la planta, «|MY|» y «|MZ|» no llevan unidad, mientras «N kN» sí.

**Propuesta:** cabeceras «My», «Mz» y «Vz» (máx. con su signo) con «kN·m» y «kN», o valores sin signo si de verdad son |·|.

**Captura:** `21-pilares.png`, `22-pilar-P13.png`, `20-diagramas.png`
**Verificado:** navegador y código

### R-08 · Las mayúsculas de las cabeceras estropean las unidades
**Severidad:** media
**Dónde:** `app/src/index.css:203` (`.sec`) y `:291` (`.tb th`), con `text-transform: uppercase`.

**Qué pasa:**
- Todas las cabeceras de tabla y de sección se ven en mayúsculas, y las unidades con ellas: «KN», «KN·M», «KN·M/M», «MÁXIMA MM», «D MM», «S M».
- «S = 1,67 M» (estación de la viga) se lee como un momento o como «mega».
- «EN CUB-S (+4,30 M)».
- Los símbolos de unidad distinguen mayúsculas (M es mega, mm no es MM).

**Propuesta:**
- Poner la unidad en un `<span>` con `text-transform: none` (ya existe `.sec > span + span`).
- O dejar las cabeceras de tabla en versalitas sin transformar, con la unidad aparte.

**Captura:** `20-diagramas.png`, `04-cargas-props.png`, `30-armado-cub.png`
**Verificado:** navegador y código

### R-09 · Deshacer o editar saca de Resultados y se pierde el contexto
**Severidad:** media
**Dónde:** `app/src/App.tsx:117`: sin cálculo, `espacioValido` cae a «modelo».

**Qué pasa:**
- En Resultados · Losas, CUB, uz, pulsar Deshacer (o Ctrl+Z) lleva a Modelo, con la barra y el modo cambiados. No dice qué se ha deshecho.
- Tras editar en Cargas, Resultados y Revisión quedan deshabilitados («Necesita el cálculo»). No se puede consultar el último cálculo ni marcado como obsoleto.
- Al deshacer, se vuelve a una huella (f612c89d) que ya se había calculado en la sesión, y aun así pide recalcular («SIN CALCULAR · f612c89d»).
- No se muestran resultados obsoletos como válidos, y eso está bien. El coste es perder el sitio.

**Propuesta:**
- Quedarse en Resultados con un velo «Resultados de otra versión: Calcular» y el modo, la planta y la cámara intactos (y volver a Cargas, no a Modelo, si se venía de allí).
- Reutilizar los resultados en memoria de una huella ya calculada.
- Avisar con un toast de qué deshizo Ctrl+Z.

**Captura:** `44a-antes-deshacer.png`, `44-deshacer-en-resultados.png`, `41-resultados-obsoletos.png`
**Verificado:** navegador y código

### R-10 · Códigos internos y órdenes de la CLI en los textos para el ingeniero
**Severidad:** media
**Dónde:** varias pantallas.
- `Losas.tsx:192`: «SPR (E5)», «(H43)».
- `Losas.tsx:278`, `Armado.tsx:202, 579, 621, 701`, `Reacciones.tsx:135`, `Vigas.tsx:284, 459`, `Desplomes.tsx:193`, `BarraModos.tsx:10, 12`: «fem consultar franja/flechas/pieza/reacciones/deriva».
- `CargasPieza.tsx:294`, `Modelo.tsx:773`: «fem resumen».
- Diagnósticos: «Los de fem validar y fem calcular».
- `src/visor/cargas3d.ts:330`, `src/agente/render/cargas.ts:541`: «ε_snap … (C2-b)».
- «Axil sin valor: … (C1-d)».
- «el aviso de A3», «límite 1/250 (A3)».
- «(cabecera del motor)», «(fase F)», «lámina 2460».
- En el informe: «no hay ningún caso con \`pesoPropio\`» (con las comillas invertidas del Markdown a la vista), «(RV-b)», «(D4)».
- En el ejemplo 1022: «(A2)».

**Qué pasa:** el ingeniero no sabe qué son E5, H43, C2-b o ε_snap. Las órdenes de la CLI no le sirven en la app web, donde no hay terminal.

**Propuesta:**
- Separar las notas de la app de las de `fem render` (que son para el agente).
- En la app, lenguaje de ingeniero («recuperados por suavizado de tensiones», «el cálculo une puntos a menos de 5 cm») y un enlace «ver hipótesis».

**Captura:** `15-resultados.png`, `07-cargas-alzado.png`, `08-cargas-3d.png`, `20-diagramas.png`, `45-revision.png`, `48-diagnosticos.png`
**Verificado:** navegador y código

### R-11 · La leyenda manda a «las bandas», que ya no existen
**Severidad:** media
**Dónde:** leyenda de Resultados · Losas para M/V (`src/agente/render/resultados.ts:434`).

**Qué pasa:** la nota termina en «Para dimensionar, las bandas». Las bandas se quitaron en la fase F, que las sustituyó por Armado (franjas). El usuario busca un modo que no está.

**Propuesta:** «Para dimensionar, el modo Armado (franjas de Wood–Armer)», con enlace al modo.

**Captura:** `16-m11.png`, `52-muestrario-PL1-m22.png`
**Verificado:** navegador y código

### R-12 · La vista no se reencuadra y la leyenda flotante tapa el resultado
**Severidad:** media
**Dónde:** Resultados (Diagramas, Pilares, Reacciones, Losas en el muestrario) y Cargas al abrir Propiedades.

**Qué pasa:**
- Al cambiar de modo, al abrirse el panel inferior (Diagramas abre «Alzado · viga» solo) o al abrir Propiedades, la cámara se queda donde estaba.
- La planta sale cortada: P4, P5 y P6 quedan bajo la cabecera de la vista, y en el alzado del eje 1 la estructura queda pegada a la derecha.
- La leyenda (≈190×300 px, abierta por defecto) tapa vigas y rótulos («-22», el eje 7, «PPA-L-CUB-S-3: -3 kN»).
- Hay que pulsar Encuadrar (F) en cada cambio.

**Propuesta:**
- Reencuadrar al cambiar de modo, planta o paneles si el usuario no ha movido la cámara (ya existe `ajustada`).
- Encuadrar dejando libre el hueco de la leyenda.
- O plegar la leyenda por defecto a una tira con la escala de colores.

**Captura:** `20-diagramas.png`, `21-pilares.png`, `27-reacciones-planta.png`, `35-diag-alzado.png`, `04-cargas-props.png`
**Verificado:** navegador

### R-13 · Diagramas en planta, ilegibles a 1366×768
**Severidad:** media
**Dónde:** Resultados · Diagramas · Planta, 1366×768.

**Qué pasa:**
- Con el panel inferior abierto (≈300 px, también con «Elija una viga…»), la planta queda en ≈720×340 px, ampliada sobre un trozo.
- Las viguetas del paño F1 llevan cada una sus rótulos («12,9», «10,8», «13,4»…), que se pisan.
- La leyenda tapa un tercio.
- En 2×2 cada vista queda en ≈360×170 px, con las cabeceras en tres filas encima del dibujo.
- Mientras sale «Preparando los diagramas…» no se dibuja ni el modelo.

**Propuesta:**
- No abrir el panel inferior hasta que se elija una pieza.
- Rotular las viguetas sólo al acercar, o sólo su máximo.
- En pantallas bajas, cabeceras de vista en una fila con desbordamiento.
- Dibujar el modelo mientras se preparan los diagramas.

**Captura:** `60-1366-diagramas.png`, `61-1366-diagramas-1.png`, `62-1366-diagramas-listo.png`
**Verificado:** navegador

### R-14 · Revisión: la firma sólo se puede hacer desde la línea de órdenes
**Severidad:** media (es una mejora: la firma por la CLI es una decisión de A3)
**Dónde:** Revisión, barra y panel Firma.

**Qué pasa:**
- «Firmar es sólo del ingeniero, en la línea de órdenes», con «bun run fem firmar vivienda.json --por "Nombre"» y «Abierto sin su carpeta: el visor no ve el fichero de firmas».
- En la app publicada (Pages) o en «Mis proyectos» del navegador no hay repo ni terminal. El ingeniero lee el informe y no puede firmarlo ni saber si está firmado.
- La decisión de que el agente no firme es razonable, pero la app es del ingeniero.

**Propuesta:** un «Firmar» en la app, sólo con interacción humana (nombre tecleado y confirmación), que guarde la firma junto al proyecto (IndexedDB o el fichero), con la misma huella y el mismo sha256 del informe. La CLI sigue igual para el agente.

**Captura:** `45-revision.png`, `47b-orden-firmar-zoom.png`
**Verificado:** navegador

### R-15 · Sensatez: «lo peor» no es lo que avisa
**Severidad:** media
**Dónde:** Revisión, tabla de comprobaciones y panel Comprobaciones; sección «Bajada por áreas tributarias».

**Qué pasa:**
- «Axil frente a la bajada por áreas tributarias: AVISOS (1) · lo peor: P15 en CUB-S: 0,525».
- 0,525 está dentro del rango [0,5; 2]. El aviso real es otro: «El tramo del pilar P1 bajo la planta CUB lleva −6,08 kN y su bajada… (−0,201 veces)».
- P1 tampoco aparece en la tabla «Los que más se separan», que dice «Se comparan 35 de 36 tramos».
- El que dispara el aviso no sale ni en «lo peor» ni en la tabla.

**Propuesta:** que «lo peor» y la tabla incluyan el tramo que avisa (con su motivo si queda fuera de la comparación, p. ej. «axil de tracción»).

**Captura:** `45-revision.png` (tabla), y el texto completo leído de la página
**Verificado:** navegador

### R-16 · En el 3D de muros, Propiedades habla de otra cosa
**Severidad:** media
**Dónde:** Resultados · Losas, 3D con «Muros» y «Todas las plantas».

**Qué pasa:**
- El 3D pinta F22 de los muros de todas las plantas en ELU-PT-11 (lo dice la leyenda).
- Propiedades sigue en «Losas · CUB · Se dibuja —: …», con los extremos de CUB («Los paños (F1) no tienen láminas…») y «Combinación ELU-PT-1».
- La cabecera del 3D sólo dice «F22 · kN/m», sin combinación. I4 §15 pide la magnitud, la combinación y la planta.

**Propuesta:** que Propiedades siga a la vista activa (superficie, plantas, combinación y extremos de lo dibujado) y que la cabecera lleve la combinación.

**Captura:** `58-muros-f22.png`
**Verificado:** navegador

### R-17 · Losas en una planta sin losas: vista vacía y sin guía
**Severidad:** media
**Dónde:** Resultados · Losas, muestrario, CUB (sólo unidireccional).

**Qué pasa:**
- La vista sale vacía, con el chip «M22 · kN·m/m · – 1172 ms» y «Se dibuja —».
- La explicación queda en un párrafo largo de Propiedades.
- Armado y Reacciones sí tienen el aviso «Sin losas aquí / Ir a PL1».

**Propuesta:**
- El mismo chip «Sin losas aquí · Ir a …».
- Para los paños, un atajo a Diagramas de sus viguetas.

**Captura:** `51-muestrario-m22.png` (frente a `29-armado.png` y `27-reacciones-planta.png`)
**Verificado:** navegador

### R-18 · Gráficas sin ejes ni valores
**Severidad:** media
**Dónde:**
- Armado: diagrama de la franja en Propiedades.
- Deformada: «Perfil del maestro».
- Panel «Alzado · viga» (sin escala vertical).

**Qué pasa:**
- El diagrama de la franja (mx máx./mín. y áreas inferior/superior) no tiene números, ni eje s, ni escala, ni marcas de las caras.
- La tabla «Caras y apoyos» se aprieta en 360 px y parte los nombres de combinación («ELU-PT-\n5»).
- El perfil del maestro no rotula los desplazamientos en la gráfica.

**Propuesta:**
- Llevar el diagrama de la franja al panel inferior (hay ancho), como el alzado de las vigas, con eje s, valores en los extremos y el cursor de estación.
- Rotular el perfil del maestro.

**Captura:** `32-franja-diagrama.png`, `23-deformada.png`, `20-diagramas.png`
**Verificado:** navegador

### R-19 · Mapa de armado: colores que no se distinguen, rótulos diminutos y zonas de refuerzo poco visibles
**Severidad:** media
**Dónde:** Resultados · Armado (vivienda, CUB, X superior).

**Qué pasa:**
- La leyenda tiene 10 azules de un solo tono (0–10 … 90–100); de 20–30 a 30–40 no se distinguen.
- Los rótulos de pico (≈9 px) se apilan en columna sobre el eje 3: «83,9 / 39,4 / 20,3 / 13,7 / … / 93,4 / 28,1».
- Con base 20, las zonas de refuerzo son un contorno negro fino entre esos rótulos. No sale el «máximo (+exceso)» de `fase-ab.md`, y la leyenda no lo menciona.
- El encuadre usa todos los ejes del edificio, y la losa de CUB ocupa un tercio de la vista.

**Propuesta:**
- Rampa con más contraste (secuencial de dos tonos, o menos bandas por defecto).
- Rótulos de pico con prioridad y separación mínima.
- Contorno de refuerzo grueso y de color, con su rótulo «93,4 (+73,4)».
- Encuadrar la planta activa.

**Captura:** `30-armado-cub.png`, `33-armado-base.png`, `34-armado-zoom.png`
**Verificado:** navegador

### R-20 · «Por defecto» no dice qué combinación pinta, y cada modo usa una
**Severidad:** media
**Dónde:** selector «Combinaciones · …» de la barra de Resultados (sin `aria-label`: el snapshot de accesibilidad lo da como `null`).

**Qué pasa:**
- El mismo «Por defecto» es:
  - ELS-C en uz y en Deformada;
  - ELU-PT o ELU-PT+ELU-SIS en M, V y Armado;
  - los casos sueltos en Reacciones.
- Al cambiar de modo, el valor del selector sigue diciendo «Por defecto» y lo que se pinta cambia por debajo.
- La pestaña inferior «Combinaciones» cambia su cuenta: 19 en Modelo, 8 en Diagramas, 4 en uz y Deformada, 130 en el muestrario.

**Propuesta:**
- Mostrar lo que resuelve: «Por defecto (ELU-PT, 8)» o «Por defecto (casos)».
- Añadir el `aria-label`.
- Titular la pestaña inferior «Combinaciones de esta vista (8)».

**Captura:** `15-resultados.png`, `16-m11.png`, `25-reacciones.png`, `24-res-combinaciones.png`
**Verificado:** navegador

---

## Severidad baja

### R-21 · El mismo número, con precisión distinta en cada sitio
**Severidad:** baja
**Dónde:** mapa frente a Propiedades y tablas.

**Qué pasa:**
- uz máximo: «máximo 0,0985 mm» en el mapa y «0,10 mm» en el panel.
- «mínimo −109 kN·m/m» en el mapa y «−109,2» en el panel.
- Pilares: «P12 −90,6» en la planta y «−91» en el cuadro.
- Deformada: «máx. 2,41 mm» en el chip y «mayor |u| 2,45 mm» en el rótulo, a la vez y sin decir qué es cada uno. Uno es el desplome relativo y el otro el desplazamiento total.
- Signo menos «-» en el lienzo y «−» en el panel.

**Propuesta:**
- Un formateador común por magnitud (p. ej. kN·m/m con 1 decimal, mm con 2).
- En Deformada, que el chip diga «desplome relativo máx.» y el rótulo «desplazamiento total máx.».

**Captura:** `15-resultados.png`, `52-muestrario-PL1-m22.png`, `21-pilares.png`, `56-muestrario-deformada.png`
**Verificado:** navegador

### R-22 · Formato de números: punto decimal, notación científica y JSON crudo
**Severidad:** baja
**Dónde:**
- Combinaciones: «1.35·G + 1.5·Q + 0.75·N», en el panel y en el selector.
- Barra de estado: «compilado en 1.86 s».
- Diagnósticos: «se mueve hasta 4.0 cm».
- Informe, cargas en cimentación: «4,724e-4», «−1,601e-4», «6,518e-4», mezclados con «3,041».
- Informe, opciones efectivas: «modificadores {"pilares":{"todos":{"A":2}},…}».
- Informe, materiales: «[1000000; 4,00e+8] kN/m²».

**Qué pasa:** el resto de la app usa la coma decimal española. En una tabla de cargas a cimentación, la notación e y el JSON se leen mal.

**Propuesta:** formatear siempre con coma y con decimales fijos por magnitud (≈0 para lo que es menor que la precisión), y traducir los modificadores a texto («axil de pilares ×2; torsión de vigas ×0,1»).

**Captura:** `11-combinaciones.png`, `48-diagnosticos.png`, `45-revision.png`
**Verificado:** navegador

### R-23 · El chip de la vista enseña el tiempo de cálculo en ms
**Severidad:** baja
**Dónde:** cabecera de la vista en Resultados · Losas («uz · mm · ELS-C-3 121 ms», «M22 · … 1172 ms»).

**Qué pasa:** es un dato de depuración junto al nombre de la combinación. Distrae y parece parte del resultado.

**Propuesta:** quitarlo, o llevarlo a un tooltip o a la barra de estado.

**Captura:** `15-resultados.png`, `51-muestrario-m22.png`
**Verificado:** navegador

### R-24 · Barra de estado con datos de otra vista y truncada
**Severidad:** baja
**Dónde:** barra de estado.

**Qué pasa:**
- Tras usar el 3D y volver a planta en Cargas, sigue diciendo «3D · mirando a x 2,73 · y 7,835 · z 2,15 m», con decimales mezclados (2,73 frente a 7,835).
- Lo de la compilación se corta en «calculado en el visor e…».

**Propuesta:** limpiar el texto del cursor al cambiar de vista, usar decimales fijos y un tooltip con el texto entero.

**Captura:** `39-cargas-vuelta.png`
**Verificado:** navegador

### R-25 · Un cálculo largo no tiene progreso ni forma de cancelarlo
**Severidad:** baja
**Dónde:** cabecera, «CALCULANDO · fcd0bbac» y botón «Calculando…» deshabilitado (edificio objetivo, ≈6–10 s).

**Qué pasa:** no hay porcentaje, ni fase, ni botón de cancelar. El motor ya da `alProgreso`, y cancelar es `terminate` (E4).

**Propuesta:** una barra de progreso en la cabecera (compilar, factorizar, resolver casos) y «Cancelar».

**Captura:** `64-edificio-4s.png`
**Verificado:** navegador

### R-26 · El valor del clic se lee mal sobre el mapa
**Severidad:** baja
**Dónde:** Resultados · Losas y Armado, rótulo del punto.

**Qué pasa:**
- «24,3 kN·m/m» en azul sin halo, sobre bandas rojas o encima del eje y la viga del borde («-43,6 kN·m/m» pisando la línea del eje 3).
- En el panel, «ELU-PT-3 · interpolado en la lámina 2460, como las bandas»: el número de la lámina no le dice nada al usuario, y «bandas» se confunde con la de R-11.

**Propuesta:** rótulo con fondo blanco o halo, como los de máximo y mínimo, y el texto «interpolado entre los nudos del elemento».

**Captura:** `17-m11-clic.png`, `54-env-sis-punto.png`
**Verificado:** navegador

### R-27 · Cargas: rótulos que se pisan y Propiedades apretadas
**Severidad:** baja
**Dónde:** Cargas · planta y alzado, y Propiedades de una pieza.

**Qué pasa:**
- En planta, «PETO-Z-CUB-S-5: -3 kN/m global» pisa a «PPA-L-CUB-S-2», y «PPA-L-CUB-1» pisa a «PETO-Z-CUB-7».
- En el alzado, «CM-CUB» y «TIRA-G-Z-CUB-6» quedan dentro de sus bloques.
- Cada rótulo repite el id largo, la unidad y «global».
- En Propiedades de un forjado, la cabecera «Forjado · sus cargas / L-CU… / CUB-S · reticular · 0,30 m» ocupa cuatro líneas y trunca el id, por el botón «Editar en Modelo».
- «zona: todo el forjado  m»: unidad suelta junto a un texto.

**Propuesta:**
- Rótulos con prevención de solapes (como los de resultados).
- Formato corto «↓2 kN/m²» con el id al pasar el ratón.
- Botón de icono en la cabecera.

**Captura:** `03-cargas.png`, `07-cargas-alzado.png`, `14-props-forjado-cargas.png`, `13-clic-carga-sup.png`
**Verificado:** navegador

### R-28 · Tema oscuro: las bandas más oscuras se pierden en el fondo
**Severidad:** baja
**Dónde:** Resultados · Losas, tema oscuro.

**Qué pasa:**
- Las muestras «−2,5 a −2,25» y «−2,25 a −2» de la leyenda casi no se distinguen del fondo del panel.
- Los 10 azules de uz son casi iguales entre sí.

**Propuesta:** borde claro en las muestras de la leyenda y una rampa adaptada al tema oscuro (que no acabe en casi negro).

**Captura:** `63-oscuro-losas.png`
**Verificado:** navegador

### R-29 · Cuentas de avisos que no cuadran entre pantallas
**Severidad:** baja
**Dónde:** pestaña Diagnósticos frente a Revisión.

**Qué pasa:**
- La pestaña dice «10 avisos» (9 del compilador + `sensatez/altura`).
- El informe dice «2 avisos de sensatez… 9 avisos del compilador y del cálculo».
- `sensatez/tributaria` sale en uno y no en el otro.

**Propuesta:** contar igual en los dos sitios, o separar «compilador» y «sensatez» en la pestaña.

**Captura:** `48-diagnosticos.png`, `45-revision.png`
**Verificado:** navegador

### R-30 · En 2×2, dos 3D iguales y alzados vacíos sin explicación
**Severidad:** baja
**Dónde:** Resultados · Losas, disposición 2×2.

**Qué pasa:**
- Arriba salen dos vistas 3D idénticas.
- Abajo, dos alzados del eje A sin ningún resultado: Losas no pinta en alzado y nada lo dice.

**Propuesta:**
- 2×2 por defecto con planta, alzado, 3D y una segunda planta o eje distinto.
- En un alzado sin resultados para el modo, el aviso «Este modo no se dibuja en alzado».

**Captura:** `59-2x2.png`
**Verificado:** navegador

### R-31 · Nombre comercial en un ejemplo
**Severidad:** baja
**Dónde:** `app/src/Inicio.tsx:26`, «Pórtico de acero de 7 plantas (SAP2000 1-022, A2)». El proyecto se llama «Pórtico de acero de siete plantas (SAP2000 1-022)» (`validacion/a2/agente/1022/proyecto.json`).

**Qué pasa:** la regla del proyecto es que los textos de la app no nombren software comercial.

**Propuesta:** «Pórtico de acero de 7 plantas (caso de validación 1-022)».

**Captura:** —
**Verificado:** código

### R-32 · Casos con códigos duplicados o crípticos
**Severidad:** baja
**Dónde:** Cargas: navegador, selector del caso y formularios.

**Qué pasa:**
- En el navegador, «N … S» y «G … G · pp» (id y acción en dos columnas sin cabecera).
- En el selector, «G · con peso propio | Q | N»: Q y N sin nombre.
- En el formulario de una carga, «caso: G · G · peso propio».

**Propuesta:** «N · nieve», «Q · uso G (cubierta)», sin repetir el id.

**Captura:** `03-cargas.png`, `09-gestor-casos.png`, `13-clic-carga-sup.png`
**Verificado:** navegador

### R-33 · Las figuras del informe no se leen dentro de la app
**Severidad:** baja
**Dónde:** Revisión · Figuras.

**Qué pasa:** las plantas y los mapas incrustados usan una fuente con serifa distinta de la app, y su leyenda y sus rótulos quedan en ≈6–7 px en el ancho del informe. No se pueden ampliar.

**Propuesta:** un clic que abra la figura a pantalla completa o la lleve a la vista de Resultados equivalente, y la misma tipografía que la app.

**Captura:** `46-revision-figuras.png`
**Verificado:** navegador

### R-34 · Losas: Propiedades repite secciones que no tocan
**Severidad:** baja
**Dónde:** Resultados · Losas, Propiedades.

**Qué pasa:**
- Con M11, V13 o F22 se siguen mostrando «Flechas» (ELS-C) y la tabla de equilibrio de los 12 casos del muestrario.
- Lo útil (escala, valor en el punto, extremos) queda arriba y el resto empuja la lectura.

**Propuesta:**
- «Flechas» sólo con uz.
- El equilibrio como una línea plegable («Equilibrio: bien, máx. 6e-14»).

**Captura:** `16-m11.png`, `52-muestrario-PL1-m22.png`
**Verificado:** navegador

---

## Lo que funciona especialmente bien

- **Ningún resultado de otra versión se presenta como válido.** Tras editar, la cabecera pasa a «SIN CALCULAR · huella» y Resultados se bloquea (R-09 pide sólo que no se pierda el sitio). Cambiar la armadura base no invalida el cálculo, como debe.
- **Equilibrio a la vista:** ΣF y ΣM por caso con su límite de 1e-9, en Losas, Reacciones y el veredicto del informe. Da confianza y es lo que el ingeniero firma.
- **Diagramas de vigas:** el alzado de la pieza en el panel inferior, con la estación deslizante y máx./mín. por lado con su combinación y su expresión, y los vanos de cara a cara. Es lo más cercano a la herramienta de dimensionado que se busca.
- **La sonda del 3D** («Z-CUB-5 · s = 0,15 m · My máx. −9,1 · ELU-PT-5 · My mín. −17,6 · ELU-PT-3»). Rápida y clara.
- **Las reacciones en planta,** con Fz y la horizontal en dos colores que se distinguen, y el atajo «Sin apoyos aquí · Ir a PB» (también en Armado).
- **La escala del mapa:** el aviso «La escala la marcan picos en menos del 2 % del área… ver sin picos», más Completa, Sin picos y Manual. Excelente para no leer mal un mapa.
- **Los textos de los diagnósticos explican la consecuencia** («el momento de la viga en la cara puede salir un 20 % bajo… revise esas caras o baje el tamaño de malla»).
- **El gestor de casos,** con la explicación de cada acción, sus coeficientes y ψ según la tabla 4.2 del DB SE.
- **La deformada animada** y el resaltado del mayor |u|.
- **El informe de revisión,** completo y trazable: huella, sha256, hipótesis, peso propio esperado frente al calculado y bajada tributaria.
