/**
 * Monopoly 3D Board & Visual Engine - Wii / 2012 Console Edition
 * Authentic 3D Tabletop with Physical Deed Cards lying on the table,
 * 3D Banknote Stacks, Colored Board-Rim Ownership Tabs, Metallic Tokens,
 * Smooth Camera Presets (2D, 2.5D, 3D), and Fluid Board Rotation.
 */

(function(window) {
    'use strict';

    let scene, camera, renderer, controls;
    let worldGroup = null; // Holds board, table, tokens, houses, dice, and table cards
    let boardMesh = null;
    let tokenMeshes = {}; // playerId -> THREE.Group
    let tokenLoadRequests = {}; // playerId -> { key, player }
    let houseMeshes = {}; // sq_idx -> [THREE.Mesh]
    let diceGroup = null;
    let dice1 = null, dice2 = null;
    let isDiceRolling = false;

    // Physical Tabletop Collections
    let tableCardsGroup = null; // Physical 3D deed cards on the wooden table
    let tableBillsGroup = null; // 3D Banknote stacks on the table
    let boardTabsGroup = null;  // Colored ownership tabs on the board rim
    let boardDecksGroup = null; // 3D Card Decks (Chance & Community Chest) on the board
    let drawnCardMeshes = {};   // 'Gemeinschaft' -> mesh, 'Ereignis' -> mesh
    let lastDrawnCards = {};    // 'Gemeinschaft' -> text, 'Ereignis' -> text

    let container = null;
    let isInitialized = false;
    let cameraMode = '2.5d';
    let isTransitioningCamera = false;
    let currentTransitionId = 0;
    let currentFocusedSeat = null;

    const BOARD_SIZE = 10.0;
    const HALF_BOARD = BOARD_SIZE / 2.0;
    const CORNER_SIZE = 1.35;
    const INNER_STEP = (BOARD_SIZE - 2 * CORNER_SIZE) / 9.0; // ~0.811

    const DEFAULT_ANIM_CONFIG = {
        stepDuration: 280,     // ms per field hop (slower default, was 120)
        stepPause: 75,         // ms pause between hops (was 25)
        hopHeight: 0.38,       // vertical hop arc height
        landingHold: 900,      // ms hold on destination square before camera resets (was 650)
        diceDuration: 1350,    // ms 3D dice roll duration (was 1100)
        dicePostPause: 550,    // ms pause after dice settle (was 400)
        camFollowLerp: 0.10,   // camera tracking smoothness (was 0.18)
        camTransitionMs: 650,  // ms camera zoom transition duration (was 450)
        cinematicFollow: true  // follow token with camera during move
    };

    let animConfig = Object.assign({}, DEFAULT_ANIM_CONFIG);
    try {
        const savedCfg = localStorage.getItem('monopoly_anim_config_v1');
        if (savedCfg) {
            const parsed = JSON.parse(savedCfg);
            if (parsed && typeof parsed === 'object') {
                Object.assign(animConfig, parsed);
            }
        }
    } catch (e) {}

    // Exact Euler rotations (order XYZ) to point each rolled face (1-6) straight UP (+Y)
    const DICE_EULER_FACING_UP = {
        1: new THREE.Euler(0, 0, 0),
        2: new THREE.Euler(0, 0, -Math.PI / 2),
        3: new THREE.Euler(-Math.PI / 2, 0, 0),
        4: new THREE.Euler(Math.PI / 2, 0, 0),
        5: new THREE.Euler(0, 0, Math.PI / 2),
        6: new THREE.Euler(Math.PI, 0, 0)
    };

    function getDieQuaternion(num, yaw = 0) {
        const baseEuler = DICE_EULER_FACING_UP[num] || DICE_EULER_FACING_UP[1];
        const qBase = new THREE.Quaternion().setFromEuler(baseEuler);
        if (yaw !== 0) {
            const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            return qYaw.multiply(qBase);
        }
        return qBase;
    }

    // Raycasting for square and table card selection
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let onSquareClickCallback = null;

    // Deed card texture mapping
    const DEED_CARD_IMAGES = {
        1: 'static/assets/cards/01_braun_badstrasse.png',
        3: 'static/assets/cards/02_braun_turmstrasse.png',
        5: 'static/assets/cards/03_bahnhof_suedbahnhof.png',
        6: 'static/assets/cards/04_hellblau_chausseestrasse.png',
        8: 'static/assets/cards/05_hellblau_elisenstrasse.png',
        9: 'static/assets/cards/06_hellblau_poststrasse.png',
        11: 'static/assets/cards/07_pink_seestrasse.png',
        12: 'static/assets/cards/08_werk_elektrizitaetswerk.png',
        13: 'static/assets/cards/09_pink_hafenstrasse.png',
        14: 'static/assets/cards/10_pink_neuestrasse.png',
        15: 'static/assets/cards/11_bahnhof_westbahnhof.png',
        16: 'static/assets/cards/12_orange_muenchenerstrasse.png',
        18: 'static/assets/cards/13_orange_wienerstrasse.png',
        19: 'static/assets/cards/14_orange_berlinerstrasse.png',
        21: 'static/assets/cards/15_rot_theaterstrasse.png',
        23: 'static/assets/cards/16_rot_museumstrasse.png',
        24: 'static/assets/cards/17_rot_opernplatz.png',
        25: 'static/assets/cards/18_bahnhof_nordbahnhof.png',
        26: 'static/assets/cards/19_gelb_lessingstrasse.png',
        27: 'static/assets/cards/20_gelb_schillerstrasse.png',
        28: 'static/assets/cards/21_werk_wasserwerk.png',
        29: 'static/assets/cards/22_gelb_goethestrasse.png',
        31: 'static/assets/cards/23_gruen_rathausplatz.png',
        32: 'static/assets/cards/24_gruen_hauptstrasse.png',
        34: 'static/assets/cards/25_gruen_bahnhofstrasse.png',
        35: 'static/assets/cards/26_bahnhof_hauptbahnhof.png',
        37: 'static/assets/cards/27_dunkelblau_parkstrasse.png',
        39: 'static/assets/cards/28_dunkelblau_schlossallee.png'
    };

    // Fast inline OBJ parser with UV texture coordinates
    function parseOBJ(text) {
        const positions = [];
        const uvs = [];
        const indices = [];
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('v ')) {
                const parts = line.split(/\s+/);
                positions.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
            } else if (line.startsWith('vt ')) {
                const parts = line.split(/\s+/);
                uvs.push(parseFloat(parts[1]), parseFloat(parts[2]));
            } else if (line.startsWith('f ')) {
                const parts = line.split(/\s+/).slice(1);
                const fIndices = parts.map(p => parseInt(p.split('/')[0]) - 1);
                if (fIndices.length === 3) {
                    indices.push(fIndices[0], fIndices[1], fIndices[2]);
                } else if (fIndices.length === 4) {
                    indices.push(fIndices[0], fIndices[1], fIndices[2], fIndices[0], fIndices[2], fIndices[3]);
                }
            }
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (uvs.length === (positions.length / 3) * 2) {
            geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        }
        if (indices.length > 0) geom.setIndex(indices);
        geom.computeVertexNormals();
        geom.computeBoundingBox();
        return geom;
    }

    // Coordinates for square index 0..39 (Token standing area in the non-colored street body)
    function getSquareCenter(sqIdx, inJail = false) {
        let x = 0, z = 0;
        const sideTokenMid = HALF_BOARD - CORNER_SIZE / 2 + 0.15; // Shifted outward away from the inner colored header strip
        if (sqIdx === 0) {
            x = HALF_BOARD - CORNER_SIZE / 2;
            z = HALF_BOARD - CORNER_SIZE / 2;
        } else if (sqIdx > 0 && sqIdx < 10) {
            x = HALF_BOARD - CORNER_SIZE - (sqIdx - 0.5) * INNER_STEP;
            z = sideTokenMid;
        } else if (sqIdx === 10) {
            const cx = -HALF_BOARD + CORNER_SIZE / 2;
            const cz = HALF_BOARD - CORNER_SIZE / 2;
            if (inJail) {
                // Inside the orange "IM GEFÄNGNIS" cell (inner top-right of corner 10)
                x = cx + 0.21;
                z = cz - 0.21;
            } else {
                // Outer "NUR ZU BESUCH" walkway (outer bottom-left edge of corner 10)
                x = cx - 0.39;
                z = cz + 0.39;
            }
        } else if (sqIdx > 10 && sqIdx < 20) {
            const step = sqIdx - 10;
            x = -sideTokenMid;
            z = HALF_BOARD - CORNER_SIZE - (step - 0.5) * INNER_STEP;
        } else if (sqIdx === 20) {
            x = -HALF_BOARD + CORNER_SIZE / 2;
            z = -HALF_BOARD + CORNER_SIZE / 2;
        } else if (sqIdx > 20 && sqIdx < 30) {
            const step = sqIdx - 20;
            x = -HALF_BOARD + CORNER_SIZE + (step - 0.5) * INNER_STEP;
            z = -sideTokenMid;
        } else if (sqIdx === 30) {
            x = HALF_BOARD - CORNER_SIZE / 2;
            z = -HALF_BOARD + CORNER_SIZE / 2;
        } else if (sqIdx > 30 && sqIdx < 40) {
            const step = sqIdx - 30;
            x = sideTokenMid;
            z = -HALF_BOARD + CORNER_SIZE + (step - 0.5) * INNER_STEP;
        }
        return { x, z };
    }

    // Non-overlapping slot position & scale when multiple tokens share a square
    function computeSquareSlotTransform(sqIdx, inJail, slotIdx, count) {
        const center = getSquareCenter(sqIdx, inJail);
        if (!count || count <= 1) {
            return { x: center.x, y: 0.09, z: center.z, scale: 1.0 };
        }

        // 1. Corner 10: "NUR ZU BESUCH" L-shaped outer walkway
        if (sqIdx === 10 && !inJail) {
            const cx = -HALF_BOARD + CORNER_SIZE / 2;
            const cz = HALF_BOARD - CORNER_SIZE / 2;
            const visitSlots = [
                { x: cx - 0.39, z: cz + 0.39 },
                { x: cx + 0.32, z: cz + 0.42 },
                { x: cx - 0.42, z: cz - 0.32 },
                { x: cx - 0.03, z: cz + 0.42 },
                { x: cx - 0.42, z: cz + 0.03 },
                { x: cx + 0.46, z: cz + 0.42 }
            ];
            const slot = visitSlots[slotIdx % visitSlots.length];
            const scale = count === 2 ? 0.78 : (count <= 4 ? 0.68 : 0.56);
            return { x: slot.x, y: 0.09, z: slot.z, scale };
        }

        // 2. Corner 10: Inside orange "IM GEFÄNGNIS" cell
        if (sqIdx === 10 && inJail) {
            let scale = 0.65;
            let dx = 0, dz = 0;
            if (count === 2) {
                scale = 0.65;
                const slots = [
                    { dx: -0.16, dz: -0.12 },
                    { dx:  0.16, dz:  0.12 }
                ];
                dx = slots[slotIdx % 2].dx;
                dz = slots[slotIdx % 2].dz;
            } else if (count === 3) {
                scale = 0.58;
                const angle = (slotIdx / 3) * Math.PI * 2 - Math.PI / 2;
                dx = Math.cos(angle) * 0.18;
                dz = Math.sin(angle) * 0.18;
            } else if (count === 4) {
                scale = 0.55;
                const slots = [
                    { dx: -0.15, dz: -0.15 },
                    { dx:  0.15, dz: -0.15 },
                    { dx: -0.15, dz:  0.15 },
                    { dx:  0.15, dz:  0.15 }
                ];
                dx = slots[slotIdx % 4].dx;
                dz = slots[slotIdx % 4].dz;
            } else {
                scale = 0.46;
                const angle = (slotIdx / count) * Math.PI * 2;
                dx = Math.cos(angle) * 0.21;
                dz = Math.sin(angle) * 0.21;
            }
            return { x: center.x + dx, y: 0.09, z: center.z + dz, scale };
        }

        // 3. Other Corners (LOS = 0, Frei Parken = 20, Gehe ins Gefängnis = 30)
        if (sqIdx === 0 || sqIdx === 20 || sqIdx === 30) {
            let scale = 0.82;
            let dx = 0, dz = 0;
            if (count === 2) {
                scale = 0.82;
                const slots = [
                    { dx: -0.24, dz: -0.16 },
                    { dx:  0.24, dz:  0.16 }
                ];
                dx = slots[slotIdx % 2].dx;
                dz = slots[slotIdx % 2].dz;
            } else if (count === 3) {
                scale = 0.75;
                const angle = (slotIdx / 3) * Math.PI * 2 - Math.PI / 2;
                dx = Math.cos(angle) * 0.26;
                dz = Math.sin(angle) * 0.26;
            } else if (count === 4) {
                scale = 0.70;
                const slots = [
                    { dx: -0.22, dz: -0.22 },
                    { dx:  0.22, dz: -0.22 },
                    { dx: -0.22, dz:  0.22 },
                    { dx:  0.22, dz:  0.22 }
                ];
                dx = slots[slotIdx % 4].dx;
                dz = slots[slotIdx % 4].dz;
            } else {
                scale = 0.58;
                const angle = (slotIdx / count) * Math.PI * 2;
                dx = Math.cos(angle) * 0.30;
                dz = Math.sin(angle) * 0.30;
            }
            return { x: center.x + dx, y: 0.09, z: center.z + dz, scale };
        }

        // 4. Regular Side Squares (Streets, Railroads, Utilities, Action Tiles)
        // Local coordinates: dT = tangential (along board edge, width 0.811), dR = radial (outward toward board rim, depth ~1.03)
        let scale = 0.72;
        let dT = 0, dR = 0;
        if (count === 2) {
            scale = 0.72; // diameter ~0.317, center distance ~0.467
            const slots = [
                { dT: -0.16, dR: -0.17 },
                { dT:  0.16, dR:  0.17 }
            ];
            dT = slots[slotIdx % 2].dT;
            dR = slots[slotIdx % 2].dR;
        } else if (count === 3) {
            scale = 0.64; // diameter ~0.282, min center distance ~0.34
            const slots = [
                { dT: -0.17, dR:  0.18 },
                { dT:  0.17, dR:  0.18 },
                { dT:  0.00, dR: -0.18 }
            ];
            dT = slots[slotIdx % 3].dT;
            dR = slots[slotIdx % 3].dR;
        } else if (count === 4) {
            scale = 0.60; // diameter ~0.264, min center distance 0.34
            const slots = [
                { dT: -0.17, dR: -0.18 },
                { dT:  0.17, dR: -0.18 },
                { dT: -0.17, dR:  0.18 },
                { dT:  0.17, dR:  0.18 }
            ];
            dT = slots[slotIdx % 4].dT;
            dR = slots[slotIdx % 4].dR;
        } else {
            scale = 0.50; // diameter ~0.22, 2x3 grid
            const slots = [
                { dT: -0.17, dR: -0.24 },
                { dT:  0.17, dR: -0.24 },
                { dT: -0.17, dR:  0.00 },
                { dT:  0.17, dR:  0.00 },
                { dT: -0.17, dR:  0.24 },
                { dT:  0.17, dR:  0.24 }
            ];
            dT = slots[slotIdx % slots.length].dT;
            dR = slots[slotIdx % slots.length].dR;
        }

        let dx = 0, dz = 0;
        if (sqIdx > 0 && sqIdx < 10) {
            dx = dT;
            dz = dR;
        } else if (sqIdx > 10 && sqIdx < 20) {
            dx = -dR;
            dz = dT;
        } else if (sqIdx > 20 && sqIdx < 30) {
            dx = -dT;
            dz = -dR;
        } else {
            dx = dR;
            dz = -dT;
        }

        return { x: center.x + dx, y: 0.09, z: center.z + dz, scale };
    }

    // Texture Caches
    const cardTextureCache = {};
    function getDeedTexture(sqIdx) {
        if (!cardTextureCache[sqIdx]) {
            const url = DEED_CARD_IMAGES[sqIdx];
            if (url) {
                const tex = new THREE.TextureLoader().load(url);
                tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                tex.generateMipmaps = true;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                cardTextureCache[sqIdx] = tex;
            }
        }
        return cardTextureCache[sqIdx];
    }

    const jailFreeTextureCache = {};
    function getJailFreeTexture(cardIdx) {
        const key = (cardIdx % 2 === 1) ? 'gemeinschaft_16' : 'ereignis_16';
        if (!jailFreeTextureCache[key]) {
            const url = `static/assets/chance_chest/cards/${key}.png`;
            const tex = new THREE.TextureLoader().load(url);
            tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            jailFreeTextureCache[key] = tex;
        }
        return jailFreeTextureCache[key];
    }

    let banknoteTexture = null;
    function getBanknoteTexture() {
        if (!banknoteTexture) {
            const tex = new THREE.TextureLoader().load('static/assets/bills/geldschein_100.png');
            tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            banknoteTexture = tex;
        }
        return banknoteTexture;
    }

    // Load authentic High-Res German Board Texture from ROM (2048x2048)
    function loadBoardTexture(onTextureReady) {
        const loader = new THREE.TextureLoader();
        loader.load(
            'static/assets/textures/board_de_2048.png',
            function(texture) {
                texture.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                texture.generateMipmaps = true;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.anisotropy = 16;
                if (onTextureReady) onTextureReady(texture);
            },
            undefined,
            function() {
                console.warn('Fallback: generating canvas board texture...');
                generateBoardTexture(onTextureReady);
            }
        );
    }

    // Fallback Canvas Texture Generator
    function generateBoardTexture(onTextureReady) {
        const size = 2048;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#dbead2';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, size - 8, size - 8);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
        if (onTextureReady) onTextureReady(tex);
    }

    // Build the Board + Wooden Table Object
    function buildBoardObject(texture) {
        const group = new THREE.Group();

        // 1. Table Top (Surrounding rich walnut wooden table)
        const tableGeo = new THREE.CylinderGeometry(15, 15, 0.4, 48);
        const tableMat = new THREE.MeshStandardMaterial({
            color: 0x3a2414,
            roughness: 0.5,
            metalness: 0.1
        });
        const table = new THREE.Mesh(tableGeo, tableMat);
        table.position.y = -0.22;
        table.receiveShadow = true;
        group.add(table);

        // 2. Monopoly Board Slab
        const slabGeo = new THREE.BoxGeometry(BOARD_SIZE, 0.18, BOARD_SIZE);
        const slabMaterials = [
            new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.5 }), // Right
            new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.5 }), // Left
            new THREE.MeshStandardMaterial({ map: texture, roughness: 0.32, metalness: 0.04 }), // Board Face
            new THREE.MeshStandardMaterial({ color: 0x140c07 }), // Bottom
            new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.5 }), // Front
            new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.5 })  // Back
        ];
        const slab = new THREE.Mesh(slabGeo, slabMaterials);
        slab.receiveShadow = true;
        slab.castShadow = true;
        group.add(slab);

        // 3. Subtle raised wooden rim around the board
        const trimMat = new THREE.MeshStandardMaterial({ color: 0x4a2c16, roughness: 0.35, metalness: 0.1 });
        const trimThick = 0.08;
        const trimH = 0.22;

        const leftBorder = new THREE.Mesh(new THREE.BoxGeometry(trimThick, trimH, BOARD_SIZE + 0.16), trimMat);
        leftBorder.position.set(-HALF_BOARD - trimThick / 2, 0.02, 0);
        group.add(leftBorder);

        const rightBorder = new THREE.Mesh(new THREE.BoxGeometry(trimThick, trimH, BOARD_SIZE + 0.16), trimMat);
        rightBorder.position.set(HALF_BOARD + trimThick / 2, 0.02, 0);
        group.add(rightBorder);

        const topBorder = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE, trimH, trimThick), trimMat);
        topBorder.position.set(0, 0.02, -HALF_BOARD - trimThick / 2);
        group.add(topBorder);

        const btmBorder = new THREE.Mesh(new THREE.BoxGeometry(BOARD_SIZE, trimH, trimThick), trimMat);
        btmBorder.position.set(0, 0.02, HALF_BOARD + trimThick / 2);
        group.add(btmBorder);

        // 4. Physical 3D Card Decks (Chance & Community Chest) on the board
        buildBoardDecks(group);

        return group;
    }

    // Build Authentic 3D Card Decks on the Board
    function buildBoardDecks(boardGroup) {
        boardDecksGroup = new THREE.Group();

        const texLoader = new THREE.TextureLoader();
        const stackEdgeTex = texLoader.load('static/assets/chance_chest/deck_stack_edge.png');
        stackEdgeTex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;

        const gemBackTex = texLoader.load('static/assets/chance_chest/deck_gemeinschaft_back.png');
        gemBackTex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;

        const ereignisBackTex = texLoader.load('static/assets/chance_chest/deck_ereignis_back.png');
        ereignisBackTex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;

        const deckW = 1.05;
        const deckH = 0.12;
        const deckD = 1.58;
        const deckGeo = new THREE.BoxGeometry(deckW, deckH, deckD);

        const edgeMat = new THREE.MeshStandardMaterial({ map: stackEdgeTex, roughness: 0.85 });
        const bottomMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });

        // Align landscape back textures along the 1.58 long side of the deck
        gemBackTex.center.set(0.5, 0.5);
        gemBackTex.rotation = Math.PI / 2;
        ereignisBackTex.center.set(0.5, 0.5);
        ereignisBackTex.rotation = Math.PI / 2;

        // 1. Gemeinschaft (Community Chest) Deck Stack - Centered precisely in dashed GEMEINSCHAFTSFELD area (Top-Left)
        const gemTopMat = new THREE.MeshStandardMaterial({ map: gemBackTex, roughness: 0.35, metalness: 0.05 });
        const gemDeck = new THREE.Mesh(deckGeo, [edgeMat, edgeMat, gemTopMat, bottomMat, edgeMat, edgeMat]);
        gemDeck.position.set(-2.21, 0.09 + deckH / 2, -2.21);
        gemDeck.rotation.y = -Math.PI / 4;
        gemDeck.castShadow = true;
        gemDeck.receiveShadow = true;
        gemDeck.userData = { type: 'board_deck', deck: 'Gemeinschaft', baseY: 0.09 + deckH / 2 };
        boardDecksGroup.add(gemDeck);

        // Gemeinschaft Drawn Card Plane - Sits face-up on top of the deck stack (Landscape: 1.52 x 1.00 matching 456x300)
        const drawnGeo = new THREE.PlaneGeometry(1.52, 1.00);
        const gemDrawnMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.32,
            side: THREE.DoubleSide
        });
        const gemDrawnMesh = new THREE.Mesh(drawnGeo, gemDrawnMat);
        gemDrawnMesh.position.set(-2.21, 0.09 + deckH + 0.003, -2.21);
        gemDrawnMesh.rotation.x = -Math.PI / 2;
        gemDrawnMesh.rotation.z = Math.PI / 4;
        gemDrawnMesh.castShadow = true;
        gemDrawnMesh.receiveShadow = true;
        gemDrawnMesh.visible = false;
        gemDrawnMesh.userData = { type: 'drawn_card', deck: 'Gemeinschaft', baseY: 0.09 + deckH + 0.003 };
        boardDecksGroup.add(gemDrawnMesh);
        drawnCardMeshes['Gemeinschaft'] = gemDrawnMesh;

        // 2. Ereignis (Chance) Deck Stack - Centered precisely in dashed EREIGNISFELD area (Bottom-Right)
        const erTopMat = new THREE.MeshStandardMaterial({ map: ereignisBackTex, roughness: 0.35, metalness: 0.05 });
        const erDeck = new THREE.Mesh(deckGeo, [edgeMat, edgeMat, erTopMat, bottomMat, edgeMat, edgeMat]);
        erDeck.position.set(2.205, 0.09 + deckH / 2, 2.205);
        erDeck.rotation.y = -Math.PI / 4;
        erDeck.castShadow = true;
        erDeck.receiveShadow = true;
        erDeck.userData = { type: 'board_deck', deck: 'Ereignis', baseY: 0.09 + deckH / 2 };
        boardDecksGroup.add(erDeck);

        // Ereignis Drawn Card Plane - Sits face-up on top of the deck stack (Landscape: 1.52 x 1.00 matching 456x300)
        const erDrawnMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.32,
            side: THREE.DoubleSide
        });
        const erDrawnMesh = new THREE.Mesh(drawnGeo.clone(), erDrawnMat);
        erDrawnMesh.position.set(2.205, 0.09 + deckH + 0.003, 2.205);
        erDrawnMesh.rotation.x = -Math.PI / 2;
        erDrawnMesh.rotation.z = Math.PI / 4;
        erDrawnMesh.castShadow = true;
        erDrawnMesh.receiveShadow = true;
        erDrawnMesh.visible = false;
        erDrawnMesh.userData = { type: 'drawn_card', deck: 'Ereignis', baseY: 0.09 + deckH + 0.003 };
        boardDecksGroup.add(erDrawnMesh);
        drawnCardMeshes['Ereignis'] = erDrawnMesh;

        boardGroup.add(boardDecksGroup);
    }

    // High-Resolution 3D Drawn Card Canvas Texture Generator
    function createDrawnCardCanvasTexture(deckType, text) {
        const canvas = document.createElement('canvas');
        canvas.width = 768;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');

        const isChest = (deckType || '').toLowerCase().includes('gemein');
        const headerColor = isChest ? '#00a8eb' : '#f26522';
        const headerTitle = isChest ? 'GEMEINSCHAFTSKARTE' : 'EREIGNISKARTE';

        // Background
        ctx.fillStyle = '#fefcf6';
        ctx.fillRect(0, 0, 768, 512);

        // Outer border
        ctx.strokeStyle = headerColor;
        ctx.lineWidth = 14;
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(16, 16, 736, 480, 20);
            ctx.stroke();
        } else {
            ctx.strokeRect(16, 16, 736, 480);
        }

        // Inner border
        ctx.strokeStyle = '#e2d9c8';
        ctx.lineWidth = 3;
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(26, 26, 716, 460, 14);
            ctx.stroke();
        }

        // Header Banner
        ctx.fillStyle = headerColor;
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(40, 36, 688, 64, 12);
            ctx.fill();
        } else {
            ctx.fillRect(40, 36, 688, 64);
        }

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(headerTitle, 384, 68);

        // Card Text
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        wrapCanvasText(ctx, text, 480, 220, 440, 34);

        // Click hint
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText('🔍 Klicken für Großansicht', 384, 465);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;

        // Illustration on the left
        const getIllust = window.getCardIllustration || ((t) => 'static/assets/chance_chest/illustration_monopoly_mann.png');
        const imgUrl = getIllust(text);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            ctx.drawImage(img, 56, 150, 190, 190);
            tex.needsUpdate = true;
        };
        img.src = imgUrl;

        return tex;
    }

    function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
        if (!text) return;
        const words = text.split(' ');
        let line = '';
        let curY = y;
        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                ctx.fillText(line.trim(), x, curY);
                line = words[n] + ' ';
                curY += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line.trim(), x, curY);
    }

    const drawnCardTextureCache = {};

    function showDrawnCard(deck, text, cardImage) {
        const isChest = (deck || '').toLowerCase().includes('gemein');
        const key = isChest ? 'Gemeinschaft' : 'Ereignis';
        lastDrawnCards[key] = { text: text, image: cardImage };

        const mesh = drawnCardMeshes[key];
        if (!mesh) return;

        function applyCardTexture(tex) {
            mesh.material.map = tex;
            mesh.material.needsUpdate = true;
            if (tex.image && tex.image.width && tex.image.height) {
                const isLandscape = tex.image.width >= tex.image.height;
                const w = isLandscape ? 1.52 : 1.00;
                const h = isLandscape ? 1.00 : 1.52;
                if (mesh.geometry) mesh.geometry.dispose();
                mesh.geometry = new THREE.PlaneGeometry(w, h);
            }
        }

        if (cardImage) {
            if (drawnCardTextureCache[cardImage]) {
                applyCardTexture(drawnCardTextureCache[cardImage]);
            } else {
                // Immediately show canvas text texture while the card image loads
                const fallbackTex = createDrawnCardCanvasTexture(key, text);
                mesh.material.map = fallbackTex;
                mesh.material.needsUpdate = true;
                if (mesh.geometry) mesh.geometry.dispose();
                mesh.geometry = new THREE.PlaneGeometry(1.52, 1.00);

                const cardPath = (window.MonopolyAssets && window.MonopolyAssets.resolveUrl)
                    ? window.MonopolyAssets.resolveUrl('static/assets/chance_chest/cards/' + cardImage)
                    : 'static/assets/chance_chest/cards/' + cardImage;
                const loader = new THREE.TextureLoader();
                loader.load(cardPath, function(tex) {
                    tex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
                    tex.generateMipmaps = true;
                    tex.minFilter = THREE.LinearMipmapLinearFilter;
                    drawnCardTextureCache[cardImage] = tex;
                    if (mesh.userData && mesh.userData.cardImage === cardImage) {
                        applyCardTexture(tex);
                    }
                });
            }
        } else {
            const tex = createDrawnCardCanvasTexture(key, text);
            mesh.material.map = tex;
            mesh.material.needsUpdate = true;
            if (mesh.geometry) mesh.geometry.dispose();
            mesh.geometry = new THREE.PlaneGeometry(1.52, 1.00);
        }

        mesh.visible = true;
        mesh.userData.text = text;
        mesh.userData.cardImage = cardImage;
        mesh.rotation.z = Math.PI / 4 + 0.02;

        // Subtle pop-in animation
        const endY = mesh.userData.baseY || (0.09 + 0.12 + 0.005);
        const startY = endY + 0.16;
        let startT = performance.now();
        const duration = 400;
        function dropAnim(now) {
            const progress = Math.min(1.0, (now - startT) / duration);
            const ease = 1 - Math.pow(1 - progress, 3);
            mesh.position.y = startY - (startY - endY) * ease;
            if (progress < 1.0) {
                requestAnimationFrame(dropAnim);
            }
        }
        requestAnimationFrame(dropAnim);
    }

    function hideDrawnCards() {
        for (const [key, mesh] of Object.entries(drawnCardMeshes)) {
            if (mesh) {
                mesh.visible = false;
            }
        }
        lastDrawnCards = {};
    }

    // 3D Models Preloader
    let houseGeometry = null;
    let hotelGeometry = null;
    let diceGeometry = null;

    function preloadBuildingModels() {
        fetch('static/assets/models/house.obj')
            .then(res => res.text())
            .then(text => {
                const geom = parseOBJ(text);
                geom.computeBoundingBox();
                const center = new THREE.Vector3();
                geom.boundingBox.getCenter(center);
                geom.translate(-center.x, -geom.boundingBox.min.y, -center.z);
                const size = new THREE.Vector3();
                geom.boundingBox.getSize(size);
                const maxDim = Math.max(size.x, size.z) || 1.0;
                const scale = 0.17 / maxDim;
                geom.scale(scale, scale, scale);
                houseGeometry = geom;
            }).catch(() => {});

        fetch('static/assets/models/hotel.obj')
            .then(res => res.text())
            .then(text => {
                const geom = parseOBJ(text);
                geom.computeBoundingBox();
                const center = new THREE.Vector3();
                geom.boundingBox.getCenter(center);
                geom.translate(-center.x, -geom.boundingBox.min.y, -center.z);
                const size = new THREE.Vector3();
                geom.boundingBox.getSize(size);
                const maxDim = Math.max(size.x, size.z) || 1.0;
                const scale = 0.25 / maxDim;
                geom.scale(scale, scale, scale);
                hotelGeometry = geom;
            }).catch(() => {});

        fetch('static/assets/models/dice.obj')
            .then(res => res.text())
            .then(text => {
                const geom = parseOBJ(text);
                geom.computeBoundingBox();
                const center = new THREE.Vector3();
                geom.boundingBox.getCenter(center);
                geom.translate(-center.x, -center.y, -center.z);
                const size = new THREE.Vector3();
                geom.boundingBox.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
                const scale = 0.38 / maxDim;
                geom.scale(scale, scale, scale);
                diceGeometry = geom;
                if (dice1 && dice2) {
                    dice1.geometry = geom;
                    dice2.geometry = geom;
                    dice1.position.set(-0.38, 0.28, 0);
                    dice2.position.set(0.38, 0.28, 0);
                    dice1.quaternion.copy(getDieQuaternion(1, 0));
                    dice2.quaternion.copy(getDieQuaternion(2, 0));
                }
            }).catch(() => {});
    }
    preloadBuildingModels();

    // Dice Material
    let diceMaterialInstance = null;
    function getDiceMaterial() {
        if (!diceMaterialInstance) {
            const diceTex = new THREE.TextureLoader().load('static/assets/textures/dice_texture.png');
            diceTex.colorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
            diceTex.generateMipmaps = true;
            diceTex.minFilter = THREE.LinearMipmapLinearFilter;
            diceMaterialInstance = new THREE.MeshStandardMaterial({
                map: diceTex,
                roughness: 0.22,
                metalness: 0.05
            });
        }
        return diceMaterialInstance;
    }

    function buildDice() {
        diceGroup = new THREE.Group();
        const diceGeo = diceGeometry || new THREE.BoxGeometry(0.38, 0.38, 0.38);
        const diceMat = getDiceMaterial();

        dice1 = new THREE.Mesh(diceGeo, diceMat);
        dice1.castShadow = true;
        dice1.position.set(-0.38, 0.28, 0);
        diceGroup.add(dice1);

        dice2 = new THREE.Mesh(diceGeo, diceMat);
        dice2.castShadow = true;
        dice2.position.set(0.38, 0.28, 0);
        diceGroup.add(dice2);

        // Initial flat faces: 1 facing UP on die 1, 2 facing UP on die 2
        dice1.quaternion.copy(getDieQuaternion(1, 0));
        dice2.quaternion.copy(getDieQuaternion(2, 0));

        worldGroup.add(diceGroup);
    }

    function createHouseMesh() {
        const houseMat = new THREE.MeshStandardMaterial({
            color: 0x1f9d55,
            roughness: 0.3,
            metalness: 0.12
        });
        const geom = houseGeometry || new THREE.BoxGeometry(0.16, 0.14, 0.15);
        const mesh = new THREE.Mesh(geom, houseMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    function createHotelMesh() {
        const hotelMat = new THREE.MeshStandardMaterial({
            color: 0xdf2828,
            roughness: 0.28,
            metalness: 0.15
        });
        const geom = hotelGeometry || new THREE.BoxGeometry(0.24, 0.18, 0.20);
        const mesh = new THREE.Mesh(geom, hotelMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    // Token Model Loader
    const tokenGeometryCache = {};
    function loadTokenGeometry(tokenType, callback) {
        if (tokenGeometryCache[tokenType]) {
            callback(tokenGeometryCache[tokenType]);
            return;
        }
        const objPath = `static/assets/models/token_${tokenType}.obj`;
        fetch(objPath)
            .then(res => {
                if (!res.ok) throw new Error('Model not found');
                return res.text();
            })
            .then(text => {
                const geom = parseOBJ(text);
                geom.computeBoundingBox();
                const center = new THREE.Vector3();
                geom.boundingBox.getCenter(center);
                geom.translate(-center.x, -geom.boundingBox.min.y, -center.z);
                const size = new THREE.Vector3();
                geom.boundingBox.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
                const scale = 0.44 / maxDim;
                geom.scale(scale, scale, scale);
                tokenGeometryCache[tokenType] = geom;
                callback(geom);
            })
            .catch(() => {
                const fallback = new THREE.CylinderGeometry(0.16, 0.22, 0.45, 16);
                fallback.translate(0, 0.225, 0);
                tokenGeometryCache[tokenType] = fallback;
                callback(fallback);
            });
    }

    // Public 3D Engine API
    const Board3D = {
        init: function(wrapperId, onReady) {
            container = document.getElementById(wrapperId);
            if (!container) return;

            const width = container.clientWidth || window.innerWidth;
            const height = container.clientHeight || window.innerHeight;

            // Scene & Master World Group
            scene = new THREE.Scene();
            worldGroup = new THREE.Group();
            scene.add(worldGroup);

            // Subgroups for table cards, bills, and rim tabs
            tableCardsGroup = new THREE.Group();
            tableBillsGroup = new THREE.Group();
            boardTabsGroup = new THREE.Group();
            worldGroup.add(tableCardsGroup);
            worldGroup.add(tableBillsGroup);
            worldGroup.add(boardTabsGroup);

            // Camera
            camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);

            // Renderer
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
            renderer.setSize(width, height);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.05;
            renderer.outputColorSpace = THREE.SRGBColorSpace || THREE.sRGBEncoding;
            container.appendChild(renderer.domElement);

            // Orbit Controls
            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.08;
            controls.minDistance = 3.5;
            controls.maxDistance = 24.0;
            controls.target.set(0, 0, 0);

            // Initial camera preset
            const isMobile = window.innerWidth <= 850;
            const initialPreset = isMobile ? '2d' : '2.5d';
            this.setCameraPreset(initialPreset);

            // Lighting (Warm directional board illumination + soft ambient)
            const ambient = new THREE.AmbientLight(0xffffff, 0.65);
            scene.add(ambient);

            const sun = new THREE.DirectionalLight(0xfff7ec, 1.4);
            sun.position.set(7, 14, 8);
            sun.castShadow = true;
            sun.shadow.mapSize.width = 2048;
            sun.shadow.mapSize.height = 2048;
            sun.shadow.bias = -0.0005;
            const d = 9.0;
            sun.shadow.camera.left = -d;
            sun.shadow.camera.right = d;
            sun.shadow.camera.top = d;
            sun.shadow.camera.bottom = -d;
            scene.add(sun);

            const blueFill = new THREE.DirectionalLight(0xd4e6ff, 0.4);
            blueFill.position.set(-8, 6, -8);
            scene.add(blueFill);

            // Build Dice
            buildDice();

            // Load board texture & construct slab
            loadBoardTexture((boardTex) => {
                boardMesh = buildBoardObject(boardTex);
                worldGroup.add(boardMesh);
                isInitialized = true;
                if (onReady) onReady();
            });

            // Wire camera controls directly so 2D, 2.5D, 3D and Rotate ALWAYS work instantly
            const b2d = document.getElementById('btn-cam-2d');
            const b25 = document.getElementById('btn-cam-25d');
            const b3d = document.getElementById('btn-cam-3d');
            const rotL = document.getElementById('btn-rot-left');
            const rotR = document.getElementById('btn-rot-right');

            const setCamActive = (btn) => {
                [b2d, b25, b3d].forEach(b => { if (b) b.classList.remove('active'); });
                if (btn) btn.classList.add('active');
            };

            if (b2d) b2d.onclick = () => { this.setCameraPreset('2d'); setCamActive(b2d); };
            if (b25) b25.onclick = () => { this.setCameraPreset('2.5d'); setCamActive(b25); };
            if (b3d) b3d.onclick = () => { this.setCameraPreset('3d'); setCamActive(b3d); };
            if (rotL) rotL.onclick = () => { this.rotateBoardBy(-90); };
            if (rotR) rotR.onclick = () => { this.rotateBoardBy(90); };

            // Pointer interaction for physical cards on the table & board squares
            let pointerDownPos = null;
            let hoveredCard = null;

            renderer.domElement.addEventListener('pointerdown', (e) => {
                pointerDownPos = { x: e.clientX, y: e.clientY, time: performance.now() };
            });

            renderer.domElement.addEventListener('pointermove', (e) => {
                if (isTransitioningCamera) return;
                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);

                // Raycast on physical table cards & board card decks
                let foundCard = null;
                if (tableCardsGroup && tableCardsGroup.children.length > 0) {
                    const hits = raycaster.intersectObjects(tableCardsGroup.children, true);
                    for (const hit of hits) {
                        let cur = hit.object;
                        while (cur && (!cur.userData || !cur.userData.type) && cur.parent) {
                            cur = cur.parent;
                        }
                        if (cur && cur.userData && (cur.userData.type === 'table_card' || cur.userData.type === 'table_jail_card' || cur.userData.type === 'table_bills')) {
                            foundCard = cur;
                            break;
                        }
                    }
                }
                if (!foundCard && boardDecksGroup && boardDecksGroup.children.length > 0) {
                    const deckHits = raycaster.intersectObjects(boardDecksGroup.children, true);
                    for (const hit of deckHits) {
                        let cur = hit.object;
                        while (cur && (!cur.userData || !cur.userData.type) && cur.parent) {
                            cur = cur.parent;
                        }
                        if (cur && cur.userData && (cur.userData.type === 'board_deck' || cur.userData.type === 'drawn_card')) {
                            foundCard = cur;
                            break;
                        }
                    }
                }

                if (foundCard !== hoveredCard) {
                    if (hoveredCard) {
                        hoveredCard.position.y = (hoveredCard.userData.baseY !== undefined) ? hoveredCard.userData.baseY : 0.005;
                        hoveredCard.scale.set(1.0, 1.0, 1.0);
                    }
                    hoveredCard = foundCard;
                    if (hoveredCard) {
                        const elev = (hoveredCard.userData.type === 'board_deck') ? 0.04 : 0.10;
                        hoveredCard.position.y = ((hoveredCard.userData.baseY !== undefined) ? hoveredCard.userData.baseY : 0.005) + elev;
                        hoveredCard.scale.set(1.06, 1.06, 1.06);
                        renderer.domElement.style.cursor = 'pointer';
                    } else {
                        renderer.domElement.style.cursor = 'default';
                    }
                }
            });

            renderer.domElement.addEventListener('pointerup', (e) => {
                if (!pointerDownPos) return;
                const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
                const dt = performance.now() - pointerDownPos.time;
                pointerDownPos = null;

                // Treat as click only if movement is small (< 8px) and quick (< 500ms)
                if (dist > 8 || dt > 500) return;

                const rect = renderer.domElement.getBoundingClientRect();
                mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);

                // 1. Click on table card, jail card, or bills
                if (tableCardsGroup && tableCardsGroup.children.length > 0) {
                    const cardHits = raycaster.intersectObjects(tableCardsGroup.children, true);
                    for (const hit of cardHits) {
                        let cur = hit.object;
                        while (cur && (!cur.userData || !cur.userData.type) && cur.parent) {
                            cur = cur.parent;
                        }
                        if (cur && cur.userData && cur.userData.type === 'table_card') {
                            const seatIdx = cur.userData.seatIdx;
                            if (currentFocusedSeat !== seatIdx) {
                                // Zoom into this player seat's Nahansicht (Bild 3)!
                                this.focusSeatCards(seatIdx);
                                if (window.MonopolySound) window.MonopolySound.playClick();
                                return;
                            } else {
                                // Already in Nahansicht -> open deed detail modal
                                if (onSquareClickCallback) {
                                    onSquareClickCallback(cur.userData.sqIdx);
                                }
                                if (window.MonopolySound) window.MonopolySound.playCard();
                                return;
                            }
                        } else if (cur && cur.userData && cur.userData.type === 'table_jail_card') {
                            const seatIdx = cur.userData.seatIdx;
                            if (currentFocusedSeat !== seatIdx) {
                                this.focusSeatCards(seatIdx);
                                if (window.MonopolySound) window.MonopolySound.playClick();
                                return;
                            } else {
                                if (window.MonopolyGame && window.MonopolyGame.showOwnedJailCardModal) {
                                    window.MonopolyGame.showOwnedJailCardModal(cur.userData.ownerId, cur.userData.jailIdx || 0);
                                }
                                if (window.MonopolySound) window.MonopolySound.playCard();
                                return;
                            }
                        } else if (cur && cur.userData && cur.userData.type === 'table_bills') {
                            if (window.MonopolyGame && window.MonopolyGame.showPlayerPortfolio) {
                                window.MonopolyGame.showPlayerPortfolio(cur.userData.ownerId);
                            }
                            if (window.MonopolySound) window.MonopolySound.playClick();
                            return;
                        }
                    }
                }

                // 2. Click on board card deck or drawn card
                if (boardDecksGroup && boardDecksGroup.children.length > 0) {
                    const deckHits = raycaster.intersectObjects(boardDecksGroup.children, true);
                    for (const hit of deckHits) {
                        let cur = hit.object;
                        while (cur && (!cur.userData || !cur.userData.type) && cur.parent) {
                            cur = cur.parent;
                        }
                        if (cur && cur.userData && (cur.userData.type === 'board_deck' || cur.userData.type === 'drawn_card')) {
                            const dDeck = cur.userData.deck;
                            const cardEntry = lastDrawnCards[dDeck];
                            const dText = (typeof cardEntry === 'object' && cardEntry) ? cardEntry.text : (cur.userData.text || cardEntry);
                            const dImg = (typeof cardEntry === 'object' && cardEntry) ? cardEntry.image : (cur.userData.cardImage || '');
                            if (window.MonopolyGame && window.MonopolyGame.showCardModal) {
                                window.MonopolyGame.showCardModal(
                                    dDeck,
                                    dText || (dDeck === 'Gemeinschaft' ? 'Gemeinschaftskarten: Ziehe eine Karte bei Betreten des Feldes!' : 'Ereigniskarten: Ziehe eine Karte bei Betreten des Feldes!'),
                                    dImg,
                                    false
                                );
                            }
                            return;
                        }
                    }
                }

                // 2. Click on board square
                if (boardMesh && onSquareClickCallback) {
                    const intersects = raycaster.intersectObjects(boardMesh.children, true);
                    if (intersects.length > 0) {
                        const localPt = worldGroup.worldToLocal(intersects[0].point.clone());
                        let bestIdx = 0;
                        let bestDist = 999;
                        for (let i = 0; i < 40; i++) {
                            const sc = getSquareCenter(i);
                            const d = Math.hypot(localPt.x - sc.x, localPt.z - sc.z);
                            if (d < bestDist) {
                                bestDist = d;
                                bestIdx = i;
                            }
                        }
                        if (bestDist < 0.95) {
                            onSquareClickCallback(bestIdx);
                            if (window.MonopolySound) window.MonopolySound.playClick();
                            return;
                        }
                    }
                }

                // If in seat Nahansicht and clicked outside any interactive element, exit Nahansicht smoothly
                if (currentFocusedSeat !== null) {
                    this.exitSeatFocus();
                }
            });

            // Escape key exits seat Nahansicht
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && currentFocusedSeat !== null) {
                    this.exitSeatFocus();
                }
            });

            // Animation Loop
            this.animate();
        },

        onResize: function() {
            if (!container || !renderer || !camera) return;
            const width = container.clientWidth || window.innerWidth;
            const height = container.clientHeight || window.innerHeight;
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        },

        getCameraMode: function() {
            return cameraMode;
        },

        setCameraPreset: function(preset) {
            cameraMode = preset;
            currentFocusedSeat = null;
            const bar = document.getElementById('seat-focus-bar');
            if (bar) bar.style.display = 'none';
            if (!camera || !controls) return;

            const isMobile = window.innerWidth <= 850;
            const distMult = isMobile ? 1.35 : 1.0;

            let targetPos, minPolar, maxPolar;

            if (preset === '2d' || preset === 'topdown') {
                targetPos = new THREE.Vector3(0, 15.0 * distMult, 0.001);
                minPolar = 0.0;
                maxPolar = 0.06;
            } else if (preset === '2.5d' || preset === 'table') {
                targetPos = new THREE.Vector3(0, 8.5 * distMult, 8.8 * distMult);
                // Fixed beautiful elevation angle: exactly atan2(8.8, 8.5) (~46° from vertical)
                // Pitch tilting is strictly locked, horizontal turntable orbiting is 360° free!
                const fixedPolar = Math.atan2(8.8, 8.5);
                minPolar = fixedPolar;
                maxPolar = fixedPolar;
            } else { // '3d'
                targetPos = new THREE.Vector3(0, 7.5 * distMult, 9.2 * distMult);
                minPolar = 0.02;
                maxPolar = Math.PI / 2 - 0.02;
            }

            this.smoothCameraTransition(targetPos, new THREE.Vector3(0, 0, 0), minPolar, maxPolar);
        },

        smoothCameraTransition: function(toPos, toTarget, minPolar, maxPolar, duration = 380, onDone = null) {
            if (!camera || !controls) return;
            const transId = ++currentTransitionId;
            isTransitioningCamera = true;

            // Free limits during glide
            controls.minPolarAngle = 0;
            controls.maxPolarAngle = Math.PI;
            controls.minDistance = 1.0;
            controls.maxDistance = 40.0;

            const startPos = camera.position.clone();
            const startTarget = controls.target.clone();
            const startTime = performance.now();

            function step(now) {
                if (transId !== currentTransitionId) return;
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1.0);
                const ease = progress < 0.5
                    ? 4 * progress * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 3) / 2;

                camera.position.lerpVectors(startPos, toPos, ease);
                controls.target.lerpVectors(startTarget, toTarget, ease);
                controls.update();

                if (progress < 1.0) {
                    requestAnimationFrame(step);
                } else {
                    camera.position.copy(toPos);
                    controls.target.copy(toTarget);
                    controls.minPolarAngle = minPolar !== undefined ? minPolar : 0;
                    controls.maxPolarAngle = maxPolar !== undefined ? maxPolar : Math.PI / 2;
                    controls.minDistance = 3.5;
                    controls.maxDistance = 26.0;
                    controls.update();
                    isTransitioningCamera = false;
                    if (onDone) onDone();
                }
            }
            requestAnimationFrame(step);
        },

        // Smooth 90° Turntable Rotation of the physical board world
        rotateBoardBy: function(degrees) {
            if (!worldGroup) return;
            const targetRotation = worldGroup.rotation.y + (degrees * Math.PI) / 180;
            const startRot = worldGroup.rotation.y;
            const startTime = performance.now();
            const duration = 320; // ms

            function step(now) {
                const progress = Math.min((now - startTime) / duration, 1.0);
                const ease = progress < 0.5
                    ? 4 * progress * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
                worldGroup.rotation.y = startRot + (targetRotation - startRot) * ease;
                if (progress < 1.0) {
                    requestAnimationFrame(step);
                } else {
                    worldGroup.rotation.y = targetRotation;
                }
            }
            requestAnimationFrame(step);
        },

        setSquareClickCallback: function(callback) {
            onSquareClickCallback = callback;
        },

        // Close-up view of physical cards & banknotes on the table for a specific player seat
        focusSeatCards: function(seatIdx) {
            if (!camera || !controls) return;
            currentFocusedSeat = (seatIdx !== undefined) ? (seatIdx % 4) : 0;
            const bar = document.getElementById('seat-focus-bar');
            if (bar) bar.style.display = 'block';
            const cardBtnLabel = document.getElementById('btn-card-view-label');
            if (cardBtnLabel) cardBtnLabel.textContent = 'Aufs Spielbrett';
            const camCardsBtn = document.getElementById('btn-cam-cards');
            if (camCardsBtn) camCardsBtn.classList.add('active');

            const isMobile = window.innerWidth <= 850;
            const distMult = isMobile ? 1.25 : 1.0;

            const SEAT_CAMERAS = [
                { pos: new THREE.Vector3(0, 3.8 * distMult, 7.8 * distMult), target: new THREE.Vector3(0, 0, 5.8) },     // Seat 0 (Bottom / Player)
                { pos: new THREE.Vector3(-7.8 * distMult, 3.8 * distMult, 0), target: new THREE.Vector3(-5.8, 0, 0) },    // Seat 1 (Left)
                { pos: new THREE.Vector3(0, 3.8 * distMult, -7.8 * distMult), target: new THREE.Vector3(0, 0, -5.8) },   // Seat 2 (Top)
                { pos: new THREE.Vector3(7.8 * distMult, 3.8 * distMult, 0), target: new THREE.Vector3(5.8, 0, 0) }      // Seat 3 (Right)
            ];

            const cfg = SEAT_CAMERAS[(seatIdx || 0) % 4];
            this.smoothCameraTransition(cfg.pos, cfg.target, 0.1, Math.PI / 2.2, 520);
        },

        // Smoothly return to the main board view from player seat Nahansicht
        exitSeatFocus: function() {
            currentFocusedSeat = null;
            const bar = document.getElementById('seat-focus-bar');
            if (bar) bar.style.display = 'none';
            const cardBtnLabel = document.getElementById('btn-card-view-label');
            if (cardBtnLabel) cardBtnLabel.textContent = 'Zur Kartenansicht';
            const camCardsBtn = document.getElementById('btn-cam-cards');
            if (camCardsBtn) camCardsBtn.classList.remove('active');
            this.setCameraPreset(cameraMode || '2.5d');
            if (window.MonopolySound) window.MonopolySound.playClick();
        },

        toggleSeatFocus: function(seatIdx) {
            if (currentFocusedSeat !== null) {
                this.exitSeatFocus();
            } else {
                this.focusSeatCards(seatIdx !== undefined ? seatIdx : 0);
                if (window.MonopolySound) window.MonopolySound.playClick();
            }
        },

        // Update Tokens on Board
        syncPlayers: function(players) {
            if (!worldGroup) return;

            const activeIds = new Set(players.filter(p => !p.is_bankrupt).map(p => p.id));
            Object.keys(tokenMeshes).forEach(pid => {
                if (!activeIds.has(pid)) {
                    worldGroup.remove(tokenMeshes[pid]);
                    delete tokenMeshes[pid];
                }
            });
            Object.keys(tokenLoadRequests).forEach(pid => {
                if (!activeIds.has(pid)) {
                    delete tokenLoadRequests[pid];
                }
            });

            const getPosKey = (p) => (p.position === 10) ? (p.in_jail ? '10_jail' : '10_visit') : String(p.position);

            const byPos = {};
            players.forEach(p => {
                if (!p.is_bankrupt) {
                    const key = getPosKey(p);
                    if (!byPos[key]) byPos[key] = [];
                    byPos[key].push(p);
                }
            });

            const computeTokenPosition = (p) => {
                const key = getPosKey(p);
                const siblings = byPos[key] || [p];
                const sIdx = Math.max(0, siblings.findIndex(s => s.id === p.id));
                const count = siblings.length;
                return computeSquareSlotTransform(p.position, !!p.in_jail, sIdx, count);
            };

            players.forEach(p => {
                if (p.is_bankrupt) return;

                const targetToken = p.token || 'dog';
                const targetColor = p.color || '#e74c3c';
                const existing = tokenMeshes[p.id];

                if (existing && (existing.userData.token !== targetToken || existing.userData.color !== targetColor)) {
                    worldGroup.remove(existing);
                    delete tokenMeshes[p.id];
                }

                if (!tokenMeshes[p.id]) {
                    const reqKey = `${targetToken}|${targetColor}`;
                    const pending = tokenLoadRequests[p.id];
                    if (pending && pending.key === reqKey) {
                        pending.player = p;
                        return;
                    }
                    tokenLoadRequests[p.id] = { key: reqKey, player: p };
                    loadTokenGeometry(targetToken, (geom) => {
                        const latestReq = tokenLoadRequests[p.id];
                        if (!latestReq || latestReq.key !== reqKey) return;
                        delete tokenLoadRequests[p.id];

                        if (tokenMeshes[p.id]) {
                            worldGroup.remove(tokenMeshes[p.id]);
                            delete tokenMeshes[p.id];
                        }

                        const mat = new THREE.MeshStandardMaterial({
                            color: new THREE.Color(targetColor),
                            metalness: 0.88,
                            roughness: 0.18
                        });
                        const mesh = new THREE.Mesh(geom, mat);
                        mesh.castShadow = true;
                        mesh.receiveShadow = true;

                        const group = new THREE.Group();
                        group.add(mesh);

                        // Pedestal
                        const baseGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.05, 24);
                        const baseMat = new THREE.MeshStandardMaterial({
                            color: new THREE.Color(targetColor),
                            roughness: 0.3,
                            metalness: 0.5
                        });
                        const base = new THREE.Mesh(baseGeo, baseMat);
                        base.position.y = 0.025;
                        base.castShadow = true;
                        group.add(base);

                        const activeP = latestReq.player;
                        group.userData = {
                            token: targetToken,
                            color: targetColor,
                            playerId: p.id,
                            position: activeP.position,
                            in_jail: !!activeP.in_jail
                        };
                        tokenMeshes[p.id] = group;
                        worldGroup.add(group);

                        const pos = computeTokenPosition(activeP);
                        group.position.set(pos.x, pos.y, pos.z);
                        group.scale.setScalar(pos.scale || 1.0);
                    });
                } else {
                    const group = tokenMeshes[p.id];
                    group.userData.position = p.position;
                    group.userData.in_jail = !!p.in_jail;
                    const pos = computeTokenPosition(p);
                    group.position.set(pos.x, pos.y, pos.z);
                    group.scale.setScalar(pos.scale || 1.0);
                }
            });
        },

        getAnimConfig: function() {
            return Object.assign({}, animConfig);
        },

        getDefaultAnimConfig: function() {
            return Object.assign({}, DEFAULT_ANIM_CONFIG);
        },

        setAnimConfig: function(cfg, saveLocal = true) {
            if (!cfg || typeof cfg !== 'object') return;
            if (cfg.stepDuration !== undefined) animConfig.stepDuration = Math.max(40, Math.min(1200, parseInt(cfg.stepDuration, 10) || 280));
            if (cfg.stepPause !== undefined) animConfig.stepPause = Math.max(0, Math.min(800, parseInt(cfg.stepPause, 10) || 0));
            if (cfg.hopHeight !== undefined) animConfig.hopHeight = Math.max(0.05, Math.min(1.5, parseFloat(cfg.hopHeight) || 0.38));
            if (cfg.landingHold !== undefined) animConfig.landingHold = Math.max(0, Math.min(3500, parseInt(cfg.landingHold, 10) || 0));
            if (cfg.diceDuration !== undefined) animConfig.diceDuration = Math.max(200, Math.min(4000, parseInt(cfg.diceDuration, 10) || 1350));
            if (cfg.dicePostPause !== undefined) animConfig.dicePostPause = Math.max(0, Math.min(3000, parseInt(cfg.dicePostPause, 10) || 0));
            if (cfg.camFollowLerp !== undefined) animConfig.camFollowLerp = Math.max(0.02, Math.min(0.60, parseFloat(cfg.camFollowLerp) || 0.10));
            if (cfg.camTransitionMs !== undefined) animConfig.camTransitionMs = Math.max(100, Math.min(2500, parseInt(cfg.camTransitionMs, 10) || 650));
            if (cfg.cinematicFollow !== undefined) animConfig.cinematicFollow = !!cfg.cinematicFollow;

            if (saveLocal) {
                try {
                    localStorage.setItem('monopoly_anim_config_v1', JSON.stringify(animConfig));
                } catch (e) {}
            }
        },

        resetAnimConfig: function() {
            animConfig = Object.assign({}, DEFAULT_ANIM_CONFIG);
            try {
                localStorage.setItem('monopoly_anim_config_v1', JSON.stringify(animConfig));
            } catch (e) {}
            return Object.assign({}, animConfig);
        },

        // Token Movement Hop Animation with Dynamic Tracking Camera
        animateMoveToken: function(playerId, fromIdx, toIdx, onFinish, isCinematic = false) {
            const tokenGroup = tokenMeshes[playerId];
            if (!tokenGroup) {
                if (onFinish) onFinish();
                return;
            }

            let current = fromIdx;
            const forwardSteps = (toIdx - fromIdx + 40) % 40;
            const backwardSteps = (fromIdx - toIdx + 40) % 40;
            const isBackward = (backwardSteps > 0 && backwardSteps <= 3);
            const steps = isBackward ? backwardSteps : forwardSteps;
            const stepDir = isBackward ? -1 : 1;
            if (steps === 0) {
                if (onFinish) onFinish();
                return;
            }

            // Re-layout any remaining stationary tokens on the departure square
            const departureOthers = Object.keys(tokenMeshes)
                .filter(pid => pid !== String(playerId) && tokenMeshes[pid] && tokenMeshes[pid].userData.position === fromIdx && !tokenMeshes[pid].userData.in_jail)
                .map(pid => tokenMeshes[pid]);
            departureOthers.forEach((grp, idx) => {
                const slot = computeSquareSlotTransform(fromIdx, false, idx, departureOthers.length);
                grp.position.set(slot.x, slot.y, slot.z);
                grp.scale.setScalar(slot.scale || 1.0);
            });

            let stepCount = 0;
            let fromPos = tokenGroup.position.clone();
            const useCinematic = isCinematic && (animConfig.cinematicFollow !== false);

            const hopNext = () => {
                if (stepCount >= steps) {
                    // Reached destination!
                    if (useCinematic) {
                        const holdMs = (animConfig.landingHold !== undefined) ? animConfig.landingHold : 900;
                        setTimeout(() => {
                            this.setCameraPreset(cameraMode || '2.5d');
                            if (onFinish) onFinish();
                        }, holdMs);
                    } else {
                        if (onFinish) onFinish();
                    }
                    return;
                }

                stepCount++;
                current = (current + stepDir + 40) % 40;
                const isFinalStep = (stepCount === steps);

                // Find other stationary tokens on `current` (non-jail) so we never clip into them
                const othersOnSquare = Object.keys(tokenMeshes)
                    .filter(pid => pid !== String(playerId) && tokenMeshes[pid] && tokenMeshes[pid].userData.position === current && !tokenMeshes[pid].userData.in_jail)
                    .map(pid => tokenMeshes[pid]);

                let targetSlot;
                if (isFinalStep) {
                    const totalOnTarget = othersOnSquare.length + 1;
                    othersOnSquare.forEach((grp, idx) => {
                        const s = computeSquareSlotTransform(current, false, idx, totalOnTarget);
                        grp.position.set(s.x, s.y, s.z);
                        grp.scale.setScalar(s.scale || 1.0);
                    });
                    targetSlot = computeSquareSlotTransform(current, false, othersOnSquare.length, totalOnTarget);
                    tokenGroup.userData.position = current;
                    tokenGroup.userData.in_jail = false;
                } else if (othersOnSquare.length > 0) {
                    // Step onto an unoccupied slot when hopping across an occupied tile
                    targetSlot = computeSquareSlotTransform(current, false, othersOnSquare.length, othersOnSquare.length + 1);
                } else {
                    targetSlot = computeSquareSlotTransform(current, false, 0, 1);
                }

                const toPos = new THREE.Vector3(targetSlot.x, 0.09, targetSlot.z);
                const startScale = tokenGroup.scale.x || 1.0;
                const endScale = isFinalStep ? (targetSlot.scale || 1.0) : 1.0;

                if (window.MonopolySound && window.MonopolySound.playHop) {
                    window.MonopolySound.playHop();
                }

                const startTime = performance.now();
                const stepDuration = animConfig.stepDuration || 280; // ms
                const stepPause = (animConfig.stepPause !== undefined) ? animConfig.stepPause : 75; // ms
                const maxHopHeight = animConfig.hopHeight || 0.38;
                const camLerp = animConfig.camFollowLerp || 0.10;
                const targetLerp = Math.min(0.55, camLerp * 1.25);

                // Compute behind-the-token tracking camera offset for current board side
                const camOffset = new THREE.Vector3(0, 2.8, 3.4);
                if (current >= 0 && current < 10) {
                    camOffset.set(0, 2.8, 3.4);
                } else if (current >= 10 && current < 20) {
                    camOffset.set(-3.4, 2.8, 0);
                } else if (current >= 20 && current < 30) {
                    camOffset.set(0, 2.8, -3.4);
                } else {
                    camOffset.set(3.4, 2.8, 0);
                }

                const stepAnim = (now) => {
                    const elapsed = now - startTime;
                    const t = Math.min(1.0, elapsed / stepDuration);
                    const hopHeight = Math.sin(t * Math.PI) * maxHopHeight;

                    tokenGroup.position.lerpVectors(fromPos, toPos, t);
                    tokenGroup.position.y = 0.09 + hopHeight;
                    tokenGroup.scale.setScalar(startScale + (endScale - startScale) * t);

                    // Cinematic camera following behind the token!
                    if (useCinematic && camera && controls) {
                        const desiredTarget = tokenGroup.position.clone();
                        desiredTarget.y = 0.09;
                        const desiredCamPos = desiredTarget.clone().add(camOffset);

                        camera.position.lerp(desiredCamPos, camLerp);
                        controls.target.lerp(desiredTarget, targetLerp);
                        controls.update();
                    }

                    if (t < 1.0) {
                        requestAnimationFrame(stepAnim);
                    } else {
                        tokenGroup.position.y = 0.09;
                        tokenGroup.scale.setScalar(endScale);
                        fromPos = toPos;
                        setTimeout(hopNext, stepPause);
                    }
                };

                requestAnimationFrame(stepAnim);
            };

            hopNext();
        },

        moveTokenHop: function(playerId, fromIdx, toIdx, onFinish, isCinematic = false) {
            return this.animateMoveToken(playerId, fromIdx, toIdx, onFinish, isCinematic);
        },

        // Trigger 3D Dice Roll Animation with Authentic Flat Landing & Exact Face Alignment
        rollDice: function(d1, d2, onComplete, isCinematic = false) {
            if (!dice1 || !dice2 || isDiceRolling) return;
            isDiceRolling = true;

            if (window.MonopolySound) {
                window.MonopolySound.playDiceRoll();
            }

            const useCinematic = isCinematic && (animConfig.cinematicFollow !== false);

            // Cinematic Close-Up Camera on dice in board center when it is your turn!
            if (useCinematic) {
                const closeUpPos = new THREE.Vector3(0, 3.2, 3.6);
                const closeUpTarget = new THREE.Vector3(0, 0.28, 0);
                const camMs = animConfig.camTransitionMs || 650;
                this.smoothCameraTransition(closeUpPos, closeUpTarget, 0.2, Math.PI / 2.2, camMs);
            }

            const startTime = performance.now();
            const duration = animConfig.diceDuration || 1350; // ms
            const postPause = (animConfig.dicePostPause !== undefined) ? animConfig.dicePostPause : 550; // ms

            // Random slight yaw so dice look naturally tossed on table, but remain strictly 100% flat
            const yaw1 = (Math.random() - 0.5) * 0.4;
            const yaw2 = (Math.random() - 0.5) * 0.4;
            const finalQuat1 = getDieQuaternion(d1, yaw1);
            const finalQuat2 = getDieQuaternion(d2, yaw2);

            const rollAnim = (now) => {
                const elapsed = now - startTime;
                const t = Math.min(1.0, elapsed / duration);

                // Multi-bounce physical decay (3 bounces)
                let bounce = 0;
                if (t < 0.4) {
                    bounce = Math.sin((t / 0.4) * Math.PI) * 1.1;
                } else if (t < 0.75) {
                    bounce = Math.sin(((t - 0.4) / 0.35) * Math.PI) * 0.45;
                } else {
                    bounce = Math.sin(((t - 0.75) / 0.25) * Math.PI) * 0.12;
                }

                dice1.position.y = 0.28 + bounce;
                dice2.position.y = 0.28 + bounce * 0.9;

                // Subtle lateral jitter while bouncing
                if (t < 0.8) {
                    const jit = (1.0 - t) * 0.04;
                    dice1.position.x = -0.38 + Math.sin(t * 20) * jit;
                    dice2.position.x = 0.38 + Math.cos(t * 18) * jit;
                } else {
                    dice1.position.x = -0.38;
                    dice2.position.x = 0.38;
                }

                // Tumble and settle orientation
                if (t < 0.6) {
                    dice1.rotation.x += 0.42 * (1.0 - t);
                    dice1.rotation.z += 0.38 * (1.0 - t);
                    dice2.rotation.x += 0.35 * (1.0 - t);
                    dice2.rotation.y += 0.44 * (1.0 - t);
                } else {
                    // Smoothly slerp to exact final orientation
                    const slerpProgress = (t - 0.6) / 0.4;
                    const ease = slerpProgress * slerpProgress * (3 - 2 * slerpProgress); // Smoothstep
                    dice1.quaternion.slerp(finalQuat1, ease * 0.4);
                    dice2.quaternion.slerp(finalQuat2, ease * 0.4);
                }

                if (t < 1.0) {
                    requestAnimationFrame(rollAnim);
                } else {
                    dice1.position.set(-0.38, 0.28, 0);
                    dice2.position.set(0.38, 0.28, 0);
                    dice1.quaternion.copy(finalQuat1);
                    dice2.quaternion.copy(finalQuat2);
                    isDiceRolling = false;

                    // Pause briefly so user can see and celebrate their roll result
                    setTimeout(() => {
                        if (onComplete) onComplete();
                    }, postPause);
                }
            };

            requestAnimationFrame(rollAnim);
        },

        // Update Houses and Hotels on Board (strictly inside the colored header strip of each street tile)
        syncBuildings: function(boardState) {
            if (!worldGroup) return;

            // Clear old buildings
            for (const [sqIdx, meshes] of Object.entries(houseMeshes)) {
                meshes.forEach(m => worldGroup.remove(m));
            }
            houseMeshes = {};
            if (!boardState) return;

            // Distance from board center (0,0) to the center of the inner colored header strip (~3.81)
            const headerStripDist = (HALF_BOARD - CORNER_SIZE) + 0.16;

            for (const [sqIdxStr, st] of Object.entries(boardState)) {
                const sqIdx = parseInt(sqIdxStr);
                const houses = st.houses;
                if (houses <= 0) continue;

                const sc = getSquareCenter(sqIdx);
                houseMeshes[sqIdx] = [];

                let stripX = sc.x;
                let stripZ = sc.z;
                let rotY = 0;
                let alongZ = false;

                if (sqIdx > 0 && sqIdx < 10) {
                    // Bottom row: colored band is at inner top edge of tile (+headerStripDist)
                    stripZ = headerStripDist;
                    rotY = 0;
                    alongZ = false;
                } else if (sqIdx > 10 && sqIdx < 20) {
                    // Left row: colored band is at inner right edge of tile (-headerStripDist)
                    stripX = -headerStripDist;
                    rotY = Math.PI / 2;
                    alongZ = true;
                } else if (sqIdx > 20 && sqIdx < 30) {
                    // Top row: colored band is at inner bottom edge of tile (-headerStripDist)
                    stripZ = -headerStripDist;
                    rotY = Math.PI;
                    alongZ = false;
                } else if (sqIdx > 30 && sqIdx < 40) {
                    // Right row: colored band is at inner left edge of tile (+headerStripDist)
                    stripX = headerStripDist;
                    rotY = -Math.PI / 2;
                    alongZ = true;
                }

                if (houses === 5) {
                    const hotel = createHotelMesh();
                    hotel.rotation.y = rotY;
                    hotel.position.set(stripX, 0.09, stripZ);
                    worldGroup.add(hotel);
                    houseMeshes[sqIdx].push(hotel);
                } else {
                    for (let h = 0; h < houses; h++) {
                        const house = createHouseMesh();
                        house.rotation.y = rotY;
                        const off = (h - (houses - 1) / 2) * 0.175;
                        if (alongZ) {
                            house.position.set(stripX, 0.09, stripZ + off);
                        } else {
                            house.position.set(stripX + off, 0.09, stripZ);
                        }
                        worldGroup.add(house);
                        houseMeshes[sqIdx].push(house);
                    }
                }
            }
        },

        /**
         * Physical 3D Deed Cards & Banknotes on the Wooden Table + Board Rim Ownership Tabs
         * Faithfully renders cards flat around the 4 sides of the board just like the 2012 Monopoly game!
         */
        syncTableDeeds: function(boardState, players, localPlayerId) {
            if (!worldGroup || !tableCardsGroup || !tableBillsGroup || !boardTabsGroup) return;

            // Clear old table meshes
            while (tableCardsGroup.children.length > 0) {
                tableCardsGroup.remove(tableCardsGroup.children[0]);
            }
            while (tableBillsGroup.children.length > 0) {
                tableBillsGroup.remove(tableBillsGroup.children[0]);
            }
            while (boardTabsGroup.children.length > 0) {
                boardTabsGroup.remove(boardTabsGroup.children[0]);
            }

            if (!players || players.length === 0 || !boardState) return;

            // 1. Render Colored Ownership Tabs on the Board Rim
            for (const [sqIdxStr, st] of Object.entries(boardState)) {
                const sqIdx = parseInt(sqIdxStr);
                if (!st.owner) continue;

                const ownerPlayer = players.find(p => p.id === st.owner);
                if (!ownerPlayer) continue;

                const sc = getSquareCenter(sqIdx);
                const tabColor = new THREE.Color(ownerPlayer.color || '#f1c40f');
                const tabMat = new THREE.MeshStandardMaterial({
                    color: tabColor,
                    roughness: 0.25,
                    metalness: 0.15
                });

                let tabMesh = null;
                const tabH = 0.04;

                if (sqIdx > 0 && sqIdx < 10) { // Bottom row rim
                    tabMesh = new THREE.Mesh(new THREE.BoxGeometry(INNER_STEP * 0.85, tabH, 0.14), tabMat);
                    tabMesh.position.set(sc.x, 0.09, HALF_BOARD + 0.06);
                } else if (sqIdx > 10 && sqIdx < 20) { // Left row rim
                    tabMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, tabH, INNER_STEP * 0.85), tabMat);
                    tabMesh.position.set(-HALF_BOARD - 0.06, 0.09, sc.z);
                } else if (sqIdx > 20 && sqIdx < 30) { // Top row rim
                    tabMesh = new THREE.Mesh(new THREE.BoxGeometry(INNER_STEP * 0.85, tabH, 0.14), tabMat);
                    tabMesh.position.set(sc.x, 0.09, -HALF_BOARD - 0.06);
                } else if (sqIdx > 30 && sqIdx < 40) { // Right row rim
                    tabMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, tabH, INNER_STEP * 0.85), tabMat);
                    tabMesh.position.set(HALF_BOARD + 0.06, 0.09, sc.z);
                }

                if (tabMesh) {
                    tabMesh.castShadow = true;
                    boardTabsGroup.add(tabMesh);
                }
            }

            // 2. Assign players to table seats (Seat 0 = Bottom / Front, Seat 1 = Left, Seat 2 = Top, Seat 3 = Right)
            const myIdx = players.findIndex(p => p.id === localPlayerId);
            const baseOffset = (myIdx >= 0) ? myIdx : 0;

            const SEAT_CONFIG = [
                { pos: new THREE.Vector3(0, 0, 6.2), rotY: 0 },              // Bottom (Player 0)
                { pos: new THREE.Vector3(-6.2, 0, 0), rotY: -Math.PI / 2 },   // Left (Player 1)
                { pos: new THREE.Vector3(0, 0, -6.2), rotY: Math.PI },        // Top (Player 2)
                { pos: new THREE.Vector3(6.2, 0, 0), rotY: Math.PI / 2 }      // Right (Player 3)
            ];

            players.forEach((p, pIdx) => {
                if (p.is_bankrupt) return;

                // Relative seat index
                const seatIdx = (pIdx - baseOffset + 4) % 4;
                const seatCfg = SEAT_CONFIG[seatIdx];

                const seatGroup = new THREE.Group();
                seatGroup.position.copy(seatCfg.pos);
                seatGroup.rotation.y = seatCfg.rotY;

                // Find all properties owned by player
                const owned = [];
                for (const [sqIdxStr, st] of Object.entries(boardState)) {
                    if (st.owner === p.id) {
                        owned.push(parseInt(sqIdxStr));
                    }
                }
                owned.sort((a, b) => a - b);

                // A. 3D Banknote Stack
                const billTex = getBanknoteTexture();
                const paperEdgeMat = new THREE.MeshStandardMaterial({ color: 0xf4eedb, roughness: 0.8 });
                const billTopMat = new THREE.MeshStandardMaterial({ map: billTex, roughness: 0.45 });
                const stackThickness = Math.min(0.12, 0.03 + (p.money / 3000) * 0.06);

                const billMaterials = [
                    paperEdgeMat, paperEdgeMat,
                    billTopMat,
                    paperEdgeMat,
                    paperEdgeMat, paperEdgeMat
                ];
                const billStack = new THREE.Mesh(
                    new THREE.BoxGeometry(0.85, stackThickness, 0.44),
                    billMaterials
                );
                billStack.position.set(-2.5, stackThickness / 2, 0);
                billStack.castShadow = true;
                billStack.receiveShadow = true;
                billStack.userData = {
                    type: 'table_bills',
                    ownerId: p.id,
                    seatIdx: seatIdx
                };
                seatGroup.add(billStack);

                // B. Physical 3D Property Deed Cards + "Du kommst aus dem Gefängnis frei" Cards laid flat on the table
                const cardW = 0.68;
                const cardH = 1.05;
                const cardGeo = new THREE.PlaneGeometry(cardW, cardH);
                const jailCardGeo = new THREE.PlaneGeometry(0.96, 0.66);

                const tableItems = owned.map(sqIdx => ({ kind: 'deed', sqIdx }));
                const jailCardCount = p.jail_cards || 0;
                for (let j = 0; j < jailCardCount; j++) {
                    tableItems.push({ kind: 'jail', jailIdx: j });
                }

                const N = tableItems.length;
                if (N > 0) {
                    const maxSpan = 4.4;
                    const spacing = Math.min(0.58, maxSpan / Math.max(N, 1));
                    const startX = -((N - 1) * spacing) / 2 + 0.35;

                    tableItems.forEach((item, k) => {
                        const tex = (item.kind === 'jail')
                            ? getJailFreeTexture(item.jailIdx)
                            : getDeedTexture(item.sqIdx);
                        if (!tex) return;

                        const cardFrontMat = new THREE.MeshStandardMaterial({
                            map: tex,
                            roughness: 0.32,
                            metalness: 0.04,
                            side: THREE.DoubleSide
                        });

                        const geomToUse = (item.kind === 'jail') ? jailCardGeo : cardGeo;
                        const cardMesh = new THREE.Mesh(geomToUse, cardFrontMat);
                        cardMesh.rotation.x = -Math.PI / 2;
                        cardMesh.rotation.z = (k % 3 - 1) * 0.035; // Authentic slight hand tilt

                        const cardX = startX + k * spacing + (item.kind === 'jail' ? 0.14 : 0);
                        const cardZ = (k % 2 === 0) ? -0.04 : 0.04; // Subtle alternating stagger
                        const cardY = 0.005 + k * 0.001; // Avoid z-fighting

                        cardMesh.position.set(cardX, cardY, cardZ);
                        cardMesh.castShadow = true;
                        cardMesh.receiveShadow = true;

                        // Click target metadata & base elevation
                        if (item.kind === 'jail') {
                            cardMesh.userData = {
                                type: 'table_jail_card',
                                jailIdx: item.jailIdx,
                                ownerId: p.id,
                                seatIdx: seatIdx,
                                baseY: cardY
                            };
                        } else {
                            cardMesh.userData = {
                                type: 'table_card',
                                sqIdx: item.sqIdx,
                                ownerId: p.id,
                                seatIdx: seatIdx,
                                baseY: cardY
                            };
                        }

                        seatGroup.add(cardMesh);
                    });
                }

                tableCardsGroup.add(seatGroup);
            });
        },

        showDrawnCard: showDrawnCard,
        hideDrawnCards: hideDrawnCards,

        animate: function() {
            requestAnimationFrame(this.animate.bind(this));
            if (controls) controls.update();
            if (renderer && scene && camera) {
                renderer.render(scene, camera);
            }
        }
    };

    window.MonopolyBoard3D = Board3D;
})(window);
