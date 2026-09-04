"""Self-check for _truncate_repeated_lines (glm-ocr block-loop guard).

Run directly: .venv/Scripts/python.exe test_ocr_repetition.py
"""
from main import _truncate_repeated_lines

# 3-line block loop -> keep one cycle only
assert _truncate_repeated_lines(
    ["A", "B", "C"] * 30
) == ["A", "B", "C"], "block loop must collapse to one cycle"

# single-line repeat still collapses (old behavior preserved)
assert _truncate_repeated_lines(["x", "x", "y"]) == ["x", "y"]

# normal distinct text untouched
page = ["先程攻めてきたのは", "前々から", "仲が悪かった豪商", "今日はもう遅いので"]
assert _truncate_repeated_lines(page) == page

# repetition cut mid-loop keeps everything before the cycle closes
assert _truncate_repeated_lines(["A", "B", "A", "B"]) == ["A", "B"]

# empty / single line safe
assert _truncate_repeated_lines([]) == []
assert _truncate_repeated_lines(["only"]) == ["only"]

print("all _truncate_repeated_lines checks passed")
