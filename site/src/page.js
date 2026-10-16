import { init, track } from '@plausible-analytics/tracker';

// Keep local development and branch previews out of production analytics.
if (location.hostname === 'lib.id' || location.hostname === 'www.lib.id') {
  init({
    domain: 'lib.id',
    endpoint: '/p/event',
    outboundLinks: true,
    fileDownloads: true,
    formSubmissions: true,
  });
  if (document.querySelector('meta[name="page-status"][content="404"]')) {
    track('404', { interactive: false });
  }
}
