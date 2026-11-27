/**
 * Würfeln wie am echten Tisch: Becher greifen, schütteln (Maus/Finger oder Handy schütteln), loslassen.
 *
 * Fälschungssicher und trotzdem echt: Der Server bestimmt die Augenzahl. Jeder Client rechnet den Wurf mit
 * denselben Startwerten (Sitzplatz, Stärke, Seed) vorab mit Physik durch, schaut welche Seite oben liegt und
 * dreht das *Aussehen* des Würfels unsichtbar so, dass oben die Server-Zahl landet. Dann wird die
 * aufgezeichnete Bahn abgespielt – inkl. Aufprall-Geräuschen.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import type { TableScene } from '../engine/TableScene';
import type { TableClient } from '../net/TableClient';
import type { TableState } from '../net/state';
import { seededRandom } from '../engine/materials';
import { knock, vibrate } from '../audio/sfx';
import { createDie, normalForValue, topValue } from './dieMesh';
import { createCup } from './cup';

export interface Obstacle {
    /** Mittelpunkt und Maße eines Hindernisses auf dem Tisch (z. B. das Brett); r: rund (Radius) statt w×d */
    x: number; z: number; w: number; d: number; h: number; r?: number;
}

export interface DiceLayerOptions {
    /** Hindernisse, an denen Würfel abprallen (das Brett) */
    obstacles?: Obstacle[];
    dieSize?: number;
}

interface Frame { p: Float32Array; q: Float32Array; }       // je Würfel 3 bzw. 4 Werte
interface Impact { frame: number; speed: number; }
interface Recording { frames: Frame[]; impacts: Impact[]; corrections: THREE.Quaternion[]; values: number[]; }

const STEP = 1 / 240;
const RECORD_EVERY = 2;                 // → 120 Bilder/s Aufnahme
const MAX_SECONDS = 6;
const GRAVITY = -60;                    // Tisch-Einheiten/s² (1 Einheit ≈ 1,6 cm → wirkt wie echte Schwerkraft)
const AUTO_SHAKE_SECONDS = 0.6;       // Computer/Würfeln-Knopf: so lange wird der Becher vorher geschüttelt
const TIP_ANGLE = 1.9;                 // Becher kippt beim Auswerfen um ~110°

export class DiceLayer {
    private dice: THREE.Mesh[] = [];
    /** Der eine Becher am Tisch – wer ihn hat, ist dran */
    private cup: THREE.Group;
    /** Platz, an dem der Becher steht (bzw. zu dem er gerade wandert) */
    private cupSeat: number | null = null;
    /** Becher wird weitergereicht: Bogen um das Brett herum */
    private travel: { from: number; delta: number; t: number; dur: number } | null = null;
    /** In der Lobby: wer zuletzt gewürfelt/den Becher genommen hat */
    private lobbyHolder: number | null = null;
    private tipT: number | null = null;
    /** Wo der Becher gerade steht (ohne Schütteln/Kippen) */
    private cupBase = new THREE.Vector3();
    private recording: Recording | null = null;
    private playTime = 0;
    private nextImpact = 0;
    private playing = false;
    private lastRollKey = '';
    private holding: { power: number; last: THREE.Vector2; t: number; motion: (e: DeviceMotionEvent) => void } | null = null;
    private shakingOthers = new Map<number, number>();      // Sitzplatz → Zeit des letzten Schüttel-Signals
    /** Würfel werden gerade vom Tisch in einen Becher eingesammelt */
    private gather: { seat: number; t: number; from: THREE.Vector3[]; fromQ: THREE.Quaternion[] } | null = null;
    /** Wurf, der nach dem Einsammeln abgespielt wird */
    private queued: { values: number[]; thr: { power: number; seed: number; seat: number }; shake: number } | null = null;
    /** Wann ich zuletzt selbst den Becher geschüttelt (und losgelassen) habe */
    private lastHandShake = -Infinity;
    private lastRattle = 0;
    /** In wessen Becher liegen die Würfel gerade (unsichtbar)? */
    private inCup: number | null = null;
    private readonly size: number;
    private count = 1;

    /** Hindernisse ändern (anderes Brett). Alle Clients müssen dieselben haben – Würfe werden überall gleich simuliert. */
    setObstacles(obstacles: Obstacle[]): void {
        this.opts = { ...this.opts, obstacles };
    }

    constructor(private table: TableScene, private client: TableClient, private opts: DiceLayerOptions = {}) {
        this.size = opts.dieSize ?? 0.42;
        this.cup = createCup();
        this.cup.visible = false;
        table.scene.add(this.cup);
        client.onState(s => this.syncState(s));
        client.onEvent(ev => {
            if (ev.type === 'DICE_ROLLED') {
                this.lobbyHolder = ev.throw.seat;
                this.onRolled(ev.values, ev.throw, true);
            }
        });
        client.onPresence((from, p) => {
            if (p?.hold !== 'cup') return;
            const seat = this.client.state?.members.find(m => m.id === from)?.seat;
            if (seat != null) {
                this.shakingOthers.set(seat, performance.now());
                this.lobbyHolder = seat;
                this.moveCupTo(seat);
                this.gatherInto(seat);          // wer schüttelt, hat die Würfel vorher eingesammelt
                this.animate();
            }
        });
        const container = table.renderer.domElement.parentElement!;
        container.addEventListener('pointerdown', ev => this.onPointerDown(ev), { capture: true });
    }

    // ---------- Becher & Würfel ----------
    /** Wo der Becher eines Platzes steht: rechts vor dem Spieler, im Streifen zwischen Brett und Tischkante */
    cupPosition(seat: number): THREE.Vector3 {
        const dir = this.table.seatDirection(seat);
        const right = new THREE.Vector3(dir.z, 0, -dir.x);
        return dir.multiplyScalar(this.table.tableSize / 2 - 1.15).add(right.multiplyScalar(2.45));
    }

    private syncState(s: TableState): void {
        const spec = s.layout.dice;
        this.count = spec?.count ?? 0;
        while (this.dice.length < this.count) {
            const d = createDie(this.size);
            d.visible = false;
            this.table.scene.add(d);
            this.dice.push(d);
        }
        // Letzter Wurf (z. B. nach Beitreten/Reconnect): Würfel ohne Animation dort hinlegen
        const lr = s.last_roll;
        if (lr && this.lobbyHolder === null) this.lobbyHolder = lr.throw.seat;
        if (lr && !this.playing && this.lastRollKey !== rollKey(lr)) this.onRolled(lr.values, lr.throw, false);
        // Becher: beim ersten Mal direkt hinstellen, danach wird er weitergereicht
        const holder = this.holderSeat();
        this.cup.visible = this.count > 0 && holder !== null;
        if (this.cupSeat === null && holder !== null) {
            this.cupSeat = holder;
            this.cup.position.copy(this.cupPosition(holder));
            this.cupBase.copy(this.cup.position);
        } else if (holder !== null && holder !== this.cupSeat) {
            this.animate();                 // reicht weiter, sobald der Würfel liegt
        }
        this.table.invalidate();
    }

    /**
     * Wer den Becher haben sollte: im Spiel der Platz am Zug, in der Lobby wer zuletzt gewürfelt hat
     * (sonst der Host bzw. der erste besetzte Platz). Spielende: bleibt, wo er ist.
     */
    holderSeat(): number | null {
        const s = this.client.state;
        if (!s) return null;
        const seated = s.members.filter(m => m.seat !== null).map(m => m.seat as number).sort((a, b) => a - b);
        if (s.status === 'playing' && s.play?.turn != null) return s.play.turn;
        if (s.status === 'finished' && this.cupSeat !== null) return this.cupSeat;
        if (this.lobbyHolder !== null && seated.includes(this.lobbyHolder)) return this.lobbyHolder;
        const host = s.members.find(m => m.id === s.host_id)?.seat;
        return host ?? seated[0] ?? null;
    }

    /** Becher zu einem Platz reichen (im Bogen um das Brett herum, in Spielrichtung). */
    private moveCupTo(seat: number): void {
        if (this.cupSeat === seat && !this.travel) return;
        if (this.cupSeat === null) {
            this.cupSeat = seat;
            this.cup.position.copy(this.cupPosition(seat));
            this.cupBase.copy(this.cup.position);
            return;
        }
        const from = angleOf(this.cupBase);
        let delta = angleOf(this.cupPosition(seat)) - from;
        while (delta <= -Math.PI) delta += Math.PI * 2;
        while (delta > Math.PI) delta -= Math.PI * 2;
        this.travel = { from, delta, t: 0, dur: 0.45 + Math.abs(delta) / Math.PI * 0.5 };
        this.cupSeat = seat;
        this.animate();
    }

    /** Punkt auf dem Weg des Bechers: abgerundetes Quadrat im Streifen zwischen Brett und Tischkante */
    private cupPathPoint(angle: number): THREE.Vector3 {
        const r = this.cupPosition(0);
        const R = pnorm(r.x, r.z);
        const ux = -Math.sin(angle), uz = Math.cos(angle);
        const k = R / pnorm(ux, uz);
        return new THREE.Vector3(ux * k, 0, uz * k);
    }

    private onRolled(values: number[], thr: { power: number; seed: number; seat: number }, animate: boolean): void {
        this.lastRollKey = rollKey({ values, throw: thr });
        if (!animate) {
            this.recording = this.simulate(values, thr);
            this.dice.forEach(d => { d.visible = true; });
            this.inCup = null;
            this.playTime = Infinity;
            this.applyFrame(this.recording.frames.length - 1, 0);
            this.table.invalidate();
            return;
        }
        // Wurde vorher nicht von Hand geschüttelt (Computer, Würfeln-Knopf)? Dann kurz schütteln, wie ein Mensch.
        const now = performance.now();
        const shook = thr.seat === this.client.me?.seat
            ? now - this.lastHandShake < 1500
            : now - (this.shakingOthers.get(thr.seat) ?? -Infinity) < 1500;
        const shake = shook ? 0 : AUTO_SHAKE_SECONDS;
        // Erst muss der Becher beim Werfenden sein und die Würfel vom Tisch darin liegen
        const onTable = this.dice.some(d => d.visible);
        if (shake || this.gather || this.travel || this.cupSeat !== thr.seat || (onTable && this.inCup !== thr.seat)) {
            this.queued = { values, thr, shake };
            this.moveCupTo(thr.seat);
            this.gatherInto(thr.seat);
            this.animate();
            return;
        }
        this.startPlayback(values, thr);
    }

    private startPlayback(values: number[], thr: { power: number; seed: number; seat: number }): void {
        this.recording = this.simulate(values, thr);
        this.dice.forEach(d => { d.visible = true; });
        this.inCup = null;
        this.playTime = 0;
        this.nextImpact = 0;
        this.applyFrame(0, 0);
        this.tipCup();
        if (thr.seat === this.client.me?.seat) vibrate([12, 30, 18]);
        this.animate();
    }

    /** Würfel vom Tisch in den Becher eines Platzes holen (hüpfen im Bogen hinein, dann unsichtbar). */
    private gatherInto(seat: number): void {
        if (this.gather || this.inCup === seat) return;
        const visible = this.dice.filter(d => d.visible);
        if (!visible.length) { this.inCup = seat; return; }
        if (this.playTime !== Infinity && this.recording) {         // falls noch rollend: sofort zum Endstand
            this.applyFrame(this.recording.frames.length - 1, 0);
            this.playTime = Infinity;
        }
        this.gather = {
            seat, t: 0,
            from: this.dice.map(d => d.position.clone()),
            fromQ: this.dice.map(d => d.quaternion.clone())
        };
        this.animate();
    }

    // ---------- Physik ----------
    private simulate(values: number[], thr: { power: number; seed: number; seat: number }): Recording {
        const rnd = seededRandom(thr.seed);
        const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
        world.allowSleep = true;
        const dieMat = new CANNON.Material('die');
        const tableMat = new CANNON.Material('table');
        world.addContactMaterial(new CANNON.ContactMaterial(dieMat, tableMat, { friction: 0.28, restitution: 0.38 }));
        world.addContactMaterial(new CANNON.ContactMaterial(dieMat, dieMat, { friction: 0.2, restitution: 0.4 }));

        const ground = new CANNON.Body({ mass: 0, material: tableMat, shape: new CANNON.Plane() });
        ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        world.addBody(ground);
        const half = this.table.tableSize / 2 - 0.12;
        const wall = (x: number, z: number, w: number, d: number, h: number) => {
            const b = new CANNON.Body({ mass: 0, material: tableMat, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)) });
            b.position.set(x, h / 2, z);
            world.addBody(b);
        };
        // Tischkante (man fängt die Würfel ab) und Hindernisse (Brett: Würfel prallen an der Kante ab)
        wall(0, half + 0.5, 2 * half + 2, 1, 3);
        wall(0, -half - 0.5, 2 * half + 2, 1, 3);
        wall(half + 0.5, 0, 1, 2 * half + 2, 3);
        wall(-half - 0.5, 0, 1, 2 * half + 2, 3);
        for (const o of this.opts.obstacles ?? []) {
            const h = Math.max(o.h, 0.45);
            if (o.r) {
                const b = new CANNON.Body({ mass: 0, material: tableMat, shape: new CANNON.Cylinder(o.r, o.r, h, 32) });
                b.position.set(o.x, h / 2, o.z);
                world.addBody(b);
            } else {
                wall(o.x, o.z, o.w, o.d, h);
            }
        }

        // Start: aus dem Becher heraus, Richtung links entlang des eigenen Streifens
        const seat = thr.seat;
        const dir = this.table.seatDirection(seat);
        const right = new THREE.Vector3(dir.z, 0, -dir.x);
        const cup = this.cupPosition(seat);
        const speed = 6 + thr.power * 9;
        const impacts: Impact[] = [];
        const bodies = values.map((_, i) => {
            const b = new CANNON.Body({
                mass: 1, material: dieMat, shape: new CANNON.Box(new CANNON.Vec3(this.size / 2, this.size / 2, this.size / 2)),
                linearDamping: 0.08, angularDamping: 0.08, sleepSpeedLimit: 0.12, sleepTimeLimit: 0.25
            });
            const off = right.clone().multiplyScalar(-0.2 - i * 0.5).add(dir.clone().multiplyScalar((rnd() - 0.5) * 0.3));
            b.position.set(cup.x + off.x, 0.9 + i * 0.1, cup.z + off.z);
            b.quaternion.setFromEuler(rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2);
            const v = right.clone().multiplyScalar(-speed * (0.85 + rnd() * 0.3))
                .add(dir.clone().multiplyScalar(-(0.6 + rnd() * 1.4)));
            b.velocity.set(v.x, 2.5 + rnd() * 2, v.z);
            b.angularVelocity.set((rnd() - 0.5) * 30, (rnd() - 0.5) * 30, (rnd() - 0.5) * 30);
            b.addEventListener('collide', (e: any) => {
                const s = Math.abs(e.contact?.getImpactVelocityAlongNormal?.() ?? 0);
                if (s > 1.2) impacts.push({ frame: -1, speed: s });
            });
            world.addBody(b);
            return b;
        });

        const frames: Frame[] = [];
        const record = () => {
            const p = new Float32Array(bodies.length * 3), q = new Float32Array(bodies.length * 4);
            bodies.forEach((b, i) => {
                p.set([b.position.x, b.position.y, b.position.z], i * 3);
                q.set([b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], i * 4);
            });
            frames.push({ p, q });
        };
        record();
        const maxSteps = MAX_SECONDS / STEP;
        for (let step = 1; step <= maxSteps; step++) {
            const before = impacts.length;
            world.step(STEP);
            for (let k = before; k < impacts.length; k++) impacts[k].frame = frames.length;
            if (step % RECORD_EVERY === 0) record();
            if (step > 60 && bodies.every(b => b.sleepState === CANNON.Body.SLEEPING)) break;
        }
        record();

        // Korrektur: Seite mit dem Server-Wert dorthin drehen, wo die tatsächlich obere Seite liegt
        const last = frames[frames.length - 1];
        const corrections = values.map((want, i) => {
            const q = new THREE.Quaternion(last.q[i * 4], last.q[i * 4 + 1], last.q[i * 4 + 2], last.q[i * 4 + 3]);
            const got = topValue(q);
            return new THREE.Quaternion().setFromUnitVectors(normalForValue(want), normalForValue(got));
        });
        // Aufprall-Geräusche ausdünnen (max. eins pro 40 ms)
        const thinned: Impact[] = [];
        for (const im of impacts) {
            const prev = thinned[thinned.length - 1];
            if (!prev || im.frame - prev.frame >= 5) thinned.push(im);
            else prev.speed = Math.max(prev.speed, im.speed);
        }
        return { frames, impacts: thinned, corrections, values };
    }

    private applyFrame(i: number, frac: number): void {
        const rec = this.recording;
        if (!rec) return;
        const a = rec.frames[Math.min(i, rec.frames.length - 1)];
        const b = rec.frames[Math.min(i + 1, rec.frames.length - 1)];
        const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
        this.dice.forEach((d, k) => {
            if (k >= rec.values.length) { d.visible = false; return; }
            d.position.set(
                THREE.MathUtils.lerp(a.p[k * 3], b.p[k * 3], frac),
                THREE.MathUtils.lerp(a.p[k * 3 + 1], b.p[k * 3 + 1], frac),
                THREE.MathUtils.lerp(a.p[k * 3 + 2], b.p[k * 3 + 2], frac)
            );
            qa.set(a.q[k * 4], a.q[k * 4 + 1], a.q[k * 4 + 2], a.q[k * 4 + 3]);
            qb.set(b.q[k * 4], b.q[k * 4 + 1], b.q[k * 4 + 2], b.q[k * 4 + 3]);
            d.quaternion.slerpQuaternions(qa, qb, frac).multiply(rec.corrections[k]);
        });
    }

    // ---------- Eingabe: Becher greifen & schütteln ----------
    private onPointerDown(ev: PointerEvent): void {
        const me = this.client.me;
        if (!me || me.seat === null || this.holding || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
        if (!this.client.canRoll) return;              // nicht dran → Becher bleibt stehen, Kamera darf drehen
        if (!this.cup.visible || !this.table.pickObjects(ev.clientX, ev.clientY, [this.cup]).length) return;
        // In der Lobby darf jeder: der Becher kommt zu einem herüber
        this.lobbyHolder = me.seat;
        this.moveCupTo(me.seat);
        ev.stopPropagation();
        ev.preventDefault();
        this.startShake(ev);
    }

    private startShake(ev: PointerEvent): void {
        const motion = (e: DeviceMotionEvent) => {
            const a = e.acceleration ?? e.accelerationIncludingGravity;
            if (!a || !this.holding) return;
            const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
            if (mag > 6) this.addShake(Math.min(0.08, (mag - 6) / 120));
        };
        // iOS: Bewegungssensor braucht eine Erlaubnis, die nur in einer Geste angefragt werden darf
        const DME = (window as any).DeviceMotionEvent;
        if (DME?.requestPermission) DME.requestPermission().catch(() => undefined);
        window.addEventListener('devicemotion', motion);
        this.gatherInto(this.client.me!.seat!);
        this.holding = { power: 0.25, last: new THREE.Vector2(ev.clientX, ev.clientY), t: performance.now(), motion };
        vibrate(6);
        const move = (e: PointerEvent) => {
            if (!this.holding) return;
            // Schüttelstärke aus der zurückgelegten Strecke (unabhängig von Bildrate/Gerät):
            // ca. 1500 px Schütteln = volle Kraft
            const p = new THREE.Vector2(e.clientX, e.clientY);
            const dist = p.distanceTo(this.holding.last);
            this.holding.last.copy(p);
            this.holding.t = performance.now();
            if (dist > 2) this.addShake(Math.min(0.06, dist / 1500));
            const at = this.table.pickPlane(e.clientX, e.clientY, 0);
            if (at) this.client.sendPresence({ x: at.x, z: at.z, down: true, hold: 'cup' });
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            this.throwDice();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        this.animate();
    }

    private addShake(amount: number): void {
        if (!this.holding) return;
        const before = this.holding.power;
        this.holding.power = Math.min(1, before + amount);
        // Rasseln im Becher, nicht zu oft
        if (Math.floor(before * 25) !== Math.floor(this.holding.power * 25)) {
            knock(0.18 + this.holding.power * 0.2, 2.4 + Math.random() * 0.6);
            vibrate(5);
        }
        this.animate();
    }

    /** Würfeln: per Becher (Stärke aus dem Schütteln) oder per Knopf. */
    throwDice(power?: number): void {
        const h = this.holding;
        if (h) window.removeEventListener('devicemotion', h.motion);
        this.holding = null;
        if (h) this.lastHandShake = performance.now();
        this.client.roll(power ?? h?.power ?? 0.55);
        this.animate();
    }

    private tipCup(): void {
        this.tipT = 0;
        this.animate();
    }

    // ---------- Animation ----------
    private animate(): void {
        if (this.playing) return;
        this.playing = true;
        this.table.addAnimator(dt => {
            let busy = false;
            // Einsammeln: im Bogen zur Becheröffnung, dabei leicht drehen
            const g = this.gather;
            if (g) {
                g.t = Math.min(1, g.t + dt / 0.45);
                const k = g.t * g.t * (3 - 2 * g.t);
                const mouth = this.cupBase.clone().setY(0.95);
                this.dice.forEach((d, i) => {
                    if (!d.visible) return;
                    const from = g.from[i] ?? mouth;
                    d.position.lerpVectors(from, mouth, k);
                    d.position.y += Math.sin(Math.PI * g.t) * 0.9;
                    d.quaternion.copy(g.fromQ[i] ?? d.quaternion)
                        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(k * 4, k * 2, 0)));
                    d.scale.setScalar(g.t > 0.85 ? 1 - (g.t - 0.85) / 0.15 * 0.6 : 1);
                });
                if (g.t >= 1) {
                    this.dice.forEach(d => { d.visible = false; d.scale.setScalar(1); });
                    knock(0.22, 2.7);
                    this.inCup = g.seat;
                    this.gather = null;
                }
                busy = true;
            }
            const rec = this.recording;
            if (rec && this.playTime !== Infinity && !this.gather) {
                this.playTime += dt;
                const f = this.playTime * 120;
                const i = Math.floor(f);
                while (this.nextImpact < rec.impacts.length && rec.impacts[this.nextImpact].frame <= i) {
                    const im = rec.impacts[this.nextImpact++];
                    knock(Math.min(0.75, 0.12 + im.speed / 12), 2.1 + Math.random() * 0.4);
                }
                if (i >= rec.frames.length - 1) {
                    this.applyFrame(rec.frames.length - 1, 0);
                    this.playTime = Infinity;
                } else {
                    this.applyFrame(i, f - i);
                    busy = true;
                }
            }
            // ---- Becher ----
            const now = performance.now();
            const cup = this.cup;
            // Weiterreichen, sobald die Würfel liegen und niemand den Becher hält
            // Ein anstehender Wurf hat Vorrang: Der Becher muss erst zum Werfenden, auch wenn der Zug
            // (z. B. nach dem 3. Fehlversuch) schon beim Nächsten ist – sonst wartet der Wurf ewig.
            const holder = this.queued ? this.queued.thr.seat : this.holderSeat();
            const diceBusy = !!this.gather || (!!this.recording && this.playTime !== Infinity);
            if (!this.travel && holder !== null && holder !== this.cupSeat && !diceBusy && this.tipT === null && !this.holding) {
                this.moveCupTo(holder);
            }
            let lift = 0, lean = 0;
            const tr = this.travel;
            if (tr) {
                tr.t = Math.min(1, tr.t + dt / tr.dur);
                const k = tr.t < 0.5 ? 2 * tr.t * tr.t : 1 - Math.pow(-2 * tr.t + 2, 2) / 2;
                this.cupBase.copy(this.cupPathPoint(tr.from + tr.delta * k));
                lift = Math.sin(Math.PI * tr.t) * 0.3;
                lean = Math.sin(Math.PI * tr.t) * 0.12 * Math.sign(tr.delta);
                if (tr.t >= 1) {
                    this.travel = null;
                    this.cupBase.copy(this.cupPosition(this.cupSeat!));
                    knock(0.1, 1.5);                     // leise aufsetzen
                }
                busy = true;
            } else if (this.cupSeat !== null) {
                this.cupBase.copy(this.cupPosition(this.cupSeat));
            }
            // Wartender Wurf: Becher ist da → Würfel einsammeln (falls nötig) → werfen
            const q = this.queued;
            let autoShake = false;
            if (q && !this.travel && !this.gather && this.cupSeat === q.thr.seat) {
                if (this.dice.some(d => d.visible) && this.inCup !== q.thr.seat) this.gatherInto(q.thr.seat);
                else if (q.shake > 0) {
                    // kurz schütteln (Computer/Knopf), mit Rasseln
                    q.shake -= dt;
                    autoShake = true;
                    if (now - this.lastRattle > 85 + Math.random() * 60) {
                        this.lastRattle = now;
                        knock(0.2 + Math.random() * 0.12, 2.4 + Math.random() * 0.6);
                    }
                } else { this.queued = null; this.startPlayback(q.values, q.thr); }
                busy = true;
            }
            const base = this.cupBase;
            const seat = this.cupSeat;
            const mine = seat !== null && seat === this.client.me?.seat;
            const shaking = autoShake || (mine && this.holding) || (seat !== null && now - (this.shakingOthers.get(seat) ?? 0) < 400);
            cup.rotation.set(0, 0, 0);
            if (shaking) {
                const amp = mine && this.holding ? 0.04 + this.holding.power * 0.08 : 0.08;
                cup.position.set(base.x + Math.sin(now / 37) * amp, 0.55 + lift + Math.sin(now / 53) * amp, base.z + Math.cos(now / 41) * amp);
                cup.rotation.set(Math.sin(now / 45) * amp * 2, 0, Math.cos(now / 39) * amp * 2);
                busy = true;
            } else if (this.tipT !== null && seat !== null) {
                const t = (this.tipT += dt / 0.9);
                const dir = this.table.seatDirection(seat);
                const k = t < 0.35 ? t / 0.35 : t < 0.65 ? 1 : Math.max(0, 1 - (t - 0.65) / 0.35);
                const angle = k * TIP_ANGLE;
                // So hoch, dass der gekippte Becher nie in den Tisch taucht; startet aus der Schüttelhöhe
                const fromShake = t < 0.35 ? 0.55 * (1 - t / 0.35) : 0;
                cup.position.set(base.x, cupClearance(angle) + 0.15 * k + fromShake, base.z);
                // um die Achse „zum Spieler“ kippen: Öffnung zeigt nach links, dorthin rollen die Würfel
                cup.quaternion.setFromAxisAngle(dir, angle);
                if (t >= 1) { this.tipT = null; cup.position.copy(base); cup.rotation.set(0, 0, 0); }
                busy = true;
            } else {
                cup.position.set(base.x, lift, base.z);
                if (lean) cup.quaternion.setFromAxisAngle(new THREE.Vector3(base.x, 0, base.z).normalize(), lean);
            }
            this.playing = busy;
            return busy;
        });
    }

    // ---------- Für Tests ----------
    topValues(): number[] {
        return this.dice.filter(d => d.visible).map(d => topValue(d.quaternion));
    }

    isResting(): boolean {
        return !this.playing;
    }

    /** Dauer des letzten Wurfs (Physik, Sekunden) und Endpositionen – zum Abstimmen/Testen */
    lastRollInfo(): { seconds: number; positions: number[][] } | null {
        const rec = this.recording;
        if (!rec) return null;
        const last = rec.frames[rec.frames.length - 1];
        return {
            seconds: rec.frames.length / 120,
            positions: rec.values.map((_, i) => [last.p[i * 3], last.p[i * 3 + 1], last.p[i * 3 + 2]].map(v => Math.round(v * 100) / 100))
        };
    }

    cupScreenPos(_seat?: number): { x: number; y: number } {
        const p = this.cupBase.clone().setY(0.35).project(this.table.camera);
        const rect = this.table.renderer.domElement.getBoundingClientRect();
        return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
    }
}

function rollKey(r: { values: number[]; throw: { seed: number } }): string {
    return `${r.throw.seed}:${r.values.join(',')}`;
}

/** Winkel eines Tischpunkts um die Mitte – gleiche Zählung wie die Sitzplätze */
function angleOf(p: THREE.Vector3): number {
    return Math.atan2(-p.x, p.z);
}

/** „Eckiger“ Betrag: Weg des Bechers als abgerundetes Quadrat (bleibt neben dem Brett) */
function pnorm(x: number, z: number): number {
    return Math.pow(Math.pow(Math.abs(x), 8) + Math.pow(Math.abs(z), 8), 1 / 8);
}

/**
 * Wie hoch der Becher (Drehpunkt = Bodenmitte) mindestens schweben muss, damit er bei dieser Neigung
 * nicht in den Tisch ragt: tiefster Punkt seines Umrisses (Radius 0,445, Höhe 0,8) plus etwas Luft.
 */
function cupClearance(angle: number): number {
    if (angle <= 0) return 0;
    const s = Math.sin(angle), c = Math.cos(angle);
    let min = 0;
    for (const u of [-0.445, 0.445]) for (const v of [0, 0.8]) min = Math.min(min, u * s + v * c);
    return -min + 0.03 * Math.min(1, angle);
}
