from __future__ import annotations

from pathlib import Path

from prospective_memory.db import capture, list_tasks, set_status
from prospective_memory.infer import infer
from prospective_memory.models import TaskStatus


def test_infer_grocery() -> None:
    g = infer("ghar jaate hue dahi lena")
    assert g["category"] == "grocery"
    assert g["trigger_type"].value == "route_category"


def test_capture_roundtrip(tmp_path: Path, monkeypatch) -> None:
    db = tmp_path / "t.db"
    from prospective_memory import db as dbmod

    monkeypatch.setattr(dbmod.settings, "db_path", db)
    monkeypatch.setattr(dbmod.settings, "data_dir", tmp_path)
    t = capture("pay electricity bill", source="test", db_path=db)
    assert t.category == "bills"
    open_ones = list_tasks(status="open", db_path=db)
    assert any(x.id == t.id for x in open_ones)
    done = set_status(t.id, TaskStatus.DONE, db_path=db)
    assert done and done.status == TaskStatus.DONE
