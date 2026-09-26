"""
Strip the variable text out of the composition licence template, and measure
where it sat so the app can draw its own values in the same places.

    python3 scripts/strip-licence-template.py "Claude outputs/Composition Licence.pdf"
    python3 scripts/strip-licence-template.py "Claude outputs/Library Licence.pdf" library

Writes, into supabase/functions/composition-licence/:
  composition:  licence-template.pdf + layout.ts          (export LAYOUT)
  library:      library-template.pdf + layout-library.ts  (export LIBRARY_LAYOUT)
The template with every placeholder REMOVED, and where each value goes
(generated; do not hand-edit).

The library licence (26 Sep 2026) is the composition licence's Word file with
the library changes — same placeholders, same pages — so one script serves both.

Then: node scripts/build-licence-assets.mjs

⚠️ REMOVED, NOT COVERED — the same rule as the release form. Drawing over a
placeholder leaves "[Licence_Fee]" in the text layer: invisible on screen,
readable by anything that extracts text or searches the PDF.

⚠️ THE ELEVEN CLAUSES ARE NEVER TOUCHED. Only pages 1 (the certificate) and 5
(the schedule) carry placeholders, and only the operators listed below are
removed. If a re-export changes how Word splits the text, this script refuses
to write anything rather than guess.
"""

import sys, json, os
import pikepdf, pdfplumber

SRC = sys.argv[1]
KIND = sys.argv[2] if len(sys.argv) > 2 else 'composition'
if KIND not in ('composition', 'library'):
    raise SystemExit('kind is composition or library')
TEMPLATE_NAME = 'licence-template.pdf' if KIND == 'composition' else 'library-template.pdf'
LAYOUT_FILE = 'layout.ts' if KIND == 'composition' else 'layout-library.ts'
LAYOUT_NAME = 'LAYOUT' if KIND == 'composition' else 'LIBRARY_LAYOUT'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'supabase', 'functions', 'composition-licence')

SHOW = {'Tj', 'TJ', "'", '"'}

# page index -> exact operator strings to remove (after .strip()), each must
# appear exactly once on that page.
REMOVE = {
    0: ['[Sequel_No]', '[Date]', '[Licensee_Name]', '[Licensee_Address]',
        'This document serves as a binding contract. By paying the associated Licence Fee invoice ([Invoice_Number]), the'],
    4: [': [Rights_Granted]', ': [Licensor_Share]', '[Composition_Title]',
        '[', 'Writer_Names', ']',
        '[Production_Name]', '[Client_Name]', '[Brand_Name_and_Variants]',
        '[Campaign_Details]', '[Scripts_Details]', '[Yes/No]', '[Media_Details]',
        '[Territory_Details]', '[Term_Duration]', '[First_Transmission_Date]',
        '[Licence_Fee] to cover one hundred per cent (100%) of the',
        'Rights Granted.'],
}

# ⚠️ Word splits the same line differently from one export to the next. The
# library export (26 Sep) broke the fee placeholder after "[Licence".
if KIND == 'library':
    REMOVE[4] = [w for w in REMOVE[4] if w != '[Licence_Fee] to cover one hundred per cent (100%) of the'] + [
        '[Licence', '_Fee] to cover one hundred per cent (100%) of the']


def shown(op):
    o = op.operands
    if str(op.operator) == 'TJ':
        return ''.join(str(x) for x in o[0] if isinstance(x, pikepdf.String))
    return ''.join(str(x) for x in o if isinstance(x, pikepdf.String))


def measure():
    """Where each value starts: x of its first character, baseline y (PDF
    space, from the bottom), and the character spacing Word used there."""
    pl = pdfplumber.open(SRC)

    def line_chars(page, needle):
        text = ''.join(c['text'] for c in page.chars)
        i = text.find(needle)
        if i < 0 or text.find(needle, i + 1) >= 0:
            raise SystemExit(f'{needle!r} not found exactly once on page {page.page_number}')
        return page.chars[i:i + len(needle)]

    def at(pn, needle, offset=0):
        cs = line_chars(pl.pages[pn], needle)
        c = cs[offset]
        # Word's condensing, as the gap between two glyph advances.
        tc = 0.0
        if len(cs) > 2:
            a, b = cs[1], cs[2]
            tc = round((b['x0'] - a['x0']) - a['width'], 4)
        return {'page': pn, 'x': round(c['x0'], 2), 'y': round(c['matrix'][5], 2), 'tc': tc,
                'size': round(c['size'], 2)}

    L = {
        'sequel_no': at(0, '[Sequel_No]'),
        'date': at(0, '[Date]'),
        'licensee_name': at(0, '[Licensee_Name]'),
        'licensee_address': at(0, '[Licensee_Address]'),
        'binding': at(0, 'This document serves as a binding contract.'),
        'binding_next': at(0, 'Licensee confirms full acceptance'),
        'rights_granted': at(4, ': [Rights_Granted]'),
        'licensor_share': at(4, ': [Licensor_Share]'),
        'composition_title': at(4, '[Composition_Title]'),
        'writer_names': at(4, '[Writer_Names]'),
        'production_name': at(4, '[Production_Name]'),
        'client_name': at(4, '[Client_Name]'),
        'brand': at(4, '[Brand_Name_and_Variants]'),
        'campaign': at(4, '[Campaign_Details]'),
        'scripts': at(4, '[Scripts_Details]'),
        'cutdowns': at(4, '[Yes/No]'),
        'media': at(4, '[Media_Details]'),
        'territory': at(4, '[Territory_Details]'),
        'term': at(4, '[Term_Duration]'),
        'first_transmission': at(4, '[First_Transmission_Date]'),
        'licence_fee': at(4, '[Licence_Fee]'),
    }
    # The line after the address, so a two-line address can be checked
    # against it rather than assumed to fit.
    L['after_address'] = at(0, '(the "Licensee")')
    L['page_right'] = round(pl.pages[0].width - 72, 2)
    return L


def main():
    layout = measure()
    pdf = pikepdf.open(SRC)
    for pn, wanted in REMOVE.items():
        page = pdf.pages[pn]
        ops = pikepdf.parse_content_stream(page)
        seen = {w: 0 for w in wanted}
        kept = []
        for op in ops:
            if str(op.operator) in SHOW:
                t = shown(op).strip()
                if t in seen:
                    seen[t] += 1
                    continue
            kept.append(op)
        bad = {k: v for k, v in seen.items() if v != 1}
        if bad:
            raise SystemExit(f'page {pn + 1}: expected each exactly once, got {bad}. Nothing written.')
        page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(kept))

    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, TEMPLATE_NAME)
    pdf.save(dst)

    # Nothing in square brackets may survive anywhere in the document.
    left = [(i + 1, w) for i, p in enumerate(pdfplumber.open(dst).pages)
            for w in (p.extract_text() or '').split() if '[' in w or ']' in w]
    if left:
        raise SystemExit(f'placeholder text survived: {left}')

    with open(os.path.join(OUT, LAYOUT_FILE), 'w') as f:
        f.write('// Generated by scripts/strip-licence-template.py — do not hand-edit.\n')
        f.write('// Measured off the template: x of each value\'s first character, its\n')
        f.write('// baseline y in PDF space (from the bottom), Word\'s character spacing.\n')
        f.write(f'export const {LAYOUT_NAME} = ' + json.dumps(layout, indent=2) + ' as const\n')
    print('stripped; layout written')
    print(json.dumps(layout, indent=1))


main()
