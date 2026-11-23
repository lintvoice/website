"""Fixtures shared by the site's tests: the built site (without its rule pages) and the texts of both languages."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import build


@pytest.fixture(scope="session")
def dist(tmp_path_factory):
    return build.build(tmp_path_factory.mktemp("site") / "dist")


@pytest.fixture(scope="session")
def texts():
    return build.load()[1]


@pytest.fixture(scope="session")
def words():
    """The rules repository at its pinned commit: the glossary's words live there (glossary.yaml)."""
    return build.fetch_rules(build.load()[0]["rules_source"])
