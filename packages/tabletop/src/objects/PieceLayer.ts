/**
 * Figuren auf dem Tisch: darstellen, greifen, ziehen, einrasten, hüpfen – und sehen, was die anderen tun.
 *
 *  - Eigene Figur antippen/greifen → hebt sich an (Klack, kurze Vibration), folgt dem Finger, neigt sich in
 *    Zugrichtung. Über einem freien Feld erscheint ein Einrast-Ring. Loslassen → hüpft aufs Feld.
 *  - Der Server entscheidet: lehnt er ab (DROP_REJECTED), gleitet die Figur zurück.
 *  - Hält ein anderer eine Figur, schwebt sie bei allen und folgt seinem Zeiger (Präsenz mit `hold`).
 *  - Antippen statt Ziehen: Bei genau einem erlaubten Ziel zieht die Figur sofort dorthin. Bei mehreren bleibt sie
 *    angehoben liegen (ausgewählt, Ziele leuchten); Tippen auf ein Ziel setzt sie, Tippen daneben legt sie zurück.
 *    So geht am Handy alles ohne Ziehen und ohne Rückfrage-Dialog.
 *  - Ändert eine Figur ihre Art (PIECE_CHANGED, z. B. Bauer → Dame), wird sie an Ort und Stelle ausgetauscht.
 *
 * Spielneutral: Welche Figur wie aussieht, kommt per `createMesh` vom Spiel.
 */
import * as THREE from 'three';
import type { TableScene } from '../engine/TableScene';
import type { TableClient } from '../net/TableClient';
import type { FieldSpec, Layout, PieceSpec, TableState } from '../net/state';
import { knock, lift, vibrate } from '../audio/sfx';

export interface PieceLayerOptions {
    /** Höhe der Oberfläche, auf der Figuren stehen (z. B. Brettoberkante) */
    surfaceY: number;
    /** 3D-Objekt für eine Figur (Ursprung = Mitte des Fußes) */
    createMesh: (id: string, spec: PieceSpec, layout: Layout) => THREE.Object3D;
    /** Wie hoch eine gehaltene Figur schwebt */
    liftHeight?: number;
}

type Mode = 'rest' | 'drag' | 'held' | 'hop' | 'selected';

interface Vis {
    id: string;
    obj: THREE.Object3D;
    kind: string;               // Art, mit der das Modell gebaut wurde
    mode: Mode;
    pos: THREE.Vector3;         // aktuelle Position (Fuß)
    goal: THREE.Vector3;        // Ziel beim Folgen (drag/held)
    hop?: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; height: number; sound: boolean };
    /** weitere Felder, über die die Figur Feld für Feld hüpft */
    queue?: THREE.Vector3[];
    pendingField?: string;      // eigener Drop, auf Bestätigung wartend
    tilt: THREE.Vector2;
}

const HOP_DURATION = 0.32;

export class PieceLayer {
    private vis = new Map<string, Vis>();
    private group = new THREE.Group();
    private snapRing: THREE.Mesh;
    private targetRings: THREE.Mesh[] = [];       // erlaubte Ziele beim Ziehen
    private hintRings = new Map<string, THREE.Mesh>();   // „diese Figur darf ziehen“
    private downAt = new THREE.Vector2();
    private dragDist = 0;
    private snapField: string | null = null;
    private dragging: Vis | null = null;
    /** angetippte Figur, die auf die Wahl des Ziels wartet */
    private selected: Vis | null = null;
    private dragWasSelected = false;
    private animating = false;
    private layout: Layout | null = null;
    private lastState: TableState | null = null;
    private readonly lift: number;
    private spacing = 0.8;

    constructor(private table: TableScene, private client: TableClient, private opts: PieceLayerOptions) {
        this.lift = opts.liftHeight ?? 0.5;
        table.scene.add(this.group);

        this.snapRing = new THREE.Mesh(
            new THREE.RingGeometry(0.3, 0.37, 40),
            new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.85, depthWrite: false })
        );
        this.snapRing.rotation.x = -Math.PI / 2;
        this.snapRing.visible = false;
        table.scene.add(this.snapRing);

        client.onState(s => { this.syncState(s); this.updateHints(); });
        client.onEvent(ev => {
            if (ev.type === 'PIECE_MOVED') this.onMoved(ev.piece, ev.to, ev.by, ev.path, ev.reason);
            else if (ev.type === 'PIECE_GRABBED' && ev.by !== client.you) this.onGrabbedByOther(ev.piece);
            else if (ev.type === 'PIECE_RELEASED') this.onReleased(ev.piece);
        });
        client.onPresence((from, p) => {
            if (!p?.hold) return;
            const v = this.vis.get(p.hold);
            if (v && v.mode === 'held' && this.lastState?.pieces[p.hold]?.held_by === from) {
                v.goal.set(p.x, this.opts.surfaceY + this.lift, p.z);
                this.kick();
            }
        });
        client.onError(err => {
            if (err.code === 'DROP_REJECTED' && typeof err.piece === 'string') this.rejectDrop(err.piece);
        });

        // Zeiger: im Capture-Durchlauf am Container, damit die Kamera-Steuerung beim Greifen nicht mitdreht
        const container = table.renderer.domElement.parentElement!;
        container.addEventListener('pointerdown', ev => this.onPointerDown(ev), { capture: true });
    }

    // ---------- Zustand ----------
    private syncState(s: TableState): void {
        if (s.layout !== this.layout) this.build(s.layout);
        this.lastState = s;
        if (this.selected && !this.canTouch(this.selected.id)) this.cancelSelection();
        for (const [id, ps] of Object.entries(s.pieces)) {
            let v = this.vis.get(id);
            const kind = ps.kind || s.layout.pieces[id]?.kind;
            if (v && kind && kind !== v.kind) v = this.rebuildPiece(v, kind);
            if (!v || v === this.dragging || v === this.selected || v.mode === 'hop' || v.pendingField) continue;
            if (ps.held_by && ps.held_by !== this.client.you) {
                if (v.mode !== 'held') this.onGrabbedByOther(id);
            } else if (v.mode !== 'rest') {
                this.flyTo(v, this.fieldPos(ps.field), false);
            } else {
                v.pos.copy(this.fieldPos(ps.field));
                this.place(v);
            }
        }
        this.table.invalidate();
    }

    private build(layout: Layout): void {
        this.layout = layout;
        this.spacing = layout.board?.spacing ?? 0.8;
        for (const v of this.vis.values()) this.group.remove(v.obj);
        this.vis.clear();
        for (const [id, spec] of Object.entries(layout.pieces)) {
            const kind = this.client.state?.pieces[id]?.kind || spec.kind;
            const obj = this.makeMesh(id, spec, kind, layout);
            const pos = this.fieldPos(spec.field);
            const v: Vis = { id, obj, kind, mode: 'rest', pos, goal: pos.clone(), tilt: new THREE.Vector2() };
            this.place(v);
            this.group.add(obj);
            this.vis.set(id, v);
        }
    }

    private makeMesh(id: string, spec: PieceSpec, kind: string, layout: Layout): THREE.Object3D {
        const obj = this.opts.createMesh(id, { ...spec, kind }, layout);
        // Großzügige, unsichtbare Trefferfläche (für Finger)
        const r = Math.min(0.34, this.spacing * 0.42);
        const hit = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r, 0.85, 12),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hit.position.y = 0.42;
        obj.add(hit);
        obj.userData.pieceId = id;
        obj.traverse(o => { o.userData.pieceId = id; });
        return obj;
    }

    /** Figur bekommt eine neue Art (Bauer → Dame): Modell tauschen, Position und Bewegung bleiben. */
    private rebuildPiece(v: Vis, kind: string): Vis {
        const spec = this.layout?.pieces[v.id];
        if (!spec || !this.layout) return v;
        this.group.remove(v.obj);
        v.obj = this.makeMesh(v.id, spec, kind, this.layout);
        v.kind = kind;
        this.place(v);
        this.group.add(v.obj);
        knock(0.4, 1.3);
        this.table.invalidate();
        return v;
    }

    fieldPos(fieldId: string): THREE.Vector3 {
        const f: FieldSpec | undefined = this.layout?.fields[fieldId];
        return new THREE.Vector3(f?.x ?? 0, this.opts.surfaceY, f?.z ?? 0);
    }

    private place(v: Vis): void {
        v.obj.position.copy(v.pos);
        v.obj.rotation.set(v.tilt.y, 0, -v.tilt.x);
    }

    // ---------- Eingabe ----------
    private canTouch(id: string): boolean {
        const s = this.lastState, me = this.client.me;
        const spec = s?.layout.pieces[id], ps = s?.pieces[id];
        if (!s || !me || me.seat === null || !spec || !ps) return false;
        const targets = this.client.legalTargets(id);
        if (targets !== null && targets.length === 0) return false;     // mit Regeln: nur Figuren mit Zug
        return spec.seat === me.seat && (ps.held_by === null || ps.held_by === this.client.you);
    }

    /** Erlaubte Ziele (mit Regeln) bzw. alle freien Felder (freier Tisch) */
    private candidates(id: string): string[] {
        const s = this.lastState;
        if (!s) return [];
        const legal = this.client.legalTargets(id);
        if (legal !== null) return legal;
        const occupied = new Set(Object.entries(s.pieces).filter(([pid]) => pid !== id).map(([, ps]) => ps.field));
        return Object.keys(s.layout.fields).filter(f => !occupied.has(f));
    }

    private ring(color: number, inner: number, outer: number, opacity: number): THREE.Mesh {
        const m = new THREE.Mesh(
            new THREE.RingGeometry(inner, outer, 40),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        this.table.scene.add(m);
        return m;
    }

    private showTargets(fields: string[]): void {
        while (this.targetRings.length < fields.length) this.targetRings.push(this.ring(0xffe6a8, 0.27, 0.33, 0.55));
        this.targetRings.forEach((r, i) => {
            r.visible = i < fields.length;
            if (r.visible) {
                const p = this.fieldPos(fields[i]);
                r.position.set(p.x, this.opts.surfaceY + 0.004, p.z);
            }
        });
        this.table.invalidate();
    }

    /** Dezenter Ring unter Figuren, die jetzt ziehen dürfen (statisch → kein Dauer-Rendern) */
    private updateHints(): void {
        const s = this.lastState, me = this.client.me;
        const movable = new Set<string>();
        if (s?.status === 'playing' && me && this.client.myTurn && s.play?.phase === 'move') {
            for (const m of s.play.moves ?? []) movable.add(m.piece);
        }
        for (const [id, r] of this.hintRings) {
            if (!movable.has(id)) { this.table.scene.remove(r); this.hintRings.delete(id); }
        }
        for (const id of movable) {
            if (!this.hintRings.has(id)) this.hintRings.set(id, this.ring(0xfff4d6, 0.29, 0.36, 0.7));
            const v = this.vis.get(id), r = this.hintRings.get(id)!;
            const p = v && v.mode === 'rest' ? v.pos : this.fieldPos(s!.pieces[id].field);
            r.position.set(p.x, this.opts.surfaceY + 0.004, p.z);
            r.visible = v !== this.dragging && v !== this.selected;
        }
        this.table.invalidate();
    }

    private onPointerDown(ev: PointerEvent): void {
        if (this.dragging || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
        const hits = this.table.pickObjects(ev.clientX, ev.clientY, [...this.vis.values()].map(v => v.obj));
        const id = hits.map(h => h.object.userData.pieceId as string | undefined).find(x => x && this.canTouch(x));
        const sel = this.selected;
        this.dragWasSelected = false;
        if (sel) {
            if (id === sel.id) {
                this.dragWasSelected = true;               // ausgewählte Figur: weiterziehen oder antippen = zurücklegen
            } else {
                const field = this.nearestCandidate(sel.id, ev.clientX, ev.clientY);
                // Ziel angetippt (auch wenn dort eine fremde Figur steht, die geschlagen wird)
                if (field && !id) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    this.selected = null;
                    this.commit(sel, field);
                    return;
                }
                this.cancelSelection();
            }
        }
        if (!id) return;                                   // nichts Greifbares → Kamera darf drehen
        ev.stopPropagation();
        ev.preventDefault();
        const v = this.vis.get(id)!;
        if (v === this.selected) this.selected = null;
        this.dragging = v;
        this.downAt.set(ev.clientX, ev.clientY);
        this.dragDist = 0;
        this.showTargets(this.client.legalTargets(id) ?? []);
        const hint = this.hintRings.get(id);
        if (hint) hint.visible = false;
        v.mode = 'drag';
        v.goal.copy(v.pos).setY(this.opts.surfaceY + this.lift);
        this.client.grab(id);
        lift();
        vibrate(8);
        this.kick();

        const el = this.table.renderer.domElement;
        try { el.setPointerCapture(ev.pointerId); } catch { /* egal */ }
        const move = (e: PointerEvent) => this.onDragMove(e);
        const up = (e: PointerEvent) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            this.onDragEnd(e.type === 'pointercancel');
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    }

    private onDragMove(ev: PointerEvent): void {
        const v = this.dragging;
        if (!v) return;
        this.dragDist = Math.max(this.dragDist, this.downAt.distanceTo(new THREE.Vector2(ev.clientX, ev.clientY)));
        const p = this.table.pickPlane(ev.clientX, ev.clientY, this.opts.surfaceY);
        if (!p) return;
        const lim = this.table.tableSize / 2 - 0.4;
        p.x = THREE.MathUtils.clamp(p.x, -lim, lim);
        p.z = THREE.MathUtils.clamp(p.z, -lim, lim);
        v.goal.set(p.x, this.opts.surfaceY + this.lift, p.z);
        this.updateSnap(v, p);
        this.client.sendPresence({ x: p.x, z: p.z, down: true, hold: v.id });
        this.kick();
    }

    /** Erlaubtes Ziel unter dem Finger (großzügig: bis 0,6 Feldbreiten daneben) */
    private nearestCandidate(id: string, clientX: number, clientY: number): string | null {
        const s = this.lastState;
        const p = this.table.pickPlane(clientX, clientY, this.opts.surfaceY);
        if (!s || !p) return null;
        let best: string | null = null, bestD = this.spacing * 0.6;
        for (const fid of this.candidates(id)) {
            const f = s.layout.fields[fid];
            if (!f) continue;
            const d = Math.hypot(f.x - p.x, f.z - p.z);
            if (d < bestD) { bestD = d; best = fid; }
        }
        return best;
    }

    /** Auswahl aufheben: Figur sinkt zurück aufs Feld */
    private cancelSelection(): void {
        const v = this.selected;
        if (!v) return;
        this.selected = null;
        this.showTargets([]);
        this.client.release(v.id);
        this.flyTo(v, this.fieldPos(this.lastState?.pieces[v.id]?.field ?? ''), true);
        this.updateHints();
    }

    /** Figur auf ein Feld setzen (Server entscheidet; abgelehnt → gleitet zurück) */
    private commit(v: Vis, field: string): void {
        this.showTargets([]);
        v.pendingField = field;
        this.client.drop(v.id, field);
        this.flyTo(v, this.fieldPos(field), true);
        vibrate(14);
        this.table.invalidate();
    }

    private updateSnap(v: Vis, p: THREE.Vector3): void {
        const s = this.lastState;
        let best: string | null = null, bestD = this.spacing * 0.6;
        if (s) {
            for (const fid of this.candidates(v.id)) {
                const f = s.layout.fields[fid];
                if (!f) continue;
                const d = Math.hypot(f.x - p.x, f.z - p.z);
                if (d < bestD) { bestD = d; best = fid; }
            }
        }
        if (best !== this.snapField) {
            this.snapField = best;
            if (best) {
                const fp = this.fieldPos(best);
                this.snapRing.position.set(fp.x, this.opts.surfaceY + 0.006, fp.z);
                vibrate(4);
            }
            this.snapRing.visible = !!best;
            this.table.invalidate();
        }
    }

    private onDragEnd(cancelled: boolean): void {
        const v = this.dragging;
        this.dragging = null;
        this.snapRing.visible = false;
        this.showTargets([]);
        if (!v) return;
        let field = cancelled ? null : this.snapField;
        this.snapField = null;
        const tapped = !cancelled && this.dragDist < 8;
        // Antippen statt Ziehen: Gibt es genau ein erlaubtes Ziel, dorthin ziehen
        if (tapped) {
            const legal = this.client.legalTargets(v.id) ?? this.candidates(v.id);
            if (legal.length === 1 && this.client.legalTargets(v.id) !== null) {
                field = legal[0];
            } else if (legal.length > 0 && !this.dragWasSelected) {
                // Mehrere Ziele: Figur bleibt angehoben, Ziele leuchten – nächster Tipp wählt
                this.selected = v;
                v.mode = 'selected';
                v.goal.copy(this.fieldPos(this.lastState?.pieces[v.id]?.field ?? '')).setY(this.opts.surfaceY + this.lift * 0.6);
                this.showTargets(legal);
                this.kick();
                return;
            } else {
                field = null;                       // ausgewählte Figur erneut angetippt → zurücklegen
            }
        }
        const current = this.lastState?.pieces[v.id]?.field;
        if (field && field !== current) {
            this.commit(v, field);
        } else {
            this.client.release(v.id);
            this.flyTo(v, this.fieldPos(current ?? ''), true);
        }
        this.table.invalidate();
    }

    // ---------- Server-Ereignisse ----------
    private onMoved(id: string, to: string, by: string, path?: string[], reason?: string): void {
        const v = this.vis.get(id);
        if (!v) return;
        if (v === this.selected) { this.selected = null; this.showTargets([]); }
        if (by === this.client.you && v.pendingField === to) {
            v.pendingField = undefined;          // bestätigt – Animation läuft schon
            return;
        }
        v.pendingField = undefined;
        if (reason === 'captured') {
            // Geschlagen: hoher Bogen zurück ins Häuschen
            this.flyTo(v, this.fieldPos(to), true, { height: 1.4, dur: 0.75 });
            return;
        }
        if (path && path.length > 1 && v.mode !== 'held') {
            // Feld für Feld hüpfen (Züge anderer, Computer)
            const pts = path.map(f => this.fieldPos(f));
            v.queue = pts.slice(1);
            this.flyTo(v, pts[0], true, { height: 0.3, dur: 0.2 });
            return;
        }
        this.flyTo(v, this.fieldPos(to), true);
    }

    private onGrabbedByOther(id: string): void {
        const v = this.vis.get(id);
        if (!v || v === this.dragging) return;
        v.mode = 'held';
        v.goal.copy(v.pos).setY(this.opts.surfaceY + this.lift);
        this.kick();
    }

    private onReleased(id: string): void {
        const v = this.vis.get(id);
        if (!v || v === this.dragging || v.pendingField) return;
        if (v.mode === 'held') {
            const field = this.lastState?.pieces[id]?.field;
            if (field) this.flyTo(v, this.fieldPos(field), false);
        }
    }

    private rejectDrop(id: string): void {
        const v = this.vis.get(id);
        if (!v) return;
        v.pendingField = undefined;
        const field = this.lastState?.pieces[id]?.field;
        if (field) this.flyTo(v, this.fieldPos(field), false);
        vibrate([20, 40, 20]);
    }

    // ---------- Animation ----------
    private flyTo(v: Vis, to: THREE.Vector3, sound: boolean, opt?: { height?: number; dur?: number }): void {
        const dist = Math.hypot(to.x - v.pos.x, to.z - v.pos.z);
        v.mode = 'hop';
        v.hop = {
            from: v.pos.clone(), to: to.clone(), t: 0,
            dur: opt?.dur ?? HOP_DURATION + Math.min(0.35, dist * 0.04),
            height: opt?.height ?? Math.max(0.15, Math.min(0.6, dist * 0.12)) + Math.max(0, v.pos.y - this.opts.surfaceY) * 0.4,
            sound
        };
        this.kick();
    }

    private kick(): void {
        if (this.animating) return;
        this.animating = true;
        this.table.addAnimator(dt => {
            let busy = false;
            for (const v of this.vis.values()) {
                if (v.mode === 'rest') continue;
                // Ausgewählt und angekommen: schwebt still – kein Dauer-Rendern
                if (v.mode === 'selected' && v.pos.distanceTo(v.goal) < 0.002 && v.tilt.lengthSq() < 1e-6) continue;
                busy = true;
                if (v.mode === 'hop' && v.hop) {
                    const h = v.hop;
                    h.t = Math.min(1, h.t + dt / h.dur);
                    const k = 1 - Math.pow(1 - h.t, 2.2);                    // weich abbremsen
                    v.pos.lerpVectors(h.from, h.to, k);
                    v.pos.y = THREE.MathUtils.lerp(h.from.y, h.to.y, k) + Math.sin(Math.PI * h.t) * h.height;
                    v.tilt.multiplyScalar(Math.max(0, 1 - dt * 10));
                    if (h.t >= 1) {
                        const next = v.queue?.shift();
                        if (h.sound) knock(next || v.queue ? 0.35 : 0.55, next ? 1.1 : 1);
                        if (next) {
                            v.hop = { from: v.pos.clone(), to: next, t: 0, dur: 0.2, height: 0.3, sound: true };
                        } else {
                            v.mode = 'rest';
                            v.hop = undefined;
                            v.queue = undefined;
                            v.tilt.set(0, 0);
                            this.updateHints();
                        }
                    }
                } else {
                    // drag/held/selected: weich dem Ziel folgen und in Bewegungsrichtung neigen
                    const before = v.pos.clone();
                    v.pos.lerp(v.goal, 1 - Math.exp(-dt * (v.mode === 'drag' ? 22 : 12)));
                    const vel = v.pos.clone().sub(before).divideScalar(Math.max(dt, 1e-3));
                    const tx = THREE.MathUtils.clamp(vel.x * 0.05, -0.35, 0.35);
                    const tz = THREE.MathUtils.clamp(vel.z * 0.05, -0.35, 0.35);
                    v.tilt.lerp(new THREE.Vector2(tx, tz), 1 - Math.exp(-dt * 10));
                }
                this.place(v);
            }
            this.animating = busy;
            return busy;
        });
    }

    // ---------- Für Tests ----------
    /** Bildschirmposition einer Figur (Mitte des Körpers) */
    screenPos(id: string): { x: number; y: number } | null {
        const v = this.vis.get(id);
        if (!v) return null;
        const p = v.pos.clone().setY(v.pos.y + 0.3).project(this.table.camera);
        const rect = this.table.renderer.domElement.getBoundingClientRect();
        return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
    }

    fieldScreenPos(fieldId: string): { x: number; y: number } {
        const p = this.fieldPos(fieldId).project(this.table.camera);
        const rect = this.table.renderer.domElement.getBoundingClientRect();
        return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
    }

    isResting(): boolean {
        return [...this.vis.values()].every(v => v.mode === 'rest');
    }

    modeOf(id: string): Mode | undefined {
        return this.vis.get(id)?.mode;
    }

    /** angetippte Figur, die auf ein Ziel wartet (oder null) */
    selectedId(): string | null {
        return this.selected?.id ?? null;
    }

    /** Art, mit der das Modell gerade gebaut ist (Test: Umwandlung) */
    kindOf(id: string): string | undefined {
        return this.vis.get(id)?.kind;
    }
}
