import { useState } from 'preact/hooks';
import type { LayerAnim, Preset, PresetScope } from '../shared/anim';
import { parsePresets } from '../shared/anim';
import type { UiMessage } from '../shared/messages';
import { download } from './package';

const SCOPE_LABELS: Record<PresetScope, string> = {
  file: 'Цей файл (бачить уся команда)',
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
  onApply: (anim: LayerAnim) => void;
  send: (message: UiMessage) => void;
  onStatus: (text: string, error?: boolean) => void;
}) {
  const { presets, current, selectedCount, send } = props;
  const [choice, setChoice] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<PresetScope>('file');

  const all = (['file', 'mine'] as const).flatMap((s) => presets[s].map((p) => ({ scope: s, preset: p })));
  const chosen = all.find((x) => `${x.scope}:${x.preset.id}` === choice) ?? null;

  const save = () => {
    if (!current || !name.trim()) return;
    send({ type: 'save-presets', scope, presets: [{ id: `p${Date.now().toString(36)}`, name: name.trim(), anim: current }] });
    setName('');
  };

  const exportJson = () => {
    const json = JSON.stringify({ app: 'banner-export', presets: presets[scope] }, null, 2);
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

  return (
    <section>
      <h2>Пресети</h2>
      <div class="row">
        <select value={choice} onChange={(e) => setChoice(e.currentTarget.value)}>
          <option value="">{all.length ? 'Виберіть пресет' : 'Пресетів ще немає'}</option>
          {(['file', 'mine'] as const).map(
            (s) =>
              presets[s].length > 0 && (
                <optgroup label={SCOPE_LABELS[s]}>
                  {presets[s].map((p) => (
                    <option value={`${s}:${p.id}`}>{p.name}</option>
                  ))}
                </optgroup>
              ),
          )}
        </select>
        <button class="secondary fit" disabled={!chosen || selectedCount === 0} onClick={() => chosen && props.onApply(chosen.preset.anim)}>
          {selectedCount > 1 ? `Застосувати (${selectedCount})` : 'Застосувати'}
        </button>
        <button
          class="secondary fit"
          title="Видалити пресет"
          disabled={!chosen}
          onClick={() => {
            if (!chosen) return;
            send({ type: 'delete-preset', scope: chosen.scope, id: chosen.preset.id });
            setChoice('');
          }}
        >
          ✕
        </button>
      </div>
      <div class="row">
        <input placeholder="Назва нового пресета" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <button class="secondary fit" disabled={!current || !name.trim()} onClick={save} title={current ? '' : 'У вибраного шару немає анімації'}>
          Зберегти
        </button>
      </div>
      <label>
        Куди зберігати та звідки експортувати
        <select value={scope} onChange={(e) => setScope(e.currentTarget.value as PresetScope)}>
          <option value="file">{SCOPE_LABELS.file}</option>
          <option value="mine">{SCOPE_LABELS.mine}</option>
        </select>
      </label>
      <div class="row tight">
        <button class="link" disabled={presets[scope].length === 0} onClick={exportJson}>
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
      <p class="muted small">Пресет зберігає всю анімацію шару: появу, цикл, hover, зникнення і ключові кадри. JSON-файлом пресети можна передати в інший файл Figma.</p>
    </section>
  );
}
