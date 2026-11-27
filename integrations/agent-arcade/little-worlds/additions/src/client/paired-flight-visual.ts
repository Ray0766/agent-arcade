import * as T from 'three';
import { forward, type SpaceBody } from '../shared/flight.ts';
import { bodyRadius } from '../shared/world-size.ts';
import type { Vec3 } from '../shared/world.ts';
import type { ShipDesign } from '../assets/claude-geometry/ship/design.ts';
import { makeShip } from './ship-model.ts';
import './paired-flight-visual.css';

/** This is a presentation input. The caller owns the round, trip and freshness checks. */
export interface PairedFlightVisualSample {
  id: string;
  position: Readonly<Vec3>;
  yaw: number;
  pitch: number;
  speed?: number;
  design?: ShipDesign;
}

const modelRange = 65;
const overlapRange = 6;
const worldUp = new T.Vector3(0, 1, 0);

export class PairedFlightVisual {
  private ship?: ReturnType<typeof makeShip>;
  private key?: string;
  private readonly marker = document.createElement('div');
  private readonly distance = document.createElement('div');
  private readonly peer = new T.Vector3();
  private readonly displayed = new T.Vector3();
  private readonly offset = new T.Vector3();
  private readonly projected = new T.Vector3();
  private readonly ownScreen = new T.Vector3();
  private readonly ray = new T.Ray();
  private readonly sphere = new T.Sphere();
  private readonly hit = new T.Vector3();
  private readonly front = new T.Vector3();
  private readonly right = new T.Vector3();
  private readonly up = new T.Vector3();
  private readonly basis = new T.Matrix4();

  constructor(private readonly scene: T.Scene, hud: HTMLElement) {
    this.marker.className = 'paired-flight-marker';
    this.distance.className = 'paired-flight-distance';
    this.marker.hidden = this.distance.hidden = true;
    hud.append(this.marker, this.distance);
  }

  frame(sample: PairedFlightVisualSample | null, self: T.Vector3, camera: T.PerspectiveCamera,
    bodies: SpaceBody[], dt: number, reduced: boolean) {
    if (!sample) { this.clear(); return; }
    if (this.key !== sample.id) {
      this.clear();
      this.key = sample.id;
      this.peer.fromArray(sample.position);
    }
    this.displayed.fromArray(sample.position);
    const distance = self.distanceTo(this.displayed);
    if (reduced || this.peer.distanceToSquared(this.displayed) > 196) this.peer.copy(this.displayed);
    else this.peer.lerp(this.displayed, 1 - Math.exp(-18 * dt));

    const chinese = document.documentElement.lang.startsWith('zh');
    const title = chinese ? '同伴船' : 'Companion';
    this.marker.hidden = true;
    this.distance.hidden = false;
    const label = chinese ? `同伴船 · ${Math.round(distance)} 米` : `Companion · ${Math.round(distance)} m`;
    if (this.distance.textContent !== label) this.distance.textContent = label;
    if (this.ship) this.ship.root.visible = false;
    if (distance > modelRange || this.occluded(camera, this.peer, bodies)) return;

    camera.updateMatrixWorld();
    this.displayed.copy(this.peer);
    // On a shared departure/arrival line, split overlapping silhouettes only
    // in the view. The readout and all simulation use the received positions.
    const settle = T.MathUtils.smoothstep(distance, 0, overlapRange);
    const horizontal = Math.min(1, camera.aspect ** 2);
    this.offset.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(horizontal);
    this.offset.addScaledVector(this.up.setFromMatrixColumn(camera.matrixWorld, 1), Math.sqrt(1 - horizontal ** 2));
    this.offset.multiplyScalar(3.5 * (1 - settle));
    this.displayed.add(this.offset);
    if (this.occluded(camera, this.displayed, bodies)) this.displayed.copy(this.peer);

    this.projected.copy(this.displayed).project(camera);
    this.ownScreen.copy(self).project(camera);
    const p = this.projected;
    if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1 ||
      Math.hypot(p.x - this.ownScreen.x, p.y - this.ownScreen.y) < .11) return;

    if (!this.ship) {
      this.ship = makeShip();
      this.ship.root.name = 'paired-flight-ship';
      this.scene.add(this.ship.root);
    }
    if (sample.design) this.ship.setDesign(sample.design);
    this.front.fromArray(forward(sample.yaw, sample.pitch));
    this.right.crossVectors(this.front, worldUp).normalize();
    this.up.crossVectors(this.right, this.front).normalize();
    this.basis.makeBasis(this.right, this.up, this.offset.copy(this.front).negate());
    this.ship.root.position.copy(this.displayed);
    this.ship.root.quaternion.setFromRotationMatrix(this.basis);
    this.ship.root.visible = true;
    this.ship.animate(T.MathUtils.clamp((sample.speed ?? 4.3) / 36, .06, 1), false);
    if (Math.abs(p.x) > .86 || Math.abs(p.y) > .82) return;
    if (this.marker.textContent !== title) this.marker.textContent = title;
    const labelPoint = this.offset.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(1.45).add(this.displayed).project(camera);
    this.marker.style.left = `${(p.x * .5 + .5) * 100}%`;
    this.marker.style.top = String((.5 - labelPoint.y * .5) * 100) + '%';
    this.marker.hidden = false;
    this.distance.hidden = true;
  }

  private occluded(camera: T.PerspectiveCamera, point: T.Vector3, bodies: SpaceBody[]) {
    this.ray.origin.copy(camera.position);
    const distance = this.ray.direction.subVectors(point, camera.position).length();
    if (distance < .5) return true;
    this.ray.direction.divideScalar(distance);
    return bodies.some(body => {
      this.sphere.center.fromArray(body.center);
      this.sphere.radius = bodyRadius(body);
      return !!this.ray.intersectSphere(this.sphere, this.hit) &&
        this.hit.distanceToSquared(camera.position) < distance * distance;
    });
  }

  clear() {
    this.key = undefined;
    this.ship?.dispose();
    this.ship = undefined;
    this.marker.hidden = this.distance.hidden = true;
  }
}
