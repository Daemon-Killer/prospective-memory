from __future__ import annotations

import json
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from prospective_memory import __version__
from prospective_memory.config import settings
from prospective_memory.db import capture, list_tasks, set_status, stats
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
