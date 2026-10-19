import { init, track } from '@plausible-analytics/tracker';

// Keep local development and branch previews out of production analytics.
if (location.hostname === 'lib.id' || location.hostname === 'www.lib.id') {
  // Preserve the single-load guard while automatic injection is being switched off.
  window.__cfBeacon = {
    ...window.__cfBeacon,
    token: '055803bbdf4f4d469ac3a3a266484b81',
    send: { to: '/p/measure' },
  };
  const beacon = document.createElement('script');
  beacon.type = 'module';
  beacon.src = '/p/client.js';
  beacon.dataset.cfBeacon = JSON.stringify(window.__cfBeacon);
  document.head.append(beacon);

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
