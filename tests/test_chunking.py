"""Tests for cleaner.chunk(): the join-invariant "".join(chunk(text)) == text must hold
for any input, exactly. This is what lets a raw transcript be split into chunks, cleaned
chunk-by-chunk through the model, and reassembled with nothing duplicated or dropped.
"""
from pathlib import Path

import pytest

import cleaner

FIXTURES = Path(__file__).resolve().parent / "fixtures"

FIXTURE_FILES = [
    FIXTURES / "standup_meeting.txt",
    FIXTURES / "design_review.vtt",
    FIXTURES / "long_monologue.txt",
]


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


@pytest.mark.parametrize("path", FIXTURE_FILES, ids=lambda p: p.name)
def test_join_invariant_raw_fixture(path):
    text = _read(path)
    assert "".join(cleaner.chunk(text)) == text


def test_join_invariant_on_extracted_vtt():
    """The invariant also has to hold on text as it actually flows into chunk() in the
    real pipeline: after extract_text() has turned VTT cues into
    '[start --> end] Speaker: text' paragraphs.
    """
    data = (FIXTURES / "design_review.vtt").read_bytes()
    extracted = cleaner.extract_text("design_review.vtt", data)
    assert "".join(cleaner.chunk(extracted)) == extracted


def test_join_invariant_empty_string():
    assert cleaner.chunk("") == []
    assert "".join(cleaner.chunk("")) == ""


def test_single_short_paragraph_is_one_chunk_no_splitting():
    text = "Alex: This is one short turn with no blank-line breaks at all, just a single paragraph."
    chunks = cleaner.chunk(text)
    assert len(chunks) == 1
    assert chunks[0] == text
    assert "".join(chunks) == text


@pytest.mark.parametrize("path", FIXTURE_FILES, ids=lambda p: p.name)
@pytest.mark.parametrize("target", [1, 5, 25])
def test_join_invariant_holds_with_forced_small_target(path, target):
    """Force target word counts small enough that paragraphs, then lines, then sentences
    all have to be split - exercising the full _units() fallback chain - and confirm the
    join-invariant still holds exactly even then.
    """
    text = _read(path)
    assert "".join(cleaner.chunk(text, target=target)) == text


def test_small_target_actually_forces_many_chunks():
    """Sanity check that the forced-small-target test above is exercising real splitting,
    not a no-op: with target=1 the long monologue must split into many chunks.
    """
    text = _read(FIXTURES / "long_monologue.txt")
    chunks = cleaner.chunk(text, target=1)
    assert len(chunks) > 1
    assert "".join(chunks) == text


def test_default_target_already_forces_fallback_on_long_monologue():
    """long_monologue.txt is a single ~3300-word paragraph with no newlines at all, so
    even at the default CHUNK_WORDS target it can only be split by falling all the way
    through to sentence-level splitting in _units() - the scenario the paragraph-boundary
    happy path never exercises on its own.
    """
    text = _read(FIXTURES / "long_monologue.txt")
    assert len(text.split()) > cleaner.CHUNK_WORDS
    chunks = cleaner.chunk(text)
    assert len(chunks) > 1
    assert "".join(chunks) == text
