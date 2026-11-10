# Phase P7: synthetic research documents for the tests. Every person, title, dataset and number here is invented.
# Run: python3 e2e/source-docs/make.py  (reportlab, pypdf, Pillow, python-docx)
import io, os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from pypdf import PdfReader, PdfWriter
from PIL import Image, ImageDraw
import docx

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = A4

def pdf(name, pages, title=None, author=None, font='Helvetica'):
    c = canvas.Canvas(os.path.join(HERE, name), pagesize=A4)
    if title: c.setTitle(title)
    if author: c.setAuthor(author)
    for page in pages:
        y = H - 72
        for kind, text in page:
            if kind == 'figure':
                c.rect(100, y - 120, 300, 110); y -= 140; continue
            size = {'title': 18, 'h1': 14, 'h2': 12, 'p': 10, 'small': 9}[kind]
            c.setFont(font if kind in ('p', 'small') or font != 'Helvetica' else 'Helvetica-Bold', size)
            for line in wrap(text, 95 if font == 'Helvetica' else 40):
                c.drawString(72, y, line); y -= size + 5
            y -= 6
        c.showPage()
    c.save()

def wrap(t, n):
    out, cur = [], ''
    for w in (t.split(' ') if ' ' in t else list(t)):
        sep = ' ' if ' ' in t else ''
        if len(cur) + len(w) + 1 > n: out.append(cur); cur = w
        else: cur = (cur + sep + w) if cur else w
    return out + ([cur] if cur else [])

EN = [
    [('title', 'Lantern Networks for Fictional Flood Forecasting'), ('p', 'Alice Fiction and Bob Example'), ('p', 'Department of Imaginary Science, Example University of Lanterns'), ('p', '2023'),
     ('h1', 'Abstract'), ('p', 'This paper proposes a lantern network for forecasting fictional floods. We evaluate it on the synthetic RiverLight dataset of 12,000 samples and report accuracy, RMSE and F1. Results show that the lantern network outperforms a persistence baseline by 8 percent.'),
     ('h1', '1 Introduction'), ('p', 'Fictional flood forecasting remains an open problem because river sensors are sparse. The aim of this study is to test whether lantern networks can use sparse sensors. Research question RQ1: does a lantern network reduce forecast error compared with a persistence baseline?')],
    [('h1', '2 Related Work'), ('p', 'Earlier fictional studies used gradient lanterns and recurrent glow models. Most of them were evaluated on small private datasets, which leaves a gap for public benchmarks.'),
     ('h1', '3 Method'), ('p', 'We design a lantern network with three glow layers and a recurrent memory. The model is trained with PyTorch on the RiverLight dataset, split 70/15/15 by river.'),
     ('h2', '3.1 Data'), ('p', 'The RiverLight dataset contains 12,000 fictional samples collected from 40 invented rivers. Data were collected every hour.'),
     ('p', 'Table 1. Fictional results  |  Model  Accuracy  RMSE  |  Lantern 0.91 1.20  |  Persistence 0.83 1.95'),
     ('figure', ''), ('small', 'Figure 1. The lantern architecture (fictional).')],
    [('h1', '4 Results'), ('p', 'Results show that the lantern network achieved an accuracy of 0.91 and an RMSE of 1.20, while the persistence baseline achieved 0.83 and 1.95. The difference was significant with p < 0.05 over five seeds.'),
     ('h1', '5 Conclusion'), ('p', 'Lantern networks improve fictional flood forecasts on sparse sensors. A limitation of this study is that all rivers are invented and small. Future work should test the method on real rivers and longer horizons.')],
    [('h1', 'References'), ('p', '[1] Fiction A. Gradient lanterns[J]. Journal of Imaginary Hydrology, 2020, 3(1): 1-10.'), ('p', '[2] Example B. Recurrent glow models[C]//Proceedings of Lantern Conference. 2021: 5-9.')],
]
pdf('paper-en.pdf', EN, title='Lantern Networks for Fictional Flood Forecasting', author='Alice Fiction; Bob Example')

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
ZH = [
    [('title', '灯笼网络在虚构洪水预测中的应用研究'), ('p', '硕士学位论文'), ('p', '作者：王小明'), ('p', '虚构大学 计算机学院'), ('p', '2024年'),
     ('h1', '摘要'), ('p', '本文提出一种灯笼网络用于虚构洪水预测。实验在虚构的河光数据集上进行，结果表明灯笼网络的准确率达到百分之九十一，优于基线方法。')],
    [('h1', '第一章 绪论'), ('p', '虚构洪水预测仍然存在传感器稀疏的问题。本文旨在研究灯笼网络能否利用稀疏传感器。'),
     ('h1', '第二章 文献综述'), ('p', '已有研究主要使用梯度灯笼模型，但多数研究缺少公开数据集。'),
     ('h1', '第三章 研究方法'), ('p', '本文设计了三层灯笼网络模型，并在河光数据集上训练。数据集包含一万二千个虚构样本。')],
    [('h1', '第四章 实验结果'), ('p', '实验结果表明，灯笼网络的准确率为零点九一，均方根误差为一点二。'),
     ('h1', '第五章 结论与展望'), ('p', '本研究的局限在于所有河流均为虚构。未来工作将在真实河流上进行验证。'),
     ('h1', '参考文献'), ('p', '[1] 李华. 梯度灯笼方法[J]. 虚构水文学报, 2020, 3(1): 1-10.')],
]
pdf('thesis-zh.pdf', ZH, font='STSong-Light')

# No title in the file properties, no year anywhere, no institution.
pdf('no-meta.pdf', [[('p', 'Notes on fictional lanterns'), ('p', 'These informal notes describe how a fictional lantern glows. They give no author, no date and no institution, and they have no sections.')]])

# A long document: 60 pages, a numbered heading every 10 pages.
LONG = []
for i in range(60):
    page = []
    if i % 10 == 0: page.append(('h1', f'{i // 10 + 1} Fictional chapter {i // 10 + 1}'))
    page.append(('p', f'Page {i + 1} text about synthetic lantern glow measurement number {i + 1}. ' * 6))
    LONG.append(page)
LONG[45].append(('p', 'The unique marker phrase is quantum lantern calibration, which appears only on page forty-six.'))
pdf('long.pdf', LONG, title='A long fictional report')

# A scanned page: an image with no text layer.
img = Image.new('RGB', (1240, 1754), 'white')
ImageDraw.Draw(img).text((100, 100), 'Scanned fictional page', fill='black')
img.save(os.path.join(HERE, 'scanned.pdf'), 'PDF', resolution=150)

# A password-protected copy of the English paper.
w = PdfWriter(clone_from=PdfReader(os.path.join(HERE, 'paper-en.pdf')))
w.encrypt('synthetic-password')
with open(os.path.join(HERE, 'protected.pdf'), 'wb') as f: w.write(f)

# A Word thesis in English and Chinese, with a table.
d = docx.Document()
d.add_heading('Fictional Lantern Thesis', 0)
d.add_paragraph('Master thesis, Example University of Lanterns, 2022')
d.add_heading('Abstract', 1)
d.add_paragraph('This thesis aims to measure fictional lantern glow with a new sensor. 本文旨在测量虚构灯笼的亮度。')
d.add_heading('Methodology', 1)
d.add_paragraph('We collected a dataset of 300 fictional lanterns and used a random forest model. 数据集包含三百个样本。')
t = d.add_table(rows=2, cols=2); t.cell(0, 0).text = 'Model'; t.cell(0, 1).text = 'Accuracy'; t.cell(1, 0).text = 'Forest'; t.cell(1, 1).text = '0.88'
d.add_heading('Conclusion', 1)
d.add_paragraph('A limitation is the small sample. Future work should use more lanterns.')
d.save(os.path.join(HERE, 'thesis-en-zh.docx'))

with open(os.path.join(HERE, 'broken.pdf'), 'wb') as f: f.write(b'%PDF-1.4\nthis is not really a pdf')
print('ok')
