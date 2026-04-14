// Audio engine — mirrors SpellPlayer.swift from the iOS app.
//
// Signal chain (mirrors iOS): source → boostGain → masterGain → destination
//   boostGain.gain = 5.0  ≈  eqNode.globalGain = 14dB  (10^(14/20) = 5.012)
//   masterGain.gain = 0–1  ≈  engine.mainMixerNode.outputVolume
//
// iOS Safari blocks all audio until a user gesture has occurred.
// unlock() must be called directly inside a tap handler — not in a timeout or promise.

class AudioEngine {
  constructor() {
    this.ctx          = null;           // AudioContext — null until unlock() is called
    this.buffers      = new Map();      // filename → AudioBuffer (mirrors cachedFiles in iOS)
    this.masterGain   = null;           // volume control (0–1)
    this.boostGain    = null;           // +14dB boost applied to every spell
    this.currentSource = null;          // the currently playing AudioBufferSourceNode
  }

  // Creates the AudioContext and gain chain.
  // MUST be called synchronously inside a user tap handler (iOS Safari requirement).
  unlock() {
    if (this.ctx) return; // already unlocked
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    // Boost gain: +14dB equivalent — mirrors eqNode.globalGain = 14 in SpellPlayer.swift
    this.boostGain = this.ctx.createGain();
    this.boostGain.gain.value = 5.0;

    // Master gain: volume control — mirrors mainMixerNode.outputVolume
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;

    // Wire the chain: boostGain → masterGain → speakers
    this.boostGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  // Fetches and decodes all audio files in parallel, storing them in the cache.
  // Mirrors the lazy caching in audioFile(for:) in SpellPlayer.swift,
  // except we load everything upfront so the first gesture fires instantly.
  // filenames: array of strings, e.g. ['abracadabra-female.mp3', ...]
  async preload(filenames) {
    const promises = filenames.map(async (filename) => {
      if (this.buffers.has(filename)) return; // already cached
      try {
        const response = await fetch(`audio/${filename}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        this.buffers.set(filename, audioBuffer);
      } catch (e) {
        console.warn(`DeviceMagic: could not load audio/${filename}`, e);
      }
    });
    await Promise.all(promises);
  }

  // Plays a spell audio file.
  // Stops any currently playing spell first — mirrors playerNode.stop() in SpellPlayer.swift.
  async play(filename) {
    if (!this.ctx || !this.buffers.has(filename)) return;

    // Resume context if suspended — must be awaited so audio actually starts.
    // iOS suspends the context after async operations (e.g. permission dialog).
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    // Stop the current spell — mirrors playerNode.stop() before scheduleFile()
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch (_) {}
      this.currentSource.disconnect();
      this.currentSource = null;
    }

    // Create a new source node and connect it through the gain chain
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.get(filename);
    source.connect(this.boostGain);
    source.start(0);
    this.currentSource = source;

    // Clean up reference when playback finishes naturally
    source.onended = () => {
      if (this.currentSource === source) this.currentSource = null;
    };
  }

  // Sets the master volume (0.0 – 1.0).
  // Mirrors: engine.mainMixerNode.outputVolume = volume in SpellPlayer.swift
  setVolume(v) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, v));
    }
  }

  // Returns true if the engine has been unlocked and files are loaded.
  get isReady() {
    return this.ctx !== null && this.buffers.size > 0;
  }
}
