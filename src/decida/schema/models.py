from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from decida.schema.primitives import Primitive


class QuestionBase(BaseModel):
    instructions: str | dict[str, Any] | list[Any] | None = None

class NoulQuestion(QuestionBase):
    type: Literal[Primitive.NOUL] = Primitive.NOUL
    criteria: dict[str, str] | None = None

    @model_validator(mode="after")
    def validate_noul(self):
        if self.criteria is not None:
            if set(self.criteria.keys()) != {"true", "false"}:
                raise ValueError("noul criteria keys must be exactly 'true' and 'false'")
            if not self.criteria["true"] or not self.criteria["false"]:
                raise ValueError("noul criteria values must be non-empty strings")
        return self

class ChoiceQuestion(QuestionBase):
    type: Literal[Primitive.CHOICE]
    criteria: dict[str, str | None]

    @model_validator(mode="after")
    def validate_choice(self):
        if not (2 <= len(self.criteria) <= 255):
            raise ValueError("choice must have 2 to 255 options")
        for k in self.criteria:
            if not k or len(k) > 128:
                raise ValueError("choice option keys must be non-empty and <= 128 chars")
        return self

class ScoreQuestion(QuestionBase):
    type: Literal[Primitive.SCORE] = Primitive.SCORE
    criteria: dict[str, Any] | list[Any]

    @model_validator(mode='after')
    def validate_score(self):
        if not (2 <= len(self.criteria) <= 32):
            raise ValueError("score must have 2 to 32 levels")
        return self

Question = NoulQuestion | ChoiceQuestion | ScoreQuestion

class RequestExtension(BaseModel):
    calibrated: bool = True
    return_logits: bool = False
    noul_confidence: bool = False
    seed: int | None = None
    trace: bool = False

class Request(BaseModel):
    model: str
    state: str | dict[str, Any] | list[Any]
    questions: dict[str, Question]
    x_decida: RequestExtension | None = None

    @model_validator(mode="after")
    def validate_request(self):
        if not self.state:
            raise ValueError("state must be non-empty")
        if not (1 <= len(self.questions) <= 256):
            raise ValueError("request must have 1 to 256 questions")
        return self

class AnswerBase(BaseModel):
    pass

class NoulAnswer(AnswerBase):
    type: Literal[Primitive.NOUL]
    noul: float
    confidence: float | None = None

class ChoiceAnswer(AnswerBase):
    type: Literal[Primitive.CHOICE]
    choice: str
    probabilities: dict[str, float]
    confidence: float

class ScoreAnswer(AnswerBase):
    type: Literal[Primitive.SCORE]
    score: float
    legend: dict[str, str]
    probabilities: dict[str, float]
    confidence: float

Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer

class Usage(BaseModel):
    input_tokens: int
    output_tokens: int

class ResponseExtension(BaseModel):
    compute_tokens: int
    model_family: str
    calibration_profile: str
    latency_ms: float
    logits: dict[str, dict[str, float]] | None = None

class Response(BaseModel):
    model: str
    answers: dict[str, Answer]
    usage: Usage
    x_decida: ResponseExtension | None = None

class CaseQuestion(BaseModel):
    """One typed question as the engines consume it (qid, primitive, instructions, criteria)."""
    qid: str
    primitive: Primitive
    instructions: str | dict[str, Any] | list[Any] | None = None
    criteria: Any
    tags: dict[str, Any] = Field(default_factory=dict)
