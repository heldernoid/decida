import pytest
from transformers import AutoTokenizer

from decida.model.enc import DecidaEncModel, LayaLayout
from decida.schema.models import CaseQuestion

try:
    import laya
    HAS_LAYA = True
except ImportError:
    HAS_LAYA = False

@pytest.mark.skipif(not HAS_LAYA, reason="laya package not installed")
@pytest.mark.parametrize("checkpoint", ["convaiinnovations/laya"])
def test_enc_golden(checkpoint):
    """Golden test against Laya Agent."""
    # 1. Load Laya Agent
    agent = laya.Agent(checkpoint, device="cpu")
    
    # 2. Load DecidaEncModel
    # We use snapshot_download to get the local path
    from huggingface_hub import snapshot_download
    path = snapshot_download(checkpoint)
    model = DecidaEncModel.from_pretrained(path)
    model.eval()
    
    tokenizer = AutoTokenizer.from_pretrained(path + "/tokenizer")
    layout = LayaLayout(tokenizer)
    
    # 3. Create some inputs
    state = "The user asks for a refund. The policy states refunds are allowed within 30 days. The purchase was 15 days ago."
    from decida.schema.primitives import Primitive
    q_choice = CaseQuestion(qid="q1", primitive=Primitive.CHOICE, tags={}, instructions="Is the user eligible for a refund?", criteria={"yes": "Eligible", "no": "Not eligible"})
    q_score = CaseQuestion(qid="q2", primitive=Primitive.SCORE, tags={}, instructions="Rate the sentiment of the user.", criteria=["Negative", "Neutral", "Positive"])
    q_noul = CaseQuestion(qid="q3", primitive=Primitive.NOUL, tags={}, instructions="The user is angry.", criteria={})
    
    questions = {"q1": q_choice, "q2": q_score, "q3": q_noul}
    
    # 4. Predict with Laya Agent
    # We want raw probabilities, so we might need to look at agent logits or answers
    questions_dict = {}
    for k, q in questions.items():
        qd = q.model_dump()
        qd["type"] = qd.pop("primitive").value if hasattr(qd["primitive"], "value") else qd.pop("primitive")
        questions_dict[k] = qd
    laya_answers = agent.predict(state, questions_dict)["answers"]
    
    # 5. Predict with DecidaEncModel
    decida_answers = model.predict(state, questions, layout, calibrated=True)
    
    # 6. Compare probabilities
    for qid, l_ans in laya_answers.items():
        d_ans = decida_answers[qid]
        if d_ans.type in ("choice", "score"):
            for opt, p_laya in l_ans["probabilities"].items():
                p_decida = d_ans.probabilities[opt]
                # allow rounding diff as laya uses round(..., 4)
                assert abs(p_laya - p_decida) <= 1e-2, f"{qid} {opt}: {p_laya} != {p_decida}"
        else:
            # noul
            p_laya = l_ans["noul"]
            p_decida = d_ans.noul
            assert abs(p_laya - p_decida) <= 1e-2, f"{qid}: {p_laya} != {p_decida}"
