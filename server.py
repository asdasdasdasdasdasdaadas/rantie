#!/usr/bin/env python3
"""Сайт Rent Line + админка объектов.

Запуск:  python3 server.py            (порт 8080)
         PORT=80 python3 server.py

Пароль от админки лежит в файле admin.json (создаётся при первом запуске).
Объекты хранятся в data/objects.json, фото — в папке uploads/.
Статистика посещений — в data/events.jsonl (без IP и без cookies).
Нужен только Python 3.8+, без сторонних библиотек.
"""
import base64, csv, hashlib, hmac, json, os, re, secrets, threading, time, uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
UPLOADS = os.path.join(ROOT, "uploads")
DB = os.path.join(DATA, "objects.json")
SETTINGS = os.path.join(DATA, "settings.json")
CONF = os.path.join(ROOT, "admin.json")
MAX_BODY = 40 * 1024 * 1024          # 40 МБ на одно сохранение (с фото)
MAX_PHOTO = 8 * 1024 * 1024          # 8 МБ на одно фото
SESSION_TTL = 30 * 24 * 3600         # вход запоминается на 30 дней
BLOCKED = ("/data", "/admin.json", "/server.py", "/.claude", "/.git")

os.makedirs(DATA, exist_ok=True)
os.makedirs(UPLOADS, exist_ok=True)
lock = threading.Lock()
sessions = {}
fails = {}

FIELDS = {
    "status": ("sale", "sold", "hidden", "example"),
    "type": ("pvz", "empty"),
    "tenant": ("wb", "oz", "partner", ""),
}
TEXT = ("city", "addr", "floor", "lease")
NUMS = ("area", "price", "rent")
DEFAULTS = {
    "name": "Кирилл Горин",
    "role": "Руководитель агентства",
    "tg": "@username",
    "phone": "+7 900 000-00-00",
    "email": "mail@example.ru",
    "site": "",
    "company": "ИП Горин Кирилл Николаевич",
    "inn": "000000000000",
    "price_full": "10 000",
    "price_open": "XX%",
    "price_rent": "XX%",
    "price_sale": "X%",
    "price_close": "XX XXX",
    "price_claim": "X XXX",
    "price_meter": "X XXX",
}


def read_settings():
    s = dict(DEFAULTS)
    if os.path.exists(SETTINGS):
        with open(SETTINGS, encoding="utf-8") as f:
            s.update({k: v for k, v in json.load(f).items() if k in DEFAULTS})
    return s


def write_settings(src):
    s = {k: str(src.get(k, "")).strip()[:200] for k in DEFAULTS}
    tmp = SETTINGS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False, indent=1)
    os.replace(tmp, SETTINGS)
    return s


# ---------- настройки и пароль ----------
def load_conf():
    if not os.path.exists(CONF):
        pw = secrets.token_urlsafe(9)
        with open(CONF, "w", encoding="utf-8") as f:
            json.dump({"password": pw}, f, ensure_ascii=False, indent=2)
        print("\n  Создан пароль от админки. Он в файле admin.json\n")
    with open(CONF, encoding="utf-8") as f:
        return json.load(f)


# ---------- хранилище ----------
def num(x):
    x = re.sub(r"[^\d.,]", "", str(x or "")).replace(",", ".")
    try:
        v = float(x)
        return int(v) if v.is_integer() else v
    except ValueError:
        return 0


def from_csv():
    """Первый запуск: переносим объекты из objects.csv, если он есть."""
    path = os.path.join(ROOT, "objects.csv")
    if not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8-sig") as f:
        for i, r in enumerate(csv.DictReader(f)):
            r = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
            g = lambda p: next((v for k, v in r.items() if k == p or k.startswith(p + " ") or (p != "аренда" and k.startswith(p))), "")
            st, tp, tn = g("статус").lower(), g("тип").lower(), g("арендатор").lower()
            out.append({
                "id": i + 1,
                "status": "sold" if st.startswith("продан") else "example" if st.startswith("пример") else "hidden" if st.startswith("скры") else "sale",
                "type": "empty" if tp.startswith("под") else "pvz",
                "tenant": "wb" if re.search(r"wb|wild|вайл|рвб", tn) else "oz" if re.search(r"ozon|озон", tn) else ("partner" if tn else ""),
                "city": g("город"), "addr": g("адрес"), "floor": g("этаж"), "lease": g("договор"),
                "area": num(g("площадь")), "price": num(g("цена")), "rent": num(g("аренда")),
                "about": [a.strip() for a in re.split(r";|\n", g("плюсы")) if a.strip()],
                "photos": [], "updated": int(time.time()),
            })
    return out


def read_db():
    if not os.path.exists(DB):
        write_db(from_csv())
    with open(DB, encoding="utf-8") as f:
        return json.load(f)


def write_db(items):
    tmp = DB + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    os.replace(tmp, DB)


def save_photo(data_url):
    m = re.match(r"^data:image/(jpeg|png|webp);base64,(.+)$", data_url, re.S)
    if not m:
        raise ValueError("Фото должно быть JPEG, PNG или WEBP")
    raw = base64.b64decode(m.group(2), validate=False)
    if len(raw) > MAX_PHOTO:
        raise ValueError("Фото слишком большое")
    sig = {"jpeg": b"\xff\xd8", "png": b"\x89PNG", "webp": b"RIFF"}[m.group(1)]
    if not raw.startswith(sig):
        raise ValueError("Файл не похож на картинку")
    name = uuid.uuid4().hex + (".jpg" if m.group(1) == "jpeg" else "." + m.group(1))
    with open(os.path.join(UPLOADS, name), "wb") as f:
        f.write(raw)
    return "uploads/" + name


def drop_photo(url):
    if isinstance(url, str) and re.fullmatch(r"uploads/[0-9a-f]{32}\.(jpg|png|webp)", url):
        try:
            os.remove(os.path.join(ROOT, url))
        except FileNotFoundError:
            pass


def clean(src, old=None):
    o = {}
    for k, allowed in FIELDS.items():
        v = src.get(k, "")
        o[k] = v if v in allowed else allowed[0]
    if o["type"] == "empty":
        o["tenant"] = ""
    for k in TEXT:
        o[k] = str(src.get(k, ""))[:200].strip()
    for k in NUMS:
        o[k] = num(src.get(k))
    o["about"] = [str(a).strip()[:200] for a in (src.get("about") or []) if str(a).strip()][:12]
    photos = []
    kept = set(old.get("photos", [])) if old else set()
    for p in (src.get("photos") or [])[:12]:
        if isinstance(p, str) and p.startswith("data:"):
            photos.append(save_photo(p))
        elif p in kept:
            photos.append(p)
    o["photos"] = photos
    if not o["price"]:
        raise ValueError("Укажите цену")
    return o


# ---------- статистика ----------
EVENTS = os.path.join(DATA, "events.jsonl")
MSK = 3 * 3600                      # дни считаем по московскому времени
BOTS = re.compile(r"bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|python|curl|wget", re.I)
track_rate = {}
EV_KINDS = ("view", "click", "obj")


def day_of(ts):
    return time.strftime("%Y-%m-%d", time.gmtime(ts + MSK))


def add_event(src, ua):
    def s(k, n=80):
        return re.sub(r"[\x00-\x1f<>]", "", str(src.get(k) or ""))[:n].strip()
    ev = s("ev", 10)
    if ev not in EV_KINDS:
        raise ValueError("bad event")
    vid = s("vid", 24)
    if not re.fullmatch(r"[A-Za-z0-9]{8,24}", vid):
        raise ValueError("bad id")
    ref = s("ref", 120)
    ref = urlparse(ref).netloc.lower().removeprefix("www.") if ref.startswith("http") else ""
    e = {"ts": int(time.time()), "vid": vid, "sid": s("sid", 24), "ev": ev, "page": s("page", 60),
         "label": s("label", 60), "sec": s("sec", 30), "ref": ref, "utm": s("utm", 40),
         "dev": "m" if re.search(r"Mobi|Android|iPhone|iPad", ua) else "d"}
    line = json.dumps(e, ensure_ascii=False) + "\n"
    with lock:
        with open(EVENTS, "a", encoding="utf-8") as f:
            f.write(line)


def read_events(since):
    out = []
    if not os.path.exists(EVENTS):
        return out
    with open(EVENTS, encoding="utf-8") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("ts", 0) >= since:
                out.append(e)
    return out


def stats(days):
    now = int(time.time())
    today = day_of(now)
    start_day = time.strftime("%Y-%m-%d", time.gmtime(now + MSK - (days - 1) * 86400))
    since = now - (days + 1) * 86400
    ev = [e for e in read_events(since) if day_of(e["ts"]) >= start_day]
    names = [time.strftime("%Y-%m-%d", time.gmtime(now + MSK - i * 86400)) for i in range(days - 1, -1, -1)]
    per = {d: {"d": d, "v": set(), "p": 0, "c": 0} for d in names}
    pages, clicks, refs, devs, visitors, sessions_ = {}, {}, {}, {}, set(), set()
    first = {}
    for e in ev:
        d = per.get(day_of(e["ts"]))
        if d is None:
            continue
        d["v"].add(e["vid"])
        visitors.add(e["vid"])
        if e.get("sid"):
            sessions_.add(e["sid"])
        devs.setdefault(e["vid"], e.get("dev", "d"))
        if e["ev"] == "view":
            d["p"] += 1
            pages[e["page"]] = pages.get(e["page"], 0) + 1
            if e["sid"] not in first:
                first[e["sid"]] = e.get("utm") or e.get("ref") or ""
        else:
            d["c"] += 1
            k = (e["label"], e["sec"] if e["ev"] == "click" else "Объекты")
            clicks[k] = clicks.get(k, 0) + 1
    for src in first.values():
        refs[src] = refs.get(src, 0) + 1
    top = lambda m, n: sorted(m.items(), key=lambda x: -x[1])[:n]
    dv = list(devs.values())
    return {
        "days": [{"d": x["d"], "v": len(x["v"]), "p": x["p"], "c": x["c"]} for x in per.values()],
        "tot": {"visitors": len(visitors), "visits": len(sessions_),
                "views": sum(x["p"] for x in per.values()), "clicks": sum(x["c"] for x in per.values())},
        "today": {"visitors": len(per[today]["v"]) if today in per else 0},
        "online": len({e["vid"] for e in ev if e["ts"] > now - 300}),
        "pages": top(pages, 8),
        "clicks": [[k[0], k[1], n] for k, n in top(clicks, 12)],
        "refs": top(refs, 8),
        "dev": {"m": dv.count("m"), "d": dv.count("d")},
        "recent": [{k: e.get(k, "") for k in ("ts", "ev", "page", "label", "sec", "ref", "dev", "vid")} for e in ev[-40:][::-1]],
        "now": now,
    }


# ---------- сервер ----------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if self.path.startswith("/admin"):
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # --- помощники
    def json(self, code, obj, cookie=None):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def empty(self):
        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("Слишком большой запрос. Загрузите меньше фото за раз.")
        return json.loads(self.rfile.read(n) or b"{}")

    def token(self):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "rs_admin":
                return v
        return ""

    def authed(self):
        t = self.token()
        exp = sessions.get(t)
        if exp and exp > time.time():
            return True
        sessions.pop(t, None)
        return False

    def same_origin(self):
        origin = self.headers.get("Origin")
        return not origin or urlparse(origin).netloc == self.headers.get("Host")

    # --- маршруты
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith(BLOCKED) or path.endswith((".py", ".tmp")):
            return self.send_error(HTTPStatus.NOT_FOUND)
        if path == "/api/objects":
            items = [o for o in read_db() if o["status"] != "hidden"]
            return self.json(200, items)
        if path == "/api/admin/objects":
            if not self.authed():
                return self.json(401, {"error": "Нужно войти"})
            return self.json(200, read_db())
        if path == "/api/settings":
            return self.json(200, read_settings())
        if path == "/api/admin/stats":
            if not self.authed():
                return self.json(401, {"error": "Нужно войти"})
            q = parse_qs(urlparse(self.path).query)
            d = q.get("d", ["7"])[0]
            return self.json(200, stats(int(d) if d in ("1", "7", "30", "90") else 7))
        if path == "/api/admin/me":
            return self.json(200, {"ok": self.authed()})
        if path == "/admin":
            self.path = "/admin.html"
        return super().do_GET()

    def do_HEAD(self):
        path = urlparse(self.path).path
        if path.startswith(BLOCKED) or path.endswith((".py", ".tmp")):
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_HEAD()

    def do_POST(self):
        path = urlparse(self.path).path
        if not self.same_origin():
            return self.json(403, {"error": "Запрос с чужого сайта"})
        try:
            if path == "/api/admin/login":
                ip = self.client_address[0]
                n, until = fails.get(ip, (0, 0))
                if until > time.time():
                    return self.json(429, {"error": "Слишком много попыток. Подождите минуту."})
                pw = str(self.body().get("password", ""))
                if hmac.compare_digest(hashlib.sha256(pw.encode()).digest(), hashlib.sha256(load_conf()["password"].encode()).digest()):
                    fails.pop(ip, None)
                    t = secrets.token_urlsafe(32)
                    sessions[t] = time.time() + SESSION_TTL
                    secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
                    return self.json(200, {"ok": True}, f"rs_admin={t}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL}{secure}")
                n += 1
                fails[ip] = (0, time.time() + 60) if n >= 5 else (n, 0)
                time.sleep(0.8)
                return self.json(401, {"error": "Неверный пароль"})

            if path == "/api/track":
                n = int(self.headers.get("Content-Length") or 0)
                ua = self.headers.get("User-Agent") or ""
                ip = self.client_address[0]
                cnt, t0 = track_rate.get(ip, (0, time.time()))
                if time.time() - t0 > 60:
                    cnt, t0 = 0, time.time()
                track_rate[ip] = (cnt + 1, t0)
                if n > 2048 or cnt > 120 or BOTS.search(ua) or self.authed():
                    self.rfile.read(min(n, 2048))
                    return self.empty()
                add_event(json.loads(self.rfile.read(n) or b"{}"), ua)
                return self.empty()

            if path == "/api/admin/logout":
                sessions.pop(self.token(), None)
                return self.json(200, {"ok": True}, "rs_admin=; Path=/; Max-Age=0")

            if not self.authed():
                return self.json(401, {"error": "Нужно войти"})

            if path == "/api/admin/objects":
                src = self.body()
                with lock:
                    items = read_db()
                    oid = src.get("id")
                    old = next((o for o in items if o["id"] == oid), None) if oid else None
                    o = clean(src, old)
                    if old:
                        for p in old.get("photos", []):
                            if p not in o["photos"]:
                                drop_photo(p)
                        o["id"] = old["id"]
                        items[items.index(old)] = o
                    else:
                        o["id"] = max([x["id"] for x in items] or [0]) + 1
                        items.insert(0, o)
                    o["updated"] = int(time.time())
                    write_db(items)
                return self.json(200, o)

            if path == "/api/admin/settings":
                with lock:
                    return self.json(200, write_settings(self.body()))

            if path == "/api/admin/order":
                ids = [int(i) for i in self.body().get("ids", [])]
                with lock:
                    items = read_db()
                    pos = {i: n for n, i in enumerate(ids)}
                    items.sort(key=lambda o: pos.get(o["id"], len(ids)))
                    write_db(items)
                return self.json(200, {"ok": True})

            m = re.fullmatch(r"/api/admin/objects/(\d+)/delete", path)
            if m:
                with lock:
                    items = read_db()
                    o = next((x for x in items if x["id"] == int(m.group(1))), None)
                    if o:
                        for p in o.get("photos", []):
                            drop_photo(p)
                        items.remove(o)
                        write_db(items)
                return self.json(200, {"ok": True})

            return self.json(404, {"error": "Не найдено"})
        except (ValueError, json.JSONDecodeError) as e:
            return self.json(400, {"error": str(e) or "Неверные данные"})


if __name__ == "__main__":
    load_conf()
    read_db()
    port = int(os.environ.get("PORT", "8080"))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"  Сайт:    http://{'localhost' if host == '127.0.0.1' else host}:{port}/")
    print(f"  Админка: http://{'localhost' if host == '127.0.0.1' else host}:{port}/admin")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
