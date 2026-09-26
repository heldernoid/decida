"""The article sanitizer: only safe, allow-listed HTML comes out, game links are tagged, images point at our endpoint."""
from pathlib import Path

from decida import wikispeedia_page as P

VALID = {"Spanish language", "Antarctica"}
PAGE = """<html><head><title>x</title><script>var head = 1;</script></head><body>
<div id="bodyContent">
 <h3 id="siteSub"><a href="../../index.htm">2007 Schools Wikipedia Selection</a>. Related subjects: <a href="../index/subject.X.htm">X</a></h3>
 <!-- start content -->
 <div class="thumb tright evil" onclick="steal()" style="width:302px;background:url(javascript:x);float:right"><a class="internal" href="../../images/134/13478.jpg.htm"><img alt="A tornado" src="../../images/134/13478.jpg" width="300" onerror="x()" /></a>
  <div class="magnify"><a href="../../images/134/13478.jpg.htm"><img alt="Enlarge" src="../../images/0/1.png" /></a></div></div>
 <p>The word <b>tornado</b> comes from <a href="../../wp/s/Spanish_language.htm" title="Spanish language">Spanish</a> and
 <a href="../../wp/a/Antarctica.htm">Antarctica</a>, not <a href="../../wp/n/Not_In_Game.htm">this</a> or <a href="http://evil.example/">that</a>.
 <script>alert(1)</script><style>p{display:none}</style><iframe src="http://evil.example/"></iframe><form action="x"><input name="q"></form>
 <p>Second paragraph &amp; more &lt;tags&gt;.<sup>[1]</sup>
 <table style="width:23em;color:red;position:fixed"><tr><td colspan="2" style="text-align:center">cell</td></tr></table>
 <h2><span>History</span></h2>
 <p><a href="../../wp/%25C3%2581/%25C3%2581ed%25C3%25A1n.htm">accent</a>
 <div class="printfooter">Retrieved from ... </div>
 <!-- end content -->
</div><div id="footer">footer text</div></body></html>"""
OUT = P.sanitize(PAGE, VALID | {"Áedán"}, "/v1/wikispeedia/asset/")


def test_only_the_article_body_survives():
    assert "footer text" not in OUT and "Retrieved from" not in OUT and "Schools Wikipedia Selection" not in OUT
    assert "var head" not in OUT and "alert(1)" not in OUT and "display:none" not in OUT and "evil.example" not in OUT
    assert "<script" not in OUT and "<iframe" not in OUT and "<form" not in OUT and "<input" not in OUT and "<style" not in OUT


def test_game_links_are_tagged_and_other_links_lose_their_tag_but_keep_text():
    assert '<a href="#" class="wiki-link" data-title="Spanish language">Spanish</a>' in OUT
    assert 'data-title="Antarctica"' in OUT
    assert "Not_In_Game" not in OUT and ">this<" not in OUT and "this" in OUT and "that" in OUT
    assert 'data-title="Áedán"' in OUT                    # double-encoded href decodes to the real title
    assert "href=\"../../" not in OUT and "images/134/13478.jpg.htm" not in OUT


def test_images_point_at_the_asset_endpoint_and_icons_are_dropped():
    assert 'src="/v1/wikispeedia/asset/images/134/13478.jpg"' in OUT and 'alt="A tornado"' in OUT
    assert "images/0/1.png" not in OUT and "Enlarge" not in OUT
    assert "onerror" not in OUT and "onclick" not in OUT


def test_styles_and_classes_are_cut_down_and_text_is_escaped():
    assert "url(" not in OUT and "javascript" not in OUT and "position" not in OUT and "color:red" in OUT
    assert "width:302px" in OUT and "float:right" in OUT and 'class="thumb tright"' in OUT and "evil" not in OUT
    assert "Second paragraph &amp; more &lt;tags&gt;." in OUT and 'colspan="2"' in OUT


def test_safe_style_rules():
    assert P.safe_style("width:10px; behavior:url(x); float:left; background:url(a)") == "width:10px;float:left"
    assert P.safe_style("nonsense") == ""


def test_asset_file_cannot_leave_the_images_folder(tmp_path: Path):
    img = tmp_path / "images" / "1"; img.mkdir(parents=True)
    (img / "a.jpg").write_bytes(b"x"); (tmp_path / "secret.jpg").write_bytes(b"s"); (img / "b.txt").write_text("t")
    assert P.asset_file(tmp_path, "images/1/a.jpg") == (img / "a.jpg").resolve()
    for bad in ["../secret.jpg", "images/../secret.jpg", "images/1/../../secret.jpg", "images/1/b.txt", "images/1/missing.jpg", "secret.jpg", "/etc/passwd"]:
        assert P.asset_file(tmp_path, bad) is None, bad
