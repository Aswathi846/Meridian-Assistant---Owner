import pypdf

# 1. Extract text from the binary reference file
reader = pypdf.PdfReader("reference/meridian-handbook-reference.md")
clean_md_text = ""
for page in reader.pages:
  clean_md_text += (page.extract_text() or "") + "\n"

# 2. Overwrite the file with clean, uncorrupted plain text
with open(
    "reference/meridian-handbook-reference.md", "w", encoding="utf-8"
) as f:
  f.write(clean_md_text)

print(
    "Successfully converted reference/meridian-handbook-reference.md into clean text!"
)