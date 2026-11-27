import * as T from 'three';
import { objectHeight, objectRadius, type PlacedObject } from '../shared/planets.ts';
import type { GroundWorld, GroundPose } from '../shared/physics/world.ts';
import { aimWaterStream, buildWateringCan, WATER_COLOR, wateringCanMouth } from './watering-tool.ts';

const POUR_MS = 1650;
type Flower = { object: PlacedObject; model: T.Object3D };
type Scene = { world: GroundWorld; pose: GroundPose; objects: readonly PlacedObject[];
  getModel(id: string): T.Object3D | undefined };
const potHeight = (flower: Flower) => objectHeight(flower.object) * .42;
const soil = (flower: Flower) => flower.model.localToWorld(new T.Vector3(0, potHeight(flower) * .9, 0));

function alignWithPot(mesh: T.Object3D, flower: Flower, height: number, radius: number) {
  mesh.position.copy(flower.model.localToWorld(new T.Vector3(0, height, 0)));
  flower.model.getWorldQuaternion(mesh.quaternion);
  mesh.scale.set(radius, 1, radius);
}

export class VisitorWatering {
  readonly button = document.createElement('button');
  private scope: string | null = null;
  private candidates: Flower[] = [];
  private selected: Flower | null = null;
  private choosing = false;
  private started: number | null = null;
  private streamPoints: { start: number[]; end: number[] } | null = null;
  private readonly wet = new Map<string, { flower: Flower; mesh: T.Mesh }>();
  private readonly ray = new T.Raycaster();
  private readonly can = buildWateringCan((parent, shape, color, position, size) => {
    const geometry = shape === 'box' ? new T.BoxGeometry(1, 1, 1)
      : shape === 'sphere' ? new T.SphereGeometry(.5, 10, 6) : new T.CylinderGeometry(.5, .5, 1, 8);
    const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ color }));
    mesh.position.set(...position);
    mesh.scale.set(...size);
    parent.add(mesh);
    return mesh;
  });
  private readonly stream = new T.Mesh(new T.CylinderGeometry(.5, .5, 1, 8),
    new T.MeshBasicMaterial({ color: WATER_COLOR }));
  private readonly ring = new T.Mesh(new T.RingGeometry(.94, 1, 32).rotateX(-Math.PI / 2),
    new T.MeshBasicMaterial({ color: '#ffdb84', side: T.DoubleSide }));
  private readonly wetGeometry = new T.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  private readonly wetMaterial = new T.MeshStandardMaterial({ color: '#392b26', roughness: .32 });

  constructor(private readonly scene: T.Scene, private readonly panel: HTMLElement, leaveMouseLook: () => void) {
    this.button.type = 'button';
    this.button.id = 'visitor-watering';
    this.button.className = 'primary';
    this.button.hidden = true;
    panel.append(this.button);
    this.button.onclick = () => {
      if (this.button.hidden) return;
      if (this.started !== null || (this.choosing && !this.selected)) this.cancel();
      else if (this.selected) this.started = performance.now();
      else {
        leaveMouseLook();
        this.choosing = true;
      }
      this.paint();
    };
    this.stream.visible = this.ring.visible = false;
    scene.add(this.stream, this.ring);
  }

  get picking() { return this.choosing && this.started === null; }

  pick(x: number, y: number, camera: T.Camera, canvas: HTMLCanvasElement, world: GroundWorld,
    globe: T.Object3D, objects: readonly PlacedObject[], getModel: Scene['getModel']) {
    if (!this.picking) return;
    const rect = canvas.getBoundingClientRect();
    this.ray.setFromCamera(new T.Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera);
    this.selected = null;
    const models = objects.flatMap(object => {
      const model = getModel(object.id);
      return model?.visible && model.parent ? [model] : [];
    });
    const hit = this.ray.intersectObjects([...models, globe], true)[0];
    if (!hit) return;
    let root: T.Object3D | null = hit.object;
    while (root && !models.includes(root)) root = root.parent;
    const flower = this.candidates.find(item => item.model === root);
    if (!flower) return;
    const eye = camera.getWorldPosition(new T.Vector3());
    // The exact mesh ray handles the pot and its neighbours. Stop the coarse
    // physics ray short of the pot so its collision margin cannot mask the hit.
    const end = hit.point.clone().addScaledVector(this.ray.ray.direction, -objectRadius(flower.object));
    if (world.cameraDistance(eye, end, .02) + .065 >= eye.distanceTo(end)) this.selected = flower;
  }

  setScope(scope: string | null, ready: boolean) {
    if (scope !== this.scope) {
      for (const { mesh } of this.wet.values()) mesh.removeFromParent();
      this.wet.clear();
      this.scope = scope;
      this.candidates = [];
      this.cancel();
    }
    if (!ready) {
      this.candidates = [];
      this.cancel();
    }
    this.paint();
  }

  frame(context: Scene | null, player: { root: T.Group; head: T.Object3D },
    now: number, moving: boolean, reduced: boolean) {
    if (!context || !this.scope) return;
    for (const [id, { flower, mesh }] of this.wet) {
      if (context.getModel(id) === flower.model && context.objects.some(object => object.id === id && object.version === flower.object.version)) continue;
      mesh.removeFromParent();
      this.wet.delete(id);
    }
    const { world, pose } = context;
    const up = new T.Vector3(...pose.position);
    const near = (object: PlacedObject) => up.angleTo(new T.Vector3(...object.position)) * world.baseRadius;
    this.candidates = moving || world.blocked(pose) ? [] : context.objects.flatMap(object => {
      if (object.kind !== 'flowers') return [];
      const distance = near(object);
      if (distance < .65 || distance > 1.75) return [];
      const model = context.getModel(object.id);
      if (!model?.visible || !model.parent) return [];
      const flower = { object, model };
      const eye = up.clone().multiplyScalar(pose.radius + .9);
      const aboveFlowers = new T.Vector3(...object.position).multiplyScalar(world.radius(object.position) + .72);
      return world.cameraDistance(eye, aboveFlowers, .06) + .05 >= eye.distanceTo(aboveFlowers) ? [flower] : [];
    });
    const chosen = this.selected;
    if (moving || !this.candidates.length || (chosen && !this.candidates.some(flower =>
      flower.model === chosen.model && flower.object.version === chosen.object.version))) this.cancel();

    if (this.selected) {
      const flower = this.selected;
      alignWithPot(this.ring, flower, potHeight(flower) + .025, objectRadius(flower.object) * .99);
      this.ring.visible = true;
      if (this.started !== null) {
        const end = soil(flower);
        // Use the same shoulder and forearm mounts as the existing courier.
        const arm = player.head.parent?.children.find(node => node instanceof T.Group && node.position.x === -.225 && node.position.y === .16);
        const forearm = arm?.children.find(node => node instanceof T.Group && node.position.y === -.22);
        if (!arm || !forearm) this.cancel();
        else if (now - this.started >= POUR_MS) {
          if (!this.wet.has(flower.object.id)) {
            const mesh = new T.Mesh(this.wetGeometry, this.wetMaterial);
            alignWithPot(mesh, flower, potHeight(flower) * .9 + .008, objectRadius(flower.object) * .735);
            this.scene.add(mesh);
            this.wet.set(flower.object.id, { flower, mesh });
          }
          this.cancel();
        } else {
          const aim = end.clone().sub(player.root.position).projectOnPlane(up).normalize();
          const right = new T.Vector3().crossVectors(up, aim);
          player.root.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(right, up, aim));
          const lift = reduced ? 1 : T.MathUtils.clamp((now - this.started) / 180, 0, 1);
          arm.rotation.set(-.88 * lift, 0, -.09);
          forearm.rotation.x = -.62 * lift;
          forearm.add(this.can);
          this.can.position.set(0, -.226, .014);
          this.can.rotation.x = .53 - arm.rotation.x - forearm.rotation.x;
          const mouth = wateringCanMouth(this.can);
          this.stream.visible = lift >= .95;
          aimWaterStream(this.stream, mouth, end, .031);
          this.streamPoints = this.stream.visible ? { start: mouth.toArray(), end: end.toArray() } : null;
        }
      }
    }
    this.paint();
  }

  snapshot() {
    return { selected: this.selected?.object.id ?? null, active: this.started !== null, stream: this.streamPoints,
      wet: [...this.wet.keys()] };
  }

  private cancel() {
    this.choosing = false;
    this.selected = null;
    this.started = null;
    this.streamPoints = null;
    this.can.removeFromParent();
    this.stream.visible = this.ring.visible = false;
  }

  private paint() {
    this.button.hidden = !this.scope || !this.candidates.length;
    this.panel.toggleAttribute('data-visitor-watering', !this.button.hidden);
    const zh = document.documentElement.lang.startsWith('zh');
    const text = this.started !== null ? (zh ? '停止浇水' : 'Stop watering')
      : this.selected ? (zh ? '浇这盆花' : 'Water this pot')
      : this.choosing ? (zh ? '取消选盆' : 'Cancel selection')
      : zh ? '选花浇水' : 'Choose flowers to water';
    if (this.button.textContent !== text) this.button.textContent = text;
  }
}
