import type {PlacedObject,PlanetView} from '../shared/planets.ts';
import {GroundWorld} from '../shared/physics/world.ts';
import {courtyardTarget} from '../shared/world-guide.ts';
import {normalize} from '../shared/world.ts';
import {courtyardLandmark} from './village-polish.ts';

export function courtyardPlacementImpact(planet:PlanetView, draft:Pick<PlacedObject,'id'|'kind'|'rotation'|'version'|'position'>, syncing:boolean) {
  const manifest=planet.homeManifest;
  if(draft.kind!=='structure'||draft.id===(manifest?.homeBuildingId??planet.home?.buildingId))return null;
  const unknown='The effect on the courtyard guide and landmark is unknown.';
  if(!manifest?.routes?.length||!manifest.objects?.length)return unknown;

  const original=manifest.objects.find(object=>object.id===draft.id);
  if(!original||original.kind!=='structure')return null;
  const saved=planet.objects.find(object=>object.id===draft.id);
  if(!saved||!original.blueprintHash||!planet.blueprints?.[original.blueprintHash]?.length)return unknown;
  const visitorPlanet={...planet,mine:false};
  // Recognize the authored square even if it was moved in an earlier edit.
  const authored={...saved,position:original.position,rotation:original.rotation,blueprintHash:original.blueprintHash};
  if(!courtyardTarget({...visitorPlanet,objects:[authored]}))return null;
  if(!syncing||saved.version!==draft.version
    ||planet.objects.some(o=>o.kind==='structure'&&!planet.blueprints?.[o.blueprintHash??'']?.length))return unknown;

  const position=normalize(draft.position);
  // objects/update keeps the original stored transform for a no-op.
  const unchanged=Math.abs(saved.rotation-draft.rotation)<1e-8
    && saved.position.every((value,i)=>Math.abs(value-position[i])<1e-8);
  const objects=unchanged?planet.objects:planet.objects.map(object=>
    object.id===saved.id?{...object,position,rotation:draft.rotation}:object);
  const next={...visitorPlanet,objects};
  if(!courtyardTarget(next))return 'With this layout, visitors will not see the courtyard guide or landmark.';
  if(!courtyardLandmark(next,new GroundWorld(next)))return 'The courtyard guide will be available, but the landmark has no clear spot.';
  return 'The courtyard guide and landmark will be available to visitors.';
}
