import sys, json
for fn in sys.argv[1:]:
    print('====', fn)
    for l in open(fn, encoding='utf-8', errors='replace'):
        l = l.strip()
        try:
            if l.startswith('{'):
                d = json.loads(l)
                ph = d.get('phases', {})
                keys = [k for k in ('total_s', 'solve_total_s', 'ensamblado_s', 't_factor_s', 't_solve_s', 'nnz_LU', 'nnz_factor', 'flops_chol_est', 'peak_mem_MB', 'delta_mem_MB', 'heap', 'res_rel_max', 'error', 'abort') if k in d]
                print(' ', d.get('case', d.get('K')), d.get('method', ''), d.get('coretype', ''), {k: d[k] for k in keys}, {k: v for k, v in list(ph.items())[:6]})
            elif l.startswith('PYODIDE_INFO'):
                d = json.loads(l.split(' ', 1)[1])
                print('    heap_final', d.get('heap_final_MB'), 'rss', d.get('node_rss_MB'), d.get('error', '')[-160:])
            elif l.startswith('##'):
                print(l)
        except Exception as e:
            print('  ?', l[:160])
