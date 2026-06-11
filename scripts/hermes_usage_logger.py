import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_LOG_PATH = "/Users/michaelchuang/Documents/小愛/data/skill-usage.jsonl"
AGENT_NAME = "ADLink_PM"

def _sanitize(value, max_length=260):
    text = str(value or "")
    text = re.sub(r"[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}", "[redacted-token]", text)
    text = re.sub(r"(token|api[_-]?key|password|secret)\s*[:=]\s*\S+", r"\1=[redacted]", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= max_length else text[:max_length - 1].rstrip() + "..."

def estimate_tokens(value):
    text = str(value or "")
    ascii_count = sum(1 for char in text if ord(char) < 128)
    non_ascii = len(text) - ascii_count
    return int((ascii_count / 4) + (non_ascii / 1.8) + 0.999)

def log_skill_usage(event):
    log_path = Path(os.environ.get("SKILL_USAGE_LOG_PATH", DEFAULT_LOG_PATH))
    log_path.parent.mkdir(parents=True, exist_ok=True)
    skills = [str(item) for item in event.get("skills", [])] if isinstance(event.get("skills", []), list) else []
    question = _sanitize(event.get("question") or event.get("prompt") or "")
    answer = _sanitize(event.get("answer") or "", 180)
    record = {
        "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "agent": str(event.get("agent") or event.get("botName") or AGENT_NAME),
        "event": str(event.get("event") or "skill.event"),
        "skills": skills,
        "source": str(event.get("source") or "local"),
        "question": question,
        "answer": answer,
        "estimatedTokens": int(event.get("estimatedTokens") or estimate_tokens(question + "\n" + answer)),
        "metadata": event.get("metadata") if isinstance(event.get("metadata"), dict) else None,
    }
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record
