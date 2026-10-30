import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { compactPrimitive } from '@gltf-transform/functions';
import draco3d from 'draco3d';

const input = 'H:/Sandesh/2026/October/santa delivery/dev/public/assets/models/terrain.glb';
const output = 'H:/Sandesh/2026/October/santa delivery/dev/public/assets/models/terrain-mobile.glb';

const decoderModule = await draco3d.createDecoderModule({});
const encoderModule = await draco3d.createEncoderModule({});
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': decoderModule, 'draco3d.encoder': encoderModule });
const doc = await io.read(input);
await MeshoptSimplifier.ready;

const rows = [];
for (const mesh of doc.getRoot().listMeshes()) {
  const name = mesh.getName();
  const isHouse = name.startsWith('Cube.');
  const isFoliage = name.startsWith('Winter');
  for (const prim of mesh.listPrimitives()) {
    const idxAcc = prim.getIndices();
    const posAcc = prim.getAttribute('POSITION');
    const uvAcc = prim.getAttribute('TEXCOORD_0');
    const before = idxAcc.getCount() / 3;
    if (!isHouse && !isFoliage) {
      rows.push({ name, type: 'other', before: Math.round(before), after: Math.round(before), error: 0 });
      continue;
    }
    const targetTris = isHouse ? 450 : Math.round(before * 0.6);
    const targetIndices = Math.max(3, targetTris * 3);

    const indices = new Uint32Array(idxAcc.getArray());
    const positions = new Float32Array(posAcc.getArray());
    const uvs = uvAcc ? uvAcc.getArray() : null;
    const lock = new Uint8Array(positions.length / 3);
    if (uvs) {
      for (let i = 0; i < uvs.length / 2; i++) {
        const u = uvs[i * 2];
        const v = uvs[i * 2 + 1];
        if (u < 0.001 || u > 0.999 || v < 0.001 || v > 0.999) lock[i] = 1;
      }
    }

    const [dstIndices, error] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, lock, targetIndices, 1.0);
    const newAcc = doc.createAccessor().setArray(new Uint32Array(dstIndices));
    prim.setIndices(newAcc);
    compactPrimitive(prim);

    const afterIdx = prim.getIndices();
    const after = afterIdx.getCount() / 3;
    rows.push({ name, type: isHouse ? 'house' : 'foliage', before: Math.round(before), after: Math.round(after), target: targetTris, error });
  }
}

await io.write(output, doc);
console.log(JSON.stringify({ rows }, null, 2));
