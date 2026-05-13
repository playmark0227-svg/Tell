"""
tell partner - Google CSE による企業発見＋HP巡回

商材ごとのターゲット条件から Google Custom Search クエリを生成し、
ヒットしたHPから電話番号・問い合わせURLを抽出して
data/companies.json を生成・更新する。

環境変数:
  GOOGLE_CSE_API_KEY  必須 (https://console.cloud.google.com/ で取得)
  GOOGLE_CSE_ID       必須 (https://programmablesearchengine.google.com/ で取得)
  ANTHROPIC_API_KEY   任意 (設定するとClaude APIでクエリ生成・企業判定が高精度化)
  MERGE_WITH_EXISTING 任意 (true なら既存 data/companies.json と統合)

使い方:
  python scripts/discover.py
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTENTS_PATH = ROOT / "scripts" / "intents.json"
OUT_PATH = ROOT / "data" / "companies.json"

GOOGLE_API_KEY = os.environ.get("GOOGLE_CSE_API_KEY", "")
GOOGLE_CSE_ID = os.environ.get("GOOGLE_CSE_ID", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MERGE_WITH_EXISTING = os.environ.get("MERGE_WITH_EXISTING", "true").lower() == "true"

USER_AGENT = "tell-partner-bot/1.0 (+https://github.com/playmark0227-svg/Tell)"
REQUEST_TIMEOUT = 15
PER_DOMAIN_DELAY = 1.2

PHONE_RE = re.compile(
    r"(?<![0-9])"
    r"(?:0(?:120|800|570)|0\d{1,3})"
    r"[-(ー－（]?\d{1,4}[-)ー－）]?\d{3,4}"
    r"(?![0-9])"
)

CONTACT_KEYWORDS = ["contact", "inquiry", "toiawase", "問い合わせ", "問合せ", "お問い合わせ"]

# 検索ノイズになるドメインを除外
EXCLUDED_DOMAINS = {
    "asahi.com", "nikkei.com", "mainichi.jp", "yomiuri.co.jp", "sankei.com",
    "rikunabi.com", "mynavi.jp", "indeed.com", "doda.jp", "type.jp",
    "rakuten.co.jp", "amazon.co.jp", "yahoo.co.jp", "google.com", "google.co.jp",
    "tabelog.com", "hotpepper.jp", "gnavi.co.jp", "retty.me",
    "wikipedia.org", "wikiwand.com", "note.com", "qiita.com", "zenn.dev",
    "facebook.com", "twitter.com", "x.com", "instagram.com", "linkedin.com",
    "youtube.com", "tiktok.com",
    "prtimes.jp", "atpress.ne.jp",
    "houjin-bangou.nta.go.jp",
}


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self.title = ""
        self.meta_description = ""
        self._capture_link = False
        self._capture_title = False
        self._href = ""
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        d = dict(attrs)
        if tag == "a":
            self._capture_link = True
            self._href = d.get("href") or ""
            self._buf = []
        elif tag == "title":
            self._capture_title = True
            self._buf = []
        elif tag == "meta" and d.get("name", "").lower() == "description":
            self.meta_description = d.get("content", "") or ""

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._capture_link:
            self.links.append((self._href, "".join(self._buf).strip()))
            self._capture_link = False
        elif tag == "title" and self._capture_title:
            self.title = "".join(self._buf).strip()
            self._capture_title = False

    def handle_data(self, data: str) -> None:
        if self._capture_link or self._capture_title:
            self._buf.append(data)


def google_search(query: str, start: int = 1, num: int = 10) -> list[dict]:
    params = {
        "key": GOOGLE_API_KEY,
        "cx": GOOGLE_CSE_ID,
        "q": query,
        "start": start,
        "num": min(num, 10),
        "lr": "lang_ja",
        "gl": "jp",
        "hl": "ja",
    }
    url = "https://www.googleapis.com/customsearch/v1?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as r:
            data = json.loads(r.read())
            return data.get("items", [])
    except Exception as e:
        print(f"  google_search failed: {query}: {e}", file=sys.stderr)
        return []


def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as r:
        raw = r.read()
        ctype = r.headers.get("Content-Type", "")
        if "charset=" in ctype:
            enc = ctype.split("charset=")[-1].split(";")[0].strip()
        else:
            enc = "utf-8"
        try:
            return raw.decode(enc, errors="replace")
        except LookupError:
            return raw.decode("utf-8", errors="replace")


def can_fetch(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    rp = urllib.robotparser.RobotFileParser()
    try:
        rp.set_url(robots_url)
        rp.read()
        return rp.can_fetch(USER_AGENT, url)
    except Exception:
        return True


def normalize_phone(p: str) -> str:
    return (
        p.replace("ー", "-")
        .replace("－", "-")
        .replace("（", "(")
        .replace("）", ")")
        .replace("(", "-")
        .replace(")", "-")
        .strip("-")
    )


def extract_phones(html: str) -> list[str]:
    found = [normalize_phone(m.group(0)) for m in PHONE_RE.finditer(html)]
    seen: set[str] = set()
    out: list[str] = []
    for p in found:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def extract_contact_url(html: str, base_url: str) -> str | None:
    parser = LinkExtractor()
    try:
        parser.feed(html)
    except Exception:
        return None
    for href, text in parser.links:
        target = (href or "") + " " + (text or "")
        if any(kw in target.lower() or kw in target for kw in CONTACT_KEYWORDS):
            if href.startswith("http"):
                return href
            return urllib.parse.urljoin(base_url, href)
    return None


def extract_metadata(html: str) -> tuple[str, str]:
    parser = LinkExtractor()
    try:
        parser.feed(html)
    except Exception:
        return "", ""
    return parser.title, parser.meta_description


def domain_of(url: str) -> str:
    return urllib.parse.urlparse(url).netloc.lower()


def root_domain(url: str) -> str:
    d = domain_of(url)
    return d.lstrip("www.")


def is_excluded(url: str) -> bool:
    d = domain_of(url)
    for ex in EXCLUDED_DOMAINS:
        if d == ex or d.endswith("." + ex):
            return True
    return False


def generate_queries_template(product: dict) -> list[str]:
    name = product.get("name", "")
    description = product.get("description", "")
    target = product.get("target", {})
    industries = target.get("industries") or [""]
    prefectures = target.get("prefectures") or [""]
    cities = target.get("cities") or [""]

    queries: list[str] = list(product.get("queries", []) or [])

    for industry in industries[:4]:
        for pref in prefectures[:3]:
            if industry and pref:
                queries.append(f"{industry} {pref} 中小企業 会社概要")
                queries.append(f"{industry} {pref} 株式会社 採用")
            elif industry:
                queries.append(f"{industry} 中小企業 会社概要")
        for city in cities[:2]:
            if industry and city:
                queries.append(f"{industry} {city} 株式会社")

    # 重複除去・空除去
    out = []
    seen: set[str] = set()
    for q in queries:
        q2 = " ".join(q.split())
        if q2 and q2 not in seen:
            seen.add(q2)
            out.append(q2)
    return out


def claude_generate_queries(product: dict) -> list[str]:
    if not ANTHROPIC_API_KEY:
        return generate_queries_template(product)
    prompt = f"""B2B営業の検索クエリ生成エキスパートとして、以下の商材を購入しそうな日本企業をGoogle検索で見つけるためのクエリを8〜12個、日本語で生成してください。

商材: {product.get('name')}
説明: {product.get('description', '')}
ターゲット業種: {', '.join(product.get('target', {}).get('industries', []))}
ターゲット地域: {', '.join(product.get('target', {}).get('prefectures', []))}

要件:
- 各クエリは「業種 + 地域 + キーワード」の組み合わせ
- 「中小企業」「会社概要」「採用」「お問い合わせ」などのキーワードで企業公式HPがヒットしやすく
- JSON配列でクエリ文字列のみ返す。説明文不要。

例: ["金属加工 東京 中小企業 会社概要", "印刷会社 大阪 採用"]"""
    try:
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps({
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}],
            }).encode("utf-8"),
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
        text = data.get("content", [{}])[0].get("text", "")
        m = re.search(r"\[.*\]", text, re.S)
        if m:
            qs = json.loads(m.group(0))
            return list(dict.fromkeys([q for q in qs if isinstance(q, str)]))
    except Exception as e:
        print(f"  claude query gen failed: {e}", file=sys.stderr)
    return generate_queries_template(product)


def size_from_employees(n: int) -> str:
    if n >= 301:
        return "large"
    if n >= 51:
        return "mid"
    return "small"


def enrich_url(url: str, last_per_domain: dict) -> dict | None:
    if is_excluded(url):
        return None
    dom = domain_of(url)
    last = last_per_domain.get(dom, 0.0)
    delta = time.time() - last
    if delta < PER_DOMAIN_DELAY:
        time.sleep(PER_DOMAIN_DELAY - delta)
    last_per_domain[dom] = time.time()

    if not can_fetch(url):
        print(f"  skip (robots): {url}", file=sys.stderr)
        return None

    try:
        html = fetch_html(url)
    except Exception as e:
        print(f"  fetch failed: {url}: {e}", file=sys.stderr)
        return None

    title, meta = extract_metadata(html)
    phones = extract_phones(html)
    contact = extract_contact_url(html, url)

    parsed = urllib.parse.urlparse(url)
    root = f"{parsed.scheme}://{parsed.netloc}"

    return {
        "title": title,
        "description": meta,
        "phone": phones[0] if phones else "",
        "website": root,
        "contact_url": contact or "",
        "source_url": url,
    }


def discover_for_product(product: dict, next_id: int, last_per_domain: dict) -> list[dict]:
    queries = (
        claude_generate_queries(product) if ANTHROPIC_API_KEY else generate_queries_template(product)
    )
    max_q = int(product.get("max_queries", 6))
    max_per_q = int(product.get("max_results_per_query", 8))
    queries = queries[:max_q]
    print(f"product: {product.get('name')} / queries: {len(queries)}", file=sys.stderr)

    seen_domains: set[str] = set()
    results: list[dict] = []
    cur_id = next_id

    for q in queries:
        print(f"  q: {q}", file=sys.stderr)
        items = google_search(q, num=max_per_q)
        for item in items:
            link = item.get("link", "")
            if not link or is_excluded(link):
                continue
            rd = root_domain(link)
            if rd in seen_domains:
                continue
            seen_domains.add(rd)

            enriched = enrich_url(link, last_per_domain)
            if not enriched:
                continue

            name = (enriched["title"] or item.get("title", "")).split(" - ")[0].split("|")[0].strip()
            if not name:
                continue

            company = {
                "id": cur_id,
                "name": name[:80],
                "phone": enriched["phone"],
                "industry": product.get("target", {}).get("industries", ["サービス業"])[0],
                "prefecture": product.get("target", {}).get("prefectures", [""])[0] if product.get("target", {}).get("prefectures") else "",
                "city": product.get("target", {}).get("cities", [""])[0] if product.get("target", {}).get("cities") else "",
                "size": product.get("target", {}).get("sizes", ["small"])[0] if product.get("target", {}).get("sizes") else "small",
                "employees": 50,
                "website": enriched["website"],
                "contact_url": enriched["contact_url"],
                "description": (enriched["description"] or item.get("snippet", ""))[:240],
                "keywords": [k for k in (enriched["description"] or item.get("snippet", "")).split() if len(k) >= 2][:8],
                "found_via_query": q,
                "found_via_product": product.get("name"),
            }
            results.append(company)
            cur_id += 1

    return results


def main() -> int:
    if not GOOGLE_API_KEY or not GOOGLE_CSE_ID:
        print("環境変数 GOOGLE_CSE_API_KEY と GOOGLE_CSE_ID が必要です", file=sys.stderr)
        return 1

    if not INTENTS_PATH.exists():
        print(f"intents file not found: {INTENTS_PATH}", file=sys.stderr)
        print("scripts/intents.example.json をコピーして scripts/intents.json を作ってください", file=sys.stderr)
        return 1

    intents = json.loads(INTENTS_PATH.read_text(encoding="utf-8"))
    products = intents.get("products", [])
    if not products:
        print("intents.json に products が空です", file=sys.stderr)
        return 1

    existing: list[dict] = []
    existing_keys: set[str] = set()
    if MERGE_WITH_EXISTING and OUT_PATH.exists():
        try:
            existing = json.loads(OUT_PATH.read_text(encoding="utf-8"))
            for c in existing:
                p = re.sub(r"[^\d+]", "", c.get("phone", ""))
                if p and len(p) >= 9:
                    existing_keys.add(f"p:{p}")
                else:
                    existing_keys.add(f"d:{root_domain(c.get('website',''))}")
        except Exception:
            existing = []

    next_id = max((c.get("id", 0) for c in existing), default=400000) + 1
    last_per_domain: dict[str, float] = {}
    new_companies: list[dict] = []

    for product in products:
        found = discover_for_product(product, next_id, last_per_domain)
        for c in found:
            p = re.sub(r"[^\d+]", "", c.get("phone", ""))
            key = f"p:{p}" if p and len(p) >= 9 else f"d:{root_domain(c.get('website',''))}"
            if key in existing_keys:
                continue
            existing_keys.add(key)
            new_companies.append(c)
            next_id = c["id"] + 1

    merged = existing + new_companies if MERGE_WITH_EXISTING else new_companies
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n発見: 新規 {len(new_companies)}社、合計 {len(merged)}社", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
