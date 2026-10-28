//! Lettertype-subsetting zonder nieuwe afhankelijkheid (#227).
//!
//! WAAROM
//! printpdf 0.7 bedt een extern TrueType-lettertype volledig in; zijn eigen
//! subsetting (feature `font_subsetting`) trekt `allsorts` mee en nummert de
//! glyphs om. Een rapport met vier Liberation Sans-varianten droeg zo ruim
//! 1,6 MB aan lettertype, terwijl het een paar honderd glyphs gebruikt.
//!
//! WAT HIER GEBEURT
//! Een glyph-behoudende subset: de glyph-nummers blijven gelijk, alleen de
//! omtrek (`glyf`) van glyphs die het document niet gebruikt wordt leeg
//! gemaakt. Daardoor blijven de Identity-H-codes in de inhoud (= glyph-
//! nummers), `hmtx` en de breedtes gelijk, en blijft tekstextractie werken.
//! Verder:
//!  * `cmap` noemt alleen de gebruikte tekens (met hun oude glyph-nummers);
//!    printpdf leidt daaruit W en ToUnicode af, die anders alle ~2 600
//!    tekens van het lettertype noemen (33 kB per lettertype);
//!  * `loca` wordt opnieuw opgebouwd (altijd het lange formaat);
//!  * samengestelde glyphs houden hun onderdelen;
//!  * tabellen die een PDF-lezer niet gebruikt (OpenType-layout, kerning,
//!    bitmaps, handtekening) vallen weg; `post` gaat naar versie 3 (zonder
//!    glyphnamen);
//!  * controlesommen en `head.checkSumAdjustment` worden opnieuw berekend.
//!
//! Een lettertype zonder `glyf`/`loca` (CFF) of met een onverwachte opbouw
//! blijft ongewijzigd: liever een groot bestand dan een kapot lettertype.

use std::collections::BTreeSet;

/// Tabellen die een PDF-lezer voor een ingebed TrueType-lettertype
/// (FontFile2, CIDFontType2 met Identity-H) niet nodig heeft (ISO 32000-1
/// 9.9: glyf, head, hhea, hmtx, loca, maxp, cvt, fpgm, prep; cmap, OS/2,
/// name en post blijven voor printpdf en voor de zekerheid staan).
const WEG: [&[u8; 4]; 22] = [
    b"GSUB", b"GPOS", b"GDEF", b"BASE", b"JSTF", b"MATH", b"kern", b"DSIG", b"hdmx", b"LTSH",
    b"VDMX", b"PCLT", b"morx", b"mort", b"feat", b"EBDT", b"EBLC", b"EBSC", b"CBDT", b"CBLC",
    b"sbix", b"SVG ",
];

fn u16_op(d: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_be_bytes(d.get(o..o + 2)?.try_into().ok()?))
}
fn u32_op(d: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_be_bytes(d.get(o..o + 4)?.try_into().ok()?))
}

fn controlesom(data: &[u8]) -> u32 {
    let mut som = 0u32;
    for stuk in data.chunks(4) {
        let mut w = [0u8; 4];
        w[..stuk.len()].copy_from_slice(stuk);
        som = som.wrapping_add(u32::from_be_bytes(w));
    }
    som
}

/// Een nieuwe `cmap` met alleen de gebruikte tekens: format 4 voor het BMP
/// (platform 0/3 en 3/1) en format 12 (3/10) als er tekens daarboven zijn.
/// De glyph-nummers zijn die van het originele lettertype.
fn nieuwe_cmap(paren: &[(u32, u16)]) -> Option<Vec<u8>> {
    let bmp: Vec<(u16, u16)> = paren.iter().filter(|(c, _)| *c < 0xFFFF).map(|&(c, g)| (c as u16, g)).collect();
    // Format 4: één segment per teken, plus het verplichte slotsegment 0xFFFF.
    let segmenten = bmp.len() + 1;
    if segmenten * 8 + 16 > u16::MAX as usize { return None; }
    let mut macht = 1usize;
    let mut log = 0u16;
    while macht * 2 <= segmenten { macht *= 2; log += 1; }
    let mut f4: Vec<u8> = Vec::new();
    let w = |v: &mut Vec<u8>, x: u16| v.extend_from_slice(&x.to_be_bytes());
    w(&mut f4, 4);
    w(&mut f4, (16 + segmenten * 8) as u16);
    w(&mut f4, 0);
    w(&mut f4, (segmenten * 2) as u16);
    w(&mut f4, (macht * 2) as u16);
    w(&mut f4, log);
    w(&mut f4, (segmenten * 2 - macht * 2) as u16);
    for &(c, _) in &bmp { w(&mut f4, c); }
    w(&mut f4, 0xFFFF);
    w(&mut f4, 0);
    for &(c, _) in &bmp { w(&mut f4, c); }
    w(&mut f4, 0xFFFF);
    for &(c, g) in &bmp { w(&mut f4, g.wrapping_sub(c)); }
    w(&mut f4, 1);
    for _ in 0..segmenten { w(&mut f4, 0); }

    let hoog: Vec<(u32, u16)> = paren.iter().filter(|(c, _)| *c > 0xFFFF).copied().collect();
    let f12 = (!hoog.is_empty()).then(|| {
        let mut v: Vec<u8> = Vec::new();
        v.extend_from_slice(&12u16.to_be_bytes());
        v.extend_from_slice(&0u16.to_be_bytes());
        v.extend_from_slice(&((16 + paren.len() * 12) as u32).to_be_bytes());
        v.extend_from_slice(&0u32.to_be_bytes());
        v.extend_from_slice(&(paren.len() as u32).to_be_bytes());
        for &(c, g) in paren {
            v.extend_from_slice(&c.to_be_bytes());
            v.extend_from_slice(&c.to_be_bytes());
            v.extend_from_slice(&(g as u32).to_be_bytes());
        }
        v
    });

    let records = if f12.is_some() { 3u16 } else { 2 };
    let kop = 4 + 8 * records as u32;
    let mut cmap: Vec<u8> = Vec::new();
    cmap.extend_from_slice(&0u16.to_be_bytes());
    cmap.extend_from_slice(&records.to_be_bytes());
    for (platform, codering, offset) in [(0u16, 3u16, kop), (3, 1, kop)] {
        cmap.extend_from_slice(&platform.to_be_bytes());
        cmap.extend_from_slice(&codering.to_be_bytes());
        cmap.extend_from_slice(&offset.to_be_bytes());
    }
    if f12.is_some() {
        cmap.extend_from_slice(&3u16.to_be_bytes());
        cmap.extend_from_slice(&10u16.to_be_bytes());
        cmap.extend_from_slice(&(kop + f4.len() as u32).to_be_bytes());
    }
    cmap.extend_from_slice(&f4);
    if let Some(f) = f12 { cmap.extend_from_slice(&f); }
    Some(cmap)
}

/// De subset van `font` voor de tekens in `tekens` (plus .notdef). Bij elk
/// probleem: `None`, en dan hoort de aanroeper het origineel te gebruiken.
pub fn subset_ttf(font: &[u8], tekens: &BTreeSet<char>) -> Option<Vec<u8>> {
    let face = ttf_parser::Face::parse(font, 0).ok()?;
    // Tabeldirectory.
    let aantal = u16_op(font, 4)? as usize;
    let mut tabellen: Vec<([u8; 4], &[u8])> = Vec::with_capacity(aantal);
    for i in 0..aantal {
        let r = 12 + 16 * i;
        let tag: [u8; 4] = font.get(r..r + 4)?.try_into().ok()?;
        let offset = u32_op(font, r + 8)? as usize;
        let lengte = u32_op(font, r + 12)? as usize;
        tabellen.push((tag, font.get(offset..offset + lengte)?));
    }
    let tabel = |tag: &[u8; 4]| tabellen.iter().find(|(t, _)| t == tag).map(|(_, d)| *d);
    let (glyf, loca, head, maxp) = (tabel(b"glyf")?, tabel(b"loca")?, tabel(b"head")?, tabel(b"maxp")?);
    let aantal_glyphs = u16_op(maxp, 4)? as usize;
    let lang = match u16_op(head, 50)? {
        0 => false,
        1 => true,
        _ => return None,
    };
    let plek = |gid: usize| -> Option<usize> {
        if lang { u32_op(loca, gid * 4).map(|v| v as usize) } else { u16_op(loca, gid * 2).map(|v| v as usize * 2) }
    };
    let glyph = |gid: usize| -> Option<&[u8]> {
        let (a, b) = (plek(gid)?, plek(gid + 1)?);
        if b < a { return None; }
        glyf.get(a..b)
    };

    // De glyphs die blijven: .notdef, de glyph van elk teken, en de
    // onderdelen van samengestelde glyphs (transitief).
    let mut houden: BTreeSet<usize> = BTreeSet::from([0]);
    let mut paren: Vec<(u32, u16)> = Vec::new();
    for &c in tekens {
        if let Some(g) = face.glyph_index(c) {
            houden.insert(g.0 as usize);
            paren.push((c as u32, g.0));
        }
    }
    let nieuw_cmap = nieuwe_cmap(&paren)?;
    let mut te_doen: Vec<usize> = houden.iter().copied().collect();
    while let Some(gid) = te_doen.pop() {
        if gid >= aantal_glyphs { return None; }
        let d = glyph(gid)?;
        if d.len() < 10 || (u16_op(d, 0)? as i16) >= 0 { continue; }
        let mut o = 10;
        loop {
            let vlaggen = u16_op(d, o)?;
            let onderdeel = u16_op(d, o + 2)? as usize;
            if houden.insert(onderdeel) { te_doen.push(onderdeel); }
            o += 4 + if vlaggen & 0x0001 != 0 { 4 } else { 2 };
            o += if vlaggen & 0x0008 != 0 { 2 } else if vlaggen & 0x0040 != 0 { 4 } else if vlaggen & 0x0080 != 0 { 8 } else { 0 };
            if vlaggen & 0x0020 == 0 { break; }
        }
    }

    // Nieuwe glyf en loca (lang formaat), glyph-nummers ongewijzigd.
    let mut nieuw_glyf: Vec<u8> = Vec::new();
    let mut nieuw_loca: Vec<u8> = Vec::with_capacity((aantal_glyphs + 1) * 4);
    for gid in 0..aantal_glyphs {
        nieuw_loca.extend_from_slice(&(nieuw_glyf.len() as u32).to_be_bytes());
        if houden.contains(&gid) {
            nieuw_glyf.extend_from_slice(glyph(gid)?);
            while nieuw_glyf.len() % 4 != 0 { nieuw_glyf.push(0); }
        }
    }
    nieuw_loca.extend_from_slice(&(nieuw_glyf.len() as u32).to_be_bytes());
    let mut nieuw_head = head.to_vec();
    nieuw_head.get_mut(50..52)?.copy_from_slice(&1u16.to_be_bytes());
    nieuw_head.get_mut(8..12)?.copy_from_slice(&[0; 4]);

    let mut uit: Vec<([u8; 4], Vec<u8>)> = Vec::new();
    for (tag, data) in &tabellen {
        if WEG.iter().any(|w| *w == tag) { continue; }
        let nieuw = match tag {
            b"glyf" => nieuw_glyf.clone(),
            b"loca" => nieuw_loca.clone(),
            b"head" => nieuw_head.clone(),
            // Alleen de gebruikte tekens: printpdf leidt daaruit de breedtes
            // (W) en de ToUnicode-tabel af, die anders elk teken van het
            // lettertype noemen.
            b"cmap" => nieuw_cmap.clone(),
            // post versie 3: dezelfde kop van 32 bytes, zonder glyphnamen.
            b"post" if data.len() >= 32 => {
                let mut p = data[..32].to_vec();
                p[0..4].copy_from_slice(&0x0003_0000u32.to_be_bytes());
                p
            }
            _ => data.to_vec(),
        };
        uit.push((*tag, nieuw));
    }
    uit.sort_by(|a, b| a.0.cmp(&b.0));

    // Opbouwen: kop, directory, tabellen op 4 bytes uitgelijnd.
    let n = uit.len() as u16;
    let mut macht = 1u16;
    let mut log = 0u16;
    while macht * 2 <= n { macht *= 2; log += 1; }
    let mut bytes: Vec<u8> = Vec::new();
    bytes.extend_from_slice(font.get(0..4)?);
    bytes.extend_from_slice(&n.to_be_bytes());
    bytes.extend_from_slice(&(macht * 16).to_be_bytes());
    bytes.extend_from_slice(&log.to_be_bytes());
    bytes.extend_from_slice(&(n * 16 - macht * 16).to_be_bytes());
    let mut offset = 12 + 16 * uit.len();
    let mut head_offset = None;
    for (tag, data) in &uit {
        bytes.extend_from_slice(tag);
        bytes.extend_from_slice(&controlesom(data).to_be_bytes());
        bytes.extend_from_slice(&(offset as u32).to_be_bytes());
        bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
        if tag == b"head" { head_offset = Some(offset); }
        offset += (data.len() + 3) & !3;
    }
    for (_, data) in &uit {
        bytes.extend_from_slice(data);
        while bytes.len() % 4 != 0 { bytes.push(0); }
    }
    let aanpassing = 0xB1B0_AFBAu32.wrapping_sub(controlesom(&bytes));
    let h = head_offset?;
    bytes.get_mut(h + 8..h + 12)?.copy_from_slice(&aanpassing.to_be_bytes());

    // Controle: de subset moet te lezen zijn en dezelfde glyph-nummers geven.
    let proef = ttf_parser::Face::parse(&bytes, 0).ok()?;
    if proef.number_of_glyphs() != face.number_of_glyphs() { return None; }
    for &c in tekens {
        if proef.glyph_index(c) != face.glyph_index(c) { return None; }
    }
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FONT: &[u8] = include_bytes!("../../report/fonts/LiberationSans-Regular.ttf");

    #[test]
    fn subset_houdt_glyphnummers_en_omtrekken_en_is_veel_kleiner() {
        let tekens: BTreeSet<char> = "Toets UC = 0,642 ≤ 1,0 — Ü é".chars().collect();
        let sub = subset_ttf(FONT, &tekens).expect("subset");
        assert!(sub.len() * 4 < FONT.len(), "{} → {}", FONT.len(), sub.len());
        let oud = ttf_parser::Face::parse(FONT, 0).unwrap();
        let nieuw = ttf_parser::Face::parse(&sub, 0).unwrap();
        assert_eq!(nieuw.number_of_glyphs(), oud.number_of_glyphs());
        assert_eq!(nieuw.units_per_em(), oud.units_per_em());
        struct Teller(usize);
        impl ttf_parser::OutlineBuilder for Teller {
            fn move_to(&mut self, _: f32, _: f32) { self.0 += 1; }
            fn line_to(&mut self, _: f32, _: f32) { self.0 += 1; }
            fn quad_to(&mut self, _: f32, _: f32, _: f32, _: f32) { self.0 += 1; }
            fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, _: f32, _: f32) { self.0 += 1; }
            fn close(&mut self) {}
        }
        for c in tekens.iter().copied().filter(|c| !c.is_whitespace()) {
            let g = oud.glyph_index(c).unwrap();
            assert_eq!(nieuw.glyph_index(c), Some(g), "{c:?}");
            assert_eq!(nieuw.glyph_hor_advance(g), oud.glyph_hor_advance(g), "{c:?}");
            let (mut a, mut b) = (Teller(0), Teller(0));
            oud.outline_glyph(g, &mut a);
            nieuw.outline_glyph(g, &mut b);
            assert!(a.0 > 0 && a.0 == b.0, "{c:?}: {} vs {}", a.0, b.0);
        }
        // Een ongebruikt teken: niet meer in de cmap; zijn glyph houdt nummer
        // en breedte, maar geen omtrek.
        let g = oud.glyph_index('Q').unwrap();
        assert_eq!(nieuw.glyph_index('Q'), None);
        assert_eq!(nieuw.glyph_hor_advance(g), oud.glyph_hor_advance(g));
        assert!(nieuw.outline_glyph(g, &mut Teller(0)).is_none());
        // De controlesom van het hele bestand klopt (0xB1B0AFBA).
        assert_eq!(controlesom(&sub), 0xB1B0_AFBA);
    }

    #[test]
    fn samengestelde_glyph_houdt_haar_onderdelen() {
        // In Liberation Sans is 'Ü' samengesteld uit 'U' en het trema.
        let oud = ttf_parser::Face::parse(FONT, 0).unwrap();
        let sub = subset_ttf(FONT, &BTreeSet::from(['Ü'])).expect("subset");
        let nieuw = ttf_parser::Face::parse(&sub, 0).unwrap();
        struct Teller(usize);
        impl ttf_parser::OutlineBuilder for Teller {
            fn move_to(&mut self, _: f32, _: f32) { self.0 += 1; }
            fn line_to(&mut self, _: f32, _: f32) { self.0 += 1; }
            fn quad_to(&mut self, _: f32, _: f32, _: f32, _: f32) { self.0 += 1; }
            fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, _: f32, _: f32) { self.0 += 1; }
            fn close(&mut self) {}
        }
        let g = oud.glyph_index('Ü').unwrap();
        let (mut a, mut b) = (Teller(0), Teller(0));
        oud.outline_glyph(g, &mut a);
        nieuw.outline_glyph(g, &mut b);
        assert!(a.0 > 0 && a.0 == b.0, "{} vs {}", a.0, b.0);
    }
}
