/* Подставляет контакты из админки во все элементы с data-s="...".
   Если сервер не запущен, на странице остаётся текст, записанный в HTML. */
window.siteSettings = fetch('/api/settings', { cache: 'no-store' })
  .then(function (r) { if (!r.ok) throw 0; return r.json(); })
  .then(function (s) {
    s.req = [s.company, s.inn ? 'ИНН ' + s.inn : ''].filter(Boolean).join(' · ');
    document.querySelectorAll('[data-s]').forEach(function (el) {
      var v = s[el.getAttribute('data-s')];
      if (v) el.textContent = v;
      if (v && el.classList.contains('tbd') && !/X/.test(v)) el.classList.remove('tbd');
    });
    return s;
  })
  .catch(function () { return null; });
