(function () {
  var GA4 = 'G-PWTEST0001';
  var ADS = '000000001';
  var SID = '1730000000';
  var query = new URLSearchParams(location.search);
  // The page that links to the offsite checkout keeps its own client ID.
  var rotated = query.get('cid') === 'rotate' && query.get('checkout') !== 'offsite';
  var CID = rotated ? '5555555555.6666666666' : '3333333333.4444444444';

  window.dataLayer = window.dataLayer || [];

  function consentParams() {
    var choice = window.pwConsent && window.pwConsent.choice();
    var granted = choice === 'accept' ? '1' : '0';
    var letter = choice === 'accept' ? 'r' : choice === 'reject' ? 'q' : 'p';
    return '&gcs=G1' + granted + granted + '&gcd=13' + letter + '3' + letter + '3' + letter + '3' + letter + '5';
  }

  function send(url) {
    new Image().src = url;
  }

  function sendGa4(name, params) {
    var url = 'https://www.google-analytics.com/g/collect?v=2&tid=' + GA4 + '&cid=' + CID + '&sid=' + SID + '&en=' + encodeURIComponent(name) + '&dl=' + encodeURIComponent(location.href);
    var ecommerce = (params && params.ecommerce) || {};
    if (ecommerce.transaction_id) url += '&ep.transaction_id=' + encodeURIComponent(ecommerce.transaction_id);
    if (ecommerce.value !== undefined) url += '&epn.value=' + encodeURIComponent(ecommerce.value);
    if (ecommerce.currency) url += '&cu=' + encodeURIComponent(ecommerce.currency);
    send(url + consentParams());
  }

  function sendConversion(ecommerce) {
    send(
      'https://www.googleadservices.com/pagead/conversion/' + ADS + '/?label=fake-label&value=' + encodeURIComponent(ecommerce.value) +
        '&currency_code=' + encodeURIComponent(ecommerce.currency) + '&oid=' + encodeURIComponent(ecommerce.transaction_id) +
        '&url=' + encodeURIComponent(location.href) + consentParams(),
    );
  }

  var push = window.dataLayer.push;
  window.dataLayer.push = function (item) {
    var result = push.apply(window.dataLayer, arguments);
    if (item && item[0] === 'event' && typeof item[1] === 'string') {
      var params = item[2];
      sendGa4(item[1], params);
      if (item[1] === 'purchase' && params && params.ecommerce) sendConversion(params.ecommerce);
    }
    return result;
  };

  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  window.gtag('event', 'page_view', { page_location: location.href });

  document.addEventListener('DOMContentLoaded', function () {
    var link = document.getElementById('to-checkout');
    if (link && query.get('checkout') === 'offsite') {
      link.href = location.protocol + '//127.0.0.1:' + location.port + '/plain/checkout' + (query.get('cid') === 'rotate' ? '?cid=rotate' : '');
    }
    var form = document.getElementById('identity-form');
    if (form && rotated) {
      var hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'cid';
      hidden.value = 'rotate';
      form.appendChild(hidden);
    }
  });

  var early = query.get('identity') === 'early';
  var identified = false;
  function pushIdentity() {
    var field = document.getElementById('email');
    if (identified || !field || !field.value) return;
    if (!early && !(window.pwConsent && window.pwConsent.choice() === 'accept')) return;
    identified = true;
    window.dataLayer.push({ event: 'identify', user: { email: field.value } });
  }
  function identifyWhenAllowed() {
    if (early || (window.pwConsent && window.pwConsent.choice() === 'accept')) pushIdentity();
    else window.pwConsent.onAnswer(pushIdentity);
  }
  document.addEventListener('DOMContentLoaded', function () {
    var field = document.getElementById('email');
    if (!field) return;
    field.addEventListener('change', identifyWhenAllowed);
    field.addEventListener('blur', identifyWhenAllowed);
  });

  function pushReady(name) {
    return function () {
      window.dataLayer.push({ event: name });
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pushReady('gtm.dom'));
  else pushReady('gtm.dom')();
  if (document.readyState === 'complete') pushReady('gtm.load')();
  else window.addEventListener('load', pushReady('gtm.load'));
})();
