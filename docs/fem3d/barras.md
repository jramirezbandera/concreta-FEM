# Fase BN: barras entre dos niveles

**Estado (2026-11-01):** plan fijado. Ha empezado BN1.

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
  - Se usa la huella del tramo de pilar que corresponde: el de debajo si la barra baja desde el nudo y el de encima si sube.
  - Una barra horizontal usa la huella del nudo, la de la losa.
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
  - en los resultados, el aviso `barra/compresion` de las barras «sólo tracción» comprimidas en alguna combinación.

**Criterios de BN2:** cada vista con su prueba (lo dibujado, frente a la compilación) y el banco de Chrome con los mismos bits que Node. Cada operación del editor, de ida y vuelta byte a byte. Falta la puerta de uso.

## 6. BN3: la herramienta «Barra» del alzado

Dos clics enganchados en el alzado: cruces de pilar y nivel, puntos de las vigas, caras y ejes. Para eso hace falta el índice de enganches en (u, z) y la vuelta a (x, y, planta).

En planta, con la herramienta Barra, el primer clic y el segundo pueden ir en plantas distintas, eligiendo la del segundo en la plantilla.

**Criterio de BN3:** lo dibujado da, byte a byte, lo mismo que su fila de la tabla. Banco de Chrome con el pórtico arriostrado dibujado.

## 7. Después de BN

- **`dz`:** un nudo intermedio en el pilar (lo parte) y las mesetas.
- **El objeto `cruz`.**
- **Lo no lineal (§4 de `cimentacion-y-arriostramientos.md`):** las barras sólo a tracción de verdad.
