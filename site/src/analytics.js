// Keep local development and branch previews out of production analytics.
if (location.hostname === 'lib.id' || location.hostname === 'www.lib.id') {
  const script = document.createElement('script');
  script.async = true;
  script.dataset.domain = 'lib.id';
  script.src = 'https://plausible.io/js/script.js';
  document.head.appendChild(script);
}
