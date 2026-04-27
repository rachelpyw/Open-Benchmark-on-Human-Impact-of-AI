import type { FilterState, Taxonomy, AIModel, BenchmarkData } from './types';
import {
  loadTaxonomy,
  loadModels,
  loadBenchmarkData,
  getScoresForFilter,
  buildHierarchy,
  buildSubareaDetail,
} from './data-loader';
import { initSunburst, renderSunburst, updateSunburst, resetZoom, resetZoomFull } from './sunburst';
import { initControls, getCurrentFilters } from './controls';
import { initTooltip } from './tooltip';
import { initLeaderboard, selectLeaderboardModel, updateLeaderboardFilters } from './leaderboard';
import {
  initSummaryPanel,
  showDefaultSummary,
  showAreaSummary,
  showSubareaSummary,
  setSidebarData,
  navigateToArea,
  navigateToSubarea,
} from './sidebar';
import { AREA_DESCRIPTIONS, SUBAREA_DESCRIPTIONS } from './descriptions';
import './smart-nutrition';

// ===== Global score tooltip =====
function initScoreTooltip(): void {
  const tip = document.createElement('div');
  tip.className = 'score-tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let active: Element | null = null;

  const hide = () => { tip.classList.remove('visible'); active = null; };

  const position = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    tip.style.maxWidth = '260px';
    // Render to measure
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let top = r.top - th - 10;
    let left = r.left + r.width / 2 - tw / 2;
    if (top < 8) top = r.bottom + 10;
    if (left < 8) left = 8;
    if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
    tip.style.top = top + 'px';
    tip.style.left = left + 'px';
  };

  document.addEventListener('mouseover', (e) => {
    const t = (e.target as Element | null)?.closest?.('[data-score-tip]');
    if (!t || t === active) return;
    active = t;
    tip.textContent = (t as HTMLElement).getAttribute('data-score-tip') ?? '';
    tip.classList.add('visible');
    position(t);
  });
  document.addEventListener('mouseout', (e) => {
    const t = (e.target as Element | null)?.closest?.('[data-score-tip]');
    if (t && t === active) hide();
  });
  document.addEventListener('scroll', hide, true);
}

// ===== Model Name Label =====

function updateModelNameLabel(name: string): void {
  const el = document.getElementById('model-name-label');
  if (el) el.textContent = name;
}

// ===== App State =====

let taxonomy: Taxonomy;
let models: AIModel[];
let benchmarkData: BenchmarkData;
let currentFilters: FilterState;

// ===== Bootstrap =====

async function main(): Promise<void> {
  initTooltip();
  initSummaryPanel();

  initSunburst('sunburst-svg', {
    onSubareaClick: handleSubareaClick,
    onAreaClick: handleAreaClick,
    onCenterClick: handleCenterClick,
  });

  try {
    [taxonomy, models, benchmarkData] = await Promise.all([
      loadTaxonomy(),
      loadModels(),
      loadBenchmarkData(),
    ]);

    currentFilters = initControls(models, handleFilterChange);

    initLeaderboard(models, benchmarkData, taxonomy, handleLeaderboardModelSelect);

    selectLeaderboardModel(currentFilters.model);

    const initialModel = models.find((m) => m.id === currentFilters.model);
    showDefaultSummary(
      initialModel?.name ?? currentFilters.model,
      initialModel?.provider ?? ''
    );
    updateModelNameLabel(initialModel?.name ?? currentFilters.model);

    // Provide full taxonomy + scores to sidebar for deep navigation
    const initialScores = getScoresForFilter(benchmarkData, currentFilters);
    setSidebarData(taxonomy, initialScores, currentFilters.model);

    renderWithFilters(currentFilters, false);

    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');

  } catch (err) {
    console.error('Failed to load data:', err);
    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML = `
        <div style="text-align:center;padding:20px;">
          <i class="fa-solid fa-circle-exclamation" style="font-size:32px;color:#dc2626;margin-bottom:12px;"></i>
          <p style="color:#dc2626;font-weight:600;">Failed to load data</p>
          <p style="color:#6b7280;font-size:13px;margin-top:8px;">${(err as Error).message}</p>
        </div>
      `;
    }
  }
}

// ===== Rendering =====

function renderWithFilters(filters: FilterState, animate: boolean): void {
  const scores = getScoresForFilter(benchmarkData, filters);
  const hierarchyData = buildHierarchy(taxonomy, scores);

  if (animate) {
    updateSunburst(hierarchyData);
  } else {
    renderSunburst(hierarchyData, false);
  }
}

// ===== Event Handlers =====

function handleFilterChange(filters: FilterState): void {
  currentFilters = filters;
  renderWithFilters(filters, true);
  selectLeaderboardModel(filters.model);
  updateLeaderboardFilters(filters.age);

  const activeModel = models?.find((m) => m.id === filters.model);
  showDefaultSummary(
    activeModel?.name ?? filters.model,
    activeModel?.provider ?? ''
  );
  updateModelNameLabel(activeModel?.name ?? filters.model);

  // Re-sync sidebar with new scores
  const newScores = getScoresForFilter(benchmarkData, filters);
  setSidebarData(taxonomy, newScores, filters.model);
}

function handleLeaderboardModelSelect(modelId: string): void {
  const modelSelect = document.getElementById('filter-model') as HTMLSelectElement | null;
  if (modelSelect) {
    modelSelect.value = modelId;
  }
  const updatedFilters = { ...getCurrentFilters(), model: modelId };
  currentFilters = updatedFilters;
  renderWithFilters(updatedFilters, true);

  const activeModel = models?.find((m) => m.id === modelId);
  showDefaultSummary(
    activeModel?.name ?? modelId,
    activeModel?.provider ?? ''
  );
  updateModelNameLabel(activeModel?.name ?? modelId);

  // Sync sidebar scores so model strip updates immediately
  const newScores = getScoresForFilter(benchmarkData, updatedFilters);
  setSidebarData(taxonomy, newScores, modelId);
}

function handleSubareaClick(subareaId: string): void {
  const scores = getScoresForFilter(benchmarkData, currentFilters);
  const detail = buildSubareaDetail(taxonomy, scores, subareaId);
  if (detail) {
    const subareaDesc = SUBAREA_DESCRIPTIONS[subareaId] ?? '';
    showSubareaSummary(
      detail.name,
      subareaDesc,
      detail.avgScore,
      detail.metrics.map((m) => ({
        name: m.name,
        score: m.score,
        valence: m.harmful ? 'negative' : 'positive',
      }))
    );
    // Navigate sidebar to subarea
    navigateToSubarea(subareaId);
    // Notify smart-explore layer (inline script) so it can inject focus extras
    try {
      window.dispatchEvent(new CustomEvent('smart-subarea-opened', { detail: { subareaId } }));
    } catch {
      /* ignore */
    }
  }
}

// Expose for inline smart-explore script
(window as unknown as { __openSubarea?: (id: string) => void }).__openSubarea =
  handleSubareaClick;

function handleAreaClick(areaId: string): void {
  // Look up area directly from taxonomy to avoid D3 sort order issues
  const area = taxonomy.areas.find((a) => a.id === areaId);
  if (!area) return;

  const scores = getScoresForFilter(benchmarkData, currentFilters);
  const areaDesc = AREA_DESCRIPTIONS[areaId] ?? '';
  const subareas = area.subareas.map((s) => {
    const subScores = s.metrics.map((m) => scores[m.id] ?? 0);
    const avg = subScores.length ? subScores.reduce((a, b) => a + b, 0) / subScores.length : 0;
    return { name: s.name, score: avg };
  });

  showAreaSummary(areaId, area.name, areaDesc, subareas);
  navigateToArea(areaId);
}

function handleCenterClick(): void {
  resetZoom();
  resetZoomFull();
  const activeModel = models?.find((m) => m.id === currentFilters?.model);
  if (activeModel) {
    showDefaultSummary(activeModel.name, activeModel.provider);
  }
}

// ===== Start =====

document.addEventListener('DOMContentLoaded', () => { main(); initScoreTooltip(); });
