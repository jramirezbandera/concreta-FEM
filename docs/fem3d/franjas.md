# Fase F — franjas de armado

> **Fecha:** 2026-10-13. **Origen:** propuesta del agente tras V2b, aceptada por el usuario («vamos con esto») con el ancho por defecto recomendado, 1 m.
>
> **Qué cambia:** las losas macizas y reticulares se arman con **franjas de ancho fijo que cubren toda la losa**, en sus dos direcciones. Las bandas del Anejo I salen de la app: ni «Proponer bandas» ni su edición. **Sustituye a D5** en la app; las bandas siguen en el `proyecto.json` como cortes de comprobación para el agente.
>
> **Este documento** fija, antes de empezar, cómo se hace y qué tiene que pasar (§2–§4). El resultado está en `fase-f.md`, con lo que cambió durante la fase: la ventana centrada en el pilar (F-h), las caras de lado a lado de la losa y los pilares que no las tienen (F-1, F-3, F-4).

## 1. Por qué

- **Funciona siempre igual.** No depende de cómo estén los pilares: un ascensor, pilares desordenados o una planta no ortogonal dan lo mismo.
- **Cubre el 100 % de la losa por construcción.** No puede quedar una zona sin dimensionar. También las losas apoyadas en muros o vigas sin pilares, que C5 dejó fuera.
- **Pone la armadura donde está el momento.** En la losa plana de H25, el metro junto al pilar pide unos 109 kN·m/m, frente a los 68 de media que reparte la banda de pilares de 3 m.
- **El Anejo I es una simplificación para retículas regulares.** Con un cálculo de láminas no hace falta, y el Código admite dimensionar con el análisis lineal.

## 2. Lo que se fija al empezar

### 2.1 Las franjas

- **Qué losas:** las macizas y las reticulares. Los paños unidireccionales no llevan franjas: sus viguetas ya son barras con sus esfuerzos (D2).
- **Direcciones:** la 1 es el `eje1` de la losa, y la 2, su perpendicular (eje1 + 90°). El `eje1` ya es, por losa, lo que en CYPECAD es el ángulo de armado: orienta los nervios del reticular y la retícula de la malla. No hace falta un campo nuevo.
- **Ancho (F-a, F-b):** b = 1 m en una maciza (la opción `anchoFranja`), y el intereje en un reticular. Así, en un reticular, el momento de una franja es directamente el de un nervio.
- **Reparto (F-c):** en cada losa y dirección, de borde a borde. Con W la extensión de la losa en transversal, son n = ⌈W/b⌉ franjas iguales de ancho W/n ≤ b. No hay nada que proponer, colocar ni editar, y las franjas no se guardan: salen de la losa, de su `eje1` y de b.
- **Nombre:** `<losa>:X<i>` en la dirección 1 y `<losa>:Y<i>` en la 2, con i desde 1 en el borde de menor coordenada transversal.

### 2.2 Las caras de los pilares, en la malla

- **El problema:** el momento en la cara de un pilar sólo es exacto si la cara está en la malla (corte por fuerzas nodales, E5-5). Cortarla por campos da del −5 al −17 %, del lado inseguro (C5-2). Hasta ahora las sembraban las bandas.
- **Ahora las siembra cada pilar.** En cada losa y dirección, las caras comunes de C5-g (`carasComunes`, `CARA_COMUN`) de los pilares que llegan a la losa se siembran como trazos exactos, con la maquinaria de las caras de banda: la rejilla y sus plantillas las tratan igual.
- **Su largo** va del borde de la primera franja que toca la huella del pilar al de la última, recortado a la losa. Así el corte de cada franja en la cara sigue la malla entero y es exacto.
- **La opción `franjas: false`** no siembra nada. Con ella, la malla de C1–C5 sale bit a bit, y las referencias congeladas anteriores no cambian.

### 2.3 Estaciones a lo largo de cada franja

Cada franja se corta en perpendicular a su dirección, sólo por las láminas (F-g: las vigas se dimensionan con sus propios diagramas):

1. **Caras de los pilares** que toca la franja: por fuerzas nodales, exacto.
2. **Líneas de apoyo** que cruzan la franja en perpendicular (ejes de vigas, muros y apoyos lineales): ya son líneas de la malla, así que van por fuerzas nodales. Si la línea no sigue la malla en toda la franja (una viga que acaba dentro), van por campos.
3. **Cada Δs = 0,25 m** (F-d), por campos. La retícula de estaciones es común a todas las franjas de una losa y dirección, así que cada estación es una sola línea que cruza la losa entera, partida en los bordes de las franjas. Entre las dos caras de un pilar que toca la franja no hay estaciones: es el apoyo.

**Momentos medios** por metro, en los ejes de la franja:
- mx = My/b_losa, con b_losa el ancho de la franja que cae en losa en esa estación (sin huecos ni lo que se sale). En una cara, My es exacto. Por campos, es la integral del campo SPR a lo ancho de la franja.
- my y mxy son las medias de los campos a lo ancho de la franja. En una cara o un apoyo, a δ = 1 mm por fuera del apoyo, como en C5, salvo donde detrás de la recta hay un borde rígido de la losa (el ancho de una viga unida por sus caras, la huella de un pilar en la ventana de su metro, un apoyo lineal con algún giro coartado): ahí, a un canto de la losa de la cara, o a la mitad de lo libre hasta el siguiente apoyo, porque junto a un borde así el torsor tiene una capa límite que la malla gruesa no ve y la fina resuelve despacio (LV2-h, `refinamiento-vigas.md` §11–§12, 2026-10-16). Cada estación dice a qué distancia se tomaron (`distanciaMuestras`).
- En un reticular, fuera de los ábacos, también el momento por nervio: mx·s.

### 2.4 Wood–Armer y envolventes

- **Por combinación** (H34), nunca sobre la envolvente, con los momentos medios (C5-c, opción a).
- **Qué da:** en una franja de la dirección 1, m\*x inferior (tracción abajo) y superior; en una de la dirección 2, m\*y. Están en kN·m/m y, en un reticular, también por nervio.
- **Combinaciones:** las ELU del generador CTE/NCSE cuando los casos llevan acción (C5-f). Si no, por caso o con los factores que se den.
- **Envolvente por estación:** la mayor demanda inferior y la mayor superior con la combinación que las da, y el mx máximo y mínimo.

### 2.5 Consultas, CLI y render

- **`Consultas.franjas(losa, direccion)`:** las franjas, con su envolvente resumida (las mayores demandas y dónde están).
- **`Consultas.franja(id)`:** sus estaciones (por caso, por combinación y la envolvente).
- **CLI:** `fem consultar franjas` y `fem consultar franja`.
- **A4:** la vista `armado`, también en `fem render`. Las franjas de la planta, coloreadas por tramos entre estaciones según la demanda elegida (`x-inf`, `x-sup`, `y-inf`, `y-sup`), con la escala de los mapas. Los valores rotulados van también en el JSON.

### 2.6 La app

- **Resultados · Armado** sustituye a Resultados · Bandas.
  - El mapa de la planta, con el selector X/Y e inferior/superior.
  - Al elegir una franja, su diagrama a lo largo (mx máximo y mínimo, y las demandas inferior y superior) y la tabla de sus estaciones.
  - Todo número sale de las consultas.
- **Se retira:**
  - la tabla Bandas y la herramienta Banda;
  - «Proponer bandas» y su diálogo;
  - la operación `proponerBandas` y el recálculo de los apoyos de `src/editor/bandas.ts`;
  - el modo Bandas y los pedidos `bandas` y `banda` del visor.
- **Se queda:**
  - el campo `bandas` del proyecto, para el agente: el compilador lo valida, lo siembra y lo integra como en C5, y `fem consultar banda` sigue;
  - las operaciones generales del editor (borrar en cascada, renumerar, copiar), para que un proyecto con bandas siga siendo válido.

  La app no las dibuja ni las edita, y al guardar las deja como estaban.
- **Se aprovecha:** el cálculo por cortes, Wood–Armer, la pantalla de resultados de V2b y los campos SPR compartidos.

### 2.7 Lo que no entra

- **La armadura en cm²/m** (F-e): necesita el recubrimiento, el acero y el canto útil, que no están en el modelo. Por defecto, F da los momentos de diseño por metro; el paso a armadura es del módulo de Concreta o de una decisión del usuario.
- **El punzonamiento, el cortante y las longitudes de anclaje y solape.**
- **Elegir solo la armadura base y los refuerzos:** lo decide el ingeniero con los mapas y los diagramas.

## 3. Decisiones por defecto

| # | Decisión | Por defecto | Por qué | Alternativa |
|---|---|---|---|---|
| F-a | Ancho en losa maciza | **1 m** (aceptado por el usuario) | El «por metro» habitual | 0,5 m: más detalle junto a los pilares, a cambio del doble de cálculo |
| F-b | Ancho en reticular | **El intereje** | El momento de una franja es el de un nervio | 1 m, como en la maciza |
| F-c | Reparto de las franjas | **n = ⌈W/b⌉ iguales de borde a borde** | Cubren la losa sin una franja estrecha en un borde, y no dependen de los pilares | Ancho exacto b desde un borde, con un resto |
| F-d | Paso entre estaciones | **0,25 m**, más las caras y las líneas de apoyo | Un tercio del tamaño de malla: sigue el campo sin perder el máximo del vano | Ligado a h |
| F-e | Qué dan los mapas | **Momentos de diseño (kN·m/m)** | La armadura necesita datos que no están en el modelo | As en cm²/m con recubrimiento y acero dados |
| F-f | Caras | **Las comunes de C5-g**, con `CARA_COMUN` = 0,5 | Ya validadas: no rompen la malla con pilares de tamaños distintos (C5-1) | La cara de cada pilar |
| F-g | Vigas dentro de una franja | **Fuera**: la franja es sólo losa | La viga se dimensiona con sus diagramas; sumarla daría a la losa el momento de la viga | Sumarla, como hacían las bandas |

**La posición de las franjas importa** junto a un pilar: no es lo mismo una franja centrada en el pilar que dos que lo parten. Se mide (criterio 4) y, si la diferencia es grande, se propondrá un remedio al usuario.

## 4. Criterios de paso

1. **Exacto donde se puede:**
   - en una línea de la malla que cruza la losa entera (el eje de una viga, un muro), la suma de las franjas es el corte de las láminas de toda la losa a ≤ 1e-9;
   - la cara de una franja es el corte por fuerzas nodales de su rectángulo, sin barras, a ≤ 1e-12;
   - por campos, la suma de las franjas de una estación es el corte por campos de toda la línea: a ≤ 1e-9 en una malla de paralelogramos (la cuadratura es exacta) y a ≤ 1e-6 en general.
2. **Oráculos analíticos:**
   - una losa en flexión cilíndrica da qL²/8 en el centro de todas sus franjas a ≤ 0,5 %;
   - en la placa de Navier, la media de cada franja frente a la media de la serie en su ancho (integrada analíticamente), a lo largo de la franja, a ≤ 1 % del máximo.
3. **Oráculos externos:**
   - **H25 en OpenSeesPy ASDShellQ4** con la misma malla: el My de cada franja en las caras (fuerzas nodales en los dos) a ≤ 2 %, y en las líneas de la malla de los vanos, a ≤ 2 %;
   - **el reticular de SAP2000 del usuario** (E6-12): las franjas con los momentos de SAP2000 frente a las del motor, en la malla de SAP2000, a ≤ 3 % del máximo.
4. **Convergencia y posición** (losa plana de H25 y reticular con ábacos):
   - entre h = 0,75 y 0,375, la mayor demanda de cada franja, en las caras y en los vanos, cambia ≤ 2 % de media y ≤ 5 % como máximo;
   - desplazar las franjas media franja se mide y se informa, con la diferencia de la mayor demanda junto a cada pilar.
5. **Malla y D9:**
   - el edificio objetivo de 7 plantas, con losa plana y con vigas, cabe en el perfil móvil (≤ 200 000 ecuaciones);
   - no hay avisos de calidad de malla nuevos;
   - se informa del crecimiento frente a sin caras.
6. **Determinismo y huella:**
   - las franjas y la malla no dependen del orden de las listas;
   - trasladar y girar 90° y 37° da las mismas franjas, transformadas;
   - V8 y JavaScriptCore dan lo mismo;
   - la huella incluye `anchoFranja` y `franjas`;
   - con `franjas: false`, la malla de C1–C5 sale bit a bit.
7. **Rendimiento** (edificio objetivo):
   - todas las franjas de una planta, en las dos direcciones y con Wood–Armer en todas las combinaciones ELU, en ≤ 1,5 s en Bun la primera vez (con el SPR);
   - el mapa de la app, en ≤ 2 s en Chrome;
   - el edificio entero, en menos que el cálculo.
8. **App:**
   - los valores de la pantalla son los de `fem consultar franja(s)` bit a bit, en Node y en Chrome;
   - ninguna tarea larga (> 50 ms) en el hilo principal;
   - lo retirado no deja rastro, y un proyecto con bandas se abre, se calcula y se guarda con sus bandas intactas.
9. **Referencia congelada:** las franjas de H25, del reticular con ábacos y de una planta al azar (estaciones, medios y Wood–Armer) a 1e-9.
10. **Puerta de uso:** el usuario arma con los mapas una losa de un proyecto suyo y dice si le sirve.

## 5. Partes

Cada una con sus tests y su commit.

- **F1, compilador y motor:**
  - las caras de los pilares en la malla y las opciones `franjas` y `anchoFranja`;
  - `src/compilador/franjas.ts` (el reparto) y `esfuerzosFranjas.ts` (las estaciones, los medios y Wood–Armer);
  - en el motor, cortes sólo de láminas y campos partidos en unos puntos dados.
- **F2, consultas, CLI y render:** `Consultas.franjas` y `franja`, `fem consultar` y la vista `armado` de A4.
- **F3, app:** Resultados · Armado, y retirar las bandas de la app.
- **F4, validación:** oráculos (analíticos, OpenSeesPy y SAP2000), convergencia y posición, malla, determinismo, banco y referencia congelada (`validacion/f/`).

## 6. Riesgos que se miden

- **Malla:** las caras crecen la malla. En C5, las caras de las bandas la hacían ×1,4 en el edificio objetivo, y con vigas en todos los ejes pasaba del perfil móvil (criterio 5).
- **Tiempo:** una planta de 54 × 35 m tiene unas 90 franjas y, con el paso de 0,25 m, unas 15 000 estaciones. Por eso las estaciones por campos van por líneas enteras, una por estación para todas las franjas (criterio 7).
- **Posición de las franjas** junto a los pilares (§3 y criterio 4).
