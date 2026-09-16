import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

export const onRequest = defineRouteMiddleware(({ locals, url }) => {
  const route = locals.starlightRoute;
  const section = url.pathname.startsWith('/specs/') ? 'Specs' : 'Docs';
  const prefix = `/${section.toLowerCase()}/`;
  const group = route.sidebar.find((item) => item.type === 'group' && item.label === section);
  route.sidebar = group?.type === 'group' ? group.entries : [];
  route.siteTitle = `libID ${section}`;
  route.siteTitleHref = prefix;
  for (const direction of ['prev', 'next'] as const) {
    if (!route.pagination[direction]?.href.startsWith(prefix)) {
      route.pagination[direction] = undefined;
    }
  }
});
