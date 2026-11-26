/**
 * Avatare aus dem Treffen-Hub. Der Tisch-Server schickt pro Mitglied eine URL des party-servers
 * (`/party-ws/avatar/<RAUM>/<ID>.svg`), wenn der Beitritt mit gültigem Hub-Ticket kam.
 *
 * - HTML (Statuszeile, Zeiger): `<img>` auf das SVG.
 * - 3D (Platzschilder): das SVG würde je nach Browser das Canvas für WebGL sperren, daher holen wir
 *   `…json` ({color, face}) und zeichnen Körper + gemaltes Gesicht (data:-PNG) selbst.
 */
import type { Member } from '../net/state';

const AVATAR_URL_RE = /^\/party-ws\/avatar\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}\.svg$/;
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const FACE_RE = /^data:image\/(png|webp);base64,[A-Za-z0-9+/=]+$/;

export function avatarUrl(m: Pick<Member, 'avatar'> | null | undefined): string | null {
    const url = m?.avatar;
    return typeof url === 'string' && AVATAR_URL_RE.test(url) ? url : null;
}

/** `<img>` für HTML-Stellen; leer ohne Avatar. Bricht das Bild (Spieler nicht mehr im Hub), verschwindet es. */
export function avatarImgHtml(m: Pick<Member, 'avatar'> | null | undefined, className = ''): string {
    const url = avatarUrl(m);
    return url ? `<img class="tt-avatar ${className}" src="${url}" alt="" draggable="false">` : '';
}

if (typeof document !== 'undefined') {
    document.addEventListener('error', ev => {
        const t = ev.target as HTMLElement | null;
        if (t && t.tagName === 'IMG' && t.classList.contains('tt-avatar')) t.remove();
    }, true);
}

const BODY = new Path2D('M14,104 C14,72 30,62 50,62 C70,62 86,72 86,104 Z');
const HIGHLIGHT = new Path2D('M31,24 A22,22 0 0,1 48,16');
const cache = new Map<string, Promise<HTMLCanvasElement | null>>();

/** Avatar als Canvas (quadratisch, rund beschnitten) – für Texturen. null, wenn es keinen gibt. */
export function avatarCanvas(url: string, size = 256): Promise<HTMLCanvasElement | null> {
    const key = `${url}@${size}`;
    let p = cache.get(key);
    if (!p) {
        p = (async () => {
            try {
                const res = await fetch(url.replace(/\.svg$/, '.json'), { credentials: 'same-origin' });
                if (!res.ok) return null;
                const data = await res.json();
                const color = typeof data?.color === 'string' && COLOR_RE.test(data.color) ? data.color : '#6366f1';
                const face = typeof data?.face === 'string' && FACE_RE.test(data.face) ? await loadImage(data.face) : null;
                const c = document.createElement('canvas');
                c.width = c.height = size;
                const g = c.getContext('2d')!;
                g.scale(size / 100, size / 100);
                g.beginPath(); g.arc(50, 50, 50, 0, Math.PI * 2); g.clip();
                g.fillStyle = '#2b2118'; g.fillRect(0, 0, 100, 100);
                g.lineWidth = 5; g.lineJoin = 'round'; g.strokeStyle = '#1e293b'; g.fillStyle = color;
                g.fill(BODY); g.stroke(BODY);
                g.beginPath(); g.arc(50, 39, 28, 0, Math.PI * 2); g.fill(); g.stroke();
                g.lineWidth = 3.5; g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.4)'; g.stroke(HIGHLIGHT);
                if (face) g.drawImage(face, 0, 0, 100, 100);
                else drawDefaultFace(g);
                return c;
            } catch {
                return null;
            }
        })();
        cache.set(key, p);
        // fehlgeschlagen → später nochmal versuchen (z. B. Hub kurz weg)
        p.then(c => { if (!c) setTimeout(() => cache.delete(key), 30000); });
    }
    return p;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function drawDefaultFace(g: CanvasRenderingContext2D): void {
    g.save();
    g.translate(22, 11); g.scale(0.56, 0.56);
    g.fillStyle = '#111827';
    for (const x of [35, 65]) { g.beginPath(); g.arc(x, 42, 7, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#fff';
    for (const x of [37, 67]) { g.beginPath(); g.arc(x, 40, 2.2, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.moveTo(33, 62); g.quadraticCurveTo(50, 76, 67, 62);
    g.strokeStyle = '#111827'; g.lineWidth = 6.5; g.lineCap = 'round'; g.stroke();
    g.restore();
}
