/**
 * Mensch ärgere dich nicht – 3D-Spieltisch. M1: leerer Tisch mit Sitzplätzen und Präsenz.
 */
import './app.css';
import { Presence, SeatLabels, TableClient, TableScene } from '@treffen/tabletop';

const params = new URLSearchParams(location.search);
const NAME_KEY = 'mensch_name';

function roomCode(): string {
    const fromUrl = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
    if (fromUrl) return fromUrl;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => alphabet[b % alphabet.length]).join('');
    params.set('room', code);
    history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
    return code;
}

function askName(): Promise<string> {
    const fromUrl = params.get('name')?.trim();
    if (fromUrl) return Promise.resolve(fromUrl);
    const stored = localStorage.getItem(NAME_KEY);
    if (stored) return Promise.resolve(stored);
    const welcome = document.getElementById('welcome')!;
    const form = document.getElementById('welcome-form') as HTMLFormElement;
    const input = document.getElementById('name-input') as HTMLInputElement;
    welcome.hidden = false;
    input.focus();
    return new Promise(resolve => {
        form.addEventListener('submit', ev => {
            ev.preventDefault();
            const name = input.value.trim();
            if (!name) return;
            try { localStorage.setItem(NAME_KEY, name); } catch { /* egal */ }
            welcome.hidden = true;
            resolve(name);
        });
    });
}

function toast(text: string): void {
    const el = document.getElementById('toast')!;
    el.textContent = text;
    el.hidden = false;
    clearTimeout((toast as any).t);
    (toast as any).t = setTimeout(() => { el.hidden = true; }, 2200);
}

async function start(): Promise<void> {
    const room = roomCode();
    document.getElementById('room-code')!.textContent = room;
    document.getElementById('room-btn')!.addEventListener('click', async () => {
        const url = `${location.origin}${location.pathname}?room=${room}`;
        try { await navigator.clipboard.writeText(url); toast('Link kopiert – schick ihn deinen Mitspielern'); }
        catch { toast(url); }
    });

    const table = new TableScene({ container: document.getElementById('table')!, seats: 4 });
    const name = await askName();
    const client = new TableClient({ namespace: 'mensch', room, name });
    const presence = new Presence(table, client);
    new SeatLabels(table, client);

    const dot = document.getElementById('conn-dot')!;
    client.onConnection(ok => dot.classList.toggle('ok', ok));
    setTimeout(() => document.getElementById('hint')?.classList.add('fade'), 6000);

    // Für Tests und Fehlersuche
    (window as any).__tisch = { table, client, presence };
}

start();
