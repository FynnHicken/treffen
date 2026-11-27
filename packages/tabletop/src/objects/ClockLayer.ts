/**
 * Schachuhr am Tisch (Engine 2.6): Holzgehäuse neben dem Brett, je Spieler ein Ziffernblatt, das zu ihm zeigt, und
 * ein Drücker – gedrückt bei dem, der gerade nicht dran ist (wie bei einer echten Uhr). Zeiten kommen vom Server
 * (`play.clock = {left: {"0": Sek.}, running: [Plätze]}`); dazwischen zählt die Uhr selbst herunter.
 * Gezeichnet wird nur, wenn sich eine angezeigte Sekunde ändert (kein Dauer-Rendern).
 * Nur bei zwei Plätzen als Gegenstand – sonst steht die eigene Zeit nur in der Statuszeile.
 */
import * as THREE from 'three';
import type { TableScene } from '../engine/TableScene';
import type { TableClient } from '../net/TableClient';
import type { Layout, TableState } from '../net/state';

/** „4:07“ bzw. „0:09.4“ unter 10 Sekunden */
export function formatClock(sec: number): string {
    const s = Math.max(0, sec);
    if (s < 10) return `0:0${s.toFixed(1)}`;
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
}

interface Face { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; text: string; button: THREE.Mesh }

export class ClockLayer {
    private group = new THREE.Group();
    private faces: Face[] = [];
    private recv = 0;                     // Zeitpunkt des letzten Spielstands (performance.now)
    private left: Record<string, number> = {};
    private running: number[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private layoutRef: Layout | null = null;

    constructor(private table: TableScene, client: TableClient) {
        this.group.visible = false;
        table.scene.add(this.group);
        client.onState(s => this.sync(s));
    }

    /** Verbleibende Zeit eines Platzes jetzt (Sekunden) – auch für die Statuszeile */
    remaining(seat: number): number | null {
        const v = this.left[String(seat)];
        if (v === undefined) return null;
        return this.running.includes(seat) ? v - (performance.now() - this.recv) / 1000 : v;
    }

    get active(): boolean {
        return Object.keys(this.left).length > 0;
    }

    private sync(s: TableState): void {
        const c = (s.status === 'playing' || s.status === 'finished') ? s.play?.clock : null;
        if (!c) {
            this.left = {}; this.running = [];
            this.group.visible = false;
            this.stop();
            return;
        }
        this.left = { ...c.left };
        this.running = s.status === 'playing' ? [...c.running] : [];
        this.recv = performance.now();
        if (s.game.seats === 2) {
            if (this.layoutRef !== s.layout || !this.faces.length) this.build(s.layout);
            this.group.visible = true;
        }
        this.draw();
        if (this.running.length) this.start(); else this.stop();
    }

    private start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.draw(), 100);
    }

    private stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    private build(layout: Layout): void {
        this.layoutRef = layout;
        for (const o of [...this.group.children]) this.group.remove(o);
        this.faces = [];
        const b = layout.board;
        const pos = (b?.clock as { x: number; z: number } | undefined)
            ?? { x: -(((b?.w as number | undefined) ?? b?.size ?? 9) / 2 + 1.35), z: 0 };
        const wood = new THREE.MeshPhysicalMaterial({ color: 0x5a3720, roughness: 0.45, clearcoat: 0.6 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 1.5), wood);
        body.position.y = 0.21;
        body.castShadow = true;
        body.receiveShadow = true;
        this.group.add(body);
        // Platz 0 sitzt bei +z: seine Hälfte ist die vordere, Ziffern lesbar von +z; Platz 1 gegenüber
        for (const seat of [0, 1]) {
            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 128;
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            const face = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.28), new THREE.MeshBasicMaterial({ map: tex }));
            // schräg nach oben, zum Spieler gedreht (Platz 1 sieht von −z)
            face.rotation.set(-Math.PI / 2 + 0.85, seat === 1 ? Math.PI : 0, 0, 'YXZ');
            face.position.set(0, 0.53, seat === 0 ? 0.42 : -0.42);
            this.group.add(face);
            const button = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 20),
                new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.4 }));
            button.position.set(0, 0.47, seat === 0 ? 0.62 : -0.62);
            button.castShadow = true;
            this.group.add(button);
            this.faces.push({ canvas, tex, text: '', button });
        }
        this.group.position.set(pos.x, 0.002, pos.z);
        this.group.scale.setScalar(1.7);                          // gut lesbar, auch am Handy
    }

    private draw(): void {
        if (!this.faces.length) return;
        let changed = false;
        this.faces.forEach((f, seat) => {
            const left = this.remaining(seat);
            const run = this.running.includes(seat);
            const text = left === null ? '' : formatClock(left) + (run ? '•' : '');
            if (text === f.text) return;
            f.text = text;
            changed = true;
            const g = f.canvas.getContext('2d')!;
            g.fillStyle = '#d9dcc9';
            g.fillRect(0, 0, 256, 128);
            g.fillStyle = left !== null && left < 10 && run ? '#b3261e' : '#1d2418';
            g.font = '700 74px "Courier New", ui-monospace, monospace';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(text.replace('•', ''), 128, 66);
            if (run) { g.beginPath(); g.arc(232, 22, 9, 0, Math.PI * 2); g.fill(); }
            f.tex.needsUpdate = true;
            // Drücker: unten bei dem, dessen Uhr steht (er hat gerade gedrückt)
            f.button.position.y = run ? 0.47 : 0.43;
        });
        if (changed) this.table.invalidate();
    }
}
