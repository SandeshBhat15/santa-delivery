import bpy
import bmesh
import math
import random
from mathutils import Vector, Matrix, Euler

# ==============================================================================
# PROFESSIONAL MODULAR ENVIRONMENT GENERATOR FOR GAME
# High-Quality Stylized Winter Archipelago (EEVEE Next / Cycles)
# ==============================================================================

def clean_scene_keep_assets():
    """Preserves source house models and tree models; resets generated environment."""
    keep_names = set()
    for coll_name in ["house", "trees"]:
        coll = bpy.data.collections.get(coll_name)
        if coll:
            for obj in coll.objects:
                keep_names.add(obj.name)

    # In case houses or trees are in root collection
    for obj in bpy.data.objects:
        bname = obj.name.lower()
        if (bname.startswith("house") or bname.startswith("tree") or bname.startswith("bush")) and not "." in obj.name:
            keep_names.add(obj.name)

    to_remove = [o for o in bpy.data.objects if o.name not in keep_names]
    for o in to_remove:
        bpy.data.objects.remove(o, do_unlink=True)
    print(f"Cleaned scene. Preserved source assets: {list(keep_names)}")

def get_or_create_collection(name, parent=None):
    coll = bpy.data.collections.get(name)
    if not coll:
        coll = bpy.data.collections.new(name)
        if parent:
            parent.children.link(coll)
        else:
            bpy.context.scene.collection.children.link(coll)
    return coll

def setup_materials():
    """Sets up stylized materials with packed textures and atmospheric shaders."""
    def get_mat(name):
        mat = bpy.data.materials.get(name)
        if not mat:
            mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        return mat

    # 1. Snow Top Material
    m_snow = get_mat("M_Snow_Top")
    nodes = m_snow.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    tc = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (0.2, 0.2, 0.2)
    tex_snow = nodes.new('ShaderNodeTexImage')
    img_snow = bpy.data.images.get('Seamless Pastel Low-Poly Snowfield.png')
    if img_snow:
        tex_snow.image = img_snow
        tex_snow.extension = 'REPEAT'
    m_snow.node_tree.links.new(tc.outputs['Object'], mapping.inputs['Vector'])
    m_snow.node_tree.links.new(mapping.outputs['Vector'], tex_snow.inputs['Vector'])
    m_snow.node_tree.links.new(tex_snow.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.75
    # Soft blue-white subsurface for snow scattering
    bsdf.inputs['Subsurface Weight'].default_value = 0.12
    bsdf.inputs['Subsurface Radius'].default_value = (0.8, 0.9, 1.0)
    m_snow.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # 2. Cliff Rock (Faceted purple-blue twilight rock)
    m_cliff = get_mat("M_Cliff_Rock")
    nodes = m_cliff.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    tc = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (0.04, 0.04, 0.04)
    tex_cliff = nodes.new('ShaderNodeTexImage')
    img_cliff = bpy.data.images.get('Stylized Sunset Cliff Wall Texture.png') or bpy.data.images.get('cliff')
    if img_cliff:
        tex_cliff.image = img_cliff
        tex_cliff.extension = 'REPEAT'
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 0.6
    # Twilight purple-blue tint matching concept art
    mix.inputs[7].default_value = (0.35, 0.35, 0.62, 1.0)
    m_cliff.node_tree.links.new(tc.outputs['Object'], mapping.inputs['Vector'])
    m_cliff.node_tree.links.new(mapping.outputs['Vector'], tex_cliff.inputs['Vector'])
    m_cliff.node_tree.links.new(tex_cliff.outputs['Color'], mix.inputs[6])
    m_cliff.node_tree.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    m_cliff.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # 3. Ice Water (Frozen Crystalline Sea)
    m_ice = get_mat("M_Ice_Water")
    nodes = m_ice.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    tc = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (0.012, 0.012, 0.012)
    tex_ice = nodes.new('ShaderNodeTexImage')
    img_ice = bpy.data.images.get('Seamless Crystalline Blue Ice Texture.png')
    if img_ice:
        tex_ice.image = img_ice
        tex_ice.extension = 'REPEAT'
    mix_ice = nodes.new('ShaderNodeMix')
    mix_ice.data_type = 'RGBA'
    mix_ice.blend_type = 'SCREEN'
    mix_ice.inputs['Factor'].default_value = 0.45
    mix_ice.inputs[7].default_value = (0.05, 0.38, 0.68, 1.0)
    m_ice.node_tree.links.new(tc.outputs['Object'], mapping.inputs['Vector'])
    m_ice.node_tree.links.new(mapping.outputs['Vector'], tex_ice.inputs['Vector'])
    m_ice.node_tree.links.new(tex_ice.outputs['Color'], mix_ice.inputs[6])
    m_ice.node_tree.links.new(mix_ice.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.14
    bsdf.inputs['IOR'].default_value = 1.333
    m_ice.node_tree.links.new(tex_ice.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 0.08
    m_ice.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # 4. Wood Structure (Bridge planks, docks)
    m_wood = get_mat("M_Wood_Structure")
    nodes = m_wood.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.44, 0.28, 0.16, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.78
    m_wood.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # 5. Wood Dark (Posts, pilings, handrails)
    m_wood_dark = get_mat("M_Wood_Dark")
    nodes = m_wood_dark.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.24, 0.16, 0.10, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.88
    m_wood_dark.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # 6. Path Dirt (Beaten snow trail)
    m_path = get_mat("M_Path_Dirt")
    nodes = m_path.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.82, 0.72, 0.58, 1.0) # warm creamy sand
    bsdf.inputs['Roughness'].default_value = 0.95
    m_path.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # 7. Lantern Glow (Emissive Amber Core)
    m_glow = get_mat("M_Lantern_Glow")
    nodes = m_glow.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (1.0, 0.7, 0.22, 1.0)
    bsdf.inputs['Emission Color'].default_value = (1.0, 0.65, 0.15, 1.0)
    bsdf.inputs['Emission Strength'].default_value = 18.0
    m_glow.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # 8. Ice Floe / Icicles
    m_floe = get_mat("M_Ice_Floe")
    nodes = m_floe.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.68, 0.92, 0.98, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.2
    bsdf.inputs['Emission Color'].default_value = (0.1, 0.48, 0.75, 1.0)
    bsdf.inputs['Emission Strength'].default_value = 0.18
    m_floe.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # 9. Moon
    m_moon = get_mat("M_Moon")
    nodes = m_moon.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.96, 0.98, 1.0, 1.0)
    bsdf.inputs['Emission Color'].default_value = (0.94, 0.97, 1.0, 1.0)
    bsdf.inputs['Emission Strength'].default_value = 8.0
    m_moon.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # 10. Mountain Distant
    m_mtn = get_mat("M_Mountain_Distant")
    nodes = m_mtn.node_tree.nodes
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.24, 0.30, 0.52, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.92
    m_mtn.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

def create_box(bm, center, size, mat_index=0):
    dx, dy, dz = size[0]*0.5, size[1]*0.5, size[2]*0.5
    cx, cy, cz = center[0], center[1], center[2]
    v = [
        bm.verts.new(Vector((cx - dx, cy - dy, cz - dz))),
        bm.verts.new(Vector((cx + dx, cy - dy, cz - dz))),
        bm.verts.new(Vector((cx + dx, cy + dy, cz - dz))),
        bm.verts.new(Vector((cx - dx, cy + dy, cz - dz))),
        bm.verts.new(Vector((cx - dx, cy - dy, cz + dz))),
        bm.verts.new(Vector((cx + dx, cy - dy, cz + dz))),
        bm.verts.new(Vector((cx + dx, cy + dy, cz + dz))),
        bm.verts.new(Vector((cx - dx, cy + dy, cz + dz))),
    ]
    faces = [
        [v[0], v[1], v[2], v[3]],
        [v[4], v[7], v[6], v[5]],
        [v[0], v[4], v[5], v[1]],
        [v[2], v[6], v[7], v[3]],
        [v[0], v[3], v[7], v[4]],
        [v[1], v[5], v[6], v[2]],
    ]
    for f in faces:
        face = bm.faces.new(f)
        face.material_index = mat_index
    return v

# ==============================================================================
# PROCEDURAL ENVIRONMENT BUILDERS
# ==============================================================================

def create_plateau_mesh(name, radius=7.0, height=3.0, scale_xy=(1.0, 1.0), segments=18, seed=1, overhang=0.45, cliff_levels=3):
    """Creates a stylized low-poly plateau island with beveled snow cap, drooping overhang rim, and faceted cliff rock walls."""
    rng = random.Random(seed)
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()

    sx, sy = scale_xy
    angles = [i * (2 * math.pi / segments) for i in range(segments)]
    radii = [radius * (1.0 + rng.uniform(-0.15, 0.15)) for _ in range(segments)]

    # Center vertex on snow top
    v_center = bm.verts.new(Vector((0, 0, height + rng.uniform(0.08, 0.16))))

    # Snow top inner ring
    v_inner = []
    for i in range(segments):
        a = angles[i]
        r = radii[i] * 0.52
        z = height + rng.uniform(-0.04, 0.08)
        v_inner.append(bm.verts.new(Vector((r * sx * math.cos(a), r * sy * math.sin(a), z))))

    # Snow top outer ring
    v_top_edge = []
    for i in range(segments):
        a = angles[i]
        r = radii[i]
        z = height + rng.uniform(-0.05, 0.05)
        v_top_edge.append(bm.verts.new(Vector((r * sx * math.cos(a), r * sy * math.sin(a), z))))

    # Snow overhang rim (drooping bevel)
    v_lip = []
    for i in range(segments):
        a = angles[i]
        r = radii[i] + overhang + rng.uniform(-0.04, 0.04)
        z = height - 0.28 + rng.uniform(-0.04, 0.04)
        v_lip.append(bm.verts.new(Vector((r * sx * math.cos(a), r * sy * math.sin(a), z))))

    # Snow cap faces
    for i in range(segments):
        next_i = (i + 1) % segments
        bm.faces.new([v_center, v_inner[i], v_inner[next_i]])
        bm.faces.new([v_inner[i], v_top_edge[i], v_top_edge[next_i], v_inner[next_i]])
        bm.faces.new([v_top_edge[i], v_lip[i], v_lip[next_i], v_top_edge[next_i]])

    # Faceted Cliff rings down to below water (z = -0.65)
    prev_ring = v_lip
    for lvl in range(1, cliff_levels + 1):
        frac = lvl / cliff_levels
        flare = 1.0 + frac * 0.28
        z_lvl = (height - 0.28) * (1.0 - frac) - 0.65 * frac

        current_ring = []
        for i in range(segments):
            a = angles[i] + rng.uniform(-0.06, 0.06)
            r = radii[i] * flare + rng.uniform(-0.25, 0.25)
            z = z_lvl + (rng.uniform(-0.16, 0.16) if lvl < cliff_levels else -0.65)
            current_ring.append(bm.verts.new(Vector((r * sx * math.cos(a), r * sy * math.sin(a), z))))

        for i in range(segments):
            next_i = (i + 1) % segments
            if (i + lvl) % 2 == 0:
                bm.faces.new([prev_ring[i], current_ring[i], current_ring[next_i]])
                bm.faces.new([prev_ring[i], current_ring[next_i], prev_ring[next_i]])
            else:
                bm.faces.new([prev_ring[i], current_ring[i], prev_ring[next_i]])
                bm.faces.new([prev_ring[next_i], current_ring[i], current_ring[next_i]])

        prev_ring = current_ring

    # Underwater bottom cap
    v_bottom = bm.verts.new(Vector((0, 0, -0.7)))
    for i in range(segments):
        next_i = (i + 1) % segments
        bm.faces.new([v_bottom, prev_ring[next_i], prev_ring[i]])

    bm.to_mesh(mesh)
    bm.free()

    # Materials: 0: M_Snow_Top, 1: M_Cliff_Rock
    mesh.materials.append(bpy.data.materials.get("M_Snow_Top"))
    mesh.materials.append(bpy.data.materials.get("M_Cliff_Rock"))

    for poly in mesh.polygons:
        if poly.center.z < (height - 0.2):
            poly.material_index = 1
        else:
            poly.material_index = 0

    mesh.shade_flat()
    return obj

def build_bridge_between_points(name, pt_start, pt_end, width=2.0, arch=0.35, add_lanterns=True):
    """Builds a wooden bridge connecting two plateau island points with accurate rotation, arch, and lanterns."""
    p1 = Vector(pt_start)
    p2 = Vector(pt_end)
    diff = p2 - p1
    length = diff.length

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()

    mesh.materials.append(bpy.data.materials.get("M_Wood_Structure")) # 0
    mesh.materials.append(bpy.data.materials.get("M_Wood_Dark"))      # 1
    mesh.materials.append(bpy.data.materials.get("M_Lantern_Glow"))   # 2

    plank_count = max(8, int(length / 0.32))
    step = length / plank_count
    half_w = width * 0.5

    # Longitudinal stringer beams
    for side in [-1, 1]:
        y_beam = side * (half_w - 0.18)
        for p in range(plank_count):
            x1 = p * step
            x2 = x1 + step
            t1 = x1 / length
            t2 = x2 / length
            z1 = arch * 4 * t1 * (1 - t1)
            z2 = arch * 4 * t2 * (1 - t2)
            xm = (x1 + x2) * 0.5
            zm = (z1 + z2) * 0.5 - 0.1
            create_box(bm, (xm, y_beam, zm), (step * 1.02, 0.16, 0.16), mat_index=1)

    # Deck Planks
    rng = random.Random(hash(name))
    for p in range(plank_count):
        x = (p + 0.5) * step
        t = x / length
        z = arch * 4 * t * (1 - t)
        pw = width * (1.0 + rng.uniform(-0.03, 0.03))
        create_box(bm, (x, 0, z), (step * 0.92, pw, 0.08), mat_index=0)

    # Handrail Posts and Railings
    post_count = max(4, int(length / 1.6))
    post_step = length / (post_count - 1)
    post_h = 1.05
    post_w = 0.12

    lantern_positions = []

    for side in [-1, 1]:
        y_post = side * (half_w - 0.1)
        prev_top = None
        for i in range(post_count):
            x = i * post_step
            t = x / length
            z = arch * 4 * t * (1 - t)
            is_end = (i == 0 or i == post_count - 1)
            h = post_h + (0.75 if (is_end and add_lanterns) else 0.0)

            create_box(bm, (x, y_post, z + h*0.5), (post_w, post_w, h), mat_index=1)

            top_pt = Vector((x, y_post, z + post_h))
            if prev_top:
                xm = (prev_top.x + top_pt.x) * 0.5
                zm = (prev_top.z + top_pt.z) * 0.5
                dist = (top_pt - prev_top).length
                create_box(bm, (xm, y_post, zm), (dist * 1.02, 0.1, 0.08), mat_index=0)
                create_box(bm, (xm, y_post, zm - 0.4), (dist * 1.02, 0.08, 0.06), mat_index=0)
            prev_top = top_pt

            if is_end and add_lanterns:
                arm_y = y_post - side * 0.25
                create_box(bm, (x, (y_post + arm_y)*0.5, z + h - 0.05), (0.08, 0.35, 0.08), mat_index=1)
                create_box(bm, (x, arm_y, z + h - 0.3), (0.22, 0.22, 0.32), mat_index=2)
                lantern_positions.append(Vector((x, arm_y, z + h - 0.3)))

    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_flat()

    obj.location = p1
    yaw = math.atan2(diff.y, diff.x)
    pitch = -math.atan2(diff.z, math.sqrt(diff.x**2 + diff.y**2))
    obj.rotation_mode = 'ZYX'
    obj.rotation_euler = Euler((0, pitch, yaw), 'ZYX')

    world_lanterns = [obj.matrix_world @ lp for lp in lantern_positions]
    return obj, world_lanterns

def build_path_ribbon(name, waypoints, width=2.0, z_offset=0.03):
    """Creates a continuous dirt/snow trail following waypoints across an island."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()

    mesh.materials.append(bpy.data.materials.get("M_Path_Dirt"))

    half_w = width * 0.5
    v_pairs = []

    for i, pt in enumerate(waypoints):
        p = Vector(pt)
        if i == 0:
            tangent = (Vector(waypoints[1]) - p).normalized()
        elif i == len(waypoints) - 1:
            tangent = (p - Vector(waypoints[-2])).normalized()
        else:
            t1 = (p - Vector(waypoints[i-1])).normalized()
            t2 = (Vector(waypoints[i+1]) - p).normalized()
            tangent = (t1 + t2).normalized()

        normal = Vector((-tangent.y, tangent.x, 0)).normalized()
        vl = bm.verts.new(p - normal * half_w + Vector((0, 0, z_offset)))
        vr = bm.verts.new(p + normal * half_w + Vector((0, 0, z_offset)))
        v_pairs.append((vl, vr))

    for i in range(len(v_pairs) - 1):
        l1, r1 = v_pairs[i]
        l2, r2 = v_pairs[i+1]
        f = bm.faces.new([l1, r1, r2, l2])
        f.material_index = 0

    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_flat()
    return obj

def build_watchtower_prop(name, loc, height=6.5, rot_z=0.0):
    """Builds a timber lookout watchtower."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()

    mesh.materials.append(bpy.data.materials.get("M_Wood_Structure")) # 0
    mesh.materials.append(bpy.data.materials.get("M_Wood_Dark"))      # 1
    mesh.materials.append(bpy.data.materials.get("M_Lantern_Glow"))   # 2
    mesh.materials.append(bpy.data.materials.get("M_Snow_Top"))       # 3

    b_w = 3.0
    t_w = 2.2
    h = height

    for sx in [-1, 1]:
        for sy in [-1, 1]:
            v_bot = Vector((sx * b_w * 0.5, sy * b_w * 0.5, 0))
            v_top = Vector((sx * t_w * 0.5, sy * t_w * 0.5, h))
            create_box(bm, (v_bot + v_top) * 0.5, (0.22, 0.22, h), mat_index=1)

    for frac in [0.33, 0.66]:
        zh = h * frac
        w_curr = b_w + (t_w - b_w) * frac
        for side in [-1, 1]:
            create_box(bm, (0, side * w_curr * 0.5, zh), (w_curr, 0.12, 0.12), mat_index=1)
            create_box(bm, (side * w_curr * 0.5, 0, zh), (0.12, w_curr, 0.12), mat_index=1)

    p_size = t_w + 0.5
    plank_count = 8
    p_step = p_size / plank_count
    for i in range(plank_count):
        y = -p_size * 0.5 + (i + 0.5) * p_step
        create_box(bm, (0, y, h + 0.05), (p_size, p_step * 0.9, 0.08), mat_index=0)

    rail_h = 0.95
    for sx in [-1, 1]:
        for sy in [-1, 1]:
            create_box(bm, (sx * p_size * 0.5, sy * p_size * 0.5, h + rail_h * 0.5), (0.1, 0.1, rail_h), mat_index=1)
    for side in [-1, 1]:
        create_box(bm, (0, side * p_size * 0.5, h + rail_h), (p_size, 0.08, 0.08), mat_index=0)
        create_box(bm, (side * p_size * 0.5, 0, h + rail_h), (0.08, p_size, 0.08), mat_index=0)

    roof_post_h = 1.9
    for sx in [-1, 1]:
        for sy in [-1, 1]:
            create_box(bm, (sx * p_size * 0.45, sy * p_size * 0.45, h + roof_post_h * 0.5), (0.14, 0.14, roof_post_h), mat_index=1)

    r_overhang = p_size + 0.7
    rz_base = h + roof_post_h
    rz_peak = rz_base + 1.2
    v_apex = bm.verts.new(Vector((0, 0, rz_peak)))
    v_rc = [
        bm.verts.new(Vector((-r_overhang*0.5, -r_overhang*0.5, rz_base))),
        bm.verts.new(Vector(( r_overhang*0.5, -r_overhang*0.5, rz_base))),
        bm.verts.new(Vector(( r_overhang*0.5,  r_overhang*0.5, rz_base))),
        bm.verts.new(Vector((-r_overhang*0.5,  r_overhang*0.5, rz_base))),
    ]
    for i in range(4):
        f = bm.faces.new([v_rc[i], v_rc[(i+1)%4], v_apex])
        f.material_index = 0

    v_apex_s = bm.verts.new(Vector((0, 0, rz_peak + 0.12)))
    v_sc = [
        bm.verts.new(Vector((-r_overhang*0.4, -r_overhang*0.4, rz_base + 0.4))),
        bm.verts.new(Vector(( r_overhang*0.4, -r_overhang*0.4, rz_base + 0.4))),
        bm.verts.new(Vector(( r_overhang*0.4,  r_overhang*0.4, rz_base + 0.4))),
        bm.verts.new(Vector((-r_overhang*0.4,  r_overhang*0.4, rz_base + 0.4))),
    ]
    for i in range(4):
        f = bm.faces.new([v_sc[i], v_sc[(i+1)%4], v_apex_s])
        f.material_index = 3

    create_box(bm, (0, 0, rz_base - 0.2), (0.06, 0.06, 0.4), mat_index=1)
    create_box(bm, (0, 0, rz_base - 0.5), (0.3, 0.3, 0.4), mat_index=2)

    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_flat()

    obj.location = loc
    obj.rotation_euler = Euler((0, 0, rot_z), 'XYZ')
    lantern_world = obj.matrix_world @ Vector((0, 0, rz_base - 0.5))
    return obj, lantern_world

def build_dock_prop(name, loc, length=7.0, width=2.4, rot_z=0.0):
    """Builds a wooden dock extending into the ice water."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()

    mesh.materials.append(bpy.data.materials.get("M_Wood_Structure")) # 0
    mesh.materials.append(bpy.data.materials.get("M_Wood_Dark"))      # 1
    mesh.materials.append(bpy.data.materials.get("M_Lantern_Glow"))   # 2

    piling_pairs = max(3, int(length / 2.2) + 1)
    step = length / (piling_pairs - 1)
    for p in range(piling_pairs):
        x = p * step
        for sy in [-1, 1]:
            y = sy * (width * 0.5 - 0.2)
            create_box(bm, (x, y, 0.0), (0.22, 0.22, 1.8), mat_index=1)
        create_box(bm, (x, 0, 0.65), (0.18, width - 0.2, 0.16), mat_index=1)

    plank_count = int(length / 0.28)
    p_step = length / plank_count
    for i in range(plank_count):
        x = (i + 0.5) * p_step
        create_box(bm, (x, 0, 0.8), (p_step * 0.92, width, 0.08), mat_index=0)

    end_x = length
    create_box(bm, (end_x - 0.2, width*0.5 - 0.2, 1.4), (0.14, 0.14, 1.4), mat_index=1)
    create_box(bm, (end_x - 0.4, width*0.5 - 0.2, 2.05), (0.4, 0.08, 0.08), mat_index=1)
    create_box(bm, (end_x - 0.55, width*0.5 - 0.2, 1.8), (0.22, 0.22, 0.3), mat_index=2)

    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_flat()

    obj.location = loc
    obj.rotation_euler = Euler((0, 0, rot_z), 'XYZ')
    lantern_world = obj.matrix_world @ Vector((end_x - 0.55, width*0.5 - 0.2, 1.8))
    return obj, lantern_world

def build_rowboat_prop(name, loc, rot_z=0.0):
    """Builds a stylized wooden rowboat moored near the dock."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()

    mesh.materials.append(bpy.data.materials.get("M_Wood_Structure")) # 0
    mesh.materials.append(bpy.data.materials.get("M_Wood_Dark"))      # 1

    l = 3.2
    w = 1.3
    h = 0.65

    v_b_stern = bm.verts.new(Vector((-l*0.48, 0, 0.05)))
    v_b_sl = bm.verts.new(Vector((-l*0.45, -w*0.25, 0.05)))
    v_b_sr = bm.verts.new(Vector((-l*0.45,  w*0.25, 0.05)))
    v_b_ml = bm.verts.new(Vector((0, -w*0.35, 0.0)))
    v_b_mr = bm.verts.new(Vector((0,  w*0.35, 0.0)))
    v_b_bow = bm.verts.new(Vector((l*0.52, 0, 0.1)))

    bm.faces.new([v_b_stern, v_b_sl, v_b_ml, v_b_mr, v_b_sr])
    bm.faces.new([v_b_ml, v_b_bow, v_b_mr])

    v_g_stern = bm.verts.new(Vector((-l*0.5, 0, h)))
    v_g_sl = bm.verts.new(Vector((-l*0.48, -w*0.42, h)))
    v_g_sr = bm.verts.new(Vector((-l*0.48,  w*0.42, h)))
    v_g_ml = bm.verts.new(Vector((0, -w*0.5, h - 0.05)))
    v_g_mr = bm.verts.new(Vector((0,  w*0.5, h - 0.05)))
    v_g_bow = bm.verts.new(Vector((l*0.55, 0, h + 0.15)))

    bm.faces.new([v_b_sl, v_g_sl, v_g_stern, v_b_stern])
    bm.faces.new([v_b_stern, v_g_stern, v_g_sr, v_b_sr])
    bm.faces.new([v_b_sl, v_b_ml, v_g_ml, v_g_sl])
    bm.faces.new([v_b_sr, v_g_sr, v_g_mr, v_b_mr])
    bm.faces.new([v_b_ml, v_b_bow, v_g_bow, v_g_ml])
    bm.faces.new([v_b_mr, v_g_mr, v_g_bow, v_b_bow])

    create_box(bm, (0, 0, h * 0.5), (0.35, w * 0.85, 0.08), mat_index=1)
    create_box(bm, (-l*0.3, 0, h * 0.55), (0.32, w * 0.75, 0.08), mat_index=1)
    create_box(bm, (0.1, 0, h * 0.75), (0.08, w * 1.5, 0.08), mat_index=0)

    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_flat()

    obj.location = loc
    obj.rotation_euler = Euler((0, 0, rot_z), 'XYZ')
    return obj

def build_ice_floe_prop(name, loc, radius=2.2, thickness=0.6, seed=1):
    """Builds a floating low-poly ice chunk in the water channels."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()

    mesh.materials.append(bpy.data.materials.get("M_Snow_Top")) # 0
    mesh.materials.append(bpy.data.materials.get("M_Ice_Floe"))  # 1

    rng = random.Random(seed)
    segs = 8
    angles = [i * (2 * math.pi / segs) for i in range(segs)]
    radii = [radius * (1.0 + rng.uniform(-0.18, 0.18)) for _ in range(segs)]

    v_top_center = bm.verts.new(Vector((0, 0, 0.12 + rng.uniform(0.02, 0.06))))
    v_top_ring = [bm.verts.new(Vector((radii[i]*math.cos(angles[i]), radii[i]*math.sin(angles[i]), 0.12))) for i in range(segs)]
    for i in range(segs):
        f = bm.faces.new([v_top_center, v_top_ring[i], v_top_ring[(i+1)%segs]])
        f.material_index = 0

    v_bot_ring = [bm.verts.new(Vector((radii[i]*0.8*math.cos(angles[i]), radii[i]*0.8*math.sin(angles[i]), -thickness))) for i in range(segs)]
    v_bot_center = bm.verts.new(Vector((0, 0, -thickness - 0.15)))

    for i in range(segs):
        next_i = (i + 1) % segs
        f1 = bm.faces.new([v_top_ring[i], v_bot_ring[i], v_bot_ring[next_i]])
        f2 = bm.faces.new([v_top_ring[i], v_bot_ring[next_i], v_top_ring[next_i]])
        f1.material_index = 1
        f2.material_index = 1
        f3 = bm.faces.new([v_bot_center, v_bot_ring[next_i], v_bot_ring[i]])
        f3.material_index = 1

    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_flat()

    obj.location = loc
    return obj

def build_frozen_waterfall_prop(name, loc, height=3.5, width=2.0, rot_z=0.0):
    """Builds a frozen icicle cascade on a cliff face."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()
    mesh.materials.append(bpy.data.materials.get("M_Ice_Floe"))

    rng = random.Random(99)
    num_icicles = 8
    step = width / (num_icicles - 1)
    for i in range(num_icicles):
        x = -width*0.5 + i * step + rng.uniform(-0.06, 0.06)
        y = rng.uniform(-0.15, 0.15)
        len_ice = height * rng.uniform(0.7, 1.0)
        thick = rng.uniform(0.18, 0.35)

        v_top = [
            bm.verts.new(Vector((x - thick*0.5, y - thick*0.5, 0))),
            bm.verts.new(Vector((x + thick*0.5, y - thick*0.5, 0))),
            bm.verts.new(Vector((x + thick*0.5, y + thick*0.5, 0))),
            bm.verts.new(Vector((x - thick*0.5, y + thick*0.5, 0))),
        ]
        v_tip = bm.verts.new(Vector((x, y, -len_ice)))
        for s in range(4):
            bm.faces.new([v_top[s], v_top[(s+1)%4], v_tip])

    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_flat()

    obj.location = loc
    obj.rotation_euler = Euler((0, 0, rot_z), 'XYZ')
    return obj

def build_distant_mountains(name="Distant_Mountains"):
    """Creates a continuous multi-layered mountain silhouette ringing the northern horizon."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()

    mesh.materials.append(bpy.data.materials.get("M_Mountain_Distant")) # 0
    mesh.materials.append(bpy.data.materials.get("M_Snow_Top"))          # 1

    rng = random.Random(42)
    peaks = [
        (-75, 75, 26, 24),
        (-52, 85, 34, 26),
        (-30, 72, 28, 22),
        ( -8, 88, 36, 28),
        ( 16, 76, 30, 24),
        ( 40, 88, 35, 26),
        ( 64, 75, 27, 22),
        ( 88, 82, 32, 24),
    ]

    for px, py, pz, pr in peaks:
        v_peak = bm.verts.new(Vector((px, py, pz)))
        segs = 7
        base_verts = []
        for i in range(segs):
            a = i * (2 * math.pi / segs) + rng.uniform(-0.15, 0.15)
            r = pr * (1.0 + rng.uniform(-0.15, 0.15))
            base_verts.append(bm.verts.new(Vector((px + r * math.cos(a), py + r * math.sin(a), 0))))
        for i in range(segs):
            f = bm.faces.new([base_verts[i], base_verts[(i+1)%segs], v_peak])
            f.material_index = 0

    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_flat()
    return obj

def build_moon_disc(name="Full_Moon", loc=(28, 70, 36), radius=4.2):
    """Creates a glowing stylized full moon disc in the night sky."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()
    mesh.materials.append(bpy.data.materials.get("M_Moon"))

    segs = 20
    v_center = bm.verts.new(Vector((0, 0, 0)))
    ring = [bm.verts.new(Vector((radius*math.cos(i*2*math.pi/segs), 0, radius*math.sin(i*2*math.pi/segs)))) for i in range(segs)]
    for i in range(segs):
        bm.faces.new([v_center, ring[i], ring[(i+1)%segs]])

    bm.to_mesh(mesh)
    bm.free()
    obj.location = loc
    obj.rotation_euler = Euler((math.radians(35), 0, math.radians(-32)), 'XYZ')
    return obj

def build_water_plane(name="Ice_Sea_Surface", size=200.0):
    """Creates the vast crystalline frozen ice sea surface."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bm = bmesh.new()
    mesh.materials.append(bpy.data.materials.get("M_Ice_Water"))

    hs = size * 0.5
    v = [
        bm.verts.new(Vector((-hs, -hs, 0.0))),
        bm.verts.new(Vector(( hs, -hs, 0.0))),
        bm.verts.new(Vector(( hs,  hs, 0.0))),
        bm.verts.new(Vector((-hs,  hs, 0.0))),
    ]
    bm.faces.new(v)
    bm.to_mesh(mesh)
    bm.free()
    return obj

# ==============================================================================
# MAIN SCENE COMPOSITION & ASSEMBLY
# ==============================================================================

def assemble_modular_winter_scene():
    clean_scene_keep_assets()
    setup_materials()

    col_env = get_or_create_collection("Environment_World")
    col_kit = get_or_create_collection("Modular_Kit")
    col_terrain = get_or_create_collection("Terrain_Islands", col_env)
    col_water = get_or_create_collection("Water_and_Ice", col_env)
    col_bridges = get_or_create_collection("Bridges_Network", col_env)
    col_paths = get_or_create_collection("Paths_Trails", col_env)
    col_props = get_or_create_collection("Props_and_Docks", col_env)
    col_village = get_or_create_collection("Village_Houses", col_env)
    col_foliage = get_or_create_collection("Foliage_Trees", col_env)
    col_lights = get_or_create_collection("Lighting_and_Atmosphere", col_env)

    # --------------------------------------------------------------------------
    # 1. Modular Kit Palette (Cleanly organized reference palette at X = -75)
    # --------------------------------------------------------------------------
    print("Generating Modular Kit Palette...")
    kit_watchtower, _ = build_watchtower_prop("Kit_Watchtower", (-75, 0, 0))
    col_kit.objects.link(kit_watchtower)

    kit_dock, _ = build_dock_prop("Kit_Dock_Pier", (-75, 8, 0))
    col_kit.objects.link(kit_dock)

    kit_boat = build_rowboat_prop("Kit_Rowboat", (-75, 16, 0))
    col_kit.objects.link(kit_boat)

    kit_bridge_10, _ = build_bridge_between_points("Kit_Bridge_10m", (-75, -12, 0), (-75, -2, 0))
    col_kit.objects.link(kit_bridge_10)

    kit_floe = build_ice_floe_prop("Kit_Ice_Floe", (-75, 24, 0), radius=2.5)
    col_kit.objects.link(kit_floe)

    kit_plateau = create_plateau_mesh("Kit_Plateau_Medium", radius=6.5, height=3.2, seed=12)
    kit_plateau.location = (-75, -22, 0)
    col_kit.objects.link(kit_plateau)

    kit_waterfall = build_frozen_waterfall_prop("Kit_Frozen_Waterfall", (-75, -32, 3.2))
    col_kit.objects.link(kit_waterfall)

    # --------------------------------------------------------------------------
    # 2. Frozen Ice Sea & Scattered Floating Ice Floes
    # --------------------------------------------------------------------------
    print("Generating Frozen Sea and Ice Floes...")
    water_sea = build_water_plane("Ice_Sea_Surface", size=200.0)
    col_water.objects.link(water_sea)

    floe_coords = [
        (-4, -14, 2.0, 1),
        ( 8, -17, 2.6, 2),
        (-2, -6,  1.7, 3),
        (12, -4,  2.2, 4),
        (-14, 2,  1.8, 5),
        (-3, 12,  2.8, 6),
        ( 7,  8,  1.9, 7),
        (16, 16,  2.4, 8),
        (-18, 22, 2.0, 9),
        (-2, 28,  2.7, 10),
        (10, 26,  2.2, 11),
        (22, -2,  1.9, 12),
        (-22, -4, 2.1, 13),
        ( 1, -21, 2.4, 14),
    ]
    for i, (fx, fy, fr, fs) in enumerate(floe_coords):
        floe = build_ice_floe_prop(f"Ice_Floe_{i+1:02d}", (fx, fy, 0), radius=fr, seed=fs)
        col_water.objects.link(floe)

    # --------------------------------------------------------------------------
    # 3. Plateau Islands Archipelago
    # --------------------------------------------------------------------------
    print("Generating Plateau Islands Archipelago...")
    islands_data = [
        # (name, radius, height, scale_xy, loc, seed)
        ("Island_FG_Right",       9.5, 2.2, (1.25, 0.95), ( 17.5, -13.0, 0), 101),
        ("Island_FG_Left",        8.5, 2.4, (1.05, 1.15), (-15.5,  -9.0, 0), 102),
        ("Island_Center_Hub",    13.5, 2.8, (1.20, 1.10), ( -1.5,   2.5, 0), 103),
        ("Plateau_Mid_Left",     11.0, 4.2, (1.10, 1.05), (-23.5,  14.5, 0), 104),
        ("Island_Mid_North",     12.0, 3.4, (1.25, 0.95), (  3.5,  20.5, 0), 105),
        ("Plateau_Mid_Right",    10.0, 3.8, (1.05, 1.15), ( 22.5,   9.5, 0), 106),
        ("Plateau_High_West",     9.5, 6.5, (1.00, 1.00), (-31.5,  28.5, 0), 107),
        ("Plateau_High_East",    10.0, 6.2, (1.10, 1.00), ( 29.5,  24.5, 0), 108),
        ("Island_Far_NorthLeft",  8.5, 4.0, (1.20, 0.90), (-15.5,  38.5, 0), 109),
        ("Island_Far_NorthMid",   9.0, 3.8, (1.05, 1.10), ( 12.5,  39.5, 0), 110),
    ]

    for iname, rad, h, sxy, (ix, iy, iz), s in islands_data:
        p_obj = create_plateau_mesh(iname, radius=rad, height=h, scale_xy=sxy, seed=s)
        p_obj.location = Vector((ix, iy, iz))
        col_terrain.objects.link(p_obj)

    # Frozen Waterfalls on the high cliff faces
    wf1 = build_frozen_waterfall_prop("Frozen_Waterfall_MidLeft", (-16.5, 11.0, 4.2), height=4.2, width=2.4, rot_z=0.6)
    col_props.objects.link(wf1)
    wf2 = build_frozen_waterfall_prop("Frozen_Waterfall_HighWest", (-25.5, 24.5, 6.5), height=6.5, width=2.6, rot_z=0.4)
    col_props.objects.link(wf2)

    # --------------------------------------------------------------------------
    # 4. Bridges Network Connecting Archipelago
    # --------------------------------------------------------------------------
    print("Generating Bridges Network...")
    bridges_specs = [
        # (name, start_pt, end_pt, arch)
        ("Bridge_FG_Right_to_Center",  ( 10.5, -10.5, 2.2), (  5.2,  -3.5, 2.8), 0.35),
        ("Bridge_FG_Left_to_Center",   ( -9.5,  -6.5, 2.4), ( -3.5,  -2.5, 2.8), 0.30),
        ("Bridge_Center_to_MidLeft",   ( -8.2,   7.0, 2.8), (-16.0,  12.0, 4.2), 0.45),
        ("Bridge_Center_to_MidNorth",  (  0.2,  10.0, 2.8), (  1.8,  15.5, 3.4), 0.32),
        ("Bridge_Center_to_MidRight",  (  7.0,   5.0, 2.8), ( 15.2,   8.0, 3.8), 0.38),
        ("Bridge_MidNorth_to_MidRight",(  9.5,  18.5, 3.4), ( 17.8,  14.0, 3.8), 0.35),
        ("Bridge_MidLeft_to_HighWest", (-25.5,  20.5, 4.2), (-28.5,  25.0, 6.5), 0.48),
        ("Bridge_MidRight_to_HighEast",( 25.5,  15.0, 3.8), ( 27.8,  20.0, 6.2), 0.45),
        ("Bridge_MidNorth_to_FarNorth",(  5.5,  26.5, 3.4), (  9.0,  34.0, 3.8), 0.38),
    ]

    all_lantern_lights = []
    for bname, p1, p2, arch in bridges_specs:
        b_obj, l_pts = build_bridge_between_points(bname, p1, p2, width=2.0, arch=arch, add_lanterns=True)
        col_bridges.objects.link(b_obj)
        all_lantern_lights.extend(l_pts)

    # --------------------------------------------------------------------------
    # 5. Paths and Trails Across the Snow
    # --------------------------------------------------------------------------
    print("Generating Paths and Trails...")
    trails = [
        ("Path_FG_Right", [(23.0, -15.0, 2.2), (17.5, -13.0, 2.2), (10.5, -10.5, 2.2)]),
        ("Path_FG_Left", [(-18.5, -11.0, 2.4), (-15.0,  -9.0, 2.4), ( -9.5,  -6.5, 2.4)]),
        ("Path_Center_Hub_Main", [
            (-3.5, -2.5, 2.8),
            (-1.5,  0.5, 2.8),
            ( 1.5,  2.5, 2.8),
            ( 5.2, -3.5, 2.8)
        ]),
        ("Path_Center_Hub_Branch", [
            (-1.5, 0.5, 2.8),
            (-8.2, 7.0, 2.8)
        ]),
        ("Path_Center_Hub_North", [
            (1.5, 2.5, 2.8),
            (0.2, 10.0, 2.8)
        ]),
        ("Path_MidNorth", [
            (1.8, 15.5, 3.4),
            (3.5, 19.5, 3.4),
            (9.5, 18.5, 3.4)
        ]),
        ("Path_MidRight", [
            (15.2,  8.0, 3.8),
            (19.5,  9.5, 3.8),
            (25.5, 15.0, 3.8)
        ]),
    ]

    for tname, wpts in trails:
        path_obj = build_path_ribbon(tname, wpts, width=2.0)
        col_paths.objects.link(path_obj)

    # --------------------------------------------------------------------------
    # 6. Docks, Rowboats, Watchtowers
    # --------------------------------------------------------------------------
    print("Generating Docks, Boats, and Watchtowers...")
    # South-East Dock on Island_FG_Left (prominently visible)
    dock_fg, dock_lgt = build_dock_prop("Dock_South_FG", (-16.0, -17.5, 0.0), length=7.5, width=2.4, rot_z=-0.75)
    col_props.objects.link(dock_fg)
    all_lantern_lights.append(dock_lgt)

    boat_fg = build_rowboat_prop("Rowboat_South_FG", (-19.5, -19.5, 0.0), rot_z=-0.5)
    col_props.objects.link(boat_fg)

    # Second Dock on Foreground Right Island
    dock_fg_r, dock_lgt_r = build_dock_prop("Dock_South_Right", (14.0, -21.0, 0.0), length=6.5, width=2.2, rot_z=-0.95)
    col_props.objects.link(dock_fg_r)
    all_lantern_lights.append(dock_lgt_r)

    boat_fg_r = build_rowboat_prop("Rowboat_South_Right", (10.5, -23.0, 0.0), rot_z=-0.7)
    col_props.objects.link(boat_fg_r)

    # Watchtowers on high vantage clifftops
    wt_west, wt_lgt_w = build_watchtower_prop("Watchtower_West_High", (-31.5, 28.5, 6.5), height=6.5, rot_z=0.4)
    col_props.objects.link(wt_west)
    all_lantern_lights.append(wt_lgt_w)

    wt_east, wt_lgt_e = build_watchtower_prop("Watchtower_East_High", (29.5, 24.5, 6.2), height=6.5, rot_z=-0.4)
    col_props.objects.link(wt_east)
    all_lantern_lights.append(wt_lgt_e)

    # --------------------------------------------------------------------------
    # 7. Village Houses and Forest Trees Integration
    # --------------------------------------------------------------------------
    print("Populating Village Houses and Forest Trees...")
    src_houses = {
        'h1': bpy.data.objects.get("house1"),
        'h2': bpy.data.objects.get("house2"),
        'h3': bpy.data.objects.get("house3"),
        'h4': bpy.data.objects.get("house4"),
    }

    house_placements = [
        # (src_key, loc, rot_z, scale)
        ('h1', (-15.0,  -8.5, 2.4),  0.35, 1.0),
        ('h4', ( 18.5, -13.0, 2.2), -0.45, 1.0),
        ('h2', ( -1.2,   3.0, 2.8),  0.15, 1.05),
        ('h3', (  4.0,  -0.8, 2.8), -0.65, 0.95),
        ('h1', (-22.5,  15.0, 4.2),  0.55, 0.95),
        ('h2', (  3.5,  22.0, 3.4), -0.25, 1.0),
        ('h3', ( 21.0,  10.0, 3.8),  0.85, 0.95),
        ('h4', ( 28.0,  26.5, 6.2), -0.75, 0.95),
        ('h1', (-14.5,  39.5, 4.0),  0.25, 0.9),
    ]

    for idx, (h_key, (hx, hy, hz), rot, sc) in enumerate(house_placements):
        src = src_houses.get(h_key)
        if src:
            inst = src.copy()
            inst.name = f"Village_House_{idx+1:02d}_{h_key}"
            inst.location = Vector((hx, hy, hz))
            inst.rotation_euler = Euler((0, 0, rot), 'XYZ')
            inst.scale = Vector((sc, sc, sc))
            col_village.objects.link(inst)

            # Cozy warm window/porch point light at each house
            h_light_data = bpy.data.lights.new(name=f"HouseGlow_{idx+1:02d}", type='POINT')
            h_light_data.color = (1.0, 0.58, 0.12)
            h_light_data.energy = 35.0
            h_light_data.shadow_soft_size = 0.5
            h_light_obj = bpy.data.objects.new(name=f"HouseGlow_{idx+1:02d}", object_data=h_light_data)
            h_light_obj.location = Vector((hx + 0.5, hy + 0.5, hz + 1.2))
            col_lights.objects.link(h_light_obj)

    tree_srcs = [
        bpy.data.objects.get("treebig"),
        bpy.data.objects.get("treebig2"),
        bpy.data.objects.get("tree mid1"),
        bpy.data.objects.get("treemid2"),
        bpy.data.objects.get("treeb"),
        bpy.data.objects.get("treesmall"),
    ]
    tree_srcs = [t for t in tree_srcs if t is not None]

    bush_srcs = [
        bpy.data.objects.get("bush1"),
        bpy.data.objects.get("bush2"),
        bpy.data.objects.get("bush3"),
        bpy.data.objects.get("bush4"),
    ]
    bush_srcs = [b for b in bush_srcs if b is not None]

    rng_tree = random.Random(777)
    island_tree_zones = [
        ( 17.5, -13.0, 2.2, 8.0, 10, 6),
        (-15.5,  -9.0, 2.4, 7.0,  9, 5),
        ( -1.5,   2.5, 2.8, 10.5, 18, 10),
        (-23.5,  14.5, 4.2, 9.0, 13, 6),
        (  3.5,  20.5, 3.4, 10.0, 15, 8),
        ( 22.5,   9.5, 3.8, 8.0, 11, 6),
        (-31.5,  28.5, 6.5, 8.0, 13, 6),
        ( 29.5,  24.5, 6.2, 8.5, 13, 6),
        (-15.5,  38.5, 4.0, 7.0,  9, 4),
        ( 12.5,  39.5, 3.8, 7.5,  9, 4),
    ]

    tree_id = 0
    for cx, cy, cz, rad, n_trees, n_bushes in island_tree_zones:
        for _ in range(n_trees):
            if not tree_srcs:
                break
            src = rng_tree.choice(tree_srcs)
            a = rng_tree.uniform(0, 2 * math.pi)
            r = rng_tree.uniform(rad * 0.35, rad * 0.95)
            tx = cx + r * math.cos(a)
            ty = cy + r * math.sin(a)
            t_obj = src.copy()
            t_obj.name = f"PineTree_{tree_id+1:03d}"
            t_obj.location = Vector((tx, ty, cz))
            s = rng_tree.uniform(5.5, 7.5)
            t_obj.scale = Vector((s, s, s))
            t_obj.rotation_euler = Euler((0, 0, rng_tree.uniform(-0.35, 0.35)), 'XYZ')
            col_foliage.objects.link(t_obj)
            tree_id += 1

        for _ in range(n_bushes):
            if not bush_srcs:
                break
            src = rng_tree.choice(bush_srcs)
            a = rng_tree.uniform(0, 2 * math.pi)
            r = rng_tree.uniform(rad * 0.25, rad * 0.9)
            bx = cx + r * math.cos(a)
            by = cy + r * math.sin(a)
            b_obj = src.copy()
            b_obj.name = f"SnowBush_{tree_id+1:03d}"
            b_obj.location = Vector((bx, by, cz))
            s = rng_tree.uniform(4.5, 6.5)
            b_obj.scale = Vector((s, s, s))
            b_obj.rotation_euler = Euler((0, 0, rng_tree.uniform(-0.3, 0.3)), 'XYZ')
            col_foliage.objects.link(b_obj)
            tree_id += 1

    # --------------------------------------------------------------------------
    # 8. Horizon Backdrop: Distant Mountains & Full Moon
    # --------------------------------------------------------------------------
    print("Generating Horizon Backdrop and Full Moon...")
    mtns = build_distant_mountains("Distant_Mountains")
    col_props.objects.link(mtns)

    moon = build_moon_disc("Full_Moon", loc=(28, 70, 36), radius=4.2)
    col_props.objects.link(moon)

    # --------------------------------------------------------------------------
    # 9. Atmospheric Lighting & Hero Isometric Camera
    # --------------------------------------------------------------------------
    print("Setting up Atmospheric Lighting and Camera...")
    # Twilight World Background
    world = bpy.context.scene.world
    if not world:
        world = bpy.data.worlds.new("World_WinterTwilight")
        bpy.context.scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs['Color'].default_value = (0.04, 0.08, 0.20, 1.0) # deep indigo twilight
        bg_node.inputs['Strength'].default_value = 0.7

    # Directional Moonlight
    moon_light_data = bpy.data.lights.new(name="Moonlight_Sun", type='SUN')
    moon_light_data.color = (0.75, 0.88, 1.0)
    moon_light_data.energy = 3.2
    moon_light_data.angle = 0.25
    moon_light_obj = bpy.data.objects.new(name="Moonlight_Sun", object_data=moon_light_data)
    moon_light_obj.rotation_euler = Euler((math.radians(48), math.radians(18), math.radians(-38)), 'XYZ')
    col_lights.objects.link(moon_light_obj)

    # Sky Fill Light
    fill_light_data = bpy.data.lights.new(name="SkyFill_Sun", type='SUN')
    fill_light_data.color = (0.42, 0.52, 0.82)
    fill_light_data.energy = 0.85
    fill_light_obj = bpy.data.objects.new(name="SkyFill_Sun", object_data=fill_light_data)
    fill_light_obj.rotation_euler = Euler((math.radians(-60), 0, math.radians(140)), 'XYZ')
    col_lights.objects.link(fill_light_obj)

    # Warm point lights for lanterns along bridges and docks
    step_lgt = max(1, len(all_lantern_lights) // 18)
    for li, l_pos in enumerate(all_lantern_lights[::step_lgt]):
        p_data = bpy.data.lights.new(name=f"LanternLight_{li+1:02d}", type='POINT')
        p_data.color = (1.0, 0.62, 0.15)
        p_data.energy = 45.0
        p_data.shadow_soft_size = 0.35
        p_obj = bpy.data.objects.new(name=f"LanternLight_{li+1:02d}", object_data=p_data)
        p_obj.location = l_pos
        col_lights.objects.link(p_obj)

    # Hero Isometric Camera framing the whole scene
    bpy.context.scene.render.resolution_x = 1920
    bpy.context.scene.render.resolution_y = 1080

    cam_data = bpy.data.cameras.new("Hero_Isometric_Camera")
    cam_data.lens = 38.0
    cam_data.clip_start = 0.5
    cam_data.clip_end = 500.0
    cam_obj = bpy.data.objects.new("Hero_Isometric_Camera", cam_data)
    # Positioned for expansive 3/4 elevated isometric view
    cam_obj.location = Vector((-20.0, -38.0, 24.0))
    look_target = Vector((2.0, 8.0, 3.2))
    direction = look_target - cam_obj.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam_obj.rotation_euler = rot_quat.to_euler()
    col_env.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # Set Viewport to Rendered mode and Camera view
    for area in bpy.context.screen.areas:
        if area.type == 'VIEW_3D':
            for space in area.spaces:
                if space.type == 'VIEW_3D':
                    space.shading.type = 'RENDERED'
                    space.region_3d.view_perspective = 'CAMERA'

    print("\nModular Winter Archipelago Scene assembled successfully!")
    print(f"Total Objects in scene: {len(bpy.context.scene.objects)}")

if __name__ == "__main__":
    assemble_modular_winter_scene()
