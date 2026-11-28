import { mainPlanetNetwork } from './planet-plan/main-planet.ts';
import { cross, heading, walk } from './planet-plan/sphere.ts';
import { HUB_DOCK } from './ports.ts';

export function mainTownDockBoard(network = mainPlanetNetwork()) {
  const arrival = network.point('arrival');
  const ahead = walk(HUB_DOCK, heading(HUB_DOCK, arrival), 2.3, network.radius);
  return walk(ahead, cross(ahead, heading(ahead, arrival)), 1.63, network.radius);
}
