.PHONY: setup test lint format smoke

setup:
	uv sync --all-extras

test:
	uv run pytest -q
	node --test tests/js/*.test.mjs

lint:
	uv run ruff check .
	uv run pyright

format:
	uv run ruff format .
	uv run ruff check --fix .

smoke:
	uv run decida check $(MODEL)
