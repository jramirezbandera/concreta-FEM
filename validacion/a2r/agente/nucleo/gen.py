import json
xs=[0,6,12,18]; ys=[0,5,10,15]
L="ABCD"
pil=[]
for j,y in enumerate(ys):
    for i,x in enumerate(xs):
        pil.append({"id":f"P{L[j]}{i+1}","x":x,"y":y,"desde":"CIM","hasta":"P1","seccion":"P50x50"})
f=0.25; e=-f+0.15  # eje viga fachada enrasada
ejeX=[0.10,6,12,17.90]; ejeY=[0.10,5,10,14.90]
vig=[]
for k,y in enumerate(ejeY):
    vig.append({"id":f"VX{k+1}","planta":"P1","puntos":[[-f,round(y,4)],[18+f,round(y,4)]],"seccion":"V30x50"})
for k,x in enumerate(ejeX):
    vig.append({"id":f"VY{k+1}","planta":"P1","puntos":[[round(x,4),-f],[round(x,4),15+f]],"seccion":"V30x50"})
cx,cy=9,7.5
hueco=[[cx-2.4,cy-2.1],[cx+2.4,cy-2.1],[cx+2.4,cy+2.1],[cx-2.4,cy+2.1]]
m={"plantas":[{"id":"P1","altura":None},{"id":"CIM","altura":1.5}],
 "materiales":[{"id":"HA-25","tipo":"hormigon","fck":25}],
 "secciones":[{"id":"P50x50","material":"HA-25","forma":"rectangular","b":0.5,"h":0.5},
              {"id":"V30x50","material":"HA-25","forma":"rectangular","b":0.3,"h":0.5}],
 "pilares":pil,"vigas":vig,
 "losas":[{"id":"L1","planta":"P1","contorno":[[-f,-f],[18+f,-f],[18+f,15+f],[-f,15+f]],"huecos":[[[round(a,4),round(b,4)] for a,b in hueco]],"espesor":0.22,"material":"HA-25"}],
 "muros":[{"id":"NUCLEO","puntos":[[6,5],[12,5],[12,10],[6,10],[6,5]],"desde":"CIM","hasta":"P1","espesor":0.25,"material":"HA-25","base":"empotrado",
   "huecos":[{"desde":2.4,"hasta":3.4,"z0":0,"z1":1.2}]}],
 "casos":[{"id":"G","nombre":"Peso propio","pesoPropio":True},{"id":"Q","nombre":"Sobrecarga de uso (oficinas, con tabiquería)"},{"id":"V","nombre":"Viento +X"}],
 "cargas":[{"tipo":"superficie","id":"SU-L1","caso":"Q","planta":"P1","losa":"L1","q":[0,0,-3]}]+
   [{"tipo":"pilar","id":f"V-{p}","caso":"V","pilar":p,"ejes":"global","q":[2,0,0]} for p in ["PA1","PB1","PC1","PD1"]]}
d={"esquema":"concreta-fem/proyecto@1","nombre":"Edificio de instalaciones, parcela 4","descripcion":"Una planta sobre cimentación (1,50 m), retícula 3x3 (6 m en X, 5 m en Y), núcleo de muros e=0,25 en x=6-12, y=5-10.","modelo":m,"opciones":{"tamanoMalla":1}}
with open("proyecto.json","w",newline="",encoding="utf-8") as fh: json.dump(d,fh,ensure_ascii=False,indent=2)
