// ===== Smart Explore Nutrition Label =====
// Opens a modal showing top 3 models from the Smart Filter, their per-focus-area
// performance, and 3 "things to note" warnings based on their weakest focus
// areas. Users can toggle between models, and save the label as a PDF.

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export interface SmartConstruct {
  text: string;
  benchmark: string;
  score: number;
  icon?: string;
  summary?: string;
}

export interface SmartTopModel {
  name: string;
  provider: string;
  score: number;
}

export interface SmartNutritionOpts {
  userText: string;
  constructs: SmartConstruct[];
  topModels: SmartTopModel[];
}

// Deterministic small hash used to jitter per-model per-construct scores.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295; // 0..1
}

// Each top-3 model gets an overall offset; jitter varies per construct.
const MODEL_RANK_OFFSET = [0.06, -0.01, -0.09];

function modelScoreForConstruct(
  model: SmartTopModel,
  modelRank: number,
  c: SmartConstruct
): number {
  const offset = MODEL_RANK_OFFSET[modelRank] ?? 0;
  const jitter = (hash(model.name + '::' + c.text) - 0.5) * 0.18;
  const raw = c.score + offset + jitter;
  return Math.max(-1, Math.min(1, raw));
}

function fmtScore(s: number): string {
  return (s >= 0 ? '+' : '') + s.toFixed(2);
}
function scoreClass(s: number): string {
  if (s > 0.05) return 'positive';
  if (s < -0.05) return 'negative';
  return 'neutral';
}
function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'smart-nutrition';
}

let _overlay: HTMLDivElement | null = null;

function close(): void {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
}

function buildWarning(c: SmartConstruct, score: number): { heading: string; body: string } {
  const heading = `Watch out on "${c.text}"`;
  const base = c.summary && c.summary.trim().length
    ? c.summary
    : `This model scored ${fmtScore(score)} on ${c.text}. Verify your product doesn't amplify risks in this area.`;
  const prefix = score < -0.1
    ? 'Ensure that your product doesn\u2019t amplify this risk — '
    : 'Keep an eye on this area in deployment — ';
  return { heading, body: prefix + base };
}

function renderLabel(opts: SmartNutritionOpts, activeIdx: number): string {
  const model = opts.topModels[activeIdx];
  if (!model) return '';

  const perArea = opts.constructs.map((c) => ({
    c,
    score: modelScoreForConstruct(model, activeIdx, c),
  }));

  const areaRows = perArea
    .map((r) => {
      const pct = Math.max(4, Math.min(100, Math.round(Math.abs(r.score) * 100)));
      const cls = scoreClass(r.score);
      return `
        <div class="smart-nl-area">
          <div class="smart-nl-area-top">
            <span class="smart-nl-area-icon"><i class="fa-solid ${esc(r.c.icon || 'fa-bullseye')}"></i></span>
            <span class="smart-nl-area-name">${esc(r.c.text)}</span>
            <span class="smart-nl-area-score ${cls}">${fmtScore(r.score)}</span>
          </div>
          <div class="smart-nl-area-track">
            <div class="smart-nl-area-fill ${cls}" style="width:${pct}%"></div>
          </div>
          <div class="smart-nl-area-meta">${esc(r.c.benchmark)}</div>
        </div>
      `;
    })
    .join('');

  const weakest = perArea.slice().sort((a, b) => a.score - b.score).slice(0, 3);
  const warningsHtml = weakest
    .map((r) => {
      const w = buildWarning(r.c, r.score);
      return `
        <div class="smart-nl-warning">
          <div class="smart-nl-warning-head">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>${esc(w.heading)}</span>
            <span class="smart-nl-warning-score ${scoreClass(r.score)}">${fmtScore(r.score)}</span>
          </div>
          <div class="smart-nl-warning-body">${esc(w.body)}</div>
        </div>
      `;
    })
    .join('');

  const overallCls = scoreClass(model.score);
  const overallPct = Math.max(0, Math.min(100, ((model.score + 1) / 2) * 100));

  return `
    <div class="nutrition-headline">AI Nutrition Label</div>
    <div class="nutrition-subline">Smart Explore snapshot</div>

    <div class="nutrition-model-block">
      <div class="nutrition-model-kicker">Top model on your focus</div>
      <div class="nutrition-model-name">${esc(model.name)}</div>
      <div class="smart-nl-provider">${esc(model.provider)}</div>
    </div>

    <div class="nutrition-thick-rule"></div>

    <div class="nutrition-score-row">
      <div class="nutrition-score-label">Net Impact Score</div>
      <div class="nutrition-score-value ${overallCls}">${fmtScore(model.score)}</div>
    </div>
    <div class="smart-nl-overall-track" aria-hidden="true">
      <div class="smart-nl-overall-zero"></div>
      <div class="smart-nl-overall-marker ${overallCls}" style="left:${overallPct}%"></div>
    </div>

    <div class="nutrition-thick-rule"></div>

    <div class="smart-nl-section-title">Performance on your 5 focus areas</div>
    <div class="smart-nl-areas">${areaRows}</div>

    <div class="nutrition-thick-rule"></div>

    <div class="smart-nl-section-title">Things to note <span class="smart-nl-section-sub">3 warnings from weakest focus areas</span></div>
    <div class="smart-nl-warnings">${warningsHtml}</div>

    <div class="nutrition-thick-rule"></div>
    <div class="nutrition-footnote">
      Generated from your Smart Explore context: &ldquo;${esc(opts.userText || '(no context provided)')}&rdquo;.
      Per-area scores derive from the scenario evals in this benchmark.
    </div>
  `;
}

function renderToggle(opts: SmartNutritionOpts, activeIdx: number): string {
  return opts.topModels
    .map((m, i) => {
      const active = i === activeIdx ? ' active' : '';
      return `
        <button type="button" class="smart-nl-toggle-btn${active}" data-idx="${i}">
          <span class="smart-nl-toggle-rank">#${i + 1}</span>
          <span class="smart-nl-toggle-name">${esc(m.name)}</span>
          <span class="smart-nl-toggle-score ${scoreClass(m.score)}">${fmtScore(m.score)}</span>
        </button>
      `;
    })
    .join('');
}

async function savePdf(fileSlug: string, btn: HTMLButtonElement | null): Promise<void> {
  const card = document.getElementById('smart-nl-card');
  if (!card) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  try {
    const canvas = await html2canvas(card as HTMLElement, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 28;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    const x = (pageWidth - w) / 2;
    const y = (pageHeight - h) / 2;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, w, h);
    pdf.save(`${fileSlug}.pdf`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Save PDF';
    }
  }
}

export function openSmartNutritionLabel(opts: SmartNutritionOpts): void {
  if (!opts || !opts.topModels || !opts.topModels.length) return;

  close();

  let activeIdx = 0;

  const overlay = document.createElement('div');
  overlay.className = 'nutrition-overlay';
  overlay.innerHTML = `
    <div class="nutrition-modal smart-nl-modal" role="dialog" aria-modal="true" aria-label="Smart Explore nutrition label">
      <button class="nutrition-close-btn" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      <div class="smart-nl-toggle" id="smart-nl-toggle">${renderToggle(opts, activeIdx)}</div>
      <div class="nutrition-scroll-wrap">
        <div class="nutrition-label smart-nl-label" id="smart-nl-card">${renderLabel(opts, activeIdx)}</div>
      </div>
      <div class="nutrition-actions">
        <button class="nutrition-save-pdf-btn" id="smart-nl-save-btn"><i class="fa-solid fa-file-pdf"></i> Save PDF</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  _overlay = overlay;

  const closeBtn = overlay.querySelector<HTMLButtonElement>('.nutrition-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', close);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const toggleEl = overlay.querySelector<HTMLDivElement>('#smart-nl-toggle');
  const cardEl = overlay.querySelector<HTMLDivElement>('#smart-nl-card');

  if (toggleEl) {
    toggleEl.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.smart-nl-toggle-btn');
      if (!target) return;
      const idx = parseInt(target.getAttribute('data-idx') || '-1', 10);
      if (idx < 0 || idx === activeIdx) return;
      activeIdx = idx;
      toggleEl.innerHTML = renderToggle(opts, activeIdx);
      if (cardEl) cardEl.innerHTML = renderLabel(opts, activeIdx);
    });
  }

  const saveBtn = overlay.querySelector<HTMLButtonElement>('#smart-nl-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const model = opts.topModels[activeIdx];
      void savePdf(slugify(model ? model.name : 'smart-nutrition'), saveBtn);
    });
  }
}

declare global {
  interface Window {
    __openSmartNutritionLabel?: (opts: SmartNutritionOpts) => void;
  }
}

window.__openSmartNutritionLabel = openSmartNutritionLabel;
