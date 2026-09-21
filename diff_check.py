from difflib import unified_diff
import pypdf


def extract_pdf_raw(pdf_path):
  reader = pypdf.PdfReader(pdf_path)
  text = ''
  for page in reader.pages:
    text += (page.extract_text() or '') + '\n'
  return text


# 1. Extract raw text from the corpus PDF
pdf_text = extract_pdf_raw('corpus/meridian-handbook.pdf')

# 2. Read clean Markdown ground truth directly as text (no pypdf!)
with open(
    'reference/meridian-handbook-reference.md',
    'r',
    encoding='utf-8-sig',
    errors='ignore',
) as f:
  ref_text = f.read()

# 3. Generate line-by-line diff comparison
pdf_lines = pdf_text.splitlines(keepends=True)
ref_lines = ref_text.splitlines(keepends=True)

diff = list(
    unified_diff(
        pdf_lines[:100],
        ref_lines[:100],
        fromfile='PDF_Extracted',
        tofile='Markdown_Reference',
    )
)

print('--- EXTRACTION DIFF SAMPLE (First 100 Lines) ---')
print(''.join(diff[:40]))