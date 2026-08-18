"""Railway entry. Prints immediately so deploy logs show why we die."""

from __future__ import annotations

import os
import sys
import traceback

print("start.py boot", flush=True)
print("PORT=", os.environ.get("PORT"), flush=True)
print("python=", sys.executable, flush=True)

try:
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    print(f"binding 0.0.0.0:{port}", flush=True)
    uvicorn.run(
        "prospective_memory.api:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        loop="asyncio",
    )
except Exception:
    traceback.print_exc()
    raise
