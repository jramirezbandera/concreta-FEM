# Los diagramas de las vigas: los pares de la losa (2026-10-20)

De la puerta de uso con la vivienda: en Resultados · Diagramas, el My de las vigas salía en dientes
de sierra (captura de Z-CUB-S-1, vano P16–P17).

## 1. La causa

No es un fallo del cálculo. Las barras de una viga van de nudo a nudo de la malla, y en cada nudo
interior la losa le pasa a la viga (directamente con la unión por el eje, o por el enlace rígido de
los nudos de sus caras con la de LV) un **par concentrado**: el momento torsor m₁₂ de la losa a lo
largo de la viga, que en la realidad es un par repartido, llega en los nudos. En el diagrama de la
barra sale como un salto de My (y de T y Mz) en cada nudo; dentro de cada barra My crece con el
cortante y en el nudo salta atrás. SAP2000 y ETABS dan lo mismo con vigas en losas malladas.

Medido en Z-CUB-S-1 (vivienda, 1,35·G + 1,5·Q): saltos de hasta 6,4 kN·m con h = 0,75. Como el salto
es proporcional a h, lo leído depende de la malla, y en la cara del pilar (donde hay un nudo) de qué
lado del salto se lea: el M⁻ de la cara de P16 salía −33,0 (por la derecha) frente a −37,4 (por la
izquierda), un 4–6 % corto del lado inseguro; el M⁺ del vano, un 3–7 % alto.

## 2. Lo decidido (el usuario, 2026-10-20)

**Repartir sólo lo de la losa, en las consultas** (no sólo en el dibujo: todo número dibujado sale de
la consulta). En `EsfuerzosPiezas` (`src/compilador/resultados.ts`), por defecto:

- en cada nudo interior de una viga o una vigueta con láminas (el extremo común de dos tramos
  flexibles seguidos del mismo tramo de la polilínea, con los mismos ejes, y que no es esclavo de un
  enlace), la parte de la losa del salto de T y My;
- si al nudo y a lo que cuelga de él sólo llegan sus dos barras, láminas y cargas (casi siempre), es
  el salto entre las fuerzas de extremo de las dos barras (en L por la derecha y en 0 por la
  izquierda) menos el de las cargas nodales: sale de los diagramas, sin la rigidez de las láminas;
- si no (otra barra, un apoyo o un muelle en el nudo o en sus caras), por las fuerzas de las láminas
  que lo tocan y de las de los nudos que cuelgan de él por enlaces rígidos, trasladadas al nudo
  (M + d × F, `FuerzasNodales`);
- con el par C sobre el nudo en los ejes de la barra, el salto de T es −Cx y el de My, Cy (equilibrio
  del nudo con `fuerzasDeExtremo`); se reparte a medias entre los dos medios tramos vecinos como un
  par uniforme (`DiagramaBarra.conPares`: se suma −J_i/2·(1 − x/L) + J_j/2·x/L);
- lo demás se queda como salto: una carga nodal (lo que cae en el ancho de la viga con excentricidad
  llega como torsor nodal), una puntual de la barra en el nudo, otra barra, un apoyo. Mz no se toca:
  en él actúa también el diafragma, y en un forjado con diafragma rígido no tiene valor;
- el cortante y los desplazamientos no cambian; el extremo interior de My de cada barra se busca
  donde se anula Vz menos el par (`DiagramaBarra.pares`, `estaciones`);
- los pilares no cambian, ni los cortes de las franjas y las bandas (usan `DiagramasBarras`, los
  diagramas del motor);
- `new EsfuerzosPiezas(…, { suavizado: false })` da los del motor tal cual.

## 3. Validación

`src/compilador/paresLosa.test.ts`:

- en todos los nudos interiores de las vigas de dos recuadros con vigas, con la unión por las caras y
  por el eje, la parte de la losa por las fuerzas de las láminas más la de las cargas nodales es el
  salto del motor a 1e-9 relativo en T y My (el signo y el traslado de las caras al eje), la vía
  rápida da lo mismo y tras el reparto sólo queda lo de las cargas nodales;
- cada barra es la del motor más un par uniforme: N, Vy y Vz bit a bit, la pendiente añadida es la
  de los pares y hay una estación en cada raíz de Vz − p;
- los máximos y mínimos de los vanos con h = 0,75 están más cerca de los de h = 0,3 con el reparto
  que sin él.

En la vivienda, la misma comprobación en los 1 938 saltos de T y My (nudo × caso × componente): exactos
salvo las cargas nodales.

Coste: en el edificio objetivo de 7 plantas, los diagramas de las 3 140 barras de viga de una planta
en todos los casos pasan de ~0,1 s a ~0,2 s. Por las fuerzas de las láminas en todos los nudos eran
1,1–1,5 s (la rigidez de miles de láminas): por eso la vía rápida.

Z-CUB-S-1 y Z-CUB-S-2 de la vivienda, 1,35·G + 1,5·Q (kN·m), sin y con el reparto:

| Vano | h | M⁺ antes | M⁺ ahora | M⁻ antes | M⁻ ahora |
|---|---|---|---|---|---|
| S-1 v2 | 0,75 | 24,34 | 22,64 | −33,00 | −35,20 |
| S-1 v2 | 0,375 | 23,68 | 22,45 | −33,77 | −34,52 |
| S-1 v2 | 0,2 | 23,11 | 22,36 | −34,34 | −35,38 |
| S-2 v1 | 0,75 | 19,33 | 17,96 | −26,60 | −27,64 |
| S-2 v1 | 0,375 | 18,37 | 17,66 | −27,16 | −28,60 |
| S-2 v1 | 0,2 | 18,07 | 17,59 | −27,24 | −28,51 |

Con el reparto, el M⁺ apenas se mueve con la malla (22,64 → 22,36), y el de antes iba bajando hacia
él desde arriba; el M⁻ de la cara queda del lado seguro.

## 4. La malla en Resultados

A la vez (a petición del usuario), un interruptor «Malla» en la cabecera de cada planta de
Resultados (diagramas, mapas, armado, pilares y reacciones) dibuja encima las aristas de las láminas
y los nudos de las vigas (`capaMalla` en `src/agente/render/resultados.ts`): se ve que cada diente
acababa en un nudo.
