import type { AIModel, BenchmarkData, Taxonomy } from './types';
import { scoreToColor, formatScore, scoreToClass } from './color-scale';
import { makeBenchmarkKey } from './data-loader';

// ===== Module State =====

let _models: AIModel[] = [];
let _benchmarkData: BenchmarkData = {};
let _taxonomy: Taxonomy = { areas: [] };
let _onModelSelect: (modelId: string) => void = () => {};
let _audience = 'generic';
let _age = 'adult';
let _gender = 'all';
let _selectedAreaId: string | null = null;
let _selectedSubareaId: string | null = null;

// ===== Score Computation =====

function computeScore(
  modelId: string,
  areaId: string | null,
  subareaId: string | null
): number {
  const key = makeBenchmarkKey(modelId, _audience, _age, _gender);
  const scores = _benchmarkData[key];
  if (!scores) return 0;

  if (!areaId) {
    const vals = Object.values(scores);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  const behaviorIds: string[] = [];
  for (const area of _taxonomy.areas) {
    if (area.id !== areaId) continue;
    for (const sub of area.subareas) {
      if (subareaId && sub.id !== subareaId) continue;
      for (const b of sub.behaviors) behaviorIds.push(b.id);
    }
  }

  if (behaviorIds.length === 0) return 0;
  const vals = behaviorIds.map((id) => scores[id] ?? 0);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ===== Render Rankings =====

function renderRankings(): void {
  const list = document.getElementById('leaderboard-list');
  if (!list) return;

  const ranked = _models
    .map((m) => ({ model: m, score: computeScore(m.id, _selectedAreaId, _selectedSubareaId) }))
    .sort((a, b) => b.score - a.score);

  list.innerHTML = '';
  ranked.forEach(({ model, score }, idx) => {
    const rank = idx + 1;
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.dataset.modelId = model.id;

    const pct = Math.round(((score + 1) / 2) * 100);
    const colorHex = scoreToColor(score);
    const scoreClass = scoreToClass(score);
    const scoreStr = formatScore(score);
    const rankClass = rank <= 3 ? 'lb-rank top-3' : 'lb-rank';

    row.innerHTML = `
      <span class="${rankClass}">${rank}</span>
      <div class="lb-info">
        <div class="lb-name">${model.name}</div>
        <div class="lb-provider">${model.provider}</div>
      </div>
      <div class="lb-bar-track">
        <div class="lb-bar-fill" style="width:${pct}%;background:${colorHex}"></div>
      </div>
      <span class="lb-score-badge ${scoreClass}">${scoreStr}</span>
    `;

    row.addEventListener('click', () => {
      selectLeaderboardModel(model.id);
      _onModelSelect(model.id);
    });

    list.appendChild(row);
  });
}

// ===== Area / Subarea Filter Tabs =====

function renderAreaTabs(): void {
  const container = document.getElementById('lb-area-filter');
  if (!container) return;

  container.innerHTML = '';

  // "All Areas" tab
  const allBtn = document.createElement('button');
  allBtn.className = 'lb-area-tab' + (_selectedAreaId === null ? ' active' : '');
  allBtn.textContent = 'All Areas';
  allBtn.addEventListener('click', () => {
    _selectedAreaId = null;
    _selectedSubareaId = null;
    renderAreaTabs();
    renderRankings();
    updateSubtitle(null, null);
  });
  container.appendChild(allBtn);

  for (const area of _taxonomy.areas) {
    const btn = document.createElement('button');
    btn.className = 'lb-area-tab' + (_selectedAreaId === area.id ? ' active' : '');
    btn.textContent = area.name;
    btn.dataset.areaId = area.id;
    btn.addEventListener('click', () => {
      _selectedAreaId = area.id;
      _selectedSubareaId = null;
      renderAreaTabs();
      renderSubareaTabs(area.id);
      renderRankings();
      updateSubtitle(area.name, null);
    });
    container.appendChild(btn);
  }

  // Render subareas if area is selected
  if (_selectedAreaId) {
    renderSubareaTabs(_selectedAreaId);
  } else {
    const subRow = document.getElementById('lb-subarea-filter');
    if (subRow) subRow.innerHTML = '';
  }
}

function renderSubareaTabs(areaId: string): void {
  const container = document.getElementById('lb-subarea-filter');
  if (!container) return;

  const area = _taxonomy.areas.find((a) => a.id === areaId);
  if (!area) return;

  container.innerHTML = '';

  // "All [area]" tab
  const allBtn = document.createElement('button');
  allBtn.className = 'lb-subarea-tab' + (_selectedSubareaId === null ? ' active' : '');
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => {
    _selectedSubareaId = null;
    renderSubareaTabs(areaId);
    renderRankings();
    updateSubtitle(area.name, null);
  });
  container.appendChild(allBtn);

  for (const sub of area.subareas) {
    const btn = document.createElement('button');
    btn.className = 'lb-subarea-tab' + (_selectedSubareaId === sub.id ? ' active' : '');
    btn.textContent = sub.name;
    btn.dataset.subareaId = sub.id;
    btn.addEventListener('click', () => {
      _selectedSubareaId = sub.id;
      renderSubareaTabs(areaId);
      renderRankings();
      updateSubtitle(area.name, sub.name);
    });
    container.appendChild(btn);
  }
}

function updateSubtitle(areaName: string | null, subareaName: string | null): void {
  const el = document.getElementById('leaderboard-subtitle');
  if (!el) return;
  if (!areaName) {
    el.textContent = 'Rankings reflect average impact across all 260 behavioral indicators.';
  } else if (!subareaName) {
    el.textContent = `Rankings filtered to the ${areaName} area.`;
  } else {
    el.textContent = `Rankings filtered to ${subareaName} (${areaName}).`;
  }
}

// ===== Init =====

export function initLeaderboard(
  models: AIModel[],
  benchmarkData: BenchmarkData,
  taxonomy: Taxonomy,
  onModelSelect: (modelId: string) => void
): void {
  _models = models;
  _benchmarkData = benchmarkData;
  _taxonomy = taxonomy;
  _onModelSelect = onModelSelect;

  renderAreaTabs();
  renderRankings();
}

// ===== Update Filters (called when audience/age/gender changes) =====

export function updateLeaderboardFilters(audience: string, age: string, gender: string): void {
  _audience = audience;
  _age = age;
  _gender = gender;
  renderRankings();
}

// ===== Highlight active row =====

export function selectLeaderboardModel(modelId: string): void {
  document.querySelectorAll('.lb-row').forEach((el) => {
    const row = el as HTMLElement;
    row.classList.toggle('active', row.dataset.modelId === modelId);
  });
}
