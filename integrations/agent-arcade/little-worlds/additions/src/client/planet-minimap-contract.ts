import { dot, frameAt, fromLocal, toLocal, unit } from '../shared/planet-plan/sphere.ts';
import { portPoint } from '../shared/ports.ts';
import type { GroundWorld } from '../shared/physics/world.ts';
import type { Vec3 } from '../shared/world.ts';

export type MinimapPoint = { readonly x: number; readonly y: number };
export interface MinimapProjection {
  project(direction: Vec3): MinimapPoint | null;
  unproject(point: MinimapPoint): Vec3 | null;
}
export interface MinimapTerrain {
  readonly planetId: string;
  readonly revision: number;
  readonly name: string;
  readonly radius: number;
  readonly projection: MinimapProjection;
  heightAt(point: MinimapPoint): number | null;
}
export interface PlanetMinimapFrame {
  readonly terrain: MinimapTerrain;
  readonly player: MinimapPoint;
  readonly canRouteToDock: boolean;
  readonly dock: MinimapPoint;
  readonly courtyard?: MinimapPoint;
}
export interface PlanetMinimap {
  frame(value: PlanetMinimapFrame | null): void;
  dispose(): void;
}
export interface PlanetMinimapOptions {
  onDock(): boolean;
  onCourtyard(): boolean;
}
export type CreatePlanetMinimap = (options: PlanetMinimapOptions) => PlanetMinimap;

/** Dock-centred azimuthal distances in metres. Positive screen Y points south. */
export function createMinimapProjection(dock: Vec3, radius: number): MinimapProjection {
  const origin = unit(dock), basis = frameAt(origin), limit = Math.PI * radius * (1 - 1e-6);
  return {
    project(direction) {
      if (!direction.every(Number.isFinite) || Math.hypot(...direction) === 0) return null;
      const normal = unit(direction);
      if (dot(origin, normal) <= Math.cos(limit / radius)) return null;
      const [x, north] = toLocal(origin, normal, radius, basis);
      return { x, y: -north };
    },
    unproject({ x, y }) {
      return Math.hypot(x, y) < limit ? fromLocal(origin, [x, -y], radius, basis) : null;
    },
  };
}

const terrains = new WeakMap<GroundWorld, MinimapTerrain>();

export function planetMinimapTerrain(world: GroundWorld, name: string): MinimapTerrain {
  const cached = terrains.get(world);
  if (cached?.name === name) return cached;
  const projection = createMinimapProjection(portPoint(world.planetId), world.baseRadius);
  const terrain: MinimapTerrain = {
    planetId: world.planetId,
    revision: world.revision,
    radius: world.baseRadius,
    name,
    projection,
    heightAt(point) {
      const direction = projection.unproject(point);
      return direction ? world.radius(direction) - world.baseRadius : null;
    },
  };
  terrains.set(world, terrain);
  return terrain;
}
