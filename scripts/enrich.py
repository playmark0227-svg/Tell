"""
tell partner - 法人HPから電話・問い合わせURLを抽出するシード型エンリッチャ

使い方:
  1. scripts/seeds.json に対象企業のシード（name + 既知の website）を書く
  2. python scripts/enrich.py で実行
  3. data/companies.json が更新される

GitHub Actions で .github/workflows/enrich.yml が週次実行する想定。

注意:
  - 1ドメインあたり 1.0秒以上のディレイ
  - robots.txt 遵守
  - 公開HPの公開情報のみ収集（個人情報は対象外）
"""
from __future__ import annotations
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.robotparser
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
SEEDS_PATH = ROOT / "scripts" / "seeds.json"
OUT_PATH = ROOT / "data" / "companies.json"

USER_AGENT = "tell-partner-bot/0.1 (+https://github.com/playmark0227-svg/Tell)"
REQUEST_TIMEOUT = 15
PER_DOMAIN_DELAY = 1.2

PHONE_RE = re.compile(
    r"(?<![0-9])"
    r"(?:0(?:120|800|570)|0\d{1,3})"
    r"[-(ー－（]?\d{1,4}[-)ー－）]?\d{3,4}"
    r"(?![0-9])"
)

CONTACT_KEYWORDS = ["contact", "inquiry", "toiawase", "問い合わせ", "問合せ", "お問い合わせ"]


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._capture = False
        self._href = ""
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            href = dict(attrs).get("href") or ""
            self._capture = True
            self._href = href
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._capture:
            text = "".join(self._buf).strip()
            self.links.append((self._href, text))
            self._capture = False

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buf.append(data)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as r:
        raw = r.read()
        # encoding detection (simple)
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
        return True  # robots.txt なければ許可


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
    # 重複除外、順序保持
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


def enrich_seed(seed: dict) -> dict:
    website = seed.get("website", "")
    company: dict = {
        "id": seed["id"],
        "name": seed["name"],
        "industry": seed.get("industry", "サービス業"),
        "prefecture": seed.get("prefecture", ""),
        "city": seed.get("city", ""),
        "size": seed.get("size", "small"),
        "employees": seed.get("employees", 30),
        "description": seed.get("description", ""),
        "keywords": seed.get("keywords", []),
        "phone": "",
        "website": website,
        "contact_url": "",
    }
    if not website:
        return company

    if not can_fetch(website):
        print(f"  skip (robots.txt disallow): {website}", file=sys.stderr)
        return company

    try:
        html = fetch(website)
    except Exception as e:
        print(f"  fetch failed: {website}: {e}", file=sys.stderr)
        return company

    phones = extract_phones(html)
    if phones:
        company["phone"] = phones[0]

    contact = extract_contact_url(html, website)
    if contact:
        company["contact_url"] = contact

    return company


def main() -> int:
    if not SEEDS_PATH.exists():
        print(f"seeds file not found: {SEEDS_PATH}", file=sys.stderr)
        print("scripts/seeds.example.json をコピーして scripts/seeds.json を作ってください", file=sys.stderr)
        return 1

    seeds = json.loads(SEEDS_PATH.read_text(encoding="utf-8"))
    print(f"seeds: {len(seeds)}件", file=sys.stderr)

    results: list[dict] = []
    last_domain_time: dict[str, float] = {}
    for seed in seeds:
        website = seed.get("website", "")
        if website:
            domain = urllib.parse.urlparse(website).netloc
            last = last_domain_time.get(domain, 0.0)
            delta = time.time() - last
            if delta < PER_DOMAIN_DELAY:
                time.sleep(PER_DOMAIN_DELAY - delta)
        print(f"[{seed['id']}] {seed['name']}", file=sys.stderr)
        company = enrich_seed(seed)
        results.append(company)
        if website:
            last_domain_time[urllib.parse.urlparse(website).netloc] = time.time()

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(results, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"wrote: {OUT_PATH} ({len(results)}件)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
