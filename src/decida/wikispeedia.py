"""Wikispeedia: the 4,604-article link graph, article text and recorded human paths, for the navigation bench.

The task is a walk: from a start article to a target article, clicking only links on the page. Gold labels are executable
and exact: the dataset ships the shortest-path matrix, so for any page and target we know which links get closer. Nothing
here calls a model. Data comes from `decida.datasets` and must already be downloaded.
"""
from __future__ import annotations

import random
import re
import urllib.parse
from dataclasses import dataclass
from functools import cached_property
from html.parser import HTMLParser
from pathlib import Path

from pydantic import BaseModel

from decida import datasets, wikispeedia_page

GRAPH_PART = "wikispeedia_paths-and-graph"
TEXT_PART = "plaintext_articles"
HTML_PART = "wpcd"
MAX_LEAD_CHARS = 700
SUMMARY_CHARS = 170
MIN_PROSE_WORDS = 18
LEADS_TO = 10


def decode(name: str) -> str:
    return urllib.parse.unquote(name).replace("_", " ")


def encode(title: str) -> str:
    return urllib.parse.quote(title.replace(" ", "_"), safe="")


def _rows(path: Path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if line and not line.startswith("#"):
                yield line.split("\t")


class Mission(BaseModel):
    start: str
    target: str
    plays: int
    avg_clicks: float
    record_clicks: int
    hops: int | None        # shortest possible, from the dataset's own matrix


class LinkView(BaseModel):
    title: str
    summary: str
    category: str
    hub: bool               # a broad overview page: its number of links is in the top tenth of all pages (no raw counts leave the server)
    leads_to: list[str]     # titles it links to, first few, in page order: what a player sees once they open it
    hops_to_target: int | None


class ArticleView(BaseModel):
    title: str
    category: str
    lead: str
    hops_to_target: int | None
    links: list[LinkView]


_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")


def first_sentences(text: str, max_chars: int) -> str:
    """As many whole sentences as fit in `max_chars`; if even the first is too long, cut it at a word boundary."""
    out = ""
    for s in _SENTENCE_END.split(text):
        if out and len(out) + 1 + len(s) > max_chars:
            break
        out = f"{out} {s}".strip()
        if len(out) >= max_chars:
            break
    if len(out) > max_chars:
        out = out[:max_chars].rsplit(" ", 1)[0].rstrip(",;:") + "..."
    return out


def lead_text(raw: str) -> str:
    """The first real prose paragraph of an article's plain text. The dump is full of infobox rows and image captions, so a
    paragraph counts as prose if it has enough words, a sentence end, and mostly lower-case words."""
    blocks = re.split(r"\n\s*\n", raw)
    for block in blocks[2:]:                       # blocks 0 and 1 are the licence tag, title and selection line
        text = " ".join(block.split())
        words = text.split()
        if len(words) < MIN_PROSE_WORDS or not re.search(r"[.!?]", text):
            continue
        if sum(w[:1].islower() for w in words) < 0.5 * len(words):
            continue
        if "Enlarge" in text or text.startswith("SOS Children"):
            continue
        return first_sentences(text, MAX_LEAD_CHARS)
    return ""


_BLOCK = {"p", "div", "table", "ul", "ol", "dl", "h1", "h2", "h3", "h4", "blockquote", "pre", "tr"}
_SKIP = {"sup", "script", "style"}


class _LeadParser(HTMLParser):
    """Collects the paragraphs of an article's intro: every <p> in #bodyContent up to the first <h2>. These pages are old-style HTML
    with unclosed <p> tags, so a paragraph runs from its <p> to the next block-level tag instead of relying on nesting."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_body, self.cur, self.paras, self.stop, self.skip = False, None, [], False, 0

    def _flush(self) -> None:
        if self.cur is not None:
            text = " ".join("".join(self.cur).split())
            if text:
                self.paras.append(text)
        self.cur = None

    def handle_starttag(self, tag, attrs):
        if self.stop:
            return
        if not self.in_body:
            self.in_body = dict(attrs).get("id") == "bodyContent"
            return
        if tag == "h2":
            self._flush()
            self.stop = True
            return
        if tag in _BLOCK:
            self._flush()
        if tag == "p":
            self.cur = []
        if tag in _SKIP:
            self.skip += 1

    def handle_endtag(self, tag):
        if self.stop or not self.in_body:
            return
        if tag in _SKIP and self.skip:
            self.skip -= 1
        if tag in _BLOCK:
            self._flush()

    def handle_data(self, data):
        if self.cur is not None and not self.skip and not self.stop:
            self.cur.append(data)


def html_lead(raw: str) -> str:
    """The intro of an article from its HTML page, as clean text (empty if the page has none)."""
    parser = _LeadParser()
    parser.feed(raw)
    parser._flush()
    text = re.sub(r"\s+([,.;:)])", r"\1", " ".join(parser.paras))
    return first_sentences(re.sub(r"\(\s+", "(", text), MAX_LEAD_CHARS)


@dataclass
class Wikispeedia:
    root: Path

    @classmethod
    def load(cls) -> Wikispeedia:
        ds = datasets.get("wikispeedia")
        if not datasets.is_present(ds.id):
            raise datasets.DatasetError("Wikispeedia is not downloaded yet")
        return cls(datasets.root(ds))

    @property
    def _graph(self) -> Path:
        return self.root / GRAPH_PART

    @property
    def _text(self) -> Path:
        return self.root / TEXT_PART

    @cached_property
    def articles(self) -> list[str]:
        return [decode(r[0]) for r in _rows(self._graph / "articles.tsv")]

    @cached_property
    def _index(self) -> dict[str, int]:
        return {t: i for i, t in enumerate(self.articles)}

    @cached_property
    def out_links(self) -> dict[str, list[str]]:
        known, out = set(self.articles), {}
        for row in _rows(self._graph / "links.tsv"):
            if len(row) == 2:
                a, b = decode(row[0]), decode(row[1])
                if a in known and b in known and b not in out.setdefault(a, []):
                    out[a].append(b)
        return out

    @cached_property
    def _dist(self) -> list[str]:
        with open(self._graph / "shortest-path-distance-matrix.txt", encoding="utf-8") as f:
            rows = [ln.rstrip("\n") for ln in f if ln.strip() and not ln.startswith("#")]
        if len(rows) != len(self.articles):
            raise datasets.DatasetError(f"distance matrix has {len(rows)} rows for {len(self.articles)} articles")
        return rows

    @cached_property
    def _category(self) -> dict[str, str]:
        cats: dict[str, str] = {}
        for row in _rows(self._graph / "categories.tsv"):
            if len(row) == 2:
                title = decode(row[0])
                parts = [p.replace("_", " ") for p in row[1].split(".")[1:]]
                cats.setdefault(title, " > ".join(parts[:2]))
        return cats

    @cached_property
    def hub_degree(self) -> int:
        """Out-degree from which a page counts as a hub: the 90th percentile over all pages, derived from the data."""
        degrees = sorted(len(self.links_from(t)) for t in self.articles)
        return degrees[int(0.9 * (len(degrees) - 1))]

    def is_hub(self, title: str) -> bool:
        return len(self.links_from(title)) >= self.hub_degree > 0

    def category(self, title: str) -> str:
        return self._category.get(title, "")

    def hops(self, a: str, b: str) -> int | None:
        ia, ib = self._index.get(a), self._index.get(b)
        if ia is None or ib is None:
            return None
        c = self._dist[ia][ib]
        return None if c == "_" else int(c)

    def links_from(self, title: str) -> list[str]:
        return self.out_links.get(title, [])

    def best_links(self, current: str, target: str) -> list[str]:
        """Oracle: the links from `current` that shorten the way to `target` (all of them when several tie)."""
        d = self.hops(current, target)
        if d is None or d == 0:
            return []
        return [b for b in self.links_from(current) if self.hops(b, target) == d - 1]

    def _raw(self, title: str) -> str:
        path = self._text / f"{encode(title)}.txt"
        return path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""

    @cached_property
    def _pages(self) -> dict[str, Path]:
        """Article title -> its HTML page, from the full package (wpcd/wp/<letter>/<Title>.htm)."""
        return {decode(p.stem): p for p in (self.root / HTML_PART / "wp").glob("*/*.htm")}

    def lead(self, title: str) -> str:
        """The intro of the article: from its real HTML page when the package is there, else the plain-text heuristic, else its title."""
        page = self._pages.get(title)
        if page is not None:
            text = html_lead(page.read_text(encoding="utf-8", errors="replace"))
            if text:
                return text
        return lead_text(self._raw(title)) or title

    def summary(self, title: str) -> str:
        return first_sentences(self.lead(title), SUMMARY_CHARS)

    def search(self, q: str, limit: int = 8) -> list[str]:
        """Titles matching what someone typed: those that start with it first, then those that contain it (case-insensitive)."""
        q = q.strip().lower()
        if not q:
            return []
        starts = [t for t in self.articles if t.lower().startswith(q)]
        inside = [t for t in self.articles if q in t.lower() and not t.lower().startswith(q)]
        return (starts + inside)[:limit]

    def page_html(self, title: str, asset_prefix: str) -> str:
        """The article as safe HTML for display (images point at `asset_prefix`), from its real page. KeyError if there is none."""
        path = self._pages[title]
        return wikispeedia_page.sanitize(path.read_text(encoding="utf-8", errors="replace"), frozenset(self.articles), asset_prefix)

    def asset(self, rel: str) -> Path | None:
        return wikispeedia_page.asset_file(self.root / HTML_PART, rel)

    def article(self, title: str, target: str | None = None) -> ArticleView:
        if title not in self._index:
            raise KeyError(title)
        dist = (lambda t: self.hops(t, target)) if target else (lambda t: None)
        links = [LinkView(title=t, summary=self.summary(t), category=self.category(t), hub=self.is_hub(t),
                          leads_to=self.links_from(t)[:LEADS_TO], hops_to_target=dist(t))
                 for t in self.links_from(title)]
        return ArticleView(title=title, category=self.category(title), lead=self.lead(title), hops_to_target=dist(title), links=links)

    @cached_property
    def _human(self) -> dict[tuple[str, str], list[int]]:
        stats: dict[tuple[str, str], list[int]] = {}
        for row in _rows(self._graph / "paths_finished.tsv"):
            if len(row) < 4:
                continue
            path = [decode(p) for p in row[3].split(";") if p != "<"]   # "<" is a back click: not a forward click, not a stop
            if len(path) >= 2 and path[0] in self._index and path[-1] in self._index:
                stats.setdefault((path[0], path[-1]), []).append(len(path) - 1)
        return stats

    def human(self, start: str, target: str) -> tuple[int, float, int] | None:
        """(finished plays, mean clicks, fewest clicks) among recorded human finishes of this exact pair, else None."""
        clicks = self._human.get((start, target))
        return (len(clicks), sum(clicks) / len(clicks), min(clicks)) if clicks else None

    def missions(self, min_plays: int = 5) -> list[Mission]:
        out = []
        for (s, t), clicks in sorted(self._human.items()):
            if len(clicks) >= min_plays and s != t:
                out.append(Mission(start=s, target=t, plays=len(clicks), avg_clicks=round(sum(clicks) / len(clicks), 2),
                                   record_clicks=min(clicks), hops=self.hops(s, t)))
        return out

    def pair(self, seed: int, min_hops: int = 2, max_hops: int = 5) -> tuple[str, str]:
        """A start/target pair with a shortest path between `min_hops` and `max_hops`; the same seed always gives the same pair."""
        rng = random.Random(seed)
        starts = [a for a in self.articles if self.out_links.get(a)]
        for _ in range(5000):
            a, b = rng.choice(starts), rng.choice(self.articles)
            d = self.hops(a, b)
            if d is not None and min_hops <= d <= max_hops:
                return a, b
        raise datasets.DatasetError(f"no pair with {min_hops}..{max_hops} hops found")
