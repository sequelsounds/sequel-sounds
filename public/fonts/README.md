# Creato Display

Licensed from Zetafonts. Self-hosted woff2, converted from the OTFs uploaded to
the `Sequel Track` Webflow site (`cdn.prod.website-files.com/68e6c2e8dbcd39de2547a97d/`).

Seven weights: Thin 100, Light 300, Regular 400, Medium 500, Bold 700,
ExtraBold 800, Black 900. Webflow records ExtraBold as 700 like Bold; it is
mapped to 800 in `src/index.css` so both stay reachable.

There is no 600, so `font-semibold` resolves to Bold 700 by CSS weight
matching. Use `font-medium` (500) where that is too heavy.

To re-convert after a licence update, fetch the OTFs and run:

    npm install --no-save wawoff2
    node -e "const w=require('wawoff2'),f=require('fs');(async()=>{for(const n of f.readdirSync('.').filter(x=>x.endsWith('.otf')))f.writeFileSync(n.replace(/\.otf$/,'.woff2'),Buffer.from(await w.compress(f.readFileSync(n))))})()"

# Mrs Saint Delafield

Google Fonts, SIL Open Font License 1.1 (free to self-host and embed). The
handwriting face for the Schedule A signature: the signing page previews the
typed name in it, and the song-schedule-a edge function draws the same face
on the signed PDF (it fetches the TTF from jsDelivr, pinned). Converted to
woff2 from `@expo-google-fonts/mrs-saint-delafield@0.4.1` with fontTools.
