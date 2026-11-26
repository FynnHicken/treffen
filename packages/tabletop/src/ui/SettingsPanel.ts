/**
 * Hausregeln: Knopf „⚙️ Hausregeln“ + Fenster mit den Einstellungen aus `state.settings_schema`.
 * Der Host ändert sie in der Lobby, alle anderen (und alle während des Spiels) sehen sie nur.
 * Spielneutral: Ein- / Aus-Schalter für bool, Auswahl für Zahlenbereiche und feste Werte.
 */
import { escapeHtml } from '@treffen/boardgame-kit';
import type { TableClient } from '../net/TableClient';
import type { SettingSpec, SettingValue, TableState } from '../net/state';

export class SettingsPanel {
    readonly button: HTMLButtonElement;
    private overlay: HTMLDivElement;
    private card: HTMLDivElement;

    constructor(private client: TableClient, mount: HTMLElement) {
        this.button = document.createElement('button');
        this.button.className = 'tt-settings-btn';
        this.button.type = 'button';
        this.button.hidden = true;
        mount.appendChild(this.button);

        this.overlay = document.createElement('div');
        this.overlay.className = 'tt-settings';
        this.overlay.hidden = true;
        this.card = document.createElement('div');
        this.card.className = 'tt-settings-card';
        this.card.setAttribute('role', 'dialog');
        this.card.setAttribute('aria-label', 'Hausregeln');
        this.overlay.appendChild(this.card);
        document.body.appendChild(this.overlay);

        this.button.addEventListener('click', () => this.open(true));
        this.overlay.addEventListener('click', ev => {
            if (ev.target === this.overlay || (ev.target as HTMLElement).closest('[data-close]')) this.open(false);
        });
        this.card.addEventListener('change', ev => {
            const el = ev.target as HTMLInputElement | HTMLSelectElement;
            const key = el.dataset.key;
            const spec = key ? this.client.state?.settings_schema?.[key] : undefined;
            if (!key || !spec) return;
            let v: SettingValue;
            if (el instanceof HTMLInputElement && el.type === 'checkbox') v = el.checked;
            else if (typeof spec.default === 'number') v = Number(el.value);
            else v = el.value;
            this.client.setSettings({ [key]: v });
        });
        document.addEventListener('keydown', ev => { if (ev.key === 'Escape') this.open(false); });
        client.onState(s => this.render(s));
    }

    open(show: boolean): void {
        this.overlay.hidden = !show;
        if (show && this.client.state) this.render(this.client.state);
    }

    private render(s: TableState): void {
        const schema = s.settings_schema ?? {};
        const keys = Object.keys(schema);
        const editable = this.client.isHost && s.status === 'lobby';
        this.button.hidden = !keys.length || s.status === 'playing';      // im Spiel nicht im Weg
        this.button.textContent = editable ? '⚙️ Hausregeln' : '📜 Hausregeln';
        if (!keys.length || this.overlay.hidden) return;
        const values = s.settings ?? {};
        const rows = keys.map(k => row(k, schema[k], values[k] ?? schema[k].default, editable)).join('');
        const note = editable ? 'Gilt ab dem Spielstart für alle.'
            : s.status === 'lobby' ? 'Nur der Host kann die Hausregeln ändern.' : 'Während des Spiels bleiben die Regeln, wie sie sind.';
        this.card.innerHTML = `<h2>Hausregeln</h2>${rows}<p class="tt-settings-note">${note}</p>
            <button type="button" class="tt-settings-close" data-close>Fertig</button>`;
    }
}

function row(key: string, spec: SettingSpec, value: SettingValue, editable: boolean): string {
    const id = `tt-set-${escapeHtml(key)}`;
    const dis = editable ? '' : ' disabled';
    const hint = spec.hint ? `<small>${escapeHtml(spec.hint)}</small>` : '';
    const label = `<label for="${id}"><span>${escapeHtml(spec.label)}</span>${hint}</label>`;
    if (typeof spec.default === 'boolean') {
        return `<div class="tt-settings-row">${label}<input type="checkbox" role="switch" class="tt-switch" id="${id}"
            data-key="${escapeHtml(key)}"${value ? ' checked' : ''}${dis}></div>`;
    }
    let options: SettingValue[] = spec.choices ?? [];
    if (!options.length && typeof spec.default === 'number' && spec.min != null && spec.max != null) {
        for (let n = spec.min; n <= spec.max; n++) options.push(n);
    }
    const opts = options.map(o => `<option value="${escapeHtml(String(o))}"${o === value ? ' selected' : ''}>${escapeHtml(String(o))}</option>`).join('');
    return `<div class="tt-settings-row">${label}<select id="${id}" data-key="${escapeHtml(key)}"${dis}>${opts}</select></div>`;
}
