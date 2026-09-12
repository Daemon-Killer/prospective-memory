from __future__ import annotations

import json
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from prospective_memory import __version__
from prospective_memory.config import settings
from prospective_memory.db import (
    capture,
    last_whatsapp,
    latest_otp,
    list_tasks,
    missed_summary,
    set_status,
    stats,
)
from prospective_memory.models import TaskStatus

app = typer.Typer(name="pmem", help="Prospective memory — phone capture + MCP pull.", add_completion=False)
console = Console()


@app.command("version")
def version_cmd() -> None:
    console.print(__version__)


@app.command("token")
def token_cmd() -> None:
    """Print the Android/API token (generated on first use)."""
    console.print(settings.resolved_token())


@app.command("capture")
def capture_cmd(text: str = typer.Argument(...)) -> None:
    task = capture(text, source="cli")
    console.print_json(task.model_dump_json())


@app.command("list")
def list_cmd(
    status: str = typer.Option("open", "--status", "-s"),
    category: Optional[str] = typer.Option(None, "--category", "-c"),
    query: Optional[str] = typer.Option(None, "--query", "-q"),
) -> None:
    tasks = list_tasks(status=status if status != "all" else None, category=category, query=query)
    table = Table(title=f"tasks ({len(tasks)})")
    table.add_column("id")
    table.add_column("cat")
    table.add_column("trigger")
    table.add_column("text")
    for t in tasks:
        table.add_row(t.id, t.category, t.trigger_type.value, t.text[:70])
    console.print(table)


@app.command("done")
def done_cmd(task_id: str) -> None:
    task = set_status(task_id, TaskStatus.DONE)
    if not task:
        raise typer.Exit(code=1)
    console.print(f"done: {task.text}")


@app.command("stats")
def stats_cmd() -> None:
    console.print_json(json.dumps(stats(), default=str))


def _jarvis_remote() -> bool:
    return bool(settings.resolved_api_url())


@app.command("otp")
def otp_cmd() -> None:
    """Newest live OTP from the phone (expires in ~3 minutes)."""
    if _jarvis_remote():
        from prospective_memory import remote

        payload = remote.latest_otp()
    else:
        payload = latest_otp()
    console.print_json(json.dumps(payload, default=str))


@app.command("whatsapp")
def whatsapp_cmd(
    sender: Optional[str] = typer.Option(None, "--sender", "-s"),
    limit: int = typer.Option(10, "--limit", "-n"),
) -> None:
    """Recent WhatsApp notification previews."""
    if _jarvis_remote():
        from prospective_memory import remote

        payload = remote.last_whatsapp(sender=sender, limit=limit)
    else:
        payload = last_whatsapp(sender=sender, limit=limit)
    console.print_json(json.dumps(payload, default=str))


@app.command("missed")
def missed_cmd(minutes: int = typer.Option(60, "--minutes", "-m")) -> None:
    """What the phone saw recently (no OTP digits)."""
    if _jarvis_remote():
        from prospective_memory import remote

        payload = remote.missed_summary(minutes=minutes)
    else:
        payload = missed_summary(minutes=minutes)
    console.print_json(json.dumps(payload, default=str))


@app.command("serve")
def serve_cmd(
    host: Optional[str] = None,
    port: Optional[int] = None,
) -> None:
    """HTTP API for the Android capture app."""
    import uvicorn

    settings.ensure()
    token = settings.resolved_token()
    h = host or settings.host
    p = port or settings.listen_port()
    console.print(f"[green]API[/green] http://{h}:{p}  token in data/token.txt ({token[:6]}…)")
    uvicorn.run(
        "prospective_memory.api:create_app",
        factory=True,
        host=h,
        port=p,
        log_level="info",
    )


@app.command("serve-mcp")
def serve_mcp_cmd() -> None:
    from prospective_memory.mcp_server import run_stdio

    settings.ensure()
    run_stdio()


if __name__ == "__main__":
    app()
