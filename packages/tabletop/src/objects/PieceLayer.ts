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
 *  - Zonen (Engine 2.4): Auf einem Stapel liegen Karten übereinander, eine Hand fächert sich am Platz auf (die eigene
 *    kippt zum Spieler hin, spielbare Karten rücken etwas vor), eine Auslage liegt in einer Reihe. Wird eine Karte
 *    sichtbar (oder wieder verdeckt), dreht sie sich im Flug um.
 *
 * Spielneutral: Welche Figur wie aussieht, kommt per `createMesh` vom Spiel.
 */
import * as THREE from 'three';
import type { TableScene } from '../engine/TableScene';
import type { TableClient } from '../net/TableClient';
import type { FieldSpec, Layout, PieceSpec, TableState } from '../net/state';
import { knock, lift, vibrate } from '../audio/sfx';
import { CARD_H } from './cards';

export interface PieceLayerOptions {
    /** Höhe der Oberfläche, auf der Figuren stehen (z. B. Brettoberkante); Funktion = kann sich ändern (anderes Brett) */
    surfaceY: number | (() => number);
    /** 3D-Objekt für eine Figur (Ursprung = Mitte des Fußes) */
    createMesh: (id: string, spec: PieceSpec, layout: Layout) => THREE.Object3D;
    /** Wie hoch eine gehaltene Figur schwebt */
    liftHeight?: number;
}

type Mode = 'rest' | 'drag' | 'held' | 'hop' | 'selected';

/** Lage eines Gegenstands: Ort + Drehung (yaw um die Hochachse, pitch = zum Spieler kippen, roll = umdrehen) */
interface Base { yaw: number; pitch: number; roll: number; scale?: number }
interface Pose extends Base { pos: THREE.Vector3 }
const FLAT: Base = { yaw: 0, pitch: 0, roll: 0, scale: 1 };

/** kleine, feste Unordnung je Karte (Stapel sehen sonst wie gedruckt aus) */
function jitter(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return ((h % 1000) / 1000) * 0.08;
}

interface Vis {
    id: string;
    obj: THREE.Object3D;
    kind: string;               // Art, mit der das Modell gebaut wurde
    show: string;               // Vorderseite, mit der das Modell gebaut wurde ('' = unbekannt)
    base: Base;                 // Drehung in Ruhe (Zonen)
    s0: number;                 // Grundgröße des Modells
    mode: Mode;
    pos: THREE.Vector3;         // aktuelle Position (Fuß)
    goal: THREE.Vector3;        // Ziel beim Folgen (drag/held)
    hop?: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; height: number; sound: boolean; b0: Base; b1: Base };
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
    private get surfaceY(): number {
        const s = this.opts.surfaceY;
        return typeof s === 'function' ? s() : s;
    }
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
            if (ev.type === 'PIECE_MOVED') this.onMoved(ev.piece, ev.to, ev.by, ev.path, ev.reason, ev.order);
            else if (ev.type === 'PIECE_GRABBED' && ev.by !== client.you) this.onGrabbedByOther(ev.piece);
            else if (ev.type === 'PIECE_RELEASED') this.onReleased(ev.piece);
        });
        client.onPresence((from, p) => {
            if (!p?.hold) return;
            const v = this.vis.get(p.hold);
            if (v && v.mode === 'held' && this.lastState?.pieces[p.hold]?.held_by === from) {
                v.goal.set(p.x, this.surfaceY + this.lift, p.z);
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
            if (v && kind && (kind !== v.kind || (ps.show ?? '') !== v.show)) v = this.rebuildPiece(v, kind, ps.show ?? '');
            if (!v || v === this.dragging || v === this.selected || v.mode === 'hop' || v.pendingField) continue;
            if (ps.held_by && ps.held_by !== this.client.you) {
                if (v.mode !== 'held') this.onGrabbedByOther(id);
            } else if (v.mode !== 'rest') {
                this.flyTo(v, this.restPose(id), false);
            } else {
                // In Ruhe: rückt nach, wenn sich die Zone geändert hat (Hand fächert neu auf)
                const pose = this.restPose(id);
                if (pose.pos.distanceTo(v.pos) > 0.004 || Math.abs(pose.yaw - v.base.yaw) + Math.abs(pose.pitch - v.base.pitch)
                    + Math.abs((pose.scale ?? 1) - (v.base.scale ?? 1)) > 0.01) {
                    this.flyTo(v, pose, false, { height: 0.04, dur: 0.22 });
                }
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
            const show = this.client.state?.pieces[id]?.show ?? '';
            const obj = this.makeMesh(id, spec, kind, layout);
            const pose = this.restPose(id, this.client.state ?? undefined);
            const v: Vis = { id, obj, kind, show, base: { ...pose, roll: 0 }, s0: obj.scale.x, mode: 'rest',
                pos: pose.pos, goal: pose.pos.clone(), tilt: new THREE.Vector2() };
            this.place(v);
            this.group.add(obj);
            this.vis.set(id, v);
        }
    }

    private makeMesh(id: string, spec: PieceSpec, kind: string, layout: Layout): THREE.Object3D {
        const obj = this.opts.createMesh(id, { ...spec, kind }, layout);
        if (kind !== 'card') {
            // Großzügige, unsichtbare Trefferfläche (für Finger); Karten sind selbst groß genug
            const r = Math.min(0.34, this.spacing * 0.42);
            const hit = new THREE.Mesh(
                new THREE.CylinderGeometry(r, r, 0.85, 12),
                new THREE.MeshBasicMaterial({ visible: false })
            );
            hit.position.y = 0.42;
            obj.add(hit);
        }
        obj.userData.pieceId = id;
        obj.traverse(o => { o.userData.pieceId = id; });
        return obj;
    }

    /** Figur bekommt eine neue Art (Bauer → Dame) oder eine Karte wird sichtbar/verdeckt: Modell tauschen,
     *  Position und Bewegung bleiben; Karten drehen sich dabei um. */
    private rebuildPiece(v: Vis, kind: string, show: string): Vis {
        const spec = this.layout?.pieces[v.id];
        if (!spec || !this.layout) return v;
        const flipped = kind === v.kind && show !== v.show;
        this.group.remove(v.obj);
        v.obj = this.makeMesh(v.id, spec, kind, this.layout);
        v.s0 = v.obj.scale.x;
        v.kind = kind;
        v.show = show;
        if (flipped) {
            if (v.mode === 'hop' && v.hop) v.hop.b0 = { ...v.hop.b0, roll: Math.PI };
            else if (v.mode === 'rest') this.flyTo(v, { pos: v.pos.clone(), ...v.base }, false, { height: 0.25, dur: 0.35, roll: Math.PI });
        } else {
            knock(0.4, 1.3);
        }
        this.place(v);
        this.group.add(v.obj);
        this.table.invalidate();
        return v;
    }

    fieldPos(fieldId: string): THREE.Vector3 {
        const f: FieldSpec | undefined = this.layout?.fields[fieldId];
        return new THREE.Vector3(f?.x ?? 0, this.surfaceY, f?.z ?? 0);
    }

    /** Ruhelage eines Gegenstands – auf einem Feld bzw. in seiner Zone (Stapel, Hand, Auslage). */
    restPose(id: string, s: TableState | undefined = this.lastState ?? undefined, field?: string, order?: number): Pose {
        const ps = s?.pieces[id];
        const fid = field ?? ps?.field ?? '';
        const f = this.layout?.fields[fid];
        const pos = this.fieldPos(fid);
        if (!s || !f?.zone) return { pos, ...FLAT };
        const show = (pid: string) => s.pieces[pid]?.show ?? null;
        const mates = Object.entries(s.pieces).filter(([pid, p]) => pid !== id && p.field === fid)
            .map(([pid, p]) => ({ pid, order: p.order ?? 0 }));
        mates.push({ pid: id, order: order ?? ps?.order ?? 0 });
        const mine = f.zone === 'hand' && f.owner != null && f.owner === this.client.me?.seat;
        const cat = Object.keys((s.layout as { cards?: Record<string, unknown> }).cards ?? {});
        mates.sort((a, b) => {
            const fa = show(a.pid), fb = show(b.pid);
            if (mine && fa && fb) return cat.indexOf(fa) - cat.indexOf(fb);       // eigene Hand: sortiert
            return a.order - b.order || (a.pid < b.pid ? -1 : 1);
        });
        const i = mates.findIndex(m => m.pid === id), n = mates.length;
        if (f.zone === 'stack') {
            pos.y += i * 0.012;
            return { pos, yaw: jitter(id) - 0.04, pitch: 0, roll: 0 };
        }
        const yaw = -THREE.MathUtils.degToRad(f.angle ?? 0);
        const tx = Math.cos(yaw), tz = -Math.sin(yaw);          // entlang der Tischkante
        const ox = Math.sin(yaw), oz = Math.cos(yaw);           // zum Besitzer hin
        if (f.zone === 'row') {
            const off = (i - (n - 1) / 2) * 0.7;
            pos.x += tx * off; pos.z += tz * off;
            return { pos, yaw, pitch: 0, roll: 0 };
        }
        // Hand: aufgefächert; die eigene kippt zum Spieler, spielbare Karten rücken etwas vor
        const step = Math.min(0.42, 3.4 / Math.max(1, n));
        const off = (i - (n - 1) / 2) * step;
        pos.x += tx * off + ox * i * 0.012;
        pos.z += tz * off + oz * i * 0.012;
        pos.y += i * 0.004;
        if (!mine) return { pos, yaw: yaw - (i - (n - 1) / 2) * 0.05, pitch: 0, roll: 0 };
        // Eigene Hand: größer, näher an der eigenen Tischkante, zum Spieler gekippt (am Handy gut lesbar)
        const scale = 1.45, pitch = 0.85;
        const big = Math.min(0.42 * scale, 4.6 / Math.max(1, n)), off2 = (i - (n - 1) / 2) * big;
        pos.copy(this.fieldPos(fid));
        pos.x += tx * off2 + ox * (0.75 + i * 0.014);
        pos.z += tz * off2 + oz * (0.75 + i * 0.014);
        pos.y += i * 0.006 + Math.sin(pitch) * CARD_H * scale / 2 + 0.02;
        if ((s.play?.moves ?? []).some(m => m.piece === id) && s.status === 'playing') {
            pos.x -= ox * 0.22; pos.z -= oz * 0.22; pos.y += 0.08;     // spielbare Karten rücken vor
        }
        return { pos, yaw, pitch, roll: 0, scale };
    }

    private place(v: Vis): void {
        v.obj.position.copy(v.pos);
        v.obj.rotation.set(v.base.pitch + v.tilt.y, v.base.yaw, v.base.roll - v.tilt.x, 'YXZ');
        v.obj.scale.setScalar(v.s0 * (v.base.scale ?? 1));
    }

    // ---------- Eingabe ----------
    private canTouch(id: string): boolean {
        const s = this.lastState, me = this.client.me;
        const spec = s?.layout.pieces[id], ps = s?.pieces[id];
        if (!s || !me || me.seat === null || !spec || !ps) return false;
        if (ps.held_by !== null && ps.held_by !== this.client.you) return false;
        const targets = this.client.legalTargets(id);
        // Mit Regeln entscheiden allein die erlaubten Züge (Team-Figuren, Figuren mit neuem Besitzer);
        // freier Tisch: nur eigene Figuren
        if (targets !== null) return targets.length > 0;
        return spec.seat === me.seat;
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
                r.position.set(p.x, this.surfaceY + 0.004, p.z);
            }
        });
        this.table.invalidate();
    }

    /** Dezenter Ring unter Figuren, die jetzt ziehen dürfen (statisch → kein Dauer-Rendern) */
    private updateHints(): void {
        const s = this.lastState, me = this.client.me;
        const movable = new Set<string>();
        if (s?.status === 'playing' && me && this.client.myTurn) {
            for (const m of s.play?.moves ?? []) movable.add(m.piece);
        }
        for (const [id, r] of this.hintRings) {
            if (!movable.has(id)) { this.table.scene.remove(r); this.hintRings.delete(id); }
        }
        for (const id of [...movable]) {
            if (s?.layout.pieces[id]?.kind === 'card') { movable.delete(id); continue; }   // Karten rücken stattdessen vor
        }
        for (const [id, r] of this.hintRings) {
            if (!movable.has(id)) { this.table.scene.remove(r); this.hintRings.delete(id); }
        }
        for (const id of movable) {
            if (!this.hintRings.has(id)) this.hintRings.set(id, this.ring(0xfff4d6, 0.29, 0.36, 0.7));
            const v = this.vis.get(id), r = this.hintRings.get(id)!;
            const p = v && v.mode === 'rest' ? v.pos : this.restPose(id).pos;
            r.position.set(p.x, this.surfaceY + 0.004, p.z);
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
        v.base = { ...v.base, pitch: 0, scale: 1 };       // gekippte Handkarte liegt beim Ziehen flach
        v.goal.copy(v.pos).setY(this.surfaceY + this.lift);
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
        const p = this.table.pickPlane(ev.clientX, ev.clientY, this.surfaceY);
        if (!p) return;
        const lim = this.table.tableSize / 2 - 0.4;
        p.x = THREE.MathUtils.clamp(p.x, -lim, lim);
        p.z = THREE.MathUtils.clamp(p.z, -lim, lim);
        v.goal.set(p.x, this.surfaceY + this.lift, p.z);
        this.updateSnap(v, p);
        this.client.sendPresence({ x: p.x, z: p.z, down: true, hold: v.id });
        this.kick();
    }

    /** Erlaubtes Ziel unter dem Finger (großzügig: bis 0,6 Feldbreiten daneben) */
    private nearestCandidate(id: string, clientX: number, clientY: number): string | null {
        const s = this.lastState;
        const p = this.table.pickPlane(clientX, clientY, this.surfaceY);
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
        this.flyTo(v, this.restPose(v.id), true);
        this.updateHints();
    }

    /** Figur auf ein Feld setzen (Server entscheidet; abgelehnt → gleitet zurück) */
    private commit(v: Vis, field: string): void {
        this.showTargets([]);
        v.pendingField = field;
        this.client.drop(v.id, field);
        this.flyTo(v, this.restPose(v.id, this.lastState ?? undefined, field, 1e6), true);
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
                this.snapRing.position.set(fp.x, this.surfaceY + 0.006, fp.z);
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
                v.goal.copy(this.restPose(v.id).pos).setY(this.surfaceY + this.lift * 0.6);
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
            this.flyTo(v, this.restPose(v.id), true);
        }
        this.table.invalidate();
    }

    // ---------- Server-Ereignisse ----------
    private onMoved(id: string, to: string, by: string, path?: string[], reason?: string, order?: number): void {
        const v = this.vis.get(id);
        if (!v) return;
        if (v === this.selected) { this.selected = null; this.showTargets([]); }
        if (by === this.client.you && v.pendingField === to) {
            v.pendingField = undefined;          // bestätigt – Animation läuft schon
            return;
        }
        v.pendingField = undefined;
        const target = this.restPose(id, this.lastState ?? undefined, to, order ?? 1e6);
        if (reason === 'captured') {
            // Geschlagen: hoher Bogen zurück ins Häuschen
            this.flyTo(v, target, true, { height: 1.4, dur: 0.75 });
            return;
        }
        if (this.layout?.fields[to]?.zone) {
            this.flyTo(v, target, true, { height: 0.5 });
            return;
        }
        if (path && path.length > 1 && v.mode !== 'held') {
            // Feld für Feld hüpfen (Züge anderer, Computer)
            const pts = path.map(f => this.fieldPos(f));
            v.queue = pts.slice(1);
            this.flyTo(v, pts[0], true, { height: 0.3, dur: 0.2 });
            return;
        }
        this.flyTo(v, target, true);
    }

    private onGrabbedByOther(id: string): void {
        const v = this.vis.get(id);
        if (!v || v === this.dragging) return;
        v.mode = 'held';
        v.goal.copy(v.pos).setY(this.surfaceY + this.lift);
        this.kick();
    }

    private onReleased(id: string): void {
        const v = this.vis.get(id);
        if (!v || v === this.dragging || v.pendingField) return;
        if (v.mode === 'held') {
            if (this.lastState?.pieces[id]) this.flyTo(v, this.restPose(id), false);
        }
    }

    private rejectDrop(id: string): void {
        const v = this.vis.get(id);
        if (!v) return;
        v.pendingField = undefined;
        if (this.lastState?.pieces[id]) this.flyTo(v, this.restPose(id), false);
        vibrate([20, 40, 20]);
    }

    // ---------- Animation ----------
    private flyTo(v: Vis, target: THREE.Vector3 | Pose, sound: boolean, opt?: { height?: number; dur?: number; roll?: number }): void {
        const to = target instanceof THREE.Vector3 ? target : target.pos;
        const b1: Base = target instanceof THREE.Vector3 ? { ...FLAT }
            : { yaw: target.yaw, pitch: target.pitch, roll: 0, scale: target.scale ?? 1 };
        const dist = Math.hypot(to.x - v.pos.x, to.z - v.pos.z);
        v.mode = 'hop';
        v.hop = {
            b0: { ...v.base, roll: opt?.roll ?? v.base.roll }, b1,
            from: v.pos.clone(), to: to.clone(), t: 0,
            dur: opt?.dur ?? HOP_DURATION + Math.min(0.35, dist * 0.04),
            height: opt?.height ?? Math.max(0.15, Math.min(0.6, dist * 0.12)) + Math.max(0, v.pos.y - this.surfaceY) * 0.4,
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
                    v.base = {
                        yaw: THREE.MathUtils.lerp(h.b0.yaw, h.b1.yaw, k), pitch: THREE.MathUtils.lerp(h.b0.pitch, h.b1.pitch, k),
                        roll: THREE.MathUtils.lerp(h.b0.roll, h.b1.roll, Math.min(1, h.t * 1.3)),
                        scale: THREE.MathUtils.lerp(h.b0.scale ?? 1, h.b1.scale ?? 1, k)
                    };
                    v.tilt.multiplyScalar(Math.max(0, 1 - dt * 10));
                    if (h.t >= 1) {
                        const next = v.queue?.shift();
                        if (h.sound) knock(next || v.queue ? 0.35 : 0.55, next ? 1.1 : 1);
                        if (next) {
                            v.hop = { from: v.pos.clone(), to: next, t: 0, dur: 0.2, height: 0.3, sound: true, b0: { ...v.base }, b1: { ...v.base } };
                        } else {
                            v.mode = 'rest';
                            v.hop = undefined;
                            v.queue = undefined;
                            v.tilt.set(0, 0);
                            this.updateHints();
                            // Zone hat sich unterwegs geändert (Hand neu aufgefächert) → nachrücken
                            if (this.lastState?.pieces[v.id] && !v.pendingField) {
                                const pose = this.restPose(v.id);
                                if (pose.pos.distanceTo(v.pos) > 0.004) this.flyTo(v, pose, false, { height: 0.04, dur: 0.2 });
                            }
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
        // Karten: Mitte der Karte (auch gekippt in der Hand); Figuren: Mitte des Körpers
        const p = (v.kind === 'card' ? new THREE.Box3().setFromObject(v.obj).getCenter(new THREE.Vector3())
            : v.pos.clone().setY(v.pos.y + 0.3)).project(this.table.camera);
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
