/**
 * Dame – das ganze Client-Spiel. Brett (Holz mit gemalten Feldern), Steine („disc“, Dame = „king“), Statuszeile,
 * Markierungen und Siegerehrung kommen aus der Engine; die Regeln liefern Layout und Spielstand.
 */
import { startTable } from '@treffen/tabletop';

startTable({ id: 'dame', title: 'Dame', texts: { start: 'Partie', newRound: 'Neue Partie', rejected: 'So darf der Stein nicht ziehen.' } });
