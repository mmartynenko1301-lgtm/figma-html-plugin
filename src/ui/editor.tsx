import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { HoverAnim, IntroAnim, LayerAnim, LoopAnim, OutroAnim } from '../shared/anim';
import {
  HOVER_PRESETS,
  INTRO_PRESETS,
  LOOP_PRESETS,
  OUTRO_PRESETS,
  defaultCustom,
  defaultHover,
  defaultIntro,
  defaultLoop,
  defaultOutro,
  emptyAnim,
  isSplitPreset,
} from '../shared/anim';
import type { LayerInfo } from '../shared/messages';
import { EasingField, NumberField } from './fields';
import { KeyframesBody } from './keyframes';
import { HOVER_LABELS, INTRO_LABELS, LOOP_LABELS, OUTRO_LABELS, hoverAmountLabel, introAmountLabel, loopAmountLabel, outroAmountLabel } from './labels';
import { t } from '../shared/i18n';

type Kind = 'intro' | 'custom' | 'loop' | 'hover' | 'outro';

const KINDS: { kind: Kind; readonly title: string; readonly hint: string }[] = [
  {
    kind: 'intro',
    get title() {
      return t('Поява', 'Intro');
    },
    get hint() {
      return t('як шар зʼявляється', 'how the layer appears');
    },
  },
  {
    kind: 'custom',
    get title() {
      return t('Ключові кадри', 'Keyframes');
    },
    get hint() {
      return t('свій рух по кадрах', 'your own motion by frames');
    },
  },
  {
    kind: 'loop',
    get title() {
      return t('Цикл', 'Loop');
    },
    get hint() {
      return t('повторюваний рух', 'repeating motion');
    },
  },
  {
    kind: 'hover',
    title: 'Hover',
    get hint() {
      return t('реакція на курсор', 'reaction to the cursor');
    },
  },
  {
    kind: 'outro',
    get title() {
      return t('Зникнення', 'Outro');
    },
    get hint() {
      return t('як шар зникає', 'how the layer leaves');
    },
  },
];

/** What a newly added animation of each kind starts as. */
function defaultsFor(kind: Kind, isText: boolean): Partial<LayerAnim> {
  switch (kind) {
    case 'intro':
      return { intro: defaultIntro(isText ? 'wordsUp' : 'slideUp') };
    case 'custom':
      return { custom: defaultCustom() };
    case 'loop':
      return { loop: defaultLoop('pulse') };
    case 'hover':
      return { hover: defaultHover('grow') };
    case 'outro':
      return { outro: defaultOutro('fadeOut') };
  }
}

/** Editor for the first selected layer: one card per animation it has, and buttons to add the rest. */
export function LayerEditor(props: {
  layer: LayerInfo;
  selectedCount: number;
  canPaste: boolean;
  onChange: (anim: LayerAnim) => void;
  onCopy: () => void;
  onPaste: () => void;
}) {
  const { layer, onChange } = props;
  const anim = layer.anim ?? emptyAnim();
  const set = (patch: Partial<LayerAnim>) => onChange({ ...anim, ...patch });
  const isText = layer.type === 'TEXT';
  const active = KINDS.filter((k) => anim[k.kind]);
  const missing = KINDS.filter((k) => !anim[k.kind]);

  return (
    <section class="editor">
      <div class="row between">
        <h2 title={layer.name}>{layer.name}</h2>
        <div class="row tight">
          <button class="icon" title={t('Копіювати анімацію', 'Copy animation')} onClick={props.onCopy} disabled={!layer.anim}>
            ⧉
          </button>
          <button class="icon" title={props.selectedCount > 1 ? t(`Вставити на ${props.selectedCount} шари`, `Paste to ${props.selectedCount} layers`) : t('Вставити анімацію', 'Paste animation')} onClick={props.onPaste} disabled={!props.canPaste}>
            ⎘{props.selectedCount > 1 ? ` ${props.selectedCount}` : ''}
          </button>
          <button class="icon" title={t('Прибрати всі анімації шару', 'Remove all animations of the layer')} onClick={() => onChange(emptyAnim())} disabled={!layer.anim}>
            ⌫
          </button>
        </div>
      </div>
      {props.selectedCount > 1 && <p class="muted small">{t(`Виділено шарів: ${props.selectedCount}. Редагується перший, «Вставити» копіює анімацію на всі.`, `${props.selectedCount} layers selected. The first one is edited; Paste copies the animation to all.`)}</p>}

      {active.map(({ kind, title }) => (
        <Card key={kind} kind={kind} title={title} onRemove={() => set({ [kind]: null })}>
          {kind === 'intro' && <IntroFields intro={anim.intro!} isText={isText} onChange={(intro) => set({ intro })} />}
          {kind === 'custom' && <KeyframesBody value={anim.custom!} onChange={(custom) => set({ custom })} />}
          {kind === 'loop' && <LoopFields loop={anim.loop!} afterIntro={!!anim.intro} onChange={(loop) => set({ loop })} />}
          {kind === 'hover' && <HoverFields hover={anim.hover!} onChange={(hover) => set({ hover })} />}
          {kind === 'outro' && <OutroFields outro={anim.outro!} onChange={(outro) => set({ outro })} />}
        </Card>
      ))}

      {missing.length > 0 && (
        <div class="add">
          {active.length === 0 && <p class="muted small">{t('У шару ще немає анімації. Додайте:', 'This layer has no animation yet. Add:')}</p>}
          <div class="chips">
            {missing.map(({ kind, title, hint }) => (
              <button class={`chip ${kind}`} title={hint} onClick={() => set(defaultsFor(kind, isText))}>
                + {title}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Card(props: { kind: Kind; title: string; onRemove: () => void; children: ComponentChildren }) {
  const [open, setOpen] = useState(true);
  return (
    <div class={`card ${props.kind}${open ? '' : ' closed'}`}>
      <div class="card-head" onClick={() => setOpen(!open)}>
        <span class="dot" />
        <strong>{props.title}</strong>
        <span class="caret">{open ? '▾' : '▸'}</span>
        <button
          class="icon"
          title={t('Прибрати', 'Remove')}
          onClick={(e) => {
            e.stopPropagation();
            props.onRemove();
          }}
        >
          ✕
        </button>
      </div>
      {open && <div class="card-body">{props.children}</div>}
    </div>
  );
}

function IntroFields(props: { intro: IntroAnim; isText: boolean; onChange: (intro: IntroAnim) => void }) {
  const { intro, onChange } = props;
  const set = (patch: Partial<IntroAnim>) => onChange({ ...intro, ...patch });
  const amountLabel = introAmountLabel(intro.preset);
  return (
    <>
      <select value={intro.preset} onChange={(e) => onChange({ ...defaultIntro(e.currentTarget.value as IntroAnim['preset']), delay: intro.delay })}>
        {INTRO_PRESETS.filter((p) => props.isText || !isSplitPreset(p)).map((p) => (
          <option value={p}>{INTRO_LABELS[p]}</option>
        ))}
      </select>
      <div class="grid">
        <NumberField label={t('Затримка, с', 'Delay, s')} value={intro.delay} step={0.1} onChange={(v) => set({ delay: v })} />
        <NumberField label={t('Тривалість, с', 'Duration, s')} value={intro.duration} step={0.1} min={0.05} onChange={(v) => set({ duration: v })} />
        <EasingField value={intro.easing} onChange={(easing) => set({ easing })} />
        {amountLabel && (
          <NumberField
            label={amountLabel}
            value={intro.amount}
            step={intro.preset === 'scaleIn' || intro.preset === 'zoomOut' ? 0.05 : 2}
            onChange={(v) => set({ amount: v })}
          />
        )}
        {isSplitPreset(intro.preset) && (
          <NumberField label={intro.preset === 'wordsUp' ? t('Крок між словами, с', 'Step between words, s') : t('Крок між літерами, с', 'Step between letters, s')} value={intro.stagger} step={0.01} onChange={(v) => set({ stagger: v })} />
        )}
      </div>
    </>
  );
}

function LoopFields(props: { loop: LoopAnim; afterIntro: boolean; onChange: (loop: LoopAnim) => void }) {
  const { loop, onChange } = props;
  const set = (patch: Partial<LoopAnim>) => onChange({ ...loop, ...patch });
  return (
    <>
      <select value={loop.preset} onChange={(e) => onChange(defaultLoop(e.currentTarget.value as LoopAnim['preset']))}>
        {LOOP_PRESETS.map((p) => (
          <option value={p}>{LOOP_LABELS[p]}</option>
        ))}
      </select>
      <div class="grid">
        <NumberField label={props.afterIntro ? t('Старт після появи, с', 'Start after intro, s') : t('Старт, с', 'Start, s')} value={loop.delay} step={0.1} onChange={(v) => set({ delay: v })} />
        <NumberField label={t('Рух, с', 'Motion, s')} value={loop.duration} step={0.1} min={0.05} onChange={(v) => set({ duration: v })} />
        <NumberField label={t('Пауза, с', 'Pause, s')} value={loop.pause} step={0.1} onChange={(v) => set({ pause: v })} />
        <NumberField
          label={loopAmountLabel(loop.preset)}
          value={loop.amount}
          step={loop.preset === 'pulse' || loop.preset === 'shine' ? 0.01 : 1}
          onChange={(v) => set({ amount: v })}
        />
      </div>
    </>
  );
}

function HoverFields(props: { hover: HoverAnim; onChange: (hover: HoverAnim) => void }) {
  const { hover, onChange } = props;
  const set = (patch: Partial<HoverAnim>) => onChange({ ...hover, ...patch });
  return (
    <>
      <select value={hover.preset} onChange={(e) => onChange({ ...defaultHover(e.currentTarget.value as HoverAnim['preset']), trigger: hover.trigger })}>
        {HOVER_PRESETS.map((p) => (
          <option value={p}>{HOVER_LABELS[p]}</option>
        ))}
      </select>
      <div class="segmented">
        <button class={hover.trigger === 'banner' ? 'on' : ''} onClick={() => set({ trigger: 'banner' })}>
          {t('Курсор над банером', 'Over banner')}
        </button>
        <button class={hover.trigger === 'layer' ? 'on' : ''} onClick={() => set({ trigger: 'layer' })}>
          {t('Курсор над шаром', 'Over layer')}
        </button>
      </div>
      <div class="grid">
        <NumberField label={t('Тривалість, с', 'Duration, s')} value={hover.duration} step={0.05} onChange={(v) => set({ duration: v })} />
        <NumberField label={hoverAmountLabel(hover.preset)} value={hover.amount} step={hover.preset === 'lift' ? 1 : 0.01} onChange={(v) => set({ amount: v })} />
      </div>
    </>
  );
}

function OutroFields(props: { outro: OutroAnim; onChange: (outro: OutroAnim) => void }) {
  const { outro, onChange } = props;
  const set = (patch: Partial<OutroAnim>) => onChange({ ...outro, ...patch });
  const amountLabel = outroAmountLabel(outro.preset);
  return (
    <>
      <select value={outro.preset} onChange={(e) => onChange({ ...defaultOutro(e.currentTarget.value as OutroAnim['preset']), at: outro.at })}>
        {OUTRO_PRESETS.map((p) => (
          <option value={p}>{OUTRO_LABELS[p]}</option>
        ))}
      </select>
      <div class="grid">
        <NumberField label={t('Момент, с від старту', 'At, s from start')} value={outro.at} step={0.1} onChange={(v) => set({ at: v })} />
        <NumberField label={t('Тривалість, с', 'Duration, s')} value={outro.duration} step={0.1} min={0.05} onChange={(v) => set({ duration: v })} />
        <EasingField value={outro.easing} onChange={(easing) => set({ easing })} />
        {amountLabel && <NumberField label={amountLabel} value={outro.amount} step={outro.preset === 'zoomAway' ? 0.05 : 2} onChange={(v) => set({ amount: v })} />}
      </div>
    </>
  );
}
