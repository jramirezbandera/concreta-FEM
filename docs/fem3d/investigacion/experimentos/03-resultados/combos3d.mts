// Prototipo de generador de combinaciones CTE DB-SE 4.2.2 para un modelo 3D:
// familias excluyentes (viento en 4 direcciones), favorable/desfavorable de G
// (Tabla 4.1: 1,35 / 0,80), variables ausentes (γ = 0 si favorable), situación
// sísmica (4.5: Gk + Ad + Σψ2·Qk, sin γ) con 100/30 (NCSE-02 §3.4) y
// excentricidad accidental (NCSE-02 §3.2) como casos separados.
//
// Sólo es un prototipo de investigación: no forma parte del repo.

export interface BaseCase {
  id: string;
  kind: 'G' | 'Q' | 'S' | 'W' | 'E';
  /** Familia excluyente: como mucho un caso de la familia por combinación. */
  family?: string;
  psi0: number; psi1: number; psi2: number;
}

export interface Combo {
  id: string;
  situation: 'ELU-P' | 'ELU-S' | 'ELS-C' | 'ELS-F' | 'ELS-CP';
  factors: Float64Array; // alineado con cases
  label: string;
}

export function defaultCases(): BaseCase[] {
  return [
    { id: 'G', kind: 'G', psi0: 1, psi1: 1, psi2: 1 },
    { id: 'Q', kind: 'Q', psi0: 0.7, psi1: 0.5, psi2: 0.3 },
    { id: 'S', kind: 'S', psi0: 0.5, psi1: 0.2, psi2: 0 },
    { id: 'Wx+', kind: 'W', family: 'W', psi0: 0.6, psi1: 0.5, psi2: 0 },
    { id: 'Wx-', kind: 'W', family: 'W', psi0: 0.6, psi1: 0.5, psi2: 0 },
    { id: 'Wy+', kind: 'W', family: 'W', psi0: 0.6, psi1: 0.5, psi2: 0 },
    { id: 'Wy-', kind: 'W', family: 'W', psi0: 0.6, psi1: 0.5, psi2: 0 },
    // sismo estático equivalente por dirección y con la excentricidad accidental ±e
    { id: 'EX+e', kind: 'E', family: 'EX', psi0: 0, psi1: 0, psi2: 0 },
    { id: 'EX-e', kind: 'E', family: 'EX', psi0: 0, psi1: 0, psi2: 0 },
    { id: 'EY+e', kind: 'E', family: 'EY', psi0: 0, psi1: 0, psi2: 0 },
    { id: 'EY-e', kind: 'E', family: 'EY', psi0: 0, psi1: 0, psi2: 0 },
  ];
}

/** Grupos de variables: cada grupo aporta como mucho UN caso por combinación. */
function variableGroups(cases: BaseCase[]): number[][] {
  const groups = new Map<string, number[]>();
  cases.forEach((c, i) => {
    if (c.kind === 'G' || c.kind === 'E') return;
    const key = c.family ?? c.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  });
  return [...groups.values()];
}

export function buildCombos(cases: BaseCase[], opts: { gFav?: boolean; seismic?: boolean } = {}): Combo[] {
  const gFav = opts.gFav ?? true;
  const out: Combo[] = [];
  const nC = cases.length;
  const gIdx = cases.map((c, i) => (c.kind === 'G' ? i : -1)).filter((i) => i >= 0);
  const groups = variableGroups(cases);
  // Estado de cada grupo: -1 ausente, o índice del caso activo. Rol: principal o acompañante.
  type Pick = { idx: number; principal: boolean };
  const gammaGs = gFav ? [1.35, 0.8] : [1.35];

  // Enumeración: elegir principal (grupo + caso) o ninguno; resto de grupos: ausente o un caso acompañante.
  const principalOptions: (Pick | null)[] = [null];
  for (const g of groups) for (const i of g) principalOptions.push({ idx: i, principal: true });

  const recurse = (gi: number, picks: Pick[], principalGroup: number[] | null, emit: (p: Pick[]) => void) => {
    if (gi === groups.length) { emit(picks); return; }
    const g = groups[gi];
    if (g === principalGroup) { recurse(gi + 1, picks, principalGroup, emit); return; }
    recurse(gi + 1, picks, principalGroup, emit); // ausente (γ = 0, favorable)
    for (const i of g) recurse(gi + 1, [...picks, { idx: i, principal: false }], principalGroup, emit);
  };

  // ELU persistente/transitoria (4.3) y ELS característica (4.6)
  for (const [sit, gU, gQ] of [['ELU-P', 1, 1.5], ['ELS-C', 1, 1]] as const) {
    for (const pr of principalOptions) {
      const prGroup = pr ? groups.find((g) => g.includes(pr.idx))! : null;
      const emitWithG = (picks: Pick[]) => {
        if (!pr && picks.length > 0) return; // sin principal ⇒ sólo permanentes
        const gList = sit === 'ELU-P' ? gammaGs : [1];
        for (const gG of gList) {
          const f = new Float64Array(nC);
          for (const i of gIdx) f[i] = sit === 'ELU-P' ? gG : 1;
          const all = pr ? [pr, ...picks] : picks;
          for (const p of all) f[p.idx] = p.principal ? gQ : gQ * cases[p.idx].psi0;
          const label = `${sit} G${f[gIdx[0]]}` + all.map((p) => ` ${p.principal ? '*' : ''}${cases[p.idx].id}`).join('');
          out.push({ id: `${sit}-${out.length}`, situation: sit, factors: f, label });
        }
      };
      recurse(0, [], prGroup, emitWithG);
    }
  }
  // ELS cuasipermanente (4.8): G + Σψ2·Q (las variables con ψ2 = 0 no cuentan)
  {
    const f = new Float64Array(nC);
    for (const i of gIdx) f[i] = 1;
    cases.forEach((c, i) => { if (c.kind !== 'G' && c.kind !== 'E' && !c.family) f[i] = c.psi2; });
    out.push({ id: 'ELS-CP-0', situation: 'ELS-CP', factors: f, label: 'ELS-CP' });
  }
  // Situación sísmica (4.5) con 100/30 y excentricidad accidental
  if (opts.seismic ?? true) {
    const ex = cases.map((c, i) => (c.family === 'EX' ? i : -1)).filter((i) => i >= 0);
    const ey = cases.map((c, i) => (c.family === 'EY' ? i : -1)).filter((i) => i >= 0);
    const qIdx = cases.map((c, i) => (c.kind === 'Q' ? i : -1)).filter((i) => i >= 0);
    for (const [main, sec] of [[ex, ey], [ey, ex]]) {
      for (const im of main) for (const sm of [1, -1]) for (const is of sec) for (const ss of [1, -1]) {
        for (const qOn of [true, false]) {
          const f = new Float64Array(nC);
          for (const i of gIdx) f[i] = 1;
          if (qOn) for (const i of qIdx) f[i] = cases[i].psi2;
          f[im] = sm * 1.0;
          f[is] = ss * 0.3;
          out.push({ id: `ELU-S-${out.length}`, situation: 'ELU-S', factors: f, label: `ELU-S ${sm > 0 ? '+' : '-'}${cases[im].id} ${ss > 0 ? '+' : '-'}0.3${cases[is].id}${qOn ? ' +ψ2Q' : ''}` });
        }
      }
    }
  }
  return out;
}

if (import.meta.main) {
  const cases = defaultCases();
  const combos = buildCombos(cases);
  const count = (s: string) => combos.filter((c) => c.situation === s).length;
  console.log(`casos base: ${cases.length} (${cases.map((c) => c.id).join(', ')})`);
  for (const s of ['ELU-P', 'ELU-S', 'ELS-C', 'ELS-CP']) console.log(`${s}: ${count(s)} combinaciones`);
  console.log(`total: ${combos.length}`);
  const noFav = buildCombos(cases, { gFav: false, seismic: false });
  console.log(`ELU-P sin G favorable: ${noFav.filter((c) => c.situation === 'ELU-P').length}`);
  console.log('muestras:');
  for (const i of [0, 1, 2, 5, 40, 75]) console.log('  ', combos[i].label);
  const s0 = combos.find((c) => c.situation === 'ELU-S')!;
  console.log('  ', s0.label);
}
