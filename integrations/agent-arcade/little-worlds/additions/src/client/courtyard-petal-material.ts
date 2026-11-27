import type { MeshStandardMaterial } from 'three';
import { markShared } from '../assets/claude-geometry/core/dispose.ts';
import type { CourtyardFlower } from '../shared/courtyard-plantings.ts';
import { applyArtMaterial } from './art-profile.ts';

const materials: Record<CourtyardFlower, WeakMap<MeshStandardMaterial, MeshStandardMaterial>> = {
  coral: new WeakMap(), gold: new WeakMap(),
};

/** Use the same Quaternius petal tint in the outdoor bed and the hand-held flowers. */
export function courtyardPetalMaterial(flower: CourtyardFlower, stock: MeshStandardMaterial) {
  const existing = materials[flower].get(stock);
  if (existing) return existing;
  const material = stock.clone();
  material.userData = {};
  markShared(applyArtMaterial(material));
  material.alphaToCoverage = false;
  const prepare = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => key + ':bouquet:' + flower;
  const shades = flower === 'gold'
    ? ['vec3(.68,.26,.012)', 'vec3(1.0,.83,.10)']
    : ['vec3(.57,.022,.095)', 'vec3(1.0,.24,.39)'];
  material.onBeforeCompile = (shader, renderer) => {
    prepare.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float tone = dot(diffuseColor.rgb, vec3(.29,.58,.13));
      diffuseColor.rgb = mix(${shades[0]}, ${shades[1]}, smoothstep(.02,.8,tone));`);
  };
  materials[flower].set(stock, material);
  return material;
}
