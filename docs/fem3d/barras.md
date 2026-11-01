# Fase BN: barras entre dos niveles

**Estado (2026-11-01):** BN1, BN2 y BN3 hechas (§4.1, §5.1 y §6.1): pasan sus criterios; de BN2 y BN3 falta la puerta de uso.

Viene de `niveles.md` §1 (paso 2 de su orden) y de `cimentacion-y-arriostramientos.md` §3.

**Decidido por el usuario el 2026-11-01:**

- **CB-c:** una lista general `barras` (vigas inclinadas, tornapuntas, zancas, diagonales y cualquier barra entre dos puntos), no una lista `diagonales`. El objeto `cruz` queda para más adelante; una cruz son dos barras.
- **CB-f:** la zona rígida de una barra llega hasta la cara del pilar de hormigón al que llega. En metálica, ninguna.
- **Alcance:** primero de planta a planta. Después se podrán poner a otras alturas (`dz`), así que el esquema lo prevé desde ya.

**Sin decidir, y no bloquean BN:**

- **CB-d:** el diafragma por defecto de una planta sin losas;
- **CB-e:** cómo se tratan las cruces hasta que haya cálculo no lineal. BN aplica la opción a: lineal, con las dos activas y el aviso de compresión.

## 1. Qué es

Una barra es una pieza recta entre dos puntos del edificio, cada uno en una planta. Puede ser inclinada, horizontal (las dos en la misma planta) o vertical.

- **Ejemplos:** el dintel inclinado de una nave, un tornapuntas desde un pilar hasta una viga de la planta de encima, una diagonal de arriostramiento o una barra en el plano de un forjado.
- **Qué no es:** una viga ni un pilar. Esas piezas siguen como están: la viga va en el plano de su planta, con su unión a la losa por las caras (LV), y el pilar sigue con su huella, su punto fijo y sus tramos.

## 2. El modelo físico

```ts
interface ExtremoBarra {
  planta: string;
  x: number;
  y: number;
  /** m sobre la cota de la planta. Previsto en el esquema; en BN sólo 0 (`barra/dz-no-admitido`). */
  dz?: number;
}

interface Barra {
  id: string;
  nombre?: string;
  inicio: ExtremoBarra;
  fin: ExtremoBarra;
  seccion: string;
  /** Giro de la sección alrededor de su eje x, en grados. Por defecto, 0. */
  giro?: number;
  liberaciones?: { inicio?: Liberacion; fin?: Liberacion };
  /** Sólo trabaja a tracción. En BN se calcula lineal, con el aviso `barra/compresion`. */
  soloTraccion?: boolean;
}
```

- **Estaciones:** van desde el inicio, a lo largo de la longitud real.
- **Carga nueva `barra`:** como la de viga (`q` y `qb`, global o local, `desde` y `hasta`), por metro de longitud real.
  - Una carga por metro en proyección horizontal, como la nieve, se da escalada. Si hace falta, la opción de proyectar va en `niveles.md` (DN-d) con las losas inclinadas.
- **Ejes locales** (en la cabecera de `fisico.ts`, con su correspondencia en SAP2000, H02):
  - x, de inicio a fin;
  - z, en el plano vertical que contiene la barra y hacia arriba; es el `vz = +Z` del motor proyectado;
  - y = z × x;
  - `giro` gira y y z alrededor de x.

  En SAP2000 son los ejes por defecto de un frame inclinado. Si la barra es vertical (ángulo con la vertical por debajo de 1e-9), se aplica la regla de los pilares: z = +X girado `giro`.
- **Modificadores:** grupo nuevo `barras` en `modificadores`, sin nada por defecto. D4 no toca las barras.

## 3. El compilador (BN1)

### 3.1 Extremos

Cada extremo se coloca como un apoyo puntual (topología, paso 7, y `losas.ts`). Se prueba por este orden:

1. en la huella de un pilar que tiene nudo en esa planta: va a su nudo;
2. a un nudo a ≤ ε_snap;
3. sobre una viga a ≤ ε_snap: la viga se parte;
4. en una losa: su malla siembra el punto. Si cae en el ancho de una viga (LV), va al eje de la viga;
5. sobre el eje de un muro en esa cota: va a las estaciones del muro.

Si no cae en nada, error `barra/extremo-sin-apoyo`. En BN no hay barras en voladizo.

Además:

- **Longitud nula:** si los dos extremos van al mismo nudo, error `barra/longitud-nula`. Lo mismo si los dos puntos están a menos de ε_geom.
- **Si el punto se mueve:** igual que con los apoyos, el hueco entre el punto dibujado y el nudo es un offset rígido. Si pasa de ε_geom, aviso `topologia/fusion`.

### 3.2 Zona rígida (CB-f)

- **Extremo en el nudo de un pilar de hormigón con huella:** es rígido el tramo del eje de la barra dentro del prisma vertical de la huella, hasta la cara, entero (factor 1).
  - Se usa la huella del nudo, la misma con la que se unen las vigas de esa planta: la del tramo de debajo (o la del de encima, en la planta de la base). El material es el de ese tramo.
  - Un pilar con punto fijo y cambio de sección (PF) puede tener otra huella en el tramo de encima; la barra que sube desde el nudo usa igualmente la del nudo. Es una simplificación del lado de la zona rígida corta.
- **Pilar de acero o general, viga, losa o muro:** ninguna zona rígida.
- **Tramo flexible nulo:** error `barra/tramo-flexible-nulo`.

### 3.3 Peso propio, cargas y diafragma

- **Peso propio:** γ·A por metro de longitud real, en −Z global, sobre la recta de la barra. Va al control «sin pérdidas» como las demás piezas.
- **Cargas `barra`:** se reparten en los trozos de su recta (`cargas.ts`), como las de viga y pilar.
- **Diafragma:** si los dos extremos caen en el mismo diafragma rígido, aviso `barra/en-diafragma`. La barra no tiene axil por las acciones horizontales; las gravitatorias sí lo dan.

### 3.4 Mapeo, consultas y huella

- **Mapeo:** `BarraMapeada.tipo` incluye `"barra"`, y `piezas[id]` da sus barras en orden desde el inicio, con sus estaciones.
- **Consultas:** `EsfuerzosPiezas` le da sus diagramas como a cualquier pieza. Los pares de la losa (`conPares`) no se le aplican.
- **Huella:** `barras` se ordena por id en el físico canónico. Sin `barras`, la salida es la misma bit a bit y el compilador no cambia de versión, como en PF.
- **Esquema:** se regeneran `fisico.schema.json` y el del proyecto.
- **Hipótesis:** el informe nombra las barras, sus ejes locales y sus zonas rígidas.

## 4. Criterios de BN1

1. **Oráculo a mano:** pórtico con dintel inclinado, tornapuntas de pilar a viga y celosía plana de dos plantas. Cada uno frente a su modelo analítico hecho a mano, con desplazamientos y esfuerzos a ≤ 1e-10. La celosía articulada también frente a su solución por nudos, en axiles a ≤ 1e-9.
2. **Extremos:** una prueba por destino (pilar, nudo, viga partida, losa, ancho de una viga y muro) y el error `barra/extremo-sin-apoyo`. ΣF y ΣM a 1e-9 con su peso propio y sus cargas.
3. **Ejes locales:** una carga `local` en una barra inclinada y en una vertical, frente a la misma carga en globales. Un `giro` de 90° intercambia Iy e Iz.
4. **Zona rígida:** pilar de hormigón de 40 × 40 con la barra a 45°: el tramo rígido mide lo que se calcula a mano. Con el pilar de acero, ninguno.
5. **Metamórficas:** girar y trasladar el modelo da los resultados transformados a ≤ 1e-12, y cambiar el inicio por el fin da los mismos esfuerzos con su signo. El orden de las listas no cambia nada.
6. **Sin barras, nada cambia:** las referencias congeladas de C1–C5 y F salen idénticas, y las ecuaciones de los edificios objetivo no cambian.
7. **Referencia congelada nueva:** un pórtico arriostrado de dos plantas con losa, una cruz y un tornapuntas a una viga.
8. **Oráculo externo:** PyNite u OpenSeesPy con el pórtico arriostrado, a ≤ 1e-6.

### 4.1 Resultado de BN1 (2026-11-01)

Pasan los ocho criterios.

| Criterio | Dónde | Resultado |
|---|---|---|
| 1. Oráculo a mano | `src/compilador/barras.test.ts` | Pórtico arriostrado con la diagonal de acero, CB-f en los dos extremos y carga repartida: ≤ 1e-10 |
| 2. Extremos | `barras.test.ts` | Pilar, nudo a 3 cm (con `topologia/fusion`), viga partida, losa, ancho de la viga (a su eje) y muro; peso γ·A por la longitud real a 1e-10; los siete errores |
| 3. Ejes locales | `barras.test.ts` | Vertical, inclinada y girada, local frente a global a ≤ 1e-12; `giro` 90° = b y h cambiados |
| 4. Zona rígida | `barras.test.ts` | 0,2·√2 en un pilar de hormigón de 40 a 45°, 0 en uno de acero, a 1e-14 |
| 5. Metamórficas | `barras.test.ts` | Traslación y giros de 90° y 37° a ≤ 1e-12 (pórtico) y ≤ 1e-9 (con losa y muro, la misma malla); invertir las barras, ≤ 1e-12; reordenar, bit a bit |
| 6. Sin barras, nada cambia | batería del compilador | 869 pruebas, las referencias congeladas de C1–C5 y F idénticas |
| 7. Referencia congelada | `congelado-bn.test.ts`, `validacion/bn/congelar.ts` | Pórtico arriostrado de dos plantas con losas, cruz, tornapuntas y diagonal a la losa, con h = 0,75 y 1 |
| 8. Oráculo externo | `oraculo-bn.test.ts`, `validacion/bn/oraculo_pynite.py` | Pórtico de acero montado en PyNite 3.2.0 desde el modelo físico: u, reacciones y axiles a ≤ 1e-11 |

**Lo que da el pórtico arriostrado** (`validacion/bn/out_medir.txt`):

- con el viento, la cruz trabaja como se espera: X1 a +3,7 kN y X2 a −3,7 kN;
- con el peso propio, la diagonal X1, declarada «sólo tracción», queda comprimida (−2,0 kN). Es el caso del aviso `barra/compresion` de BN2.

**Fuera del compilador,** lo justo para que todo siga compilando:

- la carga `barra` en el dibujo de cargas (`render/cargas.ts`), en la sensatez de A3 y en el 3D de cargas;
- la colección `barras` en las referencias del editor (renombrar y borrar en cascada);
- el tipo `barra` en las envolventes de `fem consultar`.

Lo demás de la app es BN2.

**Los ejes y la geometría de una barra** están en `src/compilador/barras.ts` (`ejesBarra`, `puntosBarra`), para el dibujo y el 3D.

## 5. BN2: en la app

- **Editor:**
  - tabla Barras (plantas, sección, liberaciones, giro, «sólo tracción») y carga En barra;
  - Renumerar, borrar en cascada, Mover, Copiar, Girar, Simetría, estirar (CT2) y los usos de una sección (GE1).
- **Dibujo:**
  - en planta, la proyección en discontinua con una flecha hacia el extremo alto;
  - en el alzado, las barras del plano;
  - en el 3D, la sección barrida (sólido) y el eje (alámbrico);
  - selección en todas las vistas.
- **Resultados:** diagramas en el alzado y en el 3D, «cualquier pieza» en Diagramas, y `fem consultar` de una barra.
- **Agente:**
  - el peso esperado de A3 cuenta las barras;
  - la bajada tributaria las deja fuera y lo dice;
  - en los resultados, el aviso `barra/compresion` de las barras «sólo tracción» comprimidas en alguna combinación;
  - la skill `fem`, con las barras y sus ejes.

**Criterios de BN2:** cada vista con su prueba (lo dibujado, frente a la compilación) y el banco de Chrome con los mismos bits que Node. Cada operación del editor, de ida y vuelta byte a byte. Falta la puerta de uso.

### 5.1 Resultado de BN2 (2026-11-01)

Pasan los criterios; falta la puerta de uso.

**Editor** (`src/editor/barras.test.ts`):

- **Tabla Barras:** planta, x e y de cada extremo, sección, giro, «sólo tracción» y liberaciones. Ida y vuelta exacta; el `dz`, que la tabla no edita, se conserva. Se ve en las plantas de sus dos extremos.
- **Carga «barra»** en la tabla Cargas, con `sobre` la barra.
- **Mover, Copiar, Girar y Simetría:**
  - una inclinada lleva sus ejes con ella, así que su `giro` sólo cambia de signo con la simetría;
  - una vertical gira su sección como un pilar, con el sentido de su x;
  - mover y volver, cuatro giros de 90° y dos simetrías dejan los bytes;
  - el pórtico de acero girado 37° o reflejado da los desplazamientos girados o reflejados a ≤ 1e-9.
- **Estirar (CT2):** los extremos como vértices; las estaciones de una carga de barra se vuelven a medir por la longitud real.
- **Mover un pilar (CT3):** lo siguen las barras con un extremo en su punto fijo, como las vigas (con Ctrl, no; se avisa).
- **Renumerar:** B1…Bn, por la planta de su extremo bajo y el punto medio de su proyección.
- **«Nueva…» sección desde la tabla Barras:** propone acero.

**Dibujo** (`src/visor/barras.test.ts`):

- **Planta:** la proyección en discontinua (estilo `barra`) en las plantas de sus dos extremos, con una flecha hacia el extremo alto; una vertical, un círculo.
- **Alzado:** de extremo a extremo (`barra-alzado`) si los dos están a menos de la profundidad del plano; si lo cruza, un círculo; en el analítico, la barra del motor.
- **3D:**
  - sólido: la sección barrida en sus ejes, cerrada y con el volumen A·L a 1e-11, en la planta de su extremo alto;
  - alámbrico: su eje;
  - tipo «Barras» en los filtros y en las vistas guardadas.

**Resultados:**

- Los diagramas del 3D y del alzado ya recorrían todas las piezas del mapeo.
- **Resultados · Diagramas:**
  - la lista da «Barras que llegan a» la planta;
  - un clic en una barra la elige;
  - su detalle va desde el inicio, con sus dos plantas y su máximo y mínimo.
- **`fem consultar pieza <barra>`:** sus extremos a lo largo de ella (N+, N−, Vy, Vz, My, Mz). Las envolventes la agrupan por la planta de su inicio.

**Agente** (`src/agente/barras.test.ts`):

- **Peso propio esperado de A3:** las barras, γ·A por la longitud real en la planta del extremo alto, salvo la zona rígida del extremo bajo (CB-f, la que el compilador lleva a esa planta). Coincide con el del cálculo planta a planta a precisión de máquina. La columna «Barras» del informe sólo sale con barras.
- **Bajada tributaria:** el peso y las cargas verticales de cada barra, a sus dos extremos como una biapoyada.
- **`barra/compresion`** (sólo si hay alguna «sólo tracción»): N < 0 en alguna combinación de esfuerzos (sin acciones, cada caso). En el pórtico arriostrado, X1 con 1,4·(G + Q): −4,17 kN.
- **Umbral nuevo, `dimensionBarra`** de 0,01 a 3 m: el mínimo de las secciones que sólo usan barras. Con el de 0,1 m, un redondo de 3 cm salía como «¿está en cm?». Los umbrales de A3 los fijó el usuario: éste es nuevo, por confirmar.
- **La skill `fem`:** las barras, sus ejes, sus uniones, la diagonal articulada, «sólo tracción» y el diafragma.

**Banco de Chrome** (`validacion/bn/chrome.ts`, `out_chrome.txt`), con el pórtico arriostrado en la app compilada:

- la planta P1, el sólido y el alzado del eje B, con los bits de Node;
- la tabla Barras con sus cuatro barras;
- los diagramas de My en el 3D, con los triángulos de Node (cuatro barras con diagrama);
- el detalle de T1 desde la lista de Diagramas.

## 6. BN3: la herramienta «Barra» del alzado

Dos clics enganchados en el alzado: cruces de pilar y nivel, puntos de las vigas, caras y ejes. Para eso hace falta el índice de enganches en (u, z) y la vuelta a (x, y, planta).

En planta, con la herramienta Barra, el primer clic y el segundo pueden ir en plantas distintas, eligiendo la del segundo en la plantilla.

**Criterio de BN3:** lo dibujado da, byte a byte, lo mismo que su fila de la tabla. Banco de Chrome con el pórtico arriostrado dibujado.

### 6.1 Resultado de BN3 (2026-11-01)

Pasa el criterio; falta la puerta de uso (con la de BN2).

**Qué hay:**

- **El índice del alzado** (`src/editor/dibujo/alzado.ts`): los enganches de un plano en (u, z), como su vista, y cada rasgo con su punto del modelo (planta, x, y). `enganches.ts` lo devuelve con el enganche (`Enganche.modelo`); en planta ningún rasgo lo lleva y todo sigue igual. Engancha, de lo que está a menos de la profundidad del plano:
  - los nudos de los pilares en cada planta, en el eje del tramo de debajo (en la base, el de encima: la huella del nudo de CB-f, también con punto fijo y cambio de sección), «Centro»; y sus caras vistas desde el plano, «Cara»;
  - las vigas paralelas (extremos, vértices, punto medio y el más cercano) y el cruce de las que lo atraviesan; los muros, igual, en cada planta que tocan;
  - el cruce de cada eje de replanteo con cada nivel, y los extremos de las barras del plano;
  - las líneas de nivel: el más cercano y la perpendicular desde el primer extremo (una barra vertical).
- **La herramienta Barra** (`src/editor/dibujo/barra.ts`), en la barra de Modelo tras Viga, con dos clics:
  - en un alzado, cada extremo en el nivel en que se hace clic; un punto que no está en una línea de nivel es un error (en BN, `dz` = 0);
  - en planta, el primero en la de la vista y el segundo en la «planta del fin» de la plantilla o, sin ella, en la de la vista del segundo clic;
  - el primer extremo es del modelo: sigue al pasar a otra vista, se pinta en todas y el segundo clic puede ir en cualquiera (en un alzado y en una planta, o en dos plantas);
  - plantilla: sección (sin ninguna de barras, se crea con acero propuesto, como en la tabla), giro, uniones «Empotradas» o «Articuladas» (las de la diagonal del pórtico: My y Mz en los dos extremos y la torsión en el fin), «sólo tracción» y la planta del fin;
  - en un alzado se teclea «u; z», «@du; dz» o «@L<α»; la barra de estado dice dónde queda el extremo («→ P1 (5; 0)»).
- **En la app** (`app/src/dibujo/controlador.ts`): los alzados de Modelo llevan su adaptador (`adaptadorAlzado`), que sólo dibuja con Barra; con las demás herramientas, sus clics eligen como siempre.

**Exactitud:** el punto del modelo de un nudo, un vértice, un extremo o un cruce con rectas paralelas a X o a Y es el del modelo, bit a bit. El de una cara, un punto medio, un punto de una recta o uno tecleado, redondeado a 1e-9 m (como las estaciones de V2c2-1); en un alzado paralelo a X o a Y, la coordenada del plano, tal cual. Así, «@1,5; 3» desde el nudo de (0; 4) da (1,5; 4).

**Validación:**

| Qué | Dónde | Resultado |
|---|---|---|
| Criterio, en Node | `src/editor/dibujo/barra.test.ts` | Las cuatro barras del pórtico arriostrado (la cruz en el alzado del eje A, el tornapuntas en el del B con «@1,5; 3», la diagonal en la planta C con la planta del fin y el giro): las del pórtico con los ids de lo dibujado, byte a byte con sus filas de la tabla, y compilan sin fusiones |
| El índice del alzado | `barra.test.ts` | El nudo de un pilar con punto fijo y cambio de sección en cada planta; caras; el cruce exacto de una viga, un eje y un muro; un punto fuera de los niveles; la perpendicular (una barra vertical); un alzado girado 30°, bit a bit |
| Entre vistas | `barra.test.ts`, `app/src/test/barra.test.ts` | El primer extremo en un alzado y el segundo en una planta; el alzado no dibuja con otra herramienta; lo tecleado en un alzado; deshacer, una barra por paso |
| Banco de Chrome | `validacion/bn3/chrome.ts`, `out_chrome.txt` | El pórtico arriostrado dibujado con el ratón y el teclado en la app compilada: su huella es la de Node, lo guardado tiene sus barras byte a byte y cuatro pasos de deshacer vuelven a la de partida. En el alzado del edificio objetivo, pasar y pintar con el primer extremo puesto, 0,1 ms p95 (el índice, 2–4 ms la primera vez), sin tareas largas |

Las pruebas de dibujo de antes (`src/editor`, 386, y las de la app) pasan sin cambios.

**Decisiones tomadas al hacerlo (para revisar en la puerta de uso):**

- **BN3-a:** un clic fuera de las líneas de nivel en un alzado es un error, no un extremo a otra altura (hasta que haya `dz`).
- **BN3-b:** en planta, la planta del fin por defecto es la de la vista del segundo clic (con una sola vista, una barra en el plano de la planta); para una diagonal entre plantas desde una sola vista, se elige en la plantilla.
- **BN3-c:** «Articuladas» son las uniones de la diagonal del pórtico arriostrado (la torsión, en el fin, para que no sea un mecanismo).
- **BN3-d:** cada barra son dos clics; el segundo extremo no empieza la siguiente (una cruz, cuatro clics).
- **BN3-e:** el nudo de un pilar en el alzado engancha como «Centro» (nivel 1), por delante de los extremos de vigas y barras.

**Hallazgo (BN3-1):** el botón «Guardar» dice «Guardar●» con cambios sin guardar; el ayudante de los bancos lo buscaba por su texto exacto y no lo encontraba. El de V2c (`diferencias`) tiene el mismo descuido, pero sólo se usa cuando las huellas no casan.

## 7. Después de BN

- **`dz`:** un nudo intermedio en el pilar (lo parte) y las mesetas.
- **El objeto `cruz`.**
- **Lo no lineal (§4 de `cimentacion-y-arriostramientos.md`):** las barras sólo a tracción de verdad.
