#!/usr/bin/env python3
"""Keep the six published pages unchanged, append the owner's literal 4.3."""
from pathlib import Path
import io,hashlib,json,re,sys
from pypdf import PdfReader,PdfWriter
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
root=Path(__file__).resolve().parent.parent
source=root/'contracts/archive/public-offer-aethermind-ton-2026-10-07.pdf'
assert hashlib.sha256(source.read_bytes()).hexdigest()=='71c911b32f1987d64a901f6c55d790db0c391cdc79ba657e80ab98df08c47041'
clause=json.loads((root/'docs/network-clause.json').read_text())
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';bold='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
pdfmetrics.registerFont(TTFont('Offer',font));pdfmetrics.registerFont(TTFont('OfferBold',bold))
styles=getSampleStyleSheet();styles.add(ParagraphStyle('BodyOffer',fontName='Offer',fontSize=9.5,leading=14,spaceAfter=10));styles.add(ParagraphStyle('TitleOffer',fontName='OfferBold',fontSize=14,leading=19,spaceAfter=16));styles.add(ParagraphStyle('HeadOffer',fontName='OfferBold',fontSize=10,leading=15,spaceAfter=10))
buf=io.BytesIO();story=[Paragraph('ДОПОЛНЕНИЕ К ОФЕРТЕ № 88/2026-AI',styles['TitleOffer']),Paragraph('Редакция: 88-2026-AI-NETWORK-2026-10-10',styles['HeadOffer']),Paragraph('Дата подготовки редакции: 10 октября 2026 года. Фактические UTC дата и время публикации фиксируются в реестре выпуска платформы и доступны в разделе «Публичная оферта». Пункт 4.3 вступает в силу через 7 календарных дней после фактической публикации (п. 8.1). Ранее принятые договоры сохраняют свои условия. Исторические обязательства пп. 4.1–4.2 восстанавливаются отдельно по подтверждённому отчёту; п. 4.3 задним числом не применяется.',styles['BodyOffer'])]
for text in clause['paragraphs']:
 style=styles['HeadOffer'] if text.startswith('4.3.') and not text.startswith('•') else styles['BodyOffer']
 story.append(Paragraph(text.replace('&','&amp;').replace('<','&lt;'),style))
story.append(Spacer(1,10));story.append(Paragraph('Публичным текущим документом является объединённая редакция: неизменные условия на первых шести страницах и настоящее дополнение. Сохранённые акцепты прошлых редакций не заменяются. Дополнительные пограничные определения расчётов утверждаются владельцем в версионированном регламенте; до утверждения зависимые окончательные выплаты показывают причину ожидания. Доступ к собственному свободному балансу и ранее заключённым договорам сохраняется.',styles['BodyOffer']))
def footer(c,doc):
 c.setFont('Offer',8);c.drawString(48,30,'AetherMind · Дополнение 4.3 · '+str(doc.page+6))
SimpleDocTemplate(buf,pagesize=(595.28,841.89),leftMargin=48,rightMargin=48,topMargin=45,bottomMargin=48).build(story,onFirstPage=footer,onLaterPages=footer)
w=PdfWriter();w.append(PdfReader(source));w.append(PdfReader(buf));w.add_metadata({'/Title':'AetherMind public offer and clause 4.3','/CreationDate':'D:20261010000000Z'})
target=root/'frontend/public/documents/public-offer-aethermind-network-2026-10-10.pdf';w.write(target)
digest=hashlib.sha256(target.read_bytes()).hexdigest();print(json.dumps({'sha256':digest,'pages':len(w.pages),'path':str(target)}))
