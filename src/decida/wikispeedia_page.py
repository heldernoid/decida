"""Turn a Wikispeedia article page (old-style HTML from the Wikipedia for Schools package) into safe HTML for the game page.

Only the article body is kept. Tags and attributes come from an allow-list, scripts and styles are dropped, inline styles are cut
down to a few layout properties, links to other articles in the game become `<a class="wiki-link" data-title="...">` (all other
links are removed but their text stays), and image paths are rewritten to our asset endpoint. Standard library only.
"""
from __future__ import annotations

import html
import re
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path

ALLOWED = {"p", "b", "i", "em", "strong", "u", "a", "ul", "ol", "li", "dl", "dt", "dd", "h2", "h3", "h4", "h5", "table", "thead", "tbody", "tfoot",
           "tr", "td", "th", "caption", "div", "span", "img", "br", "sup", "sub", "blockquote", "small", "big", "center", "cite", "code", "pre"}
VOID = {"img", "br"}
DROP_WITH_CONTENT = {"script", "style", "iframe", "object", "embed", "form", "select", "textarea", "noscript", "head", "title"}
ATTRS = {"td": {"colspan", "rowspan", "align", "valign"}, "th": {"colspan", "rowspan", "align", "valign"}, "img": {"alt", "width", "height"},
         "table": {"align", "cellpadding", "cellspacing", "border"}, "div": {"align"}, "p": {"align"}}
STYLE_OK = {"width", "float", "clear", "text-align", "vertical-align", "background", "background-color", "margin", "padding", "border",
            "border-top", "border-bottom", "border-left", "border-right", "font-size", "font-weight", "white-space", "line-height", "color", "height"}
KEEP_CLASS = {"thumb", "tright", "tleft", "thumbinner", "thumbcaption", "infobox", "toc", "center", "floatright", "floatleft", "wikitable", "noprint"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".svg"}
_LINK = re.compile(r"^(?:\.\./)+wp/[^/]+/(.+)\.htm$")
_ASSET = re.compile(r"^(?:\.\./)+(images/.+)$")


def decode_title(name: str) -> str:
    """Article hrefs are percent-encoded twice, unlike the file names."""
    return urllib.parse.unquote(urllib.parse.unquote(name)).replace("_", " ")


def safe_style(value: str) -> str:
    keep = []
    for decl in value.split(";"):
        if ":" not in decl:
            continue
        prop, val = (x.strip() for x in decl.split(":", 1))
        if prop.lower() in STYLE_OK and not re.search(r"url\(|expression|javascript|@import|behavior|\\", val, re.IGNORECASE):
            keep.append(f"{prop.lower()}:{val}")
    return ";".join(keep)


class _Sanitizer(HTMLParser):
    def __init__(self, valid_titles: frozenset[str] | set[str], asset_prefix: str):
        super().__init__(convert_charrefs=True)
        self.valid, self.prefix = valid_titles, asset_prefix
        self.out: list[str] = []
        self.in_body, self.done = False, False
        self.drop_depth = 0            # inside script/style/...: skip everything until it closes
        self.drop_tag = ""
        self.skip_h3 = False           # the "2007 Schools Wikipedia Selection" banner
        self.a_stack: list[bool] = []  # per open <a>: did we emit a tag for it?

    # --- helpers
    def _attrs(self, tag: str, attrs: list[tuple[str, str | None]]) -> str:
        parts = []
        for name, value in attrs:
            v = value or ""
            if name in ATTRS.get(tag, ()):
                parts.append(f'{name}="{html.escape(v, quote=True)}"')
            elif name == "style":
                s = safe_style(v)
                if s:
                    parts.append(f'style="{html.escape(s, quote=True)}"')
            elif name == "class":
                cls = " ".join(c for c in v.split() if c in KEEP_CLASS)
                if cls:
                    parts.append(f'class="{cls}"')
        return (" " + " ".join(parts)) if parts else ""

    # --- parser events
    def handle_comment(self, data):
        if self.in_body and data.strip() == "end content":
            self.done = True

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        a = dict(attrs)
        if not self.in_body:
            self.in_body = a.get("id") == "bodyContent"
            return
        if self.drop_depth:
            if tag == self.drop_tag:
                self.drop_depth += 1
            return
        if tag in DROP_WITH_CONTENT:
            self.drop_depth, self.drop_tag = 1, tag
            return
        if tag == "h3" and a.get("id") == "siteSub":
            self.skip_h3 = True
            return
        if tag == "div" and "printfooter" in (a.get("class") or ""):
            self.done = True
            return
        if self.skip_h3:
            return
        if tag == "a":
            m = _LINK.match(a.get("href") or "")
            title = decode_title(m.group(1)) if m else None
            if title is not None and title in self.valid:
                self.out.append(f'<a href="#" class="wiki-link" data-title="{html.escape(title, quote=True)}">')
                self.a_stack.append(True)
            else:
                self.a_stack.append(False)
            return
        if tag == "img":
            m = _ASSET.match(a.get("src") or "")
            rel = m.group(1) if m else None
            if rel and not rel.startswith("images/0/") and Path(rel).suffix.lower() in IMAGE_EXT:
                self.out.append(f'<img src="{self.prefix}{html.escape(rel, quote=True)}"{self._attrs("img", attrs)} loading="lazy" />')
            return
        if tag in ALLOWED:
            self.out.append(f"<{tag}{self._attrs(tag, attrs)}{' /' if tag in VOID else ''}>")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if self.done or not self.in_body:
            return
        if self.drop_depth:
            if tag == self.drop_tag:
                self.drop_depth -= 1
            return
        if tag == "h3" and self.skip_h3:
            self.skip_h3 = False
            return
        if self.skip_h3:
            return
        if tag == "a":
            if self.a_stack and self.a_stack.pop():
                self.out.append("</a>")
            return
        if tag in ALLOWED and tag not in VOID:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self.in_body and not self.done and not self.drop_depth and not self.skip_h3:
            self.out.append(html.escape(data, quote=False))


def sanitize(raw: str, valid_titles: frozenset[str] | set[str], asset_prefix: str) -> str:
    """Safe HTML for the article body of `raw`; empty if the page has no body."""
    p = _Sanitizer(valid_titles, asset_prefix)
    p.feed(raw)
    return "".join(p.out).strip()


def asset_file(root: Path, rel: str) -> Path | None:
    """A file under `root/images/...` for the asset endpoint, or None. Nothing outside that folder can be reached."""
    images = (root / "images").resolve()
    try:
        p = (root / rel).resolve()
    except (OSError, ValueError):
        return None
    if not rel.startswith("images/") or not p.is_relative_to(images) or p.suffix.lower() not in IMAGE_EXT or not p.is_file():
        return None
    return p
