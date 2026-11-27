import * as T from 'three';
import type { CourtyardFlower as Flower } from '../shared/courtyard-plantings.ts';
import { flowerFoliage } from './nature-art.ts';
import { courtyardPetalMaterial } from './courtyard-petal-material.ts';

export function makeBouquet({main,accent}:{main:Flower;accent:Flower}) {
  const root=new T.Group();
  const tuck = (flower: Flower, x: number, y: number, z: number, width: number, height: number, tilt: number) => {
    const spray = new T.Group();
    for (const { geometry, material, texture } of flowerFoliage())
      spray.add(new T.Mesh(geometry, texture === 'flowers' ? courtyardPetalMaterial(flower, material) : material));
    spray.position.set(x, y, z);
    spray.scale.set(width, height, width);
    spray.rotation.set(.15, x < 0 ? .28 : -.24, tilt);
    root.add(spray);
  };
  tuck(main, 0, .055, .005, .34, .44, -.04);
  tuck(main, -.072, .065, -.028, .25, .36, .12);
  tuck(accent, .144, .040, .034, .26, .31, -.32);
  tuck(accent, -.144, .031, .09, .25, .30, .32);
  return root;
}
