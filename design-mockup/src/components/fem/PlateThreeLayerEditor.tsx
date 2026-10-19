import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Plate, PlateThreeLayerConfiguration } from './femTypes';
import type { PlateResult } from './solver/types';

type Draft = Record<string, string> & { compressionModel: PlateThreeLayerConfiguration['compressionModel'] };

const empty = (): Draft => ({
  topSkinMm: '', bottomSkinMm: '', topAsX: '', topAsY: '', bottomAsX: '', bottomAsY: '',
  fcdMpa: '', fydMpa: '', nuPrime: '', compressionModel: 'blaauwendraad2021',
});

function fromConfig(config?: PlateThreeLayerConfiguration): Draft {
  if (!config) return empty();
  return {
    topSkinMm: String(config.topSkinMm), bottomSkinMm: String(config.bottomSkinMm),
    topAsX: String(config.topAsX), topAsY: String(config.topAsY),
    bottomAsX: String(config.bottomAsX), bottomAsY: String(config.bottomAsY),
    fcdMpa: String(config.fcdMpa), fydMpa: String(config.fydMpa), nuPrime: String(config.nuPrime),
    compressionModel: config.compressionModel,
  };
}

interface Props {
  plate: Plate;
  updatePlate?: (id: number, updates: Partial<Plate>) => void;
  result?: PlateResult;
}

export default function PlateThreeLayerEditor({ plate, updatePlate, result }: Props) {
  const { t } = useTranslation('check');
  const [draft, setDraft] = useState<Draft | null>(plate.threeLayer ? fromConfig(plate.threeLayer) : null);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(plate.threeLayer ? fromConfig(plate.threeLayer) : null);
    setError('');
  }, [plate.id, plate.threeLayer]);

  const apply = () => {
    if (!draft || !updatePlate) return;
    const values = Object.fromEntries([
      'topSkinMm', 'bottomSkinMm', 'topAsX', 'topAsY', 'bottomAsX', 'bottomAsY',
      'fcdMpa', 'fydMpa', 'nuPrime',
    ].map((key) => [key, Number(draft[key])])) as Record<string, number>;
    const positive = ['topSkinMm', 'bottomSkinMm', 'fcdMpa', 'fydMpa', 'nuPrime'];
    const nonnegative = ['topAsX', 'topAsY', 'bottomAsX', 'bottomAsY'];
    if (positive.some((key) => !Number.isFinite(values[key]) || values[key] <= 0)
        || nonnegative.some((key) => !Number.isFinite(values[key]) || values[key] < 0)
        || values.topSkinMm + values.bottomSkinMm >= (plate.thickness ?? 0)
        || values.nuPrime > 1) {
      setError(t('props.plate.threeLayer.invalidSection'));
      return;
    }
    updatePlate(plate.id, { threeLayer: {
      topSkinMm: values.topSkinMm, bottomSkinMm: values.bottomSkinMm,
      topAsX: values.topAsX, topAsY: values.topAsY,
      bottomAsX: values.bottomAsX, bottomAsY: values.bottomAsY,
      fcdMpa: values.fcdMpa, fydMpa: values.fydMpa, nuPrime: values.nuPrime,
      compressionModel: draft.compressionModel,
    } });
    setError('');
  };

  const clear = () => {
    updatePlate?.(plate.id, { threeLayer: undefined });
    setDraft(null);
    setError('');
  };
  const set = (key: string, value: string) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const fields: Array<[string, string, boolean]> = [
    ['topSkinMm', 'topSkin', false], ['bottomSkinMm', 'bottomSkin', false],
    ['topAsX', 'topAsX', true], ['topAsY', 'topAsY', true],
    ['bottomAsX', 'bottomAsX', true], ['bottomAsY', 'bottomAsY', true],
    ['fcdMpa', 'fcd', false], ['fydMpa', 'fyd', false], ['nuPrime', 'nuPrime', false],
  ];
  const checks = result?.elements.flatMap((element) => element.threeLayer ? [element] : []) ?? [];
  const maxUc = Math.max(0, ...checks.flatMap((element) => {
    const c = element.threeLayer!;
    return [c.top.utilizationAsX, c.top.utilizationAsY, c.top.utilizationCompression,
      c.bottom.utilizationAsX, c.bottom.utilizationAsY, c.bottom.utilizationCompression];
  }));
  const exceeded = checks.some((element) => element.threeLayer!.status === 'partial_check_exceeded');
  const inputProps = { type: 'number' as const, step: 'any', className: 'fem-prop-input' };

  return <section className="fem-prop-section">
    <h4 className="fem-prop-section-title">{t('props.plate.threeLayer.title')}</h4>
    <p className="fem-prop-hint">{t('props.plate.threeLayer.scope')}</p>
    {!draft ? <button className="fem-prop-kiezer-btn" type="button" disabled={!updatePlate}
      onClick={() => setDraft(empty())}>{t('props.plate.threeLayer.start')}</button> : <>
      {fields.map(([key, label, allowZero]) => <div className="fem-prop-row" key={key}>
        <span className="fem-prop-label">{t(`props.plate.threeLayer.${label}`)}</span>
        <span className="fem-prop-value"><input {...inputProps} min={allowZero ? 0 : undefined}
          value={draft[key]} onChange={(event) => set(key, event.target.value)} /></span>
      </div>)}
      <div className="fem-prop-row"><span className="fem-prop-label">{t('props.plate.threeLayer.compressionModel')}</span>
        <span className="fem-prop-value"><select className="fem-prop-select" value={draft.compressionModel}
          onChange={(event) => setDraft({ ...draft, compressionModel: event.target.value as Draft['compressionModel'] })}>
          <option value="blaauwendraad2021">Blaauwendraad 2021 · fcd</option>
          <option value="ec2AnnexF">EC2 · Annex F</option>
        </select></span></div>
      <div className="fem-prop-kiezer-row">
        <button className="fem-prop-kiezer-btn" type="button" onClick={apply}>{t('props.plate.threeLayer.apply')}</button>
        <button className="fem-prop-kiezer-btn" type="button" onClick={clear}>{t('props.plate.threeLayer.clear')}</button>
      </div>
    </>}
    {error && <p className="frame3d-check-not-ok" role="alert">{error}</p>}
    {checks.length > 0 && <div className={exceeded ? 'frame3d-check-not-ok' : 'fem-prop-hint'} role="status">
      {t(exceeded ? 'props.plate.threeLayer.exceeded' : 'props.plate.threeLayer.passes',
        { aantal: checks.length, uc: maxUc.toFixed(2) })}
    </div>}
  </section>;
}
