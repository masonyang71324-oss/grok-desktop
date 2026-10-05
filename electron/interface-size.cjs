const zoomSteps = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

function normalizeZoomPercent(value) {
  return Number.isFinite(value) ? Math.round(Math.max(25, Math.min(500, value))) : 100;
}

function stepZoomPercent(current, direction) {
  const value = normalizeZoomPercent(current);
  return direction === 'in'
    ? (zoomSteps.find((step) => step > value) ?? 500)
    : (zoomSteps.filter((step) => step < value).pop() ?? 25);
}

module.exports = { normalizeZoomPercent, stepZoomPercent };
