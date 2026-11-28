import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PACKAGE_JSON_PATH = new URL('./package.json', import.meta.url);
let INSTALLED_VERSION = '1.0.0';
try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    if (pkg && pkg.version) INSTALLED_VERSION = String(pkg.version);
} catch {}

// Build-Info (Commit-SHA & Build-Zeit) aus Env oder /app/BUILD_INFO.json
function readBuildInfo() {
    let sha = (process.env.TREFFEN_COMMIT_SHA || '').trim();
    let builtAt = (process.env.TREFFEN_BUILD_DATE || '').trim();
    const candidates = ['/app/BUILD_INFO.json', path.resolve(process.cwd(), 'BUILD_INFO.json')];
    for (const file of candidates) {
        try {
            if (!fs.existsSync(file)) continue;
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!sha && data.sha) sha = String(data.sha).trim();
            if (!builtAt && data.builtAt) builtAt = String(data.builtAt).trim();
        } catch {}
    }
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) sha = '';
    return { sha: sha.toLowerCase(), builtAt };
}

export const UPDATE_CHANNELS = [
    { id: 'stable', label: 'Stabil (FynnHicken/main)', repo: 'FynnHicken/treffen', branch: 'main' },
    { id: 'upstream', label: 'Upstream (NobleBrains/main)', repo: 'NobleBrains/treffen', branch: 'main' },
    { id: 'experimentell', label: 'Experimentell (FynnHicken/exp.)', repo: 'FynnHicken/treffen', branch: 'experimentell' }
];

const DEFAULT_CHANNEL_ID = 'stable';
const CHANNEL_STATE_FILE = process.env.TREFFEN_UPDATE_CHANNEL_FILE || '/tmp/treffen-update-channel.txt';
const CACHE_TTL_MS = 60 * 1000;

let activeChannelId = DEFAULT_CHANNEL_ID;
const envDefault = (process.env.TREFFEN_UPDATE_DEFAULT_CHANNEL || '').trim();
if (lookupChannel(envDefault)) activeChannelId = lookupChannel(envDefault).id;
try {
    if (fs.existsSync(CHANNEL_STATE_FILE)) {
        const saved = fs.readFileSync(CHANNEL_STATE_FILE, 'utf8').trim();
        if (lookupChannel(saved)) activeChannelId = saved;
    }
} catch {}

const statusCache = new Map(); // channelId -> { fetchedAt, data }
let updateInProgress = false;

export function lookupChannel(id) {
    const norm = String(id || '').trim().toLowerCase();
    return UPDATE_CHANNELS.find(c => c.id === norm) || null;
}

export function resolveChannel(overrideId = '') {
    const envLocked = (process.env.TREFFEN_UPDATE_CHANNEL || '').trim();
    if (envLocked) {
        const found = lookupChannel(envLocked);
        if (found) return { channel: found, lockedByEnv: true };
    }
    if (overrideId) {
        const found = lookupChannel(overrideId);
        if (found) return { channel: found, lockedByEnv: false };
    }
    return { channel: lookupChannel(activeChannelId) || UPDATE_CHANNELS[0], lockedByEnv: false };
}

export function setActiveChannel(channelId) {
    const envLocked = (process.env.TREFFEN_UPDATE_CHANNEL || '').trim();
    if (envLocked) {
        return { error: 'Update-Kanal ist per Umgebungsvariable TREFFEN_UPDATE_CHANNEL festgelegt.' };
    }
    const ch = lookupChannel(channelId);
    if (!ch) return { error: 'Unbekannter Update-Kanal.' };
    activeChannelId = ch.id;
    try {
        fs.writeFileSync(CHANNEL_STATE_FILE, ch.id, 'utf8');
    } catch {}
    statusCache.delete(ch.id);
    return { ok: true, channel: ch };
}

export function detectRuntime() {
    if (process.env.FLY_APP_NAME) return 'fly';
    if ((process.env.HOST_OS || '').toLowerCase() === 'unraid') return 'unraid';
    return 'docker';
}

export async function checkForUpdate({ channelId = '', force = false } = {}) {
    const { channel, lockedByEnv } = resolveChannel(channelId);
    const build = readBuildInfo();
    const webhookUrl = (process.env.TREFFEN_UPDATE_WEBHOOK_URL || '').trim();
    const runtime = detectRuntime();

    const cached = statusCache.get(channel.id);
    if (!force && cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
        return {
            ...cached.data,
            installed_version: INSTALLED_VERSION,
            installed_sha: build.sha,
            installed_short: build.sha ? build.sha.slice(0, 7) : '',
            built_at: build.builtAt,
            channel,
            channels: UPDATE_CHANNELS,
            locked_by_env: lockedByEnv,
            runtime,
            can_apply_webhook: Boolean(webhookUrl),
            update_in_progress: updateInProgress,
            cached: true
        };
    }

    const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Treffen-Updater/1.0'
    };
    const token = (process.env.GITHUB_TOKEN || '').trim();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const apiBase = (process.env.TREFFEN_GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
    const url = `${apiBase}/repos/${channel.repo}/commits/${encodeURIComponent(channel.branch)}`;

    let latestSha = '';
    let latestMessage = '';
    let latestDate = '';
    let latestAuthor = '';
    let htmlUrl = '';
    let error = '';

    try {
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
        if (!resp.ok) {
            error = `GitHub API HTTP ${resp.status}`;
        } else {
            const json = await resp.json();
            latestSha = String(json.sha || '').trim().toLowerCase();
            latestMessage = String(json.commit?.message || '').split('\n')[0].trim();
            latestDate = String(json.commit?.committer?.date || json.commit?.author?.date || '').trim();
            latestAuthor = String(json.commit?.author?.name || json.author?.login || '').trim();
            htmlUrl = String(json.html_url || '').trim();
        }
    } catch (err) {
        error = err?.message || 'GitHub nicht erreichbar';
    }

    const hasUpdate = Boolean(
        !error &&
        latestSha &&
        build.sha &&
        !latestSha.startsWith(build.sha) &&
        !build.sha.startsWith(latestSha)
    );

    const payload = {
        installed_version: INSTALLED_VERSION,
        installed_sha: build.sha,
        installed_short: build.sha ? build.sha.slice(0, 7) : '',
        built_at: build.builtAt,
        channel,
        channels: UPDATE_CHANNELS,
        locked_by_env: lockedByEnv,
        runtime,
        can_apply_webhook: Boolean(webhookUrl),
        update_in_progress: updateInProgress,
        latest_sha: latestSha,
        latest_short: latestSha ? latestSha.slice(0, 7) : '',
        latest_message: latestMessage,
        latest_date: latestDate,
        latest_author: latestAuthor,
        html_url: htmlUrl,
        has_update: hasUpdate,
        checked_at: new Date().toISOString(),
        error
    };

    if (!error) {
        statusCache.set(channel.id, { fetchedAt: Date.now(), data: payload });
    }
    return payload;
}

export async function triggerWebhookUpdate(channelId = '') {
    const webhookUrl = (process.env.TREFFEN_UPDATE_WEBHOOK_URL || '').trim();
    if (!webhookUrl) {
        return { status: 400, body: { error: 'Kein Unraid-Update-Webhook (TREFFEN_UPDATE_WEBHOOK_URL) konfiguriert.' } };
    }
    if (updateInProgress) {
        return { status: 409, body: { error: 'Ein Update läuft bereits.' } };
    }

    const { channel } = resolveChannel(channelId);
    const headers = { 'Content-Type': 'application/json' };
    const secret = (process.env.TREFFEN_UPDATE_WEBHOOK_SECRET || '').trim();
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    updateInProgress = true;
    try {
        const resp = await fetch(webhookUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ channel: channel.id, repo: channel.repo, branch: channel.branch }),
            signal: AbortSignal.timeout(10000)
        });
        const text = await resp.text();
        let data = {};
        try { data = JSON.parse(text); } catch { data = { message: text }; }
        if (!resp.ok) {
            updateInProgress = false;
            return { status: resp.status, body: { error: data.error || data.message || `Webhook HTTP ${resp.status}` } };
        }
        return {
            status: 202,
            body: {
                ok: true,
                channel: channel.id,
                message: data.message || `Update für Kanal „${channel.label}“ gestartet. Der Container startet gleich neu.`
            }
        };
    } catch (err) {
        updateInProgress = false;
        return { status: 502, body: { error: `Update-Webhook nicht erreichbar: ${err?.message || err}` } };
    }
}

export function verifyHubHostTicket(token, secret) {
    if (!secret) return { ok: true, devMode: true };
    if (!token || typeof token !== 'string' || !token.includes('.')) return { ok: false, error: 'Fehlendes Host-Ticket.' };
    const [body, sig] = token.split('.', 2);
    const expected = crypto.createHmac('sha256', secret).update(body).digest();
    const actual = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
        return { ok: false, error: 'Ungültiges Host-Ticket.' };
    }
    try {
        const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        const expMs = payload.exp ? (payload.exp < 1e12 ? payload.exp * 1000 : payload.exp) : 0;
        if (expMs && Date.now() > expMs) return { ok: false, error: 'Host-Ticket abgelaufen.' };
        if (!payload.host) return { ok: false, error: 'Nur der Host darf Updates verwalten.' };
        return { ok: true, payload };
    } catch {
        return { ok: false, error: 'Defektes Host-Ticket.' };
    }
}
