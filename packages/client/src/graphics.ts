export type Preset = 'LOW' | 'MEDIUM' | 'HIGH';
export type Quality = Preset | 'AUTO';
export const PRESETS = {
  LOW: { scale: 1, texture: 512, rain: 350, smoke: 36, ao: false },
  MEDIUM: { scale: 1, texture: 1024, rain: 700, smoke: 48, ao: true },
  HIGH: { scale: 1, texture: 2048, rain: 1600, smoke: 108, ao: true },
};
export const graphics = {
  quality: 'AUTO' as Quality,
  grain: 0.018,
  bloom: 0.16,
};
try {
  const saved = JSON.parse(localStorage.getItem('graphics') ?? '{}');
  if (['AUTO', 'LOW', 'MEDIUM', 'HIGH'].includes(saved.quality))
    graphics.quality = saved.quality;
  for (const key of ['grain', 'bloom'] as const)
    if (Number.isFinite(saved[key]))
      graphics[key] = Math.max(0, Math.min(1, saved[key]));
} catch {
  /* defaults */
}
export function saveGraphics() {
  localStorage.setItem('graphics', JSON.stringify(graphics));
  dispatchEvent(new Event('graphicschange'));
}
export function graphicsControls() {
  const section = document.createElement('fieldset'),
    title = document.createElement('legend');
  title.textContent = 'GRAPHICS';
  section.append(title);
  const label = document.createElement('label');
  label.textContent = 'QUALITY';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Graphics quality');
  for (const name of ['AUTO', 'LOW', 'MEDIUM', 'HIGH']) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    select.append(o);
  }
  select.value = graphics.quality;
  select.onchange = () => {
    graphics.quality = select.value as Quality;
    saveGraphics();
  };
  label.append(select);
  section.append(label);
  for (const key of ['grain', 'bloom'] as const) {
    const l = document.createElement('label');
    l.textContent = key.toUpperCase();
    const i = document.createElement('input');
    i.type = 'range';
    i.min = '0';
    i.max = '1';
    i.step = '0.01';
    i.value = String(graphics[key]);
    i.setAttribute('aria-label', key + ' intensity');
    i.oninput = () => {
      graphics[key] = Number(i.value);
      saveGraphics();
    };
    l.append(i);
    section.append(l);
  }
  return section;
}
