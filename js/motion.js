// Motion detector — wrist-flick gesture detection for the browser app.

class MotionEngine {
  constructor(onGesture, onRawMotion) {
    this.onGesture   = onGesture;
    this.onRawMotion = onRawMotion || null;
    this.lastTriggerTime = 0;
    this._prevMag = 0; // previous magnitude reading (for jerk fallback)

    // ── Tuning ─────────────────────────────────────────────────────────────
    //
    // The hard problem: distinguishing a deliberate wrist flick from incidental
    // movements like setting the phone on a table or picking it up.
    //
    // Primary filter: rotation rate (gyroscope).
    //   A wrist flick/whip involves rapid wrist rotation: 200–400 deg/s.
    //   Putting a phone down or picking it up is mostly linear — very little
    //   rotation. This is the best single discriminator available.
    //
    // Secondary filter (fallback — devices without gyroscope):
    //   Per-frame magnitude delta. A flick produces a sharp spike (large delta
    //   between consecutive readings). Slow movements have small deltas.
    //
    // Magnitude threshold:
    //   accelerationIncludingGravity at rest = ~9.8 m/s² regardless of
    //   orientation. A solid wrist flick adds 6–15 m/s² on top → 15–25 m/s².
    //   Threshold of 15 lets through deliberate flicks and blocks idle motion.

    this.MAG_THRESHOLD  = 15;   // m/s² — total acceleration magnitude trigger point
    this.MIN_ROTATION   = 80;   // deg/s — minimum rotation magnitude (gyroscope path)
    this.MIN_DELTA      = 5;    // m/s² — minimum per-frame change (no-gyro fallback)
    this.COOLDOWN       = 2000; // ms  — minimum gap between spells

    this._boundHandler = this._handleMotion.bind(this);
  }

  static isSupported() {
    return typeof DeviceMotionEvent !== 'undefined';
  }

  async requestPermission() {
    if (!MotionEngine.isSupported()) return false;
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const result = await DeviceMotionEvent.requestPermission();
        return result === 'granted';
      } catch (e) {
        return false;
      }
    }
    return true; // Android / desktop — no prompt needed
  }

  start() {
    window.addEventListener('devicemotion', this._boundHandler);
  }

  stop() {
    window.removeEventListener('devicemotion', this._boundHandler);
  }

  _handleMotion(event) {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;

    const magnitude = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

    // Track per-frame delta for the no-gyro fallback
    const delta = Math.abs(magnitude - this._prevMag);
    this._prevMag = magnitude;

    // Always fire raw callback so the sensor dot can pulse
    if (this.onRawMotion) this.onRawMotion(magnitude);

    // ── Primary magnitude check ─────────────────────────────────────────
    if (magnitude < this.MAG_THRESHOLD) return;

    // ── Wrist-rotation check ────────────────────────────────────────────
    // Use rotation rate if the gyroscope is available.
    // This is the key filter: a flick has fast wrist rotation; a put-down doesn't.
    const rot = event.rotationRate;
    const hasGyro = rot && rot.alpha !== null && rot.beta !== null && rot.gamma !== null;

    if (hasGyro) {
      const rotMag = Math.sqrt(rot.alpha * rot.alpha + rot.beta * rot.beta + rot.gamma * rot.gamma);
      if (rotMag < this.MIN_ROTATION) return;
    } else {
      // No gyroscope — fall back to per-frame jerk.
      // Requires the magnitude to jump sharply, which a slow movement won't do.
      if (delta < this.MIN_DELTA) return;
    }

    // ── Cooldown ────────────────────────────────────────────────────────
    const now = Date.now();
    if (now - this.lastTriggerTime < this.COOLDOWN) return;

    this.lastTriggerTime = now;
    this.onGesture();
  }
}
