// Bewaakt de leesbaarheid van gewone tekst in alle donkere thema's. De
// transparante tokenkleuren worden over hun daadwerkelijke achtergrond gemengd
// voordat de WCAG-contrastverhouding wordt berekend.
//
// Sinds ontwerp 0.4 (OpenAEC Blueprint) staan de kleuren niet meer per
// `[data-theme=…]` in themes.css, maar in `openaec/openaec-tokens.css` per
// `[data-oa-theme=…]`; themes.css koppelt de `--theme-*`-namen eraan. De test
// rekent daarom met `scripts/thema-tokens.mjs`, die dezelfde cascade doorloopt
// als de browser. De donkere thema's van 0.4 zijn dark, blueprint en
// high-contrast-dark (2026.42: forge, openaec, blueprint, contrast); de eisen
// zijn dezelfde, met één verschuiving in betekenis:
//
//   `--theme-accent` is in 0.4 `--oa-accent`, een VULKLEUR (knoppen, actieve
//   tab) met `--oa-text-on-accent` erop. Voor accenttekst heeft 0.4 een eigen
//   token, `--oa-accent-text` (bij ons `--theme-accent-tint`). De eis 4,5:1 voor
//   tekst geldt dus voor `accent-tint`; voor de vulkleur `accent` geldt de eis
//   voor niet-tekstuele onderdelen, 3:1 (WCAG 2.1, 1.4.11).
import assert from 'node:assert/strict';
import { THEMAS, themaTokens, kleur } from './scripts/thema-tokens.mjs';

const themes = THEMAS.filter((t) => themaTokens(t).get('color-scheme') === 'dark');
assert.deepEqual(themes, ['dark', 'blueprint', 'high-contrast-dark'], 'de donkere thema\'s van ontwerp 0.4');

function on(foreground, background) {
  const [r, g, b, alpha] = kleur(foreground);
  const bg = kleur(background);
  return [r, g, b].map((channel, i) => channel * alpha + bg[i] * (1 - alpha));
}

function luminance(rgb) {
  const linear = rgb.map((channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const a = luminance(on(foreground, background));
  const b = luminance(kleur(background).slice(0, 3));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const name of themes) {
  const tokens = themaTokens(name);
  const token = (n) => {
    const v = tokens.get(`--theme-${n}`);
    assert.ok(v, `${name}: token ${n} ontbreekt`);
    return v;
  };
  for (const text of ['text-secondary', 'text-muted', 'text-faint']) {
    const ratio = contrast(token(text), token('bg'));
    assert.ok(ratio >= 4.5, `${name} ${text}: contrast ${ratio.toFixed(2)} < 4,5`);
  }
  for (const text of ['placeholder-heading', 'placeholder-text']) {
    const ratio = contrast(token(text), token('content-bg'));
    assert.ok(ratio >= 4.5, `${name} ${text}: contrast ${ratio.toFixed(2)} < 4,5`);
  }
  const dialog = contrast(token('dialog-content-secondary'), token('dialog-content-bg'));
  assert.ok(dialog >= 4.5, `${name} dialoogtekst: contrast ${dialog.toFixed(2)} < 4,5`);
  for (const [text, background] of [
    ['accent-tint', 'bg-lighter'],
    ['ribbon-group-label', 'bg-lighter'],
    ['status-text-label', 'status-bg'],
    ['backstage-item-shortcut-hover', 'bg-lighter'],
    ['dialog-header-text', 'dialog-header-bg'],
    ['accent-text', 'accent'],
    ['ribbon-btn-active-text', 'ribbon-btn-active-bg'],
    ['dialog-tab-active-text', 'dialog-tab-active-bg'],
  ]) {
    const ratio = contrast(token(text), token(background));
    assert.ok(ratio >= 4.5, `${name} ${text} op ${background}: contrast ${ratio.toFixed(2)} < 4,5`);
  }
  const vlak = contrast(token('accent'), token('bg-lighter'));
  assert.ok(vlak >= 3, `${name} accentvlak op bg-lighter: contrast ${vlak.toFixed(2)} < 3`);
}

console.log(`${themes.length} donkere thema's: tekstcontrast ≥ 4,5:1`);
