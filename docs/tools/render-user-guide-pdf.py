#!/usr/bin/env python3
"""
Render `docs/USER-GUIDE.md` to a typeset PDF.

    python3 docs/tools/render-user-guide-pdf.py
    python3 docs/tools/render-user-guide-pdf.py --input docs/USER-GUIDE.md \
                                                --output docs/FEMS-User-Guide.pdf

The guide is written in ordinary GitHub-flavoured Markdown; this script understands
the subset the guide actually uses — headings, paragraphs, bullet and numbered
lists, pipe tables, fenced code, block quotes, rules, and inline bold / italic /
code / links — and lays them out with reportlab.

There is no browser or LaTeX involved, so it runs anywhere Python does. Fonts come
from DejaVu (see `pdf_fonts.py`, which synthesises the italic cuts when the
container only ships the upright ones).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pdf_fonts  # noqa: E402

from reportlab.lib import colors  # noqa: E402
from reportlab.lib.enums import TA_LEFT  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.lib.units import cm  # noqa: E402
from reportlab.pdfbase import pdfmetrics  # noqa: E402
from reportlab.pdfbase.ttfonts import TTFont as RLTTFont  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents  # noqa: E402

# --------------------------------------------------------------------------- #
# Palette — the FEMS brand: deep forest green with an amber accent.
# --------------------------------------------------------------------------- #
PRIMARY = colors.HexColor("#16653F")
PRIMARY_DARK = colors.HexColor("#0F4A2D")
ACCENT = colors.HexColor("#C97B18")
INK = colors.HexColor("#1F2937")
INK_SOFT = colors.HexColor("#4B5563")
INK_FAINT = colors.HexColor("#6B7280")
RULE = colors.HexColor("#E5E7EB")
ZEBRA = colors.HexColor("#F6F7F6")
CODE_BG = colors.HexColor("#F4F4F5")
CODE_INK = colors.HexColor("#3F3F46")
CODE_INLINE_BG = colors.HexColor("#F4EFE6")
CODE_INLINE_INK = colors.HexColor("#9A4E0B")

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN_X = 2.0 * cm
MARGIN_TOP = 2.1 * cm
MARGIN_BOTTOM = 1.9 * cm
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X
COVER_BAND = 11.5 * cm  # height of the green band on the cover page


# --------------------------------------------------------------------------- #
# Markdown parsing
# --------------------------------------------------------------------------- #
LIST_RE = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
FENCE_RE = re.compile(r"^\s*```")
RULE_RE = re.compile(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$")
SEPARATOR_RE = re.compile(r"^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$")
HEADING_NUMBER_RE = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(.*)$")


def slugify(text: str) -> str:
    """`5.9 Generate a report` -> `59-generate-a-report` (matches GitHub)."""
    cleaned = re.sub(r"[^a-z0-9 \-]", "", text.lower())
    return re.sub(r"-+", "-", cleaned.strip().replace(" ", "-")).strip("-")


def parse_blocks(markdown: str) -> list[tuple[str, object]]:
    """Split the document into (kind, payload) blocks."""
    lines = markdown.split("\n")
    blocks: list[tuple[str, object]] = []
    i = 0
    while i < len(lines):
        line = lines[i]

        if FENCE_RE.match(line):
            i += 1
            code: list[str] = []
            while i < len(lines) and not FENCE_RE.match(lines[i]):
                code.append(lines[i])
                i += 1
            i += 1
            blocks.append(("code", "\n".join(code)))
            continue

        if not line.strip():
            i += 1
            continue

        if RULE_RE.match(line):
            blocks.append(("rule", ""))
            i += 1
            continue

        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            level = min(len(heading.group(1)), 4)
            blocks.append((f"h{level}", heading.group(2).strip()))
            i += 1
            continue

        if line.lstrip().startswith("|") and i + 1 < len(lines) and SEPARATOR_RE.match(lines[i + 1]):
            rows: list[list[str]] = []
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            blocks.append(("table", rows))
            continue

        if line.lstrip().startswith(">"):
            quoted: list[str] = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                quoted.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            blocks.append(("quote", " ".join(part.strip() for part in quoted).strip()))
            continue

        if LIST_RE.match(line):
            # Each item remembers its own marker, so a bulleted sub-list nested in a
            # numbered list stays bulleted.
            items: list[tuple[int, bool, str]] = []
            while i < len(lines):
                match = LIST_RE.match(lines[i])
                if match:
                    marker = match.group(2)
                    items.append(
                        (
                            len(match.group(1)) // 2,
                            not marker.startswith(("-", "*", "+")),
                            match.group(3).strip(),
                        )
                    )
                    i += 1
                elif items and lines[i].startswith(("  ", "\t")) and lines[i].strip():
                    indent, numbered, text = items[-1]
                    items[-1] = (indent, numbered, text + " " + lines[i].strip())
                    i += 1
                else:
                    break
            blocks.append(("list", items))
            continue

        paragraph: list[str] = []
        while i < len(lines) and lines[i].strip():
            if (
                lines[i].startswith(("#", ">", "|"))
                or FENCE_RE.match(lines[i])
                or RULE_RE.match(lines[i])
                or LIST_RE.match(lines[i])
            ):
                break
            paragraph.append(lines[i].strip())
            i += 1
        if paragraph:
            blocks.append(("p", " ".join(paragraph)))
        else:  # pragma: no cover - safety valve against an infinite loop
            i += 1
    return blocks


def split_row(line: str) -> list[str]:
    """Split one Markdown table row on unescaped pipes."""
    body = line.strip()
    body = re.sub(r"^\|", "", body)
    body = re.sub(r"\|$", "", body)
    cells, current, escaped = [], [], False
    for char in body:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == "|":
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    cells.append("".join(current).strip())
    return cells


# --------------------------------------------------------------------------- #
# Inline markup -> reportlab mini-HTML
# --------------------------------------------------------------------------- #
def escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def link_replacement(match: re.Match) -> str:
    label, href = match.group(1), match.group(2).strip()
    if href.startswith("#"):
        return f'<a href="#{href[1:]}" color="#16653F">{label}</a>'
    if href.startswith(("http://", "https://", "mailto:")):
        return f'<a href="{href}" color="#16653F">{label}</a>'
    return (
        f"<b>{label}</b>"
        f'<font face="Mono" size="7.6" color="#6B7280">&#160;({escape(href)})</font>'
    )


def inline(text: str) -> str:
    """Convert inline Markdown to the markup reportlab understands."""
    out = escape(text)
    out = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", out)          # images: drop
    out = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link_replacement, out)
    out = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", out, flags=re.S)
    out = re.sub(r"__(.+?)__", r"<b>\1</b>", out, flags=re.S)
    out = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?!\w)", r"<i>\1</i>", out)
    out = re.sub(r"`([^`]+)`", code_replacement, out)
    return out


def code_replacement(match: re.Match) -> str:
    """Inline code: monospace on a tinted chip.

    Long tokens (URLs, permission codes) get invisible break opportunities after
    `_ / :` so they wrap at a sensible place instead of splitting mid-syllable.
    """
    token = match.group(1)
    if len(token) > 20:
        token = re.sub(r"([_/:])", r"\1" + '<font size="1"> </font>', token)
    return (
        '<font face="Mono" size="8" color="#9A4E0B" backColor="#F4EFE6">'
        "&#160;" + token + "&#160;</font>"
    )


def plain(text: str) -> str:
    """Markdown text with the markup removed — used for measuring columns."""
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[`*_]", "", text)
    return text.strip()


# --------------------------------------------------------------------------- #
# Styles
# --------------------------------------------------------------------------- #
def register_fonts() -> None:
    faces = pdf_fonts.available_faces()
    pdfmetrics.registerFont(RLTTFont("Sans", faces["regular"]))
    pdfmetrics.registerFont(RLTTFont("Sans-Bold", faces["bold"]))
    pdfmetrics.registerFont(RLTTFont("Sans-Italic", faces["italic"]))
    pdfmetrics.registerFont(RLTTFont("Sans-BoldItalic", faces["bold-italic"]))
    pdfmetrics.registerFont(RLTTFont("Mono", faces["mono"]))
    pdfmetrics.registerFontFamily(
        "Sans",
        normal="Sans",
        bold="Sans-Bold",
        italic="Sans-Italic",
        boldItalic="Sans-BoldItalic",
    )


def build_styles() -> dict[str, ParagraphStyle]:
    base = dict(fontName="Sans", fontSize=9.9, leading=14.2, textColor=INK, alignment=TA_LEFT)
    return {
        "body": ParagraphStyle("body", **base, spaceAfter=7, spaceBefore=0),
        "body_tight": ParagraphStyle("body_tight", **base, spaceAfter=3),
        "cover_title": ParagraphStyle(
            "cover_title", fontName="Sans-Bold", fontSize=34, leading=40,
            textColor=colors.white, spaceAfter=2,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub", fontName="Sans", fontSize=13.5, leading=19,
            textColor=colors.HexColor("#CDEAD9"), spaceAfter=22,
        ),
        "cover_kicker": ParagraphStyle(
            "cover_kicker", fontName="Sans-Bold", fontSize=11, leading=15,
            textColor=colors.HexColor("#F0B24A"), spaceAfter=10,
        ),
        "cover_note": ParagraphStyle(
            "cover_note", fontName="Sans", fontSize=9.5, leading=14,
            textColor=colors.HexColor("#D7E4DC"), spaceBefore=6,
        ),
        "cover_lead": ParagraphStyle(
            "cover_lead", fontName="Sans", fontSize=10.4, leading=15.5, textColor=INK_SOFT,
            spaceAfter=16,
        ),
        "cover_meta": ParagraphStyle(
            "cover_meta", fontName="Sans", fontSize=8.8, leading=13, textColor=INK_FAINT,
        ),
        "h1": ParagraphStyle(
            "h1", fontName="Sans-Bold", fontSize=20, leading=25, textColor=PRIMARY_DARK,
            spaceBefore=0, spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "h2", fontName="Sans-Bold", fontSize=15.5, leading=20, textColor=PRIMARY,
            spaceBefore=17, spaceAfter=8, keepWithNext=1,
        ),
        "h3": ParagraphStyle(
            "h3", fontName="Sans-Bold", fontSize=11.8, leading=16, textColor=PRIMARY_DARK,
            spaceBefore=12, spaceAfter=5, keepWithNext=1,
        ),
        "h4": ParagraphStyle(
            "h4", fontName="Sans-BoldItalic", fontSize=10.2, leading=14, textColor=INK_SOFT,
            spaceBefore=9, spaceAfter=4, keepWithNext=1,
        ),
        "toc_title": ParagraphStyle(
            "toc_title", fontName="Sans-Bold", fontSize=18, leading=23,
            textColor=PRIMARY_DARK, spaceAfter=12,
        ),
        "toc": ParagraphStyle(
            "toc", fontName="Sans", fontSize=10.2, leading=17.5, textColor=INK,
            leftIndent=0, firstLineIndent=0,
        ),
        "quote": ParagraphStyle(
            "quote", fontName="Sans-Italic", fontSize=9.6, leading=14,
            textColor=INK_SOFT, spaceBefore=4, spaceAfter=8,
        ),
        "cell": ParagraphStyle(
            "cell", fontName="Sans", fontSize=8.5, leading=11.4, textColor=INK, spaceAfter=0,
        ),
        "cell_head": ParagraphStyle(
            "cell_head", fontName="Sans-Bold", fontSize=8.5, leading=11.4,
            textColor=colors.white, spaceAfter=0,
        ),
        "code": ParagraphStyle(
            "code", fontName="Mono", fontSize=8.1, leading=11.6, textColor=CODE_INK,
            spaceAfter=0,
        ),
        "footer": ParagraphStyle(
            "footer", fontName="Sans", fontSize=8, leading=10, textColor=INK_FAINT,
        ),
    }


# --------------------------------------------------------------------------- #
# Flowables
# --------------------------------------------------------------------------- #
class Heading(Paragraph):
    """A heading that registers a bookmark and a table-of-contents entry."""

    def __init__(self, text: str, style: ParagraphStyle, level: int, slug: str, toc_text: str):
        super().__init__(text, style)
        self.level = level
        self.slug = slug
        self.toc_text = toc_text


def heading_flowable(kind: str, text: str, styles: dict[str, ParagraphStyle]) -> Heading:
    level = int(kind[1])
    slug = slugify(text)
    match = HEADING_NUMBER_RE.match(text)
    if match and level <= 3:
        number, title = match.group(1), match.group(2)
        marked = f'<font color="#C97B18">{escape(number)}</font>&#160;&#160;{inline(title)}'
    else:
        marked = inline(text)
    style = styles[f"h{min(level, 4)}"]
    return Heading(marked, style, level, slug, text)


def code_flowable(code: str, styles: dict[str, ParagraphStyle]) -> Table:
    import textwrap

    wrapped: list[str] = []
    for raw in code.rstrip().split("\n"):
        indent = len(raw) - len(raw.lstrip(" "))
        raw = raw.replace("\t", "    ")
        if len(raw) <= 88:
            wrapped.append(raw)
        else:
            head = " " * indent
            for chunk in textwrap.wrap(raw.strip(), width=86 - indent):
                wrapped.append(head + chunk)
    html = "<br/>".join(
        escape(line).replace(" ", "&#160;") if line.strip() else "&#160;" for line in wrapped
    )
    para = Paragraph(html, styles["code"])
    table = Table([[para]], colWidths=[CONTENT_WIDTH])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("LINEBEFORE", (0, 0), (0, -1), 2.2, PRIMARY),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    table.spaceBefore = 3
    table.spaceAfter = 9
    return table


def quote_flowable(text: str, styles: dict[str, ParagraphStyle]) -> Table:
    para = Paragraph(inline(text), styles["quote"])
    table = Table([[para]], colWidths=[CONTENT_WIDTH])
    table.setStyle(
        TableStyle(
            [
                ("LINEBEFORE", (0, 0), (0, -1), 2.2, ACCENT),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FBF7F0")),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    table.spaceAfter = 8
    return table


def column_widths(rows: list[list[str]], total: float) -> list[float]:
    """Allocate table width from how much text each column actually holds."""
    columns = max(len(row) for row in rows)
    longest = [1.0] * columns
    for row in rows:
        for index in range(columns):
            raw = row[index] if index < len(row) else ""
            text = plain(raw)
            # Inline `code` is set in a monospace face, which is wider than the
            # average proportional glyph — give those cells extra room so long
            # tokens such as MARK_PAYMENT_PENDING are not broken mid-word.
            length = len(text) * (1.3 if "`" in raw else 1.0)
            longest[index] = max(longest[index], min(length, 70))
    weights = [value ** 0.85 for value in longest]
    minimum = 0.085 * total
    scale = sum(weights)
    widths = [weight / scale * total for weight in weights]
    # Give every column at least `minimum`, taking the excess from the widest.
    for _ in range(3):
        short = [i for i, w in enumerate(widths) if w < minimum]
        if not short:
            break
        deficit = sum(minimum - widths[i] for i in short)
        donors = [i for i in range(columns) if i not in short and widths[i] > minimum]
        for i in short:
            widths[i] = minimum
        give = deficit / len(donors) if donors else 0
        for i in donors:
            widths[i] -= min(give, widths[i] - minimum)
    return widths


def table_flowable(rows: list[list[str]], styles: dict[str, ParagraphStyle]) -> Table:
    header, body = rows[0], rows[2:] if len(rows) > 2 else rows[1:]
    widths = column_widths([header] + body, CONTENT_WIDTH)

    cell_style, head_style = styles["cell"], styles["cell_head"]
    data = [[Paragraph(inline(text), head_style) for text in row_cells(header, len(widths))]]
    for row in body:
        data.append([Paragraph(inline(text), cell_style) for text in row_cells(row, len(widths))])

    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), PRIMARY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.9, PRIMARY_DARK),
        ("LEFTPADDING", (0, 0), (-1, -1), 5.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5.5),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
    ]
    for index in range(1, len(data)):
        if index % 2 == 0:
            style.append(("BACKGROUND", (0, index), (-1, index), ZEBRA))
    table.setStyle(TableStyle(style))
    table.spaceBefore = 3
    table.spaceAfter = 11
    return table


def row_cells(row: list[str], columns: int) -> list[str]:
    """Pad or trim a row so it matches the column count."""
    cells = list(row[:columns])
    while len(cells) < columns:
        cells.append("")
    return cells


def list_tree(items: list[tuple[int, bool, str]], indent: int) -> list[dict]:
    """Group a flat (indent, numbered, text) list into nested nodes."""
    nodes: list[dict] = []
    index = 0
    while index < len(items):
        depth, numbered, text = items[index]
        if depth < indent:
            break
        children: list[tuple[int, bool, str]] = []
        cursor = index + 1
        while cursor < len(items) and items[cursor][0] > depth:
            children.append(items[cursor])
            cursor += 1
        nodes.append(
            {
                "text": text,
                "numbered": numbered,
                "children": list_tree(children, children[0][0]) if children else [],
            }
        )
        index = cursor
    return nodes


def list_flowable(items: list[tuple[int, bool, str]], styles: dict[str, ParagraphStyle]):
    def render(nodes: list[dict], depth: int):
        flowables = []
        for node in nodes:
            para = Paragraph(inline(node["text"]), styles["body_tight"])
            numbered = node["numbered"]
            if node["children"]:
                para = [para, render(node["children"], depth + 1)]
            flowables.append(ListItem(para))
        return ListFlowable(
            flowables,
            bulletType="1" if numbered else "bullet",
            bulletFontName="Sans",
            bulletFontSize=8.2,
            bulletOffsetX=-6,
            bulletOffsetY=-1,
            leftIndent=13,
            bulletColor=PRIMARY if numbered else ACCENT,
            bulletStart="1",
            spaceBefore=1,
            spaceAfter=3,
        )

    top = list_tree(items, min(indent for indent, _, _ in items))
    flowable = render(top, 0)
    # Keep short lists on one page; long ones may break wherever they need to.
    return [KeepTogether([flowable])] if len(items) <= 3 else [flowable]


# --------------------------------------------------------------------------- #
# Document
# --------------------------------------------------------------------------- #
class GuideDoc(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, pagesize=A4, **kwargs)
        self.current_section = ""
        cover_frame = Frame(
            0,
            0,
            PAGE_WIDTH,
            PAGE_HEIGHT,
            id="cover",
            leftPadding=MARGIN_X,
            rightPadding=MARGIN_X,
            topPadding=0,
            bottomPadding=0,
        )
        body_frame = Frame(
            MARGIN_X,
            MARGIN_BOTTOM,
            CONTENT_WIDTH,
            PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM,
            id="body",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(
            [
                PageTemplate(id="Cover", frames=[cover_frame], onPage=self.draw_cover),
                PageTemplate(id="Body", frames=[body_frame], onPage=self.draw_chrome),
            ]
        )

    # -- chrome ------------------------------------------------------------- #
    def beforeDocument(self):
        # multiBuild runs several passes; the running header must start empty each time.
        self.current_section = ""

    def draw_cover(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(PRIMARY_DARK)
        canvas.rect(0, PAGE_HEIGHT - COVER_BAND, PAGE_WIDTH, COVER_BAND, stroke=0, fill=1)
        canvas.setFillColor(ACCENT)
        canvas.rect(0, PAGE_HEIGHT - COVER_BAND - 0.4 * cm, PAGE_WIDTH, 0.4 * cm, stroke=0, fill=1)
        canvas.setFillColor(colors.HexColor("#E3F1E7"))
        canvas.rect(0, 0, PAGE_WIDTH, 1.1 * cm, stroke=0, fill=1)
        canvas.setFillColor(PRIMARY)
        canvas.setFont("Sans", 8.6)
        canvas.drawString(MARGIN_X, 0.45 * cm, "FEMS — Forest Exploitation Management System")
        canvas.drawRightString(PAGE_WIDTH - MARGIN_X, 0.45 * cm, f"{date.today():%d %B %Y}")
        canvas.restoreState()

    def draw_chrome(self, canvas, doc):
        canvas.saveState()
        canvas.setFont("Sans", 7.6)
        canvas.setFillColor(INK_FAINT)
        canvas.drawString(MARGIN_X, PAGE_HEIGHT - 1.35 * cm, "FEMS — User Guide")
        if self.current_section:
            canvas.drawRightString(
                PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 1.35 * cm, self.current_section
            )
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN_X, PAGE_HEIGHT - 1.55 * cm, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 1.55 * cm)
        canvas.line(MARGIN_X, 1.55 * cm, PAGE_WIDTH - MARGIN_X, 1.55 * cm)
        canvas.setFont("Sans", 7.6)
        canvas.drawRightString(PAGE_WIDTH - MARGIN_X, 1.05 * cm, str(doc.page))
        canvas.drawString(MARGIN_X, 1.05 * cm, "docs/USER-GUIDE.md")
        canvas.restoreState()

    # -- table of contents -------------------------------------------------- #
    def afterFlowable(self, flowable):
        if not isinstance(flowable, Heading):
            return
        # reportlab 5 splits the two jobs: a named destination, then the outline
        # entry that makes the section show up in the PDF bookmarks panel.
        self.canv.bookmarkPage(flowable.slug)
        self.canv.addOutlineEntry(
            flowable.toc_text, flowable.slug, level=0 if flowable.level == 2 else 1
        )
        if flowable.level == 2:
            self.current_section = flowable.toc_text
            entry = flowable.toc_text
            match = HEADING_NUMBER_RE.match(entry)
            if match:
                entry = f'<font color="#C97B18">{escape(match.group(1))}</font>&#160;&#160;{inline(match.group(2))}'
            else:
                entry = inline(entry)
            self.notify("TOCEntry", (0, entry, self.page, flowable.slug))
        elif flowable.level == 3:
            self.notify("TOCEntry", (1, inline(flowable.toc_text), self.page, flowable.slug))


# --------------------------------------------------------------------------- #
# Story
# --------------------------------------------------------------------------- #
def build_story(markdown: str, styles: dict[str, ParagraphStyle]) -> list:
    blocks = parse_blocks(markdown)
    story: list = []

    # ---- cover ------------------------------------------------------------ #
    story.append(Spacer(1, 4.0 * cm))
    story.append(Paragraph("FEMS", styles["cover_title"]))
    story.append(Paragraph("Forest Exploitation Management System", styles["cover_sub"]))
    story.append(Paragraph("USER&#160;GUIDE", styles["cover_kicker"]))
    story.append(
        HRFlowable(
            width="35%",
            thickness=1.4,
            color=colors.HexColor("#F0B24A"),
            spaceBefore=0,
            spaceAfter=14,
            hAlign="LEFT",
        )
    )
    story.append(
        Paragraph(
            "How to use the application: your account and role, every screen, and the "
            "workflows that carry a forest file from application to inspection, "
            "payment and compliance.",
            styles["cover_note"],
        )
    )
    story.append(Spacer(1, 0.7 * cm))
    story.append(
        Paragraph(
            '<font color="#F0B24A">Mobile app&#160;·&#160;REST API&#160;·&#160;'
            "Offline field capture&#160;·&#160;AI alerts</font>",
            styles["cover_note"],
        )
    )
    story.append(Spacer(1, 6.2 * cm))
    story.append(
        HRFlowable(
            width="28%", thickness=1.0, color=ACCENT, spaceBefore=0, spaceAfter=12, hAlign="LEFT"
        )
    )
    story.append(
        Paragraph(
            "This guide covers the FEMS mobile app — Android, iOS and the web — and the "
            "REST API behind it: your account and role, every screen, and the workflows "
            "that carry a forest file from application to inspection, payment and "
            "compliance.",
            styles["cover_lead"],
        )
    )
    story.append(
        Paragraph(
            f"Generated from <font face=\"Mono\" size=\"8.4\">docs/USER-GUIDE.md</font>"
            f"&#160;&#160;·&#160;&#160;{date.today():%d %B %Y}",
            styles["cover_meta"],
        )
    )
    story.append(NextPageTemplate("Body"))
    story.append(PageBreak())

    # ---- contents --------------------------------------------------------- #
    story.append(Paragraph("Contents", styles["toc_title"]))
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            "toc1", fontName="Sans", fontSize=10.6, leading=19, textColor=INK,
            leftIndent=2, firstLineIndent=0, spaceBefore=4,
        ),
        ParagraphStyle(
            "toc2", fontName="Sans", fontSize=9.2, leading=15, textColor=INK_SOFT,
            leftIndent=20, firstLineIndent=0,
        ),
    ]
    toc.dotsMinLevel = 0
    toc.rightColumnWidth = 40
    story.append(toc)
    story.append(PageBreak())

    # ---- body ------------------------------------------------------------- #
    skipping_contents = False
    for kind, payload in blocks:
        if kind == "h2" and "Getting started" in str(payload):
            skipping_contents = False
        if kind == "p" and plain(str(payload)) == "Contents":
            skipping_contents = True
            continue
        if skipping_contents:
            # Skip the hand-written contents block: the PDF has a real one.
            if kind == "rule":
                skipping_contents = False
            continue
        if kind == "h1":
            continue  # the title lives on the cover

        if kind in ("h2", "h3", "h4"):
            story.append(heading_flowable(kind, str(payload), styles))
        elif kind == "p":
            story.append(Paragraph(inline(str(payload)), styles["body"]))
        elif kind == "code":
            story.append(code_flowable(str(payload), styles))
        elif kind == "quote":
            story.append(quote_flowable(str(payload), styles))
        elif kind == "table":
            story.append(table_flowable(payload, styles))  # type: ignore[arg-type]
        elif kind == "list":
            story.extend(list_flowable(payload, styles))  # type: ignore[arg-type]
        elif kind == "rule":
            story.append(
                HRFlowable(
                    width="100%", thickness=0.6, color=RULE, spaceBefore=6, spaceAfter=10
                )
            )
    return story


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=os.path.join(root, "docs", "USER-GUIDE.md"))
    parser.add_argument("--output", default=os.path.join(root, "docs", "FEMS-User-Guide.pdf"))
    args = parser.parse_args()

    register_fonts()
    styles = build_styles()
    with open(args.input, encoding="utf-8") as handle:
        markdown = handle.read()

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    doc = GuideDoc(
        args.output,
        title="FEMS — User Guide",
        author="FEMS",
        subject="How to use the FEMS mobile app and API",
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
    )
    doc.multiBuild(build_story(markdown, styles))
    size = os.path.getsize(args.output)
    print(f"{os.path.relpath(args.output, root)} — {size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
