// Audio Engine using Real Studio Audio Assets & Web Audio API
// High-fidelity, balanced sound design:
// - Seamless Orchestral Winter Background Music (Morning Frost) at comfortable, pleasant volume
// - Subtle aerodynamic mountain wind loop (only audibly rises on steep high-speed dives)
// - Gentle, rhythmic brass sleigh bells (controlled duration, strictly single-instance, no overlap pileup)
// - Crisp, focused gameplay SFX (instant 0.4s-0.8s punchy hits, no long ringing clutter)
// - Polyphony limiting & cooldown gates to prevent sound muddiness

class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('santa_audio_enabled') !== 'false';

    // Master bus & sub-busses
    this.masterGain = null;
    this.sfxGain = null;
    this.ambientGain = null;
    this.musicGain = null;

    // Carefully calibrated mixing gains:
    // Music is rich and pleasant, SFX are clear and distinct, Ambience is a soft background bed.
    this.masterVolume = 0.80;
    this.musicVolume = 0.28;   // Gentle, warm, non-fatiguing
    this.ambientVolume = 0.18; // Soft atmospheric bed
    this.sfxVolume = 0.65;     // Clean, crisp focal point

    // Audio Buffer Cache
    this.buffers = new Map();
    this.loading = false;
    this.loaded = false;

    // Continuous Sound Nodes
    this.windNode = null;
    this.windGainNode = null;
    this.windFilter = null;

    // BGM state
    this.bgmAudio = null;
    this.currentTrack = '/audio/bgm_morning_frost.mp3';

    // Bell rhythm state
    this._bellAccum = 0;
    this._bellStep = 0;
    this._activeBellSource = null;

    // Cooldown trackers to prevent spamming
    this._lastDropTime = 0;
    this._lastSuccessTime = 0;
    this._lastStarTime = 0;
    this._lastBeaconTime = 0;

    // Active one-shot voices (keyed by sound type) to avoid chaotic layering
    this.activeVoices = new Map();

    // Bind event listeners for unlocking Web Audio
    this._initOnInteraction = this._initOnInteraction.bind(this);
    window.addEventListener('keydown', this._initOnInteraction, { once: true });
    window.addEventListener('pointerdown', this._initOnInteraction, { once: true });
    window.addEventListener('touchstart', this._initOnInteraction, { once: true });

    this._preloadAudio();
  }

  _initOnInteraction() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this._setupBusses();
        this._startAmbientWind();
        if (this.enabled) {
          this.startBGM();
        }
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (this.bgmAudio && this.enabled && this.bgmAudio.paused) {
      this.bgmAudio.play().catch(() => {});
    }
  }

  _setupBusses() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Master Bus
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.enabled ? this.masterVolume : 0.0, now);
    this.masterGain.connect(this.ctx.destination);

    // SFX Bus
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.setValueAtTime(this.sfxVolume, now);
    this.sfxGain.connect(this.masterGain);

    // Ambient Bus
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.setValueAtTime(this.ambientVolume, now);
    this.ambientGain.connect(this.masterGain);

    // Music Bus
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.setValueAtTime(this.musicVolume, now);
    this.musicGain.connect(this.masterGain);
  }

  async _preloadAudio() {
    if (this.loading || this.loaded) return;
    this.loading = true;

    const sfxList = [
      { key: 'gift_drop', url: '/audio/gift_drop.mp3' },
      { key: 'delivery_success', url: '/audio/delivery_success.mp3' },
      { key: 'star_collect', url: '/audio/star_collect.mp3' },
      { key: 'beacon_burst', url: '/audio/beacon_burst.mp3' },
      { key: 'level_complete', url: '/audio/level_complete.mp3' },
      { key: 'crash', url: '/audio/crash.mp3' },
      { key: 'sleigh_bells', url: '/audio/sleigh_bells.mp3' },
      { key: 'sleigh_bells_light', url: '/audio/sleigh_bells_light.mp3' },
      { key: 'wind_loop', url: '/audio/wind_loop.mp3' }
    ];

    try {
      await Promise.all(sfxList.map(item => this._loadBuffer(item.key, item.url)));
      this.loaded = true;
    } catch (e) {
      console.warn('[SoundManager] SFX preloading error:', e);
    }
  }

  async _loadBuffer(key, url) {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      this.buffers.set(key, { raw: arrayBuffer, decoded: null });
    } catch (e) {
      console.warn(`[SoundManager] Could not fetch ${url}`, e);
    }
  }

  async _getDecodedBuffer(key) {
    if (!this.ctx) return null;
    const entry = this.buffers.get(key);
    if (!entry) return null;
    if (entry.decoded) return entry.decoded;

    if (entry.raw) {
      try {
        entry.decoded = await this.ctx.decodeAudioData(entry.raw.slice(0));
        return entry.decoded;
      } catch (e) {
        console.warn(`[SoundManager] Failed to decode ${key}`, e);
        return null;
      }
    }
    return null;
  }

  // Soft background mountain wind
  async _startAmbientWind() {
    if (!this.ctx || this.windNode) return;
    const buffer = await this._getDecodedBuffer('wind_loop');
    if (!buffer) return;

    this.windNode = this.ctx.createBufferSource();
    this.windNode.buffer = buffer;
    this.windNode.loop = true;

    // Warm, muted lowpass filter so it never clashes with music
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.setValueAtTime(280, this.ctx.currentTime);

    this.windGainNode = this.ctx.createGain();
    this.windGainNode.gain.setValueAtTime(0.12, this.ctx.currentTime);

    this.windNode.connect(this.windFilter);
    this.windFilter.connect(this.windGainNode);
    this.windGainNode.connect(this.ambientGain);

    this.windNode.start(0);
  }

  // Real-time flight audio update (runs every frame)
  updateFlight(speed = 1.8, altitude = 0.8, pitch = 0.0, isSkimming = false, weatherIntensity = 0.0) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.enabled) return;
    const now = this.ctx.currentTime;

    // 1. Modulate Wind: Keep it quiet and soft during normal cruising;
    // only swell gently when diving steeply or in a heavy blizzard.
    if (this.windFilter && this.windGainNode) {
      const diveFactor = Math.max(0, -pitch); // 0 to 0.7
      const targetFreq = 220 + diveFactor * 550 + weatherIntensity * 250;
      const targetGain = 0.10 + diveFactor * 0.40 + weatherIntensity * 0.25;

      this.windFilter.frequency.setTargetAtTime(targetFreq, now, 0.15);
      this.windGainNode.gain.setTargetAtTime(targetGain, now, 0.15);
    }

    // 2. Reindeer Sleigh Bells:
    // Trigger gently every ~0.7s to 0.9s (a relaxed, festive gallop pace).
    // NEVER rapid-fire or overlap into an unlistenable wall of sound.
    const dt = 0.016;
    const stepInterval = Math.max(0.68, 1.05 - (speed / 4.5) * 0.35);
    this._bellAccum += dt;
    if (this._bellAccum >= stepInterval) {
      this._bellAccum = 0;
      this._bellStep = (this._bellStep + 1) % 4;
      this.playHarnessBell(this._bellStep, speed);
    }
  }

  // Play a short, clean harness bell shake (stops previous bell before starting new one)
  async playHarnessBell(step = 0, speed = 1.8) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.enabled) return;
    const key = (step % 2 === 0) ? 'sleigh_bells' : 'sleigh_bells_light';
    const buffer = await this._getDecodedBuffer(key);
    if (!buffer) return;

    try {
      const now = this.ctx.currentTime;

      // Stop previous bell voice smoothly to prevent cacophony
      if (this._activeBellSource) {
        try {
          this._activeBellGain.gain.setValueAtTime(this._activeBellGain.gain.value, now);
          this._activeBellGain.gain.linearRampToValueAtTime(0.001, now + 0.06);
          this._activeBellSource.stop(now + 0.07);
        } catch (e) {}
      }

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = 1.0 + (Math.random() - 0.5) * 0.05;

      const gain = this.ctx.createGain();
      // Gentle, cozy bell volume (0.09 - 0.14) that harmonizes with the music
      const vol = 0.09 + Math.min(speed / 4.5, 1.0) * 0.05;
      gain.gain.setValueAtTime(vol, now);
      // Fade out after 0.45s so it doesn't linger forever
      gain.gain.setValueAtTime(vol, now + 0.28);
      gain.gain.linearRampToValueAtTime(0.0001, now + 0.48);

      source.connect(gain);
      gain.connect(this.sfxGain);

      source.start(now);
      source.stop(now + 0.50);

      this._activeBellSource = source;
      this._activeBellGain = gain;
    } catch (e) {}
  }

  // Orchestral winter background music
  startBGM() {
    if (!this.bgmAudio) {
      this.bgmAudio = new Audio(this.currentTrack);
      this.bgmAudio.loop = true;
      this.bgmAudio.volume = this.enabled ? this.musicVolume : 0.0;
    }
    if (this.enabled) {
      this.bgmAudio.volume = this.musicVolume;
      this.bgmAudio.play().catch(() => {});
    }
  }

  stopBGM() {
    if (this.bgmAudio) {
      this.bgmAudio.pause();
    }
  }

  // Helper to play a clean, concise sample with strict voice-limiting and fast fadeout
  async _playSample(channel, key, volume = 0.7, maxDuration = 1.2, pitch = 1.0) {
    if (!this.ctx || this.ctx.state !== 'running' || !this.enabled) return;
    const buffer = await this._getDecodedBuffer(key);
    if (!buffer) return;

    try {
      const now = this.ctx.currentTime;

      // If an existing voice is playing on this channel, gracefully fade it out
      const prev = this.activeVoices.get(channel);
      if (prev) {
        try {
          prev.gain.gain.setValueAtTime(prev.gain.gain.value, now);
          prev.gain.gain.linearRampToValueAtTime(0.001, now + 0.04);
          prev.source.stop(now + 0.05);
        } catch (e) {}
      }

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = pitch;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, now);
      // Clean envelope: hold for 65% of maxDuration, then smoothly fade out
      const fadeStart = now + maxDuration * 0.60;
      gain.gain.setValueAtTime(volume, fadeStart);
      gain.gain.exponentialRampToValueAtTime(0.001, now + maxDuration);

      source.connect(gain);
      gain.connect(this.sfxGain);

      source.start(now);
      source.stop(now + maxDuration + 0.05);

      this.activeVoices.set(channel, { source, gain });
    } catch (e) {}
  }

  // --- Gameplay Sound Effects ---

  // Gift drop whoosh (punchy 0.35s air release)
  playDrop() {
    const now = performance.now();
    if (now - this._lastDropTime < 180) return; // Cooldown gate
    this._lastDropTime = now;

    this._playSample('drop', 'gift_drop', 0.42, 0.40, 1.1);
  }

  // Chimney delivery success (clean, magical 0.75s sparkle chime)
  playSuccess() {
    const now = performance.now();
    if (now - this._lastSuccessTime < 250) return;
    this._lastSuccessTime = now;

    this._playSample('delivery', 'delivery_success', 0.65, 0.85, 1.0);
  }

  // Miss / dud drop (subtle soft thud)
  playMiss() {
    this._playSample('drop', 'gift_drop', 0.25, 0.30, 0.75);
  }

  // Star collect (bright, snappy 0.5s crystal chime)
  playStar() {
    const now = performance.now();
    if (now - this._lastStarTime < 120) return;
    this._lastStarTime = now;

    this._playSample('star', 'star_collect', 0.55, 0.50, 1.08 + (Math.random() - 0.5) * 0.06);
  }

  // Beacon / Ring fly-through burst (focused 0.9s chime sweep)
  playBeaconBurst() {
    const now = performance.now();
    if (now - this._lastBeaconTime < 400) return;
    this._lastBeaconTime = now;

    this._playSample('beacon', 'beacon_burst', 0.48, 0.90, 1.15);
  }

  // Full 5-delivery run complete fanfare
  playChunkComplete() {
    this._playSample('jingle', 'level_complete', 0.70, 2.0, 1.0);
  }

  // Crash impact
  playCrash() {
    this._playSample('impact', 'crash', 0.75, 0.85, 0.95);
  }

  // Multiplier combo streak: pitch-scaled clean sparkle
  playCombo(comboCount = 1) {
    const pitch = Math.min(1.0 + (comboCount - 1) * 0.08, 1.35);
    this._playSample('delivery', 'delivery_success', 0.65, 0.85, pitch);
  }

  // Bag refill
  playRefill() {
    this._playSample('refill', 'star_collect', 0.45, 0.50, 0.95);
  }

  // Toggle Audio Mute / Unmute
  toggleMute() {
    this.enabled = !this.enabled;
    localStorage.setItem('santa_audio_enabled', this.enabled ? 'true' : 'false');
    if (this.ctx && this.masterGain) {
      const targetGain = this.enabled ? this.masterVolume : 0.0;
      this.masterGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.05);
    }
    if (this.bgmAudio) {
      if (this.enabled) {
        this.bgmAudio.volume = this.musicVolume;
        this.bgmAudio.play().catch(() => {});
      } else {
        this.bgmAudio.pause();
      }
    }
    return this.enabled;
  }
}

export const soundManager = new SoundManager();
