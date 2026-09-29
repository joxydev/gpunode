#!/usr/bin/env python3
"""Render the unsigned legal review draft. Never put this PDF at the signed URL."""
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/OFFER_FINANCIAL_DRAFT.md'
OUTPUT = ROOT / 'docs/OFFER_FINANCIAL_DRAFT.pdf'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
pdfmetrics.registerFont(TTFont('DejaVu', FONT))
pdfmetrics.registerFont(TTFont('DejaVuBold', BOLD))
pdfmetrics.registerFontFamily('DejaVu', normal='DejaVu', bold='DejaVuBold')

styles = {
    'title': ParagraphStyle('title', fontName='DejaVuBold', fontSize=13.5, leading=20,
                            textColor=colors.HexColor('#151d35'), spaceAfter=17),
    'heading': ParagraphStyle('heading', fontName='DejaVuBold', fontSize=10.3, leading=15,
                              textColor=colors.HexColor('#1d435d'), spaceBefore=15, spaceAfter=8),
    'body': ParagraphStyle('body', fontName='DejaVu', fontSize=8.8, leading=13.5,
                           textColor=colors.HexColor('#202535'), spaceAfter=8),
    'warning': ParagraphStyle('warning', fontName='DejaVuBold', fontSize=9, leading=14,
                              textColor=colors.HexColor('#9c3e3e'), spaceAfter=10),
}

flow=[]
for line in SOURCE.read_text(encoding='utf8').splitlines():
    value=line.strip()
    if not value or value=='---':
        continue
    if value.startswith('# '):
        flow.append(Paragraph(escape(value[2:]), styles['title']))
    elif value.startswith('## '):
        flow.append(Paragraph(escape(value[3:]), styles['heading']))
    else:
        style=styles['warning'] if value.startswith(('LEGAL_REVIEW_REQUIRED','ЧЕРНОВИК.')) else styles['body']
        flow.append(Paragraph(escape(value), style))

doc=SimpleDocTemplate(str(OUTPUT), pagesize=A4, leftMargin=54,rightMargin=54,
                      topMargin=62,bottomMargin=55, title='AetherMind financial offer - unsigned review draft',
                      author='AetherMind legal review draft')
def page(canvas, document):
    canvas.saveState()
    width,height=A4
    canvas.setFillColor(colors.HexColor('#9c3e3e'))
    canvas.setFont('DejaVuBold', 8)
    canvas.drawString(54,height-32,'LEGAL_REVIEW_REQUIRED  ·  НЕОПУБЛИКОВАННЫЙ ЧЕРНОВИК')
    canvas.setStrokeColor(colors.HexColor('#cbd6df'))
    canvas.line(54,height-39,width-54,height-39)
    canvas.setFillColor(colors.HexColor('#505a68'))
    canvas.setFont('DejaVu', 7.5)
    canvas.drawString(54,33,'Новая подпись и фактическая дата публикации отсутствуют')
    canvas.drawRightString(width-54,33,str(document.page))
    canvas.restoreState()
doc.build(flow,onFirstPage=page,onLaterPages=page)
print(OUTPUT)
