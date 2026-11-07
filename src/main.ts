/**
 * main.ts — application shell. Builds the species/pose/coat pickers, wires
 * the weight slider to the procedural morph, and routes exports.
 */

import './style.css';
import { KittenViewer, type ViewPreset } from './viewer/KittenViewer';
import { ANIMALS, KITTEN_SPEC, type AnimalSpec } from './animal/registry';
import {
  POSE_ORDER,
  POSE_PARAMS,
  bodyCondition,
  fakeKilograms,
  clamp,
  type PoseId,
} from './animal/profiles';
import { COATS, type CoatId } from './animal/coats';
import {
  HIND_SLIDERS,
  FRONT_SLIDERS,
  legTuningDefaults,
  type TuningSliderSpec,
  type LegTuning,
} from './animal/tuning';
import { BACKDROPS, type BackdropId } from './viewer/backdrop';

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

/* ------------------------------------------------------------------ */
/* Inline SVG artwork                                                  */
/* ------------------------------------------------------------------ */

const stroke =
  'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const POSE_ICONS: Record<PoseId, string> = {
  standing: `<svg viewBox="0 0 24 24"><ellipse cx="9.75" cy="12.3" rx="6.3" ry="3.7" ${stroke}/><circle cx="18.1" cy="7.7" r="2.25" ${stroke}/><path d="M16.5 6.1 15.9 4.1M19.7 6.1l.5-2" ${stroke}/><path d="M5.4 15.4V20M8.8 15.9V20M12.4 15.9V20M15.8 15.2V20" ${stroke}/><path d="M3.7 10.6C2.6 8.4 3.1 6.1 5.3 5.1" ${stroke}/></svg>`,
  sitting: `<svg viewBox="0 0 24 24"><path d="M7.5 19.6c0-4.5 1.1-7.9 4.3-7.9 3 0 5.1 2 5.2 7.9Z" ${stroke}/><circle cx="12.9" cy="6.5" r="2.3" ${stroke}/><path d="M10.9 4.8 10.4 2.8M14.9 4.8l.5-2" ${stroke}/><path d="M4.5 19.6h15" ${stroke}/><path d="M17.2 18.3c2-.3 2.8-2 2-3.7" ${stroke}/></svg>`,
  loaf: `<svg viewBox="0 0 24 24"><path d="M4 15.5c0-3.1 2.5-5 8-5s8 1.9 8 5c0 1.7-1.5 2.7-8 2.7s-8-1-8-2.7Z" ${stroke}/><circle cx="15.4" cy="8.8" r="2.1" ${stroke}/><path d="M13.9 7.3 13.4 5.3M16.8 7.3l.5-2" ${stroke}/><path d="M7.6 17.9h.01M11 17.9h.01" ${stroke}/></svg>`,
  stretch: `<svg viewBox="0 0 24 24"><path d="M2.8 18.2h4.7" ${stroke}/><path d="M6.4 18.2 7 14.1c.6-2.9 2.5-4 5-3.8 2.9.2 4.9 2 5.3 4.6" ${stroke}/><path d="M17.3 15l1.1 3.2" ${stroke}/><circle cx="8.4" cy="13.7" r="1.85" ${stroke}/><path d="M16.6 10.7C17.2 7.3 18.8 5.1 21.3 4.4" ${stroke}/></svg>`,
  curled: `<svg viewBox="0 0 24 24"><circle cx="12" cy="13.1" r="6.8" ${stroke}/><path d="M8.5 16.5c1.6 1.4 4.8 1.6 6.7.3" ${stroke}/><circle cx="12.9" cy="10.5" r="1.55" ${stroke}/><path d="M11.8 9.2 11.5 7.7M14.1 9.2l.3-1.5" ${stroke}/></svg>`,
};

const SPECIES_ICONS: Record<string, string> = {
  kitten: `<svg viewBox="0 0 32 32" ${stroke} stroke-width="1.8"><path d="M8 11.2 9.5 4.6 14.6 7.9a8.3 8.3 0 0 1 2.8 0l5.1-3.3L24 11.2c1.5 1.1 2.3 2.8 2.3 4.7 0 4.4-3.5 6.8-8.3 6.8s-8.3-2.4-8.3-6.8c0-1.9.8-3.6 2.3-4.7Z"/><path d="M12.7 15h.01M19.3 15h.01"/></svg>`,
  puppy: `<svg viewBox="0 0 32 32" ${stroke} stroke-width="1.8"><path d="M9.5 9C6.8 10.2 5.2 14.5 6 20c2.4.4 4.6-1.3 5.2-4.4M22.5 9c2.7 1.2 4.3 5.5 3.5 11-2.4.4-4.6-1.3-5.2-4.4"/><path d="M11.5 12.4c1.4-1.5 3-2.3 4.5-2.3s3.1.8 4.5 2.3c1.6 1.7 2.1 3.9 1.5 6-1.1 3.6-3.5 5.6-6 5.6s-4.9-2-6-5.6c-.6-2.1-.1-4.3 1.5-6Z"/><path d="M13.8 15.6h.01M18.2 15.6h.01"/></svg>`,
  bunny: `<svg viewBox="0 0 32 32" ${stroke} stroke-width="1.8"><ellipse cx="12.4" cy="6.6" rx="1.6" ry="4.4" transform="rotate(-10 12.4 6.6)"/><ellipse cx="19.6" cy="6.6" rx="1.6" ry="4.4" transform="rotate(10 19.6 6.6)"/><circle cx="16" cy="20.5" r="6.3"/><path d="M13.6 20.2h.01M18.4 20.2h.01"/></svg>`,
};

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const canvas = $<HTMLCanvasElement>('#scene');
const stage = $<HTMLDivElement>('#stage');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const viewer = new KittenViewer(canvas, stage, KITTEN_SPEC);

/* ------------------------------------------------------------------ */
/* Toast + downloads                                                   */
/* ------------------------------------------------------------------ */

const toast = $<HTMLDivElement>('#toast');
let toastTimer = 0;
function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------------ */
/* Species picker                                                      */
/* ------------------------------------------------------------------ */

const speciesGrid = $<HTMLDivElement>('#species-grid');
for (const spec of ANIMALS) {
  const button = document.createElement('button');
  button.className = 'species-card' + (spec.id === KITTEN_SPEC.id ? ' is-active' : '');
  button.disabled = spec.locked;
  button.setAttribute('aria-pressed', String(spec.id === KITTEN_SPEC.id));
  button.innerHTML = `
    <span class="species-emoji" aria-hidden="true">${SPECIES_ICONS[spec.id] ?? SPECIES_ICONS.kitten}</span>
    <span class="species-name">${spec.name}</span>
    ${spec.locked ? `<span class="species-lock">${spec.lockNote ?? 'Soon'}</span>` : ''}
  `;
  if (spec.locked) {
    button.title = `${spec.name} is not sculpted yet — kitten only for now.`;
    button.addEventListener('click', () => showToast(`${spec.name} is still in the litter.`));
  } else {
    button.addEventListener('click', () => {
      viewer.setSpecies(spec as AnimalSpec);
      speciesGrid.querySelectorAll('.species-card').forEach((el) => el.classList.remove('is-active'));
      button.classList.add('is-active');
    });
  }
  speciesGrid.appendChild(button);
}

/* ------------------------------------------------------------------ */
/* Pose picker                                                         */
/* ------------------------------------------------------------------ */

const poseGrid = $<HTMLDivElement>('#pose-grid');
const poseButtons = new Map<PoseId, HTMLButtonElement>();
for (const poseId of POSE_ORDER) {
  const params = POSE_PARAMS[poseId];
  const button = document.createElement('button');
  button.className = 'pose-button' + (poseId === KITTEN_SPEC.defaultPose ? ' is-active' : '');
  button.setAttribute('aria-pressed', String(poseId === KITTEN_SPEC.defaultPose));
  button.title = params.tagline;
  button.innerHTML = `${POSE_ICONS[poseId]}<span>${params.label}</span>`;
  button.addEventListener('click', () => setPose(poseId));
  poseGrid.appendChild(button);
  poseButtons.set(poseId, button);
}

function setPose(poseId: PoseId): void {
  viewer.setPose(poseId);
  for (const [id, button] of poseButtons) {
    const active = id === poseId;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  refreshTuningForPose(poseId);
}

/* ------------------------------------------------------------------ */
/* Weight slider + BCS + presets                                       */
/* ------------------------------------------------------------------ */

const slider = $<HTMLInputElement>('#weight-slider');
const weightKg = $<HTMLSpanElement>('#weight-kg');
const weightLabel = $<HTMLDivElement>('#weight-label');
const bcsCaption = $<HTMLSpanElement>('#bcs-caption');
const bcsBar = $<HTMLDivElement>('#bcs-bar');
const presetsRow = $<HTMLDivElement>('#weight-presets');

const BCS_COLORS = (score: number): string =>
  score <= 3 ? 'var(--under)' : score <= 5 ? 'var(--green)' : score <= 7 ? 'var(--over)' : 'var(--obese)';

const bcsSegments: HTMLDivElement[] = [];
for (let i = 0; i < 9; i++) {
  const segment = document.createElement('div');
  segment.className = 'bcs-segment';
  bcsBar.appendChild(segment);
  bcsSegments.push(segment);
}

function weightName(weight: number): string {
  if (weight < 0.8) return 'Skinny';
  if (weight < 0.95) return 'Slim';
  if (weight < 1.1) return 'Average';
  if (weight < 1.28) return 'Chunky';
  if (weight < 1.48) return 'Chonk';
  return 'Mega-chonk';
}

const WEIGHT_PRESETS = [
  { label: 'Skinny', value: 78 },
  { label: 'Slim', value: 90 },
  { label: 'Average', value: 100 },
  { label: 'Chunky', value: 125 },
  { label: 'Chonk', value: 155 },
];
const presetButtons = new Map<number, HTMLButtonElement>();
for (const preset of WEIGHT_PRESETS) {
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.textContent = preset.label;
  chip.addEventListener('click', () => setWeightSlider(preset.value));
  presetsRow.appendChild(chip);
  presetButtons.set(preset.value, chip);
}

function setWeightSlider(sliderValue: number): void {
  const clamped = clamp(Math.round(sliderValue), 65, 170);
  slider.value = String(clamped);
  slider.style.setProperty('--fill', `${((clamped - 65) / 105) * 100}%`);

  const weight = clamped / 100;
  viewer.setWeight(weight);

  weightKg.textContent = fakeKilograms(weight).toFixed(1);
  weightLabel.textContent = weightName(weight);

  const { bcs, label } = bodyCondition(weight);
  bcsCaption.textContent = `BCS ${bcs}/9 · ${label}`;
  bcsBar.setAttribute('aria-label', `Body condition score ${bcs} out of 9, ${label}`);
  bcsSegments.forEach((segment, index) => {
    segment.style.background = index < bcs ? BCS_COLORS(index + 1) : '';
  });

  for (const [value, chip] of presetButtons) {
    chip.classList.toggle('is-active', Math.abs(value - clamped) <= 3);
  }
}

slider.addEventListener('input', () => setWeightSlider(Number(slider.value)));

/* ------------------------------------------------------------------ */
/* Leg tuning — live sliders for limb length + joint angle             */
/* ------------------------------------------------------------------ */

const tuningHind = $<HTMLDivElement>('#tuning-hind');
const tuningFront = $<HTMLDivElement>('#tuning-front');
const tuningReset = $<HTMLButtonElement>('#tuning-reset');
const tuningPoseNote = $<HTMLSpanElement>('#tuning-pose-note');

let activePose: PoseId = KITTEN_SPEC.defaultPose as PoseId;
let tuningState: LegTuning = legTuningDefaults(activePose);

interface TuningRow {
  input: HTMLInputElement;
  value: HTMLSpanElement;
}
const tuningRows = new Map<string, TuningRow>();

const splitTuningKey = (key: string): ['hind' | 'front', string] => {
  const [group, field] = key.split('.');
  return [group as 'hind' | 'front', field];
};

const getTuningValue = (spec: TuningSliderSpec, source: LegTuning): number => {
  const [group, field] = splitTuningKey(spec.key);
  return (source[group] as unknown as Record<string, number>)[field];
};

const formatTuningValue = (spec: TuningSliderSpec, value: number): string =>
  spec.unit === 'cm' ? `${(value * 100).toFixed(1)} cm` : `${value.toFixed(1)}°`;

function paintTuningRow(spec: TuningSliderSpec): void {
  const row = tuningRows.get(spec.key);
  if (!row) return;
  const current = getTuningValue(spec, tuningState);
  row.input.value = String(current);
  row.input.style.setProperty('--fill', `${((current - spec.min) / (spec.max - spec.min)) * 100}%`);
  row.value.textContent = formatTuningValue(spec, current);
}

const ALL_TUNING_SLIDERS = [...HIND_SLIDERS, ...FRONT_SLIDERS];

function buildTuningRow(parent: HTMLElement, spec: TuningSliderSpec): void {
  const row = document.createElement('label');
  row.className = 'tuning-row';
  row.innerHTML = `
    <span class="tuning-row-head">
      <span class="tuning-label">${spec.label}</span>
      <span class="tuning-value"></span>
    </span>
    <input type="range" class="tuning-slider" min="${spec.min}" max="${spec.max}" step="${spec.step}" aria-label="${spec.label}" />`;
  const input = row.querySelector<HTMLInputElement>('.tuning-slider')!;
  const value = row.querySelector<HTMLSpanElement>('.tuning-value')!;
  input.addEventListener('input', () => {
    const next = Number(input.value);
    const [group, field] = splitTuningKey(spec.key);
    (tuningState[group] as unknown as Record<string, number>)[field] = next;
    paintTuningRow(spec);
    tuningPoseNote.textContent = `${POSE_PARAMS[activePose].label.toLowerCase()} · custom`;
    viewer.setTuning(JSON.parse(JSON.stringify(tuningState)) as LegTuning);
  });
  parent.appendChild(row);
  tuningRows.set(spec.key, { input, value });
  paintTuningRow(spec);
}

for (const spec of HIND_SLIDERS) buildTuningRow(tuningHind, spec);
for (const spec of FRONT_SLIDERS) buildTuningRow(tuningFront, spec);

function refreshTuningForPose(poseId: PoseId): void {
  activePose = poseId;
  tuningState = legTuningDefaults(poseId);
  for (const spec of ALL_TUNING_SLIDERS) paintTuningRow(spec);
  tuningPoseNote.textContent = `${POSE_PARAMS[poseId].label.toLowerCase()} · defaults`;
  viewer.setTuning(null);
}

tuningReset.addEventListener('click', () => refreshTuningForPose(activePose));

/* ------------------------------------------------------------------ */
/* Coat picker                                                         */
/* ------------------------------------------------------------------ */

const coatRow = $<HTMLDivElement>('#coat-row');
const coatName = $<HTMLSpanElement>('#coat-name');
const coatButtons = new Map<CoatId, HTMLButtonElement>();
for (const coat of COATS) {
  const button = document.createElement('button');
  button.className = 'coat-swatch' + (coat.id === KITTEN_SPEC.defaultCoat ? ' is-active' : '');
  button.style.background = coat.swatch;
  button.title = coat.name;
  button.setAttribute('aria-label', `Coat: ${coat.name}`);
  button.setAttribute('aria-pressed', String(coat.id === KITTEN_SPEC.defaultCoat));
  button.addEventListener('click', () => setCoat(coat.id));
  coatRow.appendChild(button);
  coatButtons.set(coat.id, button);
}

function setCoat(coatId: CoatId): void {
  viewer.setCoat(coatId);
  coatName.textContent = COATS.find((coat) => coat.id === coatId)?.name ?? '';
  for (const [id, button] of coatButtons) {
    const active = id === coatId;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

/* ------------------------------------------------------------------ */
/* Anatomy — skeleton overlay                                          */
/* ------------------------------------------------------------------ */

const anatomyRow = $<HTMLDivElement>('#anatomy-row');
const anatomyButtons = new Map<string, HTMLButtonElement>();
anatomyRow.querySelectorAll<HTMLButtonElement>('[data-anatomy]').forEach((button) => {
  anatomyButtons.set(button.dataset.anatomy ?? 'off', button);
  button.addEventListener('click', () => setSkeletonMode(button.dataset.anatomy ?? 'off'));
});

function setSkeletonMode(mode: string): void {
  viewer.setSkeletonMode(mode as 'off' | 'overlay' | 'bones-only' | 'weights' | 'skinned');
  for (const [id, button] of anatomyButtons) {
    const active = id === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

/* ------------------------------------------------------------------ */
/* Backdrop picker                                                     */
/* ------------------------------------------------------------------ */

const backdropPicker = $<HTMLDivElement>('#backdrop-picker');
const backdropButtons = new Map<BackdropId, HTMLButtonElement>();
const BACKDROP_DOTS: Record<BackdropId, string> = {
  studio: 'radial-gradient(circle at 50% 35%, #3a322b, #171310)',
  ember: 'radial-gradient(circle at 50% 35%, #462a20, #1a0f0c)',
  midnight: 'radial-gradient(circle at 50% 35%, #272d3d, #10131b)',
  transparent:
    'linear-gradient(45deg, #3a332c 25%, #241f1a 25%, #241f1a 50%, #3a332c 50%, #3a332c 75%, #241f1a 75%)',
};
for (const backdrop of BACKDROPS) {
  const button = document.createElement('button');
  button.className = 'backdrop-dot' + (backdrop.id === 'studio' ? ' is-active' : '');
  button.style.background = BACKDROP_DOTS[backdrop.id];
  button.style.backgroundSize = backdrop.id === 'transparent' ? '8px 8px' : '';
  button.title = `Backdrop: ${backdrop.name}`;
  button.setAttribute('aria-label', `Backdrop: ${backdrop.name}`);
  button.addEventListener('click', () => setBackdrop(backdrop.id));
  backdropPicker.appendChild(button);
  backdropButtons.set(backdrop.id, button);
}

function setBackdrop(backdropId: BackdropId): void {
  viewer.setBackdrop(backdropId);
  stage.className = `backdrop-${backdropId}`;
  for (const [id, button] of backdropButtons) {
    button.classList.toggle('is-active', id === backdropId);
  }
}

/* ------------------------------------------------------------------ */
/* View switch + toggles                                               */
/* ------------------------------------------------------------------ */

const viewSwitch = $<HTMLDivElement>('#view-switch');
viewSwitch.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.view-chip');
  if (!button) return;
  const view = button.dataset.view as ViewPreset;
  viewer.setView(view);
  viewSwitch.querySelectorAll('.view-chip').forEach((el) => {
    el.classList.toggle('is-active', el === button);
  });
});

const rotateToggle = $<HTMLButtonElement>('#toggle-rotate');
const idleToggle = $<HTMLButtonElement>('#toggle-idle');

function syncRotateToggle(enabled: boolean): void {
  rotateToggle.classList.toggle('is-active', enabled);
  rotateToggle.setAttribute('aria-pressed', String(enabled));
}
viewer.onAutoRotateChange = syncRotateToggle;
rotateToggle.addEventListener('click', () => {
  const next = !viewer.isAutoRotating();
  viewer.setAutoRotate(next);
  syncRotateToggle(next);
});
if (reducedMotion) {
  viewer.setAutoRotate(false);
  viewer.setIdleMotion(false);
  syncRotateToggle(false);
  idleToggle.classList.remove('is-active');
  idleToggle.setAttribute('aria-pressed', 'false');
} else {
  syncRotateToggle(true);
}
idleToggle.addEventListener('click', () => {
  const active = idleToggle.classList.toggle('is-active');
  idleToggle.setAttribute('aria-pressed', String(active));
  viewer.setIdleMotion(active);
});

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

const snapshotButton = $<HTMLButtonElement>('#button-snapshot');
const sheetButton = $<HTMLButtonElement>('#button-sheet');
const turntableButton = $<HTMLButtonElement>('#button-turntable');

snapshotButton.addEventListener('click', async () => {
  snapshotButton.disabled = true;
  try {
    const blob = await viewer.snapshot(2048);
    if (!blob) throw new Error('PNG encode failed');
    const { weight, pose } = viewer.getState();
    downloadBlob(blob, `animalanimator-kitten-${pose}-${Math.round(weight * 100)}.png`);
    showToast('Snapshot saved · 2048 × 2048');
  } catch (error) {
    console.error(error);
    showToast('Snapshot failed — see console');
  } finally {
    snapshotButton.disabled = false;
  }
});

sheetButton.addEventListener('click', async () => {
  sheetButton.disabled = true;
  showToast('Rendering 25 kitten stills…');
  try {
    const blob = await viewer.renderContactSheet();
    if (!blob) throw new Error('Sheet PNG encode failed');
    downloadBlob(blob, 'animalanimator-kitten-weight-pose-sheet.png');
    showToast('Contact sheet saved · 5 poses × 5 weights');
  } catch (error) {
    console.error(error);
    showToast('Contact sheet failed — see console');
  } finally {
    sheetButton.disabled = false;
  }
});

turntableButton.addEventListener('click', async () => {
  turntableButton.disabled = true;
  showToast('Recording one full orbit…');
  try {
    const blob = await viewer.recordTurntable(4.6);
    if (!blob) throw new Error('MediaRecorder unavailable');
    downloadBlob(blob, 'animalanimator-turntable.webm');
    showToast('Turntable saved · WebM');
    syncRotateToggle(false);
  } catch (error) {
    console.error(error);
    showToast('Turntable recording failed — see console');
  } finally {
    turntableButton.disabled = false;
  }
});

/* Randomize — every good kitten deserves a surprise */
const randomizeButton = $<HTMLButtonElement>('#button-randomize');
randomizeButton.addEventListener('click', () => {
  const poseId = POSE_ORDER[Math.floor(Math.random() * POSE_ORDER.length)];
  const coatId = COATS[Math.floor(Math.random() * COATS.length)].id;
  // Slightly favour the middle of the scale, where the chonk lives.
  const gaussian = (Math.random() + Math.random() + Math.random()) / 3;
  const sliderValue = Math.round(72 + gaussian * 88);
  setPose(poseId);
  setCoat(coatId);
  setWeightSlider(sliderValue);
  showToast('A wild kitten appears');
});

/* ------------------------------------------------------------------ */
/* HUD + keyboard shortcuts                                            */
/* ------------------------------------------------------------------ */

const hud = $<HTMLDivElement>('#hud');
viewer.onMetrics = (metrics) => {
  hud.textContent = `${metrics.vertices.toLocaleString()} VERTS · ${metrics.triangles.toLocaleString()} TRIS · ${metrics.buildMs.toFixed(1)} MS`;
};

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement;
  if (target.tagName === 'INPUT' && target !== slider) return;
  const key = event.key.toLowerCase();
  if (key >= '1' && key <= '5') {
    setPose(POSE_ORDER[Number(key) - 1]);
  } else if (key === 'q') {
    setWeightSlider(Number(slider.value) - 4);
  } else if (key === 'e') {
    setWeightSlider(Number(slider.value) + 4);
  } else if (key === 's') {
    snapshotButton.click();
  } else if (key === 'a') {
    rotateToggle.click();
  } else if (key === 'i') {
    idleToggle.click();
  }
});

/* Initial paint */
setWeightSlider(100);
setCoat(KITTEN_SPEC.defaultCoat as CoatId);
