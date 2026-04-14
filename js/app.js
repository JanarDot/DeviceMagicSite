// App coordinator — mirrors AppModel.swift from the iOS app.
//
// Wires together: MotionEngine (motion.js) + AudioEngine (audio.js) + selectSpell (spells.js)
// Manages all state, persists it to localStorage, and drives the UI.
//
// DOM elements this file expects (provided by Phase 6 — index.html):
//   #landing          — the landing section, visible before activation
//   #casting          — the casting section, hidden before activation
//   #activate-btn     — the single button the user taps to start
//   #status-emoji     — shows 🪄 (active) or 💤 (paused)
//   #status-text      — shows "Listening for spells" or "Monitoring off"
//   #last-spell       — displays the name of the last spell cast
//   #spell-count      — displays "X spells cast"
//   #active-toggle    — checkbox to toggle monitoring on/off
//   #voice-picker     — <select> for Female / Male / Mixed
//   #volume-slider    — <input type="range"> for volume
//   #test-btn         — fires a spell without a gesture

// ── State ────────────────────────────────────────────────────────────────────
// Mirrors the @Published properties and UserDefaults keys in AppModel.swift

const state = {
  isActive:           _load('isActive',           true),
  voiceStyle:         _load('voiceStyle',          'mixed'),
  volume:             _load('volume',              1.0),
  spellCount:         _load('spellCount',          0),
  lastSpellId:        _load('lastSpellId',         null),
  lastVoiceWasFemale: _load('lastVoiceWasFemale',  false),
};

function _load(key, defaultVal) {
  const raw = localStorage.getItem(key);
  return raw !== null ? JSON.parse(raw) : defaultVal;
}

function _save() {
  Object.entries(state).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
}

// ── Engine instances ─────────────────────────────────────────────────────────

const motion = new MotionEngine(onGestureDetected);
const audio  = new AudioEngine();
let wakeLock = null;

// ── Boot ─────────────────────────────────────────────────────────────────────
// Runs once when the page finishes loading.

window.addEventListener('DOMContentLoaded', () => {
  // Restore UI controls to saved state
  _el('voice-picker').value   = state.voiceStyle;
  _el('volume-slider').value  = state.volume;
  _el('active-toggle').checked = state.isActive;
  _updateSpellCounter();

  // Wire up all control event listeners
  _el('activate-btn').addEventListener('click',    handleActivate);
  _el('active-toggle').addEventListener('change',  handleToggle);
  _el('voice-picker').addEventListener('change',   handleVoiceChange);
  _el('volume-slider').addEventListener('input',   handleVolumeChange);
  _el('test-btn').addEventListener('click',        onGestureDetected);
});

// ── Activate ─────────────────────────────────────────────────────────────────
// Called when the user taps the Activate button on the landing screen.
// This is the one user gesture that unlocks both audio and motion on iOS.

async function handleActivate() {
  const btn = _el('activate-btn');
  btn.disabled    = true;
  btn.textContent = 'Requesting access…';

  // Step 1: Unlock audio context — must happen synchronously in this tap handler
  audio.unlock();

  // Step 2: Request motion permission (iOS 13+ shows a native dialog here)
  const granted = await motion.requestPermission();
  if (!granted) {
    btn.textContent = 'Motion access denied ✕';
    btn.disabled    = false;
    return;
  }

  // Step 2b: iOS suspends the AudioContext during the async permission dialog.
  // Re-resume it now that we're back in a resolved state.
  if (audio.ctx && audio.ctx.state === 'suspended') {
    await audio.ctx.resume();
  }

  // Step 3: Preload all 40 audio files into memory
  btn.textContent = 'Loading spells…';
  await audio.preload(getAllAudioFilenames());

  // Step 4: Apply saved volume
  audio.setVolume(state.volume);

  // Step 5: Start motion detection if monitoring is on
  if (state.isActive) {
    motion.start();
  }

  // Step 6: Request screen wake lock so the phone doesn't sleep mid-session.
  // Fails silently on browsers that don't support it (older iOS, some Android).
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) {}

  // Step 7: Briefly confirm readiness, then transition to casting UI
  btn.textContent = 'Your phone is a wand now';
  await new Promise(r => setTimeout(r, 1100));
  _el('landing').hidden = true;
  _el('casting').hidden = false;
  _updateStatusUI();
}

// ── Gesture detected ─────────────────────────────────────────────────────────
// Called by MotionEngine when a spell gesture is detected,
// and also by the "Cast a test spell" button.
// Mirrors AppModel.castSpell() in the iOS app.

async function onGestureDetected() {
  const { spell, filename, nextVoiceWasFemale } = selectSpell(
    state.lastSpellId,
    state.lastVoiceWasFemale,
    state.voiceStyle
  );

  await audio.play(filename);

  state.lastSpellId        = spell.id;
  state.lastVoiceWasFemale = nextVoiceWasFemale;
  state.spellCount++;
  _save();

  _showSpellName(spell.name);
  _updateSpellCounter();
}

// ── Settings handlers ─────────────────────────────────────────────────────────

function handleToggle() {
  state.isActive = _el('active-toggle').checked;
  if (state.isActive) {
    motion.start();
  } else {
    motion.stop();
  }
  _updateStatusUI();
  _save();
}

function handleVoiceChange() {
  state.voiceStyle = _el('voice-picker').value;
  _save();
}

function handleVolumeChange() {
  state.volume = parseFloat(_el('volume-slider').value);
  audio.setVolume(state.volume);
  _save();
}

// ── Wake lock: re-acquire when tab comes back into focus ──────────────────────
// iOS releases the wake lock whenever the tab loses visibility.
// This re-requests it so the screen stays on when the user returns.

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.isActive && audio.isReady) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) {}
  }
});

// ── UI helpers ────────────────────────────────────────────────────────────────

function _el(id) {
  return document.getElementById(id);
}

function _updateStatusUI() {
  _el('status-emoji').textContent = state.isActive ? '🪄' : '💤';
  _el('status-text').textContent  = state.isActive ? 'Listening for spells' : 'Monitoring off';
}

function _updateSpellCounter() {
  const n = state.spellCount;
  _el('spell-count').textContent = n > 0
    ? `${n} spell${n === 1 ? '' : 's'} cast`
    : '';
}

function _showSpellName(name) {
  const el = _el('last-spell');
  el.textContent = name;
  // Restart the pop-in animation by removing and re-adding the class
  el.classList.remove('spell-pop');
  void el.offsetWidth; // force a reflow so the browser notices the class was removed
  el.classList.add('spell-pop');
}
