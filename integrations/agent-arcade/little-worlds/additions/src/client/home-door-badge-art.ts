import { SIGNBOARD, signBlankVillage } from '../assets/claude-geometry/blueprint/parts/home/fixtures.ts';
import { extrudeZY } from '../assets/claude-geometry/blueprint/parts/kit.ts';
import type { Kit, KitMaterial } from '../assets/claude-geometry/blueprint/parts/kit.ts';
import type { HomeDoorBadge } from '../shared/home-door-badge.ts';

type Mark = { material: KitMaterial; profile: [number, number][]; layer?: 2 | 3 };

// The branch reads diagonally even as the small leaf tips merge at walking distance.
const leaves: Mark[] = [
  { material: 'post', profile: [[-.075,-.077],[-.087,-.064],[.046,.065],[.055,.056],[-.015,-.017],[.049,-.032],[.045,-.044],[-.025,-.027]] },
  { material: 'leaf', layer: 2, profile: [[.018,.031],[.028,.060],[.049,.078],[.082,.079],[.080,.056],[.062,.035],[.040,.027]] },
  { material: 'leaf', layer: 2, profile: [[-.031,-.009],[-.055,.007],[-.073,.029],[-.077,.054],[-.048,.052],[-.024,.035],[-.020,.010]] },
  { material: 'leaf', layer: 2, profile: [[.003,-.027],[.029,-.014],[.062,-.014],[.088,-.032],[.066,-.053],[.039,-.057],[.015,-.046]] },
];

// Broad pages, a marked gutter and an asymmetric bookmark read as a book on either face.
const book: Mark[] = [
  { material: 'post', profile: [[-.099,-.052],[-.095,.061],[-.055,.072],[-.024,.063],[0,.048],[.024,.063],[.055,.072],[.095,.061],[.099,-.052],[.060,-.050],[.023,-.060],[0,-.071],[-.023,-.060],[-.060,-.050]] },
  { material: 'skin', layer: 2, profile: [[-.084,-.037],[-.081,.048],[-.055,.056],[-.034,.051],[-.008,.036],[-.008,-.049],[-.034,-.037],[-.057,-.033]] },
  { material: 'skin', layer: 2, profile: [[.084,-.037],[.081,.048],[.055,.056],[.034,.051],[.008,.036],[.008,-.049],[.034,-.037],[.057,-.033]] },
  { material: 'hazard', layer: 3, profile: [[.042,.050],[.061,.054],[.062,.001],[.053,.008],[.043,-.003]] },
];

export function emitHomeDoorBadge(kit: Kit, badge: HomeDoorBadge) {
  signBlankVillage(kit);
  const { t, panel, rim, z0, z1, y0, y1 } = SIGNBOARD;
  const z = (z0 + z1) / 2, y = (y0 + y1) / 2;
  const backing = kit.m(badge === 'leaf-branch' ? 'skin' : 'hazard');
  for (const side of [1, -1]) {
    kit.b.box(backing,
      [.001, y1 - y0 - 2 * rim, z0 - z1 - 2 * rim], { position: [side * (t + panel + .0005), y, z] }, 0);
  }
  const marks = badge === 'leaf-branch' ? leaves : book;
  for (const side of [1, -1]) for (const { material, profile, layer } of marks) {
    // Reorient the art for the second viewer without moving the timber or straps.
    const face = t + panel + .001 + (layer === 3 ? .007 : layer === 2 ? .004 : 0);
    const depth = layer === 3 ? .002 : layer === 2 ? .003 : .004;
    extrudeZY(kit, kit.m(material), profile.map(([u, v]) => [z - side * u, y + v]),
      side > 0 ? face : -face - depth, side > 0 ? face + depth : -face);
  }
}
