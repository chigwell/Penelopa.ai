import { expect } from '@playwright/test';

// Inspect the real instance through React's ref in tests; no production debug global or graph data logging.
export async function canvasState(page, fixedLayout = false) {
  return page.locator('.kg-cosmograph').evaluate(async (element, fixedLayout) => {
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
    let graph;
    for (; fiber && !graph; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
      const ref = hook.memoizedState?.current;
      if (typeof ref?.getPointsData === 'function') { graph = ref; break; }
    }
    if (!graph) throw new Error('Cosmograph ref unavailable');
    const config = await graph.getConfig();
    const points = (await graph.getPointsData()).toArray();
    if (fixedLayout) {
      // Snapshot-only coordinates: exercise real WebGL styles without GPU layout drift.
      // Behavioral tests above always use the application's live force simulation.
      const groups = [['Platform', 'API', 'Auth', 'Queue', 'Storage'], ['Research', 'Evidence', 'Search', 'Papers', 'Notes'], ['Design', 'Canvas', 'Typography', 'Color', 'Layout']];
      const centers = [[-150, 0], [120, -180], [120, 180]];
      const positions = new Float32Array(points.length * 2);
      for (const row of points) {
        const label = row[config.pointLabelBy], group = groups.findIndex(labels => labels.includes(label));
        const index = group < 0 ? 0 : groups[group].indexOf(label);
        const angle = index / 5 * 2 * Math.PI;
        const [x, y] = group < 0 ? [-280, label === 'Satellite' ? -140 : 140] : [centers[group][0] + Math.cos(angle) * 80, centers[group][1] + Math.sin(angle) * 80];
        const pointIndex = Number(row[config.pointIndexBy]);
        positions[pointIndex * 2] = x; positions[pointIndex * 2 + 1] = y;
      }
      // Cosmos exposes position updates; its Cosmograph wrapper does not forward this method.
      // This test-only ref access leaves the actual prepared DuckDB tables and visual configuration intact.
      graph.stop();
      graph._cosmos.setConfigPartial({ enableSimulation: false, transitionDuration: 0 });
      graph._cosmos.setPointPositions(positions);
      graph._cosmos.render(0, 0);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const links = config.links ? (await graph.getLinksData()).toArray() : [];
    const sizes = graph.getPointSizes(), colors = graph.getPointColors();
    const selectedLinks = graph.getSelectedLinkIndices(), selectedPoints = graph.getSelectedPointIndices();
    const highlightEdges = element.parentElement?.querySelectorAll('[data-edge-highlight-id]').length ?? 0;
    return {
      camera: { zoom: graph.getZoomLevel(), origin: graph.spaceToScreenPosition([0, 0]) }, focused: graph.focusedPointIndex,
      linkStyle: { color: config.linkDefaultColor, width: config.linkDefaultWidth, opacity: config.linkOpacity, greyoutOpacity: config.linkGreyoutOpacity },
      highlightEdges,
      selectedLinks: selectedLinks ?? null, selectedPoints: selectedPoints ?? null,
      points: points.map(p => {
        const index = Number(p[config.pointIndexBy]), position = graph.getPointPositionByIndex(index);
        return { id: p[config.pointIdBy], label: p[config.pointLabelBy], index, degree: p.degree, community: p.community,
          size: sizes?.[index], color: Array.from(colors?.slice(index * 4, index * 4 + 4) || []),
          screen: position ? graph.spaceToScreenPosition(position) : null };
      }),
      links: links.map((l, i) => ({ index: Number(l.rowid ?? i), source: Number(l[config.linkSourceIndexBy]), target: Number(l[config.linkTargetIndexBy]) })),
    };
  }, fixedLayout);
}

export async function expectReadyCanvas(page) {
  await expect(page.locator('.kg-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
  await expect(page.locator('.kg-canvas')).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
}

export async function chooseCanvasEntity(page, name) {
  await page.getByLabel('Search entities').fill(name);
  await page.getByLabel('Matching entities').getByRole('button', { name, exact: true }).click();
}

export async function timelineColors(page) {
  return page.locator('.kg-native-timeline').evaluate(element => {
    const styled = [...element.querySelectorAll('div'), element].find(child => getComputedStyle(child).backgroundColor !== 'rgba(0, 0, 0, 0)');
    const css = getComputedStyle(element);
    return { background: styled ? getComputedStyle(styled).backgroundColor : '', text: css.getPropertyValue('--cosmograph-timeline-text-color').trim(), selection: css.getPropertyValue('--cosmograph-timeline-selection-color').trim() };
  });
}
