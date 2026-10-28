# Propuesta — piezas fuera del plano de su planta

Estado: **propuesta sin decidir** (2026-10-29), salvo el paso 0, ya hecho. Recoge lo que pidió el usuario tras usar el alzado:

- ver el alzado sin los cantos;
- dibujar una viga que une dos niveles;
- más adelante, losas inclinadas;
- los desniveles de paño: una terraza 10 cm más baja para el acabado, o una losa de 20 junto a un reticular de 30 enrasada por la cara inferior.

Los arriostramientos sólo a tracción y lo no lineal están en `cimentacion-y-arriostramientos.md` (§3, §4). Aquí sólo se dice cómo encajan.

## 0. El alzado alámbrico y analítico (hecho, 2026-10-29)

El alzado tiene un selector con tres modos, como el 3D (`ModoAlzado` en `src/agente/render/alzado.ts`; el modo va en el pedido del plano, `PlanoPedido.modo`, y en las vistas guardadas, `modoAlzado`):

- **Sólido** (por defecto en Modelo y Cargas): lo de antes, con el canto y el ancho de cada pieza.
- **Alámbrico** (por defecto en Resultados, como el 3D): sólo necesita el modelo físico.
  - Los pilares, por el eje de su sección (con el punto fijo de PF).
  - Las vigas, las losas y los paños, en la cota de su planta.
  - Los muros paralelos, por su contorno; los que cruzan el plano, por su eje.
  - Los apoyos, en la cota.
- **Analítico:** el modelo que se calcula, y por eso necesita la compilación.
  - Cada barra con su tramo flexible y, aparte, sus zonas rígidas (offsets) del nudo al tramo.
  - Las articulaciones: algún momento liberado en el extremo del tramo flexible.
  - Los empotramientos parciales: CY2, < 1.
  - Los nudos.
  - La malla de los muros paralelos al plano, y las láminas que lo cruzan, cortadas: las losas y los muros perpendiculares.
  - Los enlaces rígidos, del maestro a cada esclavo: las huellas de los pilares y la unión de la losa a las vigas.
  - Los apoyos.
  - El diafragma no se dibuja: con todos los nudos de la planta, no se vería nada.

  Sirve para revisar lo que no se veía en ningún sitio: la cabeza rígida de los pilares en el canto del forjado (RV-b), la zona rígida de las vigas (C1-a), el punto fijo (PF) y la cabeza al 0,3 (CY-b).

Los diagramas, las reacciones y las cargas del alzado se dibujan encima del modo elegido. Prueba: `src/agente/render/alzado.test.ts`. Lo dibujado en el analítico se compara barra a barra con la compilación, y las losas cortadas tienen que estar en la cota de su planta (RV-b).

## 1. Barras entre dos niveles (paso siguiente)

Una viga inclinada, un tornapuntas, una zanca y una diagonal de arriostramiento son el mismo objeto: una barra entre dos puntos del espacio. **Propuesta para CB-c:** una lista general `barras`, no una lista `diagonales`.

```ts
interface Barra {
  id: string;
  nombre?: string;
  inicio: { planta: string; x: number; y: number; dz?: number };
  fin:    { planta: string; x: number; y: number; dz?: number };
  seccion: string;
  liberaciones?: { inicio?: Liberacion; fin?: Liberacion };
  /** Sólo trabaja a tracción. Hasta que haya cálculo no lineal: lineal, con el aviso `barra/compresion`. */
  soloTraccion?: boolean;
}
```

- **`dz`** (m sobre la cota de la planta) da los puntos a media altura: mesetas y tornapuntas. Exige partir el pilar en un nudo intermedio, que hoy no existe. La primera versión puede ir sin él, pero el esquema lo deja previsto.
- **Compilador:**
  - **Extremos:** cada uno se busca como una carga puntual: el nudo de un pilar, un punto de una viga (que se parte, como en C4-d), el nudo de una losa o de un muro. Si no cae en nada, `barra/extremo-sin-apoyo`.
  - **Ejes locales** de una barra inclinada: x de inicio a fin, z en el plano vertical que la contiene y hacia arriba. Si es vertical, la regla de los pilares. Van en la cabecera de `modelo.ts` (H02).
  - **Zona rígida:** hasta la cara del pilar de hormigón al que llega (CB-f), y ninguna en metálica.
  - **Peso propio:** carga repartida en ejes globales.
  - **Diafragma:** aviso `barra/en-diafragma` cuando los dos extremos caen en el mismo diafragma rígido.
- **Dibujo:** es la primera herramienta del alzado, «Barra»: dos clics enganchados a los cruces de pilar y nivel, a puntos de las vigas y a las caras. Hace falta el índice de enganches en (u, z) y su vuelta a (x, y, planta). En planta, la barra se ve como su proyección en discontinua, con una flecha hacia el extremo alto. En el 3D sólido, la sección barrida a lo largo de su eje.
- **Consultas:** `EsfuerzosPiezas` y los diagramas ya trabajan por barra, y la barra es una pieza más del mapeo. Hay que revisar `tributaria` y la sensatez (A3), que dan por hecho que las piezas son horizontales o verticales.
- **Validación:** pórtico con dintel inclinado y celosía con solución a mano, oráculos PyNite y OpenSeesPy, metamórficas (giro y traslación del modelo, cambiar inicio por fin) y una referencia congelada.

## 2. Arriostramientos sólo a tracción

Como en `cimentacion-y-arriostramientos.md` §3.4:

- **Primero, lineal** con las dos diagonales, con el aviso `barra/compresion` si una `soloTraccion` queda comprimida en alguna combinación.
- **Después, lo exacto:** por combinación, quitar las comprimidas y refactorizar hasta que ninguna cambie. Se hace junto con el despegue de la losa sobre balasto (§4 de esa propuesta).

Mientras tanto, lo nuevo de las consultas debe trabajar sobre «un vector de resultados» y no dar por hecho que una combinación es lineal.

## 3. Desniveles de paño

En CYPECAD, cada paño puede llevar un desnivel respecto a la cota de su planta. Hay dos casos típicos:

- una terraza 10 cm más baja para que quepa el acabado de cubierta;
- una losa de 20 junto a un reticular de 30, enrasada por la cara inferior (desnivel −0,10).

**Modelo físico:** `desnivel?: number` (m; negativo, más bajo) en `Losa` y en `PanoUnidireccional`. La cara superior queda en la cota de la planta más el desnivel. Para el segundo caso, el editor puede ofrecer «Enrasar por abajo con…», que calcula el desnivel a partir de los cantos.

**Lo que cambia sin tocar el cálculo:**

- el dibujo (alzado, 3D sólido, cotas);
- el sólido y el peso, que no cambian;
- la zona rígida de los pilares (RV-b), que llega hasta la cara inferior más baja de lo que los toca;
- la viga del escalón, que va a la cota de la losa más alta.

**Lo que cambia en el cálculo** es una decisión del usuario (DN-a), y se mide antes de decidir:

- **a) En el plano de la planta:** los nudos de las dos losas, en la cota, como si no hubiera desnivel. Es lo más sencillo y es compatible con el diafragma rígido, que exige los nudos a la misma cota (E1). Si las dos losas no se solapan en canto (|desnivel| ≥ el espesor de la más delgada), no hay continuidad: hace falta una viga o un muro en el escalón, y si no lo hay, error `losa/escalon-sin-apoyo`.
- **b) Excentricidad de la lámina:** cada losa en su plano medio real, con su excentricidad respecto al plano de los nudos como un offset de la lámina en el motor. Es el acoplamiento de membrana y flexión. Sólo importa con `diafragma: "ninguno"`, porque con el rígido la membrana casi no trabaja. Habría que añadir el offset a la lámina del motor, con su oráculo (OpenSeesPy, ASDShellQ4 con nudos desplazados y `rigidLink`).

Recomendación: **a**, medida contra un modelo con láminas en su cota real unidas por enlaces rígidos en el escalón. Además, un modelo de CYPECAD del usuario con un desnivel, para ver qué hace (en sombra).

**Decisiones:**

- DN-a: el cálculo (a o b);
- DN-b: el solape mínimo para dar continuidad;
- DN-c: si «enrasar por abajo» es una orden del editor o un modo del desnivel (`enrase: "inferior"`).

## 4. Losas inclinadas

Es lo más grande, porque el compilador entero piensa por planta en 2D: el arreglo plano, la rejilla, el diafragma, las cargas de superficie, las franjas y la vista en planta. La lámina del motor ya es 3D (los muros lo demuestran). Lo que se propone:

- **Geometría:** un plano, dado por el contorno en planta y la cota de dos bordes (cada uno con su planta y un `dz`) o de tres puntos.
- **Malla:** en las coordenadas del propio plano. El contorno se pasa a ellas, se malla con el mallador de siempre y se devuelve al espacio. La transformación es afín y exacta, así que la calidad no depende de la pendiente (mallar la proyección estiraría los elementos 1/cos θ).
- **Uniones:**
  - con una losa horizontal, por la recta común, sembrada en las dos mallas (como muro–losa, C3);
  - con los pilares, en nudos a media altura (el mismo `dz` que las barras del §1);
  - con las vigas inclinadas de sus bordes (las barras del §1);
  - fuera del diafragma rígido.
- **Cargas:** por superficie real o por su proyección. El peso propio y el solado van por superficie real; la nieve, por proyección. Es una opción de cada carga de superficie (DN-d).
- **Franjas de armado:** en los ejes del plano de la losa.
- **El caso típico:** las escaleras (losa de zanca con mesetas). Por eso conviene que el `dz` y la herramienta del alzado lleguen antes, con las barras.

## 5. Orden propuesto

1. **Alzado alámbrico y analítico** (hecho).
2. **`barras` lineales**, con `dz` en el esquema, la herramienta «Barra» del alzado y el aviso de compresión. Antes, el usuario decide CB-c y CB-f.
3. **Desniveles de paño** (§3), la opción que se decida, medida.
4. **Lo no lineal por combinación:** las barras sólo a tracción y el despegue de la losa sobre balasto.
5. **Losas inclinadas,** sobre los nudos a media altura y el dibujo en el alzado de 2.

Cada fase, con su plan y sus criterios fijados al empezar.
