"""Review candidates, never instructions to execute or invented deadlines."""

import re

ACTION = re.compile(
    r"\b(remind(?:er)?|deadline|due|appointment|meeting|interview|respond|reply|"
    r"confirm|collect|pickup|pick up|renew|expires?|follow[- ]?up|submit)\b", re.I
)


def review_candidates(events: list[dict], limit: int = 30) -> list[dict]:
    result = []
    for event in events:
        if event.get("category") == "promotion":
            continue
        title, text = event.get("title", ""), event.get("text", "")
        if event.get("category") != "action" and not ACTION.search(f"{title} {text}"):
            continue
        result.append({
            "event_id": event["id"],
            "source": event["source"],
            "source_event_id": event["source_event_id"],
            "package": event.get("package"),
            "suggested_title": (title or text)[:180],
            "excerpt": text[:500],
            "due_date": None,
            "requires_review": True,
        })
        if len(result) >= limit:
            break
    return result

