import * as THREE from 'three';
import {
  COMBAT,
  FINGERS,
  OIL,
  STATUS,
  type CombatRules,
  type Entity,
  type Vec3,
} from '@leviathan/shared';
import './combat.css';
const SVG = 'http://www.w3.org/2000/svg';
export interface HudFrame {
  now: number;
  playing: boolean;
  camera: THREE.PerspectiveCamera;
  local?: Entity;
  authoritative?: Entity;
  rules: CombatRules;
  ads: number;
  scoped: boolean;
}
interface Number_ {
  el: HTMLSpanElement;
  x: number;
  y: number;
  z: number;
  t0: number;
  amount: number;
  target: string;
  active: boolean;
}
interface Indicator {
  el: SVGSVGElement;
  x: number;
  z: number;
  t0: number;
  strength: number;
  active: boolean;
}
interface FeedRow {
  el: HTMLLIElement;
  attacker: HTMLElement;
  weapon: HTMLElement;
  victim: HTMLElement;
  t0: number;
  active: boolean;
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text = '',
  parent?: HTMLElement,
) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  parent?.append(n);
  return n;
}
/** Combat HUD: one DOM tree built once; frames only touch text, attributes and
 * transforms (each write skipped when unchanged). */
export class CombatHud {
  root = el('div', 'combat-hud');
  private cross: HTMLElement;
  private marker: HTMLElement;
  private elim: HTMLElement;
  private edge: HTMLElement;
  private scope: HTMLElement;
  private death: HTMLElement;
  private deathCount: HTMLElement;
  private deathBy: HTMLElement;
  private toastEl: HTMLElement;
  private mag: HTMLElement;
  private reserve: HTMLElement;
  private name: HTMLElement;
  private tier: HTMLElement;
  private role: HTMLElement;
  private hint: HTMLElement;
  private reloadBar: HTMLElement;
  private reloadWrap: HTMLElement;
  private slots: HTMLElement[] = [];
  private oil: HTMLElement;
  private oilPips: HTMLElement[] = [];
  private fingers: HTMLElement;
  private fingersBar: HTMLElement;
  private fingersText: HTMLElement;
  private hp: HTMLElement;
  private hpBar: HTMLElement;
  private vitals: HTMLElement;
  private statusText: HTMLElement;
  private numbers: Number_[] = [];
  private indicators: Indicator[] = [];
  private feed: FeedRow[] = [];
  private feedOrder = 0;
  private cache = new Map<object, string>();
  private gap = -1;
  private segment = 1;
  private lastReload = 0;
  private wasDead = false;
  private deathAt = 0;
  private v = new THREE.Vector3();
  nodes = 0;
  constructor() {
    const r = this.root;
    r.hidden = true;
    r.setAttribute('aria-hidden', 'true');
    this.edge = el('div', 'ch-edge', '', r);
    el('div', 'ch-burn', '', r);
    this.scope = el('div', 'ch-scope', '', r);
    el('i', '', '', this.scope);
    this.cross = el('div', 'ch-cross', '', r);
    for (const k of ['t', 'b', 'l', 'r', 'dot']) el('i', k, '', this.cross);
    this.marker = el('div', 'ch-marker', '', r);
    for (const k of ['a', 'b', 'c', 'd']) el('i', k, '', this.marker);
    this.elim = el('div', 'ch-elim', 'ELIMINATED', r);
    const dirs = el('div', 'ch-dirs', '', r);
    for (let i = 0; i < 8; i++) {
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', '-100 -100 200 200');
      svg.setAttribute('class', 'ch-dir');
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', 'M -40 -86 A 95 95 0 0 1 40 -86');
      const tip = document.createElementNS(SVG, 'path');
      tip.setAttribute('d', 'M -9 -76 L 0 -66 L 9 -76');
      tip.setAttribute('class', 'tip');
      svg.append(path, tip);
      dirs.append(svg);
      this.indicators.push({
        el: svg,
        x: 0,
        z: 0,
        t0: 0,
        strength: 0,
        active: false,
      });
    }
    const numbers = el('div', 'ch-numbers', '', r);
    for (let i = 0; i < 24; i++)
      this.numbers.push({
        el: Object.assign(el('span', 'ch-num', '', numbers), { hidden: true }),
        x: 0,
        y: 0,
        z: 0,
        t0: 0,
        amount: 0,
        target: '',
        active: false,
      });
    const feed = el('ol', 'ch-feed', '', r);
    for (let i = 0; i < 5; i++) {
      const li = el('li', '', '', feed);
      li.hidden = true;
      this.feed.push({
        el: li,
        attacker: el('b', 'a', '', li),
        weapon: el('span', 'w', '', li),
        victim: el('b', 'v', '', li),
        t0: 0,
        active: false,
      });
    }
    // Vitals (bottom-left).
    this.vitals = el('section', 'ch-vitals', '', r);
    el('div', 'ch-label', 'VITALS // OPERATOR', this.vitals);
    const hpRow = el('div', 'ch-hp', '', this.vitals);
    this.hp = el('span', 'ch-hp-num', '100', hpRow);
    const bar = el('div', 'ch-bar', '', hpRow);
    this.hpBar = el('i', '', '', bar);
    this.statusText = el('div', 'ch-status', '', this.vitals);
    // Weapon (bottom-right).
    const weapon = el('section', 'ch-weapon', '', r);
    const head = el('div', 'ch-name', '', weapon);
    this.name = el('span', '', '', head);
    this.tier = el('small', '', '', head);
    this.role = el('div', 'ch-role', '', weapon);
    const ammo = el('div', 'ch-ammo', '', weapon);
    this.mag = el('span', 'ch-mag', '', ammo);
    this.reserve = el('span', 'ch-res', '', ammo);
    this.hint = el('span', 'ch-hint', '', ammo);
    this.reloadWrap = el('div', 'ch-reload', '', weapon);
    this.reloadBar = el('i', '', '', this.reloadWrap);
    const slots = el('ol', 'ch-slots', '', weapon);
    for (let i = 0; i < 5; i++)
      this.slots.push(el('li', '', String(i + 1), slots));
    const kit = el('div', 'ch-kit', '', weapon);
    this.oil = el('div', 'ch-oil', '', kit);
    el('kbd', '', 'G', this.oil);
    el('span', '', 'OIL', this.oil);
    const pips = el('span', 'ch-pips', '', this.oil);
    for (let i = 0; i < OIL.flaskMax; i++)
      this.oilPips.push(el('i', '', '', pips));
    this.fingers = el('div', 'ch-fingers', '', kit);
    el('kbd', '', 'Q', this.fingers);
    el('span', '', 'FINGERS OF GOD', this.fingers);
    const meter = el('div', 'ch-meter', '', this.fingers);
    this.fingersBar = el('i', '', '', meter);
    this.fingersText = el('b', '', '0%', this.fingers);
    this.toastEl = el('div', 'ch-toast', '+AMMO', r);
    this.death = el('div', 'ch-death', '', r);
    const slab = el('div', 'ch-death-slab', '', this.death);
    el('div', 'eyebrow', 'KAINOS // OPERATOR TELEMETRY', slab);
    el('h2', '', 'SIGNAL LOST', slab);
    const line = el('p', '', '', slab);
    el('span', '', 'RESPAWNING // ', line);
    this.deathCount = el('b', 'ch-count', '3.0', line);
    this.deathBy = el('small', 'ch-by', '', slab);
    document.body.append(r);
    this.nodes = r.getElementsByTagName('*').length + 1;
  }
  private text(node: HTMLElement, value: string) {
    if (this.cache.get(node) === value) return;
    this.cache.set(node, value);
    node.textContent = value;
  }
  private attr(node: Element, name: string, value: string) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  private style(
    node: HTMLElement | SVGElement,
    prop: 'transform' | 'opacity',
    value: string,
  ) {
    if (node.style[prop] !== value) node.style[prop] = value;
  }
  private restart(node: HTMLElement, cls: string) {
    node.classList.remove('show', 'body', 'head', 'kill');
    void node.offsetWidth;
    node.classList.add('show', cls);
  }
  // --- Events --------------------------------------------------------------------
  hitMarker(kind: 'body' | 'head' | 'kill') {
    this.restart(this.marker, kind);
    if (kind === 'kill') this.restart(this.elim, 'kill');
  }
  damageNumber(
    now: number,
    at: Vec3,
    amount: number,
    target: string,
    head: boolean,
    kill: boolean,
  ) {
    let n = this.numbers.find(
      (x) => x.active && x.target === target && now - x.t0 < 350,
    );
    if (n) n.amount += amount;
    else {
      n =
        this.numbers.find((x) => !x.active) ??
        this.numbers.reduce((a, b) => (a.t0 < b.t0 ? a : b));
      n.amount = amount;
      n.x = at.x + (Math.random() - 0.5) * 0.25;
      n.y = at.y + 0.15;
      n.z = at.z + (Math.random() - 0.5) * 0.25;
      n.target = target;
    }
    n.t0 = now;
    n.active = true;
    n.el.textContent = String(Math.max(1, Math.round(n.amount)));
    n.el.dataset.kind = kill ? 'kill' : head ? 'head' : 'body';
    n.el.hidden = false;
  }
  damageTaken(now: number, from: Vec3, amount: number, heavy: boolean) {
    const d =
      this.indicators.find((x) => !x.active) ??
      this.indicators.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    d.x = from.x;
    d.z = from.z;
    d.t0 = now;
    d.strength = Math.min(1, 0.45 + amount / 40);
    d.active = true;
    d.el.style.display = 'block';
    if (heavy)
      this.edge.animate([{ opacity: 0.95 }, { opacity: 0 }], {
        duration: 650,
        easing: 'ease-out',
      });
  }
  killFeed(
    now: number,
    attacker: string,
    weapon: string,
    victim: string,
    localAttacker: boolean,
    localVictim: boolean,
  ) {
    const row =
      this.feed.find((x) => !x.active) ??
      this.feed.reduce((a, b) => (a.t0 < b.t0 ? a : b));
    row.attacker.textContent = attacker;
    row.attacker.hidden = !attacker;
    row.weapon.textContent = `[${weapon}]`;
    row.victim.textContent = victim;
    row.attacker.classList.toggle('me', localAttacker);
    row.victim.classList.toggle('me', localVictim);
    row.el.style.order = String(-++this.feedOrder);
    row.el.style.opacity = '1';
    row.el.hidden = false;
    row.t0 = now;
    row.active = true;
  }
  killedBy(text: string) {
    this.deathBy.textContent = text;
  }
  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)', offset: 0.15 },
        { opacity: 1, transform: 'translateY(0)', offset: 0.75 },
        { opacity: 0, transform: 'translateY(-6px)' },
      ],
      { duration: 1500, easing: 'linear' },
    );
  }
  // --- Frame ---------------------------------------------------------------------
  update(f: HudFrame) {
    const visible = f.playing && !!f.local;
    if (this.root.hidden === visible) {
      this.root.hidden = !visible;
      document.body.classList.toggle('combat-hud-on', visible);
    }
    if (!visible || !f.local) return;
    const c = f.local.combat,
      a = f.authoritative ?? f.local,
      now = f.now;
    const status = a.status ?? 0,
      dead = !!(status & STATUS.dead);
    this.root.classList.toggle('burning', !!(status & STATUS.burning) && !dead);
    this.root.classList.toggle('dead', dead);
    this.root.classList.toggle('scoped', f.scoped && !dead);
    // Vitals.
    const health = Math.max(0, Math.round(a.health));
    this.text(this.hp, String(health));
    this.style(
      this.hpBar,
      'transform',
      `scaleX(${(health / COMBAT.maxHealth).toFixed(3)})`,
    );
    this.attr(this.vitals, 'data-low', health <= 30 ? '1' : '0');
    this.text(
      this.statusText,
      [
        status & STATUS.burning ? 'BURNING' : '',
        status & STATUS.oiled ? 'OIL-COATED' : '',
      ]
        .filter(Boolean)
        .join(' · '),
    );
    // Death overlay.
    if (dead && !this.wasDead) this.deathAt = now;
    if (!dead && this.wasDead) this.deathBy.textContent = '';
    this.wasDead = dead;
    if (dead) {
      const left = Math.max(
        0,
        COMBAT.respawnSeconds - (now - this.deathAt) / 1000,
      );
      this.text(this.deathCount, `${left.toFixed(1)} S`);
    }
    if (!c) return;
    const w = f.rules.table[c.slot]!,
      ammo = c.ammo[c.slot] ?? { mag: 0, reserve: 0 };
    // Weapon panel.
    this.text(this.name, w.name);
    this.text(this.tier, `T${w.tier}`);
    this.text(this.role, w.role.toUpperCase());
    this.text(this.mag, String(ammo.mag));
    this.text(this.reserve, f.rules.infiniteAmmo ? '/ ∞' : `/ ${ammo.reserve}`);
    const empty = ammo.mag === 0;
    this.text(
      this.hint,
      c.reload > 0
        ? 'RELOADING'
        : empty
          ? ammo.reserve > 0 || f.rules.infiniteAmmo
            ? 'R // RELOAD'
            : 'NO AMMO'
          : '',
    );
    this.attr(
      this.mag,
      'data-low',
      empty ? '2' : ammo.mag <= Math.ceil(w.magazine * 0.25) ? '1' : '0',
    );
    if (c.reload > this.lastReload) this.segment = c.reload;
    this.lastReload = c.reload;
    let progress = -1;
    if (c.reload > 0) {
      const seg = 1 - c.reload / Math.max(1, this.segment);
      progress =
        w.reloadPerRound > 0 ? Math.min(1, (ammo.mag + seg) / w.magazine) : seg;
    }
    this.attr(this.reloadWrap, 'data-on', progress >= 0 ? '1' : '0');
    if (progress >= 0)
      this.style(this.reloadBar, 'transform', `scaleX(${progress.toFixed(3)})`);
    for (let i = 0; i < this.slots.length; i++)
      this.attr(
        this.slots[i]!,
        'data-state',
        i === c.slot ? 'current' : c.owned & (1 << i) ? 'owned' : 'locked',
      );
    for (let i = 0; i < this.oilPips.length; i++)
      this.attr(this.oilPips[i]!, 'data-on', i < c.oil ? '1' : '0');
    this.attr(this.oil, 'data-empty', c.oil > 0 ? '0' : '1');
    const charge = Math.min(1, c.fingers / FINGERS.charge);
    const ready = charge >= 1;
    this.style(this.fingersBar, 'transform', `scaleX(${charge.toFixed(3)})`);
    this.text(
      this.fingersText,
      ready ? 'READY' : `${Math.floor(charge * 100)}%`,
    );
    this.attr(this.fingers, 'data-ready', ready ? '1' : '0');
    // Crosshair: the gap follows the simulated cone (hip/ADS, bloom, movement).
    const ads = f.ads;
    const hs = Math.hypot(f.local.velocity.x, f.local.velocity.z);
    const moving = Math.min(
      1,
      Math.min(1, hs / 8) + (f.local.move?.mode === 'AIR' ? 0.5 : 0),
    );
    const spread =
      w.spreadHip +
      (w.spreadAds - w.spreadHip) * ads +
      c.bloom +
      w.spreadMove * moving;
    const half = Math.tan((f.camera.fov * Math.PI) / 360);
    const gap = Math.max(
      3,
      (Math.tan((spread * Math.PI) / 180) / half) * (innerHeight / 2),
    );
    if (Math.abs(gap - this.gap) > 0.3) {
      this.gap = gap;
      this.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    }
    const crossOpacity =
      dead || f.scoped ? 0 : c.lowered || c.draw > 0 ? 0.35 : 1;
    this.style(this.cross, 'opacity', String(crossOpacity));
    this.attr(this.cross, 'data-ads', ads > 0.6 ? '1' : '0');
    // Floating damage numbers.
    const W = innerWidth,
      H = innerHeight;
    for (const n of this.numbers) {
      if (!n.active) continue;
      const age = (now - n.t0) / 1000;
      if (age > 0.95) {
        n.active = false;
        n.el.hidden = true;
        continue;
      }
      this.v.set(n.x, n.y + age * 0.7, n.z).project(f.camera);
      if (this.v.z > 1 || this.v.z < -1) {
        this.style(n.el, 'opacity', '0');
        continue;
      }
      const x = ((this.v.x + 1) / 2) * W,
        y = ((1 - this.v.y) / 2) * H;
      const pop = age < 0.08 ? 1.25 - age * 3 : 1;
      this.style(
        n.el,
        'transform',
        `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${pop.toFixed(2)})`,
      );
      this.style(
        n.el,
        'opacity',
        String(Math.min(1, (0.95 - age) / 0.3).toFixed(2)),
      );
    }
    // Damage direction arcs, relative to the camera heading.
    const yaw = f.local.yaw,
      cx = f.camera.position.x,
      cz = f.camera.position.z;
    for (const d of this.indicators) {
      if (!d.active) continue;
      const age = (now - d.t0) / 1000;
      if (age > 1.2) {
        d.active = false;
        d.el.style.display = 'none';
        continue;
      }
      const toward = Math.atan2(-(d.x - cx), -(d.z - cz));
      const rel = toward - yaw;
      this.style(
        d.el,
        'transform',
        `translate(-50%,-50%) rotate(${((-rel * 180) / Math.PI).toFixed(1)}deg)`,
      );
      this.style(d.el, 'opacity', (d.strength * (1 - age / 1.2)).toFixed(2));
    }
    // Kill feed fade.
    for (const row of this.feed) {
      if (!row.active) continue;
      const age = now - row.t0;
      if (age > 6000) {
        row.active = false;
        row.el.hidden = true;
      } else if (age > 5000)
        row.el.style.opacity = ((6000 - age) / 1000).toFixed(2);
    }
  }
  reset() {
    for (const n of this.numbers) {
      n.active = false;
      n.el.hidden = true;
    }
    for (const d of this.indicators) {
      d.active = false;
      d.el.style.display = 'none';
    }
    for (const row of this.feed) {
      row.active = false;
      row.el.hidden = true;
    }
    this.wasDead = false;
    this.deathBy.textContent = '';
    this.root.classList.remove('burning', 'dead', 'scoped');
    this.marker.classList.remove('show');
    this.elim.classList.remove('show');
  }
  active() {
    return {
      numbers: this.numbers.filter((n) => n.active).length,
      indicators: this.indicators.filter((n) => n.active).length,
      feed: this.feed.filter((n) => n.active).length,
    };
  }
}
