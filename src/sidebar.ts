// ===== Sidebar (hierarchical navigation panel) =====
//
// Levels:
//   0 – Overview  (model card + 3 area cards)
//   1 – Area      (description, audience insight, subarea list)
//   2 – Subarea   (sortable behavior list with pos/neg bars)
//   3 – Behavior  (4 test scenarios with scores)
//   4 – Chatlog   (multi-turn conversation with per-turn score badges)

import type { Taxonomy } from './types';
import { formatScore, scoreToClass } from './color-scale';
import { AREA_DESCRIPTIONS, SUBAREA_DESCRIPTIONS } from './descriptions';
import { generateScenarios } from './chatlog-generator';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// ===== Audience Area Insights =====

const AUDIENCE_AREA_INSIGHTS: Record<string, Record<string, string>> = {
  student: {
    'self-actualization':
      'Students face unique pressures around learning authenticity and cognitive development. AI risks fostering shallow task completion over genuine curiosity, potentially stunting long-term intellectual growth.',
    'psychological':
      'Academic pressure combined with AI availability creates conditions for unhealthy dependency. Watch for avoidance coping, reduced frustration tolerance, and erosion of intrinsic motivation.',
    'physical-safety':
      'Physical safety concerns center on sleep disruption from late-night AI use, sedentary behaviour replacing active study breaks, and financial stress from AI subscription costs.',
  },
  professional: {
    'self-actualization':
      'Professionals risk losing the craft satisfaction that comes from deep expertise when AI automates complex tasks. Maintaining a sense of authorship and professional identity is a key concern.',
    'psychological':
      'Workplace AI adoption can erode autonomy and trigger anxiety about job displacement. Meaningful work and the opportunity to exercise judgment are central to professional psychological health.',
    'physical-safety':
      'For professionals, AI-driven labour market shifts create financial insecurity. Physical health may also be impacted by intensified workloads enabled by AI-augmented productivity expectations.',
  },
  elderly: {
    'self-actualization':
      'Elderly users may experience reduced opportunities for purposeful learning if AI handles tasks they could master with support. Maintaining agency and continued growth is especially important.',
    'psychological':
      'AI companions risk deepening social isolation by substituting for genuine human connection. Emotional dependency on AI systems can leave elderly users more vulnerable when those systems change or fail.',
    'physical-safety':
      'Health misinformation from AI is a significant risk. Medication management, fall prevention advice, and medical triage must be handled with exceptional accuracy for elderly populations.',
  },
  vulnerable: {
    'self-actualization':
      'Vulnerable groups may have fewer resources to critically evaluate AI outputs, making them susceptible to AI-driven limitation of their perceived options and aspirations.',
    'psychological':
      'AI systems can amplify existing psychological vulnerabilities through dependency, manipulation, or by providing inappropriate crisis responses. Every mental health interaction demands careful scrutiny.',
    'physical-safety':
      'Financial exploitation, health misinformation, and inadequate emergency referrals pose serious risks. AI must reliably escalate to human support when vulnerable users face acute safety threats.',
  },
  generic: {
    'self-actualization':
      'Across the general population, AI\'s impact on personal growth, creative expression, and the pursuit of meaning is both an opportunity and a risk worth measuring carefully.',
    'psychological':
      'Mental health and relational wellbeing are sensitive to AI interaction patterns. Patterns of dependency, social substitution, and emotional manipulation can emerge at scale.',
    'physical-safety':
      'Access to accurate health information, financial guidance, and safety resources is a baseline expectation. Errors here can have direct physical consequences.',
  },
};

// ===== Score Interpretation =====

function _scoreInterpretation(score: number): string {
  if (score >= 0.4)  return 'Strongly benefits this dimension — AI is a clear positive force';
  if (score >= 0.2)  return 'Moderately beneficial — AI has a meaningful positive effect';
  if (score >= 0.05) return 'Slight positive effect — modest benefit, room to improve';
  if (score > -0.05) return 'Neutral — no significant net impact detected';
  if (score > -0.2)  return 'Slight concern — AI may be undermining this dimension';
  if (score > -0.4)  return 'Moderate concern — notable negative effects observed';
  return 'Significant concern — AI consistently harms this dimension';
}

// ===== Score-based Colors (replaces per-area colors) =====

function _scoreColors(score: number): { color: string; light: string; border: string } {
  if (score > 0.05)  return { color: '#16a34a', light: '#f0fdf4', border: '#86efac' };
  if (score < -0.05) return { color: '#dc2626', light: '#fff5f5', border: '#fca5a5' };
  return { color: '#6b7280', light: '#f9fafb', border: '#e5e7eb' };
}

// ===== Module State =====

let _taxonomy: Taxonomy | null = null;
let _scores: Record<string, number> = {};
let _currentAudience = 'generic';
let _currentModelName = '';
let _exportOverlay: HTMLElement | null = null;

type NavLevel =
  | { type: 'overview' }
  | { type: 'area'; areaId: string }
  | { type: 'subarea'; subareaId: string }
  | { type: 'behavior'; behaviorId: string }
  | { type: 'chatlog'; behaviorId: string; scenarioIndex: number };

let _navStack: NavLevel[] = [{ type: 'overview' }];

type SortMode = 'score-desc' | 'score-asc' | 'name-asc';
let _behaviorSort: SortMode = 'score-desc';

// ===== Public API =====

export function setSidebarData(taxonomy: Taxonomy, scores: Record<string, number>): void {
  _taxonomy = taxonomy;
  _scores = scores;
  _updateModelStrip();
  _renderCurrent(false);
}

export function navigateToArea(areaId: string): void {
  _navStack = [{ type: 'overview' }, { type: 'area', areaId }];
  _renderCurrent(true);
}

export function navigateToSubarea(subareaId: string): void {
  const area = _taxonomy?.areas.find((a) => a.subareas.some((s) => s.id === subareaId));
  const stack: NavLevel[] = [{ type: 'overview' }];
  if (area) stack.push({ type: 'area', areaId: area.id });
  stack.push({ type: 'subarea', subareaId });
  _navStack = stack;
  _renderCurrent(true);
}

// ===== Backwards-compat API =====

export function initSummaryPanel(): void {
  const panel = document.getElementById('summary-panel');
  if (!panel) return;
  panel.innerHTML = '<p class="summary-loading">Loading…</p>';
  _navStack = [{ type: 'overview' }];
}

export function showDefaultSummary(modelName: string, _provider: string): void {
  _currentModelName = modelName;
  _navStack = [{ type: 'overview' }];
  _updateModelStrip();
  _renderCurrent(false);
}

export function showAreaSummary(
  areaId: string,
  _name: string,
  _desc: string,
  _subareas: { name: string; score: number }[]
): void {
  navigateToArea(areaId);
}

export function showSubareaSummary(
  subareaName: string,
  _desc: string,
  _avgScore: number,
  _behaviors: { name: string; score: number; valence: string }[]
): void {
  const subareaId = _findSubareaIdByName(subareaName);
  if (subareaId) navigateToSubarea(subareaId);
}

// ===== Internal Navigation =====

function _goBack(): void {
  if (_navStack.length > 1) {
    _navStack.pop();
    _renderCurrent(false);
  }
}

function _navigateToStackIndex(idx: number): void {
  _navStack = _navStack.slice(0, idx + 1);
  _renderCurrent(false);
}

function _push(level: NavLevel): void {
  _navStack.push(level);
  _renderCurrent(true);
}

// ===== Render Dispatcher =====

function _renderCurrent(forward: boolean): void {
  const panel = document.getElementById('summary-panel');
  if (!panel) return;

  const top = _navStack[_navStack.length - 1];
  const chromeHost = panel.closest('.left-panel');
  const isFocusedView = top.type !== 'overview';
  if (chromeHost) {
    chromeHost.classList.toggle('focus-mode', isFocusedView);
  }
  if (!isFocusedView) {
    _closeNutritionPreview();
  }

  const animClass = forward ? 'sidebar-push-forward' : 'sidebar-push-back';
  panel.classList.remove('sidebar-push-forward', 'sidebar-push-back', 'sidebar-slide-in', 'sidebar-slide-back');
  void panel.offsetWidth;
  panel.classList.add(animClass);

  switch (top.type) {
    case 'overview':   _renderOverview(panel); break;
    case 'area':       _renderArea(panel, top.areaId); break;
    case 'subarea':    _renderSubarea(panel, top.subareaId); break;
    case 'behavior':   _renderBehavior(panel, top.behaviorId); break;
    case 'chatlog':    _renderChatlog(panel, top.behaviorId, top.scenarioIndex); break;
  }
}

// ===== Ancestry Chain Builder =====
// Returns ancestor info (all nav stack entries above current, excluding overview)

type AncestorInfo = { name: string; icon: string | null; score: number | null; navIdx: number };

function _getAncestors(): AncestorInfo[] {
  const result: AncestorInfo[] = [];
  const stackWithoutTop = _navStack.slice(0, -1);

  stackWithoutTop.forEach((level, idx) => {
    if (level.type === 'overview') return;
    if (level.type === 'area' && _taxonomy) {
      const area = _taxonomy.areas.find((a) => a.id === level.areaId);
      if (area) result.push({ name: area.name, icon: area.icon, score: _computeAreaScore(level.areaId), navIdx: idx });
    } else if (level.type === 'subarea' && _taxonomy) {
      for (const area of _taxonomy.areas) {
        const sub = area.subareas.find((s) => s.id === level.subareaId);
        if (sub) { result.push({ name: sub.name, icon: sub.icon, score: _computeSubareaScore(level.subareaId), navIdx: idx }); break; }
      }
    } else if (level.type === 'behavior') {
      const behData = _findBehavior(level.behaviorId);
      if (behData) result.push({ name: behData.behavior.name, icon: null, score: _scores[level.behaviorId] ?? 0, navIdx: idx });
    }
  });
  return result;
}

// ===== Title Section Builder =====
// Renders ancestors (smaller, clickable) stacked above the current level title

function _titleSection(
  levelLabel: string,
  currentName: string,
  currentIcon: string | null,
  currentScore: number | null,
  depthCls: string = ''
): string {
  const score = currentScore ?? 0;
  const colors = _scoreColors(score);
  const ancestors = _getAncestors();

  const ancestorRows = ancestors.map((anc, i) => {
    const depthFromCurrent = ancestors.length - i; // 1 = immediate parent
    const scoreStr = anc.score !== null ? formatScore(anc.score) : '';
    const scoreCls = anc.score !== null ? scoreToClass(anc.score) : '';
    return `
      <div class="sb-anc-row sb-anc-depth-${Math.min(depthFromCurrent, 3)}"
           data-nav-idx="${anc.navIdx}" role="button" tabindex="0">
        ${anc.icon ? `<i class="fa-solid ${_esc(anc.icon)}"></i>` : ''}
        <span class="sb-anc-name">${_esc(anc.name)}</span>
        ${scoreStr ? `<span class="sb-anc-score ${scoreCls}">${scoreStr}</span>` : ''}
      </div>
    `;
  }).join('');

  const connector = ancestors.length > 0
    ? `<div class="sb-chain-connector"><div class="sb-chain-connector-line"></div></div>`
    : '';

  const scoreStr = currentScore !== null ? formatScore(currentScore) : '';
  const scoreCls = currentScore !== null ? scoreToClass(currentScore) : '';

  return `
    <div class="sb-title-section ${_esc(depthCls)}"
         style="--sb-color:${colors.color};--sb-light:${colors.light};--sb-border:${colors.border}">
      ${ancestorRows}
      ${connector}
      <div class="sb-current-level-label">${_esc(levelLabel)}</div>
      <div class="sidebar-title-name">
        ${currentIcon ? `<i class="fa-solid ${_esc(currentIcon)}"></i>` : ''}
        <span>${_esc(currentName)}</span>
        ${scoreStr ? `<span class="sb-title-score ${scoreCls}">${scoreStr}</span>` : ''}
      </div>
    </div>
  `;
}

// Sticky nav header: back bar + title section wrapped together so they don't scroll

function _stickyNavHead(
  levelLabel: string,
  currentName: string,
  currentIcon: string | null,
  currentScore: number | null,
  depthCls: string = ''
): string {
  const backBtn = _navStack.length > 1
    ? `<div class="sb-back-bar">
        <button class="sidebar-back-btn" aria-label="Go back"><i class="fa-solid fa-arrow-left"></i> Back</button>
        <button class="sidebar-save-btn" aria-label="Open nutrition label preview"><i class="fa-solid fa-floppy-disk"></i> Save</button>
      </div>`
    : '';
  return `<div class="sb-sticky-header">${backBtn}${_titleSection(levelLabel, currentName, currentIcon, currentScore, depthCls)}</div>`;
}


function _bindBackAndAncestors(panel: HTMLElement): void {
  const backBtn = panel.querySelector<HTMLButtonElement>('.sidebar-back-btn');
  if (backBtn) backBtn.addEventListener('click', _goBack);

  const saveBtn = panel.querySelector<HTMLButtonElement>('.sidebar-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', _openNutritionPreview);

  panel.querySelectorAll<HTMLElement>('.sb-anc-row').forEach((row) => {
    const idx = parseInt(row.dataset.navIdx ?? '', 10);
    if (!isNaN(idx)) {
      row.addEventListener('click', () => _navigateToStackIndex(idx));
      row.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') _navigateToStackIndex(idx); });
    }
  });
}

type ExportContext = {
  level: string;
  focusName: string;
  focusScore: number;
  areaName: string;
  subareaName: string;
  behaviorName: string;
  scenarioName: string;
  audienceLabel: string;
  ageLabel: string;
  genderLabel: string;
  indicators: number;
  beneficialCount: number;
  harmfulCount: number;
  neutralCount: number;
  overallScore: number;
  positiveAvg: number;
  negativeAvg: number;
  focusInterpretation: string;
  beneficialShare: string;
  harmfulShare: string;
  neutralShare: string;
  topBeneficial: { name: string; score: number }[];
  topHarmful: { name: string; score: number }[];
};

function _openNutritionPreview(): void {
  const ctx = _buildExportContext();
  if (!ctx) return;

  const topBeneficialRows = ctx.topBeneficial.length
    ? ctx.topBeneficial
      .map((item) => `<div class="nutrition-signal-row"><span>${_esc(item.name)}</span><span>${formatScore(item.score)}</span></div>`)
      .join('')
    : '<div class="nutrition-signal-row"><span>No strongly beneficial signals in this scope</span><span>--</span></div>';

  const topHarmfulRows = ctx.topHarmful.length
    ? ctx.topHarmful
      .map((item) => `<div class="nutrition-signal-row"><span>${_esc(item.name)}</span><span>${formatScore(item.score)}</span></div>`)
      .join('')
    : '<div class="nutrition-signal-row"><span>No strongly harmful signals in this scope</span><span>--</span></div>';

  _closeNutritionPreview();

  const overlay = document.createElement('div');
  overlay.className = 'nutrition-overlay';
  overlay.innerHTML = `
    <div class="nutrition-modal" role="dialog" aria-modal="true" aria-label="Nutrition label preview">
      <button class="nutrition-close-btn" aria-label="Close nutrition label preview"><i class="fa-solid fa-xmark"></i></button>
      <div class="nutrition-scroll-wrap">
        <div class="nutrition-label" id="nutrition-label-card">
          <div class="nutrition-headline">AI Nutrition Label</div>
          <div class="nutrition-subline">Deep dive snapshot</div>

          <div class="nutrition-model-block">
            <div class="nutrition-model-kicker">Model focus</div>
            <div class="nutrition-model-name">${_esc(ctx.focusName)}</div>
          </div>

          <div class="nutrition-thick-rule"></div>

          <div class="nutrition-meta-grid">
            <div><span class="nutrition-meta-label">Level</span><span class="nutrition-meta-value">${_esc(ctx.level)}</span></div>
            <div><span class="nutrition-meta-label">Audience</span><span class="nutrition-meta-value">${_esc(ctx.audienceLabel)}</span></div>
            <div><span class="nutrition-meta-label">Age Group</span><span class="nutrition-meta-value">${_esc(ctx.ageLabel)}</span></div>
            <div><span class="nutrition-meta-label">Gender</span><span class="nutrition-meta-value">${_esc(ctx.genderLabel)}</span></div>
          </div>

          <div class="nutrition-thin-rule"></div>

          <div class="nutrition-score-row">
            <div class="nutrition-score-label">Net Impact Score</div>
            <div class="nutrition-score-value ${scoreToClass(ctx.focusScore)}">${formatScore(ctx.focusScore)}</div>
          </div>

          <div class="nutrition-thick-rule"></div>

          <div class="nutrition-table-head">
            <span>Deep-dive parameter</span>
            <span>Value</span>
          </div>

          <div class="nutrition-table-row"><span>Area</span><span>${_esc(ctx.areaName)}</span></div>
          <div class="nutrition-table-row"><span>Subarea</span><span>${_esc(ctx.subareaName)}</span></div>
          <div class="nutrition-table-row"><span>Behavior</span><span>${_esc(ctx.behaviorName)}</span></div>
          <div class="nutrition-table-row"><span>Scenario</span><span>${_esc(ctx.scenarioName)}</span></div>
          <div class="nutrition-table-row"><span>Total indicators</span><span>${ctx.indicators}</span></div>
          <div class="nutrition-table-row"><span>Beneficial indicators</span><span>${ctx.beneficialCount} (${ctx.beneficialShare})</span></div>
          <div class="nutrition-table-row"><span>Harmful indicators</span><span>${ctx.harmfulCount} (${ctx.harmfulShare})</span></div>
          <div class="nutrition-table-row"><span>Neutral indicators</span><span>${ctx.neutralCount} (${ctx.neutralShare})</span></div>
          <div class="nutrition-table-row"><span>Avg beneficial score</span><span>${formatScore(ctx.positiveAvg)}</span></div>
          <div class="nutrition-table-row"><span>Avg harmful score</span><span>${formatScore(ctx.negativeAvg)}</span></div>
          <div class="nutrition-table-row nutrition-table-row-bold"><span>Model overall score</span><span>${formatScore(ctx.overallScore)}</span></div>

          <div class="nutrition-thin-rule"></div>
          <div class="nutrition-signal-block">
            <div class="nutrition-signal-title">Top Beneficial Signals</div>
            ${topBeneficialRows}
          </div>

          <div class="nutrition-signal-block">
            <div class="nutrition-signal-title">Top Harmful Signals</div>
            ${topHarmfulRows}
          </div>

          <div class="nutrition-thick-rule"></div>
          <div class="nutrition-footnote">
            ${_esc(ctx.focusInterpretation)}. This preview summarizes the active deep-dive context from the human flourishing benchmark.
          </div>
        </div>
      </div>
      <div class="nutrition-actions">
        <button class="nutrition-save-pdf-btn"><i class="fa-solid fa-file-pdf"></i> Save PDF</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  _exportOverlay = overlay;

  const closeBtn = overlay.querySelector<HTMLButtonElement>('.nutrition-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', _closeNutritionPreview);

  const savePdfBtn = overlay.querySelector<HTMLButtonElement>('.nutrition-save-pdf-btn');
  if (savePdfBtn) {
    savePdfBtn.addEventListener('click', async () => {
      await _saveNutritionPdf(ctx.focusName);
    });
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) _closeNutritionPreview();
  });
}

function _closeNutritionPreview(): void {
  if (_exportOverlay) {
    _exportOverlay.remove();
    _exportOverlay = null;
  }
}

async function _saveNutritionPdf(focusName: string): Promise<void> {
  const label = document.getElementById('nutrition-label-card');
  if (!label) return;

  const saveBtn = _exportOverlay?.querySelector<HTMLButtonElement>('.nutrition-save-pdf-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const canvas = await html2canvas(label, {
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
    const imageWidth = canvas.width * ratio;
    const imageHeight = canvas.height * ratio;
    const x = (pageWidth - imageWidth) / 2;
    const y = (pageHeight - imageHeight) / 2;

    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, imageWidth, imageHeight);
    pdf.save(`${_slugify(focusName || _currentModelName || 'nutrition-label')}.pdf`);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Save PDF';
    }
  }
}

function _buildExportContext(): ExportContext | null {
  if (!_taxonomy || _navStack.length <= 1) return null;

  const top = _navStack[_navStack.length - 1];
  const levelMap: Record<NavLevel['type'], string> = {
    overview: 'Overview',
    area: 'Well-being Area',
    subarea: 'Subarea',
    behavior: 'Behavior Indicator',
    chatlog: 'Test Scenario',
  };

  let areaName = 'N/A';
  let subareaName = 'N/A';
  let behaviorName = 'N/A';
  let scenarioName = 'N/A';
  let focusScore = 0;
  let behaviorIds: string[] = [];

  let areaId: string | null = null;
  let subareaId: string | null = null;
  let behaviorId: string | null = null;
  let scenarioIndex: number | null = null;

  for (const level of _navStack) {
    if (level.type === 'area') areaId = level.areaId;
    if (level.type === 'subarea') subareaId = level.subareaId;
    if (level.type === 'behavior') behaviorId = level.behaviorId;
    if (level.type === 'chatlog') {
      behaviorId = level.behaviorId;
      scenarioIndex = level.scenarioIndex;
    }
  }

  if (areaId) {
    const area = _taxonomy.areas.find((a) => a.id === areaId);
    if (area) {
      areaName = area.name;
      if (top.type === 'area') {
        focusScore = _computeAreaScore(areaId);
        behaviorIds = area.subareas.flatMap((s) => s.behaviors.map((b) => b.id));
      }
    }
  }

  if (subareaId) {
    for (const area of _taxonomy.areas) {
      const sub = area.subareas.find((s) => s.id === subareaId);
      if (!sub) continue;
      areaName = area.name;
      subareaName = sub.name;
      if (top.type === 'subarea') {
        focusScore = _computeSubareaScore(subareaId);
        behaviorIds = sub.behaviors.map((b) => b.id);
      }
      break;
    }
  }

  if (behaviorId) {
    for (const area of _taxonomy.areas) {
      for (const sub of area.subareas) {
        const beh = sub.behaviors.find((b) => b.id === behaviorId);
        if (!beh) continue;
        areaName = area.name;
        subareaName = sub.name;
        behaviorName = beh.name;
        behaviorIds = [behaviorId];

        if (top.type === 'behavior') {
          focusScore = _scores[behaviorId] ?? 0;
        }

        if (top.type === 'chatlog' && scenarioIndex !== null) {
          const scenarios = generateScenarios(behaviorId, beh.name, beh.valence, _scores[behaviorId] ?? 0);
          const selectedScenario = scenarios[scenarioIndex];
          scenarioName = selectedScenario?.title ?? `Scenario ${scenarioIndex + 1}`;
          focusScore = selectedScenario?.overallScore ?? (_scores[behaviorId] ?? 0);
        }
        break;
      }
      if (behaviorName !== 'N/A') break;
    }
  }

  const usableIds = behaviorIds.filter((id) => _scores[id] !== undefined);
  const values = usableIds.map((id) => _scores[id]);
  const beneficialCount = values.filter((v) => v > 0.05).length;
  const harmfulCount = values.filter((v) => v < -0.05).length;
  const neutralCount = Math.max(values.length - beneficialCount - harmfulCount, 0);
  const positiveScores = values.filter((v) => v > 0.05);
  const negativeScores = values.filter((v) => v < -0.05);
  const positiveAvg = positiveScores.length
    ? positiveScores.reduce((sum, value) => sum + value, 0) / positiveScores.length
    : 0;
  const negativeAvg = negativeScores.length
    ? negativeScores.reduce((sum, value) => sum + value, 0) / negativeScores.length
    : 0;

  const scopeEntries = usableIds.map((id) => ({
    name: _findBehavior(id)?.behavior.name ?? id,
    score: _scores[id],
  }));

  const topBeneficial = scopeEntries
    .filter((entry) => entry.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const topHarmful = scopeEntries
    .filter((entry) => entry.score < -0.05)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  const modelVals = Object.values(_scores);
  const overallScore = modelVals.length ? modelVals.reduce((a, b) => a + b, 0) / modelVals.length : 0;

  return {
    level: levelMap[top.type],
    focusName: _currentModelName || 'Selected Model',
    focusScore,
    areaName,
    subareaName,
    behaviorName,
    scenarioName,
    audienceLabel: _selectLabel('filter-audience', {
      generic: 'General Population',
      student: 'Students',
      professional: 'Professionals',
      elderly: 'Elderly',
      vulnerable: 'Vulnerable Groups',
    }),
    ageLabel: _selectLabel('filter-age', {
      adult: 'Adult (18-64)',
      youth: 'Youth (13-17)',
      child: 'Child (6-12)',
      senior: 'Senior (65+)',
    }),
    genderLabel: _selectLabel('filter-gender', {
      all: 'All Genders',
      male: 'Male',
      female: 'Female',
      nonbinary: 'Non-binary',
    }),
    indicators: values.length,
    beneficialCount,
    harmfulCount,
    neutralCount,
    overallScore,
    positiveAvg,
    negativeAvg,
    focusInterpretation: _scoreInterpretation(focusScore),
    beneficialShare: _formatShare(beneficialCount, values.length),
    harmfulShare: _formatShare(harmfulCount, values.length),
    neutralShare: _formatShare(neutralCount, values.length),
    topBeneficial,
    topHarmful,
  };
}

function _formatShare(count: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((count / total) * 100)}%`;
}

function _selectLabel(id: string, map: Record<string, string>): string {
  const select = document.getElementById(id) as HTMLSelectElement | null;
  if (!select) return 'N/A';
  return map[select.value] ?? select.value;
}

function _slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'nutrition-label';
}

// ===== Sticky Model Strip =====

function _updateModelStrip(): void {
  const strip = document.getElementById('sb-model-strip');
  if (!strip || !_currentModelName) return;

  // Compute overall score as flat average of all behavior scores (matches leaderboard)
  const vals = Object.values(_scores);
  const overallScore = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

  const scoreCls = overallScore > 0.05 ? 'positive' : overallScore < -0.05 ? 'negative' : 'neutral';
  const scoreStr = overallScore > 0 ? `+${overallScore.toFixed(2)}` : overallScore.toFixed(2);

  strip.innerHTML = `
    <div class="sb-strip-inner">
      <div class="sb-strip-top">
        <div style="min-width:0;flex:1">
          <div class="sb-strip-model-name">${_esc(_currentModelName)}</div>
        </div>
        <span class="summary-score-pill ${scoreCls}">${scoreStr}</span>
      </div>
    </div>
  `;
}

// ===== Level 0: Overview =====

function _renderOverview(panel: HTMLElement): void {
  const areas = _taxonomy?.areas ?? [];

  const areaCards = areas.map((area) => {
    const areaScore = _computeAreaScore(area.id);
    const cls = scoreToClass(areaScore);
    const scoreStr = formatScore(areaScore);
    const interp = _scoreInterpretation(areaScore);
    return `
      <div class="area-card" data-area-id="${_esc(area.id)}"
           role="button" tabindex="0">
        <div class="area-card-top">
          <div class="area-card-header">
            <span class="area-card-icon"><i class="fa-solid ${_esc(area.icon)}"></i></span>
            <span class="area-card-name">${_esc(area.name)}</span>
          </div>
          <div class="area-score-badge ${_esc(cls)}">${_esc(scoreStr)}</div>
        </div>
        <div class="area-card-interp ${_esc(cls)}">${_esc(interp)}</div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div class="sidebar-content">
      <div class="sb-section-header">Well-being Areas</div>
      <div class="summary-section" style="padding-top:6px">
        <div class="area-cards-list">${areaCards}</div>
      </div>

      <div class="sb-section-header">Score Scale</div>
      <div class="summary-section" style="padding-top:8px">
        <div class="summary-scale-row">
          <span class="summary-score-pill negative">−1</span>
          <span class="summary-scale-label">AI consistently harms this dimension</span>
        </div>
        <div class="summary-scale-row">
          <span class="summary-score-pill neutral">0</span>
          <span class="summary-scale-label">No net effect on well-being</span>
        </div>
        <div class="summary-scale-row">
          <span class="summary-score-pill positive">+1</span>
          <span class="summary-scale-label">AI consistently benefits this dimension</span>
        </div>
      </div>
    </div>
  `;

  panel.querySelectorAll<HTMLElement>('.area-card').forEach((card) => {
    const areaId = card.dataset.areaId ?? '';
    const handler = () => _push({ type: 'area', areaId });
    card.addEventListener('click', handler);
    card.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') handler(); });
  });
}

// ===== Level 1: Area Detail =====

function _renderArea(panel: HTMLElement, areaId: string): void {
  if (!_taxonomy) { _renderOverview(panel); return; }
  const area = _taxonomy.areas.find((a) => a.id === areaId);
  if (!area) { _renderOverview(panel); return; }

  const areaDesc = AREA_DESCRIPTIONS[areaId] ?? '';
  const areaScore = _computeAreaScore(areaId);
  const audienceInsight = _getAudienceInsight(areaId);
  const insightColors = _scoreColors(areaScore);

  const subareaRows = area.subareas.map((sub) => {
    const score = _computeSubareaScore(sub.id);
    const cls = scoreToClass(score);
    const str = formatScore(score);
    const subDesc = SUBAREA_DESCRIPTIONS[sub.id] ?? '';
    return `
      <div class="subarea-row" data-subarea-id="${_esc(sub.id)}" role="button" tabindex="0">
        <div class="subarea-row-main">
          <span class="subarea-row-icon"><i class="fa-solid ${_esc(sub.icon)}"></i></span>
          <span class="subarea-row-name">${_esc(sub.name)}</span>
          <span class="summary-score-pill ${_esc(cls)}">${_esc(str)}</span>
        </div>
        ${subDesc ? `<div class="subarea-row-def">${_esc(subDesc)}</div>` : ''}
      </div>
    `;
  }).join('');

  const insightHtml = audienceInsight
    ? `<div class="audience-insight-box" style="border-color:${insightColors.border};background:${insightColors.light}">
         <div class="audience-insight-text">${_esc(audienceInsight)}</div>
       </div>`
    : '';

  panel.innerHTML = `
    <div class="sidebar-content">
      ${_stickyNavHead('WELL-BEING AREA', area.name, area.icon, areaScore)}

      <div class="sidebar-content-body">
        ${areaDesc || insightHtml ? `<div class="summary-section">
          ${areaDesc ? `<p class="summary-text">${_esc(areaDesc)}</p>` : ''}
          ${insightHtml}
        </div>` : ''}

        <div class="sb-section-header">Subareas</div>
        <div class="summary-section" style="padding-top:6px">
          <div class="subarea-list">${subareaRows}</div>
        </div>
      </div>
    </div>
  `;

  _bindBackAndAncestors(panel);
  panel.querySelectorAll<HTMLElement>('.subarea-row').forEach((row) => {
    const subareaId = row.dataset.subareaId ?? '';
    const handler = () => _push({ type: 'subarea', subareaId });
    row.addEventListener('click', handler);
    row.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') handler(); });
  });
}

// ===== Level 2: Subarea Detail =====

function _renderSubarea(panel: HTMLElement, subareaId: string): void {
  if (!_taxonomy) { _renderOverview(panel); return; }

  let subarea: { id: string; name: string; icon: string; behaviors: { id: string; name: string; valence: 'positive' | 'negative'; description?: string }[] } | undefined;
  let parentAreaId = '';

  for (const area of _taxonomy.areas) {
    const found = area.subareas.find((s) => s.id === subareaId);
    if (found) { subarea = found; parentAreaId = area.id; break; }
  }
  if (!subarea) { _renderOverview(panel); return; }

  const subDesc = SUBAREA_DESCRIPTIONS[subareaId] ?? '';
  const subareaScore = _computeSubareaScore(subareaId);

  const behaviors = subarea.behaviors.map((b) => ({
    id: b.id, name: b.name, valence: b.valence, score: _scores[b.id] ?? 0,
  }));

  let sorted = [...behaviors];
  if (_behaviorSort === 'score-desc') sorted.sort((a, b) => b.score - a.score);
  else if (_behaviorSort === 'score-asc') sorted.sort((a, b) => a.score - b.score);
  else sorted.sort((a, b) => a.name.localeCompare(b.name));

  const posCount = behaviors.filter((b) => b.score > 0.05).length;
  const negCount = behaviors.filter((b) => b.score < -0.05).length;
  const posAvg = posCount ? behaviors.filter((b) => b.score > 0.05).reduce((s, b) => s + b.score, 0) / posCount : 0;
  const negAvg = negCount ? behaviors.filter((b) => b.score < -0.05).reduce((s, b) => s + b.score, 0) / negCount : 0;

  const behaviorRows = sorted.map((b) => {
    const cls = scoreToClass(b.score);
    const str = formatScore(b.score);
    const dotColor = b.valence === 'positive' ? 'var(--positive)' : 'var(--negative)';
    return `
      <div class="behavior-row" data-behavior-id="${_esc(b.id)}" role="button" tabindex="0">
        <span class="behavior-valence-dot" style="background:${dotColor}"></span>
        <span class="behavior-row-name">${_esc(b.name)}</span>
        <span class="summary-score-pill ${_esc(cls)}">${_esc(str)}</span>
      </div>
    `;
  }).join('');

  const sortBtn = (mode: SortMode, label: string) =>
    `<button class="sort-btn${_behaviorSort === mode ? ' active' : ''}" data-sort="${mode}">${label}</button>`;

  void parentAreaId; // used in ancestor lookup via _getAncestors()

  panel.innerHTML = `
    <div class="sidebar-content">
      ${_stickyNavHead('SUBAREA', subarea.name, subarea.icon, subareaScore, 'sb-level-subarea')}

      <div class="sidebar-content-body">
        ${subDesc ? `<div class="summary-section"><p class="summary-text">${_esc(subDesc)}</p></div>` : ''}

        <div class="sb-section-header">Impact Breakdown</div>
        <div class="summary-section" style="padding-top:4px">
          <div class="summary-dual-bars">
            <div class="summary-bar-group">
              <div class="summary-bar-header">
                <span class="summary-bar-label positive-label"><i class="fa-solid fa-circle-plus"></i> Beneficial</span>
                <span class="summary-bar-count">${posCount} behaviors</span>
              </div>
              <div class="summary-bar-track">
                <div class="summary-bar-fill positive-fill" style="width:${Math.round(Math.abs(posAvg) * 100)}%"></div>
              </div>
              <div class="summary-bar-score positive-score">${posAvg > 0 ? '+' : ''}${posAvg.toFixed(2)}</div>
            </div>
            <div class="summary-bar-group">
              <div class="summary-bar-header">
                <span class="summary-bar-label negative-label"><i class="fa-solid fa-circle-minus"></i> Harmful</span>
                <span class="summary-bar-count">${negCount} behaviors</span>
              </div>
              <div class="summary-bar-track">
                <div class="summary-bar-fill negative-fill" style="width:${Math.round(Math.abs(negAvg) * 100)}%"></div>
              </div>
              <div class="summary-bar-score negative-score">${negAvg.toFixed(2)}</div>
            </div>
            <div class="summary-bar-total">${behaviors.length} total indicators</div>
          </div>
        </div>

        <div class="sb-section-header">
          All Behaviors
          <span class="sb-section-header-sort">
            ${sortBtn('score-desc', 'Score ↓')}
            ${sortBtn('score-asc', 'Score ↑')}
            ${sortBtn('name-asc', 'A–Z')}
          </span>
        </div>
        <div class="summary-section" style="padding-top:4px">
          <div class="behavior-list">${behaviorRows}</div>
        </div>
      </div>
    </div>
  `;

  _bindBackAndAncestors(panel);

  panel.querySelectorAll<HTMLButtonElement>('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _behaviorSort = (btn.dataset.sort ?? 'score-desc') as SortMode;
      _renderSubarea(panel, subareaId);
    });
  });

  panel.querySelectorAll<HTMLElement>('.behavior-row').forEach((row) => {
    const behaviorId = row.dataset.behaviorId ?? '';
    const handler = () => _push({ type: 'behavior', behaviorId });
    row.addEventListener('click', handler);
    row.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') handler(); });
  });
}

// ===== Level 3: Behavior Detail =====

function _renderBehavior(panel: HTMLElement, behaviorId: string): void {
  const behData = _findBehavior(behaviorId);
  if (!behData) { _renderOverview(panel); return; }

  const { behavior } = behData;
  const score = _scores[behaviorId] ?? 0;
  const scenarios = generateScenarios(behaviorId, behavior.name, behavior.valence, score);

  const scenarioCards = scenarios.map((sc, idx) => {
    const cls = scoreToClass(sc.overallScore);
    const str = formatScore(sc.overallScore);
    const barPct = Math.round(Math.abs(sc.overallScore) * 100);
    const barColor = sc.overallScore > 0.05 ? 'var(--positive)' : sc.overallScore < -0.05 ? 'var(--negative)' : 'var(--text-muted)';
    return `
      <div class="scenario-card" data-scenario-index="${idx}" role="button" tabindex="0">
        <div class="scenario-card-header">
          <span class="scenario-card-title">${_esc(sc.title)}</span>
          <span class="summary-score-pill ${_esc(cls)}">${_esc(str)}</span>
        </div>
        <div class="scenario-card-context">${_esc(sc.context)}</div>
        <div class="scenario-score-bar">
          <div class="scenario-score-bar-fill" style="width:${barPct}%;background:${barColor}"></div>
        </div>
        <div class="scenario-card-hint">Click to view chatlog →</div>
      </div>
    `;
  }).join('');

  const valenceColor = behavior.valence === 'positive' ? 'var(--positive)' : 'var(--negative)';
  const valenceLabel = behavior.valence === 'positive' ? 'Beneficial behavior' : 'Potentially harmful behavior';

  panel.innerHTML = `
    <div class="sidebar-content">
      ${_stickyNavHead('BEHAVIOR INDICATOR', behavior.name, null, score, 'sb-level-behavior')}

      <div class="sidebar-content-body">
        <div class="summary-section">
          <div class="sb-behavior-meta">
            <span class="behavior-valence-dot" style="background:${valenceColor}"></span>
            <span style="font-size:12px;color:${valenceColor};font-weight:600">${_esc(valenceLabel)}</span>
          </div>
          ${behavior.description ? `<p class="summary-text" style="margin-top:6px">${_esc(behavior.description)}</p>` : ''}
        </div>

        <div class="sb-section-header">Test Scenarios</div>
        <div class="summary-section" style="padding-top:4px">
          <div class="scenario-list">${scenarioCards}</div>
        </div>
      </div>
    </div>
  `;

  _bindBackAndAncestors(panel);

  panel.querySelectorAll<HTMLElement>('.scenario-card').forEach((card) => {
    const idx = parseInt(card.dataset.scenarioIndex ?? '0', 10);
    const handler = () => _push({ type: 'chatlog', behaviorId, scenarioIndex: idx });
    card.addEventListener('click', handler);
    card.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') handler(); });
  });
}

// ===== Level 4: Chatlog =====

function _renderChatlog(panel: HTMLElement, behaviorId: string, scenarioIndex: number): void {
  const behData = _findBehavior(behaviorId);
  if (!behData) { _renderOverview(panel); return; }

  const { behavior } = behData;
  const score = _scores[behaviorId] ?? 0;
  const scenarios = generateScenarios(behaviorId, behavior.name, behavior.valence, score);
  const sc = scenarios[scenarioIndex];
  if (!sc) { _renderOverview(panel); return; }

  const turnsHtml = sc.turns.map((turn) => {
    if (turn.role === 'user') {
      return `
        <div class="chat-turn chat-turn-user">
          <div class="chat-turn-label">User</div>
          <div class="chat-turn-bubble user-bubble">${_esc(turn.content)}</div>
        </div>
      `;
    }
    const ts = turn.score ?? 0;
    let badgeCls = 'score-neutral';
    if (ts > 0.05) badgeCls = 'score-positive';
    else if (ts < -0.05) badgeCls = 'score-negative';
    return `
      <div class="chat-turn chat-turn-ai">
        <div class="chat-turn-label">
          AI Response
          <span class="chat-turn-score ${_esc(badgeCls)}">${_esc(formatScore(ts))}</span>
        </div>
        <div class="chat-turn-bubble ai-bubble">${_esc(turn.content)}</div>
        ${turn.evaluation ? `<div class="chat-turn-evaluation">${_esc(turn.evaluation)}</div>` : ''}
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div class="sidebar-content">
      ${_stickyNavHead('TEST SCENARIO', sc.title, null, sc.overallScore, 'sb-level-scenario')}

      <div class="sidebar-content-body">
        <div class="summary-section">
          <p class="summary-text">${_esc(sc.context)}</p>
        </div>

        <div class="sb-section-header">Conversation</div>
        <div class="summary-section" style="padding-top:6px">
          <div class="chatlog">${turnsHtml}</div>
        </div>
      </div>
    </div>
  `;

  _bindBackAndAncestors(panel);
}

// ===== Score Computation =====

function _computeAreaScore(areaId: string): number {
  if (!_taxonomy) return 0;
  const area = _taxonomy.areas.find((a) => a.id === areaId);
  if (!area) return 0;
  const scores: number[] = [];
  for (const sub of area.subareas)
    for (const beh of sub.behaviors) { const s = _scores[beh.id]; if (s !== undefined) scores.push(s); }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

function _computeSubareaScore(subareaId: string): number {
  if (!_taxonomy) return 0;
  for (const area of _taxonomy.areas) {
    const sub = area.subareas.find((s) => s.id === subareaId);
    if (sub) {
      const scores = sub.behaviors.map((b) => _scores[b.id] ?? 0);
      return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    }
  }
  return 0;
}

function _findSubareaIdByName(name: string): string | null {
  if (!_taxonomy) return null;
  const n = name.toLowerCase().trim();
  for (const area of _taxonomy.areas)
    for (const sub of area.subareas)
      if (sub.name.toLowerCase().trim() === n) return sub.id;
  return null;
}

function _findBehavior(behaviorId: string): {
  behavior: { id: string; name: string; valence: 'positive' | 'negative'; description?: string };
  subareaName: string;
} | null {
  if (!_taxonomy) return null;
  for (const area of _taxonomy.areas)
    for (const sub of area.subareas) {
      const beh = sub.behaviors.find((b) => b.id === behaviorId);
      if (beh) return { behavior: beh, subareaName: sub.name };
    }
  return null;
}

function _getAudienceInsight(areaId: string): string {
  const map = AUDIENCE_AREA_INSIGHTS[_currentAudience] ?? AUDIENCE_AREA_INSIGHTS['generic'] ?? {};
  return map[areaId] ?? '';
}

function _esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Audience tracking =====

(function _watchAudience() {
  document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('filter-audience') as HTMLSelectElement | null;
    if (sel) {
      _currentAudience = sel.value || 'generic';
      sel.addEventListener('change', () => { _currentAudience = sel.value || 'generic'; });
    }
  });
})();
