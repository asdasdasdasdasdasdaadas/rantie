/* Статистика для админки: заходы и нажатия. Без cookies, без IP и без сторонних сервисов.
   Работает, когда сайт запущен через server.py. На GitHub Pages просто молчит. */
(function () {
  if (/github\.io$/.test(location.hostname) || location.protocol === 'file:') { window.rsTrack = function () {}; return; }
  function rid() { var a = '', c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 16; i++) a += c[Math.floor(Math.random() * c.length)]; return a; }
  function keep(store, k) { try { var v = store.getItem(k); if (!v) { v = rid(); store.setItem(k, v); } return v; } catch (e) { return rid(); } }
  var vid = keep(window.localStorage, 'rs_vid'), sid = keep(window.sessionStorage, 'rs_sid');
  var page = { '/': 'Главная', '/index.html': 'Главная', '/listings.html': 'Объекты', '/dogovor.html': 'Договор' }[location.pathname.replace(/^.*\/(?=[^/]*$)/, '/')] || location.pathname;
  var q = new URLSearchParams(location.search), utm = q.get('utm_source') || '';
  var SEC = { top: 'Первый экран', services: 'Услуги', other: 'Не только ПВЗ', check: 'Проверка', sale: 'Продажа', why: 'Вопросы', prices: 'Цены', how: 'Как работаю', contacts: 'Контакты' };

  function send(ev, label, sec) {
    var body = JSON.stringify({ ev: ev, vid: vid, sid: sid, page: page, label: label || '', sec: sec || '', ref: document.referrer && document.referrer.indexOf(location.host) < 0 ? document.referrer : '', utm: utm });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) return;
    } catch (e) {}
    try { fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {}); } catch (e) {}
  }
  window.rsTrack = send;

  send('view');

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('a, button, summary');
    if (!el || el.closest('[data-notrack]') || el.matches('.obj')) return;
    var label = (el.dataset.copy && 'Копировать: ' + ({ 'c-tg': 'Telegram', 'c-ph': 'телефон', 'c-em': 'почту' }[el.dataset.copy] || '')) || el.getAttribute('data-ev') || el.getAttribute('aria-label') || (el.querySelector('b') && el.matches('.srow') ? el.querySelector('b').textContent : el.textContent);
    label = String(label || '').replace(/\s+/g, ' ').replace(/[→↗+]/g, '').trim().slice(0, 60);
    var href = el.getAttribute('href') || '';
    if (/^tel:/.test(href)) label = 'Позвонить';
    else if (/t\.me\//.test(href)) label = 'Telegram';
    else if (/^mailto:/.test(href)) label = 'Почта';
    if (!label) return;
    var s = el.closest('section, header, footer, nav, dialog'), id = s ? (s.id || s.tagName.toLowerCase()) : '';
    var sec = SEC[id] || { nav: 'Меню', header: 'Меню', footer: 'Подвал', dialog: 'Карточка объекта', section: 'Факты' }[id] || id || (page === 'Главная' ? 'Первый экран' : '');
    send('click', label, sec);
  }, true);
})();
