"""后端命令行工具。

用法：python -m app.cli export-openapi <输出路径>
"""

import json
import sys
from pathlib import Path

from app.main import create_app


def export_openapi(output: Path) -> None:
    """把 OpenAPI 规格写成 JSON。

    这是**契约的生成入口**：文档由代码生成，不手写。
    """
    spec = create_app().openapi()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(spec, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] != "export-openapi":
        print("usage: python -m app.cli export-openapi <output>", file=sys.stderr)
        return 2
    export_openapi(Path(sys.argv[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
