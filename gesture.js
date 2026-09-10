/**
 * gesture.js
 * Detects jump / duck gestures for up to 3 players from a single webcam feed.
 *
 * Strategy
 * --------
 * The video frame is split horizontally into thirds; each third belongs to one
 * player.  MediaPipe Holistic (or FaceMesh + Hands) is too heavy to run three
 * times simultaneously, so we use a single MediaPipe FaceMesh + Hands
 * instance on the full frame and assign detected faces / hands to the nearest
 * third by the x-centre of the detected bounding region.
 *
 * Gestures
 * --------
 *   JUMP  – open hand raised above the face (wrist y < face-centre y - threshold)
 *         – OR brow-raise (face-only fallback: average of landmark 223 & 443 y
 *           relative to landmark 168 nose tip rises above threshold)
 *   DUCK  – head tilted / chin down  (nose tip y > eye-centre y + threshold)
 *         – OR fingers-down open hand (wrist y > face-centre y + threshold)
 *
 * The module exports a single class `GestureDetector`.
 */

export class GestureDetector {
  /**
   * @param {HTMLVideoElement} videoEl
   * @param {HTMLCanvasElement} overlayEl  – drawn on top of the video preview
   * @param {(playerIndex: number, gesture: 'jump'|'duck'|'none') => void} onGesture
   */
  constructor(videoEl, overlayEl, onGesture) {
    this.video = videoEl;
    this.overlay = overlayEl;
    this.ctx = overlayEl.getContext('2d');
    this.onGesture = onGesture;
    this.running = false;

    // Per-player state: smoothed gesture with a short hold-off to avoid flicker
    this.state = ['none', 'none', 'none'];
    this.holdOff = [0, 0, 0]; // frames to hold current gesture

    this._faceMesh = null;
    this._hands = null;
    this._camera = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await new Promise(r => { this.video.onloadedmetadata = r; });
    this.video.play();

    this.overlay.width  = this.video.videoWidth  || 640;
    this.overlay.height = this.video.videoHeight || 480;

    // Wait for MediaPipe globals to be available (loaded via CDN <script> tags)
    await this._waitForMediaPipe();
    this._initMediaPipe();
  }

  stop() {
    this.running = false;
    if (this._camera) { this._camera.stop(); this._camera = null; }
    if (this.video.srcObject) {
      this.video.srcObject.getTracks().forEach(t => t.stop());
      this.video.srcObject = null;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _waitForMediaPipe() {
    return new Promise(resolve => {
      const check = () => {
        if (window.FaceMesh && window.Hands && window.Camera) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
  }

  _initMediaPipe() {
    const W = this.overlay.width;
    const H = this.overlay.height;

    // --- FaceMesh ---
    this._faceMesh = new window.FaceMesh({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
    });
    this._faceMesh.setOptions({
      maxNumFaces: 3,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    // --- Hands ---
    this._hands = new window.Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
    });
    this._hands.setOptions({
      maxNumHands: 6,
      modelComplexity: 0,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    // Collect results from both models then combine
    this._faceResults = null;
    this._handResults = null;

    this._faceMesh.onResults(r => {
      this._faceResults = r;
      this._combine(W, H);
    });
    this._hands.onResults(r => {
      this._handResults = r;
      this._combine(W, H);
    });

    // Use MediaPipe Camera to feed frames to both models
    this._camera = new window.Camera(this.video, {
      onFrame: async () => {
        if (!this.running) return;
        await this._faceMesh.send({ image: this.video });
        await this._hands.send({ image: this.video });
      },
      width: W,
      height: H,
    });
    this._camera.start();
  }

  _combine(W, H) {
    if (!this._faceResults || !this._handResults) return;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    // Draw zone dividers
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo((W / 3) * i, 0);
      ctx.lineTo((W / 3) * i, H);
      ctx.stroke();
    }

    const COLORS = ['#ff6b6b', '#4ecdc4', '#ffe66d'];

    // Map detected faces to zones
    const faceByZone = [null, null, null]; // zone 0,1,2
    const faces = this._faceResults.multiFaceLandmarks || [];
    for (const lm of faces) {
      const cx = this._faceCentreX(lm);
      const zone = Math.min(2, Math.floor(cx * 3));
      if (faceByZone[zone] === null) faceByZone[zone] = lm;
    }

    // Map detected hands to zones
    const handsByZone = [[], [], []];
    const hands = this._handResults.multiHandLandmarks || [];
    for (const hand of hands) {
      const cx = hand[0].x; // wrist x
      const zone = Math.min(2, Math.floor(cx * 3));
      handsByZone[zone].push(hand);
    }

    // Per-zone gesture classification
    for (let z = 0; z < 3; z++) {
      const face = faceByZone[z];
      const hands = handsByZone[z];
      let gesture = 'none';

      if (face) {
        const faceY = this._faceCentreY(face); // normalised 0-1
        const browRaise = this._browRaise(face);
        const chinDrop  = this._chinDrop(face);

        if (browRaise > 0.018) {
          gesture = 'jump';
        } else if (chinDrop > 0.04) {
          gesture = 'duck';
        }

        // Hand override (more reliable when visible)
        for (const hand of hands) {
          const wristY = hand[0].y;
          if (wristY < faceY - 0.15) { gesture = 'jump'; break; }
          if (wristY > faceY + 0.15) { gesture = 'duck'; break; }
        }

        // Draw face dot
        const fx = face[1].x * W;
        const fy = face[1].y * H;
        ctx.beginPath();
        ctx.arc(fx, fy, 6, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[z];
        ctx.fill();

        // Label
        ctx.fillStyle = COLORS[z];
        ctx.font = 'bold 13px monospace';
        ctx.fillText(`P${z + 1}: ${gesture}`, (W / 3) * z + 6, 20);
      }

      // Apply hold-off smoothing
      if (this.holdOff[z] > 0) {
        this.holdOff[z]--;
      } else if (gesture !== this.state[z]) {
        this.state[z] = gesture;
        this.holdOff[z] = 3; // hold for 3 frames before allowing change
        this.onGesture(z, gesture);
      } else {
        // Still need to fire 'none' when returning to neutral
        if (gesture === 'none' && this.state[z] !== 'none') {
          this.state[z] = 'none';
          this.onGesture(z, 'none');
        }
      }
    }

    this._faceResults = null;
    this._handResults = null;
  }

  _faceCentreX(lm) {
    return (lm[234].x + lm[454].x) / 2; // left/right cheek landmarks
  }

  _faceCentreY(lm) {
    return (lm[10].y + lm[152].y) / 2; // top head / chin
  }

  _browRaise(lm) {
    // Average distance of inner brows (223, 443) above nose bridge (168)
    const nose = lm[168].y;
    const lb   = lm[223].y;
    const rb   = lm[443].y;
    return nose - (lb + rb) / 2; // positive = brows higher than nose bridge
  }

  _chinDrop(lm) {
    // Chin (152) below nose tip (1)
    return lm[152].y - lm[1].y;
  }
}
