import type * as T from 'three';

export function alignVisitorHandProp(mount: T.Object3D, root: T.Object3D, parcel: T.Object3D, inverse: T.Quaternion) {
  parcel.localToWorld(mount.position.set(0, .025, .07));
  root.worldToLocal(mount.position);
  root.getWorldQuaternion(inverse).invert();
  parcel.getWorldQuaternion(mount.quaternion).premultiply(inverse);
}
