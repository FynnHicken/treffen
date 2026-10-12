const tracksDir = "/sound/tracks";
const effectsDir = "/sound/effects";

const effectFiles = {
  card_play: [
    `${effectsDir}/card_play.mp3`,
    `${effectsDir}/card_play_01.mp3`,
    `${effectsDir}/card_play_02.mp3`,
    `${effectsDir}/card_play_03.mp3`,
  ],
  card_deal: [`${effectsDir}/card_deal.mp3`],
  card_shuffle: [`${effectsDir}/card_shuffle.mp3`],
  card_select: [`${effectsDir}/card_select.mp3`],
  turn_alert: [`${effectsDir}/turn_alert.mp3`],
  uno_call: [`${effectsDir}/uno_call.mp3`],
  uno_call_opponent: [`${effectsDir}/uno_call_opponent.mp3`],
  card_draw2: [`${effectsDir}/card_draw2.mp3`],
  card_draw4: [`${effectsDir}/card_draw4.mp3`],
  card_reverse: [`${effectsDir}/card_reverse.mp3`, `${effectsDir}/reverse_bell.mp3`],
  card_skip: [`${effectsDir}/card_skip.mp3`],
  wild_splash: [`${effectsDir}/wild_splash.mp3`],
  match_win: [`${effectsDir}/match_win.mp3`],
};

const musicPlayer = new Audio();
musicPlayer.loop = true;

export default class SoundController {
  tracks = {
    mainTheme: `${tracksDir}/main-theme.mp3`,
  };

  musicVolume = 0.25;
  effectsVolume = 0.75;
  activePool = [];

  constructor() {
    try {
      const savedMVol = localStorage.getItem("uno_music_volume");
      if (savedMVol !== null) this.musicVolume = parseFloat(savedMVol);
      const savedEVol = localStorage.getItem("uno_effects_volume");
      if (savedEVol !== null) this.effectsVolume = parseFloat(savedEVol);
    } catch (e) {
      // ignore localStorage error
    }

    musicPlayer.volume = this.musicVolume;
    this.playTrack("mainTheme");
  }

  setMusicVolume(volume) {
    if (volume < 0 || volume > 1) return;
    this.musicVolume = volume;
    musicPlayer.volume = volume;
    try {
      localStorage.setItem("uno_music_volume", volume.toString());
    } catch (e) {}
  }

  setEffectsVolume(volume) {
    if (volume < 0 || volume > 1) return;
    this.effectsVolume = volume;
    try {
      localStorage.setItem("uno_effects_volume", volume.toString());
    } catch (e) {}
  }

  playTrack(name) {
    if (this.tracks[name]) {
      musicPlayer.src = this.tracks[name];
      musicPlayer.play().catch(() => {
        // Autoplay policy: will play on first user interaction
        const startAudio = () => {
          musicPlayer.play().catch(() => {});
          window.removeEventListener("click", startAudio);
          window.removeEventListener("keydown", startAudio);
          window.removeEventListener("touchstart", startAudio);
        };
        window.addEventListener("click", startAudio, { once: true });
        window.addEventListener("keydown", startAudio, { once: true });
        window.addEventListener("touchstart", startAudio, { once: true });
      });
    }
  }

  playEffect(name) {
    if (this.effectsVolume <= 0) return;

    const files = effectFiles[name];
    if (!files || files.length === 0) return;

    // Pick random file if multiple variants exist (e.g. card_play)
    const src = files[Math.floor(Math.random() * files.length)];

    try {
      const audio = new Audio(src);
      audio.volume = this.effectsVolume;
      audio.play().catch(() => {});

      // Pool cleanup
      this.activePool.push(audio);
      audio.onended = () => {
        const idx = this.activePool.indexOf(audio);
        if (idx !== -1) this.activePool.splice(idx, 1);
      };
      if (this.activePool.length > 20) {
        const oldest = this.activePool.shift();
        oldest.pause();
      }
    } catch (e) {
      console.warn("Error playing sound effect:", e);
    }
  }
}
