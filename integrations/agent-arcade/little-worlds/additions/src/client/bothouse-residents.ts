import * as T from 'three';
import { canBoard, portPoint } from '../shared/ports.ts';
import { GroundWorld } from '../shared/physics/world.ts';
import { TownResidentMotion } from '../shared/town-resident-motion.ts';
import type { Vec3 } from '../shared/world.ts';
import type { PlanetView } from '../shared/planets.ts';
import type { PlanetResident } from '../shared/planet-residents.ts';
import { residentPortrait } from '../shared/resident-portrait.ts';
import { createBothouseResidentModel } from './bothouse-resident-model.ts';
import { ResidentBodySettings } from './resident-body-settings.ts';
import { landingSites, nearbyDoorstepFlower, residentWalkEnd } from './bothouse-resident-sites.ts';
import { planResidentBench, type ResidentBenchPlan } from './resident-bench-rest.ts';
import { distance } from '../shared/world.ts';
import type { ResidentGuideEntry } from './resident-guide-target.ts';

type Resident = PlanetResident & Parameters<typeof residentPortrait>[1];
type Portrait = ReturnType<typeof residentPortrait>;
const actions = {
  idle:['Idle','休息中'], thinking:['Thinking','思考中'], working:['Working','工作中'],
  talking:['Talking','说话中'], waiting:['Waiting','等待中'], offline:['Offline','离线'],
  unknown:['Status unknown','状态未知'],
} as const;
const zh=()=>document.documentElement.lang.startsWith('zh');
const noObjects:PlanetView['objects']=[];
const WAVE_MS = 1800;
const GREETING_REACH = 2.6;
const BENCH_REST_SECONDS = 4.2;
type BenchModels = { usedByPlayer?: string; getModel(id: string): T.Object3D | undefined };

class ResidentFigure {
  readonly model: ReturnType<typeof createBothouseResidentModel>;
  readonly motion: TownResidentMotion;
  readonly card = document.createElement('span');
  // The ink pass uses scene depth. Write the card's depth so a background
  // outline cannot cut through the text, while walls still occlude the card.
  private label = new T.Sprite(new T.SpriteMaterial({transparent:true,alphaTest:.02,toneMapped:false}));
  private photoName?: {name:string;sprite:T.Sprite};
  private up=new T.Vector3();
  private forward=new T.Vector3();
  private right=new T.Vector3();
  private basis=new T.Matrix4();
  private turn=new T.Quaternion();
  private readonly dockFacing: T.Vector3;
  private phase:number;
  private elapsed=0;
  private flowerPause=0;
  private nextFlowerPause=1.2;
  private nextBenchPause=4;
  private bench: { plan: ResidentBenchPlan; started: number; sat?: number } | null = null;
  get restBenchId() { return this.bench?.plan.id; }
  get benchPose() { return this.bench ? this.bench.sat === undefined ? 'approaching' : 'seated' : 'standing'; }
  private waveStart=-Infinity;
  private step=0;
  private badge?:T.Texture;
  private portrait:Portrait;
  private image?:HTMLImageElement;
  private disposed=false;
  private lastText='';
  private text=document.createElement('span');

  constructor(scene:T.Scene, private readonly world:GroundWorld, public role:Resident, readonly slot:number,
    feet:T.Vector3, readonly key:string, portrait:Portrait, readonly flower:Vec3|undefined) {
    this.model=createBothouseResidentModel(key);
    this.model.animate(role.activity,0,true);
    const start=feet.clone().normalize(), pad=portPoint(world.planetId);
    this.dockFacing=new T.Vector3(...pad);
    const end=residentWalkEnd(start,this.dockFacing,world.baseRadius).toArray() as Vec3;
    this.phase=slot*.75;
    this.motion=new TownResidentMotion(world,{position:start.toArray() as Vec3,facing:pad,
      route:[start.toArray() as Vec3,end],activity:'walk',phase:this.phase,speed:.55});
    this.label.scale.set(1.38,.33,1);
    scene.add(this.model.root,this.label);
    this.align(true,0);
    this.model.root.visible=this.label.visible=this.motion.valid;
    this.card.append(this.text);
    this.update(role,portrait);
  }
  private setPortrait(portrait:Portrait) {
    if(this.portrait?.url===portrait?.url){this.portrait=portrait;return;}
    this.portrait=portrait;
    this.model.setBadge(null);this.badge?.dispose();this.badge=undefined;
    this.image?.remove();this.image=undefined;
    if(portrait){
      const img=this.image=document.createElement('img');
      img.width=32;img.height=32;img.alt='';img.style.verticalAlign='middle';img.style.objectFit='contain';
      img.addEventListener('error',()=>img.hidden=true,{once:true});
      img.addEventListener('load',()=>{
        if(this.disposed||this.image!==img)return;
        const texture=new T.Texture(img);texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;
        this.badge=texture;this.model.setBadge(texture);
      },{once:true});
      img.src=portrait.url;
      this.card.prepend(img);
    }
  }
  update(role:Resident,portrait:Portrait) {
    this.setPortrait(portrait);
    const changed = role.activity !== this.role.activity;
    this.role=role;
    if(role.activity!=='idle'){
      this.waveStart=-Infinity;
      this.flowerPause=0;
      if(this.bench){this.finishBench();this.align(true,0);}
    }
    if(changed)this.model.animate(role.activity,0,true);
    const activity=actions[role.activity][zh()?1:0], title=role.displayName+' · '+activity;
    this.text.textContent=title+(portrait?' ('+portrait.credit+')':'');
    if(this.lastText===title)return;
    this.lastText=title;
    const canvas=document.createElement('canvas');canvas.width=480;canvas.height=112;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='rgba(26,46,49,.92)';ctx.beginPath();ctx.roundRect(0,0,480,112,24);ctx.fill();
    ctx.fillStyle='#fff';ctx.textAlign='center';ctx.font='600 37px system-ui';
    ctx.fillText(role.displayName,240,47,452);ctx.fillStyle='#ceeddf';ctx.font='31px system-ui';
    ctx.fillText(activity,240,93,452);
    this.label.material.map?.dispose();
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    this.label.material.map=texture;this.label.material.needsUpdate=true;
  }
  private align(initial:boolean,dt:number,target?:Vec3) {
    const {motion,model}=this;
    this.up.fromArray(motion.pose.position);
    this.forward.fromArray(motion.heading).projectOnPlane(this.up).normalize();
    if(this.role.activity==='working'){
      // Keep the safe foot position and angle the ledger toward the dock-side path.
      this.forward.copy(this.dockFacing).projectOnPlane(this.up).normalize().applyAxisAngle(this.up,.36);
    }else if(target){
      this.forward.fromArray(target).projectOnPlane(this.up).normalize();
    }
    this.right.crossVectors(this.up,this.forward).normalize();
    this.forward.crossVectors(this.right,this.up).normalize();
    this.turn.setFromRotationMatrix(this.basis.makeBasis(this.right,this.up,this.forward));
    if(initial)model.root.quaternion.copy(this.turn);
    else model.root.quaternion.rotateTowards(this.turn,dt*2.7);
    model.root.position.copy(this.up).multiplyScalar(motion.pose.radius);
    this.label.position.copy(this.up).multiplyScalar(motion.pose.radius+1.99);
  }
  greet(now:number) {
    this.waveStart=now;
    this.flowerPause=0;
    if(this.bench)this.finishBench();
  }
  stopGreeting() { this.waveStart = -Infinity; }
  canGreet(now:number) { return this.role.activity === 'idle' && now - this.waveStart >= WAVE_MS; }
  private finishBench() {
    this.bench=null;
    this.motion.blockedSeconds=0;
    this.nextBenchPause=this.elapsed+14;
  }
  private benchFrame(allowed:boolean, findBench:()=>ResidentBenchPlan|null, getModel:(id:string)=>T.Object3D|undefined) {
    if(this.bench && (!allowed || getModel(this.bench.plan.id)!==this.bench.plan.model || this.world.blocked(this.motion.pose))) {
      this.finishBench();
    }
    if(!allowed)return 0;
    if(!this.bench && !this.flowerPause && this.elapsed>=this.nextBenchPause){
      this.nextBenchPause=this.elapsed+7;
      const plan=findBench();
      if(plan)this.bench={plan,started:this.elapsed};
    }
    const bench=this.bench;
    if(!bench)return 0;
    if(bench.sat===undefined){
      if(distance(this.motion.pose.position,bench.plan.approach,this.world.baseRadius)<.12 && this.motion.pose.grounded) bench.sat=this.elapsed;
      else if(this.elapsed-bench.started>=9) this.finishBench();
      return 0;
    }
    const duration=this.elapsed-bench.sat;
    if(duration>=BENCH_REST_SECONDS){this.finishBench();return 0;}
    return T.MathUtils.smoothstep(Math.min(duration,BENCH_REST_SECONDS-duration),0,.32);
  }
  frame(dt:number,reduced:boolean,viewer:Vec3,neighbours:Vec3[],now:number,findBench:()=>ResidentBenchPlan|null,getModel:(id:string)=>T.Object3D|undefined) {
    if(!this.motion.valid)return;
    const activity=this.role.activity, live=activity!=='offline'&&activity!=='unknown';
    const wave=(now-this.waveStart)/WAVE_MS;
    const greeting=wave<1&&!reduced&&activity==='idle';
    if(!reduced&&live)this.elapsed+=dt;
    const sitting=this.benchFrame(!reduced&&!greeting&&activity==='idle',findBench,getModel);
    if(!reduced&&activity==='idle'&&!greeting&&!this.bench&&this.flower){
      if(this.flowerPause>0)this.flowerPause=Math.max(0,this.flowerPause-dt);
      else if(this.elapsed>=this.nextFlowerPause){
        this.flowerPause=2.6;
        this.nextFlowerPause=this.elapsed+15;
      }
    }
    const looking=!greeting&&!reduced&&activity==='idle'&&this.flowerPause>0;
    // A short walk between rests uses the same capsule, slope and neighbour checks as town residents.
    if(!reduced&&activity==='idle'&&!looking&&!greeting&&this.bench?.sat===undefined){
      this.step+=dt;
      if(this.step>=.05){this.motion.tick(this.step,viewer,neighbours,this.bench?.plan.approach);this.step=0;}
    }else{this.motion.moving=false;this.step=0;}
    this.align(reduced&&live,live&&!reduced?dt:0,greeting?viewer:looking?this.flower:undefined);
    if(sitting&&this.bench){
      this.model.root.position.lerp(this.bench.plan.seat.position,sitting);
      this.model.root.quaternion.slerp(this.bench.plan.seat.rotation,sitting);
      this.label.position.copy(this.model.root.position).addScaledVector(this.up,1.99);
    }
    const lean=looking?T.MathUtils.smoothstep(Math.min(this.flowerPause,2.6-this.flowerPause),0,.5):0;
    this.model.animate(activity,this.elapsed+this.phase,reduced||!live,Number(this.motion.moving),greeting?wave:0,lean,sitting);
  }
  findBench(models:ReadonlyMap<string,T.Object3D>) {return planResidentBench(this.world,this.motion.pose,models);}
  private photoNameSprite() {
    const name=this.role.displayName;
    if(this.photoName?.name===name)return this.photoName.sprite;
    this.disposePhotoName();
    const canvas=document.createElement('canvas'), context=canvas.getContext('2d')!;
    const font='600 54px system-ui', padding=18, maxTextWidth=320;
    context.font=font;
    let text=name;
    if(context.measureText(text).width>maxTextWidth){
      text='';
      for(const {segment} of new Intl.Segmenter().segment(name)){
        if(context.measureText(text+segment+'…').width>maxTextWidth)break;
        text+=segment;
      }
      text+='…';
    }
    canvas.width=Math.ceil(context.measureText(text).width)+padding*2;
    canvas.height=80;
    context.font=font;context.textAlign='center';context.textBaseline='middle';
    context.fillStyle='rgba(26,46,49,.78)';
    context.beginPath();context.roundRect(0,0,canvas.width,canvas.height,24);context.fill();
    context.fillStyle='#fff';context.fillText(text,canvas.width/2,canvas.height/2);
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    const sprite=new T.Sprite(new T.SpriteMaterial({map:texture,transparent:true,alphaTest:.02,toneMapped:false}));
    const height=.125;
    sprite.scale.set(height*canvas.width/canvas.height,height,1);
    this.label.parent?.add(sprite);
    this.photoName={name,sprite};
    return sprite;
  }
  private disposePhotoName() {
    const sprite=this.photoName?.sprite;
    if(!sprite)return;
    sprite.removeFromParent();sprite.material.map?.dispose();sprite.material.dispose();
    this.photoName=undefined;
  }
  setVisible(visible:boolean,labelStyle:'exploration'|'photo'|'hidden') {
    this.model.root.visible=visible;
    this.label.visible=visible&&labelStyle==='exploration';
    if(this.photoName)this.photoName.sprite.visible=false;
    if(visible&&labelStyle==='photo'){
      const sprite=this.photoNameSprite();
      sprite.position.copy(this.label.position).addScaledVector(this.up,-.10);
      sprite.visible=true;
    }
  }
  dispose() {
    this.disposed=true;this.model.root.removeFromParent();this.model.dispose();this.badge?.dispose();
    this.label.removeFromParent();this.label.material.map?.dispose();this.label.material.dispose();
    this.disposePhotoName();
    this.card.remove();
  }
}

/** Fence every asynchronous roster read to its acknowledged outdoor visit. */
export class BothouseResidents {
  private visit='';private next=0;
  private readonly friendPlanet = new URLSearchParams(location.search).get('visit');
  private greetingTarget=this.friendPlanet;
  private visitorWorld: GroundWorld | null = null;
  private visitorAllowed = false;
  private friendVisitAllowed = false;
  private visitorGreeting: { figure: ResidentFigure; until: number } | null = null;
  private arrivalWorld:GroundWorld|null=null;
  private request:AbortController|null=null;
  private seats:T.Vector3[]=[];
  private center=new T.Vector3();
  private frustum=new T.Frustum();
  private projection=new T.Matrix4();
  private rosterSize:number|null=null;
  private publicRoster: Pick<PlanetResident, 'id' | 'displayName'>[] = [];
  private bounds=new T.Sphere(new T.Vector3(),1.5);
  private figures=new Map<string,ResidentFigure>();
  private benchIds: string[] = [];
  private summary=document.createElement('p');
  private settings=document.createElement('a');
  private bodySettings:ResidentBodySettings;
  private closure=document.createElement('aside');
  private closureText=document.createElement('p');
  private back=document.createElement('a');
  constructor(private scene:T.Scene,private reduced:boolean) {
    this.summary.className='presence-summary';this.summary.id='bothouse-residents';
    this.summary.dataset.i18nVerbatim='';this.summary.hidden=true;
    document.querySelector('#presence-summary')!.after(this.summary);
    this.closure.id='friend-visit-closure';this.closure.hidden=true;this.closure.dataset.i18nVerbatim='';
    this.closureText.setAttribute('role','status');
    this.back.href='/.well-known/agent-arcade-return-chat';this.back.className='quiet';
    this.back.hidden=new URLSearchParams(location.search).get('appReturn')!=='chat';
    this.closure.append(this.closureText,this.back);
    document.querySelector('.minimal-bar')!.after(this.closure);
    this.settings.href='/resident-settings';this.settings.className='quiet';this.settings.hidden=true;
    const actions=document.querySelector('#planet-card .planet-actions')!;
    actions.append(this.settings);
    this.bodySettings=new ResidentBodySettings(actions);
  }
  frame(world:GroundWorld|null,planet:string|null,epoch:number,now:number,owner:boolean,objects=noObjects) {
    this.arrivalWorld=!owner&&planet===this.greetingTarget?world:null;
    this.settings.hidden=!owner;
    const settingsText=zh()?'连接星球搭档':'Connect planet companions';
    if(owner&&this.settings.textContent!==settingsText)this.settings.textContent=settingsText;
    this.bodySettings.update(owner?planet:null);
    if(!this.closure.hidden){
      const welcome=document.querySelector('#welcome-panel[open] .welcome-card');
      const host=document.querySelector('.scene-loading-overlay[open]')??welcome??document.body;
      if(this.closure.parentElement!==host){
        if(host===welcome)host.prepend(this.closure);
        else host.append(this.closure);
      }
    }
    const visit=planet?planet+'/'+epoch+'/'+(world?.revision??'loading'):'';
    if(visit!==this.visit){
      this.visit=visit;this.request?.abort();this.request=null;this.clear();this.closure.hidden=true;this.next=0;
    }
    this.visitorWorld = !owner && planet === this.friendPlanet ? world : null;
    if (!this.visitorWorld) this.cancelVisitorGreeting();
    if(!planet||now<this.next||this.request)return;
    const request=this.request=new AbortController();
    void this.refresh(planet,world,request,objects);
  }
  private cancelVisitorGreeting() {
    this.visitorGreeting?.figure.stopGreeting();
    this.visitorGreeting = null;
  }
  occupiesBench(id: string) {
    for (const figure of this.figures.values()) {
      if (figure.restBenchId === id && figure.benchPose === 'seated') return true;
    }
    return false;
  }
  hasCurrentFriendVisit(world: GroundWorld, epoch: number) {
    return world === this.visitorWorld && this.friendVisitAllowed && this.closure.hidden
      && this.visit === world.planetId+'/'+epoch+'/'+world.revision;
  }
  hasApprovedVisit(world: GroundWorld) {
    return world === this.visitorWorld && this.visitorAllowed;
  }
  guideRoster(world: GroundWorld, epoch: number): ResidentGuideEntry[] {
    if (world !== this.visitorWorld || !this.friendVisitAllowed || !this.closure.hidden ||
        this.visit !== world.planetId+'/'+epoch+'/'+world.revision) return [];
    return this.publicRoster.map(({ id, displayName }) => {
      const motion = this.figures.get(id)?.motion;
      return { id, name: displayName, pose: motion?.valid ? motion.pose : null };
    });
  }
  private greetingDistance(figure: ResidentFigure, viewer: T.Vector3, camera: T.Camera) {
    const world = this.visitorWorld;
    if (!world || this.figures.get(figure.role.id) !== figure || !figure.model.root.visible || figure.role.activity !== 'idle') return Infinity;
    const direction = figure.motion.pose.position;
    const distance = viewer.angleTo(new T.Vector3(...direction)) * world.baseRadius;
    if (distance > GREETING_REACH) return Infinity;
    const target = new T.Vector3(...direction).multiplyScalar(figure.motion.pose.radius + .9);
    const viewerDirection = viewer.toArray() as Vec3;
    const support = world.support(viewerDirection, world.radius(viewerDirection) + .45);
    const eye = viewer.clone().multiplyScalar(support.radius + 1.1);
    for (const from of [eye, camera.position]) {
      if (world.cameraDistance(from, target, .06) + .05 < from.distanceTo(target)) return Infinity;
    }
    return distance;
  }
  greetingPrompt(viewer: T.Vector3, camera: T.Camera, allowed: boolean) {
    if (!allowed || !this.visitorWorld || !this.closure.hidden) {
      this.cancelVisitorGreeting();
      return null;
    }
    const now = performance.now();
    const greeting = this.visitorGreeting;
    if (greeting) {
      if (now < greeting.until && Number.isFinite(this.greetingDistance(greeting.figure, viewer, camera))) {
        return { id: greeting.figure.role.id, name: greeting.figure.role.displayName, greeted: true };
      }
      this.cancelVisitorGreeting();
    }
    let closest: ResidentFigure | undefined, range = Infinity;
    for (const figure of this.figures.values()) {
      if (!figure.canGreet(now)) continue;
      const distance = this.greetingDistance(figure, viewer, camera);
      if (distance < range) { closest = figure; range = distance; }
    }
    return closest ? { id: closest.role.id, name: closest.role.displayName, greeted: false } : null;
  }
  greetVisitor(id: string, viewer: T.Vector3, camera: T.Camera) {
    const prompt = this.greetingPrompt(viewer, camera, true);
    if (prompt?.id !== id || prompt.greeted) return;
    const figure = this.figures.get(id)!;
    const now = performance.now();
    if (!this.reduced) figure.greet(now);
    this.visitorGreeting = { figure, until: now + WAVE_MS };
  }
  animate(dt:number,viewer:Vec3,camera:T.Camera,enabled:boolean,labelStyle:'exploration'|'photo'|'hidden'='exploration',benches?:BenchModels) {
    if(!this.figures.size)return;
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const near:ResidentFigure[]=[];
    for(const f of this.figures.values()){
      const pose=f.motion.pose;
      this.center.fromArray(pose.position);
      this.bounds.center.copy(this.center).multiplyScalar(pose.radius+.9);
      const visible=f.motion.valid&&this.frustum.intersectsSphere(this.bounds)&&
        this.bounds.center.dot(camera.position)>=pose.radius**2-2.8*camera.position.length();
      f.setVisible(visible,labelStyle);
      if(enabled&&visible&&this.bounds.center.distanceTo(camera.position)<18)near.push(f);
    }
    const now=performance.now();
    if(this.arrivalWorld&&near.length){
      // Consume this arrival even if all the visible residents are busy.
      if(!this.reduced&&canBoard(this.arrivalWorld.planetId,viewer,this.arrivalWorld.baseRadius)){
        near.find(f=>f.role.activity==='idle')?.greet(now);
      }
      this.greetingTarget=null;
      this.arrivalWorld=null;
    }
    // Include neighbours just outside the camera, as well as those being animated.
    for(const f of near){
      const neighbours:Vec3[]=[];
      if(f.role.activity==='idle'&&!this.reduced){
        for(const other of this.figures.values())if(other!==f&&other.motion.valid)neighbours.push(other.motion.pose.position);
      }
      const getModel=(id:string)=>id===benches?.usedByPlayer?undefined:benches?.getModel(id);
      f.frame(dt,this.reduced,viewer,neighbours,now,()=>{
        const inUse=new Set(Array.from(this.figures.values(),other=>other.restBenchId));
        const available=new Map<string,T.Object3D>();
        for(const id of this.benchIds){
          const model=!inUse.has(id)&&getModel(id);
          if(model)available.set(id,model);
        }
        return f.findBench(available);
      },getModel);
    }
  }
  /** Opt-in frame evidence; uses the same transforms rendered in the game. */
  snapshot(camera:T.Camera) {
    return Array.from(this.figures.values(),f=>{
      const root=f.model.root;
      const center=root.position.clone().addScaledVector(new T.Vector3(...f.motion.pose.position),.8).project(camera);
      let meshes=0,sprites=0;
      root.traverse(node=>{if(node instanceof T.Mesh)meshes++;if(node instanceof T.Sprite)sprites++;});
      const badge=root.getObjectByName('public-portrait-badge') as T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>|undefined;
      const badgeImage=badge?.visible?badge.material.map?.image as HTMLImageElement|undefined:undefined;
      return {id:f.role.id,model:root.name,body:root.uuid,badge:badgeImage?.getAttribute('src')??null,look:f.key,activity:f.role.activity,position:root.position.toArray(),
        rotation:root.quaternion.toArray(),armAngle:root.getObjectByName('upper1')!.rotation.z,
        moving:f.motion.moving,meshes,sprites,center:center.toArray(),benchPose:f.benchPose,
        kneeAngle:root.getObjectByName('knee1')!.rotation.x,ledgerVisible:root.getObjectByName('work-ledger')!.visible,
        checkingFlowers:root.getObjectByName('body')!.rotation.x>.25,flower:f.flower};
    });
  }
  canPhotographVisit(world:GroundWorld,epoch:number) {
    return world === this.visitorWorld && this.friendVisitAllowed
      && this.visit === world.planetId+'/'+epoch+'/'+world.revision;
  }
  private clear() {
    this.benchIds=[];
    this.friendVisitAllowed = false;
    this.visitorAllowed = false;
    this.cancelVisitorGreeting();
    for(const figure of this.figures.values())figure.dispose();
    this.seats=[];this.figures.clear();this.summary.hidden=true;this.summary.replaceChildren();
    this.rosterSize=null;
    this.publicRoster=[];
  }
  /** Only expose a count from the acknowledged outdoor scene to its owner. */
  ownerRosterSize(planet:PlanetView, epoch:number) {
    return planet.mine && this.visit === planet.id+'/'+epoch+'/'+planet.revision ? this.rosterSize : null;
  }
  private async refresh(planet:string,world:GroundWorld|null,request:AbortController,objects:PlanetView['objects']) {
    try{
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5000)]);
      const response=await fetch('/api/planets/'+encodeURIComponent(planet)+'/residents',{cache:'no-store',signal});
      if(!response.ok)throw Error('Roster unavailable');
      const {residents,visitClosed,visitReopen,friendVisitAllowed}=await response.json() as {
        residents:Resident[];visitClosed?:boolean;visitReopen?:boolean;friendVisitAllowed?:boolean
      };
      if(request!==this.request)return;
      this.closure.hidden=!visitClosed&&!visitReopen;
      if(visitClosed||visitReopen){
        this.clear();
        if(visitClosed){
          this.closureText.textContent=zh()?'好友来访已关闭。':'This friend visit has closed.';
        }else if(this.back.hidden){
          this.closureText.textContent=zh()
            ?'请用上方的「返回消息」回到原聊天，再打开好友星球。'
            :'Use Return to messages above, then reopen your friend’s planet from the original chat.';
        }else{
          this.closureText.textContent=zh()
            ?'请返回原聊天，再打开好友星球。'
            :'Return to the original chat, then reopen your friend’s planet.';
        }
        this.back.textContent=zh()?'返回原聊天':'Return to chat';
        return;
      }
      if(!world)return;
      this.benchIds=objects.filter(object=>object.kind==='bench'&&object.assetVersion===2).map(object=>object.id);
      this.visitorAllowed = true;
      this.friendVisitAllowed = friendVisitAllowed === true;
      const ids=new Set(residents.map(r=>r.id));
      for(const [id,figure] of this.figures)if(!ids.has(id)){figure.dispose();this.figures.delete(id);}
      const used=new Set(Array.from(this.figures.values(),f=>f.slot));
      const needed=Math.max(residents.length,...Array.from(used,i=>i+1));
      if(this.seats.length<needed)this.seats=landingSites(world,needed);
      const seats=this.seats;
      const cards:(Node|string)[]=[];
      for(const role of residents){
        if(!Object.hasOwn(actions,role.activity))role.activity='unknown';
        const portrait=residentPortrait(planet,role);
        const key=role.appearanceKey;
        let figure=this.figures.get(role.id);
        if(!figure||figure.key!==key){
          const slot=figure?.slot??seats.findIndex((_,i)=>!used.has(i));
          if(slot<0||!seats[slot])continue;
          const flower=nearbyDoorstepFlower(world,seats[slot],objects);
          figure?.dispose();figure=new ResidentFigure(this.scene,world,role,slot,seats[slot],key,portrait,flower);
          used.add(slot);this.figures.set(role.id,figure);
        }else figure.update(role,portrait);
        if(cards.length)cards.push(' / ');cards.push(figure.card);
      }
      this.summary.replaceChildren(...cards);this.summary.hidden=!cards.length;
      this.rosterSize=residents.length;
      this.publicRoster=residents.map(({id,displayName})=>({id,displayName}));
    }catch{
      if(request!==this.request)return;
      this.clear();
      if(new URLSearchParams(location.search).get('visit')===planet&&!this.closure.hidden)return;
      this.summary.textContent=zh()?'暂时看不到搭档的动态。':'Companion activity is unavailable.';this.summary.hidden=false;
    }finally{if(request===this.request){this.request=null;this.next=performance.now()+3000;}}
  }
}
