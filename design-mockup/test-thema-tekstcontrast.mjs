// Bewaakt de leesbaarheid van gewone tekst in alle donkere thema's. De
// transparante tokenkleuren worden over hun daadwerkelijke achtergrond gemengd
// voordat de WCAG-contrastverhouding wordt berekend.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./src/themes.css', import.meta.url), 'utf8');
const themes = ['forge', 'openaec', 'blueprint', 'contrast'];

function theme(name) {
  const start = css.indexOf(`[data-theme="${name}"] {`);
  assert.ok(start >= 0, `thema ${name} ontbreekt`);
  return css.slice(start, css.indexOf('\n}', start));
}

function token(block, name) {
  const value = new RegExp(`--theme-${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  assert.ok(value, `token ${name} ontbreekt`);
  return value;
}

function color(value) {
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    assert.equal(hex.length, 6);
    return [...hex.matchAll(/../g)].map(([pair]) => parseInt(pair, 16)).concat(1);
  }
  const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  assert.ok(match, `onbekende kleur ${value}`);
  return match.slice(1).map(Number);
}

function on(foreground, background) {
  const [r, g, b, alpha] = color(foreground);
  const bg = color(background);
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
  const b = luminance(color(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const name of themes) {
  const block = theme(name);
  assert.match(block, /color-scheme:\s*dark;/, `${name}: browsercontrols moeten donker zijn`);
  for (const text of ['text-secondary', 'text-muted', 'text-faint']) {
    const ratio = contrast(token(block, text), token(block, 'bg'));
    assert.ok(ratio >= 4.5, `${name} ${text}: contrast ${ratio.toFixed(2)} < 4,5`);
  }
  for (const text of ['placeholder-heading', 'placeholder-text']) {
    const ratio = contrast(token(block, text), token(block, 'content-bg'));
    assert.ok(ratio >= 4.5, `${name} ${text}: contrast ${ratio.toFixed(2)} < 4,5`);
  }
  const dialog = contrast(token(block, 'dialog-content-secondary'), token(block, 'dialog-content-bg'));
  assert.ok(dialog >= 4.5, `${name} dialoogtekst: contrast ${dialog.toFixed(2)} < 4,5`);
  for (const [text, background] of [
    ['accent', 'bg-lighter'],
    ['accent-tint', 'bg-lighter'],
    ['ribbon-group-label', 'bg-lighter'],
    ['status-text-label', 'status-bg'],
    ['backstage-item-shortcut-hover', 'bg-lighter'],
    ['dialog-header-text', 'dialog-header-bg'],
    ['accent-text', 'accent'],
  ]) {
    const ratio = contrast(token(block, text), token(block, background));
    assert.ok(ratio >= 4.5, `${name} ${text} op ${background}: contrast ${ratio.toFixed(2)} < 4,5`);
  }
}

console.log(`${themes.length} donkere thema's: tekstcontrast ≥ 4,5:1`);
