import type { NativeCrackWidthInput } from "./nativeFemClient";

export type CrackWidthInputText = Record<keyof NativeCrackWidthInput, string>;

export const CRACK_WIDTH_INPUT_FIELDS: ReadonlyArray<{
  key: keyof NativeCrackWidthInput;
  labelKey: string;
  unit: string;
  optional?: boolean;
}> = [
  { key: "sigmaSMpa", labelKey: "crackSigmaS", unit: "MPa" },
  { key: "widthMm", labelKey: "crackWidthSection", unit: "mm" },
  { key: "heightMm", labelKey: "crackHeight", unit: "mm" },
  { key: "effectiveDepthMm", labelKey: "crackEffectiveDepth", unit: "mm" },
  { key: "neutralAxisMm", labelKey: "crackNeutralAxis", unit: "mm" },
  { key: "bondedReinforcementAreaMm2", labelKey: "crackAs", unit: "mm²", optional: true },
  { key: "effectiveBondedPrestressingAreaMm2", labelKey: "crackApEffective", unit: "mm²", optional: true },
  { key: "coverToLongitudinalSteelMm", labelKey: "crackCover", unit: "mm" },
  { key: "barOrTendonDiameterMm", labelKey: "crackBarDiameter", unit: "mm" },
  { key: "spacingMm", labelKey: "crackSpacing", unit: "mm", optional: true },
  { key: "fCkMpa", labelKey: "crackFck", unit: "MPa" },
  { key: "fCtEffMpa", labelKey: "crackFctEff", unit: "MPa" },
  { key: "eCmMpa", labelKey: "crackEcm", unit: "MPa" },
  { key: "kT", labelKey: "crackKt", unit: "–" },
  { key: "k1", labelKey: "crackK1", unit: "–" },
  { key: "k2", labelKey: "crackK2", unit: "–" },
  { key: "wMaxMm", labelKey: "crackWmax", unit: "mm" },
];

export const INITIAL_CRACK_WIDTH_INPUT_TEXT = Object.fromEntries(
  CRACK_WIDTH_INPUT_FIELDS.map(({ key }) => [key, ""]),
) as CrackWidthInputText;

export function buildCrackWidthInput(text: CrackWidthInputText): NativeCrackWidthInput {
  const input: Partial<NativeCrackWidthInput> = {};
  for (const { key, optional } of CRACK_WIDTH_INPUT_FIELDS) {
    const raw = text[key].trim();
    if (!raw && optional) continue;
    if (!raw) throw new Error("Vul alle verplichte waarden van de gescheurde doorsnede in.");
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error("Alle scheurwijdtewaarden moeten eindig zijn.");
    input[key] = value;
  }
  const bondedBars = input.bondedReinforcementAreaMm2 ?? 0;
  const effectiveTendons = input.effectiveBondedPrestressingAreaMm2 ?? 0;
  if (bondedBars < 0 || effectiveTendons < 0) {
    throw new Error("Hechtende wapeningsoppervlakken mogen niet negatief zijn.");
  }
  if (bondedBars <= 0 && effectiveTendons <= 0) {
    throw new Error("Vul een positief hechtend betonstaal- of effectief voorspanstaaloppervlak in.");
  }
  if (input.spacingMm !== undefined && input.spacingMm <= 0) {
    throw new Error("De opgegeven steek van de langswapening moet positief zijn.");
  }
  return input as NativeCrackWidthInput;
}
