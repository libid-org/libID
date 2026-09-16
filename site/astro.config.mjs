import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import specMarkdown from './src/spec-markdown.mjs';

export default defineConfig({
  site: 'https://lib.id',
  markdown: { processor: unified({ remarkPlugins: [specMarkdown] }) },
  integrations: [
    starlight({
      title: 'libID Docs',
      description: 'Every social account is already a multichain identity.',
      favicon: '/favicon.svg',
      customCss: ['./src/styles/custom.css'],
      routeMiddleware: './src/route-data.ts',
      sidebar: [
        { label: 'Docs', items: [{ autogenerate: { directory: 'docs' } }] },
        { label: 'Specs', items: [{ autogenerate: { directory: 'specs' } }] },
      ],
      components: {
        Sidebar: './src/components/Sidebar.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/libid-org/libid' }],
    }),
  ],
});
