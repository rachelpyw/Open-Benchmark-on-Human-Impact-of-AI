import type { FilterState, Taxonomy, AIModel, BenchmarkData } from './types';
import {
  loadTaxonomy,
  loadModels,
  loadBenchmarkData,
  getScoresForFilter,
  buildHierarchy,
  buildSubareaDetail,
} from './data-loader';
import { initSunburst, renderSunburst, updateSunburst, resetZoom, highlightAudienceAreas, clearAudienceHighlight, resetZoomFull } from './sunburst';
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
import { AUDIENCE_INFO } from './audience-info';
import './smart-nutrition';

// ===== Model Name Label =====

function updateModelNameLabel(name: string): void {
  const el = document.getElementById('model-name-label');
  if (el) el.textContent = name;
}

// ===== Audience Banner =====

function updateAudienceBanner(audience: string): void {
  const banner = document.getElementById('audience-banner');
  if (!banner) return;

  const info = AUDIENCE_INFO[audience];
  if (!info || !info.description) {
    banner.classList.remove('visible');
    clearAudienceHighlight();
    return;
  }

  const focusHtml = info.focusPoints
    .map((p) => `<span class="audience-focus-tag">${p}</span>`)
    .join('');

  banner.innerHTML = `
    <div class="audience-banner-inner">
      <i class="fa-solid ${info.icon} audience-banner-icon"></i>
      <div class="audience-banner-content">
        <div class="audience-banner-title">${info.label} — What to look for</div>
        <p class="audience-banner-desc">${info.description}</p>
        <div class="audience-banner-tags">${focusHtml}</div>
      </div>
    </div>
  `;
  banner.classList.add('visible');

  // Highlight priority areas in sunburst
  highlightAudienceAreas(info.priorityAreaIds);
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
    setSidebarData(taxonomy, initialScores);

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
  updateLeaderboardFilters(filters.audience, filters.age, filters.gender);

  const activeModel = models?.find((m) => m.id === filters.model);
  showDefaultSummary(
    activeModel?.name ?? filters.model,
    activeModel?.provider ?? ''
  );
  updateModelNameLabel(activeModel?.name ?? filters.model);

  // Re-sync sidebar with new scores
  const newScores = getScoresForFilter(benchmarkData, filters);
  setSidebarData(taxonomy, newScores);

  // Update audience banner and sunburst highlights
  updateAudienceBanner(filters.audience);
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
  setSidebarData(taxonomy, newScores);
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
      detail.behaviors.map((b) => ({
        name: b.name,
        score: b.score,
        valence: b.valence,
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
    const subScores = s.behaviors.map((b) => scores[b.id] ?? 0);
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

document.addEventListener('DOMContentLoaded', main);
