# Generador de combinaciones CTE/NCSE (Fase 1 de S1, H30)

> **Código:** `src/combinaciones/` (`generador.ts`, `psi.ts`). **Tests:** `generador.test.ts`, 19 en total.
> **Fecha:** 2026-10-03.

## Qué hace

Cada combinación es un `Float64Array` de factores alineado con los casos de carga base. El motor resuelve cada caso una vez y Concreta superpone (H21). `matrizFactores()` da la matriz combinaciones × casos para el `ResultModel` (H36).

| Situación | Expresión | Notas |
|---|---|---|
| `ELU-PT` | DB SE 4.3: Σ γG·Gk + γQ·Qk,1 + Σ γQ·ψ0·Qk,i | γG de la tabla 4.1 según la fila de la permanente: peso propio 1,35/0,80, empuje 1,35/0,70, agua 1,20/0,90 |
| `ELU-ACC` | 4.4: Σ Gk + Ad + ψ1·Qk,1 + Σ ψ2·Qk,i | Una acción accidental por combinación; con `incendio`, también sin Ad |
| `ELU-SIS` | 4.5: Σ Gk + Ad + Σ ψ2·Qk,i | 100/30 en dos direcciones con signo ±. Excentricidad accidental como familia por dirección |
| `ELS-C`, `ELS-F`, `ELS-CP` | 4.6, 4.7, 4.8 | |
| `GEO`, `GEO-SIS` | DB SE-C 2.3.2.2, con γ = 1 | Para el terreno (zapatas, H31) |

**Reglas comunes:**
- Las permanentes son favorables o desfavorables «consideradas globalmente» (4.2.2-1): todas en el mismo estado, cada una con su γ.
- Una variable favorable no entra (γ = 0).
- De cada familia excluyente entra como mucho un caso (por ejemplo, el viento en 4 direcciones).
- No se repiten combinaciones: un ψ = 0 deja una igual a otra y se elimina.

**Cargas nocionales** (casos `N` con `derivadoDe`, RES-17):
- Sólo entran en `ELU-PT`, con el factor de su caso origen y el signo del viento presente.
- Si no hay viento, se genera una combinación por cada dirección y signo.
- No entran en sísmica: los efectos de segundo orden con sismo van por θ (NCSE-02), fuera de este módulo.

**Duración de la combinación** (kmod de la madera): la de la acción más corta presente.
- Por defecto: G permanente, Q media, nieve corta, viento corta, sismo instantánea.
- Por encima de 1 000 m, la nieve es media: se indica en el caso con `duracion: "media"`.

## Perfil CYPE

Con `perfil: "cype"` se reproducen los coeficientes de una memoria CYPE de CE/CTE (P2115, apartado A.3, del estudio):
- **G favorable 0,80 también en sísmica e incendio.** El DB SE, en las situaciones extraordinarias, toma G sin mayorar.
- **Para el terreno, todas las variables a 1,0 sin ψ.** Con sismo, sin viento y con la nieve a 1,0.

El perfil por defecto (`"cte"`) sigue la letra del DB SE. El perfil CYPE sirve para comparar con modelos espejo de CYPE (H47, S5).

## Validación

1. **Recuento del prototipo de H30:** 74 combinaciones `ELU-PT`, 64 `ELU-SIS` y 37 `ELS-C` con los 11 casos.
   - `ELS-CP` da 2 donde el prototipo daba 1, porque aquí la sobrecarga puede faltar.
2. **Fuerza bruta.** Recorre todo el producto de factores posibles de 12 casos variados y filtra con las expresiones del DB SE, escritas de nuevo en el test. Da el mismo conjunto que el generador en las 8 situaciones.
   - Se comprobó que detecta un error inyectado: ψ0 en lugar de ψ2 en `ELS-F`.
3. **Memoria CYPE P2115.** En cinco situaciones, los factores de cada acción coinciden con los de su tabla, transcrita en el test.

## Fuentes y hallazgo

- **ψ:** `psi.ts` copia la tabla 4.2 del texto del DB SE, no de Concreta.
- **Fallo en Concreta, fuera de este repo, para un PR aparte como los de S4:** `src/lib/calculations/loadGen.ts` da a la categoría E ψ = 1,0/0,9/0,8, que son los valores de almacén del Eurocódigo. El CTE dice 0,7/0,7/0,6 (tráfico y aparcamiento de vehículos ligeros).

## Pendiente

- **Comprobar el perfil CYPE en un listado real.** Se ha contrastado con la tabla de coeficientes de la memoria, no con un listado de combinaciones de CYPE. Queda por confirmar, en un listado exportado, que CYPE no trata cada permanente como favorable o desfavorable por separado.
- **γ de material por situación** (γc = 1,3 en sísmica, RES-13). Lo aplican los módulos de comprobación, no el generador.
