export const theme = {
  ink: '#0A0E11',
  'concrete-900': '#11171B',
  'concrete-800': '#192026',
  'concrete-700': '#242E36',
  steel: '#3A4A56',
  mist: '#8A98A1',
  pale: '#D3D9DB',
  'brown-dust': '#4B4137',
  warning: '#C9B458',
};
export const worldPalette = {
  brick: '#53504d',
  concrete: '#646d70',
  asphalt: '#7f898d',
  metal: '#515d64',
  wood: theme['brown-dust'],
  glass: '#26343d',
  rust: '#62564b',
  van: theme.pale,
};
export function applyTheme() {
  for (const [name, value] of Object.entries(theme))
    document.documentElement.style.setProperty(`--${name}`, value);
}
