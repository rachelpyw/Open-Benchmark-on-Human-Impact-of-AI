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

type ArcDatum = d3.HierarchyRectangularNode<SunburstNodeData>;

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

  root.sum((d) => {
    if (d.type === 'subarea') return d.value ?? 0.1;
    return 0;
  });

  root.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

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

// ===== Labels =====

function drawLabels(nodes: ArcDatum[], parent: d3.Selection<SVGGElement, unknown, null, undefined>): void {
  const labelsGroup = parent.append('g').attr('class', 'labels-group');

  // Area labels (depth 1) — curved text along arc midline
  const labelDefs = labelsGroup.append('defs');
  const areaNodes = nodes.filter((d) => d.depth === 1);
  areaNodes.forEach((d) => {
    const x0 = (d as unknown as { x0: number }).x0;
    const x1 = (d as unknown as { x1: number }).x1;
    const arcSpan = x1 - x0;
    if (arcSpan < 0.3) return;

    const midAngle = (x0 + x1) / 2;
    const midR = (RING1_INNER + RING1_OUTER) / 2;
    const pathId = `area-label-path-${d.data.id}`;
    const isBottom = midAngle > Math.PI;
    const largeArc = arcSpan > Math.PI ? 1 : 0;

    let pathD: string;
    if (!isBottom) {
      // Clockwise: text reads left-to-right
      const sx = Math.sin(x0) * midR, sy = -Math.cos(x0) * midR;
      const ex = Math.sin(x1) * midR, ey = -Math.cos(x1) * midR;
      pathD = `M ${sx} ${sy} A ${midR} ${midR} 0 ${largeArc} 1 ${ex} ${ey}`;
    } else {
      // Counter-clockwise: flip so text stays right-side-up
      const sx = Math.sin(x1) * midR, sy = -Math.cos(x1) * midR;
      const ex = Math.sin(x0) * midR, ey = -Math.cos(x0) * midR;
      pathD = `M ${sx} ${sy} A ${midR} ${midR} 0 ${largeArc} 0 ${ex} ${ey}`;
    }

    labelDefs.append('path').attr('id', pathId).attr('d', pathD);

    // Name textPath centered on arc
    labelsGroup
      .append('text')
      .attr('class', 'area-label')
      .style('fill', '#1a1a1a')
      .style('font-size', '11px')
      .style('font-weight', '700')
      .style('pointer-events', 'none')
      .append('textPath')
      .attr('href', `#${pathId}`)
      .attr('startOffset', '50%')
      .attr('text-anchor', 'middle')
      .text(d.data.name);
  });

  // Subarea labels (depth 2) — show if arc is wide enough
  const subareaNodes = nodes.filter((d) => d.depth === 2);
  subareaNodes.forEach((d) => {
    const arcSpan = (d as unknown as { x1: number }).x1 - (d as unknown as { x0: number }).x0;
    if (arcSpan < 0.18) return;

    const angle = ((d as unknown as { x0: number }).x0 + (d as unknown as { x1: number }).x1) / 2;
    const midR = (RING2_INNER + RING2_OUTER) / 2;
    const x = Math.sin(angle) * midR;
    const y = -Math.cos(angle) * midR;

    const rotDeg = (angle * 180) / Math.PI - 90;
    const flip = angle > Math.PI ? 180 : 0;

    labelsGroup
      .append('text')
      .attr('class', 'subarea-label')
      .attr('x', 0)
      .attr('y', 0)
      .attr('transform', `translate(${x},${y}) rotate(${rotDeg + flip})`)
      .style('fill', '#1f2937')
      .style('font-size', '9.5px')
      .style('font-weight', '600')
      .style('text-anchor', 'middle')
      .style('dominant-baseline', 'middle')
      .style('pointer-events', 'none')
      .text(truncate(d.data.name, arcSpan > 0.5 ? 16 : 10));
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
  // No-op: zoom removed; kept for API compatibility
}

export function setShowBehaviors(_show: boolean): void {
  // No-op: behaviors ring removed from sunburst
}
