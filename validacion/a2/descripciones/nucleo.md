# Retícula de una planta con núcleo de muros

Edificio de hormigón de una planta sobre la cimentación, con una losa maciza enrasada con la cara exterior de los pilares de fachada y un núcleo de muros con una puerta.

Unidades: kN y m.

## Niveles

| Nivel | Qué es | Cota |
|---|---|---|
| C | Cimentación (nivel de sótano) | 1,5 m por debajo de N1 |
| N1 | La única planta | — |

## Material

Hormigón HA-25: fck = 25 MPa. El resto de sus propiedades, por defecto.

## Pilares

- **Retícula:** 16 pilares en los cruces de x = 0, 6, 12 y 18 m con y = 0, 5, 10 y 15 m.
- **Sección:** cuadrada de 50 × 50 cm.
- **Altura:** van de C a N1, empotrados en C.

## Vigas (planta N1)

Todas de 30 × 50 cm (30 de ancho y 50 de canto), con su eje en el plano del forjado.

**En X**, una por cada línea de pilares (y = 0, 5, 10 y 15). Cada viga va de x = −0,25 a x = 18,25 m, de borde a borde de la losa.

**En Y**, una por cada línea de pilares (x = 0, 6, 12 y 18). Cada viga va de y = −0,25 a y = 15,25 m.

**Las vigas de fachada no van por el eje de los pilares.** Su cara exterior queda en el borde de la losa, así que su eje está 10 cm hacia dentro del de los pilares:

| Viga de fachada | Eje en |
|---|---|
| y = 0 | y = 0,10 |
| y = 15 | y = 14,90 |
| x = 0 | x = 0,10 |
| x = 18 | x = 17,90 |

Las interiores (y = 5 e y = 10; x = 6 y x = 12) van por el eje de los pilares.

## Losa (planta N1)

- **Tipo:** maciza, de 22 cm de espesor, de HA-25.
- **Contorno:** el rectángulo de (−0,25, −0,25) a (18,25, 15,25). Queda enrasado con la cara exterior de los pilares de fachada.
- **Hueco:** el rectángulo de (6,6, 5,4) a (11,4, 9,6), dentro del núcleo.
- **Peso propio:** el de una losa maciza (el que el programa calcula por defecto).

## Núcleo

Un muro de hormigón HA-25 de 25 cm de espesor, de C a N1, empotrado en su base.

**Eje:** la polilínea cerrada (6, 5) → (12, 5) → (12, 10) → (6, 10) → (6, 5).

**Puerta:** un hueco en el primer lado, el de y = 5.
- A lo largo del eje, va de 2,4 a 3,4 m medidos desde el primer punto (6, 5), es decir, de x = 8,4 a x = 9,4.
- En altura, va de 0 a 1,2 m sobre la base del muro.

## Casos y cargas

| Caso | Qué lleva |
|---|---|
| **G** | Sólo el peso propio de la estructura |
| **Q** | Sobrecarga de 3 kN/m² hacia abajo sobre toda la losa de N1 |
| **V** | Viento: 2 kN/m en +X, repartido a lo largo de cada uno de los cuatro pilares de la fachada x = 0, en toda su longitud |

## Opciones de cálculo

Tamaño de malla de losas y muros de 1 m. Las demás opciones, por defecto.
