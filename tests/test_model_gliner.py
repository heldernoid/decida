"""Pure-logic tests for the GLiNER2.5-Decide port: label ordering and the classifier head's shape.

No network access and no checkpoint download: `GlinerModel.from_pretrained` (which needs the real 2GB/1.2GB
checkpoints from helmo/GLiNER2.5-Decide and helmo/GLiNER2.5-multi-Decide) is exercised manually, not in CI.
"""
import torch

from decida.model.gliner_enc import ClassifierHead, build_prompt, labels_for


def test_build_prompt_has_one_marker_per_label_in_order_and_only_described_labels_get_a_description():
    text = build_prompt("Which fits?", {"a": "first thing", "b": None}, "some state")
    assert text.count("[L] a") == 1 and text.count("[L] b") == 1
    assert text.index("[L] a") < text.index("[L] b"), "markers follow label order"
    assert "[DESCRIPTION] a: first thing" in text
    assert "[DESCRIPTION] b" not in text, "a label with no description gets none"
    assert text.endswith("[SEP_TEXT] some state")


def test_labels_for_choice_keeps_the_given_order_and_descriptions():
    criteria = {"billing": "Charges, invoices, refunds", "technical": "Bugs and outages"}
    assert labels_for("choice", criteria) == criteria


def test_labels_for_score_uses_level_index_as_the_label_name():
    assert labels_for("score", ["Calm", "Frustrated", "Very angry"]) == {"0": "Calm", "1": "Frustrated", "2": "Very angry"}


def test_labels_for_noul_orders_no_before_yes_to_match_format_answer():
    """format_answer reads noul probabilities as [false, true], so the labels must be built in that order."""
    labels = labels_for("noul", {"true": "it is spam", "false": "it is not spam"})
    assert list(labels) == ["no", "yes"]
    assert labels == {"no": "it is not spam", "yes": "it is spam"}


def test_labels_for_noul_with_no_criteria_gives_no_descriptions():
    assert labels_for("noul", {}) == {"no": None, "yes": None}
    assert labels_for("noul", None) == {"no": None, "yes": None}


def test_classifier_head_reduces_hidden_states_to_one_score_per_option():
    head = ClassifierHead(hidden=8, mid=16)
    options = torch.randn(3, 8)  # 3 [L]-position embeddings, hidden size 8
    scores = head(options)
    assert scores.shape == (3,)
    assert torch.isfinite(scores).all()
