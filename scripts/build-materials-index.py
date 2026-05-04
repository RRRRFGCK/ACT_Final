import json
import re
from pathlib import Path
from pypdf import PdfReader

PROJECT = Path(r"C:\Users\wyq20\Desktop\MSc CSP\ACT Final Review")
SOURCE = Path(r"C:\Users\wyq20\Desktop\MSc CSP\Advanced Communication Theory")
PDFS = [
    "ACT_0_Course_Information_and_Topics.pdf",
    "ACT_1_Introductory_Overview.pdf",
    "ACT_2_Diversity_Theory.pdf",
    "ACT_3_SIMO_MISO_MIMO.pdf",
    "ACT_4_Array Receivers_SIMO_MIMO.pdf",
    "ACT_5_Extended Array_Architectures_optimised.pdf",
    "ACT_6_Localisation.pdf",
]

LECTURE_TITLES = {
    "ACT_0": "Course Information and Topics",
    "ACT_1": "Introductory Overview",
    "ACT_2": "Diversity Theory",
    "ACT_3": "SIMO, MISO, MIMO",
    "ACT_4": "Array Receivers, SIMO, MIMO",
    "ACT_5": "Extended Array Architectures",
    "ACT_6": "Localisation",
}


def clean(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def lecture_key(filename: str) -> str:
    match = re.match(r"(ACT_\d+)", filename)
    return match.group(1) if match else filename.rsplit(".", 1)[0]


def main():
    chunks = []
    materials = []
    for filename in PDFS:
        path = SOURCE / filename
        key = lecture_key(filename)
        title = LECTURE_TITLES.get(key, filename)
        reader = PdfReader(str(path))
        materials.append({"key": key, "title": title, "filename": filename, "pages": len(reader.pages)})
        for page_index, page in enumerate(reader.pages, start=1):
            try:
                content = clean(page.extract_text() or "")
            except Exception:
                content = ""
            if len(content) < 80:
                continue
            chunks.append({
                "id": f"{key}_p{page_index}",
                "lecture": key,
                "title": title,
                "filename": filename,
                "page": page_index,
                "ref": f"{key} {title}, page {page_index}",
                "content": content[:4500],
            })

    output = {
        "course": "Imperial CSP Advanced Communication Theory",
        "built_from": str(SOURCE),
        "materials": materials,
        "chunks": chunks,
    }
    out_path = PROJECT / "materials-index.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"Materials: {len(materials)}; chunks: {len(chunks)}")


if __name__ == "__main__":
    main()
