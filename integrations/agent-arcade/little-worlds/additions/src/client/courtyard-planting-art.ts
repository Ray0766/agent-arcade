import type { Object3D } from 'three';
import { partTransform, pivotOf, type PartPlacement } from '../shared/blueprint-model.ts';
import type { CourtyardPlanting } from '../shared/courtyard-plantings.ts';
import { courtyardFoliage } from './nature-art.ts';

export function addCourtyardPlantingArt(root: Object3D, kind: CourtyardPlanting, parts: readonly PartPlacement[]) {
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
      group.position.set(x + dx, y + .26, z + dz);
      group.rotation.y = turn * Math.PI * 2;
      group.scale.set(.33, .25, .32);
      root.add(group);
    });
  }
}
