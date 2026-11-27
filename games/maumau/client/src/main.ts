/**
 * Mau-Mau – das ganze Client-Spiel. Karten, Stapel, Hände, Knöpfe („Weiter“, Farbe wünschen) und Anzeige kommen
 * aus der Engine (2.4); die Regeln liefern Layout, Kartenkatalog und Spielstand.
 */
import { startTable } from '@treffen/tabletop';

startTable({
    id: 'maumau',
    title: 'Mau-Mau',
    hint: 'Karte auf die Ablage ziehen oder antippen · Stapel antippen = Karte ziehen',
    texts: { rejected: 'Die Karte passt nicht.' },
});
