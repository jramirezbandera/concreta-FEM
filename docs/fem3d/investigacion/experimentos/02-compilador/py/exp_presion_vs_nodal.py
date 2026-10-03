# P11: en Quad3D, ¿presión de elemento == fuerzas nodales equivalentes (p·A/4)?
# (la recuperación de momentos de Quad3D sólo usa d, no el FER)
import warnings, json
import numpy as np
from Pynite import FEModel3D
warnings.filterwarnings("ignore")
E=30e9; NU=0.2; G=E/(2*(1+NU))
def run(modo):
    m=FEModel3D(); m.add_material("C",E,G,NU,2500)
    m.add_rectangle_mesh("L",0.5,6.0,3.0,0.25,"C",origin=(0,0,0),plane="XZ")
    m.meshes["L"].generate()
    for n in m.nodes.values():
        if abs(n.X)<1e-9 or abs(n.X-6)<1e-9: m.def_support(n.name,True,True,True,False,False,False)
    els=m.meshes["L"].elements
    for name,el in els.items():
        if modo=="presion": m.add_quad_surface_pressure(name,10e3,"D")
        else:
            A=0.5*0.5
            for nd in (el.i_node,el.j_node,el.m_node,el.n_node):
                m.add_node_load(nd.name,"FY",-10e3*A/4,"D")
    m.add_load_combo("C1",{"D":1.0}); m.analyze_linear(check_statics=False)
    el=[e for e in els.values() if abs(np.mean([e.i_node.X,e.j_node.X])-3.25)<1e-9 and abs(np.mean([e.i_node.Z,e.n_node.Z])-1.25)<1e-9][0]
    return {"Mx":float(np.ravel(el.moment(0,0,True,"C1"))[0])/1e3,"Qx":float(np.ravel(el.shear(0,0,True,"C1"))[0])/1e3,
            "dmax_mm":max(abs(n.DY["C1"]) for n in m.nodes.values())*1e3,
            "Rtot_kN":sum(n.RxnFY["C1"] for n in m.nodes.values())/1e3}
r={k:run(k) for k in ("presion","nodal_pA4")}
print(json.dumps(r,indent=1))
json.dump(r,open("py/salida-presion-vs-nodal.json","w"),indent=1)
