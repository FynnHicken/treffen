/**
 * Standard-Brett der Engine (2.3): Holzplatte, auf die die Felder des Layouts gemalt werden.
 * Reicht für viele Spiele ohne eigenen Brett-Code (Dame, Mühle, Go, Reversi, Halma, Laufspiele).
 *
 * layout.board:
 *   size | w, d       Maße der Platte (Tisch-Einheiten)           shape: "square" (Standard) | "round"
 *   spacing           Feldabstand (Größe der Felder)               cells: "round" (Standard) | "square" (Schachbrett)
 *   wood              Farbe der Platte (Standard Ahorn)            lines: [[feldA, feldB], …] Linien zwischen Feldern
 *   frame             Randbreite (nur dekorativ)
 * Felder: x, z, color (Palette-Name oder #rrggbb; ohne: dezenter Kreis), hidden: true → nicht malen (Ablagen).
 * Server-Hilfen dazu: tabletop_server.boards (grid, hexgrid, ring_track, line_board …).
 */
import * as THREE from 'three';
import type { Layout } from '../net/state';
import type { BoardContext, BoardHandle } from '../app/startTable';

export const GENERIC_THICKNESS = 0.12;

function rounded(w: number, d: number, h: number, r: number): THREE.BufferGeometry {
    const s = new THREE.Shape();
    const x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
    g.rotateX(Math.PI / 2);
    g.translate(0, h, 0);
    return g;
}

export function createGenericBoard(layout: Layout, ctx: BoardContext): BoardHandle {
    const b = layout.board ?? { kind: 'generic', size: 9 };
    const w = (b.w as number | undefined) ?? b.size, d = (b.d as number | undefined) ?? b.size;
    const round = b.shape === 'round';
    const S = b.spacing ?? 0.8;
    const wood = (b.wood as string | undefined) ?? '#c89a62';
    const H = GENERIC_THICKNESS;
    const group = new THREE.Group();

    const body = new THREE.Mesh(
        round ? new THREE.CylinderGeometry(w / 2, w / 2, H, 96).translate(0, H / 2, 0) : rounded(w, d, H, Math.min(w, d) * 0.03),
        new THREE.MeshPhysicalMaterial({ color: new THREE.Color(wood).multiplyScalar(0.7), roughness: 0.55, clearcoat: 0.4 })
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Oberseite als Bild: Holz, Linien, Felder
    const px = Math.round((ctx.hiRes ? 2048 : 1024) * Math.min(1, Math.max(w, d) / 10));
    const k = px / Math.max(w, d);
    const cw = Math.round(w * k), cd = Math.round(d * k);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = cd;
    const g = canvas.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, cw, cd);
    grad.addColorStop(0, wood);
    grad.addColorStop(1, `#${new THREE.Color(wood).multiplyScalar(0.86).getHexString()}`);
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, cd);
    for (let i = 0; i < 60; i++) {                 // leichte Maserung
        g.strokeStyle = `rgba(80,45,15,${0.03 + (i % 5) * 0.01})`;
        g.lineWidth = 1 + (i % 3);
        g.beginPath();
        const y0 = (i / 60) * cd;
        g.moveTo(0, y0);
        g.bezierCurveTo(cw * 0.3, y0 + 8, cw * 0.7, y0 - 8, cw, y0 + 4);
        g.stroke();
    }
    const X = (x: number) => (x + w / 2) * k, Z = (z: number) => (z + d / 2) * k;
    const color = (c: string | undefined) => (c ? layout.palette?.[c] ?? c : null);

    const lines = (b.lines as [string, string][] | undefined) ?? [];
    g.strokeStyle = 'rgba(40,22,8,0.85)';
    g.lineWidth = Math.max(2, S * k * 0.06);
    g.lineCap = 'round';
    for (const [a, c] of lines) {
        const fa = layout.fields[a], fc = layout.fields[c];
        if (!fa || !fc) continue;
        g.beginPath(); g.moveTo(X(fa.x), Z(fa.z)); g.lineTo(X(fc.x), Z(fc.z)); g.stroke();
    }
    const square = b.cells === 'square';
    for (const f of Object.values(layout.fields) as (typeof layout.fields[string] & { hidden?: boolean })[]) {
        if (f.hidden) continue;
        const c = color(f.color);
        if (square) {
            g.fillStyle = c ?? 'rgba(60,35,15,0.25)';
            g.fillRect(X(f.x) - S * k / 2, Z(f.z) - S * k / 2, S * k, S * k);
        } else {
            g.beginPath();
            g.arc(X(f.x), Z(f.z), S * k * 0.36, 0, Math.PI * 2);
            g.fillStyle = c ?? 'rgba(255,248,235,0.55)';
            g.fill();
            g.lineWidth = Math.max(1.5, S * k * 0.035);
            g.strokeStyle = 'rgba(40,22,8,0.7)';
            g.stroke();
        }
    }
    if (square) {                                    // Rahmen um das Feld-Raster
        const fs = Object.values(layout.fields).filter(f => !(f as { hidden?: boolean }).hidden);
        if (fs.length) {
            const x0 = Math.min(...fs.map(f => f.x)) - S / 2, x1 = Math.max(...fs.map(f => f.x)) + S / 2;
            const z0 = Math.min(...fs.map(f => f.z)) - S / 2, z1 = Math.max(...fs.map(f => f.z)) + S / 2;
            g.strokeStyle = 'rgba(40,22,8,0.9)';
            g.lineWidth = Math.max(2, S * k * 0.05);
            g.strokeRect(X(x0), Z(z0), (x1 - x0) * k, (z1 - z0) * k);
        }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = ctx.anisotropy;
    const top = new THREE.Mesh(
        round ? new THREE.CircleGeometry(w / 2 - 0.01, 96) : new THREE.PlaneGeometry(w - 0.02, d - 0.02),
        new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.25 })
    );
    if (round) tex.center.set(0.5, 0.5);
    top.rotation.x = -Math.PI / 2;
    top.position.y = H + 0.016;
    top.receiveShadow = true;
    group.add(top);
    return { object: group, surfaceY: H + 0.016 };
}
