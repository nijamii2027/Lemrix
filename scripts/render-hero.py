"""Render the shared landing models for browsers without WebGL."""
import json
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

work=Path(sys.argv[sys.argv.index("--")+1])
hands="hands" in sys.argv
static="static" in sys.argv
backdrop_only="backdrop" in sys.argv
storefront_only="storefront" in sys.argv
data=json.loads((work/("hands.json" if hands else "hero.json")).read_text())
transform=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine="CYCLES"
scene.cycles.device="CPU"
scene.cycles.samples=16 if hands else 64 if backdrop_only or storefront_only else 128 if static else 32
scene.cycles.use_denoising=False
scene.render.threads_mode="FIXED"
scene.render.threads=8
scene.render.film_transparent=True
scene.render.image_settings.file_format="PNG"
scene.render.image_settings.color_mode="RGBA"
scene.render.resolution_x=data["width"]
scene.render.resolution_y=data["height"]
scene.render.resolution_percentage=100
scene.view_settings.view_transform="AgX"
scene.view_settings.look="AgX - Medium High Contrast"
scene.view_settings.exposure=.35
scene.world.use_nodes=True
world=scene.world.node_tree.nodes.get("Background")
world.inputs["Color"].default_value=(.43,.49,.65,1)
world.inputs["Strength"].default_value=.3

materials=[]
for index,item in enumerate(data["mats"]):
    material=bpy.data.materials.new(f"Surface {index}")
    material.use_nodes=True
    nodes=material.node_tree.nodes
    shader=nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value=(*item["color"],1)
    shader.inputs["Roughness"].default_value=item["roughness"]
    shader.inputs["Metallic"].default_value=item["metalness"]
    shader.inputs["Alpha"].default_value=item.get("opacity",1)
    if item.get("emissiveIntensity"):
        shader.inputs["Emission Color"].default_value=(*item["emissive"],1)
        shader.inputs["Emission Strength"].default_value=item["emissiveIntensity"]
    if item.get("texture"):
        image=nodes.new("ShaderNodeTexImage")
        image.image=bpy.data.images.load(str(work/item["texture"]))
        material.node_tree.links.new(image.outputs["Color"],shader.inputs["Base Color"])
        material.node_tree.links.new(image.outputs["Alpha"],shader.inputs["Alpha"])
        if item.get("emissiveIntensity"):
            material.node_tree.links.new(image.outputs["Color"],shader.inputs["Emission Color"])
    materials.append(material)

geometries=[]
for index,item in enumerate(data["geos"]):
    points=item["positions"]
    vertices=[points[i:i+3] for i in range(0,len(points),3)]
    indices=item["indices"] or list(range(len(vertices)))
    faces=[indices[i:i+3] for i in range(0,len(indices),3)]
    geometry=bpy.data.meshes.new(f"Geometry {index}")
    geometry.from_pydata(vertices,[],faces)
    geometry.update()
    if item["uv"]:
        uv=geometry.uv_layers.new()
        for loop in geometry.loops:
            uv.data[loop.index].uv=item["uv"][loop.vertex_index*2:loop.vertex_index*2+2]
    for polygon in geometry.polygons:
        polygon.use_smooth=True
    geometries.append(geometry)
objects=[]
for index,item in enumerate(data["objects"]):
    geometry=geometries[item["geo"]].copy()
    geometry.materials.append(materials[item["mat"]])
    obj=bpy.data.objects.new(f"Model {index}",geometry)
    scene.collection.objects.link(obj)
    objects.append(obj)

def vec(point):
    return Vector((point[0],-point[2],point[1]))

def lamp(name,position,power,size,color):
    light=bpy.data.lights.new(name,"AREA")
    light.energy=power
    light.shape="DISK"
    light.size=size
    light.color=color
    obj=bpy.data.objects.new(name,light)
    scene.collection.objects.link(obj)
    obj.location=vec(position)
    obj.rotation_euler=(vec((0,1,0))-obj.location).to_track_quat("-Z","Y").to_euler()

lamp("Warm key",(-4,7,7),1000,5,(1,.91,.77))
lamp("Soft fill",(5,4,5),550,5,(.70,.85,1))
lamp("Cool rim",(3,5,-4),850,4,(.66,.85,1))
camera_data=bpy.data.cameras.new("Camera")
camera=bpy.data.objects.new("Camera",camera_data)
scene.collection.objects.link(camera)
scene.camera=camera
camera_data.type="ORTHO"
camera_config=data.get("camera",{})
camera_data.ortho_scale=camera_config.get("scale",6.9*data["width"]/data["height"])
camera.location=vec(camera_config.get("position",(7.4,6.5,13)))
camera.rotation_euler=(vec(camera_config.get("target",(0,2,-.15)))-camera.location).to_track_quat("-Z","Y").to_euler()

def pose(frame,index=0):
    for number,(obj,matrix) in enumerate(zip(objects,frame)):
        deformations=data.get("deformations")
        if deformations and deformations[index][number]:
            obj.data.vertices.foreach_set("co",deformations[index][number])
            obj.data.update()
        obj.matrix_world=transform@Matrix(tuple(tuple(matrix[c*4+r] for c in range(4)) for r in range(4)))

def render(name):
    scene.render.filepath=str(work/name)
    bpy.ops.render.render(write_still=True)

if hands:
    for index,frame in enumerate(data["frames"]):
        kind="lemrix" if index<16 else "cookd"
        for obj,item in zip(objects,data["objects"]):
            obj.hide_render=item["kind"] != kind
        pose(frame,index)
        render(f"hand-{index:02}.png")
    sys.exit(0)

pose(data["frames"][0])
if storefront_only:
    for obj,item in zip(objects,data["objects"]):
        obj.hide_render=item["character"]
    camera_data.ortho_scale *= 1.075
    render("storefront-clean.png")
    sys.exit(0)
if not backdrop_only:
    render("poster.png")
for obj,item in zip(objects,data["objects"]):
    obj.hide_render=False
    obj.visible_camera=not item["character"]
render("backdrop.png")
if static or backdrop_only:
    sys.exit(0)
for obj,item in zip(objects,data["objects"]):
    obj.hide_render=not item["character"]
    obj.visible_camera=True
crop=data["crop"]
scene.render.use_border=True
scene.render.use_crop_to_border=True
scene.render.border_min_x=crop["left"]/data["width"]
scene.render.border_max_x=crop["right"]/data["width"]
scene.render.border_min_y=1-crop["bottom"]/data["height"]
scene.render.border_max_y=1-crop["top"]/data["height"]
for index,frame in enumerate(data["frames"]):
    pose(frame)
    render(f"frame-{index:03}.png")
    print(f"Hero frame {index+1}/{len(data['frames'])}",flush=True)
