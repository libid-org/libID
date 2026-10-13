import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import { unified } from '@astrojs/markdown-remark';
import specMarkdown from './src/spec-markdown.mjs';

export default defineConfig({
  site: 'https://lib.id',
  markdown: { processor: unified({ remarkPlugins: [specMarkdown] }) },
  integrations: [
    mermaid({
      theme: 'base',
      autoTheme: false,
      mermaidConfig: {
        fontFamily: "'JetBrains Mono', monospace",
        themeVariables: { fontFamily: "'JetBrains Mono', monospace", fontSize: '14px' },
        flowchart: { curve: 'basis', padding: 12, nodeSpacing: 40, rankSpacing: 44 },
        sequence: { mirrorActors: false, actorMargin: 40, messageMargin: 32 },
      },
    }),
    starlight({
      title: 'libID',
      description: 'Every social account is already a multichain identity.',
      favicon: '/favicon.svg',
      customCss: ['./src/styles/custom.css'],
      routeMiddleware: './src/route-data.ts',
      sidebar: [
        {
          label: 'Docs',
          items: [
            { label: 'Introduction', slug: 'docs' },
            ...[
              ['Get started', 'get-started'],
              ['Concepts', 'concepts'],
              ['Guides', 'guides'],
              ['ENS', 'ens'],
              ['Examples', 'examples'],
              ['Reference', 'reference'],
              ['Networks', 'networks'],
              ['Resources', 'resources'],
              ['Advanced', 'advanced'],
            ].map(([label, dir]) => ({ label, items: [{ autogenerate: { directory: `docs/${dir}` } }] })),
          ],
        },
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
