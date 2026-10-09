const RADIUS = 58;
const DEAD = 5;

/** Floating virtual joystick (touch + mouse) plus WASD / arrow keys. */
export class Input {
  enabled = false;
  /** Fires once the player has actually moved (tutorial). */
  onFirstMove: (() => void) | null = null;
  private pid: number | null = null;
  private ox = 0;
  private oy = 0;
  private dx = 0;
  private dy = 0;
  private keys = new Set<string>();
  private base: HTMLDivElement;
  private knob: HTMLDivElement;

  constructor(surface: HTMLElement, host: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'joy';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    host.appendChild(this.base);

    surface.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.moveEv, { passive: true });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    window.addEventListener('keydown', this.key);
    window.addEventListener('keyup', this.key);
    window.addEventListener('blur', () => this.reset());
  }

  private down = (e: PointerEvent) => {
    if (!this.enabled || this.pid !== null) return;
    this.pid = e.pointerId;
    this.ox = e.clientX;
    this.oy = e.clientY;
    this.dx = this.dy = 0;
    this.base.style.transform = `translate(${this.ox}px, ${this.oy}px)`;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.base.classList.add('on');
  };

  private moveEv = (e: PointerEvent) => {
    if (e.pointerId !== this.pid) return;
    let dx = e.clientX - this.ox;
    let dy = e.clientY - this.oy;
    const l = Math.hypot(dx, dy);
    if (l > RADIUS) {
      // Let the stick follow the finger so direction changes stay responsive.
      this.ox += (dx / l) * (l - RADIUS);
      this.oy += (dy / l) * (l - RADIUS);
      dx = (dx / l) * RADIUS;
      dy = (dy / l) * RADIUS;
      this.base.style.transform = `translate(${this.ox}px, ${this.oy}px)`;
    }
    this.dx = dx;
    this.dy = dy;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pid) return;
    this.pid = null;
    this.dx = this.dy = 0;
    this.base.classList.remove('on');
  };

  private key = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) return;
    if (e.type === 'keydown') this.keys.add(k);
    else this.keys.delete(k);
    if (this.enabled) e.preventDefault();
  };

  reset(): void {
    this.pid = null;
    this.dx = this.dy = 0;
    this.keys.clear();
    this.base.classList.remove('on');
  }

  /** Movement on the ground plane: x → right, z → towards the camera. */
  read(): { x: number; z: number; mag: number } {
    if (!this.enabled) return { x: 0, z: 0, mag: 0 };
    let x = 0, z = 0, mag = 0;
    const l = Math.hypot(this.dx, this.dy);
    if (l > DEAD) {
      x = this.dx / l;
      z = this.dy / l;
      mag = Math.min(1, (l - DEAD) / (RADIUS * 0.7 - DEAD));
    } else if (this.keys.size) {
      const k = this.keys;
      x = (k.has('arrowright') || k.has('d') ? 1 : 0) - (k.has('arrowleft') || k.has('a') ? 1 : 0);
      z = (k.has('arrowdown') || k.has('s') ? 1 : 0) - (k.has('arrowup') || k.has('w') ? 1 : 0);
      const kl = Math.hypot(x, z);
      if (kl > 0) {
        x /= kl;
        z /= kl;
        mag = 1;
      }
    }
    if (mag > 0 && this.onFirstMove) {
      this.onFirstMove();
      this.onFirstMove = null;
    }
    return { x, z, mag };
  }
}
