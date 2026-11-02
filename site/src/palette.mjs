import palette from '../../brand/palette.json' with { type: 'json' };

export const palettes = {
  dark: { ...palette.dark, logo: palette.logo },
  light: { ...palette.light, logo: palette.logo },
};
