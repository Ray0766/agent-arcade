import type * as T from 'three';
import { anchorQuaternion } from '../assets/claude-geometry/core/anchor.ts';
import { BUDGET } from '../assets/claude-geometry/style/lod.ts';
import { StyleLibrary } from '../assets/claude-geometry/style/materials.ts';
import { pivotOf } from '../shared/blueprint-model.ts';
import { districtHome } from '../shared/district-layout.ts';
import type { OrbitFriendHome } from '../shared/friend-home-orbit.ts';
import { homeVariant, type HomeVariant } from '../shared/home-layout.ts';
import type { Vec3 } from '../shared/world.ts';
import { buildCameraBlueprintModel } from './camera-blueprint-model.ts';
import { yieldSceneFrame } from './loading-state.ts';

interface OrbitHomeView {
  readonly planetRoot: T.Group;
  readonly detailRoot: T.Group | null;
  readonly shipPosition: Readonly<Vec3>;
  readonly scene: T.Scene;
  readonly camera: T.Camera;
}

const HOME_VIEW_DISTANCE = 60;
const lowBuildingBudget = BUDGET.building.low;
const homeVariants: Record<OrbitFriendHome['variant'], HomeVariant> = {
  base: 'starter', terrace: 'terrace', roof: 'roof', extended: 'extension', custom: 'starter',
};

function buildOrbitHome(appearance: OrbitFriendHome) {
  // As in the orbital town, low geometry keeps the ground palette.
  const variant = homeVariants[appearance.variant];
  const blueprint = appearance.kit === 'district'
    ? districtHome(variant, appearance.mirrored) : homeVariant(variant);
  const shell = blueprint.parts.filter(({ part }) =>
    /^(roof|wall|floor|structure|step|rail)\./.test(part));
  const library = new StyleLibrary('medium', { look: 'village' });
  try {
    const model = buildCameraBlueprintModel(shell, library, 'low', {
      sockets: false,
      pivot: pivotOf(blueprint.parts),
      roofFinish: appearance.roofFinish ?? undefined,
    });
    const dispose = () => {
      model.object.removeFromParent();
      try { model.dispose(); }
      finally { library.dispose(); }
    };
    if (model.triangles > lowBuildingBudget.triangles || model.drawCalls > lowBuildingBudget.drawCalls) {
      dispose();
      return null;
    }
    model.object.name = 'orbit-friend-home';
    model.object.position.fromArray(appearance.position).multiplyScalar(appearance.baseRadius);
    model.object.quaternion.fromArray(anchorQuaternion({ dir: appearance.position, yaw: appearance.rotation }));
    return { object: model.object, dispose };
  } catch (error) {
    library.dispose();
    throw error;
  }
}

function sameAppearance(a: OrbitFriendHome, b: OrbitFriendHome) {
  return a === b || (a.variant === b.variant && a.kit === b.kit && a.mirrored === b.mirrored
    && a.baseRadius === b.baseRadius && a.rotation === b.rotation && a.roofFinish === b.roofFinish
    && a.position.every((axis, index) => axis === b.position[index]));
}

type OrbitHomeModel = NonNullable<ReturnType<typeof buildOrbitHome>>;

function inViewRange(view: OrbitHomeView, appearance: OrbitFriendHome) {
  const center = view.planetRoot.position, ship = view.shipPosition, pos = appearance.position;
  return (center.x + pos[0] * appearance.baseRadius - ship[0]) ** 2 + (center.y + pos[1] * appearance.baseRadius - ship[1]) ** 2
    + (center.z + pos[2] * appearance.baseRadius - ship[2]) ** 2 <= HOME_VIEW_DISTANCE ** 2;
}

/** One owned exterior for the active, verified flight. It never enters the atlas cache. */
export function createOrbitFriendHome(renderer: Pick<T.WebGLRenderer, 'compileAsync'>) {
  let requested: {view: OrbitHomeView; appearance: OrbitFriendHome; controller: AbortController} | null = null;
  let mounted: OrbitHomeModel | null = null;
  let queued = false;

  function clear() {
    requested?.controller.abort();
    requested = null;
    mounted?.dispose();
    mounted = null;
  }

  async function prepare() {
    if (queued || !requested) return;
    queued = true;
    const task = requested, { signal } = task.controller;
    let model: OrbitHomeModel | null = null;
    try {
      await yieldSceneFrame(signal);
      if (signal.aborted) return;
      model = buildOrbitHome(task.appearance);
      if (!model) return;
      const { scene, camera } = task.view;
      await renderer.compileAsync(model.object, camera, scene);
      if (signal.aborted) return;
      task.view.planetRoot.add(model.object);
      mounted = model;
      model = null;
    } catch (error) {
      if (!signal.aborted) console.warn('Could not prepare friend home in orbit', error);
    } finally {
      model?.dispose();
      queued = false;
      if (requested !== task) void prepare();
    }
  }

  function frame(view: OrbitHomeView | null, appearance: OrbitFriendHome | null) {
    if (!view?.detailRoot || !appearance || !inViewRange(view, appearance)) {
      clear();
      return;
    }
    if (requested && sameAppearance(requested.appearance, appearance) && requested.view.detailRoot === view.detailRoot
      && requested.view.planetRoot === view.planetRoot) return;
    clear();
    requested = { view, appearance, controller: new AbortController() };
    void prepare();
  }

  return { frame, clear };
}
