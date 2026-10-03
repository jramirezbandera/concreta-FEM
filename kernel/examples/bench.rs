//! Bench nativo (un hilo) del núcleo sobre una K en formato .kcsc (spike E0).
//!
//! cargo run --release --example bench -- K.kcsc [nrhs=24] [auto|super|simp]
//!
//! Imprime una línea JSON con tiempos, nnz(L), residuo relativo y el pico de memoria del
//! montón (asignador contador), para compararlo con la misma medida en WASM.

use concreta_fem_kernel::factor::{Factor, Modo};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

struct Contador;
static ACTUAL: AtomicUsize = AtomicUsize::new(0);
static PICO: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Contador {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = System.alloc(l);
        if !p.is_null() {
            let a = ACTUAL.fetch_add(l.size(), Ordering::Relaxed) + l.size();
            PICO.fetch_max(a, Ordering::Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l);
        ACTUAL.fetch_sub(l.size(), Ordering::Relaxed);
    }
}

#[global_allocator]
static GLOBAL: Contador = Contador;

fn mb(b: usize) -> f64 {
    (b as f64 / 1048576.0 * 10.0).round() / 10.0
}

fn leer_kcsc(ruta: &str) -> (usize, Vec<u32>, Vec<u32>, Vec<f64>) {
    let b = std::fs::read(ruta).expect("no se puede leer el .kcsc");
    assert_eq!(&b[0..4], b"KCSC");
    let u32_at = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
    let (n, nnz) = (u32_at(8) as usize, u32_at(12) as usize);
    let mut o = 16;
    let val: Vec<f64> = b[o..o + 8 * nnz].chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect();
    o += 8 * nnz;
    let cp: Vec<u32> = b[o..o + 4 * (n + 1)].chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect();
    o += 4 * (n + 1);
    let ri: Vec<u32> = b[o..o + 4 * nnz].chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect();
    (n, cp, ri, val)
}

/// y = A·x con A simétrica dada por su triángulo superior.
fn producto(n: usize, cp: &[u32], ri: &[u32], v: &[f64], x: &[f64], y: &mut [f64]) {
    y.iter_mut().for_each(|e| *e = 0.0);
    for j in 0..n {
        for p in cp[j] as usize..cp[j + 1] as usize {
            let i = ri[p] as usize;
            y[i] += v[p] * x[j];
            if i != j {
                y[j] += v[p] * x[i];
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let ruta = &args[1];
    let nrhs: usize = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(24);
    let modo = match args.get(3).map(|s| s.as_str()) {
        Some("super") => Modo::Supernodal,
        Some("simp") => Modo::Simplicial,
        _ => Modo::Auto,
    };
    let (n, cp, ri, val) = leer_kcsc(ruta);
    let base = ACTUAL.load(Ordering::Relaxed);
    PICO.store(base, Ordering::Relaxed);

    let t0 = Instant::now();
    let mut f = Factor::analizar(n, cp.clone(), ri.clone(), None, modo).unwrap();
    let t_sim = t0.elapsed().as_secs_f64();
    let pico_sim = PICO.load(Ordering::Relaxed) - base;

    let t0 = Instant::now();
    f.factorizar(&val).unwrap();
    let t_num = t0.elapsed().as_secs_f64();
    let pico_num = PICO.load(Ordering::Relaxed) - base;

    // Lados derechos pseudoaleatorios deterministas.
    let mut s: u64 = 0x9E3779B97F4A7C15;
    let b: Vec<f64> = (0..n * nrhs)
        .map(|_| {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            (s >> 11) as f64 / (1u64 << 53) as f64 - 0.5
        })
        .collect();
    let mut x = b.clone();
    let t0 = Instant::now();
    f.resolver(&mut x, nrhs).unwrap();
    let t_sol = t0.elapsed().as_secs_f64();
    let pico = PICO.load(Ordering::Relaxed) - base;

    let mut res_max: f64 = 0.0;
    let mut ax = vec![0.0; n];
    for k in 0..nrhs {
        producto(n, &cp, &ri, &val, &x[k * n..(k + 1) * n], &mut ax);
        let (mut num, mut den) = (0.0f64, 0.0f64);
        for i in 0..n {
            num += (ax[i] - b[k * n + i]).powi(2);
            den += b[k * n + i].powi(2);
        }
        res_max = res_max.max((num / den).sqrt());
    }
    let d = f.diagonal().unwrap();
    let negativos = d.iter().filter(|&&x| x < 0.0).count();
    println!(
        "{{\"k\":\"{}\",\"plataforma\":\"nativo\",\"n\":{},\"nnz_a\":{},\"nnz_l\":{},\"supernodal\":{},\"supernodos\":{},\"nrhs\":{},\"t_simbolico_s\":{:.3},\"t_factor_s\":{:.3},\"t_resolver_s\":{:.3},\"residuo_rel_max\":{:.2e},\"pivotes_negativos\":{},\"pico_simbolico_MB\":{},\"pico_factor_MB\":{},\"pico_MB\":{}}}",
        std::path::Path::new(ruta).file_name().unwrap().to_string_lossy(),
        n,
        f.nnz_a(),
        f.nnz_l(),
        f.es_supernodal(),
        f.n_supernodos(),
        nrhs,
        t_sim,
        t_num,
        t_sol,
        res_max,
        negativos,
        mb(pico_sim),
        mb(pico_num),
        mb(pico)
    );
}
