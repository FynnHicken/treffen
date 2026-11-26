/**
 * Monopoly 3D Web Edition - Centralized Asset Registry & Configuration
 * 
 * Allows easy modification, extension, and swapping of textures, models,
 * cards, sounds, background music, and UI graphics in one single place.
 */

(function(window) {
    'use strict';

    // Calculate dynamic base path to ensure reverse proxy / subpath compatibility
    const basePath = (function() {
        let p = window.location.pathname;
        if (!p.endsWith('/')) {
            p = p.substring(0, p.lastIndexOf('/') + 1);
        }
        return p;
    })();

    function resolveUrl(relativePath) {
        if (!relativePath) return '';
        if (relativePath.startsWith('http://') || relativePath.startsWith('https://') || relativePath.startsWith('data:')) {
            return relativePath;
        }
        const clean = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
        return basePath + clean;
    }

    const AssetConfig = {
        basePath: basePath,
        resolveUrl: resolveUrl,

        // 3D Board and Tabletop Textures
        textures: {
            board: 'static/assets/textures/board_de_2048.png',
            boardSmall: 'static/assets/01_Spielbrett/spielbrett_deutsch_422x422.png',
            banknote: 'static/assets/bills/geldschein_100.png',
            dice: 'static/assets/textures/dice_texture.png',
            deckEdge: 'static/assets/chance_chest/deck_stack_edge.png',
            deckGemeinschaftBack: 'static/assets/chance_chest/deck_gemeinschaft_back.png',
            deckEreignisBack: 'static/assets/chance_chest/deck_ereignis_back.png'
        },

        // 3D Wavefront OBJ Model Meshes
        models: {
            house: 'static/assets/models/house.obj',
            hotel: 'static/assets/models/hotel.obj',
            dice: 'static/assets/models/dice.obj',
            tokens: {
                dog: 'static/assets/models/token_dog.obj',
                hat: 'static/assets/models/token_hat.obj',
                car: 'static/assets/models/token_car.obj',
                ship: 'static/assets/models/token_ship.obj',
                boot: 'static/assets/models/token_boot.obj',
                iron: 'static/assets/models/token_iron.obj',
                thimble: 'static/assets/models/token_thimble.obj',
                wheelbarrow: 'static/assets/models/token_wheelbarrow.obj'
            }
        },

        // Playable Tokens Metadata & UI Graphics
        tokens: [
            { id: 'dog', name: 'Terrier (Hund)', icon: '🐕', iconImg: 'static/assets/tokens/hund_icon.png', largeImg: 'static/assets/tokens/hund_gross.png', moveSfx: 'figur_hund_laufen.wav' },
            { id: 'hat', name: 'Zylinder', icon: '🎩', iconImg: 'static/assets/tokens/zylinder_icon.png', largeImg: 'static/assets/tokens/zylinder_gross.png', moveSfx: 'figur_zylinder_ziehen.wav' },
            { id: 'car', name: 'Rennwagen', icon: '🏎️', iconImg: 'static/assets/tokens/rennwagen_icon.png', largeImg: 'static/assets/tokens/rennwagen_gross.png', moveSfx: 'figur_auto_fahren.wav' },
            { id: 'ship', name: 'Schlachtschiff', icon: '🚢', iconImg: 'static/assets/tokens/schlachtschiff_icon.png', largeImg: 'static/assets/tokens/schlachtschiff_gross.png', moveSfx: 'figur_schiff_fahren.wav' },
            { id: 'boot', name: 'Stiefel', icon: '👢', iconImg: 'static/assets/tokens/schuh_icon.png', largeImg: 'static/assets/tokens/schuh_gross.png', moveSfx: 'figur_schuh_ziehen.wav' },
            { id: 'iron', name: 'Bügeleisen', icon: '🪙', iconImg: 'static/assets/tokens/buegeleisen_icon.png', largeImg: 'static/assets/tokens/buegeleisen_gross.png', moveSfx: 'figur_buegeleisen_ziehen.wav' },
            { id: 'thimble', name: 'Fingerhut', icon: '🧵', iconImg: 'static/assets/tokens/fingerhut_icon.png', largeImg: 'static/assets/tokens/fingerhut_gross.png', moveSfx: 'figur_fingerhut_ziehen.wav' },
            { id: 'wheelbarrow', name: 'Schubkarre', icon: '🛒', iconImg: 'static/assets/tokens/schubkarre_icon.png', largeImg: 'static/assets/tokens/schubkarre_gross.png', moveSfx: 'figur_schubkarre_ziehen.wav' }
        ],

        // Official German Property Deed Cards (ROM Extracted)
        deedCards: {
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
        },

        // Authentic Chance & Community Chest Graphic Cards Folder
        cardsPath: 'static/assets/chance_chest/cards/',

        // Fallback Uncle Pennybags Illustrations
        illustrations: {
            jail: 'static/assets/chance_chest/illustration_gefaengnis.png',
            jailBreak: 'static/assets/chance_chest/illustration_gefaengnisausbruch.png',
            pay: 'static/assets/chance_chest/illustration_zahlen.png',
            gift: 'static/assets/chance_chest/illustration_geschenk.png',
            renovation: 'static/assets/chance_chest/illustration_renovierung_bau.png',
            run: 'static/assets/chance_chest/illustration_rennen.png',
            thumbsUp: 'static/assets/chance_chest/illustration_daumen_hoch.png',
            surprise: 'static/assets/chance_chest/illustration_ueberraschung.png',
            default: 'static/assets/chance_chest/illustration_monopoly_mann.png'
        },

        // Audio SFX Files
        sfx: {
            diceRoll1: 'static/assets/audio/wuerfeln_1.wav',
            diceRoll2: 'static/assets/audio/wuerfeln_2.wav',
            diceRoll3: 'static/assets/audio/wuerfeln_3.wav',
            diceRoll4: 'static/assets/audio/wuerfeln_4.wav',
            diceRoll5: 'static/assets/audio/wuerfeln_5.wav',
            diceLand1: 'static/assets/audio/wuerfel_landen_1.wav',
            diceLand2: 'static/assets/audio/wuerfel_landen_2.wav',
            moneyGain: 'static/assets/audio/geld_erhalten.wav',
            moneyLose: 'static/assets/audio/geld_verloren.wav',
            passGo: 'static/assets/audio/gehe_ueber_los.wav',
            buyProp: 'static/assets/audio/grundstueck_kaufen.wav',
            buildHouse: 'static/assets/audio/haus_bauen.wav',
            jail: 'static/assets/audio/ins_gefaengnis.wav',
            jailLeave: 'static/assets/audio/gefaengnis_verlassen.wav',
            card: 'static/assets/audio/karte_ziehen.wav',
            win: 'static/assets/audio/spiel_gewonnen.wav',
            lose: 'static/assets/audio/spiel_verloren.wav',
            confirm: 'static/assets/audio/klick_bestaetigen.wav',
            select: 'static/assets/audio/klick_auswaehlen.wav',
            chat: 'static/assets/audio/chat_nachricht.wav',
            swipe: 'static/assets/audio/wischen.wav'
        },

        // Background Music Lounge Tracks (2012 Wii Tabletop OST)
        bgm: [
            { id: 'lounge', name: 'Monopoly Lounge Theme', file: 'static/assets/audio/music/monopoly_theme_lounge_m1.mp3' },
            { id: 'smooth', name: 'Monopoly Smooth Theme', file: 'static/assets/audio/music/monopoly_theme_smooth_m2.mp3' },
            { id: 'swing',  name: 'Monopoly Swing Theme',  file: 'static/assets/audio/music/monopoly_theme_swing_m3.mp3' }
        ],

        // UI Graphic Elements
        ui: {
            mortgageIcon: 'static/assets/ui/icon_mortgage.png',
            payBailIcon: 'static/assets/ui/icon_paybail.png',
            autoSellIcon: 'static/assets/ui/icon_autosell.png',
            rollButton: 'static/assets/ui/roll.png',
            humanIcon: 'static/assets/ui/spieler_mensch.png',
            aiIcon: 'static/assets/ui/spieler_ki.png',
            mortgageStamp: 'static/assets/cards/hypothek_stempel.png'
        },

        // Helper: Get Card Graphic URL from filename or deck/id
        getCardImageUrl: function(card) {
            if (!card) return '';
            const imgName = card.image || card.card_image_filename;
            if (imgName) {
                return resolveUrl(AssetConfig.cardsPath + imgName);
            }
            return '';
        },

        // Helper: Get Token Metadata by ID
        getToken: function(id) {
            return AssetConfig.tokens.find(t => t.id === id) || AssetConfig.tokens[0];
        }
    };

    window.MonopolyAssets = AssetConfig;

})(window);
