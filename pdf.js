/* PDF-презентация объекта. Вызов: objectPdf(o) — скачивает файл.
   Контакты в PDF меняются здесь: */
var PDF_CONTACT = {
  name: 'Кирилл Горин',
  role: 'Агент собственников коммерческих помещений',
  tg: '@username',
  phone: '+7 900 000-00-00',
  site: ''
};

(function () {
  var LIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/';
  var INK = '#111113', MUTED = '#6B6B72', TINT = '#F4F4F5', LINE = '#E6E6E9', WB = '#8B1FC2', OZ = '#1F5BFF';
  var W = 523; // ширина контента A4 при полях 36pt
  var loading;

  function script(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { no(new Error('Не удалось загрузить ' + src)); };
      document.head.appendChild(s);
    });
  }
  function lib() {
    if (window.pdfMake && window.pdfMake.vfs) return Promise.resolve();
    return loading || (loading = script(LIB + 'pdfmake.min.js').then(function () { return script(LIB + 'vfs_fonts.js'); }));
  }

  /* ---------- рисование на canvas ---------- */
  var S = 3; // плотность: 3 пикселя на пункт PDF
  function cnv(w, h) { var c = document.createElement('canvas'); c.width = Math.round(w * S); c.height = Math.round(h * S); var x = c.getContext('2d'); x.scale(S, S); return [c, x]; }
  function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  function font(wt, size) { return wt + ' ' + size + 'px Onest, "Helvetica Neue", Arial, sans-serif'; }

  function loadImg(url) {
    return new Promise(function (ok) {
      if (!url) return ok(null);
      var i = new Image(); i.crossOrigin = 'anonymous';
      i.onload = function () { ok(i); }; i.onerror = function () { ok(null); };
      i.src = url;
    });
  }
  function house(x, cx, cy, s) {
    x.save(); x.translate(cx - s / 2, cy - s / 2); x.scale(s / 24, s / 24);
    x.strokeStyle = '#B4B4BA'; x.lineWidth = 1.4; x.lineJoin = 'round'; x.lineCap = 'round';
    x.beginPath(); x.moveTo(3, 10.5); x.lineTo(12, 4); x.lineTo(21, 10.5); x.lineTo(21, 20); x.lineTo(15, 21); x.lineTo(15, 15); x.lineTo(9, 15); x.lineTo(9, 21); x.lineTo(3, 20); x.closePath(); x.stroke();
    x.restore();
  }
  // фото с закруглёнными углами, обрезанное «по размеру»
  function photo(img, w, h, r) {
    var a = cnv(w, h), c = a[0], x = a[1];
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.restore();
    rr(x, 0, 0, w, h, r); x.save(); x.clip();
    x.fillStyle = TINT; x.fillRect(0, 0, w, h);
    if (img) {
      var k = Math.max(w / img.naturalWidth, h / img.naturalHeight), iw = img.naturalWidth * k, ih = img.naturalHeight * k;
      try { x.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih); } catch (e) { house(x, w / 2, h / 2, Math.min(w, h) / 4); }
    } else house(x, w / 2, h / 2, Math.min(w, h) / 4);
    x.restore();
    try { return c.toDataURL('image/jpeg', .9); } catch (e) { return photo(null, w, h, r); }
  }
  function logo() {
    var a = cnv(150, 30), c = a[0], x = a[1];
    rr(x, 0, 0, 30, 30, 9); x.fillStyle = INK; x.fill();
    x.save(); x.translate(4.5, 4.5); x.scale(21 / 48, 21 / 48); x.strokeStyle = '#fff'; x.lineWidth = 5.5; x.lineCap = 'round'; x.lineJoin = 'round';
    x.stroke(new Path2D('M16 40V9h9.5a9.5 9.5 0 0 1 0 19H16')); x.beginPath(); x.arc(34, 37, 4, 0, Math.PI * 2); x.fillStyle = '#3DBE7A'; x.fill(); x.restore(); x.textBaseline = 'middle';
    x.fillStyle = INK; x.font = font(800, 13); x.textAlign = 'left';
    var t = 'РАНТЬЕ', X = 42; for (var i = 0; i < t.length; i++) { x.fillText(t[i], X, 16); X += x.measureText(t[i]).width + 3.2; }
    return c.toDataURL('image/png');
  }
  // строка «таблеток»: [{t, bg, fg, parts:[{t,c}]}]
  function pills(list) {
    var a0 = cnv(10, 10)[1]; a0.font = font(700, 9.5);
    var widths = list.map(function (p) { return a0.measureText(p.parts.map(function (q) { return q.t; }).join('')).width + 20; });
    var w = widths.reduce(function (s, v) { return s + v + 6; }, 0), h = 22;
    var a = cnv(w, h), c = a[0], x = a[1], X = 0;
    list.forEach(function (p, i) {
      rr(x, X, 0, widths[i], h, h / 2); x.fillStyle = p.bg; x.fill();
      x.font = font(700, 9.5); x.textBaseline = 'middle'; var tx = X + 10;
      p.parts.forEach(function (q) { x.fillStyle = q.c || p.fg; x.fillText(q.t, tx, h / 2 + .5); tx += x.measureText(q.t).width; });
      X += widths[i] + 6;
    });
    return { image: c.toDataURL('image/png'), width: w, height: h };
  }
  function headline(text, size) {
    var a0 = cnv(10, 10)[1]; a0.font = font(800, size);
    var w = Math.min(W, a0.measureText(text).width + 4), h = size * 1.15;
    var a = cnv(w, h), c = a[0], x = a[1];
    x.fillStyle = INK; x.font = font(800, size); x.textBaseline = 'alphabetic'; x.fillText(text, 0, size * .95);
    return { image: c.toDataURL('image/png'), width: w, height: h };
  }
  function box(w, h, r, color) { return { canvas: [{ type: 'rect', x: 0, y: 0, w: w, h: h, r: r, color: color }] }; }

  /* ---------- форматирование ---------- */
  function rub(n) { return Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽'; }
  function mln(n) { return n >= 1e6 ? (n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' млн ₽' : rub(n); }
  function f1(n) { return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 }); }
  var TEN = { wb: 'Wildberries', oz: 'Ozon', partner: 'Партнёрский ПВЗ' };

  /* ---------- документ ---------- */
  function build(o, imgs) {
    var where = [o.city, o.addr].filter(Boolean).join(', ');
    var tags = [];
    if (o.type === 'pvz') tags.push({ bg: INK, fg: '#fff', parts: [{ t: 'С действующим ПВЗ' }].concat(o.tenant ? [{ t: ' · ' }, { t: TEN[o.tenant], c: o.tenant === 'wb' ? '#D08BFF' : o.tenant === 'oz' ? '#82A8FF' : '#fff' }] : []) });
    else tags.push({ bg: TINT, fg: INK, parts: [{ t: 'Помещение под ПВЗ' }] });
    if (o.status === 'sold') tags.push({ bg: '#FDE8E8', fg: '#A12828', parts: [{ t: 'Продано' }] });
    if (o.status === 'example') tags.push({ bg: '#FFF3D6', fg: '#7A5600', parts: [{ t: 'Пример объявления' }] });

    var content = [];
    // шапка
    content.push({ columns: [
      { image: logo(), width: 150, height: 30 },
      { width: '*', alignment: 'right', stack: [
        { text: 'Презентация объекта', fontSize: 9, bold: true, color: INK },
        { text: '№ ' + o.id + ' · ' + new Date().toLocaleDateString('ru-RU'), fontSize: 8.5, color: MUTED, margin: [0, 2, 0, 0] }
      ] }
    ], margin: [0, 0, 0, 16] });

    // главное фото
    content.push({ image: imgs[0], width: W, height: 250 });

    // заголовок
    var p = pills(tags);
    content.push({ image: p.image, width: p.width, height: p.height, margin: [0, 18, 0, 10] });
    var h = headline(mln(o.price), 34);
    content.push({ image: h.image, width: h.width, height: h.height });
    content.push({ text: [o.area ? o.area + ' м²' : '', o.area && where ? '  ·  ' : '', where].join(''), fontSize: 13, bold: true, color: INK, margin: [0, 6, 0, 0] });
    if (o.floor) content.push({ text: o.floor, fontSize: 10.5, color: MUTED, margin: [0, 3, 0, 0] });

    // цифры
    if (o.rent) {
      var tiles = [
        [rub(o.rent), o.type === 'pvz' ? 'аренда в месяц' : 'ожидаемая аренда'],
        [rub(o.rent * 12), 'доход в год'],
        [f1(o.price / (o.rent * 12)) + ' лет', 'окупаемость'],
        [f1(o.rent * 12 / o.price * 100) + '%', 'доходность в год']
      ], tw = (W - 3 * 8) / 4, th = 58;
      content.push({ columns: tiles.map(function (t, i) {
        var dark = i === 3;
        return { width: tw, stack: [
          box(tw, th, 12, dark ? INK : TINT),
          { text: t[0], fontSize: 14, bold: true, color: dark ? '#fff' : INK, margin: [12, -th + 13, 0, 0] },
          { text: t[1], fontSize: 8.5, color: dark ? '#C9C9CF' : MUTED, margin: [12, 3, 0, 0] }
        ] };
      }), columnGap: 8, margin: [0, 18, 0, 0], unbreakable: true });
    }

    // характеристики + плюсы
    var spec = [
      ['Тип', o.type === 'pvz' ? 'Помещение с действующим ПВЗ' : 'Помещение под ПВЗ'],
      o.type === 'pvz' && o.tenant ? ['Арендатор', TEN[o.tenant]] : null,
      o.area ? ['Площадь', o.area + ' м²'] : null,
      o.floor ? ['Этаж и вход', o.floor] : null,
      o.city ? ['Город', o.city] : null,
      o.addr ? ['Адрес', o.addr] : null,
      o.lease ? ['Договор', o.lease] : null
    ].filter(Boolean);
    var specTable = { table: { widths: [78, '*'], body: spec.map(function (r) {
      return [{ text: r[0], fontSize: 9.5, color: MUTED, margin: [0, 5, 0, 5] }, { text: r[1], fontSize: 10, bold: true, color: r[1] === 'Wildberries' ? WB : r[1] === 'Ozon' ? OZ : INK, margin: [0, 5, 0, 5] }];
    }) }, layout: { hLineWidth: function (i, n) { return i === 0 || i === n.table.body.length ? 0 : .6; }, vLineWidth: function () { return 0; }, hLineColor: function () { return LINE; }, paddingLeft: function () { return 0; }, paddingRight: function () { return 6; } } };

    var plus = (o.about || []).map(function (a) {
      return { columns: [{ canvas: [{ type: 'ellipse', x: 5, y: 6.5, r1: 3, r2: 3, color: INK }], width: 14 }, { text: a, fontSize: 10.5, color: INK, lineHeight: 1.25 }], columnGap: 4, margin: [0, 0, 0, 8] };
    });
    content.push({ columns: [
      { width: '*', stack: [{ text: 'Характеристики', fontSize: 15, bold: true, margin: [0, 0, 0, 6] }, specTable] },
      plus.length ? { width: '*', stack: [{ text: 'Почему стоит купить', fontSize: 15, bold: true, margin: [0, 0, 0, 12] }].concat(plus) } : { width: '*', text: '' }
    ], columnGap: 28, margin: [0, 24, 0, 0], unbreakable: true });

    // галерея
    var rest = imgs.slice(1, 7);
    if (rest.length) {
      var gw = (W - 10) / 2, gh = gw * 0.66, rows = [];
      for (var i = 0; i < rest.length; i += 2) rows.push({ columns: [{ image: rest[i], width: gw, height: gh }, rest[i + 1] ? { image: rest[i + 1], width: gw, height: gh } : { width: gw, text: '' }], columnGap: 10, margin: [0, 0, 0, 10], unbreakable: true });
      rows[0] = { unbreakable: true, stack: [{ text: 'Фото', fontSize: 15, bold: true, margin: [0, 24, 0, 10] }, rows[0]] };
      content = content.concat(rows);
    }

    // контакты
    var ch = 92;
    content.push({ unbreakable: true, margin: [0, 24, 0, 0], stack: [
      box(W, ch, 16, INK),
      { columns: [
        { width: '*', stack: [
          { text: 'Узнать подробнее и договориться о показе', fontSize: 8.5, color: '#A9A9B0' },
          { text: PDF_CONTACT.name, fontSize: 17, bold: true, color: '#fff', margin: [0, 6, 0, 0] },
          { text: PDF_CONTACT.role, fontSize: 9, color: '#C9C9CF', margin: [0, 3, 0, 0] }
        ] },
        { width: 'auto', alignment: 'right', stack: [
          { text: 'Telegram  ' + PDF_CONTACT.tg, fontSize: 10.5, bold: true, color: '#fff' },
          { text: PDF_CONTACT.phone, fontSize: 10.5, bold: true, color: '#fff', margin: [0, 6, 0, 0] },
          PDF_CONTACT.site ? { text: PDF_CONTACT.site, fontSize: 9, color: '#C9C9CF', margin: [0, 6, 0, 0] } : { text: '' }
        ] }
      ], margin: [22, -ch + 22, 22, 22] }
    ] });
    content.push({ text: 'Информация носит ознакомительный характер и не является публичной офертой. Окупаемость и доходность рассчитаны по ' + (o.type === 'pvz' ? 'текущей' : 'ожидаемой') + ' ставке аренды без учёта налогов и расходов собственника.', fontSize: 7.5, color: MUTED, lineHeight: 1.3, margin: [0, 14, 0, 0] });

    return {
      pageSize: 'A4', pageMargins: [36, 34, 36, 44],
      info: { title: 'Объект № ' + o.id + ' — ' + mln(o.price), author: 'РАНТЬЕ · ' + PDF_CONTACT.name },
      defaultStyle: { font: 'Roboto', fontSize: 10, color: INK },
      footer: function (cur, total) {
        return { columns: [{ text: 'РАНТЬЕ · агент собственников', fontSize: 7.5, color: MUTED }, { text: cur + ' / ' + total, alignment: 'right', fontSize: 7.5, color: MUTED }], margin: [36, 14, 36, 0] };
      },
      content: content
    };
  }

  window.objectPdf = function (o) {
    var urls = (o.photos || []).slice(0, 7);
    return Promise.all([lib(), document.fonts ? document.fonts.load('800 20px Onest') : null, Promise.all(urls.map(loadImg)), window.siteSettings || null]).then(function (r) {
      var loaded = r[2], st = r[3];
      if (st) ['name', 'role', 'tg', 'phone', 'site', 'email'].forEach(function (k) { if (st[k] != null) PDF_CONTACT[k] = st[k]; });
      var imgs = [photo(loaded[0] || null, W, 250, 14)];
      var gw = (W - 10) / 2;
      loaded.slice(1).forEach(function (im) { if (im) imgs.push(photo(im, gw, gw * 0.66, 12)); });
      var name = 'rantie-obekt-' + o.id + '.pdf';
      var doc = window.pdfMake.createPdf(build(o, imgs));
      return new Promise(function (ok) { doc.download(name, ok); });
    });
  };
})();
