"""Wikispeedia loader on a tiny fixture graph: distances, oracle links, lead extraction, human stats, determinism."""
from collections import deque

import pytest

from decida import datasets as D
from decida import wikispeedia as W

LINKS = {"Alpha": ["Beta", "Gamma"], "Beta": ["Delta"], "Gamma": ["Delta", "Beta"], "Delta": ["Epsilon"], "Epsilon": ["Alpha"], "Zeta": []}
NAMES = list(LINKS)

PROSE = ("The alpha is the first thing in the list and it is described here in some detail so that the paragraph is long enough "
         "to count as prose. It has a second sentence that adds a little more. And a third one for good measure.")


HTML_PAGE = """<html><body><div id="bodyContent">
 <h3 id="siteSub">2007 Schools Wikipedia Selection.</h3>
 <div class="thumb"><div><a href="x"><img alt="Alpha picture" src="../../images/1/a.jpg" /></a> An image caption that must not appear.</div></div>
 <p>The <b>alpha</b> is the <a href="../../wp/f/First.htm">first</a> letter<sup>[1]</sup> of the alphabet ( see below ), used widely.
 <p>A second paragraph, unclosed like the real pages, continues the intro.
 <script type="text/javascript">var hidden = 1;</script><a id="History"></a><h2><span>History</span></h2>
 <p>This paragraph is after the first heading and must not be in the lead. See <a href="../../wp/b/Beta.htm">Beta</a>.</p>
</div></body></html>"""


def article_text(title: str, prose: str = PROSE) -> str:
    return (f"   #copyright\n\n{title}\n\n2007 Schools Wikipedia Selection. Related subjects: Testing\n\n"
            f"   Flag of {title}\n   Capital City\n   Enlarge\n\n   {prose}\n")


def bfs(src: str) -> dict[str, int]:
    seen, q = {src: 0}, deque([src])
    while q:
        u = q.popleft()
        for v in LINKS[u]:
            if v not in seen:
                seen[v] = seen[u] + 1; q.append(v)
    return seen


@pytest.fixture
def wiki(tmp_path, monkeypatch):
    monkeypatch.setenv("DECIDA_DATA_DIR", str(tmp_path))
    ds = D.get("wikispeedia")
    top = D.root(ds); g = top / W.GRAPH_PART; t = top / W.TEXT_PART
    g.mkdir(parents=True); t.mkdir()
    (g / "articles.tsv").write_text("# header\n\n" + "\n".join(W.encode(n) for n in NAMES) + "\n")
    (g / "links.tsv").write_text("# h\n" + "".join(f"{a}\t{b}\n" for a, bs in LINKS.items() for b in bs) + "Alpha\tNotAnArticle\n")
    (g / "categories.tsv").write_text("# h\nAlpha\tsubject.Science.Physics.Waves\nBeta\tsubject.Countries\n")
    rows = ""
    for a in NAMES:
        d = bfs(a); rows += "".join(str(d[b]) if b in d else "_" for b in NAMES) + "\n"
    (g / "shortest-path-distance-matrix.txt").write_text("# matrix\n" + rows)
    (g / "paths_finished.tsv").write_text(
        "# h\n" + "".join(f"h\t1\t10\t{p}\tNULL\n" for p in [
            "Alpha;Beta;Delta", "Alpha;Gamma;Delta", "Alpha;Beta;<;Gamma;Delta", "Alpha;Beta;Delta;Epsilon", "Alpha;Beta;Delta", "Alpha;Gamma;Delta"]))
    for n in NAMES:
        (t / f"{W.encode(n)}.txt").write_text(article_text(n))
    (t / "Beta.txt").write_text("   #copyright\n\nBeta\n\n2007 Schools\n\n   Only a caption here\n")   # no prose at all
    pages = top / W.HTML_PART / "wp" / "a"; pages.mkdir(parents=True)
    (pages / "Alpha.htm").write_text(HTML_PAGE)
    (top / W.HTML_PART / "images" / "1").mkdir(parents=True); (top / W.HTML_PART / "images" / "1" / "a.jpg").write_bytes(b"JPEGDATA")
    for p in ds.parts:
        (top / f".ok-{p.name}").write_text(p.sha256)
    return W.Wikispeedia.load()


def test_load_requires_the_dataset(tmp_path, monkeypatch):
    monkeypatch.setenv("DECIDA_DATA_DIR", str(tmp_path))
    with pytest.raises(D.DatasetError, match="not downloaded"):
        W.Wikispeedia.load()


def test_graph_and_distances(wiki):
    assert wiki.articles == NAMES
    assert wiki.links_from("Alpha") == ["Beta", "Gamma"]          # the link to an unknown article is dropped
    assert wiki.hops("Alpha", "Delta") == 2 and wiki.hops("Alpha", "Alpha") == 0 and wiki.hops("Alpha", "Epsilon") == 3
    assert wiki.hops("Zeta", "Alpha") is None and wiki.hops("Alpha", "Zeta") is None and wiki.hops("Alpha", "nope") is None


def test_best_links_are_the_ones_that_shorten_the_way(wiki):
    assert wiki.best_links("Alpha", "Delta") == ["Beta", "Gamma"]     # both are one step from Delta
    assert wiki.best_links("Gamma", "Beta") == ["Beta"]
    assert wiki.best_links("Alpha", "Alpha") == [] and wiki.best_links("Zeta", "Alpha") == []


def test_lead_prefers_the_html_page_and_stops_at_the_first_heading(wiki):
    lead = wiki.lead("Alpha")
    assert lead == "The alpha is the first letter of the alphabet (see below), used widely. A second paragraph, unclosed like the real pages, continues the intro."
    assert "caption" not in lead and "hidden" not in lead and "after the first heading" not in lead and "[1]" not in lead


def test_lead_falls_back_to_plaintext_and_skips_the_infobox(wiki):
    lead = wiki.lead("Gamma")                                          # no HTML page for Gamma
    assert lead.startswith("The alpha is the first thing") and "Capital City" not in lead and "Enlarge" not in lead
    assert wiki.lead("Beta") == "Beta"                                # no prose: falls back to the title, never empty


def test_summary_is_one_short_sentence_cut_cleanly(wiki):
    s = wiki.summary("Gamma")
    assert len(s) <= W.SUMMARY_CHARS + 3 and "second sentence" not in s


def test_first_sentences_boundaries():
    assert W.first_sentences("One. Two. Three.", 9) == "One. Two."
    long = "word " * 100
    cut = W.first_sentences(long, 50)
    assert cut.endswith("...") and len(cut) <= 53


def test_article_view_carries_the_oracle_distances(wiki):
    a = wiki.article("Alpha", target="Delta")
    assert a.hops_to_target == 2 and [(l.title, l.hops_to_target) for l in a.links] == [("Beta", 1), ("Gamma", 1)]
    assert a.category == "Science > Physics" and wiki.article("Alpha").links[0].hops_to_target is None
    with pytest.raises(KeyError):
        wiki.article("nope")


def test_hub_is_derived_from_the_data_and_links_lead_somewhere(wiki):
    degrees = sorted(len(v) for v in LINKS.values())          # [0, 1, 1, 1, 2, 2]
    assert wiki.hub_degree == degrees[int(0.9 * (len(degrees) - 1))] == 2
    assert wiki.is_hub("Alpha") and wiki.is_hub("Gamma") and not wiki.is_hub("Beta") and not wiki.is_hub("Zeta")
    a = wiki.article("Alpha")
    assert [(l.title, l.hub, l.leads_to) for l in a.links] == [("Beta", False, ["Delta"]), ("Gamma", True, ["Delta", "Beta"])]


def test_human_stats_and_missions(wiki):
    plays, mean, best = wiki.human("Alpha", "Delta")
    assert (plays, best) == (5, 2) and mean == pytest.approx(2.2)   # the path with a back click counts its forward clicks only (3)
    assert wiki.human("Alpha", "Zeta") is None
    m = wiki.missions(min_plays=5)
    assert [(x.start, x.target, x.plays, x.record_clicks, x.hops) for x in m] == [("Alpha", "Delta", 5, 2, 2)]
    assert wiki.missions(min_plays=6) == []


def test_pair_is_deterministic_and_within_range(wiki):
    a = wiki.pair(7, min_hops=2, max_hops=3)
    assert a == wiki.pair(7, min_hops=2, max_hops=3) and 2 <= wiki.hops(*a) <= 3
    with pytest.raises(D.DatasetError):
        wiki.pair(1, min_hops=9, max_hops=9)
