"""Oráculo del lector de DXF (V2c-4, docs/fem3d/dibujo.md §10.4, criterio 1) con ezdxf 1.4.5 (MIT).

    python oraculo_dxf.py generar <carpeta>      escribe los DXF sintéticos y su oráculo
    python oraculo_dxf.py oraculo <dxf> <json>   el oráculo de un DXF cualquiera

El oráculo de un DXF es lo que ezdxf dice de su geometría en XY, con los bloques expandidos
(componiendo las `matrix44()` de los INSERT, con `multi_insert`; las cotas, con `virtual_entities`) y el
OCS pasado al WCS:
- segmentos: los rectos (LINE, tramos sin bulge, SOLID, 3DFACE, LEADER), [x0, y0, x1, y1];
- puntos: [x, y, tipo] con los tipos de src/dxf/aplanar.ts (extremo, vertice, centro, medio);
- conicas: arcos, círculos y elipses como c + cos t·u + sin t·v en XY, para ver si un punto está en ellas;
- splines: [grado, nudos, control, pesos, [[u, x, y], ...]] con puntos de ezdxf en esos u;
- textos: [x, y, giro (rad), texto];
- ignoradas: tipos que el lector no lee.
"""

import json
import math
import sys
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment, MTextEntityAlignment
from ezdxf.math import Vec3, bulge_to_arc, OCS

IGNORADAS = {"HATCH", "MLINE", "XLINE", "RAY", "IMAGE", "WIPEOUT", "MLEADER", "MULTILEADER", "3DSOLID", "REGION", "BODY", "MESH"}


def xy(p):
    return [float(p[0]), float(p[1])]


class Oraculo:
    def __init__(self):
        self.segmentos = []
        self.puntos = []
        self.conicas = []
        self.splines = []
        self.textos = []
        self.ignoradas = {}

    def punto(self, p, tipo):
        self.puntos.append([*xy(p), tipo])

    def segmento(self, a, b):
        self.segmentos.append([*xy(a), *xy(b)])

    def conica(self, c, u, v):
        self.conicas.append([*xy(c), *xy(u), *xy(v)])

    def texto(self, p, direccion, s):
        if s.strip():
            self.textos.append([*xy(p), math.atan2(direccion[1], direccion[0]), s])

    def json(self):
        return {k: getattr(self, k) for k in ("segmentos", "puntos", "conicas", "splines", "textos", "ignoradas")}


class Marco:
    """Del sistema de una entidad (su OCS dentro de los bloques que la insertan) al WCS: el OCS de
    ezdxf y la composición de las `matrix44()` de los INSERT (no `virtual_entities`, que gira mal un
    INSERT dentro de otro con escala no uniforme)."""

    def __init__(self, m=None, ocs=None):
        self.m = m
        self.ocs = ocs or OCS()

    def p(self, v):
        w = self.ocs.to_wcs(Vec3(v))
        return self.m.transform(w) if self.m is not None else w

    def d(self, v):
        w = self.ocs.to_wcs(Vec3(v)) - self.ocs.to_wcs(Vec3())
        return self.m.transform_direction(w) if self.m is not None else w

    def con(self, e):
        return Marco(self.m, e.ocs())


def circulo(o, f, c, r, cuadrantes):
    o.conica(f.p(c), f.d(Vec3(r, 0, 0)), f.d(Vec3(0, r, 0)))
    o.punto(f.p(c), "centro")
    if cuadrantes:
        for a in (0, 90, 180, 270):
            o.punto(f.p(c + Vec3.from_deg_angle(a, r)), "vertice")


def arco(o, f, c, r, a0, a1):
    circulo(o, f, c, r, False)
    while a1 <= a0:
        a1 += 360
    o.punto(f.p(c + Vec3.from_deg_angle(a0, r)), "extremo")
    o.punto(f.p(c + Vec3.from_deg_angle(a1, r)), "extremo")
    o.punto(f.p(c + Vec3.from_deg_angle((a0 + a1) / 2, r)), "medio")


def polilinea(o, f, vs, cerrada, z):
    """vs: [(x, y, bulge)] en el sistema de f."""
    n = len(vs)
    cerr = cerrada and n > 2
    for i, (x, y, _) in enumerate(vs):
        o.punto(f.p(Vec3(x, y, z)), "vertice" if cerr or 0 < i < n - 1 else "extremo")
    tramos = n if cerr else n - 1
    for i in range(tramos):
        j = (i + 1) % n
        p, q, b = vs[i], vs[j], vs[i][2]
        if b == 0:
            o.segmento(f.p(Vec3(p[0], p[1], z)), f.p(Vec3(q[0], q[1], z)))
        else:
            c, a0, a1, r = bulge_to_arc((p[0], p[1]), (q[0], q[1]), b)
            c = Vec3(c.x, c.y, z)
            circulo(o, f, c, r, False)
            # bulge_to_arc da el arco en sentido antihorario: el punto medio es el mismo
            a0, a1 = math.degrees(a0), math.degrees(a1)
            while a1 <= a0:
                a1 += 360
            o.punto(f.p(c + Vec3.from_deg_angle((a0 + a1) / 2, r)), "medio")


def primitiva(o, e, m=None):
    t = e.dxftype()
    w = Marco(m)  # entidades en WCS (dentro de un bloque, en el sistema del bloque)
    f = w.con(e) if e.dxf.hasattr("extrusion") or t in ("CIRCLE", "ARC", "LWPOLYLINE", "TEXT", "ATTRIB", "SOLID", "TRACE") else w
    if t == "LINE":
        a, b = w.p(e.dxf.start), w.p(e.dxf.end)
        o.segmento(a, b)
        o.punto(a, "extremo")
        o.punto(b, "extremo")
    elif t == "POINT":
        o.punto(w.p(e.dxf.location), "vertice")
    elif t == "CIRCLE":
        circulo(o, f, Vec3(e.dxf.center), e.dxf.radius, True)
    elif t == "ARC":
        arco(o, f, Vec3(e.dxf.center), e.dxf.radius, e.dxf.start_angle, e.dxf.end_angle)
    elif t == "ELLIPSE":
        c, u, v = w.p(e.dxf.center), w.d(e.dxf.major_axis), w.d(e.minor_axis)
        o.conica(c, u, v)
        o.punto(c, "centro")
        t0, t1 = e.dxf.start_param, e.dxf.end_param
        while t1 <= t0:
            t1 += 2 * math.pi
        pt = lambda s: c + u * math.cos(s) + v * math.sin(s)
        if abs(t1 - t0 - 2 * math.pi) < 1e-12:
            for s in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
                o.punto(pt(s), "vertice")
        else:
            o.punto(pt(t0), "extremo")
            o.punto(pt(t1), "extremo")
            o.punto(pt((t0 + t1) / 2), "medio")
    elif t == "LWPOLYLINE":
        vs = [(x, y, b) for x, y, b in e.get_points("xyb")]
        polilinea(o, f, vs, e.closed, e.dxf.elevation)
    elif t == "POLYLINE":
        if e.is_polygon_mesh or e.is_poly_face_mesh:
            o.ignoradas["POLYLINE (malla)"] = o.ignoradas.get("POLYLINE (malla)", 0) + 1
            return
        vs = [v for v in e.vertices if not (v.dxf.flags & 16)]
        if e.is_3d_polyline:
            ps = [w.p(v.dxf.location) for v in vs]
            cerr = e.is_closed and len(ps) > 2
            for i, p in enumerate(ps):
                o.punto(p, "vertice" if cerr or 0 < i < len(ps) - 1 else "extremo")
            for i in range(1, len(ps)):
                o.segmento(ps[i - 1], ps[i])
            if cerr:
                o.segmento(ps[-1], ps[0])
        else:
            pts = [(v.dxf.location.x, v.dxf.location.y, v.dxf.bulge) for v in vs]
            polilinea(o, w.con(e), pts, e.is_closed, e.dxf.elevation.z)
    elif t == "SPLINE":
        s = e.construction_tool()
        if m is not None:
            s = s.transform(m)
        nudos = list(s.knots())
        grado = s.degree
        u0, u1 = nudos[grado], nudos[len(s.control_points)]
        us = [u0 + (u1 - u0) * k / 13 for k in range(14)]
        o.splines.append([grado, nudos, [list(map(float, p)) for p in s.control_points], list(s.weights()) if s.is_rational else None, [[u, *xy(s.point(u))] for u in us]])
        o.punto(s.point(u0), "extremo")
        o.punto(s.point(u1), "extremo")
    elif t in ("SOLID", "TRACE"):
        z = e.dxf.vtx0.z
        p = [f.p(Vec3(e.dxf.get(f"vtx{i}").x, e.dxf.get(f"vtx{i}").y, z)) for i in range(4)]
        orden = [p[0], p[1], p[2]] if e.dxf.vtx2 == e.dxf.vtx3 else [p[0], p[1], p[3], p[2]]
        for i in range(len(orden)):
            o.segmento(orden[i], orden[(i + 1) % len(orden)])
    elif t == "3DFACE":
        p = [w.p(e.dxf.get(f"vtx{i}")) for i in range(4)]
        fl = e.dxf.invisible_edges
        for i in range(4):
            if not fl & (1 << i):
                o.segmento(p[i], p[(i + 1) % 4])
    elif t == "LEADER":
        vs = [w.p(v) for v in e.vertices]
        for i in range(1, len(vs)):
            o.segmento(vs[i - 1], vs[i])
    elif t in ("TEXT", "ATTRIB"):
        if t == "ATTRIB" and e.is_invisible:
            return
        alin, p, _ = e.get_placement()
        if alin in (TextEntityAlignment.ALIGNED, TextEntityAlignment.FIT):
            p = e.dxf.insert
        o.texto(f.p(p), f.d(Vec3.from_deg_angle(e.dxf.rotation)), e.plain_text())
    elif t == "MTEXT":
        o.texto(w.p(e.dxf.insert), w.d(e.get_text_direction()), e.plain_text(fast=False))
    elif t in IGNORADAS:
        o.ignoradas[t] = o.ignoradas.get(t, 0) + 1


def expandir(o, doc, e, m=None, prof=0):
    t = e.dxftype()
    if t == "INSERT":
        if e.mcount > 1:
            for vi in e.multi_insert():
                expandir(o, doc, vi, m, prof)
            return
        mi = e.matrix44() if m is None else e.matrix44() @ m
        for x in doc.blocks[e.dxf.name]:
            expandir(o, doc, x, mi, prof + 1)
        for a in e.attribs:
            primitiva(o, a, m)
    elif t == "DIMENSION":
        for ve in e.virtual_entities():
            expandir(o, doc, ve, m, prof + 1)
    elif t in ("ATTDEF", "VIEWPORT"):
        return
    else:
        primitiva(o, e, m)


def oraculo(ruta):
    doc = ezdxf.readfile(ruta)
    o = Oraculo()
    for e in doc.modelspace():
        expandir(o, doc, e)
    r = o.json()
    r["capas"] = sorted([l.dxf.name, bool(l.is_off() or l.is_frozen())] for l in doc.layers)
    return r


# ─── Los DXF sintéticos ──────────────────────────────────────────────────────────────────────────


def basico(ruta):
    doc = ezdxf.new("R2018", setup=True)
    doc.layers.add("APAGADA", color=1).off()
    doc.layers.add("CONGELADA", color=2).freeze()
    msp = doc.modelspace()
    msp.add_line((0, 0), (5.3, 0))
    msp.add_line((-5.750000000007275, 1.25), (12.1, 7.000000000003), dxfattribs={"layer": "APAGADA"})
    msp.add_point((3, 3), dxfattribs={"layer": "CONGELADA"})
    msp.add_circle((10, 10), 0.25)
    msp.add_arc((2, 8), 1.5, 30, 120)
    msp.add_arc((6, 8), 1.0, 300, 45)  # pasa por 0°
    msp.add_ellipse((14, 2), major_axis=(2, 1), ratio=0.4)
    msp.add_ellipse((14, 6), major_axis=(0, 1.5), ratio=0.5, start_param=0.3, end_param=2.5)
    msp.add_lwpolyline([(0, 12, 0), (4, 12, 0.5), (6, 14, -0.3), (8, 14, 1.7), (9, 16, 0)], format="xyb")
    msp.add_lwpolyline([(20, 0), (25.3, 0), (25.3, 4.25), (20, 4.25)], close=True)
    msp.add_lwpolyline([(20, 6, 0), (24, 6, 1.0), (24, 8, 0), (20, 8, -1.0)], format="xyb", close=True)
    msp.add_open_spline([(0, 20), (2, 23), (5, 19), (8, 24), (11, 20)], degree=3)
    msp.add_rational_spline([(14, 20), (16, 24), (19, 19), (22, 22)], weights=[1, 2.5, 0.7, 1], degree=2)
    msp.add_text("Texto ñ 30%%d", dxfattribs={"height": 0.25, "rotation": 15}).set_placement((1, 30))
    msp.add_text("Centrado", dxfattribs={"height": 0.3}).set_placement((5, 30), align=TextEntityAlignment.MIDDLE_CENTER)
    msp.add_text("%%c12 a la derecha", dxfattribs={"height": 0.2, "rotation": 90}).set_placement((9, 30), align=TextEntityAlignment.TOP_RIGHT)
    msp.add_mtext("{\\fArial|b1;Salón}\\P\\H0.5x;cocina \\S1/2; y \\~fin", dxfattribs={"char_height": 0.3}).set_location((12, 30), rotation=30, attachment_point=MTextEntityAlignment.MIDDLE_CENTER)
    msp.add_solid([(0, 34), (1, 34), (0, 35), (1, 35.5)])
    msp.add_solid([(3, 34), (4, 34), (3.5, 35)])
    msp.add_3dface([(6, 34, 0), (8, 34, 0), (8, 36, 1), (6, 36, 1)], dxfattribs={"invisible_edges": 2})
    msp.add_leader([(10, 34), (12, 35), (14, 35)])
    h = msp.add_hatch()
    h.paths.add_polyline_path([(0, 40), (2, 40), (2, 42)], is_closed=True)
    msp.add_xline((0, 0), (1, 1))
    doc.paperspace().add_line((0, 0), (100, 100))
    doc.saveas(ruta)


def bloques(ruta):
    doc = ezdxf.new("R2010", setup=True)
    doc.layers.add("MUROS")
    doc.layers.add("PILARES")
    b = doc.blocks.new("PILAR", base_point=(0.15, 0.15))
    b.add_lwpolyline([(0, 0), (0.3, 0), (0.3, 0.3), (0, 0.3)], close=True)
    b.add_line((0, 0), (0.3, 0.3), dxfattribs={"layer": "PILARES"})
    b.add_circle((0.15, 0.15), 0.05)
    b.add_attdef("NOMBRE", (0.35, 0.35), dxfattribs={"height": 0.1})
    c = doc.blocks.new("CONJUNTO", base_point=(1, 0))
    c.add_blockref("PILAR", (1, 0))
    c.add_blockref("PILAR", (4, 0), dxfattribs={"rotation": 90})
    c.add_arc((2.5, 1), 0.8, 0, 180)
    c.add_text("dentro", dxfattribs={"height": 0.2, "rotation": 10}).set_placement((2, 2))
    msp = doc.modelspace()
    r = msp.add_blockref("PILAR", (5, 5), dxfattribs={"layer": "PILARES"})
    r.add_auto_attribs({"NOMBRE": "P1"})
    msp.add_blockref("PILAR", (8, 5), dxfattribs={"rotation": 30, "xscale": 2, "yscale": 2})
    msp.add_blockref("CONJUNTO", (10, 10), dxfattribs={"rotation": 37.5, "xscale": 1.5, "yscale": 1.5, "layer": "MUROS"})
    msp.add_blockref("CONJUNTO", (20, 10), dxfattribs={"xscale": -1, "yscale": 1})
    msp.add_blockref("CONJUNTO", (30, 10), dxfattribs={"xscale": 2, "yscale": 1})
    msp.add_blockref("PILAR", (0, 20), dxfattribs={"column_count": 3, "row_count": 2, "column_spacing": 5, "row_spacing": 4, "rotation": 15})
    msp.add_blockref("CONJUNTO", (40, 10), dxfattribs={"extrusion": (0, 0, -1)})
    doc.saveas(ruta)


def ocs(ruta):
    doc = ezdxf.new("R2013", setup=True)
    msp = doc.modelspace()
    abajo = {"extrusion": (0, 0, -1)}
    inclinada = {"extrusion": (0.6, 0, 0.8)}
    msp.add_arc((3, 2), 1.2, 10, 100, dxfattribs=abajo)
    msp.add_circle((-6, 2), 0.5, dxfattribs=abajo)
    msp.add_lwpolyline([(1, 1, 0), (3, 1, 0.4), (3, 3, 0)], format="xyb", dxfattribs={**abajo, "elevation": 0.5})
    msp.add_text("al revés", dxfattribs={**abajo, "height": 0.2, "rotation": 20}).set_placement((2, 5))
    msp.add_solid([(0, 8), (1, 8), (0, 9), (1, 9)], dxfattribs=abajo)
    msp.add_arc((3, 2), 1.2, 10, 100, dxfattribs=inclinada)
    msp.add_circle((5, 5), 1, dxfattribs=inclinada)
    msp.add_lwpolyline([(0, 0), (2, 0), (2, 2)], dxfattribs=inclinada)
    doc.saveas(ruta)


def r12(ruta):
    doc = ezdxf.new("R12")
    msp = doc.modelspace()
    msp.add_polyline2d([(0, 0), (4, 0), (4, 3), (0, 3)], close=True)
    p = msp.add_polyline2d([(10, 0), (14, 0), (14, 3)])
    p.vertices[0].dxf.bulge = 0.5
    p.vertices[1].dxf.bulge = -0.25
    msp.add_polyline3d([(20, 0, 0), (22, 1, 3), (25, 0, 1)])
    msp.add_text("Año de la reforma: niño", dxfattribs={"height": 0.3}).set_placement((0, 5))
    msp.add_line((0, 10), (3.000000000000004, 10))
    doc.saveas(ruta, encoding="cp1252")


def cotas(ruta):
    doc = ezdxf.new("R2000", setup=True)
    msp = doc.modelspace()
    msp.add_line((0, 0), (5, 0))
    msp.add_linear_dim(base=(0, 2), p1=(0, 0), p2=(5, 0)).render()
    msp.add_linear_dim(base=(7, 0), p1=(5, 0), p2=(5, 4), angle=90).render()
    msp.add_aligned_dim(p1=(10, 0), p2=(14, 3), distance=1).render()
    msp.add_radius_dim(center=(20, 0), radius=2, angle=45).render()
    doc.saveas(ruta)


SINTETICOS = {"basico": basico, "bloques": bloques, "ocs": ocs, "r12": r12, "cotas": cotas}


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "generar":
        carpeta = Path(sys.argv[2])
        carpeta.mkdir(parents=True, exist_ok=True)
        for nombre, f in SINTETICOS.items():
            dxf = carpeta / f"{nombre}.dxf"
            f(str(dxf))
            with open(carpeta / f"{nombre}.ezdxf.json", "w", encoding="utf-8", newline="") as fh:
                json.dump(oraculo(str(dxf)), fh, ensure_ascii=False)
            print(nombre, "listo")
    elif len(sys.argv) == 4 and sys.argv[1] == "oraculo":
        with open(sys.argv[3], "w", encoding="utf-8", newline="") as fh:
            json.dump(oraculo(sys.argv[2]), fh, ensure_ascii=False)
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
