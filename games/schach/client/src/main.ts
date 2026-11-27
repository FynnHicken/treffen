/**
 * Schach – 3D-Spieltisch (läuft eigenständig auf Port 8096 oder im Hub unter /schach/).
 * Alles Spielneutrale (Oberfläche, Statuszeile, Markierungen, Lobby) kommt aus der Spieltisch-App der Engine;
 * hier stehen nur Brett und Figuren. „Schach!“, letzter Zug und Punkte schreiben die Regeln in den Spielstand.
 */
import { startTable } from '@treffen/tabletop';
import { BOARD_THICKNESS, createBoard } from './board';
import { createChessPiece } from './pieces';

startTable({
    id: 'schach',
    title: 'Schach',
    texts: { start: 'Partie', newRound: 'Neue Partie', rejected: 'So darf die Figur nicht ziehen.' },
    shareText: 'Link kopiert – schick ihn deinem Gegenüber',
    liftHeight: 0.6,
    // klassisch / Team / Tandem / Vierschach – neu, wenn der Host in der Lobby eine andere Spielart wählt
    board: (layout, ctx) => ({
        object: createBoard(layout, ctx.anisotropy, ctx.hiRes),
        surfaceY: BOARD_THICKNESS,
        // Vierschach hat Ablagen in den Tischecken → etwas mehr Tisch ins Bild
        focusRadius: layout.board?.kind === 'vierer' ? 6.7 : 6.2,
    }),
    piece: (_id, spec, layout) => {
        const sp = spec as typeof spec & { facing?: number; inward?: number };
        return createChessPiece(spec.kind, layout.palette?.[spec.color ?? ''] ?? '#999',
            sp.facing ?? (spec.seat === 0 ? 180 : 0), sp.inward ?? 0, Math.min(1, (layout.board?.spacing ?? 0.92) / 0.92));
    },
});
