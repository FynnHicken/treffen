/**
 * Der leere Spieltisch: Renderer, warmes Licht, Holztisch, Kamera vom eigenen Platz, Render-on-Demand.
 *
 * Render-on-Demand: Es wird nur gezeichnet, wenn sich etwas ändert (`invalidate()`), Kamera-Gesten
 * laufen, oder ein Animator noch arbeitet. Im Leerlauf kostet der Tisch praktisch keine GPU/Akku.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { feltTexture, woodTextures } from './materials';

export interface TableSceneOptions {
    container: HTMLElement;
    /** Anzahl Sitzplätze rund um den Tisch (gleichmäßig verteilt, Platz 0 = „unten“) */
    seats: number;
    /** Kantenlänge der quadratischen Tischplatte */
    tableSize?: number;
    /** Radius des Spielbereichs, der immer ins Bild passen soll (Brett + etwas Rand) */
    focusRadius?: number;
}

/** Wird jedes Frame aufgerufen; `true` zurückgeben, solange noch animiert wird. */
export type Animator = (dt: number) => boolean;

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

export class TableScene {
    readonly renderer: THREE.WebGLRenderer;
    readonly labels: CSS2DRenderer;
    readonly scene = new THREE.Scene();
    readonly camera: THREE.PerspectiveCamera;
    readonly controls: OrbitControls;
    /** Ebene der Tischoberfläche (y = 0) – für Zeiger/Ablage */
    readonly tableTop: THREE.Mesh;
    readonly seats: number;
    readonly tableSize: number;
    readonly focusRadius: number;

    private container: HTMLElement;
    private needsRender = true;
    private frameRequested = false;
    private lastTime = performance.now();
    private animators = new Set<Animator>();
    private ownSeat = 0;
    private placemats: THREE.Mesh[] = [];
    private raycaster = new THREE.Raycaster();
    private resizeObserver: ResizeObserver;
    /** Zähler für Tests/Performance-Messung */
    framesRendered = 0;

    constructor(opts: TableSceneOptions) {
        this.container = opts.container;
        this.seats = opts.seats;
        this.tableSize = opts.tableSize ?? 14;
        this.focusRadius = opts.focusRadius ?? 6.2;
        const mobile = isTouchDevice();

        // ---------- Renderer ----------
        const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        r.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.75 : 2));
        r.toneMapping = THREE.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.05;
        r.shadowMap.enabled = true;
        r.shadowMap.type = THREE.PCFSoftShadowMap;
        r.domElement.style.touchAction = 'none';
        this.container.appendChild(r.domElement);

        this.labels = new CSS2DRenderer();
        Object.assign(this.labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
        this.container.appendChild(this.labels.domElement);

        // ---------- Licht: Hängelampe über dem Tisch + weiches Raumlicht ----------
        const scene = this.scene;
        scene.background = new THREE.Color(0x17100b);
        const pmrem = new THREE.PMREMGenerator(r);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = 0.22;
        pmrem.dispose();

        scene.add(new THREE.HemisphereLight(0xffe2c0, 0x2a1a10, 0.6));

        // Mittig, damit jeder Platz gleich viel Licht/Glanz bekommt
        const lamp = new THREE.SpotLight(0xffd6a0, 700, 40, Math.PI / 3.0, 0.7, 2);
        lamp.position.set(0, 11.5, 0);
        lamp.target.position.set(0, 0, 0);
        lamp.castShadow = true;
        lamp.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
        lamp.shadow.bias = -0.0004;
        lamp.shadow.normalBias = 0.02;
        lamp.shadow.radius = 5;
        lamp.shadow.camera.near = 4;
        lamp.shadow.camera.far = 20;
        scene.add(lamp, lamp.target);

        // ---------- Tisch ----------
        this.tableTop = this.buildTable();
        this.buildPlacemats();

        // ---------- Kamera ----------
        this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
        const c = this.controls = new OrbitControls(this.camera, r.domElement);
        c.enableDamping = true;
        c.dampingFactor = 0.09;
        c.enablePan = false;
        c.minPolarAngle = 0.05;
        c.maxPolarAngle = Math.PI * 0.43;          // nie unter die Tischkante
        c.rotateSpeed = 0.6;
        c.zoomSpeed = 0.8;
        c.addEventListener('change', () => this.invalidate());
        r.domElement.addEventListener('dblclick', () => this.resetView());

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
        this.resize();
        this.resetView(false);
    }

    // ---------- Render-on-Demand ----------
    invalidate(): void {
        this.needsRender = true;
        this.requestFrame();
    }

    addAnimator(fn: Animator): () => void {
        this.animators.add(fn);
        this.invalidate();
        return () => this.animators.delete(fn);
    }

    private requestFrame(): void {
        if (this.frameRequested) return;
        this.frameRequested = true;
        requestAnimationFrame(t => this.frame(t));
    }

    private frame(now: number): void {
        this.frameRequested = false;
        // Höchstens 0,25 s pro Bild: kein Springen, aber auf langsamen Geräten auch kein Zeitlupen-Effekt
        const dt = Math.min(0.25, (now - this.lastTime) / 1000);
        this.lastTime = now;
        let busy = this.controls.update();          // true, solange Dämpfung nachläuft
        for (const a of [...this.animators]) {
            if (a(dt)) busy = true; else this.animators.delete(a);
        }
        if (busy) this.needsRender = true;
        if (this.needsRender) {
            this.needsRender = false;
            this.renderer.render(this.scene, this.camera);
            this.labels.render(this.scene, this.camera);
            this.framesRendered++;
        }
        if (busy) this.requestFrame();
        else this.lastTime = performance.now();
    }

    // ---------- Größe & Kamera ----------
    private resize(): void {
        const w = this.container.clientWidth || window.innerWidth;
        const h = this.container.clientHeight || window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.renderer.domElement.style.width = w + 'px';
        this.renderer.domElement.style.height = h + 'px';
        this.labels.setSize(w, h);
        this.camera.aspect = w / h;
        // Hochkant weiteres Sichtfeld, sonst müsste die Kamera sehr weit weg (Brett wirkt winzig)
        this.camera.fov = this.camera.aspect < 0.8 ? 58 : 40;
        this.camera.updateProjectionMatrix();
        const fit = this.fitDistance();
        this.controls.minDistance = fit * 0.45;
        this.controls.maxDistance = fit * 1.6;
        this.invalidate();
    }

    /** Abstand, bei dem der Spielbereich (focusRadius) sicher ins Bild passt – auch hochkant am Handy. */
    private fitDistance(): number {
        const vfov = THREE.MathUtils.degToRad(this.camera.fov);
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
        const fov = Math.min(vfov, hfov);
        return this.focusRadius / Math.sin(fov / 2);
    }

    /** Richtung (Einheitsvektor in der Tischebene) von der Mitte zu einem Sitzplatz. */
    seatDirection(seat: number): THREE.Vector3 {
        // Platz 0 unten (+z), im Uhrzeigersinn (von oben gesehen) weiter: links, oben, rechts
        const a = (seat / this.seats) * Math.PI * 2;
        return new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    }

    /** Punkt an der Tischkante vor einem Sitzplatz (für Namensschilder, Platzsets). */
    seatPosition(seat: number, inset = 0.9): THREE.Vector3 {
        return this.seatDirection(seat).multiplyScalar(this.tableSize / 2 - inset);
    }

    get ownSeatIndex(): number {
        return this.ownSeat;
    }

    setOwnSeat(seat: number | null): void {
        const s = seat ?? 0;
        if (s === this.ownSeat) return;
        this.ownSeat = s;
        this.resetView(true);
    }

    /** Kamera zurück zum Blick vom eigenen Platz (Doppelklick/Doppeltipp). */
    resetView(animate = true): void {
        const dir = this.seatDirection(this.ownSeat);
        const dist = this.fitDistance();
        // Hochkant (Handy) steiler von oben, damit das quadratische Brett die Breite gut nutzt
        const polar = THREE.MathUtils.degToRad(this.camera.aspect < 0.8 ? 24 : 46);
        const target = new THREE.Vector3(0, 0, 0);
        const pos = dir.clone().multiplyScalar(Math.sin(polar) * dist).setY(Math.cos(polar) * dist);
        if (!animate) {
            this.camera.position.copy(pos);
            this.controls.target.copy(target);
            this.controls.update();
            this.invalidate();
            return;
        }
        const from = this.camera.position.clone(), fromT = this.controls.target.clone();
        let t = 0;
        this.addAnimator(dt => {
            t = Math.min(1, t + dt / 0.7);
            const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;   // easeInOutCubic
            this.camera.position.lerpVectors(from, pos, k);
            this.controls.target.lerpVectors(fromT, target, k);
            return t < 1;
        });
    }

    // ---------- Zeiger ----------
    /** Punkt auf der Tischoberfläche unter Bildschirmkoordinaten (oder null). */
    pickTable(clientX: number, clientY: number): THREE.Vector3 | null {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const hit = this.raycaster.intersectObject(this.tableTop, false)[0];
        return hit ? hit.point : null;
    }

    private ndc(clientX: number, clientY: number): THREE.Vector2 {
        const rect = this.renderer.domElement.getBoundingClientRect();
        return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    }

    /** Schnittpunkt mit der waagrechten Ebene in Höhe y (z. B. Brettoberfläche) – auch außerhalb des Tisches. */
    pickPlane(clientX: number, clientY: number, y: number): THREE.Vector3 | null {
        this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
        return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    }

    /** Getroffene Objekte unter Bildschirmkoordinaten (nächstes zuerst). */
    pickObjects(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
        this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
        return this.raycaster.intersectObjects(objects, true);
    }

    // ---------- Platzsets in Spielerfarbe ----------
    setSeatColor(seat: number, color: string | null): void {
        const mat = this.placemats[seat]?.material as THREE.MeshStandardMaterial | undefined;
        if (!mat) return;
        // Gedeckter Filz: Spielerfarbe Richtung Holzton gemischt
        mat.color.set(color ?? '#6b5a4a').lerp(new THREE.Color('#4a2e1a'), color ? 0.55 : 0);
        mat.opacity = color ? 0.7 : 0.22;
        this.invalidate();
    }

    /** Hochkant-Bildschirm? (Namensschilder rücken dann weiter nach innen) */
    get isPortrait(): boolean {
        return this.camera.aspect < 0.8;
    }

    // ---------- Aufbau ----------
    private buildTable(): THREE.Mesh {
        const size = this.tableSize, thick = 0.55, radius = 0.6;
        const { map, roughness } = woodTextures(isTouchDevice() ? 1024 : 2048);
        const aniso = this.renderer.capabilities.getMaxAnisotropy();
        for (const t of [map, roughness]) {
            t.anisotropy = aniso;
            t.repeat.set(1 / size, 1 / size);   // ExtrudeGeometry-UVs sind in Welteinheiten
        }
        const wood = new THREE.MeshPhysicalMaterial({
            map, roughnessMap: roughness, roughness: 0.62, metalness: 0,
            clearcoat: 0.18, clearcoatRoughness: 0.5    // geölt, dezenter Glanz
        });

        const shape = new THREE.Shape();
        const h = size / 2 - radius;
        shape.moveTo(-h, -size / 2);
        shape.lineTo(h, -size / 2);
        shape.quadraticCurveTo(size / 2, -size / 2, size / 2, -h);
        shape.lineTo(size / 2, h);
        shape.quadraticCurveTo(size / 2, size / 2, h, size / 2);
        shape.lineTo(-h, size / 2);
        shape.quadraticCurveTo(-size / 2, size / 2, -size / 2, h);
        shape.lineTo(-size / 2, -h);
        shape.quadraticCurveTo(-size / 2, -size / 2, -h, -size / 2);
        const geo = new THREE.ExtrudeGeometry(shape, {
            depth: thick, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 4, curveSegments: 12
        });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, -thick - 0.08, 0);       // Oberkante bei y = 0
        const table = new THREE.Mesh(geo, wood);
        table.receiveShadow = true;
        table.castShadow = true;
        this.scene.add(table);

        // Unsichtbare, exakte Ebene für Zeiger-Treffer
        const top = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ visible: false }));
        top.rotation.x = -Math.PI / 2;
        top.position.y = 0.001;
        this.scene.add(top);

        // Boden (dunkles Holz/Teppich), nur am Rand sichtbar
        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(40, 48),
            new THREE.MeshStandardMaterial({ color: 0x2a1c13, roughness: 0.95 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -7.5;
        floor.receiveShadow = true;
        this.scene.add(floor);
        return top;
    }

    private buildPlacemats(): void {
        const felt = feltTexture();
        felt.repeat.set(3, 1.2);
        for (let s = 0; s < this.seats; s++) {
            const mat = new THREE.MeshStandardMaterial({ color: '#6b5a4a', map: felt, roughness: 0.95, transparent: true, opacity: 0.35 });
            const mesh = new THREE.Mesh(roundedRect(3.6, 0.95, 0.24), mat);
            mesh.rotation.x = -Math.PI / 2;
            const p = this.seatPosition(s, 0.85);
            mesh.position.set(p.x, 0.004, p.z);
            mesh.rotation.z = (s / this.seats) * Math.PI * 2;
            mesh.receiveShadow = true;
            this.placemats.push(mesh);
            this.scene.add(mesh);
        }
    }

    dispose(): void {
        this.resizeObserver.disconnect();
        this.controls.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
        this.labels.domElement.remove();
    }
}

function roundedRect(w: number, h: number, r: number): THREE.ShapeGeometry {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return new THREE.ShapeGeometry(s, 8);
}
