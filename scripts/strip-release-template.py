"""
Strip the body and recipient text out of the release form template.

⚠️ WHY THIS EXISTS. The app draws those two blocks itself, because the brand and
campaign sit mid-sentence and everything after them has to move. Drawing over
the placeholders would leave them in the PDF's text layer — invisible on screen
but still extractable, which is the exact fault found in Sequel's own release
form on 18 Sep (a pale-grey "this is an estimate only" that nobody could see and
every text extractor could). So the placeholders are REMOVED, not covered.

Everything else in the template is untouched: the letterhead, the wordmark, the
rotated RELEASE FORM, the footer, the background.

Run this on a freshly exported template whenever Andy changes the document:

    python3 strip.py "Music Release Form (blank template).pdf" release-form-template.pdf
"""

import sys
import pikepdf

# Every string the app redraws. Matched after stripping whitespace, so a
# re-export that re-kerns the same words still matches.
BODY = {
    'To whom it may concern.',
    'The below track has been cleared for use with the',
    '[brand]',
    '[',
    'Campaig',
    'n]',
    'as per the below terms:',
    'Track',
    ': [Track_Name]',
    'Usage Terms:',
    'Term: [Term]',
    'Territory: [Territory]',
    'Media: [Media]',
    'Scripts: [Scripts]',
    'Best',
    '[Signer_Name]',
    '[Signer_Title]',
    'Sequel',
    '[Recipient_Name]',
    '[Recipient_Address]',
    'Ð',  # the en dash, in the export's MacRoman encoding
}

# What must survive. If this does not match exactly afterwards, the export has
# changed shape and this script must be looked at rather than trusted.
KEEP = {
    'Terms & conditions',
    'RELEASE',
    'RELEASE FORM',
    'SEQUEL',
    'www.sequelsounds.com',
    'Sequel is the trading name of TBPB Ltd, registered in England and Wales at 20',
    '-',
    '22 Wenlock',
    'Road, London, United Kingdom, N1 7GU.',
}

SHOW = {'Tj', 'TJ', "'", '"'}


def shown(op):
    operands = op.operands
    if str(op.operator) == 'TJ':
        return ''.join(str(x) for x in operands[0] if isinstance(x, pikepdf.String))
    return ''.join(str(x) for x in operands if isinstance(x, pikepdf.String))


def main(src, dst):
    pdf = pikepdf.open(src)
    page = pdf.pages[0]
    ops = pikepdf.parse_content_stream(page)

    kept, removed, left = [], [], set()
    for op in ops:
        if str(op.operator) in SHOW:
            text = shown(op).strip()
            if text and text in BODY:
                removed.append(text)
                continue
            if text:
                left.add(text)
        kept.append(op)

    missing = BODY - set(removed)
    if missing:
        raise SystemExit(f'these were not found in the template, so nothing was written: {sorted(missing)}')
    if left != KEEP:
        raise SystemExit(f'unexpected text left behind: {sorted(left - KEEP)}; missing: {sorted(KEEP - left)}')

    page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(kept))
    pdf.save(dst)
    print(f'removed {len(removed)} text operators; {len(left)} letterhead strings kept')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
