import { useState } from 'preact/hooks';
import type { LayerAnim, Preset, PresetScope } from '../shared/anim';
import { parsePresets } from '../shared/anim';
import { BUILTIN_PRESETS } from '../shared/builtin-presets';
import type { UiMessage } from '../shared/messages';
import { download } from './package';

const SCOPE_LABELS: Record<PresetScope, string> = {
  file: 'Команда (у цьому файлі)',
  mine: 'Мої (на цьому компʼютері)',
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
    props.onStatus(`Пресет «${name.trim()}» збережено.`);
    setName('');
  };

  const exportJson = () => {
    const json = JSON.stringify({ app: 'banner-export', presets: [...presets.file, ...presets.mine] }, null, 2);
    download(new TextEncoder().encode(json), 'banner-presets.json', 'application/json');
  };

  const importJson = async (file: File) => {
    const list = parsePresets(await file.text());
    if (list.length === 0) {
      props.onStatus('У файлі немає пресетів анімації.', true);
      return;
    }
    send({ type: 'save-presets', scope, presets: list });
    props.onStatus(`Імпортовано пресетів: ${list.length}.`);
  };

  const group = (title: string, list: Preset[], deletable: PresetScope | null) => (
    <div class="preset-group">
      <h3>{title}</h3>
      {list.length === 0 ? (
        <p class="muted small">Поки порожньо.</p>
      ) : (
        list.map((p) => (
          <div class="preset">
            <span class="preset-name" title={p.name}>
              {p.name}
            </span>
            <span class="preset-kinds">
              {(['intro', 'custom', 'loop', 'hover', 'outro'] as const).map((k) => p.anim[k] && <span class={`dot ${k}`} />)}
            </span>
            <button class="small" disabled={selectedCount === 0} onClick={() => props.onApply(p.anim, p.name)} title={selectedCount === 0 ? 'Спершу виділіть шар' : ''}>
              Застосувати
            </button>
            {deletable && (
              <button class="icon" title="Видалити пресет" onClick={() => send({ type: 'delete-preset', scope: deletable, id: p.id })}>
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
          ? 'Виділіть шар, щоб застосувати пресет.'
          : selectedCount === 1
            ? 'Пресет замінить анімацію вибраного шару.'
            : `Пресет замінить анімацію ${selectedCount} виділених шарів.`}
      </p>
      {group('Стартові', BUILTIN_PRESETS, null)}
      {group(SCOPE_LABELS.file, presets.file, 'file')}
      {group(SCOPE_LABELS.mine, presets.mine, 'mine')}

      <div class="save-preset">
        <h3>Зберегти анімацію шару як пресет</h3>
        <input placeholder={current ? 'Назва, наприклад «CTA весна»' : 'У вибраного шару немає анімації'} value={name} disabled={!current} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <div class="row">
          <select value={scope} onChange={(e) => setScope(e.currentTarget.value as PresetScope)}>
            <option value="file">{SCOPE_LABELS.file}</option>
            <option value="mine">{SCOPE_LABELS.mine}</option>
          </select>
          <button class="fit" disabled={!current || !name.trim()} onClick={save}>
            Зберегти
          </button>
        </div>
      </div>
      <div class="row tight">
        <button class="link" disabled={presets.file.length + presets.mine.length === 0} onClick={exportJson}>
          Експорт JSON
        </button>
        <label class="link-file">
          Імпорт JSON
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
      <p class="muted small">Імпорт додає пресети у групу, вибрану вище. Через JSON пресети можна передати в інший файл Figma.</p>
    </section>
  );
}
