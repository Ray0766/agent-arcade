import { Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { partTransform, pivotOf, type PartPlacement } from '../shared/blueprint-model.ts';
import { courtyardBedFlowers, type CourtyardBedPalette, type CourtyardPlanting } from '../shared/courtyard-plantings.ts';
import { courtyardFoliage, flowerFoliage } from './nature-art.ts';

import type { TownCameraCutaway } from './camera-cutaway.ts';
import { courtyardPetalMaterial } from './courtyard-petal-material.ts';

type BedPetal = { mesh: Mesh; original: MeshStandardMaterial; stock: MeshStandardMaterial; accent: boolean; petal: boolean };
const bedPetals = new WeakMap<Object3D, BedPetal[]>();

export function setCourtyardBedPalette(
  root: Object3D, palette: CourtyardBedPalette = 'original', cutaway?: TownCameraCutaway,
) {
  const flowers = courtyardBedFlowers(palette);
  for (const { mesh, original, stock, accent, petal } of bedPetals.get(root) ?? []) {
    cutaway?.unregisterMesh(mesh);
    mesh.material = palette === 'original' ? original :
      petal ? courtyardPetalMaterial(accent ? flowers.accent : flowers.main, stock) : stock;
    cutaway?.registerMesh(mesh, { staticGeometry: true });
  }
}
export function addCourtyardPlantingArt(root: Object3D, kind: CourtyardPlanting, parts: readonly PartPlacement[], palette?: CourtyardBedPalette) {
  const leaves: BedPetal[] = [];
  const stock=kind==='bed'?flowerFoliage():[];
  const pivot = pivotOf(parts);
  for (const part of parts) {
    const { position: [x, y, z] } = partTransform(part, pivot);
    if (kind === 'golden-tree' && part.part === 'garden.tree') {
      const tree = courtyardFoliage('tree', true);
      tree.position.set(x, y, z);
      tree.scale.set(1.07, 2.12, 1);
      const crown = courtyardFoliage('bush', true);
      crown.position.set(x, y + 1.15, z);
      crown.scale.set(.60, .91, .46);
      root.add(tree, crown);
    }
    if (kind !== 'bed' || part.part !== 'garden.bed') continue;
    const clusters = [[-.19,.03,.13], [.17,.13,.34], [.18,-.17,.21], [-.13,-.18,.42], [.01,.15,.51]];
    clusters.forEach(([dx, dz, turn], index) => {
      const group = courtyardFoliage('flowers', (part.n + index) % 3 !== 0);
      group.children.forEach((mesh, i) => {
        if (mesh instanceof Mesh && mesh.material instanceof MeshStandardMaterial && stock[i]) {
          leaves.push({ mesh, original: mesh.material, stock: stock[i].material,
            accent: (index + part.n) % 3 === 0, petal: stock[i].texture === 'flowers' });
        }
      });
      group.position.set(x + dx, y + .26, z + dz);
      group.rotation.y = turn * Math.PI * 2;
      group.scale.set(.33, .25, .32);
      root.add(group);
    });
  }
  if(leaves.length){bedPetals.set(root,leaves);setCourtyardBedPalette(root,palette);}
}
