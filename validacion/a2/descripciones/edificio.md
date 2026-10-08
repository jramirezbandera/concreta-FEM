# Edificio objetivo: siete plantas con losa maciza y vigas

Edificio de hormigón de siete plantas, con 80 pilares, vigas por todos los ejes, vigas secundarias y una losa maciza por planta.

Unidades: kN y m.

## Niveles

- **Plantas:** N1 a N7, de abajo arriba, con 3 m de forjado a forjado.
- **Cimentación:** el nivel C (nivel de sótano), 1,5 m por debajo de N1.

## Material

Hormigón HA-30: fck = 30 MPa. El resto de sus propiedades, por defecto.

## Pilares

**Retícula:** 10 × 8 pilares, en los cruces de x = 0, 6, 12, …, 54 m (cada 6 m) con y = 0, 5, 10, …, 35 m (cada 5 m). Todos van de C a N7, continuos y empotrados en C.

**Sección**, según la fila:

| Fila | Sección |
|---|---|
| y = 0, 10, 20 y 30 | Rectangular de 30 × 50 cm: b = 30 cm de ancho, h = 50 cm de canto |
| y = 5, 15, 25 y 35 | Cuadrada de 40 × 40 cm |

**Orientación**, según la columna:

| Columna | Orientación |
|---|---|
| x = 0, 12, 24, 36 y 48 | El canto h va según X (giro 0) |
| x = 6, 18, 30, 42 y 54 | **Todos** sus pilares, también los de 40 × 40, llevan el canto girado 90°: h según Y |

## Vigas (en cada planta, de N1 a N7)

**Principales,** de 30 × 60 cm (30 de ancho y 60 de canto), continuas por todos los ejes de pilares:
- en X: una por cada fila y = 0, 5, …, 35, de x = 0 a x = 54;
- en Y: una por cada columna x = 0, 6, …, 54, de y = 0 a y = 35.

**Secundarias,** de 25 × 40 cm, en la mitad de cada vano en X: en x = 3, 9, 15, …, 51.
- Cada una va en dirección Y de un eje de pilares al siguiente, de y = 5j a y = 5(j + 1), con j = 0 … 6.
- Son 9 × 7 = 63 por planta.

## Losa (en cada planta)

- **Tipo:** maciza, de 25 cm de espesor, de HA-30.
- **Contorno:** a ejes, el rectángulo de (0, 0) a (54, 35).
- **Hueco de la escalera:** el rectángulo de (24,6, 15,4) a (29,4, 19,6).
- **Peso propio:** el de una losa maciza (el que el programa calcula por defecto).

## Casos y cargas

Cuatro casos:

| Caso | Qué es |
|---|---|
| **G** | Permanentes, con el peso propio de la estructura |
| **Q** | Sobrecarga de uso |
| **Vx** | Viento en X |
| **Vy** | Viento en Y |

**En cada planta, de N1 a N7:**
- **G:** 2 kN/m² hacia abajo sobre toda la losa de la planta.
- **G:** tabiquería de 7 kN/m hacia abajo sobre la polilínea (1,5, 7,5) → (22,5, 7,5) → (22,5, 21,5).
- **Q:** 2 kN/m² hacia abajo sobre toda la losa de la planta.
- **Q:** además, 3 kN/m² hacia abajo en la zona rectangular de (6,8, 2,6) a (17,2, 12,4). Va sobre la losa de esa planta: lo que caiga fuera de ella no es carga.

**Viento,** en toda la altura de cada pilar (de C a N7):
- **Vx:** 3 kN/m en +X a lo largo de cada uno de los 8 pilares de la fachada x = 0.
- **Vy:** 3 kN/m en +Y a lo largo de cada uno de los 10 pilares de la fachada y = 0.

## Opciones de cálculo

Todas por defecto.
