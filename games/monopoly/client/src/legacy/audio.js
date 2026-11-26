/**
 * Monopoly Web Edition - Audio System (Authentic ROM Sounds & BGM Lounge Music)
 * Spielt die originalen Soundeffekte und BGM-Tracks aus der Monopoly ROM ab.
 */

(function(window) {
    'use strict';

    let isMuted = false;
    let isMusicEnabled = false;
    try {
        isMuted = localStorage.getItem('monopoly_muted') === 'true';
        isMusicEnabled = localStorage.getItem('monopoly_bgm_enabled') === 'true';
    } catch(e) {}

    const resolveUrl = function(path) {
        if (window.MonopolyAssets && window.MonopolyAssets.resolveUrl) {
            return window.MonopolyAssets.resolveUrl(path);
        }
        let p = window.location.pathname;
        if (!p.endsWith('/')) p = p.substring(0, p.lastIndexOf('/') + 1);
        return p + (path.startsWith('/') ? path.substring(1) : path);
    };

    // Preloaded HTML5 Audio objects for zero-latency playback
    const soundFiles = {
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
        card: 'static/assets/audio/wischen.wav',
        win: 'static/assets/audio/spiel_gewonnen.wav',
        lose: 'static/assets/audio/spiel_verloren.wav',
        confirm: 'static/assets/audio/klick_bestaetigen.wav',
        select: 'static/assets/audio/klick_auswaehlen.wav',
        chat: 'static/assets/audio/chat_nachricht.wav',
        swipe: 'static/assets/audio/wischen.wav'
    };

    const tokenSounds = {};

    const bgmTracks = [
        'static/assets/audio/music/monopoly_theme_lounge_m1.mp3',
        'static/assets/audio/music/monopoly_theme_smooth_m2.mp3',
        'static/assets/audio/music/monopoly_theme_swing_m3.mp3'
    ];

    let currentBgmAudio = null;
    let currentBgmIndex = 0;

    function playAudioFile(relPath, volume = 0.8) {
        if (isMuted) return;
        try {
            const audio = new Audio(resolveUrl(relPath));
            audio.volume = Math.max(0, Math.min(1, volume));
            const p = audio.play();
            if (p && p.catch) {
                p.catch(() => {});
            }
        } catch (e) {}
    }

    // Synthesizer Web Audio context for instant fallback / hop click
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) audioCtx = new AudioContext();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    }

    function initOrUpdateBgm() {
        if (!isMusicEnabled) {
            if (currentBgmAudio) {
                currentBgmAudio.pause();
                currentBgmAudio = null;
            }
            return;
        }

        if (currentBgmAudio) {
            if (currentBgmAudio.paused) {
                currentBgmAudio.play().catch(() => {});
            }
            return;
        }

        try {
            const trackPath = bgmTracks[currentBgmIndex % bgmTracks.length];
            currentBgmAudio = new Audio(resolveUrl(trackPath));
            currentBgmAudio.volume = 0.28;
            currentBgmAudio.loop = true;
            currentBgmAudio.play().catch(() => {
                // Browser user interaction required
            });
        } catch (e) {}
    }

    const Sound = {
        isMuted: function() {
            return isMuted;
        },

        toggleMute: function() {
            isMuted = !isMuted;
            try {
                localStorage.setItem('monopoly_muted', isMuted);
            } catch(e) {}
            return isMuted;
        },

        isMusicEnabled: function() {
            return isMusicEnabled;
        },

        toggleMusic: function() {
            isMusicEnabled = !isMusicEnabled;
            try {
                localStorage.setItem('monopoly_bgm_enabled', isMusicEnabled);
            } catch(e) {}
            initOrUpdateBgm();
            return isMusicEnabled;
        },

        nextMusicTrack: function() {
            if (currentBgmAudio) {
                currentBgmAudio.pause();
                currentBgmAudio = null;
            }
            currentBgmIndex = (currentBgmIndex + 1) % bgmTracks.length;
            if (isMusicEnabled) {
                initOrUpdateBgm();
            }
        },

        startMusicIfEnabled: function() {
            if (isMusicEnabled && (!currentBgmAudio || currentBgmAudio.paused)) {
                initOrUpdateBgm();
            }
        },

        // Authentic Dice Roll sound
        playDiceRoll: function() {
            if (isMuted) return;
            const r = Math.floor(Math.random() * 5) + 1;
            playAudioFile(`static/assets/audio/wuerfeln_${r}.wav`, 0.85);
            setTimeout(() => {
                const land = Math.random() > 0.5 ? 1 : 2;
                playAudioFile(`static/assets/audio/wuerfel_landen_${land}.wav`, 0.7);
            }, 600);
        },

        // Subtle rattle sound while shaking the manual dice cup
        playDiceRattle: function() {
            if (isMuted) return;
            const now = Date.now();
            if (this._lastRattleAt && (now - this._lastRattleAt) < 220) return;
            this._lastRattleAt = now;
            const r = Math.floor(Math.random() * 5) + 1;
            playAudioFile(`static/assets/audio/wuerfeln_${r}.wav`, 0.42);
        },

        // Token Movement SFX - Consistent clean hop sound for all pieces
        playTokenMove: function(tokenType) {
            if (isMuted) return;
            Sound.playHop();
        },

        // Figur setzt auf dem Brett auf: kurzes Holz-"Klack" (gefiltertes Rauschen) + dumpfer Körper.
        // Leichte Zufallsvariation, damit es nicht maschinell klingt; final = letztes Feld (kräftiger).
        playHop: function(final = false) {
            if (isMuted) return;
            const ctx = getAudioContext();
            if (ctx && ctx.state === 'running') {
                try {
                    const now = ctx.currentTime;
                    const vol = (final ? 0.42 : 0.30) * (0.9 + Math.random() * 0.2);
                    const pitch = 0.92 + Math.random() * 0.16;

                    // a) Klack: 25 ms Rauschen durch einen Bandpass
                    const len = Math.floor(ctx.sampleRate * 0.025);
                    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                    const data = buf.getChannelData(0);
                    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
                    const noise = ctx.createBufferSource();
                    noise.buffer = buf;
                    const bp = ctx.createBiquadFilter();
                    bp.type = 'bandpass';
                    bp.frequency.value = 2100 * pitch;
                    bp.Q.value = 1.4;
                    const nGain = ctx.createGain();
                    nGain.gain.value = vol;
                    noise.connect(bp); bp.connect(nGain); nGain.connect(ctx.destination);
                    noise.start(now);

                    // b) Körper: kurzer tiefer Ton (Holzbrett)
                    const osc = ctx.createOscillator();
                    const oGain = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(190 * pitch, now);
                    osc.frequency.exponentialRampToValueAtTime(90 * pitch, now + 0.07);
                    oGain.gain.setValueAtTime(vol * 0.55, now);
                    oGain.gain.exponentialRampToValueAtTime(0.001, now + (final ? 0.12 : 0.08));
                    osc.connect(oGain); oGain.connect(ctx.destination);
                    osc.start(now);
                    osc.stop(now + 0.14);
                    return;
                } catch(e) {}
            }
            playAudioFile(soundFiles.select, final ? 0.5 : 0.4);
        },

        // Money gain / Passed GO
        playMoney: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.moneyGain, 0.9);
        },

        playMoneyLose: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.moneyLose, 0.85);
        },

        playPassGo: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.passGo, 0.9);
        },

        playBuy: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.buyProp, 0.9);
        },

        playCard: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.card, 0.85);
        },

        playJail: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.jail, 0.9);
        },

        playJailLeave: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.jailLeave, 0.85);
        },

        playBuild: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.buildHouse, 0.9);
        },

        playWin: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.win, 1.0);
        },

        playLose: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.lose, 0.9);
        },

        playClick: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.select, 0.5);
        },

        playChat: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.chat, 0.6);
        },

        playSwipe: function() {
            if (isMuted) return;
            playAudioFile(soundFiles.swipe, 0.5);
        }
    };

    // Try starting music on first interaction if enabled
    function onFirstUserInteraction() {
        Sound.startMusicIfEnabled();
        window.removeEventListener('click', onFirstUserInteraction);
        window.removeEventListener('touchstart', onFirstUserInteraction);
    }
    window.addEventListener('click', onFirstUserInteraction);
    window.addEventListener('touchstart', onFirstUserInteraction);

    window.MonopolySound = Sound;
})(window);
