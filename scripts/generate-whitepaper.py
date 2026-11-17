from __future__ import annotations

import html
import re
from pathlib import Path

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    HRFlowable,
    Image as RLImage,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "assets" / "耕策技术白皮书.pdf"
REVIEW = ROOT / "test-results" / "ui"

FONT_REGULAR = Path(r"C:\Windows\Fonts\Deng.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\Dengb.ttf")
FONT_FALLBACK = Path(r"C:\Windows\Fonts\NotoSansSC-VF.ttf")

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN_X = 54
MARGIN_TOP = 62
MARGIN_BOTTOM = 52
CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2

INK = colors.HexColor("#1E2520")
MUTED = colors.HexColor("#69726C")
HAIRLINE = colors.HexColor("#D9DDD9")
GREEN = colors.HexColor("#355B45")
GREEN_DARK = colors.HexColor("#243D2F")
GREEN_PALE = colors.HexColor("#EEF4F0")
AMBER = colors.HexColor("#A86F28")
AMBER_PALE = colors.HexColor("#FBF3E6")
SLATE_PALE = colors.HexColor("#F3F5F4")
WHITE = colors.white


def register_fonts() -> None:
    regular = FONT_REGULAR if FONT_REGULAR.exists() else FONT_FALLBACK
    bold = FONT_BOLD if FONT_BOLD.exists() else regular
    if not regular.exists():
        raise FileNotFoundError("No Chinese font available for whitepaper generation")
    pdfmetrics.registerFont(TTFont("Deng", str(regular)))
    pdfmetrics.registerFont(TTFont("DengBold", str(bold)))
    pdfmetrics.registerFontFamily(
        "Deng",
        normal="Deng",
        bold="DengBold",
        italic="Deng",
        boldItalic="DengBold",
    )


register_fonts()


def build_styles() -> dict[str, ParagraphStyle]:
    sample = getSampleStyleSheet()
    styles = {
        "Body": ParagraphStyle(
            "Body",
            parent=sample["BodyText"],
            fontName="Deng",
            fontSize=9.2,
            leading=14.5,
            textColor=INK,
            alignment=TA_JUSTIFY,
            firstLineIndent=18,
            spaceAfter=5.2,
            wordWrap="CJK",
            allowWidows=0,
            allowOrphans=0,
        ),
        "BodyNoIndent": ParagraphStyle(
            "BodyNoIndent",
            parent=sample["BodyText"],
            fontName="Deng",
            fontSize=9.2,
            leading=14.5,
            textColor=INK,
            alignment=TA_JUSTIFY,
            spaceAfter=5.2,
            wordWrap="CJK",
        ),
        "H1": ParagraphStyle(
            "H1",
            parent=sample["Heading1"],
            fontName="DengBold",
            fontSize=17,
            leading=22,
            textColor=GREEN_DARK,
            spaceBefore=0,
            spaceAfter=12,
            keepWithNext=1,
            wordWrap="CJK",
        ),
        "H2": ParagraphStyle(
            "H2",
            parent=sample["Heading2"],
            fontName="DengBold",
            fontSize=12.2,
            leading=17,
            textColor=GREEN,
            spaceBefore=11,
            spaceAfter=5,
            keepWithNext=1,
            wordWrap="CJK",
        ),
        "H3": ParagraphStyle(
            "H3",
            parent=sample["Heading3"],
            fontName="DengBold",
            fontSize=10.2,
            leading=15,
            textColor=INK,
            spaceBefore=8,
            spaceAfter=3,
            keepWithNext=1,
            wordWrap="CJK",
        ),
        "Bullet": ParagraphStyle(
            "Bullet",
            parent=sample["BodyText"],
            fontName="Deng",
            fontSize=9.0,
            leading=14,
            textColor=INK,
            leftIndent=15,
            firstLineIndent=-9,
            bulletIndent=1,
            spaceAfter=2.8,
            wordWrap="CJK",
        ),
        "TableHead": ParagraphStyle(
            "TableHead",
            parent=sample["BodyText"],
            fontName="DengBold",
            fontSize=7.7,
            leading=10.2,
            textColor=WHITE,
            alignment=TA_LEFT,
            wordWrap="CJK",
        ),
        "TableCell": ParagraphStyle(
            "TableCell",
            parent=sample["BodyText"],
            fontName="Deng",
            fontSize=7.5,
            leading=10.7,
            textColor=INK,
            alignment=TA_LEFT,
            wordWrap="CJK",
        ),
        "Code": ParagraphStyle(
            "Code",
            parent=sample["BodyText"],
            fontName="Deng",
            fontSize=7.4,
            leading=11.2,
            textColor=colors.HexColor("#25302A"),
            leftIndent=7,
            rightIndent=7,
            spaceBefore=5,
            spaceAfter=5,
            wordWrap="CJK",
        ),
        "Caption": ParagraphStyle(
            "Caption",
            parent=sample["BodyText"],
            fontName="Deng",
            fontSize=7.7,
            leading=10.7,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceBefore=4,
            spaceAfter=8,
            wordWrap="CJK",
        ),
        "Callout": ParagraphStyle(
            "Callout",
            parent=sample["BodyText"],
            fontName="Deng",
            fontSize=8.7,
            leading=13.6,
            textColor=INK,
            alignment=TA_LEFT,
            leftIndent=7,
            rightIndent=7,
            spaceBefore=3,
            spaceAfter=3,
            wordWrap="CJK",
        ),
        "CoverKicker": ParagraphStyle(
            "CoverKicker",
            parent=sample["BodyText"],
            fontName="DengBold",
            fontSize=8,
            leading=11,
            textColor=GREEN,
            alignment=TA_LEFT,
            tracking=0.7,
        ),
        "CoverTitle": ParagraphStyle(
            "CoverTitle",
            parent=sample["Title"],
            fontName="DengBold",
            fontSize=35,
            leading=44,
            textColor=GREEN_DARK,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
        "CoverSubtitle": ParagraphStyle(
            "CoverSubtitle",
            parent=sample["BodyText"],
            fontName="Deng",
            fontSize=15.5,
            leading=23,
            textColor=INK,
            alignment=TA_LEFT,
        ),
        "CoverAbstract": ParagraphStyle(
            "CoverAbstract",
            parent=sample["BodyText"],
            fontName="Deng",
            fontSize=9.4,
            leading=16,
            textColor=colors.HexColor("#39433D"),
            alignment=TA_JUSTIFY,
            wordWrap="CJK",
        ),
        "MetaLabel": ParagraphStyle(
            "MetaLabel",
            parent=sample["BodyText"],
            fontName="DengBold",
            fontSize=7.6,
            leading=10,
            textColor=MUTED,
            alignment=TA_LEFT,
        ),
        "MetaValue": ParagraphStyle(
            "MetaValue",
            parent=sample["BodyText"],
            fontName="Deng",
            fontSize=8.6,
            leading=12,
            textColor=INK,
            alignment=TA_LEFT,
            wordWrap="CJK",
        ),
        "TOCHead": ParagraphStyle(
            "TOCHead",
            parent=sample["Heading1"],
            fontName="DengBold",
            fontSize=18,
            leading=22,
            textColor=GREEN_DARK,
            spaceAfter=16,
        ),
    }
    return styles


STYLES = build_styles()


class TocParagraph(Paragraph):
    def __init__(self, text: str, style: ParagraphStyle, toc_level: int | None = None, **kwargs):
        super().__init__(text, style, **kwargs)
        self.toc_level = toc_level


class GengceDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, **kwargs)
        cover_frame = Frame(
            MARGIN_X,
            MARGIN_BOTTOM,
            CONTENT_WIDTH,
            PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM,
            id="cover_frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        front_frame = Frame(
            MARGIN_X,
            MARGIN_BOTTOM,
            CONTENT_WIDTH,
            PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM,
            id="front_frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        body_frame = Frame(
            MARGIN_X,
            MARGIN_BOTTOM,
            CONTENT_WIDTH,
            PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM,
            id="body_frame",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(
            [
                PageTemplate(id="cover", frames=[cover_frame], onPage=self._cover_page),
                PageTemplate(id="front", frames=[front_frame], onPage=self._front_page),
                PageTemplate(id="body", frames=[body_frame], onPage=self._body_page),
            ]
        )

    def _cover_page(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#F7F9F7"))
        canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)
        canvas.setFillColor(GREEN_DARK)
        canvas.rect(0, PAGE_HEIGHT - 16, PAGE_WIDTH, 16, stroke=0, fill=1)
        canvas.setStrokeColor(colors.HexColor("#BFC8C1"))
        canvas.setLineWidth(0.7)
        canvas.line(MARGIN_X, 78, PAGE_WIDTH - MARGIN_X, 78)
        canvas.setFont("Deng", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_X, 60, "耕策项目组  |  竞赛评审版  |  2026 年 11 月")
        canvas.restoreState()

    def _front_page(self, canvas, doc):
        canvas.saveState()
        canvas.setFont("Deng", 7.4)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(PAGE_WIDTH - MARGIN_X, 25, f"i-{max(1, doc.page - 1)}")
        canvas.restoreState()

    def _body_page(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(HAIRLINE)
        canvas.setLineWidth(0.55)
        canvas.line(MARGIN_X, PAGE_HEIGHT - 36, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 36)
        canvas.setFont("Deng", 7.2)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_X, PAGE_HEIGHT - 29, "耕策技术白皮书")
        canvas.drawRightString(PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 29, "赛道一 | 农业智能体")
        canvas.line(MARGIN_X, 34, PAGE_WIDTH - MARGIN_X, 34)
        canvas.drawString(MARGIN_X, 22, "证据驱动、可验证、可回放的桌面农业 Agent")
        canvas.setFillColor(INK)
        canvas.setFont("DengBold", 8.2)
        canvas.drawRightString(PAGE_WIDTH - MARGIN_X, 21, f"{doc.page}")
        canvas.restoreState()

    def afterFlowable(self, flowable) -> None:
        if isinstance(flowable, TocParagraph) and flowable.toc_level is not None:
            text = re.sub(r"<[^>]+>", "", flowable.getPlainText())
            key = f"heading-{self.seq.nextf('outline')}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=flowable.toc_level, closed=False)
            self.notify("TOCEntry", (flowable.toc_level, text, self.page))


def p(text: str, style: str = "Body") -> Paragraph:
    return Paragraph(text, STYLES[style])


def h1(number: str, title: str) -> TocParagraph:
    label = f"{number}  {title}" if number else title
    return TocParagraph(label, STYLES["H1"], toc_level=0)


def h2(number: str, title: str) -> TocParagraph:
    label = f"{number}  {title}" if number else title
    return TocParagraph(label, STYLES["H2"], toc_level=None)


def h3(number: str, title: str) -> Paragraph:
    label = f"{number}  {title}" if number else title
    return Paragraph(label, STYLES["H3"])


def bullets(items: list[str]) -> KeepTogether:
    return KeepTogether([Paragraph(item, STYLES["Bullet"], bulletText="•") for item in items])


def callout(title: str, body: str, tone: str = "green") -> Table:
    fill = GREEN_PALE if tone == "green" else AMBER_PALE
    accent = GREEN if tone == "green" else AMBER
    content = (
        f'<font name="DengBold" color="{accent.hexval()}">{html.escape(title)}</font><br/>'
        f"{body}"
    )
    box = Table(
        [[Paragraph(content, STYLES["Callout"])]],
        colWidths=[CONTENT_WIDTH],
        hAlign="LEFT",
        spaceBefore=5,
        spaceAfter=7,
    )
    box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), fill),
                ("BOX", (0, 0), (-1, -1), 0.45, colors.HexColor("#D7DDD8")),
                ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return box


def data_table(
    headers: list[str],
    rows: list[list[str]],
    widths: list[float],
    font_size: float | None = None,
    first_col_bold: bool = False,
    compact: bool = False,
) -> Table:
    cell_style = STYLES["TableCell"]
    if font_size:
        cell_style = ParagraphStyle(
            f"TableCell{font_size}",
            parent=cell_style,
            fontSize=font_size,
            leading=font_size * 1.43,
        )
    normalized = []
    for row in rows:
        if len(row) > len(headers):
            raise ValueError(f"Table row has {len(row)} cells, expected at most {len(headers)}: {row}")
        padded_row = [*row, *([""] * (len(headers) - len(row)))]
        normalized.append(
            [
                Paragraph(
                    f"<b>{html.escape(value)}</b>" if first_col_bold and idx == 0 else html.escape(value),
                    cell_style,
                )
                for idx, value in enumerate(padded_row)
            ]
        )
    table = Table(
        [[Paragraph(html.escape(h), STYLES["TableHead"]) for h in headers], *normalized],
        colWidths=widths,
        repeatRows=1,
        hAlign="LEFT",
        splitByRow=1,
        spaceBefore=4,
        spaceAfter=8,
    )
    style_commands = [
        ("BACKGROUND", (0, 0), (-1, 0), GREEN_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.35, HAIRLINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 4.5 if compact else 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4.5 if compact else 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3.4 if compact else 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.4 if compact else 5),
    ]
    for row_idx in range(1, len(rows) + 1):
        if row_idx % 2 == 0:
            style_commands.append(("BACKGROUND", (0, row_idx), (-1, row_idx), SLATE_PALE))
    table.setStyle(TableStyle(style_commands))
    return table


def code_block(code: str, caption: str | None = None) -> KeepTogether:
    escaped = html.escape(code.strip("\n"))
    escaped = escaped.replace("\n", "<br/>").replace("  ", "&nbsp;&nbsp;")
    paragraph = Paragraph(escaped, STYLES["Code"])
    table = Table([[paragraph]], colWidths=[CONTENT_WIDTH], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F2F4F2")),
                ("BOX", (0, 0), (-1, -1), 0.45, colors.HexColor("#D8DDD9")),
                ("LINEBEFORE", (0, 0), (0, -1), 2.5, GREEN),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    content: list[Flowable] = [Spacer(1, 2), table]
    if caption:
        content.append(p(caption, "Caption"))
    else:
        content.append(Spacer(1, 5))
    return KeepTogether(content)


def figure(path: Path, caption: str, max_width: float = 455, max_height: float = 270) -> KeepTogether:
    if not path.exists():
        raise FileNotFoundError(f"Whitepaper asset not found: {path}")
    with PILImage.open(path) as image:
        width, height = image.size
    scale = min(max_width / width, max_height / height)
    draw_width = width * scale
    draw_height = height * scale
    image = RLImage(str(path), width=draw_width, height=draw_height)
    frame = Table([[image]], colWidths=[draw_width + 2], hAlign="CENTER")
    frame.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.55, colors.HexColor("#CAD1CB")),
                ("LEFTPADDING", (0, 0), (-1, -1), 1),
                ("RIGHTPADDING", (0, 0), (-1, -1), 1),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    return KeepTogether([Spacer(1, 3), frame, p(caption, "Caption")])


def arrow(canvas, x1, y1, x2, y2, color=GREEN, width=0.9, head=4.5):
    canvas.setStrokeColor(color)
    canvas.setFillColor(color)
    canvas.setLineWidth(width)
    canvas.line(x1, y1, x2, y2)
    if abs(x2 - x1) >= abs(y2 - y1):
        direction = 1 if x2 >= x1 else -1
        canvas.line(x2, y2, x2 - direction * head, y2 + head * 0.55)
        canvas.line(x2, y2, x2 - direction * head, y2 - head * 0.55)
    else:
        direction = 1 if y2 >= y1 else -1
        canvas.line(x2, y2, x2 - head * 0.55, y2 - direction * head)
        canvas.line(x2, y2, x2 + head * 0.55, y2 - direction * head)


def box(canvas, x, y, w, h, label: str, sub: str | None = None, fill=WHITE, stroke=HAIRLINE, accent=None):
    canvas.setFillColor(fill)
    canvas.setStrokeColor(stroke)
    canvas.setLineWidth(0.65)
    canvas.roundRect(x, y, w, h, 4, stroke=1, fill=1)
    if accent:
        canvas.setFillColor(accent)
        canvas.roundRect(x, y + h - 3, w, 3, 1.5, stroke=0, fill=1)
    canvas.setFillColor(INK)
    canvas.setFont("DengBold", 7.3)
    canvas.drawCentredString(x + w / 2, y + h / 2 + (4 if sub else 0), label)
    if sub:
        canvas.setFillColor(MUTED)
        canvas.setFont("Deng", 6.1)
        canvas.drawCentredString(x + w / 2, y + h / 2 - 7, sub)


class ArchitectureDiagram(Flowable):
    def __init__(self):
        super().__init__()
        self.width = CONTENT_WIDTH
        self.height = 402

    def draw(self):
        c = self.canv
        c.saveState()

        layer_x = 66
        layer_w = CONTENT_WIDTH - layer_x - 4
        layers = [
            (336, "交互层", ["单一对话画布", "业务抽屉", "运行与产出"]),
            (258, "桌面宿主", ["Electron 窗口", "受限 preload", "REST / SSE"]),
            (180, "Mastra 运行时", ["Agent Registry", "Decision Workflow", "Capability Snapshot"]),
            (102, "领域能力", ["天气 / 土壤", "选种 / 经济", "农艺 / Verifier"]),
            (24, "证据与持久化", ["公开数据 / 模型", "MCP / RAG", "SQLite"]),
        ]
        for y, label, items in layers:
            c.setFont("DengBold", 7)
            c.setFillColor(GREEN)
            c.drawRightString(layer_x - 8, y + 20, label)
            item_w = (layer_w - 12) / 3
            for index, item in enumerate(items):
                x = layer_x + index * (item_w + 6)
                fill = GREEN_PALE if y in (180, 102) else WHITE
                accent = GREEN if y in (336, 180, 102) else None
                box(c, x, y, item_w, 43, item, fill=fill, accent=accent)
        for y1, y2 in [(336, 301), (258, 223), (180, 145), (102, 67)]:
            arrow(c, CONTENT_WIDTH / 2, y1, CONTENT_WIDTH / 2, y2 + 0.5)
        c.setFillColor(MUTED)
        c.setFont("Deng", 6.5)
        c.drawString(66, 391, "用户只需面对对话；编排、证据、工具和持久化在本地受控运行")
        c.restoreState()


class DecisionDiagram(Flowable):
    def __init__(self):
        super().__init__()
        self.width = CONTENT_WIDTH
        self.height = 268

    def draw(self):
        c = self.canv
        c.saveState()
        gap = 8
        row_one = [
            ("上下文", "基地 / 地块"),
            ("能力快照", "Skills / MCP / KB"),
            ("并行取证", "Weather + Soil"),
            ("证据包", "EvidenceBundle"),
        ]
        row_two = [
            ("候选作物", "四目标排序"),
            ("经济摘要", "用户可覆盖"),
            ("农艺编译", "可执行任务"),
            ("校验 / 修复", "最多 2 轮"),
            ("发布", "持久化 + SSE"),
        ]
        w1 = (CONTENT_WIDTH - gap * 3) / 4
        for idx, (label, sub) in enumerate(row_one):
            x = idx * (w1 + gap)
            fill = GREEN_PALE if idx in (1, 2) else WHITE
            box(c, x, 185, w1, 53, label, sub, fill=fill, accent=GREEN)
            if idx < 3:
                arrow(c, x + w1 + 1, 211, x + w1 + gap - 1, 211)

        w2 = (CONTENT_WIDTH - gap * 4) / 5
        for idx, (label, sub) in enumerate(row_two):
            x = idx * (w2 + gap)
            fill = AMBER_PALE if idx == 3 else WHITE
            accent = AMBER if idx == 3 else GREEN
            box(c, x, 92, w2, 56, label, sub, fill=fill, accent=accent)
            if idx < 4:
                arrow(c, x + w2 + 1, 120, x + w2 + gap - 1, 120, color=AMBER if idx == 3 else GREEN)

        c.setStrokeColor(GREEN)
        c.setLineWidth(0.85)
        c.line(0 + w1 / 2, 184, 0 + w1 / 2, 155)
        c.line(0 + w1 / 2, 155, CONTENT_WIDTH - w2 / 2, 155)
        arrow(c, CONTENT_WIDTH - w2 / 2, 155, CONTENT_WIDTH - w2 / 2, 149)
        arrow(c, CONTENT_WIDTH - w2 / 2, 92, CONTENT_WIDTH - w2 / 2, 63)

        risk_x = 3 * (w2 + gap)
        c.setFillColor(AMBER_PALE)
        c.setStrokeColor(AMBER)
        c.roundRect(risk_x - 5, 22, w2 + 10, 31, 4, stroke=1, fill=1)
        c.setFillColor(colors.HexColor("#86551B"))
        c.setFont("DengBold", 6.8)
        c.drawCentredString(risk_x + w2 / 2, 34, "critical 阻断发布")
        arrow(c, risk_x + w2 / 2, 53, risk_x + w2 / 2, 58, color=AMBER)

        c.setFillColor(MUTED)
        c.setFont("Deng", 6.5)
        c.drawString(0, 249, "Mastra Workflow 的真实 DAG：二阶段并行、结构化交接、独立校验与有限修复")
        c.restoreState()


class LoopDiagram(Flowable):
    def __init__(self):
        super().__init__()
        self.width = CONTENT_WIDTH
        self.height = 232

    def draw(self):
        c = self.canv
        c.saveState()
        nodes = [
            ("01", "提出目标", "对话输入", 0),
            ("02", "取得证据", "天气 / 土壤 / 知识", 1),
            ("03", "形成候选", "四目标分开排序", 2),
            ("04", "用户决策", "采用或追问", 3),
            ("05", "建立方案", "可执行任务", 4),
            ("06", "执行记录", "计划 / 实际 / 成本", 5),
            ("07", "结果反馈", "产量 / 品质 / 收益", 6),
            ("08", "评估改进", "回归集与版本门禁", 7),
        ]
        box_w = 100
        box_h = 54
        gap_x = (CONTENT_WIDTH - box_w * 4) / 3
        for idx, (num, title, sub, pos) in enumerate(nodes):
            row = pos // 4
            col = pos % 4
            x = col * (box_w + gap_x)
            y = 139 if row == 0 else 43
            fill = GREEN_PALE if title in ("用户决策", "结果反馈") else WHITE
            accent = GREEN if title in ("用户决策", "结果反馈") else colors.HexColor("#95A198")
            box(c, x, y, box_w, box_h, f"{num}  {title}", sub, fill=fill, accent=accent)
            if col < 3:
                arrow(c, x + box_w + 1, y + box_h / 2, x + box_w + gap_x - 1, y + box_h / 2)
        arrow(c, CONTENT_WIDTH - box_w / 2, 138, CONTENT_WIDTH - box_w / 2, 98)
        arrow(c, CONTENT_WIDTH - box_w / 2, 43, CONTENT_WIDTH - box_w / 2, 23)
        c.setStrokeColor(GREEN)
        c.setLineWidth(0.9)
        c.line(CONTENT_WIDTH - box_w / 2, 23, box_w / 2, 23)
        arrow(c, box_w / 2, 23, box_w / 2, 42)
        c.setFillColor(MUTED)
        c.setFont("Deng", 6.5)
        c.drawString(0, 211, "“建议”不是终点：方案、执行、结果与反馈共同构成可验证的数据闭环")
        c.restoreState()


def add_cover(story: list[Flowable]) -> None:
    story.extend(
        [
            Spacer(1, 42),
            p("TRACK 01  /  AGRICULTURAL INTELLIGENCE", "CoverKicker"),
            Spacer(1, 19),
            p("耕策", "CoverTitle"),
            p("面向小型家庭农场与大型合作社的<br/>对话式农业 Agent 技术白皮书", "CoverSubtitle"),
            Spacer(1, 24),
            HRFlowable(width="72%", thickness=1.1, color=GREEN, hAlign="LEFT"),
            Spacer(1, 20),
            p(
                "以地块为最小决策单元，把位置、天气、土壤、区域农艺规则、公开经济估算和真实执行结果"
                "组织成一条可追溯的业务闭环。耕策不是“会聊天的农业页面”，而是以单一对话为主入口、"
                "以 Mastra 编排多专业 Agent、以确定性工具守住数值与安全边界、以独立 Verifier 决定方案"
                "能否发布的桌面农业助手。",
                "CoverAbstract",
            ),
            Spacer(1, 30),
            Table(
                [
                    [
                        p("产品形态", "MetaLabel"),
                        p("Electron 桌面应用，单一对话，本地 Node 服务与 SQLite", "MetaValue"),
                    ],
                    [
                        p("Agent 运行时", "MetaLabel"),
                        p("Mastra 1.83，Workflow / Agent / MCP / RAG 统一生命周期", "MetaValue"),
                    ],
                    [
                        p("模型接入", "MetaLabel"),
                        p("DeepSeek、阿里百炼千问，服务端 OpenAI 兼容接口", "MetaValue"),
                    ],
                    [
                        p("首版区域", "MetaLabel"),
                        p("湖北为高可信区域；全国可运行，但按证据丰度显示置信度", "MetaValue"),
                    ],
                ],
                colWidths=[86, CONTENT_WIDTH - 86],
                hAlign="LEFT",
                style=TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LINEBELOW", (0, 0), (-1, -2), 0.4, HAIRLINE),
                        ("TOPPADDING", (0, 0), (-1, -1), 8),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ]
                ),
            ),
            Spacer(1, 16),
            p("版本 1.0  |  2026 年 11 月  |  文档用途：赛道一初赛方案书", "BodyNoIndent"),
            NextPageTemplate("front"),
            PageBreak(),
        ]
    )


def add_front_matter(story: list[Flowable]) -> None:
    story.extend(
        [
            Spacer(1, 10),
            h1("", "文档说明"),
            p(
                "本白皮书依据耕策当前可运行版本、项目技术文档、自动化测试结果和真实桌面截图编写。"
                "文档中的“已实现”表示在本仓库当前版本中已有代码路径和可执行交互；“建议”“目标”"
                "或“后续”表示仍需生产验证、真实客户试点或更完整数据支撑。两种状态不会被混写。",
            ),
            p(
                "耕策首版以湖北为高可信区域。公开天气和土壤数据可用于全国位置的初步分析，但区域农艺"
                "规则、播期与品种建议具有显著地域差异。系统不会用湖北规则强行冒充全国事实；当证据"
                "不足时，应降低置信度、显示缺口，并在需要时将测土、现场复核或当地农技确认加入正式任务。",
            ),
            callout(
                "数据与建议边界",
                "系统不承诺增产、收益或病虫害识别准确率，不提供农药处方，不接入传感器、农机或水肥硬件。"
                "公开价格、产量和成本均为参考估算，可由用户用当地数据覆盖；所有涉及作物、投入、收益与"
                "治理的决定，最终由用户结合田间实际作出。",
                "amber",
            ),
            h2("文档约定", ""),
            data_table(
                ["状态", "在本白皮书中的含义"],
                [
                    ["已实现", "仓库中存在对应页面、接口、工作流或数据模型，并通过类型检查、自动化测试或交互验收。"],
                    ["已验证", "已在明确日期与运行环境中执行，结果可复核；不自动等同于长期生产稳定性。"],
                    ["目标", "有清晰工程路径，但尚未声称达到生产指标或真实客户效果。"],
                    ["演示数据", "预置账号、基地、地块与历史记录为合成材料，仅用于完整业务流程展示。"],
                ],
                [78, CONTENT_WIDTH - 78],
                first_col_bold=True,
            ),
            PageBreak(),
            p("目录", "TOCHead"),
        ]
    )
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            "TOCLevel0",
            fontName="DengBold",
            fontSize=8.6,
            leading=12.5,
            textColor=INK,
            leftIndent=0,
            firstLineIndent=0,
            spaceBefore=2.4,
            spaceAfter=1,
            rightIndent=22,
            wordWrap="CJK",
        ),
        ParagraphStyle(
            "TOCLevel1",
            fontName="Deng",
            fontSize=7.8,
            leading=10.8,
            textColor=MUTED,
            leftIndent=15,
            firstLineIndent=0,
            spaceBefore=0,
            spaceAfter=0,
            rightIndent=22,
            wordWrap="CJK",
        ),
    ]
    toc.dotsMinLevel = 0
    story.extend(
        [
            toc,
            Spacer(1, 12),
            h2("", "阅读指引"),
            p(
                "若评审希望快速核验项目真实性与技术差异，可先阅读摘要、第 5 章和第 7 章；若关注农业"
                "业务是否落地，可重点查看第 2、6、8 章；若关注可运行性与工程验证，可查看第 9、12 章"
                "与附录 A。赛道一提交要求与章节的逐项对应关系见第 1 章与附录 A。",
            ),
            NextPageTemplate("body"),
            PageBreak(),
        ]
    )


def add_executive_summary(story: list[Flowable]) -> None:
    story.extend(
        [
            h1("", "摘要"),
            p(
                "农业决策并不缺少信息，真正缺少的是把分散信息变成“可执行且能复盘的决定”的能力。"
                "小农户面对天气、土壤、农艺、成本和市场信息时，往往需要同时处理多个口径；合作社还"
                "要在多基地、多地块之间比较风险与劳力。通用聊天模型可以给出看似完整的段落，却很难"
                "证明数字来自哪里、方案是否受证据约束、执行后是否真的形成了反馈。耕策围绕这一断层，"
                "把农业助手设计成一个以地块为上下文、以结构化证据为输入、以业务闭环为结果边界的桌面"
                "智能体。",
            ),
            p(
                "产品主界面采用连续对话式交互，而不是将多个管理模块平铺成工作台。用户在同一个"
                "输入框中提出“这季种什么”“明天下雨还能追肥吗”“帮我安排田间管理”等问题，系统在"
                "后台完成能力冻结、并行取证、专业 Agent 路由、A2A 产物交接、确定性计算与独立校验，"
                "再以逐字流式的方式在对话中返回结论。方案、记录、结果、基地与评估仍可进入次级抽屉，"
                "但它们是对话之后的自然延伸，不抢占主交互。",
            ),
            p(
                "耕策的核心技术选择是“模型负责表达，代码负责事实，Verifier 负责放行”。天气阈值、"
                "土壤证据层级、作物目标排序、经济复算、播期窗口和任务编译由可测试代码执行；DeepSeek"
                "与千问只接收当前证据包，负责受约束的归纳、解释和语言组织。Mastra 负责 Agent 注册、"
                "Decision/Question Workflow、并行分支、MCP 客户端、知识文档分块与运行生命周期，"
                "使多个专业 Agent 的调用具备可观察、可回放、可评估的工程基础。",
            ),
            data_table(
                ["评审关注点", "耕策的回答", "证据位置"],
                [
                    ["选题价值", "从“问答”推进到选种、建案、执行、结果、反馈的完整闭环。", "第 1、2、7 章"],
                    ["多 Agent", "八个角色有明确输入输出契约，通过 A2A 产物交接，不以自由文本互猜。", "第 4、5 章"],
                    ["业务落地", "一个账号管理多个基地与地块，支持用户本地价格覆盖和执行记录。", "第 2、6 章"],
                    ["可信 AI", "LLM 受证据约束，数值与发布门禁由确定性代码和独立 Verifier 控制。", "第 5、7、10 章"],
                    ["可运行性", "Electron 桌面、Docker 评测环境、23 项自动化测试与真实交互截图。", "第 8、9、12 章"],
                ],
                [77, CONTENT_WIDTH - 160, 83],
                first_col_bold=True,
            ),
            callout(
                "一句话定位",
                "耕策是一个证据驱动、可验证、可回放的桌面农业 Agent：帮助家庭农场和合作社把“种什么、"
                "怎么种、做了什么、结果如何”持续连成一条能够被解释和改进的数据链。",
            ),
        ]
    )


def add_section_1(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("1", "选题背景与场景需求"),
            h2("1.1", "农业决策的真实难点"),
            p(
                "农业生产具有强地域、强季节、强不确定性特征。同一作物在不同纬度、海拔、土壤质地和"
                "灌溉条件下，适宜播期、风险控制和田间作业并不相同；同一地块在连续阴雨、低温、大风"
                "或旱情下，也需要动态调整。农民并非缺少“知识文章”，而是缺少能在具体地块、具体日期"
                "和具体经营目标下，把知识转成下一步动作的工具。",
            ),
            p(
                "传统农业信息服务常见四种断层。第一，数据与建议分离：天气、土壤、价格和农艺指导"
                "各在一个入口，用户需要自己拼接。第二，建议不可执行：生成一段文字，却没有对应播期、"
                "作业步骤、追问我与证据来源。第三，结果不可回放：用户无法知道建议由哪次运行产生、"
                "使用了哪些工具和数据。第四，执行与反馈没有闭环：方案完成后没有实际记录，下一季仍从"
                "零开始。耕策的产品设计直接围绕四种断层展开。",
            ),
            h2("1.2", "两类核心用户"),
            data_table(
                ["用户", "典型约束", "最关心的决策", "耕策对应设计"],
                [
                    [
                        "小型家庭农场",
                        "劳动力有限，现金流敏感，缺少专职农技人员。",
                        "低风险、省工、投入可控；需要直接的行动提醒。",
                        "四目标分开排序；优先显示风险与作业窗口；公开估算可被本地值覆盖。",
                    ],
                    [
                        "大型合作社",
                        "多基地、多地块，人员与记录标准不一致，复盘成本高。",
                        "跨地块比较、统一执行标准、结果汇总和可追溯审计。",
                        "一个账号多基地/地块；运行事件与能力快照；方案、记录、结果按地块持久化。",
                    ],
                ],
                [68, 149, 133, CONTENT_WIDTH - 350],
                first_col_bold=True,
            ),
            p(
                "两类用户的共同点比差异更重要：他们都需要一个“能说明为什么”的农业助手，而不是一个"
                "只会输出结论的黑箱。系统因此不设置隐藏的综合分，而是并列呈现稳健收益、低风险、省工"
                "易管和养地轮作四个目标。用户可以因现金流选择收益优先，也可以因劳动力不足选择省工，"
                "决定权始终保留在经营者手中。",
            ),
            h2("1.3", "从问题到任务的场景拆解"),
            bullets(
                [
                    "<b>选种：</b>读取地块位置、面积、轮作、土壤与近期天气，分别给出不同目标下的候选作物、风险和证据。",
                    "<b>种植管理：</b>把播期、整地、水肥、病虫监测和天气阈值编译为可记录的农事任务。",
                    "<b>天气预警：</b>围绕低温、大风、强降水和蒸散设置阈值，并把风险转成现场复核或作业调整。",
                    "<b>执行台账：</b>记录计划、完成、跳过、成本与备注，保留计划与实际的差异。",
                    "<b>结果复盘：</b>保存产量、品质、收入和成本，与方案估算分开呈现。",
                    "<b>虫害初筛：</b>辅助观察与补拍，不越过本地验证和农药合规边界。",
                ]
            ),
            h2("1.4", "赛道一提交要求映射"),
            p(
                "下表将主办方初赛方案书要求逐项映射到本白皮书章节。该表同时作为评审阅读索引：评审"
                "专家无需猜测某一要求是否被覆盖，可以直接定位到对应设计与运行证据。",
            ),
            data_table(
                ["赛道一要求", "对应内容", "本白皮书位置"],
                [
                    ["选题背景与场景需求分析", "农业决策断层、两类用户、多基地与多地块场景。", "第 1、2 章"],
                    ["平台总体架构设计与技术选型", "Electron、Node、Mastra、SQLite、模型网关与部署边界。", "第 3 章"],
                    ["Agent 角色、工作流与编排逻辑", "八个 Agent、A2A 契约、Decision/Question Workflow。", "第 4、5 章"],
                    ["调度算法与自我循环机制", "并行取证、任务状态、Verifier、最多两轮局部修复。", "第 5、7 章"],
                    ["结果验证与反馈优化", "数值复算、证据检查、发布门禁、真实结果回写和评估候选集。", "第 7 章"],
                    ["核心代码模块与系统截图", "真实模块索引、代码摘录、12 组桌面截图。", "第 8、9 章"],
                    ["测试用例、运行效果与性能评估", "23 项测试、类型检查、构建、UI 与桌面验收、性能边界。", "第 12 章"],
                    ["LLM、RAG、MCP 的作用与局限", "分环节说明贡献、降级策略、不可承诺事项。", "第 10 章"],
                ],
                [152, 242, 93],
                font_size=6.8,
                compact=True,
            ),
        ]
    )


def add_section_2(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("2", "产品定义与种植业务闭环"),
            h2("2.1", "不是工作台，而是桌面农业助手"),
            p(
                "耕策的主体验是连续对话。左侧只承担会话、基地和地块的轻量导航；中部是问题输入、"
                "流式回答、候选比较和方案文档；右侧的“运行与产出”面板仅在用户主动查看时出现。"
                "这一结构采用桌面智能体的任务式交互逻辑：用户不必先学习菜单，也不必在"
                "多个模块之间反复跳转，问题本身就是入口。",
            ),
            p(
                "业务抽屉并未被取消，而是被降级为“需要时展开”的详细操作面。用户可以在对话中看到"
                "候选作物、已采用方案与下一步建议；需要完整编辑时，再打开种植方案、农事记录、结果"
                "复盘、基地与地块、能力中心等抽屉。这样既保持业务完整，也避免把工具拆成一组彼此"
                "割裂的仪表盘。",
            ),
            figure(
                REVIEW / "electron-window.png",
                "图 2-1  耕策桌面主界面：单一对话入口、基地与地块导航、按需展开的运行与产出侧栏",
                455,
                270,
            ),
            h2("2.2", "完整业务闭环"),
            LoopDiagram(),
            p(
                "闭环从“提出问题”开始，但不在“给出建议”结束。一次选种运行会形成候选集合与方案"
                "草案；用户采用某个候选后，系统建立正式种植方案；方案中的任务进入农事记录；收获后"
                "填写结果与反馈；结果再进入地块历史和后续评估候选集。只有这一整条链被打通，Agent"
                "才从内容生成器变成经营过程的一部分。",
            ),
            data_table(
                ["阶段", "用户动作", "Agent / 系统动作", "持久化结果"],
                [
                    ["定位问题", "选择基地与地块，在对话中提问。", "冻结能力快照，识别任务类型与目标。", "task_run、CapabilitySnapshot"],
                    ["取得证据", "等待或按需查看执行轨迹。", "并行查询天气、土壤、知识库与合规 MCP。", "WeatherEvidence、SoilEvidence、EvidenceBundle"],
                    ["形成候选", "切换四类目标，查看风险、证据和估算。", "确定性排序，模型受证据约束解释。", "CandidateSet、EconomicEstimate"],
                    ["用户决策", "覆盖本地价格/亩产/成本，采用候选或继续追问。", "重算数值；建立方案；返回对话文档。", "recommendation、planting_plan"],
                    ["执行记录", "记录完成、跳过、成本和备注。", "将计划任务映射为实际行动，允许差异。", "operation_record"],
                    ["结果复盘", "填写产量、品质、收入、成本和反馈。", "与估算分离保存，形成地块历史。", "outcome_record、feedback"],
                    ["评估改进", "评阅版本与轨迹。", "将偏差进入候选改进集，经回归门禁后发布。", "evaluation_run、agent_version"],
                ],
                [63, 118, 173, CONTENT_WIDTH - 354],
                font_size=7.0,
                first_col_bold=True,
            ),
            h2("2.3", "一个账号管理多个基地和地块"),
            p(
                "数据模型不把农场视为单一“用户表字段”，而是采用账号、基地、地块三层结构。一个"
                "账号下可以有多个基地，一个基地下可以有多个地块；每条对话、方案、作业、结果、土壤"
                "快照和能力绑定都可以落到更具体的地块。删除采用可恢复移除，方案、作业、实收和对话"
                "历史保留，避免把“隐藏一个菜单项”误做成不可逆的数据删除。",
            ),
            p(
                "预置演示账号直接进入完整示例，目的是让评审在无配置、无网络或模型不可用时仍能走通"
                "主流程。演示数据会明确标记为合成材料，不与真实客户效果混为一谈。用户也可以从空"
                "工作区创建基地和第一块田，验证没有示范田依赖的真实路径。",
            ),
            h2("2.4", "四种目标，不做隐藏统一分"),
            data_table(
                ["目标", "适合的用户考虑", "系统如何表达"],
                [
                    ["稳健收益", "愿意承担适度经营波动，希望比较收入与成本。", "展示价格、亩产、收入、现金成本、净收益和证据来源。"],
                    ["低风险", "更关注气象、季节、土壤、排水或轮作风险。", "天气阈值、播期适配、土壤约束和置信度优先出现。"],
                    ["省工易管", "劳动力有限或需要跨地块统一安排。", "从作业频次、窗口和田间管理负担解释候选差异。"],
                    ["养地轮作", "关注长期地力、轮作冲突和土壤健康。", "显示轮作关系、土壤证据与需要补充的监测任务。"],
                ],
                [70, 177, CONTENT_WIDTH - 247],
                first_col_bold=True,
            ),
            p(
                "四类目标不是四个装饰性 Tab，而是各自产生排序和解释。系统可以告诉用户“在当前证据下，"
                "哪一个候选在某个目标上领先”，但不能用一个隐藏的综合分替代用户对现金流、劳力、轮作"
                "和风险的权衡。同一组候选在不同目标下顺序变化，正是产品把决定权交还用户的具体表现。",
            ),
            h2("2.5", "用户覆盖与估算透明"),
            p(
                "公开价格、亩产和成本只作为参考区间。系统将结果拆成单价、亩产、收入、现金成本和"
                "净收益，并支持用户输入当地收购价、预期亩产、亩均成本或地块总成本。被用户覆盖的"
                "字段标记为 user-overridden，数值由代码重新计算，模型不能自行补数。这样既解决全国"
                "公开数据难以实时、难以覆盖所有作物的问题，也保留经济结果的可复核性。",
            ),
            callout(
                "产品原则",
                "用户给出目标，系统扩展选项；系统提出候选，用户作出决定；系统保存过程，结果反哺下一轮。"
                "任何一步都不把“AI 的自信”当作事实。",
            ),
        ]
    )


def add_section_3(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("3", "总体架构与技术选型"),
            h2("3.1", "设计原则"),
            bullets(
                [
                    "<b>对话优先：</b>主流程尽量在一个输入框中完成，详细业务按需进入抽屉。",
                    "<b>本机优先：</b>业务数据、事件与能力快照默认保存在本地 SQLite，模型密钥只存在服务端环境。",
                    "<b>证据优先：</b>Agent 之间传递带类型的产物，不以一段自由文本代替输入输出契约。",
                    "<b>事实与表达分离：</b>数值、季节、单位和发布条件由代码负责，LLM 负责受证据约束的解释。",
                    "<b>失败关闭：</b>MCP 越权、工具不可用、模型超时和证据缺失都必须显式降级。",
                    "<b>可回放：</b>运行事件、能力快照、结构化产物和方案版本能够刷新后恢复。",
                ]
            ),
            h2("3.2", "总体架构图"),
            ArchitectureDiagram(),
            p(
                "系统采用 Electron 宿主、Vite + React + TypeScript 渲染层、Node 24 原生 HTTP/SSE "
                "服务和 Node 内置 SQLite。桌面应用启动时用 utilityProcess 拉起本地服务并选择随机"
                "空闲端口；渲染层通过受限 preload bridge 使用原生窗口能力，业务请求仍走本机 REST/SSE。"
                "浏览器入口只用于开发调试和自动化验收，不作为主交付形态。",
            ),
            h2("3.3", "技术选型说明"),
            data_table(
                ["层", "选型", "选择原因", "边界"],
                [
                    ["桌面宿主", "Electron 45", "无边框窗口、原生窗口控制、跨平台本地服务生命周期。", "渲染层不开 Node 权限，能力经 preload 白名单暴露。"],
                    ["前端", "Vite 7 + React 19 + TypeScript 5.9", "快速构建、组件化交互、严格类型帮助保护复杂事件与业务契约。", "不是普通网页交付；浏览器仅用作开发与验收。"],
                    ["服务端", "Node 24 原生 HTTP/SSE", "减少本地交付依赖，控制流式事件与运行生命周期。", "生产多人部署需另加认证、队列与外部数据库。"],
                    ["持久化", "Node 内置 SQLite", "单机零运维、事务可靠、适合桌面与 Docker 复现。", "多人多租户规模化时迁移 PostgreSQL。"],
                    ["Agent 编排", "Mastra 1.83", "Agent、Workflow、MCP、RAG 和运行生命周期在同一框架内。", "农业数值规则不交给框架或模型自由生成。"],
                    ["模型", "DeepSeek / 千问 / Mock", "服务端 OpenAI 兼容接口，可按角色配置摘要与视觉模型。", "密钥不入前端，不记录敏感调用正文。"],
                    ["评测", "Docker Compose", "共享同一服务与数据库结构，便于评审复现。", "桌面仍是主产品，Docker 不是另一套业务实现。"],
                ],
                [65, 113, 178, CONTENT_WIDTH - 356],
                font_size=7.1,
                first_col_bold=True,
            ),
            h2("3.4", "Mastra 与领域运行时边界"),
            p(
                "Nexent 的 Harness、MCP、Skill、A2A 与评估设计提供了重要概念参考，但耕策最终使用"
                "Mastra 作为完整 Agent 编排框架。Mastra 管理八个专业 Agent、Decision Workflow、"
                "Question Workflow、MCPClient、MDocument 与运行生命周期；耕策把天气、土壤、选种、"
                "经济、农艺和独立 Verifier 实现为可单元测试的确定性工具节点。",
            ),
            p(
                "这一分层解决两种常见失败。若把框架当成业务事实来源，工作流会退化为“多个模型相互"
                "聊天”；若只写固定代码而不用 Agent 运行时，又难以获得统一的流式、能力、MCP、知识库"
                "与评估能力。耕策让 Mastra 负责“如何调度”，让领域代码负责“什么可被计算和放行”，"
                "两边通过结构化 A2A 产物连接。",
            ),
            h2("3.5", "部署拓扑"),
            data_table(
                ["拓扑", "启动方式", "数据位置", "主要用途"],
                [
                    ["Windows 桌面", "pnpm desktop / 打包后的 Gengce.exe", "%APPDATA%/耕策/data/agri.db", "正式演示与用户体验，内嵌本地服务。"],
                    ["Docker 评测", "docker compose up --build", "具名卷 agriculture-data", "评审复现、无本机 Node 环境时验收。"],
                    ["开发调试", "pnpm dev", "data/agri.db", "React 与 API 联调、自动化 UI 检查。"],
                    ["服务端构建", "pnpm build && pnpm start", "由 DATABASE_PATH 指定", "服务层排障与接口级验证。"],
                ],
                [83, 150, 130, CONTENT_WIDTH - 363],
                font_size=7.2,
                first_col_bold=True,
            ),
            callout(
                "关键架构判断",
                "Agent 框架不是业务正确性的替代品。耕策把可验证数值和发布条件下沉到确定性代码，把"
                "LLM 留在证据约束的表达层，再用独立 Verifier 做二道门禁，从结构上降低“模型说得很顺但"
                "事实不对”的风险。",
            ),
        ]
    )


def add_section_4(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("4", "Agent 角色定义、能力边界与 A2A 契约"),
            h2("4.1", "八个专业 Agent"),
            data_table(
                ["Agent", "职责", "输入", "输出", "明确不做什么"],
                [
                    ["Orchestrator", "识别任务、形成 DAG、调度、诊断和修复预算。", "FarmIntent、地块上下文。", "MastraDecisionPlan、运行状态。", "不直接给出作物或收益结论。"],
                    ["Weather", "读取天气、蒸散、降水和风险阈值。", "WGS84 坐标、当前日期。", "WeatherEvidence。", "不决定最终作物，不编造缺失天气。"],
                    ["Soil", "融合 SoilGrids、测土与区域先验。", "坐标、用户测土、区域规则。", "SoilEvidence。", "不把先验伪装成实测值。"],
                    ["Crop Selection", "按四目标排序五类作物并解释差异。", "EvidenceBundle、目标、轮作。", "CandidateSet。", "不隐藏综合分，不保证收益。"],
                    ["Economics", "拆分并复算价格、亩产、收入和成本。", "候选、公开区间、用户覆盖。", "EconomicEstimate。", "LLM 不重算数字或添加价格。"],
                    ["Agronomy", "把播期、水肥、病虫监测和天气阈值变成任务。", "候选、证据、区域规则。", "PlantingPlanDraft[]。", "不输出未验证农药处方。"],
                    ["Verifier", "数值、结构、季节、证据和安全复检。", "候选、证据、方案草案。", "VerificationReport、RepairRequest。", "不与被检 Agent 共用同一次自由生成。"],
                    ["Pest Vision", "图片观察、相似对象、补拍建议和监测措施。", "图片、地块、作物和备注。", "结构化初筛结论。", "不声称生产准确率，不提供药名剂量。"],
                ],
                [75, 137, 104, 113, CONTENT_WIDTH - 429],
                font_size=6.8,
                first_col_bold=True,
            ),
            p(
                "八个 Agent 并不等于八次自由问答。大部分领域节点由确定性工具完成，模型在需要解释和"
                "生成文字时被调用；Verifier 与生成 Agent 分离，避免同一模型用自己的输出来证明自己正确。"
                "这种设计更接近软件工程中的“生成与审核分权”，而不是把多个 Agent 当作装饰性角色。",
            ),
            h2("4.2", "A2A 结构化产物"),
            data_table(
                ["产物", "主要字段", "下游用途"],
                [
                    ["WeatherEvidence", "当前天气、七日预报、蒸散、土壤温湿度、风险阈值、来源与降级状态。", "选种、风险解释、农艺任务、天气门禁。"],
                    ["SoilEvidence", "黏粒、砂粒、pH、有机碳、用户测土、区域先验、质量与校准提示。", "适宜性、测土任务、置信度与证据说明。"],
                    ["EvidenceBundle", "一次运行使用的天气、土壤、区域规则、知识片段和来源快照。", "候选、模型上下文、Verifier 与回放。"],
                    ["CandidateSet", "作物、四目标分、适配理由、季节状态、风险和证据引用。", "用户比较与采用、经济测算、农艺编译。"],
                    ["EconomicEstimate", "单价、亩产、收入、现金成本、净收益、覆盖字段和来源。", "对话解释、方案、结果复盘基线。"],
                    ["PlantingPlanDraft[]", "阶段、时间窗、方法、用量/标准、依据和优先级。", "正式方案、农事记录与校验。"],
                    ["VerificationReport", "问题代码、严重性、说明、修复动作和轮次。", "发布门禁、局部修复、运行轨迹。"],
                    ["RepairRequest", "可修复问题、修复类型、修复预算与当前轮次。", "执行局部增量修复，不重跑全部证据。"],
                    ["RecommendationSet", "最终候选、摘要、校验状态、版本和持久化 ID。", "对话结果、产物面板和下一轮追问。"],
                    ["GroundedAnswer", "路由 Agent、回答、模型状态、证据和数值修复记录。", "问答回复、历史会话与审计。"],
                ],
                [111, 220, CONTENT_WIDTH - 331],
                font_size=7.1,
                first_col_bold=True,
            ),
            p(
                "Agent 之间不依赖“上一段聊天文本”作为唯一接口。每个产物都有结构化字段、运行 ID、"
                "来源与版本；即使刷新页面或重启服务，仍可从 SQLite 读取事件与产物。结构化交接也"
                "让评估可以针对单一节点检查，例如独立验证 WeatherEvidence 的阈值，而不必重新生成"
                "整段作物建议。",
            ),
            h2("4.3", "能力作用域与不可变快照"),
            p(
                "Skills、MCP 服务与知识库均支持四级作用域：系统内置 < 账号 < 基地 < 地块 < 当前运行"
                "临时授权。越具体的作用域可以覆盖上层配置，但临时覆盖只能针对已存在的绑定链，不能"
                "借当前运行跨越数据边界。每次选种或问答开始时，Mastra Workflow 与业务层共同生成"
                "CapabilitySnapshot，并写入 capability_snapshot。",
            ),
            bullets(
                [
                    "记录本轮实际启用的技能、版本和指令摘要。",
                    "记录已授权 MCP 工具的名称、输入契约和执行策略，不保存认证头或环境变量。",
                    "记录临时启用/停用的能力引用，解释配置差异。",
                    "记录知识库作用域、命中片段 ID、标题和降级状态。",
                    "用 run_id 唯一绑定，刷新、回放与后续审计不再读取可变配置。",
                ]
            ),
            h2("4.4", "Skills：能力规则而不是新权限"),
            p(
                "系统技能不可修改，用户可以复制为个人技能，也可以从零创建或导入 JSON、Markdown"
                "frontmatter。个人信息技能先进入草稿，经过边界检查、发布和账号/基地/地块绑定后才"
                "进入后续运行。技能可以约束适用场景、证据要求、追问条件、输出结构和安全边界，但"
                "不能凭文字声明获得新的工具能力或绕过 Verifier。",
            ),
            p(
                "这一设计把“个性化”限制在可治理范围：用户可以定制自己关心的水稻追肥检查或某种"
                "管理流程，但系统规则、数值复算、MCP 权限和发布门禁仍是不可被个人指令覆盖的硬边界。"
                "知识文本同样被视为证据数据，而不是系统指令。",
            ),
            h2("4.5", "模型网关与 Mock 安全模式"),
            p(
                "模型通过服务端 OpenAI 兼容接口调用，支持 DeepSeek、阿里百炼/千问和确定性 Mock 模式。"
                "摘要模型与视觉模型可按角色分别配置；文本模型不能替代视觉模型。未配置密钥或模型"
                "超时时，系统进入安全降级，仍可运行确定性选种、经济、农艺和校验流程。模型失败不"
                "应阻断整条业务链，而应把失败状态透明展示给用户。",
            ),
            h2("4.6", "失败与降级语义"),
            data_table(
                ["失败场景", "系统行为", "用户可见状态"],
                [
                    ["天气接口超时", "使用缓存天气，保留降级标记，涉及窗口风险时要求现场复核。", "来源、缓存时间与“需复核”提示。"],
                    ["SoilGrids 无响应", "切换到明确标注的区域先验，并增加正式测土校准任务。", "“区域先验”标签与证据质量说明。"],
                    ["LLM 超时/无密钥", "保留确定性候选、经济和方案结果，回退安全表达。", "模型状态与可重试说明。"],
                    ["MCP 工具失败", "失败关闭，跳过该工具，不影响本地证据主链。", "工具事件、错误摘要与降级轨迹。"],
                    ["知识无命中", "不凭空引用资料，继续使用内置规则。", "“本轮无知识命中”状态。"],
                ],
                [85, 229, CONTENT_WIDTH - 314],
                font_size=7.0,
                first_col_bold=True,
                compact=True,
            ),
            callout(
                "Agent 设计边界",
                "耕策使用多 Agent 是为了拆分责任、保留契约和形成可观察协作，不是为了增加角色数量。"
                "一个 Agent 若不能带来独立输入、独立约束或独立校验价值，就不应被加入系统。",
            ),
        ]
    )


def add_section_5(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("5", "Mastra 工作流、调度算法与自我循环"),
            h2("5.1", "Decision Workflow"),
            DecisionDiagram(),
            p(
                "选种工作流的主链为：加载上下文与能力快照 -> MCP 只读规划 -> 任务计划 -> Weather 与"
                "Soil 并行取证 -> EvidenceBundle -> 候选排序 -> 经济摘要 -> 农艺编译 -> Verifier "
                "与最多两轮局部修复 -> 持久化与发布。并行分支只在需要共享同一地块上下文时合流；"
                "后置经济与农艺节点读取的始终是已合并证据包。",
            ),
            code_block(
                """
export const decisionWorkflow = createWorkflow({
  id: "gengce-decision-workflow",
  inputSchema: runInputSchema,
  outputSchema: z.any()
})
  .then(loadAndPrepareStep)
  .then(mcpStep)
  .then(planStep)
  .parallel([weatherStep, soilStep])
  .then(evidenceBundleStep)
  .then(candidateStep)
  .then(summaryStep)
  .then(agronomyStep)
  .then(verifierStep)
  .then(persistStep)
  .commit();
                """,
                "代码 5-1  server/mastra/decision-workflow.ts 的实际工作流定义",
            ),
            h2("5.2", "Question Workflow"),
            p(
                "问答链路并不复用选种全流程。它先加载地块与当前方案，再并行执行证据刷新和能力快照，"
                "合并后进行最多两个只读 MCP 工具规划，再根据问题意图路由到气象、土壤、经济、农艺、"
                "视觉或编排 Agent，最后对流式回答做证据约束检查。回答需要绑定当前地块和当前采用"
                "方案，避免在“下一步怎么问”时丢失业务上下文。",
            ),
            code_block(
                """
export const questionWorkflow = createWorkflow({
  id: "gengce-question-workflow",
  inputSchema: runInputSchema,
  outputSchema: z.any()
})
  .then(loadContextStep)
  .parallel([evidenceStep, capabilitiesStep])
  .then(mergeParallelStep)
  .then(mcpStep)
  .then(routeStep)
  .then(answerStep)
  .commit();
                """,
                "代码 5-2  server/mastra/question-workflow.ts 的问答编排",
            ),
            h2("5.3", "调度策略"),
            data_table(
                ["策略", "实现方式", "解决的问题"],
                [
                    ["有向无环图", "Mastra Workflow 显式声明步骤与依赖。", "避免自由 Agent 相互调用导致不可预测执行。"],
                    ["并行取证", "weatherStep 与 soilStep 在同一 parallel 分支运行。", "减少串行等待，并让失败互不阻断。"],
                    ["能力先冻结", "在生成和工具调用前写 CapabilitySnapshot。", "避免运行中配置变化造成不可重现结果。"],
                    ["结构化合流", "证据包只接受契约字段，不拼接自由文本。", "防止上下文污染和隐式越权。"],
                    ["有限修复", "Verifier 只触发局部动作，最多两轮。", "兼顾自我修正与无限循环/成本失控之间的平衡。"],
                    ["事件顺序", "每个 agent_event 记录顺序、run_id、payload 与时间。", "前端可流式展示，刷新后仍可回放。"],
                ],
                [82, 198, CONTENT_WIDTH - 280],
                first_col_bold=True,
            ),
            h2("5.4", "Verifier 与自我循环"),
            p(
                "这里的“自我循环”不是让 Agent 自动修改自己的 Prompt，也不是在没有边界的情况下"
                "反复重试。它是运行内的诊断与局部修复循环：Verifier 读取候选、天气、土壤和方案，"
                "输出带严重性、问题代码和 repair 动作的报告。只有非 info 且具有明确 repair 的问题"
                "才进入修复；critical 问题阻断发布；修复动作只改动缺失或不一致部分，不重新执行所有"
                "取证节点。",
            ),
            callout(
                "一次典型修复",
                "土壤证据使用区域先验时，首轮 Verifier 会要求把正式测土写入方案；系统只向候选方案"
                "追加校准任务并重新校验，而不是重新请求天气、重跑全部 Agent 或让模型自行宣布“已修复”。",
                "amber",
            ),
            code_block(
                """
let issues = verifyRecommendations(
  inputData.recommendations,
  inputData.weather,
  inputData.soil
);
let repairRounds = 0;
while (
  issues.some(issue => issue.severity !== "info" && issue.repair) &&
  repairRounds < 2
) {
  repairRounds += 1;
  await repairRecommendations({
    runId: inputData.runId,
    recommendations: inputData.recommendations,
    issues,
    weather: inputData.weather,
    soil: inputData.soil,
    roundNumber: repairRounds
  });
  issues = verifyRecommendations(
    inputData.recommendations,
    inputData.weather,
    inputData.soil
  );
}
if (issues.some(issue => issue.severity === "critical")) {
  throw new Error("方案仍有阻断问题，未发布建议");
}
                """,
                "代码 5-3  生成与验证分权，修复预算最多两轮",
            ),
            data_table(
                ["校验类型", "示例", "处理"],
                [
                    ["数值复算", "净收益必须等于收入减成本。", "不一致则 recalculate-economics。"],
                    ["结构检查", "候选方案不能没有可执行任务。", "缺失则 rebuild-plan。"],
                    ["季节检查", "非当前播期不能保持高置信度。", "降低置信度并提示仅供下一季比较。"],
                    ["证据检查", "候选必须有区域或作物证据。", "缺失或冲突则阻断/降级。"],
                    ["可执行性", "区域土壤先验必须触发正式测土任务。", "add-soil-calibration-task。"],
                    ["天气保护", "高等级预警必须对应现场复核或作业调整。", "add-weather-guard-task。"],
                ],
                [74, 228, CONTENT_WIDTH - 302],
                first_col_bold=True,
            ),
            h2("5.5", "事件流、持久化与回放"),
            p(
                "agent_event 表保存运行 ID、顺序、Agent、事件类型、状态、说明、结构化 payload 和时间。"
                "前端通过 SSE 接收 plan、tool、a2a、verify、repair、answer、system 等事件。事件既是"
                "用户可见的“执行轨迹”，也是运行后评估的审计底稿。刷新页面或重启应用后，系统从"
                "SQLite 按顺序恢复事件，不需要重新调用模型来“重新讲故事”。",
            ),
            p(
                "前端文本流与 Agent 事件流是两条受控通道。模型文本增量到达后，前端仍将其标记为"
                "待复核；最终文本需通过证据数字检查、保证性承诺检查和方案绑定检查才成为正式回答。"
                "这一交互既保留逐字输出的即时感，也避免未校验内容被误认为最终结论。",
            ),
        ]
    )


def add_section_6(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("6", "核心农业业务算法与执行闭环"),
            h2("6.1", "天气证据与阈值"),
            p(
                "Weather Agent 调用 Open-Meteo，读取当前温度、湿度、风速、降水、未来七日最高最低温、"
                "风、参考蒸散、土壤温度和浅层土壤湿度。真实在线请求设置短超时；失败时使用缓存"
                "演示数据，并在界面、事件产物和方案中保留降级标记。阈值检查由代码执行，例如最低"
                "温不高于 2°C 触发低温/霜冻关注，阵风不低于 13.9 m/s 触发施药或播种窗口风险，"
                "未来三日累计降水不低于 25 mm 触发清沟排水提示，参考蒸散不低于 4 mm 触发墒情关注。",
            ),
            callout(
                "阈值的性质",
                "这些阈值是用于工程演示和风险提醒的规则，不是经全国多点验证的最终农艺标准。后续应按"
                "省份、作物、生育期和本地观测建立版本化规则包，并通过固定案例集评估误报与漏报。",
                "amber",
            ),
            h2("6.2", "土壤证据层级"),
            data_table(
                ["优先级", "证据", "系统表达", "可否直接用于建议"],
                [
                    ["1", "用户最近一次测土", "实测值，显示采样时间与地块归属。", "可，需提示适用范围与时效。"],
                    ["2", "SoilGrids 0-5 cm 公开属性", "公开表层属性，不替代配方测土。", "可作初步适宜性，不得承诺精确施肥。"],
                    ["3", "湖北区域先验", "必须显示“区域先验”，并触发测土校准任务。", "仅作降级证据，置信度降低。"],
                    ["4", "缺失", "明确说明无法判断需补测。", "不得伪造数值或保持高置信度。"],
                ],
                [58, 153, 194, CONTENT_WIDTH - 405],
                first_col_bold=True,
            ),
            p(
                "土壤 Agent 读取黏粒、砂粒、pH 与有机碳，支持用户手工录入最近测土结果。公开 SoilGrids"
                " 请求超时是正常工程场景，因此系统必须有区域先验与显式降级，但不能把先验值包装成"
                "实测值。只要使用先验，方案就应携带数据质量提示，并把测土校准写入正式作业。",
            ),
            h2("6.3", "作物适宜性与四目标排序"),
            p(
                "当前作物池包括水稻、油菜、小麦、玉米和大豆；水稻、油菜和小麦提供较深的农艺指导，"
                "玉米和大豆首版聚焦适宜性与经济比较。排序输入包括当前播期、土壤质地、排水、轮作、"
                "地块面积、气象风险和公开经济区间。排序输出不是一个不可解释的分数，而是四目标"
                "各自的排序、适配理由、风险标签、季节状态和证据引用。",
            ),
            data_table(
                ["目标维度", "主要输入", "输出形式"],
                [
                    ["profit", "公开/用户价格、亩产、现金成本、地块面积。", "收益领先候选及可复算经济拆解。"],
                    ["low_risk", "低温、强降水、风、排水、土壤与播期适配。", "风险较低候选与风险依据。"],
                    ["labor_saving", "作业窗口、管理环节、地块规模和当前作物状态。", "较省工作业组合与提醒。"],
                    ["soil_health", "轮作关系、质地、有机碳、养地任务与土壤证据。", "轮作/养地候选与校准任务。"],
                ],
                [92, 209, CONTENT_WIDTH - 301],
                first_col_bold=True,
            ),
            p(
                "排序过程采用可解释的规则加减分和约束过滤，不对模型做端到端训练。原因不是排斥学习，"
                "而是首版缺少足够真实田块结果来支撑可信的监督学习。固定规则便于审计、能明确错误"
                "来自哪一条证据或参数，也便于未来以实际结果评估后逐步校准。非当前主播期必须降低"
                "置信度并标记“仅用于下一季比较”，不能为了满足用户问题而把不适播候选包装成当前建议。",
            ),
            h2("6.4", "经济测算与用户覆盖"),
            p(
                "经济节点只做可追溯算术，不做市场预测。公式层面至少包含：亩均收入 = 单价 × 亩产；"
                "亩均净收益 = 亩均收入 - 亩均现金成本；地块总收入/总成本由登记面积汇总。用户覆盖"
                "单个字段后，系统按覆盖值重新计算全部下游字段，并显示哪些字段为公开估算、哪些为"
                "用户输入。估算值不是实时行情，也不是对实际收益的保证。",
            ),
            code_block(
                """
亩均收入 = 单价 × 亩产
亩均净收益 = 亩均收入 - 亩均现金成本
地块总收入 = 亩均收入 × 登记面积
地块总成本 = 亩均现金成本 × 登记面积
地块净收益 = 地块总收入 - 地块总成本
                """,
                "公式 6-1  经济结果由确定性代码计算，模型不得新增价格或重算数值",
            ),
            h2("6.5", "农艺方案编译"),
            p(
                "Agronomy Agent 不输出一段“应该加强田间管理”的空泛建议，而是把作物、天气、土壤和"
                "区域规则编译为可记录任务。每条任务至少包含阶段、建议时间窗、方法、用量或标准、"
                "依据和优先级。示例包括播前开沟排水、适墒精量播种、三叶期间苗、初花期菌核病"
                "监测、低温前现场复核和雨前清沟。",
            ),
            p(
                "任务的时间窗不是法定截止日期。系统在回答和执行界面中都明确要求用户结合天气预报、"
                "土壤墒情和田间实际复核。缺乏农药登记规则和本地验证时，虫害模块不输出药名、剂量、"
                "混配或施药顺序。",
            ),
            h2("6.6", "执行记录与结果复盘"),
            p(
                "正式方案进入 operation_record 后，用户可以登记已完成、跳过和成本，并记录计划与实际"
                "差异。收获后填写产量、品质、收入、成本和反馈，写入 outcome_record。结果的用途不是"
                "自动调整线上 Prompt，而是进入地块历史、偏差分析和改进候选集。任何参数校准都必须"
                "先在固定回归集上回放，再经质量门禁发布。",
            ),
            h2("6.7", "业务状态流转"),
            data_table(
                ["状态", "进入条件", "允许的关键动作", "回退/异常"],
                [
                    ["候选", "一次选种运行通过 Verifier 并持久化。", "比较、覆盖经济参数、继续追问。", "证据变化后重新运行，不修改历史候选。"],
                    ["已采用", "用户确认某个候选；重复请求保持幂等。", "展开方案、新增记录、继续问下一步。", "可查看历史其他候选，但不得误用为当前方案。"],
                    ["执行中", "正式方案建立并开始记录作业。", "完成、跳过、回填成本和备注。", "运行中关联基地/地块禁止删除。"],
                    ["已完成", "用户提交结果或明确结束本季方案。", "查看结果、反馈、复盘和下一季参考。", "修改结果需保留审计语义与时间。"],
                    ["已归档", "历史方案只读保留。", "查看、回放、用于评估候选集。", "不得静默删除或覆盖原始证据。"],
                ],
                [65, 150, 153, CONTENT_WIDTH - 368],
                font_size=6.9,
                first_col_bold=True,
                compact=True,
            ),
            h2("6.8", "虫害图片初筛"),
            p(
                "虫害模块接收 FieldImage、plotId 和备注，校验文件签名与 4 MB 限制后调用百炼视觉"
                "模型，以结构化 JSON 返回候选、可见依据、相似对象区分、补拍要求和监测措施。结构"
                "校验失败、模型超时或无权限均显示可重试错误，不伪造结果。SQLite 只保存结构化结论、"
                "时间、模型、耗时与 token 用量，不保存原图。",
            ),
            p(
                "系统按地块保留最近 10 条记录，但当前没有本地虫害标注集，因此白皮书不提供准确率、"
                "召回率或“可替代农技人员”的结论。该能力定位为观察辅助和补拍提示，而不是农药处方"
                "系统。要进入生产治理闭环，仍需建立本地标注集、误判审查、登记农药检索和施药后结果"
                "回访。",
            ),
        ]
    )


def add_section_7(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("7", "结果验证策略与反馈优化逻辑"),
            h2("7.1", "三层验证"),
            data_table(
                ["层级", "验证对象", "核心问题", "证据"],
                [
                    ["输入验证", "图片、地址、坐标、面积、API 请求体、MCP 参数。", "输入是否合法、是否属于当前账号/地块、是否在 schema 内？", "签名、长度、JSON Schema、运行时参数校验。"],
                    ["运行验证", "结构化产物、数值、季节、证据和任务可执行性。", "结果是否一致、是否越界、是否足以发布？", "独立 Verifier、确定性复算、事件记录。"],
                    ["结果验证", "实际产量、品质、收入、成本和用户评分。", "估算与现实的偏差在哪里？是否触发后续评估？", "outcome_record、feedback、地块历史。"],
                ],
                [78, 153, 179, CONTENT_WIDTH - 410],
                first_col_bold=True,
            ),
            h2("7.2", "生成文本的事实约束"),
            p(
                "模型回答不是“先说后验”，而是在流式生成后执行证据约束检查。系统提取证据中的数字"
                "集合，再检查输出中的数字是否在集合内；同时拒绝“保证增产”“稳赚”“必定增产”等"
                "承诺性短语。移除证据外数字时按句子分段处理，保留可验证句子并记录 numericRepairs。"
                "若修复后仍不满足证据与地块绑定条件，系统回退到确定性安全回答。",
            ),
            code_block(
                """
export function verifyGroundedText(text: string, evidence: string): boolean {
  const numbers = new Set(numericTokens(evidence));
  return (
    !numericTokens(text).some(value => !numbers.has(value)) &&
    !GUARANTEE_PATTERN.test(text)
  );
}
                """,
                "代码 7-1  server/grounding.ts 的证据数字与保证性承诺检查",
            ),
            p(
                "这一检查不证明农艺结论一定正确，它只证明回答没有引入当前证据之外的数字或收益承诺。"
                "农艺正确性仍需要通过区域规则版本、专家复核和真实结果评估。工程上必须同时保留这两"
                "种评估：一种针对语言是否被证据约束，另一种针对规则和建议是否在现实中有效。",
            ),
            h2("7.3", "发布门禁"),
            bullets(
                [
                    "<b>严重问题：</b>critical 问题存在时，方案不得发布，运行以失败或需补充信息结束。",
                    "<b>可修复问题：</b>进入局部修复；每轮修复后重新执行 Verifier，最多两轮。",
                    "<b>证据不足：</b>降低置信度、显示来源和缺口，必要时增加测土/现场复核任务。",
                    "<b>模型异常：</b>保留确定性结果，回退安全表达或显示可重试错误。",
                    "<b>工具异常：</b>MCP 失败关闭，但本地天气、土壤、规则和知识检索不因外部工具失效而全部中断。",
                ]
            ),
            h2("7.4", "反馈优化与版本门禁"),
            p(
                "耕策不把“自进化”理解为 Agent 在线自动修改自己的 Prompt。正确流程是：收集运行失败、"
                "低评分、用户补充和实际结果偏差；形成候选改进，例如新增规则、调整工具阈值或增加"
                "作业任务；在固定回归集上回放；通过质量门禁后发布新版本；保留版本号和回滚能力。",
            ),
            data_table(
                ["反馈信号", "可能原因", "改进候选", "不能直接做什么"],
                [
                    ["用户评分低", "表达、证据、任务可执行性或预期不一致。", "补充追问、改变解释结构、增加证据项。", "未经回放直接改线上模型行为。"],
                    ["实际结果偏差大", "公开估算失真、天气异常、执行偏差或规则不适配。", "校准输入区间、增加实际记录维度、标注置信度。", "把一次案例当作普遍规律。"],
                    ["Verifier 频繁修复", "证据缺失、结构不稳定或阈值不适用。", "新增回归案例、改进局部修复动作。", "取消校验以降低失败率。"],
                    ["MCP 工具失败", "网络、服务、Schema 或权限变化。", "降级到本地证据、收紧授权、记录审计。", "自动扩大到写操作或绕过快照。"],
                    ["虫害误判", "图片质量、相似对象或缺少本地标注。", "补拍提示、相似对象区分、建立标注集。", "据单张图片输出农药处方。"],
                ],
                [100, 144, 178, CONTENT_WIDTH - 422],
                font_size=7.0,
                first_col_bold=True,
            ),
            h2("7.5", "当前评估边界"),
            p(
                "当前已实际执行的回归覆盖结构化输出、数值复算、不适播保护、证据覆盖、修复循环、"
                "地图面积、农事历史、MCP 审批和流式文本等工程行为。它们证明系统没有在这些明确契约上"
                "回归，不等于证明所有农艺建议都正确，也不等于证明虫害识别准确率或真实农场的增产"
                "效果。白皮书将这两类证据严格分开，是为了让评审看见真实的工程成熟度，而不是用"
                "不可复核的数字制造“生产成熟”的错觉。",
            ),
            callout(
                "可验证的反馈闭环",
                "结果复盘不直接训练线上模型，而是为下一轮评估提供事实。只有当偏差经过回归集、区域"
                "规则审核和版本门禁，系统行为才会改变。这比“越用越聪明”的口号更慢，但更可审计。",
            ),
            h2("7.6", "后续评估指标设计"),
            p(
                "当前版本已经验证工程契约，下一步应在真实区域案例集上建立指标。指标必须以可观测事件"
                "和占比统计，不把目标值写成已验证结果。下列指标适合作为后续质量门禁的一部分。",
            ),
            data_table(
                ["指标", "定义", "为什么重要"],
                [
                    ["证据覆盖率", "候选方案拥有天气/土壤/区域规则证据的比例。", "发现“有结论但缺证据”的发布。"],
                    ["数值复算通过率", "经济与面积汇总一次校验通过的比例。", "衡量确定性计算与单位边界稳定性。"],
                    ["修复收敛率", "可修复问题在两轮内转为无阻断问题的比例。", "评估自我循环是否有效且不过度循环。"],
                    ["降级可见率", "缓存、先验、模型失败和 MCP 失败在界面留痕的比例。", "防止用户把降级结果当成完整事实。"],
                    ["结果回写完成率", "完成方案中实际记录结果与反馈的比例。", "衡量业务闭环是否从演示走向经营使用。"],
                ],
                [96, 234, CONTENT_WIDTH - 330],
                font_size=7.0,
                first_col_bold=True,
                compact=True,
            ),
        ]
    )


def add_section_8(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("8", "系统实现与运行效果截图"),
            p(
                "本章截图来自项目真实运行版本，展示桌面主界面、对话生成、Agent 轨迹、结构化产物、"
                "能力中心、MCP 审批、基地与地块管理、地块地图与方案。截图用于证明界面"
                "存在与业务链可达，不作为农艺正确率或生产性能的证明。",
            ),
            h2("8.1", "对话生成候选方案"),
            p(
                "用户在输入框提出“比较这季适合种什么，优先考虑稳健收益”后，系统在对话内返回流式"
                "结论、目标 Tab、候选排名、经济估算、证据提示和“采用这个方案”动作。右侧轨迹面板"
                "显示本次运行的事件数、运行 ID 和回放状态；用户不需要先进入某个业务页面。",
            ),
            figure(
                REVIEW / "electron-window-complete.png",
                "图 8-1  对话中的候选比较；右侧同步展示执行轨迹与校验修复事件",
                455,
                270,
            ),
            figure(
                REVIEW / "desktop-plan-complete.png",
                "图 8-2  采用候选后返回完整种植方案，包含阶段、任务、依据与执行入口",
                455,
                255,
            ),
            h2("8.2", "Agent 执行轨迹与结构化产物"),
            figure(
                REVIEW / "desktop-run-complete.png",
                "图 8-3  Agent 运行与产出：工具调用、并行取证、A2A、Verifier、REPAIR 与系统完成事件",
                455,
                270,
            ),
            figure(
                REVIEW / "desktop-run-artifacts.png",
                "图 8-4  结构化产物面板：候选、经济、方案、Verifier 报告与 CapabilitySnapshot 可查看",
                455,
                255,
            ),
            p(
                "轨迹不是预录动画。每个事件由服务端在运行过程中写入 SQLite，并通过 SSE 推送到"
                "前端；刷新后，系统从事件表恢复同一运行。结构化产物面板让评审可以直接看到 A2A"
                "交接的结果，而不仅仅是一段最终回答。",
            ),
            figure(
                REVIEW / "desktop-run-logs.png",
                "图 8-5  运行日志与可审计状态，支持定位模型、工具、校验与降级信息",
                455,
                250,
            ),
            h2("8.3", "能力中心：MCP、技能与知识库"),
            p(
                "能力中心不改变主对话入口，它的作用是让高级用户管理个性化能力。MCP 服务支持远程"
                "HTTP/HTTPS 或受控 stdio 服务、工具发现、工具级启停和测试；技能库支持复制、创建、"
                "导入、发布和绑定；知识库支持 TXT、Markdown、JSON、CSV 的本地分块与检索。",
            ),
            figure(
                REVIEW / "desktop-capabilities-mcp.png",
                "图 8-6  MCP 管理：服务状态、工具发现、只读注解、执行策略与调用审计",
                455,
                250,
            ),
            figure(
                REVIEW / "desktop-capabilities-skills.png",
                "图 8-7  技能库：系统技能只读，个人技能可复制、导入、检查、发布与作用域绑定",
                455,
                250,
            ),
            figure(
                REVIEW / "desktop-capabilities-knowledge.png",
                "图 8-8  知识库：本地文档导入、分块索引、作用域隔离与检索结果",
                455,
                250,
            ),
            h2("8.4", "MCP 调用前确认"),
            figure(
                REVIEW / "desktop-mcp-approval.png",
                "图 8-9  MCP 只读工具调用前确认在同一对话内暂停，展示服务、工具、理由和参数",
                455,
                250,
            ),
            p(
                "确认状态写入 mcp_approval_request。批准后，系统不新开一个任务，而是重新校验账号归属、"
                "运行快照、工具启停、只读注解、执行策略和参数 Schema，沿同一运行恢复。任一条件变化"
                "都拒绝执行并继续本地安全回答。用户取消、超时或服务重启时，未决请求统一失效。",
            ),
            h2("8.5", "基地、地块与地图"),
            figure(
                REVIEW / "desktop-farm-management.png",
                "图 8-10  一个账号管理多个基地和地块；支持新增、编辑、恢复和删除",
                455,
                250,
            ),
            figure(
                REVIEW / "desktop-plot-map.png",
                "图 8-11  地图选点、边界绘制与面积测算；登记面积与测算面积分开保存",
                455,
                250,
            ),
            p(
                "基地与地块的位置用于查询公开天气和土壤，不接入硬件。地址搜索可自动补全省市区；"
                "地图选点与边界绘制支持卫星图和面积测算。手动坐标必须明确 WGS84 或 GCJ-02，系统"
                "将查询坐标转换后使用。未选择位置时阻止保存，避免空字符串被写为 0。",
            ),
            h2("8.6", "虫害图片初筛"),
            data_table(
                ["输出项", "内容", "安全边界"],
                [
                    ["候选与状态", "返回候选虫害、可见依据和不确定性。", "证据不足时返回待补拍或未见明显虫害。"],
                    ["补拍建议", "指出需要补充的叶面、茎秆、虫体或受害范围。", "不把单张模糊图片包装成确定结论。"],
                    ["地块历史", "保存结构化结论、模型、耗时和 token 用量。", "原图只在识别请求中使用，不写入数据库。"],
                    ["治理信息", "提供监测与核实方向。", "不提供农药品名、剂量或混配处方。"],
                ],
                [92, 190, CONTENT_WIDTH - 282],
                font_size=7.4,
                first_col_bold=True,
            ),
            p(
                "界面展示“未评估准确率”的边界，不提供农药品名、剂量或混配。图片原图只在识别请求中"
                "发送给模型，不写入数据库；系统保存结构化结论、模型、耗时和 token 用量，便于后续"
                "审计与标注集建设。",
            ),
            h2("8.7", "桌面与窄屏验收"),
            data_table(
                ["视口/入口", "验证内容", "结果"],
                [
                    ["桌面宽屏", "三栏对话、候选、方案与运行侧栏可同时使用。", "无横向溢出或内容遮挡。"],
                    ["1024 宽度", "侧栏和业务抽屉压缩后仍可完成主要操作。", "关键动作可达。"],
                    ["390 宽度", "单列对话、窄屏侧栏与运行轨迹抽屉可打开。", "无横向溢出。"],
                    ["控制台", "真实交互、流式输出、能力切换与任务运行。", "无浏览器控制台错误。"],
                ],
                [82, 237, CONTENT_WIDTH - 319],
                font_size=7.0,
                first_col_bold=True,
                compact=True,
            ),
        ]
    )


def add_section_9(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("9", "核心代码模块说明"),
            h2("9.1", "代码地图"),
            data_table(
                ["模块", "路径", "职责", "关键契约"],
                [
                    ["桌面宿主", "desktop/main.cjs", "无边框窗口、utilityProcess、随机端口、用户数据目录。", "preload bridge、单实例、服务生命周期。"],
                    ["Agent 注册", "server/mastra/agents.ts", "注册八个 Mastra Agent、技能规则、模型角色与流式响应。", "Agent ID、summary/vision 模型角色、maxRetries。"],
                    ["选种流", "server/mastra/decision-workflow.ts", "并行取证、候选、经济、农艺、Verifier、持久化。", "Mastra Workflow DAG、repair budget 2。"],
                    ["问答流", "server/mastra/question-workflow.ts", "证据/能力并行准备、MCP、路由、流式回答、文本校验。", "GroundedAnswer、numeric repairs。"],
                    ["能力流", "server/mastra/capability-workflow.ts", "解析绑定、知识召回、生成不可变 CapabilitySnapshot。", "scope precedence、snapshot persistence。"],
                    ["业务支撑", "server/mastra/support.ts", "事件、修复、证据说明和确定性领域节点。", "A2A artifacts、Verifier inputs。"],
                    ["文本约束", "server/grounding.ts", "数字集合、承诺性短语、句子级修复。", "verifyGroundedText、repairAgentText。"],
                    ["知识库", "server/knowledge.ts", "Mastra MDocument 分块、SQLite FTS5/ LIKE 检索。", "本地索引、作用域隔离。"],
                    ["技能管理", "server/skills.ts / skill-guidance.ts", "系统技能目录、版本、工具契约与专业指导。", "SkillId、input/output schema。"],
                    ["MCP", "server/mcp-agent.ts / capabilities-store.ts", "连接、发现、授权、策略、审批与审计。", "readOnlyHint、destructiveHint、mcp_call_log。"],
                    ["病虫害", "server/pest.ts", "图片校验、视觉请求、JSON 结构一致性、最近记录。", "FieldImage、uncertain、followup。"],
                    ["UI", "src/", "对话、流式文本、业务抽屉、轨迹、能力和地图交互。", "React escape、SSE incremental display。"],
                    ["测试", "tests/、scripts/browser-check.mjs、electron-check.mjs", "领域规则、能力、接口、UI、桌面与流式行为回归。", "23 项自动化测试与交互检查。"],
                ],
                [80, 150, 182, CONTENT_WIDTH - 412],
                font_size=6.8,
                first_col_bold=True,
            ),
            h2("9.2", "Mastra Agent 注册"),
            p(
                "Agent 注册不是把名字挂在一个数组里，而是给每个角色绑定技能规则、模型角色和重试"
                "预算。例如病虫害视觉 Agent 使用 vision 模型角色，其他专业 Agent 默认使用 summary"
                "角色；Agent 的 instructions 来源于共享 skill-guidance，避免同一安全边界在多个"
                "页面和提示词副本中漂移。",
            ),
            callout(
                "为什么共享技能指导",
                "同一条“缺少证据时明确追问、不得编造数值”的边界，如果分别散落在界面文案、系统提示、"
                "视觉契约和测试中，很容易产生版本漂移。耕策用一个共享源生成专业规则，再在测试中检查"
                "选中技能确实进入请求，使个性化能力仍然服从同一安全底线。",
            ),
            code_block(
                """
export const mastraAgents = {
  orchestrator: makeAgent(
    "gengce-orchestrator",
    "耕策任务编排 Agent",
    "orchestrator",
    "识别农业任务范围并组织专业 Agent 与确定性工具。"
  ),
  weather: makeAgent(
    "gengce-weather",
    "耕策气象风险 Agent",
    "weather",
    "解释地块天气预报、降水和作业窗口风险。"
  ),
  soil: makeAgent(
    "gengce-soil",
    "耕策土壤证据 Agent",
    "soil",
    "区分测土、公开土壤属性和区域先验。"
  ),
  verifier: makeAgent(
    "gengce-verifier",
    "耕策独立校验 Agent",
    "verifier",
    "核对数值、证据边界、单位和方案发布条件。"
  )
} as const;
                """,
                "代码 9-1  server/mastra/agents.ts 中的角色注册节选",
            ),
            h2("9.3", "能力快照落盘"),
            p(
                "能力快照在模型和执行器开始具体工作之前生成并写入。重点是“先冻结，再运行”："
                "如果用户在运行期间修改技能、关闭 MCP 工具或改变知识绑定，当前运行仍使用旧的"
                "不可变快照；下一次运行才会读取新配置。这一语义让回放与审计可以准确回答“当时到底"
                "启用了什么”。",
            ),
            code_block(
                """
const snapshot: CapabilitySnapshot = {
  id: makeId("capsnap"),
  runId: inputData.runId,
  accountId: inputData.accountId,
  plotId: inputData.plotId,
  engine: {
    name: "Mastra Workflow",
    version: CAPABILITY_RUNTIME.version,
    workflowId: CAPABILITY_RUNTIME.workflowId
  },
  skills,
  mcp,
  overrides: inputData.capabilityOverrides,
  knowledge: {
    bases: inputData.knowledgeBases.map(serializeBase),
    matches: inputData.knowledgeMatches
  },
  degraded,
  createdAt: new Date().toISOString()
};
saveCapabilitySnapshot(snapshot);
                """,
                "代码 9-2  CapabilitySnapshot 的结构与持久化语义",
            ),
            h2("9.4", "MCP 失败关闭"),
            p(
                "自动工具调用的必要条件是：工具级开关启用、服务连接成功、当前运行快照已冻结、"
                "readOnlyHint=true 且 destructiveHint!=true。规划模型只看到候选工具的名称、描述"
                "和输入 Schema，每次最多返回两个 toolId。服务端在调用前再次做 JSON Schema 基础"
                "校验；任一调用不合格即跳过，不阻断本地结果。写操作、破坏性操作和未声明只读语义"
                "的工具永远只允许用户在能力中心手动测试。",
            ),
            data_table(
                ["策略", "自动执行", "主对话内确认", "仅手动", "适用"],
                [
                    ["auto", "是", "否", "可用", "明确只读且参数可校验的查询工具。"],
                    ["confirm", "否", "是", "可用", "只读但需要用户确认外部数据调用的工具。"],
                    ["manual", "否", "否", "是", "写操作、破坏性操作或未声明只读语义的工具。"],
                ],
                [72, 72, 82, 64, CONTENT_WIDTH - 290],
                first_col_bold=True,
            ),
            h2("9.5", "SSE 与逐字流式输出"),
            p(
                "文本摘要和虫害识别使用真实百炼 SSE，前端按 Unicode 字符增量显示。增量到达时保留"
                "已显示内容，生成中的内容标记“待复核”，最终使用通过校验的结论。中断保留已接收"
                "内容并提示重试；历史会话不会重新逐字播放。Agent 轨迹按事件顺序进入，用户仅在"
                "接近底部时自动跟随，阅读旧事件时可保持位置。",
            ),
            code_block(
                """
response.writeHead(200, {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no"
});
push("text", { text });
push("done", { id, createdAt, ...result });
                """,
                "代码 9-3  本地 SSE 事件通道的响应头与文本/完成事件",
            ),
            h2("9.6", "数据模型"),
            data_table(
                ["表", "用途"],
                [
                    ["account", "账号与套餐。"],
                    ["farm / plot", "基地、地块、坐标、面积、土壤、灌溉、排水、轮作与恢复状态。"],
                    ["plot_context", "最近天气、土壤与环境快照。"],
                    ["task_run / agent_event", "一次运行和按顺序持久化的事件。"],
                    ["recommendation / planting_plan", "候选、证据、分数、经济与用户采用的正式方案。"],
                    ["operation_record / outcome_record", "计划与实际作业、产量、品质、收入、成本和利润。"],
                    ["feedback / evaluation_run", "反馈、固定回归集、质量门禁与版本评估。"],
                    ["capability_snapshot / mcp_call_log / mcp_approval_request", "能力冻结、MCP 调用审计和主对话确认状态。"],
                    ["chat_session / pest_assessment", "对话历史、地块绑定和结构化虫害初筛记录。"],
                ],
                [177, CONTENT_WIDTH - 177],
                first_col_bold=True,
            ),
        ]
    )


def add_section_10(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("10", "人工智能使用说明：LLM、RAG、MCP 的作用与局限"),
            h2("10.1", "LLM"),
            p(
                "DeepSeek 与千问在耕策中承担受约束表达层：根据确定性候选、天气、土壤和经济证据，"
                "生成简明结论、风险解释、下一步行动和方案说明；视觉模型承担虫害图片的初筛观察。"
                "模型不决定价格、亩产、净收益、季节窗口、单位换算和安全发布条件，也不被允许在"
                "回答中补写证据外数字。",
            ),
            h2("10.2", "RAG"),
            p(
                "知识库用于补充账号、基地或地块特有的资料，例如合作社管理规范、某地块的测土说明"
                "或个人积累的种植笔记。文档通过 Mastra MDocument 进行结构感知分块，写入本地"
                "SQLite FTS5 trigram 索引，必要时使用 LIKE 回退；默认不把资料发送到云端 Embedding。"
                "检索结果带文档标题、片段 ID 和作用域，进入 CapabilitySnapshot。",
            ),
            p(
                "RAG 的局限是：命中的文本不等于正确事实，过期资料也可能被检索到。系统因此要求"
                "知识片段作为“证据数据”进入，而不是作为可以覆盖系统规则或授予工具权限的提示词；"
                "对应用户上传内容时，还要保留来源、时间和作用域，以便人工治理。",
            ),
            h2("10.3", "MCP"),
            p(
                "MCP 用于连接外部工具和业务系统接口。耕策通过 Mastra MCPClient 管理远程 HTTP/HTTPS"
                " 或受控 stdio 服务，完成工具发现、工具级授权、调用、确认和审计。首版自动调用只"
                "接受明确只读的工具，最多两个；写操作和破坏性操作仍由用户手动执行。工具返回值"
                "被标记为不可信外部证据，不能覆盖系统规则。",
            ),
            data_table(
                ["环节", "LLM 的贡献", "确定性代码的贡献", "RAG / MCP 的贡献", "局限与降级"],
                [
                    ["天气风险", "把阈值与预报变成可读提醒。", "阈值判断、缓存、来源标记。", "MCP 可接外部农情/预警工具（只读）。", "网络、阈值区域适用性、缓存时效。"],
                    ["土壤判断", "解释黏粒、pH、有机碳与证据质量。", "优先级、范围校验、测土任务。", "知识库可补充本地土壤说明。", "公开土格网精度有限，不能替代测土。"],
                    ["选种", "比较差异、生成追问和摘要。", "候选过滤、四目标排序、季节保护。", "MCP 可接公开目录；RAG 可接个人记录。", "排序规则仍需区域评估，不能保证收益。"],
                    ["经济", "解释已计算结果。", "价格/亩产/成本复算与用户覆盖。", "MCP 可查询授权业务系统；不能用未授权行情。", "公开区间不是实时报价，缺失成本不得伪造。"],
                    ["农艺方案", "把任务说明整理成文。", "时间窗、任务结构、天气保护、验证。", "RAG 可召回本地管理规范。", "未验证农药处方、地域差异与现场条件。"],
                    ["虫害初筛", "图片观察、候选与补拍建议。", "文件校验、JSON 结构和状态一致性。", "未来可接登记农药目录（合规后）。", "无本地标注集，不声称准确率，不出农药处方。"],
                ],
                [65, 122, 122, 112, CONTENT_WIDTH - 421],
                font_size=6.8,
                first_col_bold=True,
            ),
            h2("10.4", "可解释性与非目标"),
            p(
                "可解释并不等于把模型内部所有计算都展示给用户。耕策可解释的是业务接口：建议来自"
                "哪个地块、哪一组天气/土壤证据、哪条确定性规则、哪些经济假设、哪次 Verifier 检查，"
                "以及是否发生降级。模型内部权重并不被包装成因果解释。",
            ),
            bullets(
                [
                    "不是用 AI 替代农技人员、气象机构、土肥机构或农药登记管理。",
                    "不是在缺少真实田块结果时声称“模型越用越准”。",
                    "不是用多 Agent 名称替代输入输出契约、校验和可回放证据。",
                    "不是将用户数据默认用于训练；用户田间数据默认只服务于自身决策。",
                    "不是将公开估算当作实时报价或有保证的收益预测。",
                ]
            ),
        ]
    )


def add_section_11(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("11", "安全、隐私与合规治理"),
            h2("11.1", "密钥与客户端边界"),
            p(
                "模型与高德等密钥只保存在服务端 .env 或桌面用户数据目录的服务端环境文件中，前端"
                "无法读取。客户端不保存 API Key，模型调用日志不记录敏感认证头。地图安全密钥由"
                "本机 API 代理附加，不返回页面，不打包进安装文件。",
            ),
            h2("11.2", "输入与存储边界"),
            bullets(
                [
                    "API 请求体限制为 1 MB；虫害图片校验签名和 4 MB 上限，拒绝远程 URL 和伪造 MIME。",
                    "SQL 使用参数绑定；前端输出由 React 转义，避免直接把模型文本当 HTML。",
                    "虫害原图不写数据库，只保存结构化结论、模型、时间、耗时和 token 用量。",
                    "基地、地块、方案、作业、结果与对话默认本地保存；删除为可恢复移除，运行中的关联对象禁止删除。",
                    "用户田间数据默认只用于自身决策，不默认进入模型训练或跨账号共享。",
                ]
            ),
            h2("11.3", "工具与权限治理"),
            p(
                "MCP 和技能都受到运行能力快照约束。MCP 自动调用必须满足只读注解与 schema 校验；"
                "确认请求有 owner、run_id、tool、arguments、status 和过期时间；批准时重新检查工具"
                "启停、当前策略、账号归属和快照归属。临时能力覆盖不能越过账号、基地、地块链。"
                "这些规则确保“个性化”不会变成“越权”。",
            ),
            h2("11.4", "农业安全与合规边界"),
            data_table(
                ["风险", "当前措施", "仍待建设"],
                [
                    ["错误播期/品种建议", "区域规则、季节保护、置信度与现场复核提醒。", "按省份和生态区建立版本化规则包与专家审核。"],
                    ["错误施肥/用药", "不输出未验证农药处方；土壤先验触发测土任务。", "登记农药目录、剂量规则、施用条件与安全间隔期。"],
                    ["气象误报/过期缓存", "来源与降级状态可见，短超时，提醒现场复核。", "多源交叉校验、历史误差评估与本地观测接入。"],
                    ["模型越界", "证据数字检查、承诺性短语拦截、Verifier 与失败关闭。", "持续扩充对抗样例、红队测试与模型族交叉审查。"],
                    ["用户隐私", "服务端密钥、原图不落盘、作用域隔离、本地数据。", "多人部署认证、审计、备份、数据保留策略。"],
                ],
                [95, 206, CONTENT_WIDTH - 301],
                font_size=7.1,
                first_col_bold=True,
            ),
            h2("11.5", "责任边界"),
            p(
                "耕策不承诺产量、收益、病虫害识别准确率或替代专业农技服务。界面对公开估算、区域"
                "先验、模型初筛和未完成评估的能力给出明确提示。用户采用方案前需要结合天气预报、"
                "田间实际、当地农技要求和合规登记信息复核。涉及农药、施肥、土地用途和食品安全"
                "的最终决定必须遵守当地法规和责任主体的管理要求。",
            ),
            callout(
                "治理设计原则",
                "先证明“谁被允许调用什么”，再证明“调用结果能否被信任”，最后才讨论“模型回答是否"
                "好听”。安全边界位于表达层之前，而不是藏在产品免责声明之后。",
            ),
        ]
    )


def add_section_12(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("12", "测试用例、运行效果与性能评估"),
            h2("12.1", "测试环境与执行结果"),
            p(
                "本节记录本次白皮书编写前后可复核的工程验证。执行环境为项目工作区 Windows，"
                "Node 24、pnpm 11、Mastra 1.83。下面区分“已执行通过”和“架构目标”，不把未经"
                "测量的毫秒数写成生产性能。",
            ),
            data_table(
                ["验证项", "命令/方式", "本次结果", "说明"],
                [
                    ["类型检查", "pnpm typecheck", "通过", "渲染层与本地服务 TypeScript 均通过无错误。"],
                    ["自动化测试", "pnpm test", "23 项通过", "在非沙箱环境执行，覆盖能力、知识、流式、领域规则、地图与生命周期。"],
                    ["构建", "pnpm build", "通过", "Vite 渲染层与 Node 服务打包成功。"],
                    ["UI 交互检查", "pnpm check:ui", "项目验收已记录通过", "真实 Edge 交互、桌面/390px 无横向溢出、控制台无错误。"],
                    ["桌面入口检查", "pnpm check:desktop", "项目验收已记录通过", "Electron preload、窗口控制、本地 Agent 服务与一次完整运行。"],
                ],
                [91, 122, 127, CONTENT_WIDTH - 340],
                font_size=7.1,
                first_col_bold=True,
            ),
            h2("12.2", "23 项自动化测试覆盖"),
            data_table(
                ["测试主题", "覆盖的行为", "不证明什么"],
                [
                    ["图片输入与视觉结构", "远程 URL、伪造头、超限图片拒绝；结构化结论字段与状态一致性。", "不代表真实虫害图片的识别准确率。"],
                    ["证据约束", "数字证据集、保证性承诺拦截、SSE 分片中文字节。", "不代表所有农业句子都正确。"],
                    ["能力与知识", "作用域技能、快照持久化、本地知识检索与发布绑定。", "不代表外部 MCP 服务长期可用。"],
                    ["作物与季节", "五类作物四个目标、湖北秋冬窗口、非当前播期降置信度。", "不代表全国播期规则。"],
                    ["经济与方案", "用户覆盖复算、公开估算标签、任务结构与证据。", "不证明现实收益。"],
                    ["地图与生命周期", "边界校验、坐标往返、空工作区、基地/地块删除恢复。", "不证明高德服务在所有网络下可用。"],
                    ["Mastra 流式", "Agent 文本增量先于完成、请求包含选中技能。", "不证明生产并发下的端到端时延。"],
                    ["启动恢复", "异常终止遗留任务标记失败，避免假运行。", "不证明所有崩溃场景都能恢复。"],
                ],
                [106, 222, CONTENT_WIDTH - 328],
                font_size=7.0,
                first_col_bold=True,
            ),
            h2("12.3", "交互验收"),
            p(
                "项目交互验收覆盖桌面窗口、窄屏布局、对话恢复、流式回答、候选采用、方案展开、"
                "农事记录、结果反馈、能力中心、MCP 确认和地图选点。已验证桌面与 390px 窄窗口无"
                "横向溢出，浏览器控制台错误列表为空；流式生成中的文字保持待复核状态，完成后使用"
                "通过校验的结论；右侧轨迹仅在用户主动打开时进入。",
            ),
            bullets(
                [
                    "从空工作区创建基地和第一块田，不出现示范田候选或方案。",
                    "第一块田生成建议、选择冬油菜、采用方案、继续问下一步，回答绑定当前地块和当前方案。",
                    "重复提交同一采用请求返回同一方案，不重复归档或创建。",
                    "已有新推荐时历史候选仍可按其自身经济测算采用，不误用最新排名第一项。",
                    "删除当前地块后自动切换到有效地块；全部移除后进入空工作区引导。",
                    "MCP 确认期间关闭工具、取消或超时均不执行外部工具，运行安全降级。",
                ]
            ),
            h2("12.4", "性能与容量"),
            p(
                "当前版本未把未测量的端到端延迟写成硬指标。架构上采用并行天气/土壤取证、短超时、"
                "缓存降级、模型并发上限、排队上限与一次性事件持久化，以减少串行等待并限制资源"
                "占用。首版的评估重点是单机演示稳定性和完整闭环，不是高并发 SaaS 的吞吐量。",
            ),
            data_table(
                ["指标", "当前状态", "后续目标"],
                [
                    ["单次选种运行", "演示环境可完成，含并行取证、校验和修复。", "按证据完整度分组统计端到端时延。"],
                    ["文本流", "服务端 SSE/增量传输，前端逐 Unicode 字符呈现。", "补充首字节与完整时延的分布统计。"],
                    ["模型并发", "最多 3 个请求并排队 12 个；429/5xx 最多重试一次。", "压测排队时间、错误率和重试成功率。"],
                    ["摘要超时", "15 秒；视觉单次 45 秒。", "按省份/网络环境进行 SLO 评估。"],
                    ["UI 稳定性", "桌面与 390px 窄屏无横向溢出，控制台无错误。", "扩大浏览器、DPI、窗口尺寸矩阵。"],
                    ["多人扩展", "SQLite + 本地服务，适合单机与比赛复现。", "认证、PostgreSQL、对象存储、作业队列、审计与备份。"],
                ],
                [91, 213, CONTENT_WIDTH - 304],
                font_size=7.0,
                first_col_bold=True,
            ),
            h2("12.5", "性能结论"),
            p(
                "比赛版本已经具备可运行的完整业务链、可回放事件和真实流式输出；自动化测试与 UI/"
                "桌面验收证明工程契约在当前环境中稳定。它还不是经生产压测、真实客户试点和区域"
                "准确率评估验证的 SaaS。白皮书将这一区别明确写出，后续才可能以可信方式扩展。",
            ),
            callout(
                "可复现性",
                "一手可运行桌面程序、Docker 入口、固定测试命令和真实截图构成初赛“可运行性”证据；"
                "演示账号与合成数据保证评审无需配置密钥也能看到完整业务链。",
            ),
        ]
    )


def add_section_13(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("13", "全国扩展路径与技术演进"),
            h2("13.1", "为什么首版以湖北为高可信区域"),
            p(
                "湖北具有较完整的秋冬播、水稻、油菜和小麦指导材料，适合建立第一套可评估规则集。"
                "首版不是把系统限制在湖北，而是把“高置信规则”“全国基础分析”和“需要现场校准”"
                "明确分开。其他地区仍可用全国天气、公开土壤和通用作物规则完成初步比较，但当区域"
                "证据缺失时，系统降低置信度，并提示补充当地农技资料或测土。",
            ),
            h2("13.2", "全国扩展顺序"),
        ]
    )
    numbered = [
        "先建立全国基础天气、土壤和作物适宜性，保证位置可用、证据来源可见、缺失可降级。",
        "按省份建立独立规则包，记录来源、生效时间、适用范围和版本，不让湖北规则强行覆盖其他地区。",
        "按生态区建立固定评估案例，覆盖不同纬度、海拔、降水、土壤质地和轮作约束。",
        "与当地农技资料、价格口径、品种审定目录和合规要求校准，形成专家审核链。",
        "按地块积累实际作业与结果，建立区域参数评估；只有通过门禁的改进才发布。",
        "再扩展害虫与治理、市场信息和合作社协作，不以“更多工具”替代可信基础。",
    ]
    for index, item in enumerate(numbered, start=1):
        story.append(Paragraph(item, STYLES["Bullet"], bulletText=f"{index}."))
    story.extend(
        [
            data_table(
                ["阶段", "覆盖范围", "核心交付", "退出条件"],
                [
                    ["P0 当前", "湖北高可信；全国初步分析", "桌面闭环、Mastra 编排、公开证据、可回放。", "23 项测试、构建与交互验收通过，评审可复现。"],
                    ["P1 区域包", "湖北细化 + 2-3 个邻近生态区", "规则版本、来源审核、区域回归集。", "多区域固定案例无阻断错误，证据完整率达标。"],
                    ["P2 试点", "家庭农场/合作社小规模真实使用", "执行记录、结果回写、人工复核与偏差分析。", "真实用户完成闭环，严重问题可回滚。"],
                    ["P3 规模化", "多省、多租户、服务化", "PostgreSQL、对象存储、认证、审计、队列与运营后台。", "SLO、数据治理与合规评审通过。"],
                ],
                [69, 125, 193, CONTENT_WIDTH - 387],
                font_size=7.0,
                first_col_bold=True,
            ),
            h2("13.3", "害虫识别与治理路线"),
            p(
                "虫害模块的第一阶段只做初筛与补拍，不把“识别出名字”当作治理闭环。第二阶段"
                "需要建立湖北本地、按作物和生育期划分的标注集，记录模型、相似对象、补拍质量"
                "和人工复核，形成可解释的误判分类。第三阶段在合规审核后接入登记农药目录、"
                "适用作物、防治对象、剂量、安全间隔和禁用条件。第四阶段再记录施药后观察结果，"
                "但治理建议必须在专家复核和法规边界内发布。",
            ),
            h2("13.4", "多租户与生产化"),
            p(
                "SQLite 适合单机桌面与比赛复现，生产扩展到多人多租户时应迁移 PostgreSQL，"
                "增加认证、授权、对象存储、事件队列、备份、审计和运营监控。业务 ID、SSE"
                "事件协议、A2A 契约和 CapabilitySnapshot 语义保持不变，避免“换数据库就把"
                "业务重写”。桌面版继续保持可离线、可携带的轻量形态。",
            ),
            callout(
                "扩展原则",
                "先扩大事实边界，再扩大用户边界。没有本地规则、来源和评估的区域，应被明确"
                "标注为低置信度；不能为了显示全国覆盖而把一个湖北规则复制到所有省份。",
            ),
        ]
    )


def add_section_14(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("14", "竞赛价值与项目结论"),
            h2("14.1", "赛道一可展示的差异点"),
            data_table(
                ["差异点", "常见做法", "耕策做法", "评审可观察证据"],
                [
                    ["多 Agent", "多个角色共用一段自由聊天。", "八个角色、结构化 A2A、并行取证与独立 Verifier。", "运行与产出面板、结构化产物、事件回放。"],
                    ["可执行", "输出一篇泛化种植文章。", "方案编译为阶段任务、时间窗、依据与优先级。", "方案抽屉、农事记录、计划/实际差异。"],
                    ["可验证", "只展示模型最终回答。", "代码复算、证据数字检查、critical 阻断与最多两轮修复。", "VERIFY/REPAIR 事件、测试、文本约束代码。"],
                    ["可管理", "一个账号只有一块地。", "账号、基地、地块、方案、记录、结果、能力作用域。", "基地管理、地图、多地块切换与恢复。"],
                    ["可定制", "技能/MCP/知识库只是设置页。", "真实运行快照、工具授权、知识检索、版本和审计。", "能力中心、确认请求、MCP 调用日志。"],
                    ["可落地", "只讲愿景和指标。", "桌面可运行、Docker 可复现、演示账号、真实截图与测试。", "Gengce.exe、Docker Compose、23 项测试、验收记录。"],
                ],
                [72, 136, 182, CONTENT_WIDTH - 390],
                font_size=6.9,
                first_col_bold=True,
            ),
            h2("14.2", "业务价值"),
            p(
                "对小型家庭农场，耕策把“我该种什么”拆成可比较的收益、风险、劳力和养地选择，"
                "降低对单一建议的盲从；执行记录与结果反馈让经营经验不再只留在个人记忆里。对大型"
                "合作社，统一的地块上下文、方案模板、事件轨迹和结果数据结构降低了跨地块比较、"
                "人员交接和复盘成本。产品不接入硬件，意味着部署门槛低，可以从一台桌面电脑开始。",
            ),
            h2("14.3", "技术价值"),
            p(
                "耕策演示了一种可复用的可信 Agent 工程范式：框架负责生命周期和调度，确定性工具"
                "负责事实与数值，A2A 契约负责跨角色接口，能力快照负责配置可复现，Verifier 负责"
                "发布门禁，SSE 与 SQLite 负责用户可见和运行后可回放。这个范式不依赖某一个模型，"
                "也可迁移到其他需要证据约束的行业场景。",
            ),
            h2("14.4", "当前边界与下一步"),
            p(
                "当前版本是可运行、可演示的竞赛原型，不是已获认证的生产农艺系统。下一步优先级应是"
                "区域规则包、真实试点、结果数据、虫害标注集、登记农药治理和多人部署，而不是继续"
                "堆叠聊天角色。只有当证据、校验和反馈变得更强，Agent 数量的增加才有意义。",
            ),
            h2("14.5", "结论"),
            p(
                "耕策把农业智能体的价值落在“让每一季都有据可循”：问题在对话中提出，证据在本地"
                "受控取得，多专业 Agent 通过结构化产物协作，方案由独立校验决定能否发布，执行与"
                "结果再回到下一轮。它既保留了桌面智能体的自然交互，又把农业业务需要的"
                "证据、记录和反馈做成真正的工程结构。",
            ),
            callout(
                "最终定位",
                "耕策不是“农业版聊天框”，也不是“模块很多的农业工作台”，而是一个以对话为入口、"
                "以地块为上下文、以证据为约束、以执行和结果为闭环的桌面农业 Agent 助手。",
            ),
        ]
    )


def add_appendix_a(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("", "附录 A：赛道一提交要求核对表"),
            p(
                "本附录用于提交前最终核对。初赛要求以主办方页面和用户提供的赛道截图为准；若主办方"
                "后续更新，应以最新通知覆盖本表。",
            ),
            data_table(
                ["#", "要求", "本白皮书回应", "可演示/可复现证据"],
                [
                    ["1", "选题背景与场景需求分析", "第 1 章：数据断层、两类用户、四目标与多地块。", "演示账号、空工作区、基地与地块创建。"],
                    ["2", "总体架构设计与技术选型", "第 3 章：桌面、服务、Mastra、SQLite、模型网关与 Docker。", "README 启动命令、架构图、Electron 截图。"],
                    ["3", "Agent 角色、工作流与编排", "第 4、5 章：八 Agent、A2A、Decision/Question Workflow。", "轨迹事件、产物面板、结构化产物。"],
                    ["4", "调度算法与自我循环", "第 5 章：DAG、并行、能力冻结、两轮修复。", "VERIFY/REPAIR 事件与代码摘录。"],
                    ["5", "结果验证与反馈优化", "第 7 章：输入/运行/结果三层验证、反馈与门禁。", "23 项测试、文本约束代码、结果复盘。"],
                    ["6", "核心代码与系统截图", "第 8、9 章：模块地图、代码摘录、12 组截图。", "仓库文件与真实桌面截图。"],
                    ["7", "测试用例、运行效果与性能", "第 12 章：测试结果、交互验收、性能边界。", "pnpm test / typecheck / build / check:ui / check:desktop。"],
                    ["8", "LLM、RAG、MCP 作用与局限", "第 10 章：分环节贡献、局限、降级与安全边界。", "能力中心、MCP 审批、知识库截图。"],
                ],
                [21, 116, 214, CONTENT_WIDTH - 351],
                font_size=6.9,
                first_col_bold=True,
            ),
            h2("A.1", "提交材料清单"),
            data_table(
                ["材料", "状态", "说明"],
                [
                    ["方案书 PDF", "本次交付", "不少于 5000 字，覆盖要求章节并附系统截图。"],
                    ["方案讲解 PPT", "待制作", "建议正文 10-15 页，突出架构、DAG、闭环、创新点和实测证据。"],
                    ["演示视频", "待录制", "建议 3-5 分钟，按“对话 -> 轨迹 -> 方案 -> 记录 -> 结果 -> 评估”录制。"],
                    ["可运行代码/部署", "仓库已具备", "提供 GitHub/Gitee 仓库或 Docker 复现入口；不要提交密钥。"],
                ],
                [104, 84, CONTENT_WIDTH - 188],
                first_col_bold=True,
            ),
            callout(
                "提交口径提醒",
                "白皮书不是宣传册。评审需要能看见可运行代码、Agent 编排、任务调度、结果验证和反馈"
                "闭环的关键操作。PPT 与视频应围绕同一条可复现路径，不使用白皮书里没有的虚构数字。",
            ),
            h2("A.2", "演示路径建议"),
            data_table(
                ["时间", "画面", "要证明的评审点"],
                [
                    ["0:00-0:30", "桌面启动、演示账号、多基地与地块。", "不是普通网页，主入口是对话。"],
                    ["0:30-1:20", "提出选种问题，切换四目标并覆盖本地行情。", "场景需求、证据与用户决定权。"],
                    ["1:20-2:20", "打开运行与产出，查看并行取证、A2A、VERIFY 与 REPAIR。", "Agent 编排、调度算法和自我循环。"],
                    ["2:20-3:20", "采用候选、展开方案、登记一条农事记录。", "建议进入可执行业务闭环。"],
                    ["3:20-4:20", "填写结果、评分，查看能力中心与“运行与评估”入口。", "反馈优化与个性化治理。"],
                ],
                [72, 238, CONTENT_WIDTH - 310],
                font_size=7.0,
                first_col_bold=True,
                compact=True,
            ),
        ]
    )


def add_appendix_b(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("", "附录 B：主要接口与运行命令"),
            h2("B.1", "核心 API"),
            data_table(
                ["方法", "路径", "用途"],
                [
                    ["GET", "/api/bootstrap", "助手与业务数据初始化。"],
                    ["GET", "/api/catalog", "Skill 与工具清单。"],
                    ["POST", "/api/runs", "启动选种或问答运行，可带最多 32 条 capabilityOverrides。"],
                    ["GET", "/api/runs/:id/events", "SSE 轨迹与文本增量。"],
                    ["GET", "/api/runs/:id/capabilities", "读取本次不可变能力快照。"],
                    ["POST", "/api/plans", "把候选建立为种植方案；同一候选重复采用保持幂等。"],
                    ["POST", "/api/plans/:id/records", "新增或更新农事记录。"],
                    ["POST", "/api/plans/:id/outcome", "提交实际产量、品质、收入和成本。"],
                    ["POST", "/api/plans/:id/feedback", "回写用户评分与反馈。"],
                    ["POST", "/api/plots/:id/context/refresh", "刷新地块天气与土壤环境。"],
                    ["POST", "/api/plots/:id/soil", "保存用户测土数据。"],
                    ["GET/POST", "/api/capabilities", "能力中心汇总与绑定管理。"],
                    ["POST", "/api/skills/import", "导入 JSON 或 Markdown 个人技能。"],
                    ["POST", "/api/mcp-servers/:id/discover", "连接 MCP 并发现工具。"],
                    ["POST", "/api/mcp-approvals/:id/decision", "允许/取消确认型 MCP 调用。"],
                    ["POST", "/api/knowledge-bases/:id/documents", "导入并索引本地知识。"],
                ],
                [54, 197, CONTENT_WIDTH - 251],
                font_size=7.0,
                first_col_bold=True,
            ),
            h2("B.2", "启动与验证"),
            code_block(
                """
# 开发调试
pnpm install
cp .env.example .env
pnpm dev

# 桌面应用
pnpm desktop

# Windows 便携版
pnpm desktop:package

# Docker 评测
docker compose up --build

# 工程验证
pnpm typecheck
pnpm test
pnpm build
pnpm check:ui
pnpm check:desktop
                """,
                "命令 B-1  项目提供的启动、打包与验证入口",
            ),
            PageBreak(),
            h2("B.3", "模型配置示例"),
            code_block(
                """
MODEL_PROVIDER=deepseek
MODEL_BASE_URL=https://api.deepseek.com
MODEL_API_KEY=your-server-side-key
MODEL_NAME=deepseek-chat

# 阿里百炼 / 千问兼容接口
MODEL_PROVIDER=qwen
MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL_API_KEY=your-server-side-key
MODEL_NAME=qwen3-max
                """,
                "配置 B-1  密钥只放服务端环境变量，不进入前端、截图或 Git",
            ),
            p(
                "如果百炼控制台提供工作空间专属地址，应将 MODEL_BASE_URL 替换为对应的兼容模式地址。"
                "模型名称和 URL 可替换，不需要修改 Agent 业务代码；但视觉模型仍需使用实际支持图片"
                "输入的模型，文本模型不能替代视觉模型。",
            ),
            h2("B.4", "部署前配置核对"),
            data_table(
                ["检查项", "正确做法", "错误做法"],
                [
                    ["模型密钥", "只放服务端 .env 或桌面用户数据目录。", "写入前端、截图、聊天记录或 Git。"],
                    ["模型地址", "使用供应商兼容模式地址与真实可用模型 ID。", "把文本模型当作视觉模型，或写死不存在的模型。"],
                    ["数据目录", "桌面数据固定到用户数据目录并保留升级兼容。", "每次启动重写数据库或误清除历史卷。"],
                    ["外部服务", "超时、失败和降级都可见，主链可继续。", "把外部 MCP、地图或模型可用性当作系统启动前提。"],
                    ["提交材料", "运行命令、演示账号与合成数据说明齐全。", "只给不可执行链接或要求评审自行配置全部密钥。"],
                ],
                [88, 219, CONTENT_WIDTH - 307],
                font_size=7.0,
                first_col_bold=True,
                compact=True,
            ),
        ]
    )


def add_appendix_c(story: list[Flowable]) -> None:
    story.extend(
        [
            PageBreak(),
            h1("", "附录 C：术语表与参考资料"),
            h2("C.1", "术语"),
            data_table(
                ["术语", "含义"],
                [
                    ["Agent", "有明确职责、输入输出契约、工具/技能边界和运行事件的专业执行角色。"],
                    ["A2A", "Agent 之间传递结构化产物的协作方式；本项目中不是自由文本聊天。"],
                    ["DAG", "有向无环图，用显式依赖表达工作流步骤、并行分支和合流。"],
                    ["CapabilitySnapshot", "某次运行开始前冻结的技能、MCP、知识、覆盖和降级状态。"],
                    ["MCP", "Model Context Protocol，受控发现和调用外部工具的标准接口。"],
                    ["RAG", "Retrieval-Augmented Generation，先从知识库检索证据，再用于表达。"],
                    ["Verifier", "与生成角色分离的独立复核器，负责数值、结构、季节、证据和发布门禁。"],
                    ["SSE", "Server-Sent Events，服务端向桌面前端推送 Agent 轨迹和文本增量。"],
                    ["Harness", "对 Agent 运行时、工具、能力、评估和生命周期的工程管理思想。"],
                    ["地块", "耕策的最小经营决策单元，关联位置、面积、土壤、轮作、方案和结果。"],
                ],
                [103, CONTENT_WIDTH - 103],
                first_col_bold=True,
            ),
            h2("C.2", "项目内参考"),
            bullets(
                [
                    "`docs/architecture.md`：当前产品定位、Mastra 边界、Agent 角色、A2A、可信度与部署。",
                    "`docs/skills.md`：技能目录、个人技能格式、导入边界与验收示例。",
                    "`docs/workflow-acceptance.md`：基地到下一步问答的验收清单。",
                    "`docs/demo-script.md`：3-5 分钟演示路径与关键话术。",
                    "`README.md`：启动、模型配置、能力中心、接口和测试命令。",
                    "`docs/requirements.md`：用户、场景、功能需求与项目边界。",
                    "`docs/deployment.md`：本地开发、Docker、桌面包和模型配置。",
                    "`docs/submission.md`：赛道材料、演示路径与验证清单。",
                ]
            ),
            h2("C.3", "外部参考"),
            bullets(
                [
                    "Mastra 官方文档：https://mastra.ai/ 与 https://docs.mastra.ai/",
                    "Open-Meteo 天气 API：https://open-meteo.com/",
                    "ISRIC SoilGrids：https://soilgrids.org/",
                    "DeepSeek API 文档：https://api-docs.deepseek.com/",
                    "阿里云百炼模型服务文档：https://help.aliyun.com/zh/model-studio/",
                    "Nexent 项目文档：https://modelengine-group.github.io/nexent/zh/getting-started/overview.html",
                    "赛道页面：https://www.omniedu.com/ai-hub/contest/detail/2111011327399952386/intro",
                ]
            ),
            callout(
                "引用说明",
                "外部链接用于说明技术栈、公开数据源和赛事背景。白皮书中的项目数据、代码路径、"
                "测试结果和截图来自本仓库当前版本；未用第三方文章替代本项目的事实证据。",
            ),
        ]
    )


def build_story() -> list[Flowable]:
    story: list[Flowable] = []
    add_cover(story)
    add_front_matter(story)
    add_executive_summary(story)
    add_section_1(story)
    add_section_2(story)
    add_section_3(story)
    add_section_4(story)
    add_section_5(story)
    add_section_6(story)
    add_section_7(story)
    add_section_8(story)
    add_section_9(story)
    add_section_10(story)
    add_section_11(story)
    add_section_12(story)
    add_section_13(story)
    add_section_14(story)
    add_appendix_a(story)
    add_appendix_b(story)
    add_appendix_c(story)
    return story


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = GengceDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title="耕策技术白皮书",
        author="耕策项目组",
        subject="面向小型家庭农场与大型合作社的对话式农业 Agent 技术白皮书",
        creator="耕策项目组",
    )
    doc.multiBuild(build_story(), maxPasses=8)
    print(OUTPUT)


if __name__ == "__main__":
    main()
