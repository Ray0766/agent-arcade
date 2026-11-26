import { expect, it } from 'vitest';
import { Group } from 'three';
import { courtyardLandmark, createVillagePolish } from '../src/client/village-polish.ts';
import { generateHomeManifest, homeManifestScene } from '../src/shared/home-generation.ts';
import { GroundWorld } from '../src/shared/physics/world.ts';
import type { HomeDescriptor } from '../src/shared/home.ts';
import type { PlanetView } from '../src/shared/planets.ts';
import { projectTutorialRoute } from '../src/shared/tutorial-navigation.ts';
import { courtyardTarget } from '../src/shared/world-guide.ts';

it.each([0, 4])('places one clear sign by the guide destination in garden layout %i', seed => {
  const radius = 21.6, manifest = generateHomeManifest(radius, seed), scene = homeManifestScene(manifest);
  const planet: PlanetView = { ...scene, id: 'friend', name: 'Friend', kind: 'garden', mine: false, radius, revision: 1,
    claimed: true, objectCount: scene.objects.length, center: [0,0,0], slot: 1,
    environment: manifest.environment,
    homeManifest: { ...manifest, radius, homeBuildingId: 'generated-structure-0', objects: scene.objects } };
  const world = new GroundWorld(planet);
  const destination = courtyardTarget(planet);
  expect(destination?.kind).toBe('courtyard');
  const marker = courtyardLandmark(planet, world)!;
  expect(marker).toBeTruthy();
  expect(world.blocked(world.pose(marker.position))).toBe(false);
  for (const lane of manifest.routes) {
    expect(projectTutorialRoute(lane.points, marker.position, radius)!.distance).toBeGreaterThan(lane.width / 2 + .71);
  }
  const movedSquare = 'generated-structure-3';
  const objects = planet.objects.map(object => object.id === movedSquare
    ? { ...object, position: [1, 0, 0] as [number, number, number] } : object);
  expect(courtyardLandmark({ ...planet, objects }, world)).toBeNull();
  expect(courtyardLandmark({ ...planet, homeManifest: undefined }, world)).toBeNull();

  const home = { planetId: planet.id, buildingId: 'house',
    door: { frame: { position: [0,radius,0], quaternion: [0,0,0,1] } } } as HomeDescriptor;
  const visual = createVillagePolish(new Group(), { surfacePoint: direction => direction.clone().multiplyScalar(radius) });
  const frame = { planetId: planet.id, radius, home, quality: 'standard' as const };
  try {
    visual.frame({ ...frame, courtyard: { planet, world } });
    expect(visual.diagnostics.sites).toBe(2);
    expect(visual.diagnostics.courtyardPosition).toEqual(marker.position);
    visual.frame(frame);
    expect(visual.diagnostics.sites).toBe(1);
    expect(visual.diagnostics.courtyardPosition).toBeNull();
  } finally {
    visual.dispose();
  }
});
