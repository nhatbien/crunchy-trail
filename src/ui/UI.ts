import { HATS, SKINS } from '../core/catalog';
import { fmt, t } from '../core/i18n';
import type { SaveData } from '../core/save';
import { HAT_ICONS, ICONS } from './icons';
import { Minimap, type GemDots, type MapData } from './Minimap';

export type ToggleKey = 'music' | 'ambience' | 'haptics';

export interface UIHandlers {
  play(): void;
  openShop(): void;
  closeShop(): void;
  pause(): void;
  resume(): void;
  home(): void;
  toggle(key: ToggleKey, on: boolean): void;
  selectSkin(id: string): void;
  selectHat(id: string): void;
  /** Any button press (UI click sound). */
  tap(): void;
  /** A panel slides in (whoosh). */
  panel(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** DOM overlay: crisp text at any resolution, cheap to render, accessible buttons. */
export class UI {
  private title = el('div', 'screen title');
  private hud = el('div', 'hud');
  private tut = el('div', 'tutorial');
  private toastEl = el('div', 'toast');
  private pauseM = el('div', 'modal');
  private settingsM = el('div', 'modal');
  private bannerEl = el('div', 'banner');
  private map: Minimap | null = null;
  private shop = el('div', 'shop');
  private fill!: HTMLElement;
  private pct!: HTMLElement;
  private zoneLabel!: HTMLElement;
  private gemCount!: HTMLElement;
  private crunchCount!: HTMLElement;
  private tingle!: HTMLElement;
  private toastTimer = 0;
  private bannerTimer = 0;
  private shopTab: 'colors' | 'hats' = 'colors';
  private lastPct = -1;
  private lastZone = '';
  private lastCrunch = -1;

  constructor(
    root: HTMLElement,
    private h: UIHandlers,
    private canVibrate: boolean,
  ) {
    root.append(this.title, this.hud, this.bannerEl, this.tut, this.toastEl, this.shop, this.pauseM, this.settingsM);
    this.buildHud();
    root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) h.tap();
    });
  }

  // ---------- title ----------
  showTitle(s: SaveData, areas: number): void {
    this.title.innerHTML = `
      <div class="logo">
        <img class="logo-img" src="img/logo.webp" alt="Crunchy Trail" draggable="false" />
        <div class="logo-tag">ASMR</div>
      </div>
      <div class="title-stats">
        <span class="chip">${ICONS.gem}<b>${fmt(s.gems)}</b></span>
        <span class="chip">${ICONS.sparkle}<span>${t('totalCrunches')}</span><b>${fmt(s.crunches)}</b></span>
        <span class="chip">${ICONS.map}<span>${t('areas')}</span><b>${Math.min(areas, s.found.length)}/${areas}</b></span>
      </div>
      <div class="title-actions">
        <button class="btn big play">${ICONS.play}<span>${t('play')}</span></button>
        <div class="row">
          <button class="btn round style" aria-label="${t('style')}">${ICONS.shirt}<span>${t('style')}</span></button>
          <button class="btn round settings" aria-label="${t('settings')}">${ICONS.gear}<span>${t('settings')}</span></button>
        </div>
      </div>`;
    this.title.querySelector('.play')!.addEventListener('click', () => this.h.play());
    this.title.querySelector('.style')!.addEventListener('click', () => this.h.openShop());
    this.title.querySelector('.settings')!.addEventListener('click', () => this.showSettings(s));
    this.title.classList.add('on');
  }

  hideTitle(): void {
    this.title.classList.remove('on');
  }

  // ---------- HUD ----------
  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="hud-left">
        <button class="hud-btn pause-btn" aria-label="${t('paused')}">${ICONS.pause}</button>
      </div>
      <div class="hud-center">
        <div class="hud-zone"></div>
        <div class="bar"><div class="fill"></div><span class="pct">0%</span></div>
        <div class="tingle">${ICONS.sparkle}<span></span></div>
      </div>
      <div class="hud-right">
        <div class="hud-gems">${ICONS.gem}<b>0</b></div>
        <div class="hud-crunch">${ICONS.sparkle}<b>0</b></div>
      </div>`;
    this.fill = this.hud.querySelector('.fill')!;
    this.pct = this.hud.querySelector('.pct')!;
    this.zoneLabel = this.hud.querySelector('.hud-zone')!;
    this.gemCount = this.hud.querySelector('.hud-gems b')!;
    this.crunchCount = this.hud.querySelector('.hud-crunch b')!;
    this.tingle = this.hud.querySelector('.tingle')!;
    this.hud.querySelector('.pause-btn')!.addEventListener('click', () => this.h.pause());
  }

  setMap(data: MapData): void {
    this.map = new Minimap(data);
    this.hud.querySelector('.hud-left')!.appendChild(this.map.el);
  }

  drawMap(x: number, z: number, yaw: number, gems: GemDots): void {
    this.map?.draw(x, z, yaw, gems);
  }

  showHUD(gems: number, crunches: number): void {
    this.gemCount.textContent = fmt(gems);
    this.lastPct = -1;
    this.lastZone = '';
    this.setCrunches(crunches);
    this.setTingle(0);
    this.hud.classList.add('on');
  }

  hideHUD(): void {
    this.hud.classList.remove('on');
  }

  /** Current area name and how much of it is crunched right now. */
  setZone(name: string, p: number): void {
    if (name !== this.lastZone) {
      this.lastZone = name;
      this.zoneLabel.textContent = name;
    }
    const pct = Math.floor(p * 100);
    if (pct === this.lastPct) return;
    this.lastPct = pct;
    this.fill.style.transform = `scaleX(${Math.max(0.02, p)})`;
    this.pct.textContent = `${pct}%`;
  }

  setCrunches(n: number): void {
    if (n === this.lastCrunch) return;
    this.lastCrunch = n;
    this.crunchCount.textContent = fmt(n);
  }

  setGems(n: number): void {
    this.gemCount.textContent = fmt(n);
    const g = this.gemCount.parentElement!;
    g.classList.remove('bump');
    void g.offsetWidth;
    g.classList.add('bump');
  }

  setTingle(tier: number): void {
    if (tier <= 0) {
      this.tingle.classList.remove('on');
      return;
    }
    this.tingle.querySelector('span')!.textContent = `${t('tingles')} ×${tier}`;
    this.tingle.classList.remove('on', 'pop');
    void this.tingle.offsetWidth;
    this.tingle.classList.add('on', 'pop');
  }

  /** Big soft title when walking into an area. */
  banner(text: string): void {
    this.bannerEl.textContent = text;
    this.bannerEl.classList.remove('on');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('on'), 2600);
  }

  tutorial(on: boolean): void {
    if (on) this.tut.innerHTML = `<div class="hand">${ICONS.hand}</div><div class="tut-text">${t('dragToMove')}<small>${t('crunchAll')}</small></div>`;
    this.tut.classList.toggle('on', on);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('on');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 1600);
  }

  // ---------- settings / pause ----------
  private toggles(s: SaveData): string {
    const row = (key: ToggleKey, icon: string, label: string) =>
      `<button class="toggle" role="switch" aria-checked="${s[key]}" data-key="${key}">
        <span class="t-ico">${icon}</span><span class="t-label">${label}</span><span class="switch"><i></i></span>
      </button>`;
    return [
      row('music', ICONS.music, t('music')),
      row('ambience', ICONS.leaf, t('ambience')),
      this.canVibrate ? row('haptics', ICONS.vibrate, t('haptics')) : '',
    ].join('');
  }

  private wireToggles(m: HTMLElement): void {
    m.querySelectorAll<HTMLButtonElement>('.toggle').forEach((b) =>
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-checked') !== 'true';
        b.setAttribute('aria-checked', String(on));
        this.h.toggle(b.dataset.key as ToggleKey, on);
      }),
    );
  }

  showSettings(s: SaveData): void {
    this.settingsM.innerHTML = `<div class="card">
      <h2>${t('settings')}</h2>
      <div class="toggles">${this.toggles(s)}</div>
      <button class="btn wide done">${t('done')}</button>
    </div>`;
    this.wireToggles(this.settingsM);
    this.settingsM.querySelector('.done')!.addEventListener('click', () => this.hideSettings());
    this.open(this.settingsM);
  }

  hideSettings(): void {
    this.settingsM.classList.remove('on');
  }

  showPause(s: SaveData): void {
    this.pauseM.innerHTML = `<div class="card">
      <h2>${t('paused')}</h2>
      <div class="toggles">${this.toggles(s)}</div>
      <button class="btn wide resume">${ICONS.play}<span>${t('resume')}</span></button>
      <button class="btn wide soft home">${ICONS.home}<span>${t('home')}</span></button>
    </div>`;
    this.wireToggles(this.pauseM);
    this.pauseM.querySelector('.resume')!.addEventListener('click', () => this.h.resume());
    this.pauseM.querySelector('.home')!.addEventListener('click', () => this.h.home());
    this.open(this.pauseM);
  }

  hidePause(): void {
    this.pauseM.classList.remove('on');
  }

  get pauseOpen(): boolean {
    return this.pauseM.classList.contains('on');
  }

  // ---------- shop ----------
  showShop(s: SaveData): void {
    this.renderShop(s);
    this.shop.classList.add('on');
    this.h.panel();
  }

  renderShop(s: SaveData): void {
    const items =
      this.shopTab === 'colors'
        ? SKINS.map((k) => {
            const owned = s.skins.includes(k.id);
            const eq = s.skin === k.id;
            return `<button class="item ${eq ? 'eq' : ''} ${owned ? 'owned' : ''}" data-skin="${k.id}" aria-label="${k.id}">
              <span class="swatch ${k.pearl ? 'pearl' : ''}" style="--c:${k.color}"></span>
              ${eq ? `<span class="tag ok">${ICONS.check}</span>` : owned ? '' : `<span class="tag price">${ICONS.gem}${k.price}</span>`}
            </button>`;
          })
        : HATS.map((k) => {
            const owned = s.hats.includes(k.id);
            const eq = s.hat === k.id;
            return `<button class="item ${eq ? 'eq' : ''} ${owned ? 'owned' : ''}" data-hat="${k.id}" aria-label="${k.id}">
              <span class="hat">${HAT_ICONS[k.id]}</span>
              ${eq ? `<span class="tag ok">${ICONS.check}</span>` : owned ? '' : `<span class="tag price">${ICONS.gem}${k.price}</span>`}
            </button>`;
          });
    this.shop.innerHTML = `<div class="sheet">
      <div class="sheet-head">
        <div class="tabs">
          <button class="tab ${this.shopTab === 'colors' ? 'on' : ''}" data-tab="colors">${t('colors')}</button>
          <button class="tab ${this.shopTab === 'hats' ? 'on' : ''}" data-tab="hats">${t('hats')}</button>
        </div>
        <span class="chip">${ICONS.gem}<b>${fmt(s.gems)}</b></span>
      </div>
      <div class="grid">${items.join('')}</div>
      <button class="btn wide done">${t('done')}</button>
    </div>`;
    this.shop.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) =>
      b.addEventListener('click', () => {
        this.shopTab = b.dataset.tab as 'colors' | 'hats';
        this.renderShop(s);
      }),
    );
    this.shop.querySelectorAll<HTMLButtonElement>('.item').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.skin) this.h.selectSkin(b.dataset.skin);
        if (b.dataset.hat) this.h.selectHat(b.dataset.hat);
      }),
    );
    this.shop.querySelector('.done')!.addEventListener('click', () => this.h.closeShop());
  }

  shake(id: string): void {
    const b = this.shop.querySelector<HTMLElement>(`[data-skin="${id}"],[data-hat="${id}"]`);
    if (!b) return;
    b.classList.remove('shake');
    void b.offsetWidth;
    b.classList.add('shake');
  }

  hideShop(): void {
    this.shop.classList.remove('on');
  }

  get shopOpen(): boolean {
    return this.shop.classList.contains('on');
  }

  private open(m: HTMLElement): void {
    m.classList.add('on');
    this.h.panel();
    requestAnimationFrame(() => m.querySelector<HTMLElement>('.btn')?.focus({ preventScroll: true }));
  }

  /** Esc support: closes the top-most dialog. Returns true if something was closed. */
  escape(): boolean {
    if (this.settingsM.classList.contains('on')) {
      this.hideSettings();
      return true;
    }
    if (this.shopOpen) {
      this.h.closeShop();
      return true;
    }
    if (this.pauseOpen) {
      this.h.resume();
      return true;
    }
    return false;
  }
}
