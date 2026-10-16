import { init } from '@plausible-analytics/tracker';

// Keep local development and branch previews out of production analytics.
if (location.hostname === 'lib.id' || location.hostname === 'www.lib.id') {
  init({ domain: 'lib.id', endpoint: '/p/event' });
}
