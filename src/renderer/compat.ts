// Safari 14.0 (the original Big Sur WebView) supports grid gaps but not flex gaps.
// Feature detection keeps the existing layout on newer system WebViews.
const probe = document.createElement('div');
probe.style.cssText = 'position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px;';
probe.appendChild(document.createElement('div'));
probe.appendChild(document.createElement('div'));
document.body.appendChild(probe);
if (probe.scrollHeight !== 1) document.documentElement.classList.add('legacy-flex-gap');
probe.remove();
