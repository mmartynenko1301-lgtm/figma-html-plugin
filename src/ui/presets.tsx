import { useState } from 'preact/hooks';
import type { LayerAnim, Preset, PresetScope } from '../shared/anim';
import { parsePresets } from '../shared/anim';
import { BUILTIN_PRESETS } from '../shared/builtin-presets';
import type { UiMessage } from '../shared/messages';
import { download } from './package';
import { t } from '../shared/i18n';

const SCOPE_LABELS: Record<PresetScope, string> = {
  get file() {
    return t('Команда (у цьому файлі)', 'Team (in this file)');
  },
  get mine() {
    return t('Мої (на цьому компʼютері)', 'Mine (on this computer)');
  },
};

/**
 * Saved animations: apply one to the selected layers, save the current layer's
 * animation, delete, and move presets between files as JSON.
 */
export function Presets(props: {
  presets: Record<PresetScope, Preset[]>;
  /** Animation of the edited layer, or null when it has none. */
  current: LayerAnim | null;
  selectedCount: number;
  onApply: (anim: LayerAnim, name: string) => void;
  send: (message: UiMessage) => void;
  onStatus: (text: string, error?: boolean) => void;
}) {
  const { presets, current, selectedCount, send } = props;
  const [name, setName] = useState('');
  const [scope, setScope] = useState<PresetScope>('file');

  const save = () => {
    if (!current || !name.trim()) return;
    send({ type: 'save-presets', scope, presets: [{ id: `p${Date.now().toString(36)}`, name: name.trim(), anim: current }] });
    props.onStatus(t(`Пресет «${name.trim()}» збережено.`, `Preset “${name.trim()}” saved.`));
    setName('');
  };

  const exportJson = () => {
    const json = JSON.stringify({ app: 'banner-export', presets: [...presets.file, ...presets.mine] }, null, 2);
    download(new TextEncoder().encode(json), 'banner-presets.json', 'application/json');
  };

  const importJson = async (file: File) => {
    const list = parsePresets(await file.text());
    if (list.length === 0) {
      props.onStatus(t('У файлі немає пресетів анімації.', 'The file has no animation presets.'), true);
      return;
    }
    send({ type: 'save-presets', scope, presets: list });
    props.onStatus(t(`Імпортовано пресетів: ${list.length}.`, `Presets imported: ${list.length}.`));
  };

  const group = (title: string, list: Preset[], deletable: PresetScope | null) => (
    <div class="preset-group">
      <h3>{title}</h3>
      {list.length === 0 ? (
        <p class="muted small">{t('Поки порожньо.', 'Empty for now.')}</p>
      ) : (
        list.map((p) => (
          <div class="preset">
            <span class="preset-name" title={p.name}>
              {p.name}
            </span>
            <span class="preset-kinds">
              {(['intro', 'custom', 'loop', 'hover', 'outro'] as const).map((k) => p.anim[k] && <span class={`dot ${k}`} />)}
            </span>
            <button class="small" disabled={selectedCount === 0} onClick={() => props.onApply(p.anim, p.name)} title={selectedCount === 0 ? t('Спершу виділіть шар', 'Select a layer first') : ''}>
              {t('Застосувати', 'Apply')}
            </button>
            {deletable && (
              <button class="icon" title={t('Видалити пресет', 'Delete preset')} onClick={() => send({ type: 'delete-preset', scope: deletable, id: p.id })}>
                ✕
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );

  return (
    <section>
      <p class="muted small">
        {selectedCount === 0
          ? t('Виділіть шар, щоб застосувати пресет.', 'Select a layer to apply a preset.')
          : selectedCount === 1
            ? t('Пресет замінить анімацію вибраного шару.', 'The preset replaces the animation of the selected layer.')
            : t(`Пресет замінить анімацію ${selectedCount} виділених шарів.`, `The preset replaces the animation of ${selectedCount} selected layers.`)}
      </p>
      {group(t('Стартові', 'Starter'), BUILTIN_PRESETS, null)}
      {group(SCOPE_LABELS.file, presets.file, 'file')}
      {group(SCOPE_LABELS.mine, presets.mine, 'mine')}

      <div class="save-preset">
        <h3>{t('Зберегти анімацію шару як пресет', 'Save layer animation as a preset')}</h3>
        <input placeholder={current ? t('Назва, наприклад «CTA весна»', 'Name, e.g. “Spring CTA”') : t('У вибраного шару немає анімації', 'The selected layer has no animation')} value={name} disabled={!current} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <div class="row">
          <select value={scope} onChange={(e) => setScope(e.currentTarget.value as PresetScope)}>
            <option value="file">{SCOPE_LABELS.file}</option>
            <option value="mine">{SCOPE_LABELS.mine}</option>
          </select>
          <button class="fit" disabled={!current || !name.trim()} onClick={save}>
            {t('Зберегти', 'Save')}
          </button>
        </div>
      </div>
      <div class="row tight">
        <button class="link" disabled={presets.file.length + presets.mine.length === 0} onClick={exportJson}>
          {t('Експорт JSON', 'Export JSON')}
        </button>
        <label class="link-file">
          {t('Імпорт JSON', 'Import JSON')}
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) void importJson(file);
            }}
          />
        </label>
      </div>
      <p class="muted small">{t('Імпорт додає пресети у групу, вибрану вище. Через JSON пресети можна передати в інший файл Figma.', 'Import adds presets to the group chosen above. JSON lets you move presets to another Figma file.')}</p>
    </section>
  );
}
