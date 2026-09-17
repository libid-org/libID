import { palettes } from '../palette.mjs';

export function getStaticPaths() {
  return Object.entries(palettes).map(([theme, palette]) => ({
    params: { favicon: theme === 'dark' ? 'favicon' : 'favicon-light' },
    props: { palette },
  }));
}

export function GET({ props: { palette } }) {
  return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="${palette.background}"/>
  <path d="M13 18h12m-6 0v28m-6 0h12m9-28h7c15 0 15 28 0 28h-7z" fill="none" stroke="${palette.accent}" stroke-width="4"/>
</svg>`, { headers: { 'Content-Type': 'image/svg+xml' } });
}
