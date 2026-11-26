import {Vector3} from 'three';
import {arc,cross,heading,unit,walk} from './planet-plan/sphere.ts';
import {GroundWorld} from './physics/world.ts';
import {BOARD_RADIUS,portPoint} from './ports.ts';
import {
  canWalkTutorialConnector,projectTutorialRoute,tutorialStationApproaches,
  TUTORIAL_NAVIGATION_BUDGET,walkableTutorialConnection,
} from './tutorial-navigation.ts';
import {normalize,type Vec3} from './world.ts';
import {courtyardTarget} from './world-guide.ts';
import type {HomeSurfaceRoute} from './home-layout.ts';
import type {PlanetView} from './planets.ts';

export function courtyardRoutes(planet:PlanetView): readonly HomeSurfaceRoute[] {
  const routes=planet.homeManifest?.routes??[];
  return planet.courtyardArrival?[...routes,planet.courtyardArrival]:routes;
}

function landmarkBeside(route:HomeSurfaceRoute,routes:readonly HomeSurfaceRoute[],world:GroundWorld) {
  const centre=route.points.at(-1)!, toward=route.points.at(-2)!, radius=world.baseRadius;
  const entry=heading(centre,toward), right=unit(cross(centre,entry));
  const eyes=[toward,centre].map(point=>new Vector3(...point).multiplyScalar(world.pose(point).radius+1.35));
  for(const offset of [1.55,.9,0,-.8]){
    const approachSide=walk(centre,entry,offset,radius);
    for(const side of [1.85,-1.85,2.45,-2.45]){
      const position=walk(approachSide,right,side,radius);
      if(routes.some(lane=>(projectTutorialRoute(lane.points,position,radius)?.distance??Infinity)<lane.width/2+.72))continue;
      const feet=world.pose(position);
      if(world.blocked(feet))continue;
      const board=new Vector3(...position).multiplyScalar(feet.radius+1.12);
      if(eyes.some(eye=>world.cameraDistance(eye,board,.08)+.10<eye.distanceTo(board)))continue;
      const face=new Vector3(...heading(position,toward)).add(new Vector3(...heading(position,centre))).normalize();
      return {position,toward:walk(position,face.toArray(),1,radius)};
    }
  }
  return null;
}

type CourtyardVisit = {
  target:NonNullable<ReturnType<typeof courtyardTarget>>;
  landmark:ReturnType<typeof landmarkBeside>;
};
const visits=new WeakMap<GroundWorld,CourtyardVisit|null>();

export function courtyardVisit(planet:PlanetView,world:GroundWorld):CourtyardVisit|null {
  if(planet.mine||world.planetId!==planet.id||world.revision!==planet.revision)return null;
  const known=visits.get(world);
  if(known!==undefined)return known;
  const target=courtyardTarget(planet), routes=courtyardRoutes(planet);
  const route=routes.find(lane=>lane.id===target?.routeId);
  let visit:CourtyardVisit|null=null;
  if(target&&route){
    const landmark=landmarkBeside(route,routes,world);
    // A later layout can obstruct the saved route. Both visitor cues then
    // wait for a clear route and sign site, without erasing the owner's point.
    if(!planet.courtyardArrival||(landmark&&route.points.every((point,i)=>
      !i||canWalkTutorialConnector(world,route.points[i-1],point))))visit={target,landmark};
  }
  visits.set(world,visit);
  return visit;
}

export function courtyardLandmark(planet:PlanetView,world:GroundWorld) {
  return courtyardVisit(planet,world)?.landmark??null;
}

export function planCourtyardArrival(planet:PlanetView,world:GroundWorld,input:Vec3,door?:Vec3):{route:HomeSurfaceRoute}|{problem:string} {
  if(planet.objects.some(o=>o.kind==='structure'&&!planet.blueprints?.[o.blueprintHash??'']?.length))
    return {problem:'The current layout is incomplete. Reload before choosing an arrival point.'};
  const radius=world.baseRadius;
  const dock=portPoint(planet.id), position=normalize(input);
  if(arc(dock,position,radius)<BOARD_RADIUS+.6||(door&&arc(door,position,radius)<1.25)||world.blocked(world.pose(position)))
    return {problem:'Choose clear outdoor ground away from the dock and home entrance.'};
  const approaches=tutorialStationApproaches(planet), routes=planet.homeManifest?.routes??[];
  const segmentCount=routes.reduce((sum,route)=>sum+Math.max(0,route.points.length-1),0);
  if(segmentCount+3>TUTORIAL_NAVIGATION_BUDGET.homeSegments)
    return {problem:'No clear walking route from the dock. Choose a spot closer to the paths.'};

  // Try the dock first, then short connections off the nearest authored
  // lanes. Replay their prefixes as well because owners can move obstacles.
  const connect=(from:Vec3,to:Vec3)=>walkableTutorialConnection(world,from,to,approaches);
  const direct=connect(dock,position);
  const prefixes=routes.flatMap(route=>route.points.slice(1).map((point,i)=>({
    points:route.points.slice(0,i+2), distance:arc(point,position,radius),
  }))).sort((a,b)=>a.distance-b.distance).slice(0,8);
  const points=direct??(() => {
    for(const {points} of prefixes){
      const last=connect(points.at(-1)!,position);
      if(!last||!points.every((point,i)=>!i||canWalkTutorialConnector(world,points[i-1],point)))continue;
      const first=connect(dock,points[0]);
      if(first)return [...first,...points.slice(1),...last.slice(1)];
    }
    return null;
  })();
  if(!points)return {problem:'No clear walking route from the dock. Choose a spot closer to the paths.'};
  const route={id:'public-courtyard-arrival',width:.8,points:[...points.slice(0,-1).filter((point,i)=>
    !i||arc(point,points[i-1],radius)>.012).filter(point=>arc(point,position,radius)>.012),position]};
  if(segmentCount+route.points.length-1>TUTORIAL_NAVIGATION_BUDGET.homeSegments
    ||!route.points.every((point,i)=>!i||canWalkTutorialConnector(world,route.points[i-1],point)))
    return {problem:'No clear walking route from the dock. Choose a spot closer to the paths.'};
  if(!landmarkBeside(route,[...routes,route],world))
    return {problem:'Leave room for the courtyard landmark beside the walking route.'};
  return {route};
}
