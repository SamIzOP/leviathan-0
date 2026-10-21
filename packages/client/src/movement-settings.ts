/** Operator movement preferences: input modes and camera-effect intensities.
 * Saved per device; none of these touch the authoritative simulation. */
export interface MovementSettings {
  crouchMode: 'HOLD' | 'TOGGLE';
  sprintMode: 'HOLD' | 'AUTO';
  ctrlCrouch: boolean;
  fov: number;
  roll: number;
  bob: number;
  fovKick: number;
  reduceMotion: boolean;
  speedometer: boolean;
}
const DEFAULTS: MovementSettings = {
  crouchMode: 'HOLD',
  sprintMode: 'HOLD',
  ctrlCrouch: false,
  fov: 95,
  roll: 100,
  bob: 100,
  fovKick: 100,
  reduceMotion: false,
  speedometer: false,
};
export const movementSettings: MovementSettings = { ...DEFAULTS };
try {
  const saved = JSON.parse(localStorage.getItem('movementSettings') ?? '{}');
  if (saved.crouchMode === 'TOGGLE') movementSettings.crouchMode = 'TOGGLE';
  if (saved.sprintMode === 'AUTO') movementSettings.sprintMode = 'AUTO';
  for (const key of ['ctrlCrouch', 'reduceMotion', 'speedometer'] as const)
    if (typeof saved[key] === 'boolean') movementSettings[key] = saved[key];
  if (Number.isFinite(saved.fov))
    movementSettings.fov = Math.max(80, Math.min(110, saved.fov));
  for (const key of ['roll', 'bob', 'fovKick'] as const)
    if (Number.isFinite(saved[key]))
      movementSettings[key] = Math.max(0, Math.min(100, saved[key]));
} catch {
  /* defaults */
}
export function saveMovementSettings() {
  localStorage.setItem('movementSettings', JSON.stringify(movementSettings));
  dispatchEvent(new Event('movementsettingschange'));
}
/** Effective 0–1 scale for one camera effect. REDUCE MOTION keeps only a minimal trace. */
export function effect(kind: 'roll' | 'bob' | 'fovKick' | 'dip' | 'pull') {
  const s = movementSettings;
  if (kind === 'dip' || kind === 'pull') return s.reduceMotion ? 0.2 : 1;
  return s.reduceMotion ? 0 : s[kind] / 100;
}
export function movementControls() {
  const section = document.createElement('fieldset'),
    title = document.createElement('legend');
  title.textContent = 'MOVEMENT / CAMERA';
  section.append(title);
  const select = <K extends 'crouchMode' | 'sprintMode'>(
    key: K,
    label: string,
    options: MovementSettings[K][],
    hint: string,
  ) => {
    const l = document.createElement('label');
    l.textContent = label;
    l.title = hint;
    const s = document.createElement('select');
    s.setAttribute('aria-label', label.toLowerCase());
    for (const value of options) {
      const o = document.createElement('option');
      o.value = o.textContent = value;
      s.append(o);
    }
    s.value = movementSettings[key];
    s.onchange = () => {
      movementSettings[key] = s.value as MovementSettings[K];
      saveMovementSettings();
    };
    l.append(s);
    section.append(l);
  };
  select(
    'crouchMode',
    'CROUCH MODE',
    ['HOLD', 'TOGGLE'],
    'Hold C, or press C to toggle crouch.',
  );
  select(
    'sprintMode',
    'SPRINT MODE',
    ['HOLD', 'AUTO'],
    'Hold Shift to sprint, or sprint automatically (Shift then walks).',
  );
  const range = (
    key: 'fov' | 'roll' | 'bob' | 'fovKick',
    label: string,
    min: number,
    max: number,
    hint: string,
  ) => {
    const l = document.createElement('label');
    l.title = hint;
    const text = document.createElement('span');
    text.textContent = label;
    const out = document.createElement('output');
    out.textContent = String(movementSettings[key]);
    const i = document.createElement('input');
    i.type = 'range';
    i.min = String(min);
    i.max = String(max);
    i.step = '1';
    i.value = String(movementSettings[key]);
    i.setAttribute('aria-label', label.toLowerCase());
    i.oninput = () => {
      movementSettings[key] = Number(i.value);
      out.textContent = i.value;
      saveMovementSettings();
    };
    l.append(text, out, i);
    section.append(l);
  };
  range(
    'fov',
    'FIELD OF VIEW',
    80,
    110,
    'Horizontal-feel field of view in degrees.',
  );
  range(
    'roll',
    'CAMERA ROLL / %',
    0,
    100,
    'Roll away from the wall during a wall-run.',
  );
  range(
    'bob',
    'HEAD BOB / %',
    0,
    100,
    'Light head bob while walking and sprinting.',
  );
  range(
    'fovKick',
    'FOV SPEED KICK / %',
    0,
    100,
    'Field of view widening with speed.',
  );
  const toggle = (
    key: 'reduceMotion' | 'speedometer' | 'ctrlCrouch',
    label: string,
    hint: string,
  ) => {
    const l = document.createElement('label');
    l.className = 'toggle';
    l.title = hint;
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = movementSettings[key];
    i.setAttribute('aria-label', label.toLowerCase());
    i.onchange = () => {
      movementSettings[key] = i.checked;
      saveMovementSettings();
    };
    l.append(i, document.createTextNode(label));
    section.append(l);
  };
  toggle(
    'reduceMotion',
    'REDUCE MOTION',
    'Removes roll, bob and FOV kick; keeps only a minimal landing dip.',
  );
  toggle(
    'speedometer',
    'SPEEDOMETER (M/S)',
    'Show horizontal speed on the HUD.',
  );
  toggle(
    'ctrlCrouch',
    'LEFT CTRL ALSO CROUCHES',
    'Risk: Ctrl+W closes the browser tab. With this on, mouse capture also enters fullscreen and requests keyboard lock where the browser supports it.',
  );
  const risk = document.createElement('small');
  risk.className = 'settings-note';
  risk.textContent =
    'CTRL RISK // CTRL+W CLOSES THE TAB. FULLSCREEN KEYBOARD LOCK PROTECTS IT WHERE SUPPORTED. C IS THE SAFE DEFAULT.';
  section.append(risk);
  return section;
}
