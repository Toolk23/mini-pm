"""Локальный BM25-поиск по исследованиям (интервью, конкуренты, загрузки).

Интерфейс:
    idx = get_index(data_dir)          # синглтон, строится лениво
    idx.search("цена allsoft", k=8)    # -> list[dict]
    idx.add_file(path)                 # проиндексировать загруженный файл
    idx.build()                        # полная перестройка (raw + uploads)

Источники:
    data/raw/interviews/*.xlsx   -> source_type="interview"
    data/raw/competitors.xlsx    -> source_type="competitor"
    data/uploads/*               -> source_type="upload" (xlsx, csv, txt, md, docx*)
"""
from __future__ import annotations

import csv
import datetime as _dt
import hashlib
import io
import pathlib
import re
import threading
import time
from typing import Any, Iterable

import openpyxl
import snowballstemmer
from rank_bm25 import BM25Okapi

MAX_CHUNK = 800          # целевой размер текста чанка, символов
EMPTY_ROWS_STOP = 30     # подряд пустых строк -> лист закончился (в «Отток клиентов» ~1 млн пустых)
SUMMARY_WEIGHT = 0.8     # понижающий вес для сводок когорт

# ---------------------------------------------------------------------------
# Токенизация
# ---------------------------------------------------------------------------
_STOP = set("""
и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее её мне было вот от меня
еще ещё нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь
там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже
себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее неё
были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего
них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более
всегда конечно всю между это как-то также просто очень
the a an of to in on for and or is are be with by at as it this that from
""".split())

_ru_stem = snowballstemmer.stemmer("russian")
_en_stem = snowballstemmer.stemmer("english")
_TOKEN_RE = re.compile(r"[a-zа-я0-9]+(?:[.\-][a-zа-я0-9]+)*", re.IGNORECASE)
_CYR = re.compile(r"[а-я]")


def tokenize(text: str) -> list[str]:
    text = (text or "").lower().replace("ё", "е")
    out: list[str] = []
    for tok in _TOKEN_RE.findall(text):
        # «softline.ru» -> softline.ru + softline + ru ; «КриптоПро-CSP» -> части
        parts = [tok] + (re.split(r"[.\-]", tok) if ("." in tok or "-" in tok) else [])
        for p in parts:
            if not p or p in _STOP:
                continue
            if p.isdigit():
                out.append(p)
            elif _CYR.search(p):
                out.append(_ru_stem.stemWord(p))
            else:
                out.append(_en_stem.stemWord(p))
    return out


# ---------------------------------------------------------------------------
# Нормализация значений
# ---------------------------------------------------------------------------
_EMPTY_ANSWERS = {
    "", "-", "—", "–", "--", "н/д", "н/п", "нд", "n/a", "na", "none", "nan", "null",
    "нет данных", "нет данных.", "нет ответа", "нет ответа.", "не указано", "не указано.",
    "в явном виде не упомянуто", "в явном виде не упомянуто.", "не упомянуто", "не упомянуто.",
    "не ответил", "не ответил.", "не ответила", "не ответила.", "?",
}


def _cell_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, _dt.datetime):
        return v.strftime("%Y-%m-%d %H:%M") if (v.hour or v.minute) else v.strftime("%Y-%m-%d")
    if isinstance(v, _dt.date):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float):
        if v.is_integer():
            return str(int(v))
        return f"{v:.4g}" if abs(v) < 1 else f"{v:.2f}".rstrip("0").rstrip(".")
    s = str(v).replace("\xa0", " ").strip()
    return re.sub(r"[ \t]+", " ", s)


def _is_empty_answer(s: str) -> bool:
    t = s.strip().lower().strip("«»\"' ")
    if t in _EMPTY_ANSWERS:
        return True
    return t.startswith("нет данных") or t.startswith("нет ответа") or t.startswith("в явном виде не упомянут")


def _clean_header(h: str) -> str:
    return re.sub(r"\s+", " ", h.replace("\t", " ")).strip()


def _split_long(text: str, limit: int = MAX_CHUNK) -> list[str]:
    """Режет длинный текст по предложениям с перекрытием в 1 предложение."""
    if len(text) <= limit:
        return [text]
    sents = [s for s in re.split(r"(?<=[.!?…»;])\s+|\n+", text) if s.strip()]
    pieces: list[str] = []
    cur: list[str] = []
    for s in sents:
        while len(s) > limit:  # очень длинное «предложение»
            if cur:
                pieces.append(" ".join(cur)); cur = []
            pieces.append(s[:limit]); s = s[limit:]
        if cur and len(" ".join(cur)) + len(s) + 1 > limit:
            pieces.append(" ".join(cur))
            cur = [cur[-1]] if len(cur[-1]) + len(s) + 1 <= limit else []
        cur.append(s)
    if cur:
        pieces.append(" ".join(cur))
    return pieces or [text[:limit]]


# ---------------------------------------------------------------------------
# Извлечение метаданных
# ---------------------------------------------------------------------------
_COMPETITOR_ALIASES = {
    "store.softline.ru": ["store.softline.ru", "softline", "софтлайн", "store"],
    "allsoft.ru": ["allsoft", "оллсофт", "алсофт"],
    "softmagazin.ru": ["softmagazin", "софтмагазин"],
    "syssoft.ru": ["syssoft", "сиссофт", "системный софт"],
    "market.yandex.ru": ["market.yandex", "яндекс маркет", "яндекс.маркет", "я.маркет", "yandex market"],
    "xcom-shop.ru": ["xcom", "икском"],
    "snabsoft.ru": ["snabsoft", "снабсофт"],
    "iesoft.ru": ["iesoft"],
    "cryptostore.ru": ["cryptostore", "криптостор"],
    "migsoft.ru": ["migsoft", "мигсофт"],
    "komus.ru": ["komus", "комус"],
}

_PRODUCTS = {
    "КриптоПро": ["криптопро", "cryptopro", "крипто про"],
    "Kaspersky": ["kaspersky", "касперск"],
    "Astra Linux": ["astra", "астра"],
    "РЕД ОС": ["ред ос", "red os", "редос"],
    "Microsoft 365": ["microsoft 365", "office 365", "m365", "майкрософт 365"],
    "Office": ["office", "офис"],
    "Windows": ["windows", "виндовс"],
    "КОМПАС-3D": ["компас"],
    "nanoCAD": ["nanocad", "нанокад"],
    "ContentReader": ["contentreader"],
    "Соболь": ["соболь"],
    "Рутокен": ["рутокен", "rutoken"],
    "JaCarta": ["jacarta"],
    "Яндекс 360": ["яндекс 360", "yandex 360"],
    "Dr.Web": ["dr.web", "drweb", "доктор веб"],
    "Adobe": ["adobe", "creative cloud", "photoshop", "acrobat"],
    "Autodesk": ["autodesk", "autocad", "автокад", "revit", "ревит"],
    "Parallels": ["parallels"],
    "AnyDesk": ["anydesk"],
    "ChatGPT": ["chatgpt", "openai"],
    "1С": ["1с", "1c:"],
}

_TAGS = {
    "price": ["цен", "дорог", "дешев", "стоимост", "прайс", "индекс цены"],
    "discount": ["скидк", "акци", "бонус", "лояльн"],
    "subscription": ["подписк", "продлен", "продлит", "на 1 год", "на год", "срок действия", "истечени"],
    "checkout": ["оформлен", "корзин", "заказ"],
    "payment": ["оплат", "безнал", "карт", "платеж", "платёж", "отсрочк", "постоплат"],
    "invoice": ["счет", "счёт"],
    "docs": ["закрывающ", "упд", "акт", "документ", "эдо", "сверк"],
    "delivery": ["ключ", "отгруз", "доставк", "получен"],
    "search": ["поиск", "фильтр", "каталог", "найти", "seo", "яндекс", "директ", "органик"],
    "license": ["лиценз", "редакци"],
    "manager": ["менеджер", "консультац", "звонок", "звонк"],
    "support": ["поддержк", "техподдерж", "чат"],
    "lk": ["личный кабинет", "лк", "кабинет", "истори"],
    "assortment": ["ассортимент", "санкци", "нет в наличии", "ушел", "ушёл"],
    "competitor": ["конкурент", "ozon", "озон", "avito", "авито", "ситилинк"] + [a for site, v in _COMPETITOR_ALIASES.items() if site != "store.softline.ru" for a in v],
}


def _find_any(text_l: str, table: dict[str, list[str]]) -> list[str]:
    found = []
    for name, keys in table.items():
        for k in keys:
            if (re.search(r"(?<![а-яa-z])" + re.escape(k) + r"(?![а-яa-z])", text_l) if len(k) <= 3 else k in text_l):
                found.append(name)
                break
    return found


def normalize_competitor(name: str) -> str | None:
    t = (name or "").lower().replace("ё", "е")
    if not t:
        return None
    for site, aliases in _COMPETITOR_ALIASES.items():
        if site in t:
            return site
    for site, aliases in _COMPETITOR_ALIASES.items():
        if any(a in t for a in aliases):
            return site
    return None


def _products(text: str) -> list[str]:
    return _find_any(text.lower().replace("ё", "е"), _PRODUCTS)


def _tags(text: str) -> list[str]:
    return _find_any(text.lower().replace("ё", "е"), _TAGS)


def _product_type(text: str) -> str | None:
    t = text.lower()
    if "подписк" in t or re.search(r"на\s*1\s*год|на\s*срок|на\s*\d+\s*(мес|год)", t):
        return "subscription"
    if "бессрочн" in t:
        return "perpetual"
    return None


# ---------------------------------------------------------------------------
# Чтение таблиц
# ---------------------------------------------------------------------------
def _iter_sheet_rows(ws) -> Iterable[tuple[int, list[str]]]:
    """(номер строки Excel, значения-строки); останавливается после EMPTY_ROWS_STOP пустых подряд."""
    empty = 0
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        vals = [_cell_str(v) for v in row]
        if not any(vals):
            empty += 1
            if empty >= EMPTY_ROWS_STOP:
                break
            yield i, []
            continue
        empty = 0
        while vals and not vals[-1]:
            vals.pop()
        yield i, vals


def _read_xlsx(path: pathlib.Path) -> list[tuple[str, list[tuple[int, list[str]]]]]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheets = []
        for ws in wb.worksheets:
            rows = list(_iter_sheet_rows(ws))
            while rows and not rows[-1][1]:
                rows.pop()
            sheets.append((ws.title, rows))
        return sheets
    finally:
        wb.close()


def _read_csv(path: pathlib.Path) -> list[tuple[str, list[tuple[int, list[str]]]]]:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp1251", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    sample = text[:5000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = []
    for i, r in enumerate(csv.reader(io.StringIO(text), dialect), 1):
        vals = [_cell_str(v) for v in r]
        while vals and not vals[-1]:
            vals.pop()
        rows.append((i, vals))
    return [(path.stem, rows)]


def _n_filled(vals: list[str]) -> int:
    return sum(1 for v in vals if v)


def _pick_header(rows: list[tuple[int, list[str]]], scan: int = 6) -> int | None:
    """Индекс строки-заголовка: строка с максимумом заполненных ячеек среди первых `scan` непустых."""
    best, best_n, seen = None, 0, 0
    for idx, (_, vals) in enumerate(rows):
        if not vals:
            continue
        seen += 1
        n = _n_filled(vals)
        if n > best_n:
            best, best_n = idx, n
        if seen >= scan:
            break
    return best if best_n >= 2 else None


# ---------------------------------------------------------------------------
# Индекс
# ---------------------------------------------------------------------------
class SearchIndex:
    def __init__(self, data_dir: pathlib.Path):
        self.data_dir = pathlib.Path(data_dir)
        self.raw_dir = self.data_dir / "raw"
        self.uploads_dir = self.data_dir / "uploads"
        self.chunks: list[dict] = []
        self._tokens: list[list[str]] = []
        self._bm25: BM25Okapi | None = None
        self._lock = threading.RLock()
        self.built = False
        self.build_seconds = 0.0
        self.errors: list[str] = []

    # ---------------- публичное API ----------------
    def build(self) -> dict:
        t0 = time.time()
        with self._lock:
            chunks: list[dict] = []
            self.errors = []
            for f in sorted((self.raw_dir / "interviews").glob("*.xlsx")):
                if f.name.startswith("~$"):
                    continue
                chunks += self._safe(self._chunks_interview_xlsx, f)
            comp = self.raw_dir / "competitors.xlsx"
            if comp.exists():
                chunks += self._safe(self._chunks_competitors, comp)
            if self.uploads_dir.exists():
                for f in sorted(self.uploads_dir.iterdir()):
                    if f.is_file() and not f.name.startswith((".", "~$")):
                        chunks += self._safe(self._chunks_upload, f)
            self.chunks = chunks
            self._tokens = [self._doc_tokens(c) for c in chunks]
            self._reindex()
            self.built = True
            self.build_seconds = round(time.time() - t0, 2)
            return self.stats()

    def stats(self) -> dict:
        by: dict[str, int] = {}
        for c in self.chunks:
            by[c["source_type"]] = by.get(c["source_type"], 0) + 1
        out = {"chunks": len(self.chunks), "by_source": by, "seconds": self.build_seconds}
        if self.errors:
            out["errors"] = self.errors
        return out

    def add_file(self, path: pathlib.Path) -> dict:
        path = pathlib.Path(path)
        with self._lock:
            if not self.built:
                self.build()
            new = self._safe(self._chunks_upload, path)
            # повторная загрузка файла с тем же именем заменяет старые чанки
            keep = [(c, t) for c, t in zip(self.chunks, self._tokens)
                    if not (c["source_type"] == "upload" and c["file"] == path.name)]
            self.chunks = [c for c, _ in keep] + new
            self._tokens = [t for _, t in keep] + [self._doc_tokens(c) for c in new]
            self._reindex()
            res = {"file": path.name, "chunks_added": len(new)}
            if not new and self.errors and self.errors[-1].startswith(path.name):
                res["error"] = self.errors[-1]
            return res

    def search(self, query: str, k: int = 8, source_types: list[str] | None = None,
               filters: dict | None = None) -> list[dict]:
        with self._lock:
            if not self.built:
                self.build()
            q = [t for t in dict.fromkeys(tokenize(query))]
            if not q or self._bm25 is None or not self.chunks:
                return []
            scores = self._bm25.get_scores(q)
            qset = set(q)
            cand = []
            for i, s in enumerate(scores):
                if s <= 0:
                    continue
                c = self.chunks[i]
                if source_types and c["source_type"] not in source_types:
                    continue
                if filters and not self._match(c, filters):
                    continue
                matched = len(qset & set(self._tokens[i]))
                if matched == 0:
                    continue
                # бонус за покрытие запроса: чанк с 3 из 3 терминов выше чанка с 1 из 3
                s = s * (0.5 + 0.5 * matched / len(qset))
                if c["meta"].get("kind") == "cohort_summary":
                    s *= SUMMARY_WEIGHT
                cand.append((s, i))
            cand.sort(key=lambda x: -x[0])
            out = []
            for s, i in cand[:k]:
                r = dict(self.chunks[i])
                r["meta"] = dict(r["meta"])
                r["score"] = round(float(s), 4)
                out.append(r)
            return out

    # ---------------- внутреннее ----------------
    def _safe(self, fn, path: pathlib.Path) -> list[dict]:
        try:
            return fn(path)
        except Exception as e:  # битый файл не должен ронять весь индекс
            self.errors.append(f"{path.name}: {type(e).__name__}: {e}")
            return []

    def _reindex(self) -> None:
        self._bm25 = BM25Okapi(self._tokens) if self._tokens else None

    @staticmethod
    def _doc_tokens(c: dict) -> list[str]:
        toks = tokenize(c["title"] + "\n" + c["text"])
        return toks or ["__empty__"]

    @staticmethod
    def _match(c: dict, filters: dict) -> bool:
        for key, want in filters.items():
            have = c.get(key) if key in c and key != "meta" else c["meta"].get(key)
            if want is None:
                continue
            wants = want if isinstance(want, (list, tuple, set)) else [want]
            wants_l = {str(w).lower() for w in wants}
            if isinstance(have, (list, tuple, set)):
                if not wants_l & {str(h).lower() for h in have}:
                    return False
            else:
                if have is None or str(have).lower() not in wants_l:
                    return False
        return True

    @staticmethod
    def _mk(source_type: str, file: str, sheet: str | None, row: int | None, title: str,
            text: str, meta: dict, part: int = 0) -> dict:
        key = f"{source_type}|{file}|{sheet}|{row}|{meta.get('question_col', '')}|{meta.get('kind', '')}|{part}"
        cid = hashlib.md5(key.encode("utf-8")).hexdigest()[:12]
        meta = {k: v for k, v in meta.items() if v not in (None, "", [], {})}
        return {"id": cid, "source_type": source_type, "file": file, "sheet": sheet, "row": row,
                "title": title, "text": text, "score": 0.0, "meta": meta}

    # ---------- интервью ----------
    @staticmethod
    def _sheet_context(file_stem: str, sheet: str) -> dict:
        s = sheet.lower()
        meta: dict[str, Any] = {"study": file_stem}
        for seg in ("micro", "small", "medium"):
            if seg in s:
                meta["segment"] = seg.capitalize()
        cohorts = {"малоактив": "Малоактивные", "активн": "Активные", "новичк": "Новички", "отток": "Отток"}
        for k, v in cohorts.items():
            if k in s:
                meta["cohort"] = v
                break
        if "custdev" in s or "отток" in file_stem.lower():
            meta.setdefault("cohort", "Отток")
        return meta

    def _interview_table_chunks(self, file_name: str, file_stem: str, sheet: str,
                                rows: list[tuple[int, list[str]]], source_type: str,
                                study_label: str) -> list[dict]:
        out: list[dict] = []
        h = _pick_header(rows)
        if h is None:
            return out
        header = [_clean_header(x) for x in rows[h][1]]
        # «блоки» вопросов (строка над заголовком с объединёнными ячейками, как в «Отток клиентов»)
        blocks: dict[int, str] = {}
        for _, vals in rows[:h]:
            if _n_filled(vals) >= 2:
                cur = ""
                for ci in range(len(header)):
                    v = vals[ci] if ci < len(vals) else ""
                    if v:
                        cur = v.split("\n")[0].strip()
                    if cur:
                        blocks[ci] = cur
        title_row = next((vals for _, vals in rows[:h] if _n_filled(vals) == 1), None)
        ctx = self._sheet_context(file_stem, sheet)
        if title_row and "cohort" not in ctx:
            ctx["cohort"] = title_row[0] if len(title_row[0]) < 40 else None

        role_ci = next((i for i, x in enumerate(header) if re.search(r"роль|должност", x, re.I)), None)
        order_ci = next((i for i, x in enumerate(header) if re.search(r"состав заказа", x, re.I)), None)
        num_ci = next((i for i, x in enumerate(header) if x.strip() in ("№", "#", "N", "No")), None)
        concl_ci = [i for i, x in enumerate(header) if re.search(r"^(краткий )?вывод|^итог|резюме|профиль", x, re.I)]
        model_ci = next((i for i, x in enumerate(header) if re.search(r"модель покупки", x, re.I)), None)
        meta_cols = {c for c in (role_ci, order_ci, num_ci) if c is not None}

        data = [(r, v) for r, v in rows[h + 1:] if v]
        # строки только с номером («270») — пустые респонденты
        data = [(r, v) for r, v in data
                if _n_filled([x for ci, x in enumerate(v) if ci != num_ci]) >= 1]
        # сводная строка когорты: лист с одиночной строкой-заголовком сверху и ≥3 ответов — последняя строка
        summary_row = data[-1][0] if (title_row is not None and len(data) >= 3) else None

        sheet_label = re.sub(r"_?Результаты анализа", "", sheet).replace("_", " ").strip()
        if sheet == file_stem:  # csv: «лист» = имя файла, не дублируем в заголовке
            sheet_label = ""
        resp_no = 0
        for r, vals in data:
            get = lambda ci: vals[ci] if ci is not None and ci < len(vals) else ""
            is_summary = r == summary_row
            if not is_summary:
                resp_no += 1
            rid = get(num_ci) or str(resp_no)
            role = get(role_ci)
            order = get(order_ci)
            base = dict(ctx)
            base.update({
                "role": role[:120] if role else None,
                "order": order[:300] if order else None,
                "products": _products(order) if order else None,
                "product_type": _product_type(order) if order else None,
                "purchase_model": get(model_ci) or None,
                "respondent_id": None if is_summary else hashlib.md5(f"{file_name}|{sheet}|{r}".encode()).hexdigest()[:10],
            })
            if is_summary:
                base["kind"] = "cohort_summary"
                title = " / ".join(x for x in (study_label, sheet_label, "сводка когорты") if x)
            else:
                base["kind"] = "answer"
                title = " / ".join(x for x in (study_label, sheet_label, f"респондент {rid}") if x)
            seg = " / ".join(x for x in (base.get("segment"), base.get("cohort")) if x)
            prefix = f"[{study_label}{' / ' + seg if seg else ''}]"

            # профиль респондента
            if not is_summary and (role or order or concl_ci):
                parts = []
                if role:
                    parts.append(f"Роль: {role}")
                if order:
                    parts.append(f"Состав заказа: {order}")
                if get(model_ci):
                    parts.append(f"Модель покупки: {get(model_ci)}")
                for ci in concl_ci:
                    if get(ci) and not _is_empty_answer(get(ci)):
                        parts.append(f"{header[ci]}: {get(ci)}")
                if parts:
                    txt = f"{prefix} Профиль респондента. " + "\n".join(parts)
                    m = dict(base, kind="profile", tags=_tags(txt))
                    for pi, piece in enumerate(_split_long(txt)):
                        if pi > 0:
                            piece = f"{prefix} Профиль респондента (продолжение). {piece}"
                        out.append(self._mk(source_type, file_name, sheet, r, title + " / профиль", piece, m, pi))

            for ci, ans in enumerate(vals):
                if ci in meta_cols or ci in concl_ci or ci == model_ci or ci >= len(header) and not ans:
                    continue
                if not ans or _is_empty_answer(ans):
                    continue
                q = header[ci] if ci < len(header) and header[ci] else f"Колонка {ci + 1}"
                txt_body = f"Вопрос: {q}\nОтвет: {ans}"
                if is_summary:
                    txt_body = f"Сводка по когорте. {txt_body}"
                m = dict(base, question=q[:200], question_col=ci, block=blocks.get(ci),
                         quote_verbatim=("«" in ans) or None, tags=_tags(q + " " + ans))
                for pi, piece in enumerate(_split_long(f"{prefix} {txt_body}")):
                    if pi > 0:
                        piece = f"{prefix} Вопрос: {q[:150]} (продолжение)\n{piece}"
                    out.append(self._mk(source_type, file_name, sheet, r, title, piece[:MAX_CHUNK + 200], m, pi))
        return out

    def _chunks_interview_xlsx(self, path: pathlib.Path) -> list[dict]:
        out: list[dict] = []
        study = path.stem
        for sheet, rows in _read_xlsx(path):
            sl = sheet.lower()
            if "дизайн" in sl or "гайд" in sl:
                out += self._text_rows_chunks("interview", path.name, sheet, rows,
                                              f"{study} / {sheet}", {"study": study, "kind": "guide"})
                continue
            if sl.strip() in ("итоги", "итог") and sum(1 for _, v in rows if v) < 10:
                out += self._text_rows_chunks("interview", path.name, sheet, rows,
                                              f"{study} / {sheet}", {"study": study, "kind": "cohort_summary"})
                continue
            out += self._interview_table_chunks(path.name, study, sheet, rows, "interview", study)
        return out

    def _text_rows_chunks(self, source_type: str, file: str, sheet: str,
                          rows: list[tuple[int, list[str]]], title: str, meta: dict) -> list[dict]:
        out = []
        for r, vals in rows:
            vals = [v for v in vals if v and not _is_empty_answer(v)]
            if not vals:
                continue
            txt = " | ".join(vals)
            if len(tokenize(txt)) < 2:
                continue
            m = dict(meta, tags=_tags(txt))
            for pi, piece in enumerate(_split_long(f"[{title}] {txt}")):
                out.append(self._mk(source_type, file, sheet, r, title, piece, m, pi))
        return out

    # ---------- конкуренты / таблицы ----------
    _BLOCKS = {"итоги": "summary", "0_": "selection", "00_": "scale", "01_": "segments",
               "02c": "search_findings", "02b": "search_lost_demand", "02a": "search_products",
               "02_": "search", "03_": "price", "04_": "checkout", "05_": "support_speed",
               "06_": "account", "07_": "service", "08_": "ux"}

    def _block_of(self, sheet: str) -> str | None:
        s = sheet.lower()
        for k in ("02c", "02b", "02a", "00_", "01_", "02_", "03_", "04_", "05_", "06_", "07_", "08_", "0_", "итоги"):
            if s.startswith(k):
                return self._BLOCKS[k]
        return None

    def _table_chunks(self, source_type: str, file: str, sheet: str,
                      rows: list[tuple[int, list[str]]], title_prefix: str, base_meta: dict) -> list[dict]:
        """Строка таблицы -> «колонка: значение; …». Поддерживает несколько таблиц на листе
        (заголовок после пустой/титульной строки) и таблицы «бок о бок» (разделены пустой колонкой)."""
        out: list[dict] = []
        header: list[str] | None = None
        section = ""
        prev_blank = True
        sheet_title = sheet.replace("_", " ").strip()
        intro: list[str] = []
        for r, vals in rows:
            n = _n_filled(vals)
            if n == 0:
                prev_blank = True
                continue
            if n == 1 and vals[0] and (header is None or prev_blank):
                # титул / подзаголовок секции / пояснение
                first = vals[0].split("\n")[0].strip()
                section = first if len(first) <= 60 else ""
                if len(vals[0]) > 60:
                    intro.append((r, vals[0]))
                prev_blank = True
                continue
            looks_header = all(not re.fullmatch(r"[\d\s.,%₽-]+", v) for v in vals if v) and \
                not any(v.lower() in ("да", "нет", "частично") for v in vals if v)
            if header is None or (prev_blank and looks_header and n >= 2):
                header = [_clean_header(v) for v in vals]
                prev_blank = False
                continue
            prev_blank = False
            # группы колонок по разрывам в заголовке
            groups: list[list[int]] = []
            cur: list[int] = []
            for ci in range(max(len(header), len(vals))):
                if ci < len(header) and header[ci]:
                    cur.append(ci)
                elif ci < len(header):
                    if cur:
                        groups.append(cur); cur = []
                else:
                    cur.append(ci)
            if cur:
                groups.append(cur)
            for gi, g in enumerate(groups):
                pairs = []
                for ci in g:
                    v = vals[ci] if ci < len(vals) else ""
                    if not v or _is_empty_answer(v):
                        continue
                    hname = header[ci] if ci < len(header) and header[ci] else f"Колонка {ci + 1}"
                    pairs.append((ci, hname, v))
                if not pairs or (len(pairs) == 1 and len(pairs[0][2]) < 4):
                    continue
                key_val = vals[g[0]] if g[0] < len(vals) else ""
                prod_ci = next((ci for ci in g if ci < len(header) and re.fullmatch(r"продукт", header[ci], re.I)), None)
                product = vals[prod_ci] if prod_ci is not None and prod_ci < len(vals) and prod_ci != g[0] else ""
                comp = normalize_competitor(key_val) if key_val else None
                score_ci = next((ci for ci in g if ci < len(header) and re.search(r"балл", header[ci], re.I)), None)
                url_ci = next((ci for ci in g if ci < len(header) and re.search(r"url", header[ci], re.I)), None)
                body = "; ".join(f"{h}: {v}" for _, h, v in pairs)
                lbl = " / ".join(x for x in (key_val[:60] if key_val else None, product[:60] if product else None) if x)
                title = f"{title_prefix} / {sheet_title}" + (f" / {lbl}" if lbl else "")
                prefix = f"[{title_prefix} / {sheet_title}{' / ' + section if section and section != sheet_title else ''}]"
                all_text = key_val + " " + product + " " + body
                m = dict(base_meta)
                m.update({
                    "kind": "table_row", "block": self._block_of(sheet), "section": section or None,
                    "competitor": comp, "product": product or None,
                    "products": _products(all_text) or None,
                    "score_1_5": (vals[score_ci] if score_ci is not None and score_ci < len(vals) else None),
                    "url": (vals[url_ci][:300] if url_ci is not None and url_ci < len(vals) else None),
                    "group": gi if len(groups) > 1 else None,
                    "tags": _tags(all_text), "question_col": g[0],
                })
                if comp is None and source_type == "competitor":
                    found = [s for s in _COMPETITOR_ALIASES if normalize_competitor(s) and s.split(".")[0] in all_text.lower()]
                    if found:
                        m["competitors_mentioned"] = found
                full = f"{prefix} {body}"
                pieces = _split_long(full)
                for pi, piece in enumerate(pieces):
                    if pi > 0:
                        piece = f"{prefix} {lbl} (продолжение): {piece}"
                    out.append(self._mk(source_type, file, sheet, r, title, piece[:MAX_CHUNK + 200], m, pi))
        for r, txt in intro:
            m = dict(base_meta, kind="sheet_note", block=self._block_of(sheet), tags=_tags(txt))
            for pi, piece in enumerate(_split_long(f"[{title_prefix} / {sheet_title}] {txt}")):
                out.append(self._mk(source_type, file, sheet, r, f"{title_prefix} / {sheet_title} / пояснение", piece, m, pi))
        return out

    def _chunks_competitors(self, path: pathlib.Path) -> list[dict]:
        out: list[dict] = []
        for sheet, rows in _read_xlsx(path):
            out += self._table_chunks("competitor", path.name, sheet, rows, "Конкуренты",
                                      {"study": "competitors"})
        return out

    # ---------- загрузки ----------
    @staticmethod
    def _looks_like_interview(rows: list[tuple[int, list[str]]]) -> bool:
        h = _pick_header(rows)
        if h is None:
            return False
        header = [x for x in rows[h][1] if x]
        q = sum(1 for x in header if x.strip().endswith("?") or re.search(r"роль|респондент|состав заказа", x, re.I))
        return q >= max(2, len(header) // 3)

    def _chunks_upload(self, path: pathlib.Path) -> list[dict]:
        ext = path.suffix.lower()
        if ext in (".xlsx", ".xlsm"):
            sheets = _read_xlsx(path)
        elif ext in (".csv", ".tsv"):
            sheets = _read_csv(path)
        elif ext in (".txt", ".md", ".markdown"):
            return self._chunks_text(path, path.read_text(encoding="utf-8", errors="replace"))
        elif ext == ".docx":
            try:
                import docx  # type: ignore
            except ImportError:
                self.errors.append(f"{path.name}: python-docx не установлен, docx пропущен")
                return []
            d = docx.Document(str(path))
            parts = [p.text for p in d.paragraphs]
            for t in d.tables:
                for row in t.rows:
                    parts.append(" | ".join(c.text.strip() for c in row.cells))
            return self._chunks_text(path, "\n".join(parts))
        else:
            self.errors.append(f"{path.name}: неподдерживаемый формат {ext}")
            return []
        out: list[dict] = []
        for sheet, rows in sheets:
            if self._looks_like_interview(rows):
                out += self._interview_table_chunks(path.name, path.stem, sheet, rows, "upload", path.stem)
            else:
                out += self._table_chunks("upload", path.name, sheet, rows, path.stem,
                                          {"study": path.stem})
        for c in out:
            c["meta"]["uploaded"] = True
        return out

    def _chunks_text(self, path: pathlib.Path, text: str) -> list[dict]:
        out: list[dict] = []
        heading = ""
        buf: list[str] = []
        start_line = 1

        def flush(line_no: int):
            nonlocal buf
            body = "\n".join(buf).strip()
            buf = []
            if not body or len(tokenize(body)) < 2:
                return
            title = f"{path.stem}" + (f" / {heading[:80]}" if heading else "")
            m = {"study": path.stem, "kind": "text", "section": heading or None,
                 "tags": _tags(body), "products": _products(body), "uploaded": True}
            for pi, piece in enumerate(_split_long(body)):
                out.append(self._mk("upload", path.name, None, line_no, title, piece, m, pi))

        cur_len = 0
        for ln, line in enumerate(text.splitlines(), 1):
            mh = re.match(r"^\s{0,3}#{1,6}\s+(.*)", line)
            if mh:
                flush(start_line)
                heading = mh.group(1).strip()
                start_line, cur_len = ln + 1, 0
                continue
            if not line.strip() and cur_len >= MAX_CHUNK * 0.6:
                flush(start_line)
                start_line, cur_len = ln + 1, 0
                continue
            if not buf:
                start_line = ln
            buf.append(line)
            cur_len += len(line) + 1
        flush(start_line)
        return out


# ---------------------------------------------------------------------------
_INDEXES: dict[str, SearchIndex] = {}
_GLOBAL_LOCK = threading.Lock()


def get_index(data_dir) -> SearchIndex:
    """Синглтон на каталог данных; индекс строится лениво при первом search()."""
    key = str(pathlib.Path(data_dir).resolve())
    with _GLOBAL_LOCK:
        idx = _INDEXES.get(key)
        if idx is None:
            idx = SearchIndex(pathlib.Path(data_dir))
            _INDEXES[key] = idx
        return idx
