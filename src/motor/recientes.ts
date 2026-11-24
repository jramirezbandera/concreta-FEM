/**
 * Lo último que se ha pedido, hasta `capacidad` claves: al entrar una nueva sobre la capacidad, sale
 * la que lleva más tiempo sin pedirse. Para lo que se prepara por barra y caso y se vuelve a hacer
 * con las mismas cuentas si hace falta (los mismos bits): guardarlo de todas las barras del edificio
 * objetivo con sus 17 casos no cabe en el navegador.
 */
export class Recientes<K, V> {
  private readonly m = new Map<K, V>();
  /** La más reciente: pedirla otra vez no la mueve (lo normal, con sus casos seguidos). */
  private ultima: K | undefined;
  readonly capacidad: number;

  constructor(capacidad: number) {
    this.capacidad = Math.max(1, Math.floor(capacidad));
  }

  get size(): number {
    return this.m.size;
  }

  has(k: K): boolean {
    return this.m.has(k);
  }

  /** Lo guardado con la clave (también null, si es lo que se guardó); undefined si no está. Pasa a ser lo más reciente. */
  get(k: K): V | undefined {
    if (!this.m.has(k)) return undefined;
    const v = this.m.get(k) as V;
    if (this.ultima !== k) {
      this.m.delete(k);
      this.m.set(k, v);
      this.ultima = k;
    }
    return v;
  }

  set(k: K, v: V): void {
    if (this.m.has(k)) this.m.delete(k);
    this.m.set(k, v);
    this.ultima = k;
    if (this.m.size > this.capacidad) this.m.delete(this.m.keys().next().value as K);
  }

  clear(): void {
    this.m.clear();
    this.ultima = undefined;
  }
}
