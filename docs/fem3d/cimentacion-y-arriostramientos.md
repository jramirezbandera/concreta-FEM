# Propuesta — losa de cimentación sobre balasto y arriostramientos metálicos

> **Fecha:** 2026-10-13. **Estado:** propuesta, sin fecha de desarrollo. No hay nada decidido ni hecho.
>
> **Origen:** el usuario. Hoy, la base de un pilar o un muro sólo puede ser libre (`"ninguno"`), articulada o empotrada. Con eso no se modela:
> - una losa de cimentación como la de CYPECAD: los pilares caen en ella, la losa es «de cimentación» con su coeficiente de balasto y se calcula sobre muelles en los nudos de su malla;
> - una estructura metálica con cruces de arriostramiento: diagonales articuladas en sus extremos que van de la cabeza de un pilar al pie del siguiente.
>
> **Este documento** deja escrito cómo encajaría cada cosa, qué hay ya, qué falta y qué tendría que decidir el usuario, para que cuando toque se empiece por su plan y sus criterios (regla de oro 1), no desde cero.

## 1. Lo que ya hay

- **Muelles en el motor.** `Muelle` (`src/motor/modelo.ts`) admite 6 rigideces (diagonal) o 36 (matriz simétrica), a tierra o entre dos nudos coincidentes, en ejes globales o propios. Las reacciones incluyen los muelles a tierra, como las «Joint Reactions» de CSI, así que el control de ΣF/ΣM de cada cálculo (regla de oro 2) ya los cuenta. El compilador todavía no genera ninguno.
- **Pilares y muros sobre una losa.** `base: "ninguno"` une un pilar a una losa por su huella rígida (C2-d; apeo, 2026-10-12), y un muro, por sus nudos de la base (C3-f). Un pilar que arranca en una losa de cimentación es exactamente eso.
- **Liberaciones** en los dos extremos de pilares y vigas (`Liberacion`, `fisico.ts`), con la condensación de E2, y la base `"articulado"`.
- **Acero:** material `acero` y perfiles en I del catálogo de Concreta.
- **Lo que no hay:**
  - una barra inclinada en el modelo físico: la viga es horizontal, en el plano de su planta, y el pilar es vertical;
  - un cálculo que no sea lineal: las consultas combinan resultados por caso con factores (`combinar` en `src/compilador/envolventes.ts`), y `diseno-tecnico.md` §11.3 ya avisaba de que los elementos sólo a tracción o a compresión y el contacto exigen resolver cada combinación por separado.

## 2. Losa de cimentación sobre balasto

### 2.1 Modelo físico

Un campo opcional en la losa:

```ts
cimentacion?: {
  /** Módulo de balasto vertical, kN/m³, ya corregido por tamaño y forma (lo decide el ingeniero). */
  balasto: number;
  /** Otro balasto en una parte de la losa (bordes, bajo un núcleo…). */
  zonas?: readonly { poligono: readonly Vec2[]; balasto: number }[];
  /** Lo horizontal (§2.3). */
  horizontal?: "coartado" | { kh: number };
};
```

- Los pilares y muros que arrancan en la planta de la losa llevan `base: "ninguno"`. Si llevan `"empotrado"` o `"articulado"` y caen sobre la losa, quedarían apoyados dos veces: error `pilar/apoyo-sobre-cimentacion` (y el del muro).
- La planta de cimentación es la más baja, normalmente de tipo `sotano`. Por defecto no tiene diafragma (C1-d).
- El campo es opcional, así que los proyectos que ya existen no cambian. `compilar` rechaza los campos desconocidos (A-1), así que hay que añadirlo al esquema.

### 2.2 Compilador

- **Muelle vertical por nudo:** Kz,i = ∫ k·Nᵢ dA sobre las láminas de la losa (la fila sumada de la matriz consistente; con un cuadrilátero regular, k·A/4 por esquina). Va como `Muelle` a tierra, en ejes globales, así que **el motor no cambia**.
- **Con zonas,** k se integra por su parte de cada lámina; los bordes de las zonas se siembran en la malla, como los de las cargas.
- **Alternativa consistente:** la matriz completa ∫ k·Nᵀ·N dA acopla los nudos de cada lámina y tendría que ir en el motor, como contribución de la lámina. Con la malla de 0,75 m las dos tendrían que converger a lo mismo. Se mide antes de elegir (y se mira cuál usan SAP2000 y CYPECAD); la de muelles por nudo es la que ya cabe en el motor.
- **La huella de los pilares** es rígida, pero sus nudos son de la losa: llevan su muelle como los demás.

### 2.3 Lo horizontal

El modelo de Winkler sólo da rigidez vertical. Sin nada más, la losa y todo lo que tiene encima son un mecanismo en X, en Y y en el giro en planta (el motor lo diagnostica, pero el modelo no calcula). Hay dos opciones:

- **`"coartado"`:** ux y uy coartados en los nudos de la losa. Es lo más simple y lo más rígido: la losa no se estira en su plano. Habría que comprobar qué hace CYPECAD.
- **`{ kh }`:** muelles horizontales con un balasto horizontal (rozamiento o empuje pasivo). Es más realista, pero el giro en planta tiene que quedar sujeto (o se avisa de un mecanismo).

### 2.4 Salidas

- **Tensión en el terreno** σ = k·w por nudo y por combinación (ELS característica, para la tensión admisible): consulta `terreno`, isovalores en planta y en 3D, y su máximo en el informe de revisión.
- **Asientos** (w) y su distorsión angular entre pilares.
- **Despegue:** un muelle en tracción en alguna combinación da el aviso `cimentacion/despegue`, con dónde y cuánto. Hacerlo bien es lo no lineal de §4.
- **El armado** sale con las franjas de F, que no saben si la losa es de cimentación. Cambia la lectura: en una losa de cimentación, lo que en un forjado es armado superior va abajo, y al revés. Las vistas y las tablas tienen que decirlo.
- **Sensatez (A3):** el peso esperado de la losa entra en la bajada de cargas, y la suma de reacciones de los muelles tiene que igualar las cargas totales, como hoy con los apoyos.

### 2.5 Validación

- **Patch test:** una losa libre con carga uniforme en toda su superficie (peso propio incluido) tiene que dar w = q/k exacto en todos los nudos y momentos nulos.
- **Viga de Hetényi** sobre Winkler: una franja de losa en flexión cilíndrica con una carga lineal, frente a la solución cerrada.
- **Placa infinita con carga puntual:** w₀ = P/(8·√(D·k)), y el momento bajo la carga, frente a Westergaard.
- **Losa rígida** (k pequeño frente a la rigidez de la losa): asiento y giro de sólido rígido de la resultante.
- **OpenSeesPy** con muelles `zeroLength` en los nudos de la misma malla, a precisión de máquina.
- **Un modelo del usuario** de SAP2000 o CYPE, como en E6-12 y E6-13.
- **Huella congelada** y referencia, como en cada fase.

### 2.6 Lo que sale casi gratis con lo mismo

- **Vigas de cimentación y riostras sobre balasto:** muelles por longitud tributaria (k·b·ℓᵢ), con la barra partida en tramos de h.
- **Zapatas aisladas como base elástica:** `base: { muelle: [kx, ky, kz, krx, kry, krz] }` en un pilar o un muro, que es un `Muelle` en su nudo de la base.

## 3. Estructura metálica con cruces de arriostramiento

### 3.1 Modelo físico

Una lista nueva, `diagonales`. La otra opción es una lista general, `barras`, que también serviría para un tornapuntas o una barra inclinada cualquiera; es decisión del usuario.

```ts
interface Diagonal {
  id: string;
  /** Extremos: un punto en planta y su planta. */
  inicio: { planta: string; x: number; y: number };
  fin: { planta: string; x: number; y: number };
  seccion: string;
  /** Por defecto, true: My y Mz liberados en los dos extremos y la torsión en el inicio. */
  articulada?: boolean;
  liberaciones?: { inicio?: Liberacion; fin?: Liberacion };
}
```

- **Ejes locales** de una barra inclinada: x de inicio a fin; z en el plano vertical que la contiene, hacia arriba; y = z × x. Si es vertical, la regla de los pilares. Va en la cabecera de `fisico.ts`, con su correspondencia con SAP2000 (H02).
- **Articulada:** con la torsión liberada en los dos extremos sería un mecanismo, así que se libera en uno, como las viguetas (C4-c, E2-3).
- **Cruz:** se puede dar como dos diagonales, o como un objeto `cruz` (un recuadro entre dos pilares y dos plantas) que el compilador convierte en dos. Con la opción de unir las dos en el cruce o dejarlas pasar sin tocarse. Para la longitud de pandeo, eso importa; para el cálculo a tracción, no.
- **En la app (V2c):** la herramienta «Cruz», con un clic en un recuadro del alzado.

### 3.2 Compilador

- **Cada extremo se busca como una carga puntual:** el nudo de un pilar en esa planta, un punto de una viga (que se parte; ya se hace con las viguetas, C4-d), el nudo de una losa o un muro. Si no cae en nada: error `diagonal/extremo-sin-apoyo`.
- **Zona rígida:** en metálica, ninguna (el nudo es el del eje). Si la diagonal llega a un pilar de hormigón, se decide si llega a su cara o a su eje.
- **Peso propio** como carga repartida de la diagonal en ejes globales.

### 3.3 El diafragma

- **Con diafragma rígido,** una diagonal en el plano de un forjado (el arriostramiento de cubierta) no recibe ninguna fuerza, y las vigas que hacen de montante, ningún axil.
- **Por lo que se ve en `compilar.ts`,** en una planta sin losas el diafragma rígido por defecto abarca los nudos de la cota. Hay que comprobarlo. En una nave metálica, eso anula precisamente lo que se quiere calcular.
- **Propuesta:** aviso `diagonal/en-diafragma` cuando los dos extremos caen en el mismo diafragma rígido, y que el diafragma por defecto de una planta sin losas sea `"ninguno"` (decisión del usuario: cambia la huella de los modelos que ya existen sin losas en alguna planta).

### 3.4 Las barras sólo a tracción

Una cruz de San Andrés con barras esbeltas (redondos, angulares sencillos) sólo trabaja a tracción: con cada sentido de la acción horizontal trabaja una diagonal y la otra pandea sin carga. Hay tres maneras:

- **a) Lineal con las dos diagonales activas.** Es exacto si se dimensionan también a compresión (tubos, angulares dobles). Si no, da la mitad de la fuerza a cada una.
- **b) Aproximación lineal clásica:** las dos con A/2, y la de tracción se dimensiona para |N₁| + |N₂|. Da la rigidez de la diagonal traccionada sola. Falla con la compresión que les mete la carga gravitatoria al acortarse los pilares, y no lo ve nadie si no se avisa.
- **c) Exacta:** por cada combinación, se resuelve, se quitan las diagonales comprimidas y se vuelve a factorizar hasta que ninguna cambie (§4). Las naves y los edificios metálicos son modelos pequeños, así que es barato.

Propuesta: **a** primero, con el aviso `diagonal/compresion` si una diagonal declarada «sólo tracción» queda comprimida en alguna combinación; **c**, con lo no lineal.

### 3.5 Validación

- **Celosías y pórticos arriostrados** con solución a mano: el reparto del cortante entre las diagonales y los pilares.
- **PyNite** (tiene barras sólo a tracción, con su iteración) y **OpenSeesPy** (`truss` y `corotTruss`), como oráculos.
- **Metamórficas:** el giro de la planta, el cambio del sentido de la acción (con sólo tracción, la diagonal que trabaja cambia de una a la otra).
- **Huella congelada** y referencia.

## 4. Lo que comparten: el cálculo no lineal por combinación

El despegue del terreno (§2.4) y las barras sólo a tracción (§3.4) rompen la superposición. Con ellos, una combinación no es una suma de casos con factores: es un cálculo propio.

- **El motor** ya puede hacerlo: refactorizar es lo que hace cada cálculo. Falta el bucle (activar y desactivar muelles y barras hasta que nada cambie, con un tope de iteraciones y un diagnóstico si no converge) y el equilibrio, que se comprueba en cada combinación como hoy en cada caso.
- **Las consultas:** hoy combinan con `combinar(porCaso, n, factores)`. Con lo no lineal, una combinación será un resultado guardado más, junto a los casos. Para no cerrar esa puerta, **lo nuevo que se haga en las consultas tendría que trabajar sobre «un vector de resultados»** y no dar por hecho que se combina linealmente. Cuando llegue, habrá que revisar cuánto de lo que ya hay depende de esa suposición; no se ha medido.
- **`.fem/`** guarda los resultados por caso; los de las combinaciones no lineales irían al lado, con la misma regla de la huella y el sha256 (V1-7).
- **El tiempo:** una factorización por combinación e iteración. Con un edificio grande y muchas combinaciones, eso no cabe en el móvil; con una nave metálica, sí. El límite de D9 tendría que contar las combinaciones no lineales.

## 5. Orden propuesto

1. **Losa de cimentación lineal** (§2): sólo compilador, salidas y validación, con el `Muelle` que ya existe. Con el aviso de despegue.
2. **Diagonales lineales** (§3, opción a), con el aviso del diafragma y el de compresión.
3. **Cálculo no lineal por combinación** (§4): el despegue y las barras sólo a tracción a la vez, porque comparten todo.

Cada paso, con su plan y sus criterios fijados al empezar, como las demás fases.

## 6. Decisiones del usuario para cuando toque

- **CB-a:** lo horizontal de la losa de cimentación: `"coartado"` o un balasto horizontal (§2.3), y cuál por defecto.
- **CB-b:** muelles por nudo o matriz consistente (§2.2), después de medirlas.
- **CB-c:** `diagonales` o `barras` en general (§3.1), y si se añade el objeto `cruz`.
- **CB-d:** el diafragma por defecto de una planta sin losas (§3.3).
- **CB-e:** cómo se tratan las cruces hasta que haya cálculo no lineal: opción a o b (§3.4).
- **CB-f:** si una diagonal que llega a un pilar de hormigón llega a su cara o a su eje (§3.2).
