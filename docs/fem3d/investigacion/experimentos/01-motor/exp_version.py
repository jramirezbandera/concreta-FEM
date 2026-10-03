import sys, Pynite, numpy, scipy
print('Pynite.__version__ =', repr(Pynite.__version__), '| numpy', numpy.__version__, '| scipy', scipy.__version__, '| python', sys.version.split()[0], '| platform', sys.platform)
print('scipy.sparse importado al importar Pynite:', 'scipy.sparse' in sys.modules)
