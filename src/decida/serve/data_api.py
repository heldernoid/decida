"""REST endpoints for bench datasets: what is downloaded, start a download, and the Wikispeedia game data."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from decida import datasets, wikispeedia

router = APIRouter()
downloads = datasets.Downloads()
_wiki: wikispeedia.Wikispeedia | None = None


def wiki() -> wikispeedia.Wikispeedia:
    """The loaded Wikispeedia data, or a 409 that tells the caller to download it first."""
    global _wiki
    if _wiki is None:
        try:
            _wiki = wikispeedia.Wikispeedia.load()
        except datasets.DatasetError as exc:
            raise HTTPException(409, f"{exc}. POST /v1/datasets/wikispeedia/download to fetch it (about 840 MB).") from exc
    return _wiki


@router.get("/v1/datasets")
async def list_datasets():
    return {"datasets": [downloads.status(i).model_dump() for i in sorted(datasets.REGISTRY)]}


@router.get("/v1/datasets/{dataset_id}")
async def dataset_status(dataset_id: str):
    try:
        return downloads.status(dataset_id).model_dump()
    except datasets.DatasetError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/v1/datasets/{dataset_id}/download")
async def dataset_download(dataset_id: str):
    """Start (or report on) a background download. Returns at once; poll GET /v1/datasets/{id} for progress."""
    try:
        return downloads.start(dataset_id).model_dump()
    except datasets.DatasetError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/v1/wikispeedia/missions")
async def missions(min_plays: int = Query(5, ge=1), limit: int = Query(200, ge=1, le=2000)):
    w = wiki()
    ms = sorted(w.missions(min_plays), key=lambda m: -m.plays)[:limit]
    return {"missions": [m.model_dump() for m in ms]}


@router.get("/v1/wikispeedia/pair")
async def pair(seed: int = 1, min_hops: int = Query(2, ge=1, le=9), max_hops: int = Query(4, ge=1, le=9)):
    w = wiki()
    try:
        start, target = w.pair(seed, min_hops, max_hops)
    except datasets.DatasetError as exc:
        raise HTTPException(404, str(exc)) from exc
    human = w.human(start, target)
    return {"start": start, "target": target, "hops": w.hops(start, target),
            "human": None if human is None else {"plays": human[0], "avg_clicks": round(human[1], 2), "record_clicks": human[2]}}


@router.get("/v1/wikispeedia/article")
async def article(title: str, target: str | None = None):
    w = wiki()
    try:
        return w.article(title, target).model_dump()
    except KeyError:
        raise HTTPException(404, f"no such article: {title!r}") from None


@router.get("/v1/wikispeedia/search")
async def search(q: str, limit: int = Query(8, ge=1, le=50)):
    return {"titles": wiki().search(q, limit)}


@router.get("/v1/wikispeedia/page")
async def page(title: str):
    """The article as safe HTML with images pointing at /v1/wikispeedia/asset/, plus its subject category."""
    w = wiki()
    try:
        return {"title": title, "category": w.category(title), "html": w.page_html(title, "/v1/wikispeedia/asset/")}
    except KeyError:
        raise HTTPException(404, f"no page for {title!r}") from None


@router.get("/v1/wikispeedia/asset/{rel:path}")
async def asset(rel: str):
    path = wiki().asset(rel)
    if path is None:
        raise HTTPException(404, "no such image")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})
