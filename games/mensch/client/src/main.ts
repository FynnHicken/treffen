/**
 * Mensch ärgere dich nicht – 3D-Spieltisch (läuft eigenständig auf Port 8095 oder im Hub unter /mensch/).
 * Alles Spielneutrale (Oberfläche, Statuszeile, Würfel, Figuren, Lobby) kommt aus der Spieltisch-App der Engine;
 * hier steht nur das Brett. Die Statuszeile schreiben die Regeln (`say`), Rauswürfe melden sie als NOTE.
 */
import { boardObstacles, startTable } from '@treffen/tabletop';
import { BOARD_THICKNESS, createBoard } from './board';

startTable({
    id: 'mensch',
    title: 'Mensch ärgere dich nicht',
    hint: 'Becher greifen & schütteln = würfeln · Ziehen: drehen · Zwei Finger: zoomen · Doppeltipp: zurück',
    // Brett für 4, 6 oder 8 – die Engine baut es neu, wenn der Host ein anderes wählt
    board: (layout, ctx) => ({
        object: createBoard(layout, ctx.anisotropy, ctx.hiRes),
        surfaceY: BOARD_THICKNESS,
        obstacles: boardObstacles(layout, BOARD_THICKNESS),
    }),
});
