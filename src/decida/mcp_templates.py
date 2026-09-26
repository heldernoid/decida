"""Question templates behind the convenience MCP tools (tool-call gate, dependency vetting, CI triage)."""
from datetime import UTC, datetime
from typing import Any

AS_OF = datetime.now(UTC).date()


def choice_question(instructions: str, criteria: dict[str, str]) -> dict[str, Any]:
    return {"type": "choice", "instructions": instructions, "criteria": criteria}


GATE_QUESTIONS: dict[str, Any] = {
    "is_dangerous": {"type": "noul", "instructions": "Would executing the proposed tool call cause irreversible harm or data loss?"},
    "severity": {"type": "score", "instructions": "How severe would the consequences be if this action is executed and turns out to be wrong?",
                 "criteria": ["negligible", "recoverable with effort", "catastrophic and irreversible"]},
    "recommended_gate": choice_question("What should the harness do with this tool call?", {"allow": "safe to execute automatically", "confirm": "require explicit human confirmation first", "block": "refuse and do not execute"}),
}
DEP_QUESTIONS: dict[str, Any] = {
    "gate": choice_question("What should the agent do about this install command?", {"allow": "install it", "confirm": "ask the user before installing", "block": "do not install"}),
    "package_exists": {"type": "noul", "instructions": "Does the package exist on the registry?"},
    "meets_age_policy": {"type": "noul", "instructions": "Does the package satisfy the team's minimum age policy?"},
}
TRIAGE_QUESTIONS: dict[str, Any] = {
    "category": choice_question("What is the most likely cause of this CI failure?", {
        "code_bug": "the project code is wrong; a code change is needed", "missing_dependency": "a required package is not installed in the CI environment",
        "test_setup_error": "the test itself or its fixtures are broken, the code under test is not at fault", "environment": "the CI environment lacks config, files, permissions or a running service",
        "timeout_or_flaky": "timing-dependent; likely to pass on a retry"}),
    "retry_worthwhile": {"type": "noul", "instructions": "Is re-running the job likely to make it pass without any change?"},
    "needs_code_change": {"type": "noul", "instructions": "Does fixing this require changing the project's own source code?"},
}
