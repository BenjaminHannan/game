/**
 * WebGL renderer setup: device configuration, the root scene, and resize
 * handling. Cameras are supplied per-render so the rig can own its own state.
 */

import * as THREE from 'three';

export class Renderer {
  /** The underlying three.js renderer. */
  readonly gl: THREE.WebGLRenderer;

  /** Root scene all world objects are added to. */
  readonly scene: THREE.Scene;

  private readonly canvas: HTMLCanvasElement;
  private readonly resizeListener: () => void;

  /**
   * @param canvas Canvas element to render into.
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fb6d9);

    this.resizeListener = () => this.resize();
    window.addEventListener('resize', this.resizeListener);
    this.resize();
  }

  /** Current drawing buffer aspect ratio. */
  get aspect(): number {
    return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
  }

  /** Match the drawing buffer to the canvas's CSS size. */
  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(width, height, false);
  }

  /** Draw the scene from a camera. */
  render(camera: THREE.Camera): void {
    this.gl.render(this.scene, camera);
  }

  /** Release GPU resources and event listeners. */
  dispose(): void {
    window.removeEventListener('resize', this.resizeListener);
    this.gl.dispose();
  }
}
