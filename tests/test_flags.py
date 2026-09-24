"""Unit tests for cleaner._parse_flags(): parses the <flags>[...]</flags> block the model
appends after the cleaned transcript. No model calls involved - these feed raw strings
straight into the function.

Deliberately defensive: malformed JSON, non-list JSON, non-dict entries, and dicts missing
`corrected` or `reason` should all be silently filtered/ignored rather than raising, because
the cleaned transcript - already split off before this runs - is what matters, and a
flags-parsing hiccup must never cost it.
"""
import json
import random
import string

import cleaner


def test_well_formed_block_with_trailing_tag():
    raw = json.dumps([
        {"original": "a video", "corrected": "Nvidia", "reason": "mis-transcribed product name"},
        {"original": "4 to 6", "corrected": "TRL 4-6", "reason": "ambiguous acronym"},
    ]) + "</flags>"
    assert cleaner._parse_flags(raw) == [
        {"original": "a video", "corrected": "Nvidia", "reason": "mis-transcribed product name"},
        {"original": "4 to 6", "corrected": "TRL 4-6", "reason": "ambiguous acronym"},
    ]


def test_well_formed_block_without_trailing_tag():
    raw = json.dumps([
        {"original": "", "corrected": "GraniteStore", "reason": "inaudible product name"},
    ])
    assert cleaner._parse_flags(raw) == [
        {"original": "", "corrected": "GraniteStore", "reason": "inaudible product name"},
    ]


def test_empty_array():
    assert cleaner._parse_flags("[]") == []
    assert cleaner._parse_flags("[]</flags>") == []


def test_empty_or_whitespace_or_bare_closing_tag():
    assert cleaner._parse_flags("") == []
    assert cleaner._parse_flags("   \n  ") == []
    assert cleaner._parse_flags("</flags>") == []


def test_malformed_json_truncated():
    raw = '[{"original": "foo", "corrected": "bar", "reason": "cut off mid'
    assert cleaner._parse_flags(raw) == []


def test_malformed_json_invalid_syntax():
    assert cleaner._parse_flags("{not json at all!!") == []
    assert cleaner._parse_flags("[1, 2, 3") == []


def test_json_object_instead_of_list():
    raw = json.dumps({"original": "foo", "corrected": "bar", "reason": "not a list"})
    assert cleaner._parse_flags(raw) == []


def test_list_of_non_dict_entries_dropped():
    raw = json.dumps(["just a string", 42, None, True, ["nested", "list"]])
    assert cleaner._parse_flags(raw) == []


def test_entries_missing_required_keys_dropped():
    raw = json.dumps([
        {"original": "x", "reason": "missing corrected"},
        {"original": "y", "corrected": "y-fixed"},                    # missing reason
        {"corrected": "", "reason": "corrected is an empty string"},  # corrected falsy
        {"corrected": "z-fixed", "reason": ""},                       # reason falsy
        {"original": "ok", "corrected": "ok-fixed", "reason": "this one is valid"},
    ])
    assert cleaner._parse_flags(raw) == [
        {"original": "ok", "corrected": "ok-fixed", "reason": "this one is valid"},
    ]


def test_mixed_valid_and_invalid_entries():
    raw = json.dumps([
        {"corrected": "A", "reason": "first"},   # original omitted -> defaults to ""
        "not a dict",
        {"corrected": "B"},                      # missing reason
        {"original": "orig-missing", "corrected": "C", "reason": "third"},
    ])
    assert cleaner._parse_flags(raw) == [
        {"original": "", "corrected": "A", "reason": "first"},
        {"original": "orig-missing", "corrected": "C", "reason": "third"},
    ]


def test_non_string_field_values_are_dropped_not_raised():
    raw = json.dumps([
        {"original": 123, "corrected": ["not", "a", "string"], "reason": "reason is fine"},
        {"original": None, "corrected": "fine-corrected", "reason": 456},
    ])
    # Neither entry has both a string `corrected` and a string `reason`, so both are dropped.
    assert cleaner._parse_flags(raw) == []


def test_never_raises_on_a_grab_bag_of_garbage():
    garbage_inputs = [
        "",
        "{",
        "]",
        "null",
        "true",
        "42",
        '"just a string"',
        "[{}]",
        "[[]]",
        "[{'single': 'quotes'}]",
        "\x00\x01\x02",
        '<flags>[{"corrected": "x", "reason": "y"}]</flags></flags>',
    ]
    for raw in garbage_inputs:
        assert isinstance(cleaner._parse_flags(raw), list)


def test_fuzz_random_strings_never_raise():
    rng = random.Random(1234)
    alphabet = string.printable
    for _ in range(200):
        length = rng.randint(0, 40)
        raw = "".join(rng.choice(alphabet) for _ in range(length))
        assert isinstance(cleaner._parse_flags(raw), list)
