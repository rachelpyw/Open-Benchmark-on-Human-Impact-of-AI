import * as d3 from 'd3';
import type { SunburstNodeData } from './types';
import { scoreToColor } from './color-scale';
import { showTooltip, moveTooltip, hideTooltip } from './tooltip';

// ===== Constants =====

const CENTER_R = 100;           // center image circle radius
const RING1_INNER = 105;        // area ring inner radius
const RING1_OUTER = 195;        // area ring outer radius
const RING2_INNER = 200;        // subarea ring inner radius
const RING2_OUTER = 295;        // subarea ring outer radius
const RING3_INNER = 300;        // behavior ring inner radius
const RING3_OUTER = 415;        // behavior ring outer radius

const TRANSITION_DURATION = 500;

// ===== State =====

let svgEl: SVGSVGElement;
let rootSvg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
let g: d3.Selection<SVGGElement, unknown, null, undefined>;
let currentData: SunburstNodeData | null = null;
let _isZoomed = false;

type ArcDatum = d3.HierarchyRectangularNode<SunburstNodeData>;

// Behavior arc data type
interface BehaviorArcDatum {
  id: string;
  name: string;
  score: number;
  valence: 'positive' | 'negative';
  x0: number;
  x1: number;
}

// Callbacks
let onSubareaClick: ((subareaId: string) => void) | null = null;
let onAreaClick: ((areaId: string) => void) | null = null;

// ===== Init =====

export function initSunburst(
  containerId: string,
  callbacks: {
    onSubareaClick: (subareaId: string) => void;
    onAreaClick: (areaId: string) => void;
    onCenterClick: () => void;
  }
): void {
  onSubareaClick = callbacks.onSubareaClick;
  onAreaClick = callbacks.onAreaClick;

  svgEl = document.getElementById(containerId) as unknown as SVGSVGElement;
  rootSvg = d3.select(svgEl);

  const size = Math.min(960, window.innerWidth - 80);
  const svgSize = Math.min(size, 900);

  rootSvg
    .attr('width', svgSize)
    .attr('height', svgSize)
    .attr('viewBox', `${-svgSize / 2} ${-svgSize / 2} ${svgSize} ${svgSize}`);

  g = rootSvg.append('g').attr('class', 'sunburst-g');

  window.addEventListener('resize', () => {
    if (currentData) updateLayout();
  });
}

function updateLayout(): void {
  const wrapper = document.getElementById('sunburst-wrapper')!;
  const size = Math.min(wrapper.clientWidth - 48, 860);

  rootSvg
    .attr('width', size)
    .attr('height', size)
    .attr('viewBox', `${-size / 2} ${-size / 2} ${size} ${size}`);
}

// ===== Render =====

export function renderSunburst(data: SunburstNodeData, animate = false): void {
  currentData = data;
  g.selectAll('*').remove();

  const hierarchy = buildD3Hierarchy(data);
  drawArcs(hierarchy, animate);
  drawCenterImage();
}

export function updateSunburst(data: SunburstNodeData): void {
  currentData = data;
  const hierarchy = buildD3Hierarchy(data);
  transitionArcs(hierarchy);
}

// ===== D3 Hierarchy =====

function buildD3Hierarchy(data: SunburstNodeData): ArcDatum[] {
  // Build the partition layout — always show areas and subareas only (no behaviors by default)
  const root = d3.hierarchy<SunburstNodeData>(data, (d) => {
    if (d.type === 'root') return d.children ?? [];
    if (d.type === 'area') return d.children ?? [];
    return [];
  });

  // Equal-size arcs: each subarea gets 1/(number of siblings) so all areas occupy equal angles
  root.sum((d) => {
    if (d.type === 'subarea') {
      const parentArea = (data.children ?? []).find((area) =>
        area.children?.some((s) => s.id === d.id)
      );
      const nSib = parentArea?.children?.length ?? 1;
      return 1 / nSib;
    }
    return 0;
  });
  // No sort — preserve original taxonomy order

  const partition = d3.partition<SunburstNodeData>().size([2 * Math.PI, 1]);
  partition(root);

  return root.descendants().filter((d) => d.depth > 0) as ArcDatum[];
}

// ===== Draw Arcs =====

function getArcPath(d: ArcDatum): string {
  const innerR = d.depth === 1 ? RING1_INNER : d.depth === 2 ? RING2_INNER : RING3_INNER;
  const outerR = d.depth === 1 ? RING1_OUTER : d.depth === 2 ? RING2_OUTER : RING3_OUTER;

  const arc = d3.arc<ArcDatum>()
    .innerRadius(innerR)
    .outerRadius(outerR)
    .startAngle((n) => (n as unknown as { x0: number }).x0)
    .endAngle((n) => (n as unknown as { x1: number }).x1)
    .padAngle(0.012)
    .padRadius(150)
    .cornerRadius(3);

  return arc(d) ?? '';
}

function drawArcs(nodes: ArcDatum[], animate: boolean): void {
  const arcGroup = g.append('g').attr('class', 'arcs-group');

  const paths = arcGroup
    .selectAll<SVGPathElement, ArcDatum>('.arc-path')
    .data(nodes, (d) => d.data.id)
    .join('path')
    .attr('class', 'arc-path')
    .attr('data-id', (d) => d.data.id)
    .attr('data-type', (d) => d.data.type)
    .attr('fill', (d) => scoreToColor(d.data.score ?? 0))
    .attr('d', (d) => getArcPath(d));

  if (animate) {
    paths
      .attr('opacity', 0)
      .transition()
      .duration(TRANSITION_DURATION)
      .attr('opacity', 1);
  }

  // Event handlers
  paths
    .on('mouseenter', function (event: MouseEvent, d: ArcDatum) {
      highlightNode(d);
      showTooltip(event, d.data);
    })
    .on('mousemove', (event: MouseEvent) => {
      moveTooltip(event);
    })
    .on('mouseleave', function (_event: MouseEvent, _d: ArcDatum) {
      unhighlightAll(nodes);
      hideTooltip();
    })
    .on('click', function (_event: MouseEvent, d: ArcDatum) {
      if (d.data.type === 'area') {
        onAreaClick?.(d.data.id);
      } else if (d.data.type === 'subarea') {
        onSubareaClick?.(d.data.id);
      }
    });

  // Draw labels
  drawLabels(nodes, arcGroup);
}

// ===== Behavior Arc Drawing =====

function drawBehaviorArcs(
  behaviors: Array<{ id: string; name: string; score: number; valence: 'positive' | 'negative' }>,
  subareaX0: number,
  subareaX1: number
): void {
  // Remove any existing behavior group
  g.select('.behavior-arcs-group').remove();
  g.select('.zoom-back-group').remove();

  const behaviorGroup = g.append('g').attr('class', 'behavior-arcs-group');

  const totalSpan = subareaX1 - subareaX0;
  const perBehavior = totalSpan / Math.max(behaviors.length, 1);

  const behaviorData: BehaviorArcDatum[] = behaviors.map((b, i) => ({
    ...b,
    x0: subareaX0 + i * perBehavior,
    x1: subareaX0 + (i + 1) * perBehavior,
  }));

  const arc = d3.arc<BehaviorArcDatum>()
    .innerRadius(RING3_INNER)
    .outerRadius(RING3_OUTER)
    .startAngle((d) => d.x0)
    .endAngle((d) => d.x1)
    .padAngle(0.008)
    .padRadius(150)
    .cornerRadius(3);

  const paths = behaviorGroup
    .selectAll<SVGPathElement, BehaviorArcDatum>('.behavior-arc')
    .data(behaviorData)
    .join('path')
    .attr('class', 'behavior-arc')
    .attr('data-id', (d) => d.id)
    .attr('fill', (d) => d.score > 0.05 ? '#16a34a' : d.score < -0.05 ? '#dc2626' : '#9ca3af')
    .attr('d', (d) => arc(d) ?? '')
    .attr('opacity', 0);

  // Stagger animation
  paths
    .transition()
    .duration(300)
    .delay((_d, i) => i * 30)
    .attr('opacity', 0.9);

  // Labels on wide enough arcs
  const labelsGroup = behaviorGroup.append('g').attr('class', 'behavior-labels');
  behaviorData.forEach((d) => {
    const span = d.x1 - d.x0;
    if (span < 0.12) return;
    const maxChars = span > 0.25 ? 14 : 8;
    const angle = (d.x0 + d.x1) / 2;
    const midR = (RING3_INNER + RING3_OUTER) / 2;
    const x = Math.sin(angle) * midR;
    const y = -Math.cos(angle) * midR;
    const rotDeg = (angle * 180) / Math.PI - 90;
    const flip = angle > Math.PI ? 180 : 0;

    labelsGroup
      .append('text')
      .attr('class', 'behavior-label')
      .attr('transform', `translate(${x},${y}) rotate(${rotDeg + flip})`)
      .style('text-anchor', 'middle')
      .style('dominant-baseline', 'middle')
      .style('font-size', '8px')
      .style('font-weight', '600')
      .style('fill', '#fff')
      .style('pointer-events', 'none')
      .text(truncate(d.name, maxChars));
  });

  showZoomBackButton();
}

function showZoomBackButton(): void {
  g.select('.zoom-back-group').remove();
  const backGroup = g.append('g').attr('class', 'zoom-back-group').style('cursor', 'pointer');

  backGroup
    .append('circle')
    .attr('class', 'zoom-back-circle')
    .attr('r', 28)
    .attr('fill', 'white');

  backGroup
    .append('text')
    .attr('class', 'zoom-back-text')
    .text('×');

  backGroup.on('click', () => resetZoomFull());
}

// ===== Labels =====

function drawLabels(nodes: ArcDatum[], parent: d3.Selection<SVGGElement, unknown, null, undefined>): void {
  const labelsGroup = parent.append('g').attr('class', 'labels-group');

  // ---- Area labels (depth 1) — curved textPath along arc midline ----
  // With equal arcs each area spans ~2π/3 ≈ 2.09 radians — plenty of space.
  const labelDefs = labelsGroup.append('defs');
  const areaNodes = nodes.filter((d) => d.depth === 1);
  areaNodes.forEach((d) => {
    const x0Raw = (d as unknown as { x0: number }).x0;
    const x1Raw = (d as unknown as { x1: number }).x1;
    const arcSpan = x1Raw - x0Raw;
    if (arcSpan < 0.2) return;

    const midAngle = (x0Raw + x1Raw) / 2;
    const midR = (RING1_INNER + RING1_OUTER) / 2;
    const pathId = `area-label-path-${d.data.id}`;
    const isBottom = midAngle > Math.PI;

    // Clamp to 75% of arc so text never touches the edges
    const clampedSpan = Math.min(arcSpan * 0.75, Math.PI * 0.9);
    const x0 = midAngle - clampedSpan / 2;
    const x1 = midAngle + clampedSpan / 2;
    const largeArc = clampedSpan > Math.PI ? 1 : 0;

    let pathD: string;
    if (!isBottom) {
      const sx = Math.sin(x0) * midR, sy = -Math.cos(x0) * midR;
      const ex = Math.sin(x1) * midR, ey = -Math.cos(x1) * midR;
      pathD = `M ${sx} ${sy} A ${midR} ${midR} 0 ${largeArc} 1 ${ex} ${ey}`;
    } else {
      const sx = Math.sin(x1) * midR, sy = -Math.cos(x1) * midR;
      const ex = Math.sin(x0) * midR, ey = -Math.cos(x0) * midR;
      pathD = `M ${sx} ${sy} A ${midR} ${midR} 0 ${largeArc} 0 ${ex} ${ey}`;
    }

    labelDefs.append('path').attr('id', pathId).attr('d', pathD);

    labelsGroup
      .append('text')
      .attr('class', 'area-label')
      .style('fill', '#111827')
      .style('font-size', '12px')
      .style('font-weight', '800')
      .style('letter-spacing', '0.04em')
      .style('pointer-events', 'none')
      .append('textPath')
      .attr('href', `#${pathId}`)
      .attr('startOffset', '50%')
      .attr('text-anchor', 'middle')
      .text(d.data.name.toUpperCase());
  });

  // ---- Subarea labels (depth 2) — radial text at arc midpoint ----
  // With equal arcs each subarea has ~0.4–0.55 radians of space.
  const subareaNodes = nodes.filter((d) => d.depth === 2);
  subareaNodes.forEach((d) => {
    const x0 = (d as unknown as { x0: number }).x0;
    const x1 = (d as unknown as { x1: number }).x1;
    const arcSpan = x1 - x0;
    if (arcSpan < 0.15) return;

    const angle = (x0 + x1) / 2;
    const midR = (RING2_INNER + RING2_OUTER) / 2;
    const px = Math.sin(angle) * midR;
    const py = -Math.cos(angle) * midR;

    // Rotate so text runs along the radial direction; flip bottom half
    const rotDeg = (angle * 180) / Math.PI - 90;
    const flip = angle > Math.PI ? 180 : 0;

    // Estimate available characters: arc chord ≈ arcSpan * midR px, each char ~7px
    const availPx = arcSpan * midR;
    const maxChars = Math.max(5, Math.floor(availPx / 7.5));

    labelsGroup
      .append('text')
      .attr('x', 0)
      .attr('y', 0)
      .attr('transform', `translate(${px},${py}) rotate(${rotDeg + flip})`)
      .style('fill', '#1f2937')
      .style('font-size', '10px')
      .style('font-weight', '600')
      .style('text-anchor', 'middle')
      .style('dominant-baseline', 'middle')
      .style('pointer-events', 'none')
      .text(truncate(d.data.name, maxChars));
  });
}

// ===== Transitions =====

function transitionArcs(nodes: ArcDatum[]): void {
  const arcGroup = g.select('.arcs-group');

  const paths = arcGroup
    .selectAll<SVGPathElement, ArcDatum>('.arc-path')
    .data(nodes, (d) => d.data.id);

  // Update existing
  paths
    .transition()
    .duration(TRANSITION_DURATION)
    .ease(d3.easeCubicInOut)
    .attr('fill', (d) => scoreToColor(d.data.score ?? 0))
    .attr('d', (d) => getArcPath(d));

  // Enter new
  paths
    .enter()
    .append('path')
    .attr('class', 'arc-path')
    .attr('d', (d) => getArcPath(d))
    .attr('fill', (d) => scoreToColor(d.data.score ?? 0))
    .attr('opacity', 0)
    .transition()
    .duration(TRANSITION_DURATION)
    .attr('opacity', 1);

  // Exit removed
  paths
    .exit()
    .transition()
    .duration(TRANSITION_DURATION / 2)
    .attr('opacity', 0)
    .remove();
}

// ===== Center Image =====

function drawCenterImage(): void {
  const defs = g.append('defs');

  // Clip path for circle
  defs.append('clipPath')
    .attr('id', 'center-clip')
    .append('circle')
    .attr('r', CENTER_R - 4);

  // Invisible click target (no background)
  g.append('circle')
    .attr('class', 'center-circle')
    .attr('r', CENTER_R)
    .attr('fill', 'none')
    .style('cursor', 'default');

  // Image
  g.append('image')
    .attr('href', './images/human-figure.png')
    .attr('x', -(CENTER_R - 4))
    .attr('y', -(CENTER_R - 4))
    .attr('width', (CENTER_R - 4) * 2)
    .attr('height', (CENTER_R - 4) * 2)
    .attr('clip-path', 'url(#center-clip)')
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('cursor', 'default');
}

// ===== Highlight / Dim =====

function highlightNode(target: ArcDatum): void {
  const ancestorIds = new Set<string>();
  let current: d3.HierarchyNode<SunburstNodeData> | null = target;
  while (current) {
    if (current.data.id) ancestorIds.add(current.data.id);
    current = current.parent;
  }

  d3.selectAll<SVGPathElement, ArcDatum>('.arc-path').each(function (d) {
    const isHighlighted = d.data.id === target.data.id || ancestorIds.has(d.data.id);
    d3.select(this)
      .classed('dimmed', !isHighlighted)
      .classed('highlighted', isHighlighted)
      .attr('fill', isHighlighted
        ? lightenColor(scoreToColor(d.data.score ?? 0))
        : scoreToColor(d.data.score ?? 0)
      );
  });
}

function unhighlightAll(_nodes: ArcDatum[]): void {
  d3.selectAll<SVGPathElement, ArcDatum>('.arc-path')
    .classed('dimmed', false)
    .classed('highlighted', false)
    .attr('fill', (d) => scoreToColor(d.data.score ?? 0));
}

function lightenColor(hex: string): string {
  // Parse and lighten slightly
  const c = d3.color(hex);
  if (!c) return hex;
  const rgb = c.rgb();
  rgb.r = Math.min(255, rgb.r + 25);
  rgb.g = Math.min(255, rgb.g + 25);
  rgb.b = Math.min(255, rgb.b + 25);
  return rgb.formatHex();
}

// ===== Utilities =====

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

// ===== Audience Area Highlighting =====

export function highlightAudienceAreas(areaIds: string[]): void {
  if (areaIds.length === 0) {
    d3.selectAll<SVGPathElement, ArcDatum>('.arc-path')
      .classed('audience-dimmed', false);
    return;
  }
  d3.selectAll<SVGPathElement, ArcDatum>('.arc-path').each(function (d) {
    const inPriority = areaIds.includes(d.data.areaId ?? '') || areaIds.includes(d.data.id);
    d3.select(this).classed('audience-dimmed', !inPriority);
  });
}

export function clearAudienceHighlight(): void {
  d3.selectAll<SVGPathElement, ArcDatum>('.arc-path').classed('audience-dimmed', false);
}

// ===== External API =====

export function resetZoom(): void {
  resetZoomFull();
}

export function setShowBehaviors(_show: boolean): void {
  // No-op: behaviors ring controlled via zoomToSubarea
}

// ===== Zoom to Subarea =====

export function zoomToSubarea(
  subareaId: string,
  behaviors: Array<{ id: string; name: string; score: number; valence: 'positive' | 'negative' }>
): void {
  // Find the subarea arc node to determine its angular position
  let subareaX0 = 0;
  let subareaX1 = 2 * Math.PI / 3; // fallback: one third of circle

  const subareaPath = g.select<SVGPathElement>(`.arc-path[data-id="${subareaId}"]`);
  if (!subareaPath.empty()) {
    const datum = subareaPath.datum() as ArcDatum;
    if (datum) {
      subareaX0 = (datum as unknown as { x0: number }).x0;
      subareaX1 = (datum as unknown as { x1: number }).x1;
    }
  }

  // Dim non-related arcs
  g.selectAll<SVGPathElement, ArcDatum>('.arc-path').each(function (d) {
    const isRelated =
      d.data.id === subareaId ||
      d.data.subareaId === subareaId ||
      (d.depth === 1 && g.select<SVGPathElement>(`.arc-path[data-id="${subareaId}"]`).datum()
        ? (g.select<SVGPathElement>(`.arc-path[data-id="${subareaId}"]`).datum() as ArcDatum)?.data?.areaId === d.data.id
        : false);
    d3.select(this)
      .transition()
      .duration(300)
      .attr('opacity', isRelated ? 1 : 0.2);
  });

  // Zoom g group toward the subarea midpoint
  const midAngle = (subareaX0 + subareaX1) / 2;
  const zoomR = (RING2_INNER + RING2_OUTER) / 2;
  const cx = Math.sin(midAngle) * zoomR;
  const cy = -Math.cos(midAngle) * zoomR;
  const scale = 1.15;
  const tx = cx * (1 - scale);
  const ty = cy * (1 - scale);

  g.transition()
    .duration(400)
    .ease(d3.easeCubicInOut)
    .attr('transform', `matrix(${scale},0,0,${scale},${tx},${ty})`);

  _isZoomed = true;

  // Draw behavior arcs after a short delay (let zoom settle)
  setTimeout(() => {
    drawBehaviorArcs(behaviors, subareaX0, subareaX1);
  }, 200);
}

export function resetZoomFull(): void {
  if (!_isZoomed && g.select('.behavior-arcs-group').empty()) return;

  // Remove behavior arcs and zoom-back button
  g.select('.behavior-arcs-group')
    .transition()
    .duration(200)
    .attr('opacity', 0)
    .remove();

  g.select('.zoom-back-group').remove();

  // Restore g transform
  g.transition()
    .duration(400)
    .ease(d3.easeCubicInOut)
    .attr('transform', '');

  // Restore arc opacities
  g.selectAll<SVGPathElement, ArcDatum>('.arc-path')
    .transition()
    .duration(300)
    .attr('opacity', 1);

  _isZoomed = false;
}
