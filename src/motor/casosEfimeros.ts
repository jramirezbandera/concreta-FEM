/**
 * Casos base efímeros (VS4): lo que los campos SPR y los cortes guardan de ellos se suelta al
 * cambiar de planta.
 *
 * Con el sismo del programa, cada modo es un caso base (VS3): en el edificio objetivo, 21 modos
 * junto a 4 casos del cálculo. Lo que una consulta guarda por caso base para no rehacerlo (el
 * evaluador SPR de cada caso en `CamposLaminas`, las fuerzas nodales de cada lámina en `Cortes`, los
 * campos de cada planta en los mapas) es del orden de los resultados del caso, y con los modos se
 * multiplicaba por 6: el mapa de una planta dejaba el worker de la app en 2,5 GB. Pero de los modos
 * sólo hace falta su combinación en cada punto (los casos del sismo), y ésa es por planta: lo de los
 * modos de una planta se guarda mientras se trabaja en ella (el mapa de M, el de V, las franjas de
 * las dos direcciones) y se suelta al pasar a otra. Lo que se vuelve a calcular da los mismos valores.
 */
import type { CamposLaminas } from "./campos.ts";
import type { Cortes } from "./cortes.ts";
import type { ResultadoCaso } from "./modelo.ts";

export class CasosEfimeros {
  private readonly campos: CamposLaminas;
  private readonly cortes: () => Cortes | null;
  private readonly casos: readonly ResultadoCaso[];
  /** Los índices de los casos efímeros (los modos). */
  readonly cuales: readonly number[];
  /** La unidad de trabajo actual (null al empezar): la planta, normalmente. */
  private unidad: string | null = null;
  /** Veces que se ha soltado (para las pruebas). */
  soltados = 0;

  /**
   * @param casos los casos base de las consultas; `cuales`, los índices de los efímeros (los modos).
   * `campos` y `cortes`, los que comparten las consultas (los que guardan); `cortes`, los que ya
   * existan al soltar (null si no hay: no se crean para eso).
   */
  constructor(campos: CamposLaminas, cortes: () => Cortes | null, casos: readonly ResultadoCaso[], cuales: readonly number[]) {
    this.campos = campos;
    this.cortes = cortes;
    this.casos = casos;
    this.cuales = cuales;
  }

  /** ¿Es efímero el caso base k? */
  esEfimero(k: number): boolean {
    return this.cuales.includes(k);
  }

  /**
   * Se va a trabajar en `unidad` (la planta de un mapa o de unas franjas; un muro): si es otra que la
   * de antes, suelta lo guardado de los casos efímeros. Lo que comparte una unidad (los mapas de M y
   * de V de una planta, sus franjas en las dos direcciones) se calcula una vez.
   */
  trabajarEn(unidad: string): void {
    if (this.unidad === unidad) return;
    if (this.unidad !== null) this.soltar();
    this.unidad = unidad;
  }

  /** Suelta lo guardado de los casos efímeros, estén donde estén. */
  soltar(): void {
    for (const k of this.cuales) this.campos.soltarEvaluador(this.casos[k]!.u);
    this.cortes()?.soltarCasos(this.casos, this.cuales);
    this.soltados++;
  }
}
