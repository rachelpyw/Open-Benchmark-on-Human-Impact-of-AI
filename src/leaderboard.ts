import type { AIModel, BenchmarkData, Taxonomy } from './types';
import { formatScore, scoreToClass } from './color-scale';
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

interface SplitScore {
  avg: number;   // overall average (for ranking)
  pos: number;   // average of positive-valenced behaviors [0..1]
  neg: number;   // average of negative-valenced behaviors [-1..0]
}

function computeSplitScore(
  modelId: string,
  areaId: string | null,
  subareaId: string | null
): SplitScore {
  const key = makeBenchmarkKey(modelId, _audience, _age, _gender);
  const scores = _benchmarkData[key];
  if (!scores) return { avg: 0, pos: 0, neg: 0 };

  // Collect behaviors with their valence
  const behaviors: Array<{ id: string; valence: 'positive' | 'negative' }> = [];

  for (const area of _taxonomy.areas) {
    if (areaId && area.id !== areaId) continue;
    for (const sub of area.subareas) {
      if (subareaId && sub.id !== subareaId) continue;
      for (const b of sub.behaviors) behaviors.push({ id: b.id, valence: b.valence });
    }
  }

  if (behaviors.length === 0) return { avg: 0, pos: 0, neg: 0 };

  const posVals = behaviors.filter((b) => b.valence === 'positive').map((b) => scores[b.id] ?? 0);
  const negVals = behaviors.filter((b) => b.valence === 'negative').map((b) => scores[b.id] ?? 0);
  const allVals = behaviors.map((b) => scores[b.id] ?? 0);

  const pos = posVals.length ? posVals.reduce((a, b) => a + b, 0) / posVals.length : 0;
  const neg = negVals.length ? negVals.reduce((a, b) => a + b, 0) / negVals.length : 0;
  const avg = allVals.reduce((a, b) => a + b, 0) / allVals.length;

  return { avg, pos, neg };
}

// ===== Render Rankings =====

function renderRankings(): void {
  const list = document.getElementById('leaderboard-list');
  if (!list) return;

  const ranked = _models
    .map((m) => ({ model: m, split: computeSplitScore(m.id, _selectedAreaId, _selectedSubareaId) }))
    .sort((a, b) => b.split.avg - a.split.avg);

  list.innerHTML = '';
  ranked.forEach(({ model, split }, idx) => {
    const rank = idx + 1;
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.dataset.modelId = model.id;

    // Positive bar: grows right from center (0..100% of positive half)
    const posPct = Math.max(0, Math.min(100, split.pos * 100));
    // Negative bar: grows left from center (0..100% of negative half)
    const negPct = Math.max(0, Math.min(100, Math.abs(split.neg) * 100));

    const scoreClass = scoreToClass(split.avg);
    const scoreStr = formatScore(split.avg);
    const rankClass = rank <= 3 ? 'lb-rank top-3' : 'lb-rank';

    row.innerHTML = `
      <span class="${rankClass}">${rank}</span>
      <div class="lb-info">
        <div class="lb-name">${model.name}</div>
        <div class="lb-provider">${model.provider}</div>
      </div>
      <div class="lb-split-track" aria-hidden="true"
           title="Beneficial behaviors: ${formatScore(split.pos)} | Harmful behaviors: ${formatScore(split.neg)}">
        <div class="lb-split-neg-half">
          <div class="lb-split-neg-fill" style="width:${negPct}%"></div>
        </div>
        <div class="lb-split-center"></div>
        <div class="lb-split-pos-half">
          <div class="lb-split-pos-fill" style="width:${posPct}%"></div>
        </div>
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
