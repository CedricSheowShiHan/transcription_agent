"""Tests for cleaner.extract_text() and its per-extension dispatch."""
from pathlib import Path

import pytest

import cleaner

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_txt_round_trip_preserves_structure():
    data = _bytes("standup_meeting.txt")
    text = cleaner.extract_text("standup_meeting.txt", data)
    # .txt is decoded as-is: no cue parsing, nothing stripped or reordered.
    assert text == data.decode("utf-8")
    # Speaker labels and blank-line-separated turns survive untouched.
    assert "Jordan Ellery:" in text
    assert "Priya Adeyemi:" in text
    assert "Sam Okonkwo:" in text
    assert "\n\n" in text  # turn boundaries kept


def test_long_monologue_round_trip():
    data = _bytes("long_monologue.txt")
    text = cleaner.extract_text("long_monologue.txt", data)
    assert text == data.decode("utf-8")
    assert "\n" not in text  # this fixture is deliberately one unbroken paragraph


def test_vtt_produces_cue_markers_and_strips_header():
    data = _bytes("design_review.vtt")
    text = cleaner.extract_text("design_review.vtt", data)
    assert "-->" in text
    assert "WEBVTT" not in text
    assert "NOTE" not in text
    # bare cue-index lines ("1", "2", ...) are not cue text and must not leak through
    assert "\n1\n" not in text
    # <v Speaker> tags become "Speaker: " prefixes, not left as raw markup
    assert "<v" not in text
    assert "Marta Lindqvist:" in text
    assert "Deshawn Ruiz:" in text
    assert "Ines Okafor:" in text
    # each of the 9 cues becomes its own '[start --> end] ...' paragraph
    assert text.count("-->") == 9
    assert "\n\n" in text


def test_vtt_cue_timestamps_bracket_each_paragraph():
    data = _bytes("design_review.vtt")
    text = cleaner.extract_text("design_review.vtt", data)
    first_para = text.split("\n\n")[0]
    assert first_para.startswith("[00:00:00.000 --> 00:00:07.500]")
    assert "Marta Lindqvist: Alright, let's get started." in first_para


def test_unsupported_extension_raises_value_error():
    with pytest.raises(ValueError):
        cleaner.extract_text("x.foo", b"whatever content")


@pytest.mark.parametrize("filename", ["a.pdf", "b.docx.exe", "noext", "c.PNG", "d.doc"])
def test_various_unsupported_extensions_raise(filename):
    with pytest.raises(ValueError):
        cleaner.extract_text(filename, b"data")
