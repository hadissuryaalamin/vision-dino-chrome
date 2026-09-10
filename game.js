/**
 * game.js
 * Endless runner engine for three independent lanes rendered on separate
 * <canvas> elements.  Each player has their own Runner instance.
 *
 * Controls (set externally via runner.applyGesture(gesture)):
 *   'jump'  – player jumps (hold-time capped)
 *   'duck'  – player ducks (low profile)
 *   'none'  – neutral
 */

const CANVAS_W = 360; // logical canvas width (scaled by CSS)
const CANVAS_H = 140;
const GROUND_Y = 105;
const GRAVITY   = 0.55;
const JUMP_VY   = -11;
const DUCK_H    = 22;
const STAND_H   = 38;
const STAND_W   = 22;
const DUCK_W    = 34;

const PLAYER_COLORS = ['#ff6b6b', '#4ecdc4', '#ffe66d'];
const OBSTACLE_COLORS = ['#e94560', '#0099aa', '#c9a227'];

// ── Obstacle types ────────────────────────────────────────────────────────────
const OBSTACLES = [
  { w: 16, h: 40, ground: true,  label: 'CACTUS' },   // tall cactus – jump
  { w: 24, h: 20, ground: true,  label: 'ROCK'   },   // low rock    – duck or jump
  { w: 36, h: 14, ground: false, label: 'BIRD'   },   // flying bird – duck under
];

function rand(min, max) { return Math.random() * (max - min) + min; }

// ── Runner (one per player) ───────────────────────────────────────────────────
export class Runner {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} playerIndex   0,1,2
   * @param {() => void} onDeath
   */
  constructor(canvas, playerIndex, onDeath) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.pIdx   = playerIndex;
    this.onDeath = onDeath;
    this.color  = PLAYER_COLORS[playerIndex];
    this.obsColor = OBSTACLE_COLORS[playerIndex];

    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;

    this.reset();
  }

  reset() {
    this.alive    = true;
    this.score    = 0;
    this.speed    = 4;
    this.frameCount = 0;

    // Player physics
    this.x  = 60;
    this.y  = GROUND_Y;
    this.vy = 0;
    this.ducking = false;
    this.jumping = false;

    // Obstacles
    this.obstacles = [];
    this.nextObstacleIn = Math.floor(rand(80, 130));

    // Leg animation
    this.legPhase = 0;
  }

  /** Called by gesture controller */
  applyGesture(gesture) {
    if (!this.alive) return;
    if (gesture === 'jump' && !this.jumping) {
      this.vy = JUMP_VY;
      this.jumping = true;
      this.ducking = false;
    } else if (gesture === 'duck') {
      this.ducking = true;
    } else if (gesture === 'none') {
      this.ducking = false;
    }
  }

  /** Returns current score */
  update() {
    if (!this.alive) return this.score;

    this.frameCount++;
    this.score = Math.floor(this.frameCount / 6);
    this.speed = 4 + this.score * 0.005; // gentle acceleration

    // Physics
    this.vy += GRAVITY;
    this.y  += this.vy;
    if (this.y >= GROUND_Y) {
      this.y = GROUND_Y;
      this.vy = 0;
      this.jumping = false;
    }

    // Leg animation (only on ground)
    if (!this.jumping) this.legPhase += this.speed * 0.18;

    // Obstacles
    this.nextObstacleIn--;
    if (this.nextObstacleIn <= 0) {
      const type = OBSTACLES[Math.floor(Math.random() * OBSTACLES.length)];
      const flyY = type.ground ? 0 : rand(30, 55);
      this.obstacles.push({
        x: CANVAS_W + 20,
        y: type.ground ? GROUND_Y - type.h : flyY,
        w: type.w,
        h: type.h,
        label: type.label,
      });
      this.nextObstacleIn = Math.floor(rand(70, 130) / (this.speed / 4));
    }

    for (const obs of this.obstacles) obs.x -= this.speed;
    this.obstacles = this.obstacles.filter(o => o.x + o.w > 0);

    // Collision
    const pw = this.ducking ? DUCK_W : STAND_W;
    const ph = this.ducking ? DUCK_H : STAND_H;
    const py = this.y - ph;
    const px = this.x;

    for (const obs of this.obstacles) {
      if (
        px + pw - 4 > obs.x + 2 &&
        px + 4       < obs.x + obs.w - 2 &&
        py + ph - 4  > obs.y + 2 &&
        py + 4       < obs.y + obs.h - 2
      ) {
        this.alive = false;
        this.onDeath();
        break;
      }
    }

    return this.score;
  }

  draw() {
    const ctx = this.ctx;
    const W = CANVAS_W;
    const H = CANVAS_H;

    ctx.clearRect(0, 0, W, H);

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0f3460');
    sky.addColorStop(1, '#16213e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Ground line
    ctx.strokeStyle = this.color + '88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 2);
    ctx.lineTo(W, GROUND_Y + 2);
    ctx.stroke();

    // Score
    ctx.fillStyle = this.color + 'aa';
    ctx.font = '11px monospace';
    ctx.fillText(`${this.score}`, W - 40, 16);

    if (!this.alive) {
      ctx.fillStyle = '#f44336cc';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('DEAD', W / 2 - 22, H / 2 + 6);
      return;
    }

    // Obstacles
    ctx.fillStyle = this.obsColor;
    for (const obs of this.obstacles) {
      ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
      // hatching
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      for (let hx = obs.x; hx < obs.x + obs.w; hx += 6) {
        ctx.beginPath(); ctx.moveTo(hx, obs.y); ctx.lineTo(hx, obs.y + obs.h); ctx.stroke();
      }
    }

    // Player character
    this._drawPlayer(ctx);
  }

  _drawPlayer(ctx) {
    const px = this.x;
    const py = this.y;
    const color = this.color;
    const ducking = this.ducking;

    ctx.fillStyle = color;

    if (ducking) {
      // Crouched rectangle
      ctx.fillRect(px - DUCK_W / 2, py - DUCK_H, DUCK_W, DUCK_H);
      // Eyes
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(px + DUCK_W / 2 - 8, py - DUCK_H + 4, 4, 4);
    } else {
      // Body
      const bw = STAND_W, bh = STAND_H;
      ctx.fillRect(px - bw / 2, py - bh, bw, bh);

      // Eyes
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(px + bw / 2 - 7, py - bh + 4, 4, 4);

      // Legs (animated)
      if (!this.jumping) {
        const legSwing = Math.sin(this.legPhase) * 5;
        ctx.fillStyle = color;
        ctx.fillRect(px - 5, py, 5, 6 + legSwing);
        ctx.fillRect(px + 2, py, 5, 6 - legSwing);
      }
    }
  }
}

// ── GameManager ───────────────────────────────────────────────────────────────
export class GameManager {
  /**
   * @param {HTMLCanvasElement[]} canvases  3 canvases
   * @param {(winnerId: number|null) => void} onGameOver
   */
  constructor(canvases, onGameOver) {
    this.onGameOver = onGameOver;
    this.runners = canvases.map((c, i) => new Runner(c, i, () => this._checkWinner()));
    this.running = false;
    this._raf = null;
  }

  start() {
    if (this.running) return;
    this.runners.forEach(r => r.reset());
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  restart() {
    this.stop();
    this.runners.forEach(r => r.reset());
    this.running = true;
    this._loop();
  }

  /** @param {number} playerIndex  @param {'jump'|'duck'|'none'} gesture */
  applyGesture(playerIndex, gesture) {
    this.runners[playerIndex].applyGesture(gesture);
  }

  getScores() {
    return this.runners.map(r => r.score);
  }

  _loop() {
    if (!this.running) return;
    this.runners.forEach(r => { r.update(); r.draw(); });
    this._raf = requestAnimationFrame(() => this._loop());
  }

  _checkWinner() {
    const alive = this.runners.filter(r => r.alive);
    if (alive.length <= 1) {
      const winner = alive.length === 1 ? alive[0].pIdx : null;
      // Let the last alive runner's score accumulate for a moment before stopping
      setTimeout(() => {
        this.stop();
        this.onGameOver(winner);
      }, 600);
    }
  }
}
