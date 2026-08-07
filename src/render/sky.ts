/**
 * Sky and lighting: a day/night cycle driven by {@link hourOfDay}, plus the
 * shadow-casting sun that follows the camera target.
 *
 * The cycle is available but off by default — {@link Sky.alwaysDay} pins
 * lighting to a flattering mid-morning look so the city always reads clearly.
 */

import * as THREE from 'three';
import { clamp, mix, smoothstep } from '../core/noise.js';

/** Hour used when {@link Sky.alwaysDay} is enabled. */
export const FIXED_DAY_HOUR = 10;

/** Radius around the camera target covered by the sun's shadow camera, in metres. */
export const SHADOW_RADIUS = 600;

/** Distance from the target at which the sun light is positioned, in metres. */
const SUN_DISTANCE = 1400;

/** Named colour keyframes for the sky background across the day. */
const SKY_NIGHT = new THREE.Color(0x0a1128);
const SKY_DAWN = new THREE.Color(0xe8a06a);
const SKY_DAY = new THREE.Color(0x8fbde0);
const SKY_DUSK = new THREE.Color(0xd97a5c);

const SUN_DAWN = new THREE.Color(0xffb173);
const SUN_DAY = new THREE.Color(0xfff4e0);
const SUN_DUSK = new THREE.Color(0xff9a5e);
const MOON_COLOR = new THREE.Color(0x93aee0);

export class Sky {
  /** Directional sun (or moon at night). Casts the scene's shadows. */
  readonly sun: THREE.DirectionalLight;

  /** Ambient fill that keeps shadowed surfaces readable. */
  readonly ambient: THREE.AmbientLight;

  /** Sky/ground hemisphere light, tinted with the time of day. */
  readonly hemisphere: THREE.HemisphereLight;

  /** When true, lighting is pinned to {@link FIXED_DAY_HOUR}. Default `true`. */
  alwaysDay = true;

  private readonly scene: THREE.Scene;
  private readonly background = new THREE.Color();
  private readonly targetPoint = new THREE.Vector3();

  /**
   * @param scene Scene to attach lights to, and whose background is tinted.
   */
  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    const cam = this.sun.shadow.camera;
    cam.near = 10;
    cam.far = SUN_DISTANCE + SHADOW_RADIUS * 2;
    cam.left = -SHADOW_RADIUS;
    cam.right = SHADOW_RADIUS;
    cam.top = SHADOW_RADIUS;
    cam.bottom = -SHADOW_RADIUS;
    cam.updateProjectionMatrix();

    this.ambient = new THREE.AmbientLight(0xb8c9de, 0.45);
    this.hemisphere = new THREE.HemisphereLight(0xa8c8e8, 0x5a5344, 0.6);

    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.add(this.ambient);
    scene.add(this.hemisphere);

    this.update(FIXED_DAY_HOUR, new THREE.Vector3(0, 0, 0));
  }

  /**
   * Update lighting for the current time and camera target.
   *
   * @param hour Time of day as a float in [0,24). Ignored when
   *   {@link alwaysDay} is set.
   * @param cameraTarget Ground point the camera is looking at; the shadow
   *   frustum is recentred on it.
   */
  update(hour: number, cameraTarget: THREE.Vector3): void {
    const h = this.alwaysDay ? FIXED_DAY_HOUR : ((hour % 24) + 24) % 24;
    this.targetPoint.copy(cameraTarget);

    // Sun elevation: below the horizon before 06:00 and after 18:00.
    const dayAngle = ((h - 6) / 12) * Math.PI;
    const elevation = Math.sin(dayAngle);
    const azimuth = dayAngle + Math.PI * 0.15;

    const isDay = elevation > 0;
    const daylight = clamp(elevation, 0, 1);

    // Twilight weight peaks at sunrise and sunset.
    const twilight = 1 - smoothstep(0, 0.32, Math.abs(elevation));
    const dawn = h < 12;

    // --- Sky background ---
    if (isDay) {
      const horizonTint = dawn ? SKY_DAWN : SKY_DUSK;
      this.background.copy(SKY_DAY).lerp(horizonTint, twilight * 0.85);
    } else {
      const horizonTint = dawn ? SKY_DAWN : SKY_DUSK;
      this.background.copy(SKY_NIGHT).lerp(horizonTint, twilight * 0.45);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.background);
    } else {
      this.scene.background = this.background.clone();
    }

    // --- Key light: sun by day, moon by night ---
    if (isDay) {
      const warm = dawn ? SUN_DAWN : SUN_DUSK;
      this.sun.color.copy(SUN_DAY).lerp(warm, twilight * 0.9);
      this.sun.intensity = mix(0.5, 2.4, daylight);
    } else {
      this.sun.color.copy(MOON_COLOR);
      this.sun.intensity = 0.35;
    }

    // Position the key light relative to the camera target so its shadow
    // frustum always covers the area being looked at.
    const lightElevation = isDay ? Math.max(elevation, 0.12) : 0.55;
    const horizontal = Math.cos(Math.asin(clamp(lightElevation, -1, 1))) * SUN_DISTANCE;
    this.sun.position.set(
      this.targetPoint.x + Math.cos(azimuth) * horizontal,
      this.targetPoint.y + lightElevation * SUN_DISTANCE,
      this.targetPoint.z + Math.sin(azimuth) * horizontal,
    );
    this.sun.target.position.copy(this.targetPoint);
    this.sun.target.updateMatrixWorld();
    this.sun.shadow.camera.updateProjectionMatrix();

    // --- Fill light ---
    if (isDay) {
      this.ambient.intensity = mix(0.3, 0.5, daylight);
      this.ambient.color.setHex(0xb8c9de);
      this.hemisphere.intensity = mix(0.35, 0.65, daylight);
      this.hemisphere.color.copy(this.background);
      this.hemisphere.groundColor.setHex(0x5a5344);
    } else {
      this.ambient.intensity = 0.16;
      this.ambient.color.setHex(0x2b3a63);
      this.hemisphere.intensity = 0.22;
      this.hemisphere.color.setHex(0x1d2a4d);
      this.hemisphere.groundColor.setHex(0x161a24);
    }
  }

  /** Toggle the day/night cycle on or off. */
  setAlwaysDay(enabled: boolean): void {
    this.alwaysDay = enabled;
  }
}
