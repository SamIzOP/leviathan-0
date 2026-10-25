/** Operator weapon preferences, saved per device. ADS sensitivity multiplies the
 * zoom-normalised look scale while aiming down sights. */
export const weaponSettings = { adsSensitivity: 1 };
try {
  const saved = JSON.parse(localStorage.getItem('weaponSettings') ?? '{}');
  if (Number.isFinite(saved.adsSensitivity))
    weaponSettings.adsSensitivity = Math.max(
      0.2,
      Math.min(2, saved.adsSensitivity),
    );
} catch {
  /* defaults */
}
export function saveWeaponSettings() {
  localStorage.setItem('weaponSettings', JSON.stringify(weaponSettings));
}
/** Look scale for an ADS fraction and zoom: 1 at the hip, the zoom-normalised
 * ADS sensitivity when fully aimed. */
export function adsLookScale(ads: number, zoom: number) {
  const aimed = weaponSettings.adsSensitivity / Math.max(1, zoom);
  return 1 + (aimed - 1) * Math.max(0, Math.min(1, ads));
}
export function weaponControls() {
  const l = document.createElement('label');
  l.title =
    'Look sensitivity while aiming down sights, relative to the hip and normalised by zoom.';
  const title = document.createElement('span');
  title.textContent = 'ADS SENSITIVITY';
  const out = document.createElement('output');
  out.textContent = weaponSettings.adsSensitivity.toFixed(2);
  const i = document.createElement('input');
  i.type = 'range';
  i.min = '0.2';
  i.max = '2';
  i.step = '0.05';
  i.value = String(weaponSettings.adsSensitivity);
  i.setAttribute('aria-label', 'ADS sensitivity');
  i.oninput = () => {
    weaponSettings.adsSensitivity = Number(i.value);
    out.textContent = weaponSettings.adsSensitivity.toFixed(2);
    saveWeaponSettings();
  };
  l.append(title, out, i);
  return l;
}
