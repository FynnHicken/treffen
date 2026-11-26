/**
 * Alles, was von anderen Spielern kommt (Namen, Chat, Log), vor innerHTML hiermit escapen.
 */
export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
