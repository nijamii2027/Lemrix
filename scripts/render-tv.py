"""Render the CRT miniature and export the screen corners for footage compositing.

Run with Blender in background mode and pass an output directory after --.
"""
import json
import math
from pathlib import Path
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

output = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.cycles.use_denoising = False
scene.render.threads_mode = "FIXED"
scene.render.threads = 8
scene.render.resolution_x = 1200
scene.render.resolution_y = 850
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = .25
scene.world.use_nodes = True
sky = scene.world.node_tree.nodes.get("Background")
sky.inputs["Color"].default_value = (.45, .54, .75, 1)
sky.inputs["Strength"].default_value = .26

def material(name, colour, roughness=.43, metal=0):
    surface = bpy.data.materials.new(name)
    surface.use_nodes = True
    shader = surface.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*colour, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metal
    return surface

ivory = material("Warm ivory ceramic", (.73, .60, .40))
navy = material("Ink blue enamel", (.045, .083, .19))
dark = material("Deep navy trim", (.013, .027, .075), .5)
brass = material("Brushed brass", (.57, .31, .099), .34, .48)
pavement = material("Blue grey ceramic tiles", (.36, .43, .54), .59)
grout = material("Grout", (.25, .31, .43), .8)
lamp = material("Amber indicator", (.9, .28, .065))
lamp_bsdf = lamp.node_tree.nodes.get("Principled BSDF")
lamp_bsdf.inputs["Emission Color"].default_value = (.96, .27, .045, 1)
lamp_bsdf.inputs["Emission Strength"].default_value = .9

def soften(obj, radius, segments=4):
    bevel = obj.modifiers.new("Soft edges", "BEVEL")
    bevel.width = radius
    bevel.segments = segments
    normals = obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    normals.keep_sharp = True

def box(name, location, dims, surface, radius):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(surface)
    soften(obj, radius)
    return obj

def rounded_points(w, h, radius):
    centres = [(w/2-radius, h/2-radius), (-w/2+radius, h/2-radius),
               (-w/2+radius, -h/2+radius), (w/2-radius, -h/2+radius)]
    return [(cx + radius*math.cos((corner + step/9)*math.pi/2),
             cz + radius*math.sin((corner + step/9)*math.pi/2))
            for corner, (cx, cz) in enumerate(centres) for step in range(10)]

def ring(name, outer, inner, centre, hole_offset, depth, surface, rounding):
    outer_loop = rounded_points(*outer)
    inner_loop = [(x+hole_offset, z) for x, z in rounded_points(*inner)]
    size = len(outer_loop)
    vertices = [(x, y, z) for y in (-depth/2, depth/2)
                for loop in (outer_loop, inner_loop) for x, z in loop]
    faces = []
    for a in range(size):
        b = (a+1) % size
        faces.extend([(a,b,b+size,a+size),
                      (a+2*size,a+3*size,b+3*size,b+2*size),
                      (a,a+2*size,b+2*size,b),
                      (a+size,b+size,b+3*size,a+3*size)])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.location = centre
    obj.data.materials.append(surface)
    soften(obj, rounding)
    return obj

def dial(name, x, y, z, radius, depth, surface):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=depth,
                                       location=(x,y,z), rotation=(math.pi/2,0,0))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(surface)
    for face in obj.data.polygons:
        face.use_smooth = True
    soften(obj, .017, 3)
    return obj

box("Navy diorama base", (0,-.55,-.11), (7.25,4.35,.28), navy, .13)
box("Ivory platform edge", (0,-.55,.049), (7.12,4.21,.10), ivory, .044)
box("Tile grout", (0,-.55,.10), (7.0,4.11,.05), grout, .021)
for row in range(4):
    for col in range(7):
        box("Floor tile", (col-3,(row-1.5)*1.01-.55,.133),
            (.986,.996,.035), pavement, .014)

centre_x, centre_z = -.65, 1.88
screen_x = centre_x - .54
box("Left foot", (-2.07,.31,.285), (.62,1.11,.27), dark, .08)
box("Right foot", (.77,.31,.285), (.62,1.11,.27), dark, .08)
ring("Deep rounded CRT case", (4.66,2.92,.31), (3.29,2.32,.24),
     (centre_x,.61,centre_z), -.54, 1.56, navy, .10)
ring("Cream enamel face", (4.73,2.96,.34), (3.36,2.38,.26),
     (centre_x,-.223,centre_z), -.54, .26, ivory, .05)
ring("Inset tube surround", (3.43,2.46,.32), (3.09,2.16,.24),
     (screen_x,-.376,centre_z), 0, .14, dark, .022)
box("Tuner panel", (1.145,-.393,1.89), (.73,.13,2.27), navy, .055)
for z, angle in ((2.55,-.45),(1.98,.7)):
    dial("Knob bezel", 1.145,-.488,z,.232,.10,dark)
    dial("Knob", 1.145,-.564,z,.181,.10,brass)
    mark = box("Tuner index", (1.145,-.624,z+.05), (.022,.026,.13), dark, .009)
    mark.rotation_euler.y = angle
for i in range(5):
    box("Speaker grille", (1.145,-.47,1.53-.105*i), (.43,.03,.034), dark, .016)
dial("Power light",1.145,-.48,.91,.044,.038,lamp)

def area(name, position, energy, size, colour):
    light = bpy.data.lights.new(name, "AREA")
    light.energy = energy
    light.shape = "DISK"
    light.size = size
    light.color = colour
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector((0,0,1.2))-obj.location).to_track_quat("-Z","Y").to_euler()

area("Shop warm key",(-4,-6,8),1100,5,(1,.88,.70))
area("Blue bounce",(6,-3,4),570,5,(.64,.80,1))
area("Soft rim",(3,4,6),820,4,(.72,.86,1))

lens = bpy.data.cameras.new("Orthographic")
lens.type = "ORTHO"
lens.ortho_scale = 8.65
camera = bpy.data.objects.new("Orthographic", lens)
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = (4.1,-13.5,7.1)
camera.rotation_euler = (Vector((0,-.51,1.32))-camera.location).to_track_quat("-Z","Y").to_euler()
bpy.context.view_layer.update()

def project(x, y, z):
    p = world_to_camera_view(scene,camera,Vector((x,y,z)))
    return [round(p.x*scene.render.resolution_x,3), round((1-p.y)*scene.render.resolution_y,3)]

# The footage extends under the rounded bezel, so the visible edge is the model.
screen = [project(screen_x-1.58,-.412,centre_z+1.105),
          project(screen_x+1.58,-.412,centre_z+1.105),
          project(screen_x-1.58,-.412,centre_z-1.105)]
actors = [project(.17,-2.02,.15),project(2.58,-1.08,.15)]
(output/"tv-projection.json").write_text(json.dumps({"screen": screen,"actors": actors}))
scene.render.filepath = str(output/"tv-render.png")
bpy.ops.render.render(write_still=True)
