// App coordinator — mirrors AppModel.swift from the iOS app.
//
// Wires together: MotionEngine (motion.js) + AudioEngine (audio.js) + selectSpell (spells.js)
// Manages all state, persists it to localStorage, and drives the UI.
//
// DOM elements this file expects:
//   #landing          — the landing section, visible before activation
//   #casting          — the casting section, hidden before activation
//   #activate-btn     — the single button iOS users tap to start
//   #android-browser-btn — "try in browser" button on Android view
//   #status-emoji     — shows 🪄 (active) or 💤 (paused)
//   #status-text      — shows "Listening for spells" or "Monitoring off"
//   #last-spell       — displays the name of the last spell cast
//   #spell-count      — displays spell counter
//   #active-toggle    — checkbox to toggle monitoring on/off
//   #voice-picker     — <select> for Female / Male / Mixed
//   #volume-slider    — <input type="range"> for volume
//   #test-btn         — fires a spell without a gesture
//   #spell-flash      — full-screen flash overlay (added to index.html)
//   #no-motion-msg    — shown when DeviceMotionEvent is unsupported

// ── State ────────────────────────────────────────────────────────────────────

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

const motion = new MotionEngine(onGestureDetected, onRawMotion);
const audio  = new AudioEngine();
let wakeLock  = null;

// ── Boot ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  // Restore UI controls to saved state
  _el('voice-picker').value    = state.voiceStyle;
  _el('volume-slider').value   = state.volume;
  _el('active-toggle').checked = state.isActive;
  _updateSpellCounter();

  // iOS activate button
  _el('activate-btn').addEventListener('click',   handleActivate);

  // Android "try in browser" — wired here so the click is a real trusted user gesture.
  // dispatchEvent() creates isTrusted=false events which Android Chrome blocks for audio.play().
  const androidBtn = document.getElementById('android-browser-btn');
  if (androidBtn) {
    androidBtn.addEventListener('click', handleActivate);
  }

  _el('active-toggle').addEventListener('change', handleToggle);
  _el('voice-picker').addEventListener('change',  handleVoiceChange);
  _el('volume-slider').addEventListener('input',  handleVolumeChange);
  _el('test-btn').addEventListener('click',       onGestureDetected);
});

// ── Activate ─────────────────────────────────────────────────────────────────
// Called when the user taps the activate or "try in browser" button.
// This is the one user gesture that unlocks audio and motion on iOS.
// On Android, no permission dialog appears — motion access is granted automatically.

async function handleActivate() {
  // Give Android users feedback on their button, not the hidden iOS one
  const isAndroid = document.documentElement.getAttribute('data-device') === 'android';
  const feedbackBtn = isAndroid
    ? document.getElementById('android-browser-btn')
    : _el('activate-btn');

  if (feedbackBtn) {
    feedbackBtn.disabled    = true;
    feedbackBtn.textContent = 'Loading…';
  }

  // Step 1: Unlock audio — must happen synchronously in this tap handler
  audio.unlock();

  // Step 2: Check if motion is supported at all
  if (!MotionEngine.isSupported()) {
    _showNoMotionMessage();
    // Still proceed — user can use the test button
  }

  // Step 3: Request motion permission (iOS 13+ shows native dialog; Android skips this)
  const granted = await motion.requestPermission();
  if (!granted && MotionEngine.isSupported()) {
    if (feedbackBtn) {
      feedbackBtn.textContent = 'Motion access denied ✕';
      feedbackBtn.disabled    = false;
    }
    return;
  }

  // Step 4: Preload all audio elements (~80ms)
  if (feedbackBtn) feedbackBtn.textContent = 'Loading spells…';
  await audio.preload(getAllAudioFilenames());
  audio.setVolume(state.volume);

  // Step 5: Always start motion monitoring on activation.
  // Force isActive true here — if a prior session had monitoring off,
  // the user would get stuck with no spells and no obvious reason why.
  state.isActive = true;
  _el('active-toggle').checked = true;
  _save();
  motion.start();

  // Step 6: Wake lock
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) {}

  // Step 7: Transition to casting UI.
  // Instead of hiding landing, we add the casting-active class to body:
  //   - Platform views (buttons, downloads) are hidden via CSS
  //   - Compact brand (title + tagline) is shown in landing
  //   - Scroll indicator appears at the bottom of landing
  //   - Landing footer/credits are hidden (casting footer has them)
  //   - #casting[hidden] is revealed and scrolled into view
  if (feedbackBtn) feedbackBtn.textContent = 'Your phone is a wand now ✦';
  await new Promise(r => setTimeout(r, 900));

  document.body.classList.add('casting-active');
  const castingEl = _el('casting');
  castingEl.removeAttribute('hidden');

  _updateStatusUI();
}

// ── Gesture detected ─────────────────────────────────────────────────────────
// Called by MotionEngine (motion gesture) and the test button.

async function onGestureDetected() {
  const { spell, filename, nextVoiceWasFemale } = selectSpell(
    state.lastSpellId,
    state.lastVoiceWasFemale,
    state.voiceStyle
  );

  await audio.play(filename);
  _triggerFlash();

  state.lastSpellId        = spell.id;
  state.lastVoiceWasFemale = nextVoiceWasFemale;
  state.spellCount++;
  _save();

  _showSpellName(spell.name);
  _updateSpellCounter();
}

// ── Raw motion callback ───────────────────────────────────────────────────────
// Called on every devicemotion event. Used to pulse the sensor indicator
// so users can confirm the accelerometer is working even before a spell fires.

let _rawMotionTimer = null;
function onRawMotion(magnitude) {
  const dot = document.getElementById('sensor-dot');
  if (!dot) return;
  dot.classList.add('sensor-pulse');
  clearTimeout(_rawMotionTimer);
  _rawMotionTimer = setTimeout(() => dot.classList.remove('sensor-pulse'), 200);
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

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && audio.isReady) {
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
  const emoji = _el('status-emoji');
  const text  = _el('status-text');
  if (emoji) emoji.textContent = state.isActive ? '🪄' : '💤';
  if (text)  text.textContent  = state.isActive ? 'Listening for spells' : 'Monitoring off';
}

function _updateSpellCounter() {
  const n  = state.spellCount;
  const el = _el('spell-count');
  if (!el) return;
  if (n > 0) {
    el.textContent = `#${n}`;
    el.classList.remove('spell-pop');
    void el.offsetWidth;
    el.classList.add('spell-pop');
  } else {
    el.textContent = '';
  }
}

function _showSpellName(name) {
  const el = _el('last-spell');
  if (!el) return;
  el.textContent = name;
  el.classList.remove('spell-name-pop');
  void el.offsetWidth;
  el.classList.add('spell-name-pop');
}

function _triggerFlash() {
  const flash = _el('spell-flash');
  if (!flash) return;
  flash.classList.remove('flash-active');
  void flash.offsetWidth;
  flash.classList.add('flash-active');
}

function _showNoMotionMessage() {
  const msg = _el('no-motion-msg');
  if (msg) msg.hidden = false;
}
