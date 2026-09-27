import json
import os
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import numpy as np
import torch
from safetensors.torch import load_file
from torch import nn
from transformers import AutoConfig, AutoModel

from decida.schema.models import Answer, CaseQuestion, ChoiceAnswer, NoulAnswer, ScoreAnswer
from decida.schema.primitives import Primitive


@dataclass
class Encoded:
    input_ids: torch.Tensor
    attention_mask: torch.Tensor
    readout_positions: torch.Tensor
    n_options: int
    truncated: bool
    options_truncated: int = 0  # options whose text was cut to fit the token budgets


@dataclass
class Batch:
    input_ids: torch.Tensor
    attention_mask: torch.Tensor
    readout_positions: torch.Tensor
    marker_mask: torch.Tensor
    qtypes: torch.Tensor


class Layout(Protocol):
    def build(self, state: str, q: CaseQuestion, *, option_order: Sequence[int] | None = None) -> Encoded:
        ...


def _render_criterion(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(", ", ": "), default=str)


def _render_options(q: CaseQuestion) -> list[str]:
    t = q.primitive.value
    if t == "choice":
        assert q.criteria is not None
        opts = []
        for k, v in q.criteria.items():
            opts.append(k if v is None or v == "" else f"{k}: {_render_criterion(v)}")
        return opts
    if t == "score":
        assert isinstance(q.criteria, list)
        return [f"level {i}: {_render_criterion(c)}" for i, c in enumerate(q.criteria)]
    
    # noul
    crit = q.criteria or {}
    assert isinstance(crit, dict)
    false_crit = crit.get("false")
    true_crit = crit.get("true")
    false_str = _render_criterion(false_crit) if false_crit not in (None, "") else "no, the statement does not hold"
    true_str = _render_criterion(true_crit) if true_crit not in (None, "") else "yes, the statement holds"
    return [f"false: {false_str}", f"true: {true_str}"]


class LayaLayout:
    """Layout compatible with laya checkpoints."""

    def __init__(self, tokenizer, max_len: int = 512, head_max_len: int = 192, opt_max_tokens: int = 48):
        self.tok = tokenizer
        self.max_len = max_len
        self.head_max_len = head_max_len  # shared by the instructions and ALL options: many options means very short ones
        self.opt_max_tokens = opt_max_tokens

    def build(self, state: str, q: CaseQuestion, *, option_order: Sequence[int] | None = None) -> Encoded:
        mask_tok = self.tok.mask_token
        opts = _render_options(q)
        order = option_order if option_order is not None else list(range(len(opts)))
        
        ins = q.instructions if isinstance(q.instructions, str) else json.dumps(q.instructions, ensure_ascii=False)
        if mask_tok:
            ins = ins.replace(mask_tok, " ")
        head_ids = self.tok(f"{q.primitive.value} question: {ins}", add_special_tokens=False)["input_ids"]
        
        opt_ids = []
        full_lens = []
        for i in order:
            text_ids = self.tok(" " + opts[i].replace(mask_tok, " "), add_special_tokens=False)["input_ids"]
            full_lens.append(len(text_ids))
            opt_ids.append([self.tok.mask_token_id] + text_ids[: self.opt_max_tokens])

        opt_budget = self.head_max_len - sum(len(o) for o in opt_ids)
        if opt_budget < 16:
            per = max(4, (self.head_max_len - 16) // max(1, len(opt_ids)))
            opt_ids = [o[:per] for o in opt_ids]
            opt_budget = self.head_max_len - sum(len(o) for o in opt_ids)
        options_truncated = sum(1 for o, n in zip(opt_ids, full_lens) if len(o) - 1 < n)

        head_ids = head_ids[: max(8, opt_budget)]
        ids = [self.tok.cls_token_id] + head_ids + [self.tok.sep_token_id]
        markers = []
        for o in opt_ids:
            markers.append(len(ids))
            ids.extend(o)
        ids.append(self.tok.sep_token_id)
        
        room = max(0, self.max_len - len(ids) - 1)
        # If state is dict, we serialize it
        state_str = json.dumps(state, ensure_ascii=False) if isinstance(state, (dict, list)) else str(state)
        st = self.tok(state_str.replace(mask_tok, " "), add_special_tokens=False)["input_ids"]
        
        truncated = len(st) > room
        st = st[:room]
        ids = ids + st + [self.tok.sep_token_id]
        
        final_ids = ids[:self.max_len]
        valid_markers = [m for m in markers if m < self.max_len]
        
        return Encoded(
            input_ids=torch.tensor(final_ids, dtype=torch.long),
            attention_mask=torch.ones(len(final_ids), dtype=torch.long),
            readout_positions=torch.tensor(valid_markers, dtype=torch.long),
            n_options=len(opts),
            truncated=truncated,
            options_truncated=options_truncated,
        )


class DecidaEncModel(nn.Module):
    family: Literal["enc", "dec"] = "enc"

    def __init__(self, encoder: nn.Module, head_layers: int = 2, n_act: int = 2, dropout: float = 0.1, cfg: dict[str, Any] | None = None):
        super().__init__()
        self.encoder = encoder
        self.cfg = cfg or {}
        encoder_config: Any = getattr(encoder, "config")  # noqa: B009  a transformers config; nn.Module does not declare it
        d = int(encoder_config.hidden_size)
        nhead = max(1, d // 64)
        layer = nn.TransformerEncoderLayer(
            d_model=d, 
            nhead=nhead, 
            dim_feedforward=4 * d, 
            dropout=dropout, 
            batch_first=True, 
            norm_first=True
        )
        self.head = nn.TransformerEncoder(layer, head_layers, enable_nested_tensor=False) if head_layers > 0 else None
        self.type_emb = nn.Embedding(3, d)
        self.scorer = nn.Sequential(
            nn.LayerNorm(d), 
            nn.Linear(d, d), 
            nn.GELU(approximate='none'), 
            nn.Linear(d, 1)
        )
        self.act_head = nn.Sequential(
            nn.Linear(d + 4, 256), 
            nn.GELU(approximate='none'), 
            nn.Linear(256, n_act)
        )
        self.qtypes_map = {"choice": 0, "score": 1, "noul": 2}

    def forward(self, batch: Batch, detach_encoder: bool = False) -> torch.Tensor:
        h = self.encoder(input_ids=batch.input_ids, attention_mask=batch.attention_mask).last_hidden_state
        if detach_encoder:
            h = h.detach()
        h = h + self.type_emb(batch.qtypes)[:, None, :]
        if self.head is not None:
            pad = ~batch.attention_mask.bool()
            for layer in self.head.layers:
                h = layer(h, src_key_padding_mask=pad)
                
        idx = batch.readout_positions.clamp(min=0)[:, :, None].expand(-1, -1, h.size(-1))
        m = torch.gather(h, 1, idx)
        logits = self.scorer(m).squeeze(-1).float()
        logits = logits.masked_fill(~batch.marker_mask, float('-inf'))
        return logits

    @classmethod
    def from_pretrained(cls, path: str) -> "DecidaEncModel":
        weights_path = os.path.join(path, "model.safetensors")
        weights = load_file(weights_path)
        
        cfg_path = os.path.join(path, "rl_agent_config.json")
        if os.path.exists(cfg_path):
            with open(cfg_path) as f:
                cfg = json.load(f)
        else:
            cfg = {}
        
        # ROCm (HIP) builds of PyTorch fail with hipErrorInvalidValue on gfx1151
        # when using SDPA attention; eager is the safe fallback on AMD.
        attn_impl = "eager" if getattr(torch.version, "hip", None) else "sdpa"

        enc_dir = os.path.join(path, "encoder")
        if os.path.exists(enc_dir):
            ecfg = AutoConfig.from_pretrained(enc_dir)
            enc = AutoModel.from_config(ecfg, attn_implementation=attn_impl)
        else:
            # Try from root or default? Fallback if encoder/ not found
            ecfg = AutoConfig.from_pretrained("answerdotai/ModernBERT-base")
            enc = AutoModel.from_config(ecfg, attn_implementation=attn_impl)
            
        # Infer n_act from act_head.2.weight
        act_weight = weights.get("act_head.2.weight", weights.get("core_model.act_head.2.weight"))
        if act_weight is None:
            raise ValueError(f"{weights_path} has no act_head.2.weight: not a Decida or Laya encoder checkpoint")
        n_act = act_weight.shape[0]
        head_layers = 0
        
        new_weights = {}
        for k, v in weights.items():
            k = k.removeprefix("core_model.")
            new_weights[k] = v
            if k.startswith("head.layers."):
                layer_idx = int(k.split(".")[2])
                head_layers = max(head_layers, layer_idx + 1)
                
        model = cls(enc, head_layers=head_layers, n_act=n_act, cfg=cfg)
        model.load_state_dict(new_weights, strict=False)
        return model

    def predict(self, state: str, questions: dict[str, CaseQuestion], layout: Layout, calibrated: bool = True) -> dict[str, Answer]:
        # Build encoded for all questions
        items = []
        qids = list(questions.keys())
        for qid in qids:
            q = questions[qid]
            encoded = layout.build(state, q)
            items.append({
                "qid": qid,
                "encoded": encoded,
                "qtype": self.qtypes_map[q.primitive.value]
            })
            
        if not items:
            return {}
            
        # Collate batch
        L = max(len(it["encoded"].input_ids) for it in items)
        kmax = max(it["encoded"].n_options for it in items)
        n = len(items)
        
        # Using padding token from tokenizer in layout
        pad_id = getattr(layout, "tok", None)
        pad_id = pad_id.pad_token_id if pad_id else 0
        
        ids = torch.full((n, L), pad_id, dtype=torch.long)
        att = torch.zeros((n, L), dtype=torch.long)
        mpos = torch.zeros((n, kmax), dtype=torch.long)
        mmask = torch.zeros((n, kmax), dtype=torch.bool)
        qtypes = torch.zeros(n, dtype=torch.long)
        
        for i, it in enumerate(items):
            enc = it["encoded"]
            seq_len = len(enc.input_ids)
            ids[i, :seq_len] = enc.input_ids
            att[i, :seq_len] = enc.attention_mask
            k = enc.n_options
            mpos[i, :k] = enc.readout_positions
            mmask[i, :k] = True
            qtypes[i] = it["qtype"]
            
        batch = Batch(
            input_ids=ids,
            attention_mask=att,
            readout_positions=mpos,
            marker_mask=mmask,
            qtypes=qtypes
        )
        
        device = next(self.parameters()).device
        for k_f, v_f in batch.__dict__.items():
            setattr(batch, k_f, v_f.to(device))
            
        with torch.no_grad():
            logits = self.forward(batch)
            
        logits = logits.cpu().numpy()
        
        # Construct Answer models
        answers = {}
        for r, it in enumerate(items):
            qid = it["qid"]
            q = questions[qid]
            k = it["encoded"].n_options
            
            z = logits[r, :k]
            
            if calibrated:
                # Laya logic for calibrated output
                qtypes_inv = {v: k for k, v in self.qtypes_map.items()}
                temp_array = self.cfg.get("temperature", [1.0, 1.0, 1.0])
                temp_by_opt = self.cfg.get("temperature_by_options", {})
                
                qt = it["qtype"]
                size = "2" if k <= 2 else "3-5" if k <= 5 else "6-10" if k <= 10 else "11+"
                bucket = f"{qtypes_inv[qt]}:{size}"
                
                t_scale = temp_by_opt.get(bucket, temp_array[qt])
            else:
                t_scale = 1.0
                
            z = z / max(1e-3, float(t_scale))
            p = np.exp(z - z.max())
            p = p / p.sum()
            
            if q.primitive.value == "choice":
                assert q.criteria is not None
                keys = list(q.criteria.keys())
                choice_key = keys[int(p.argmax())]
                probs = {kk: float(v) for kk, v in zip(keys, p)}
                answers[qid] = ChoiceAnswer(type=Primitive.CHOICE, choice=choice_key, probabilities=probs, confidence=float(max(probs.values())))
            elif q.primitive.value == "score":
                assert isinstance(q.criteria, list)
                exp_score = float((np.arange(k) * p).sum())
                score_val = exp_score
                legend = {str(i): str(c) for i, c in enumerate(q.criteria)}
                probs = {str(i): float(v) for i, v in enumerate(p)}
                answers[qid] = ScoreAnswer(type=Primitive.SCORE, score=float(score_val), legend=legend, probabilities=probs, confidence=float(max(probs.values())))
            else:
                noul_prob = float(p[1])
                answers[qid] = NoulAnswer(type=Primitive.NOUL, noul=float(noul_prob), confidence=float(noul_prob if noul_prob > 0.5 else 1 - noul_prob))
                
        return answers
