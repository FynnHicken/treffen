/**
 * Übergang: Der bestehende Monopoly-Code (src/legacy/) erwartet Three.js als globales `THREE`
 * inkl. `THREE.OrbitControls` – so wie früher per <script>-Tag. Wird beim Umbau auf Imports
 * nach und nach überflüssig.
 */
import * as THREE_NS from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const THREE = { ...THREE_NS, OrbitControls };
(window as any).THREE = THREE;
export default THREE;
