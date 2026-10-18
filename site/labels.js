// labels.js — the shared pieces that say what a number is and what a section
// is doing: the loading, empty and error box every data section uses, and the
// Verified / Your assumption / Estimate tags on the calculators and site
// finder. Plain DOM, no dependencies; the text rules are plain functions so
// the backend's tests cover them.

/**
 * What a figure is. verified: read from an official public record (an
 * appraisal roll, a city zoning map, a government rate). assumption: an input
 * the visitor typed or can change. estimate: worked out from the two, never a
 * fact. Nothing is shown as verified unless it came from a named record.
 */
export const LABELS = {
  verified: { text: 'Verified', hint: 'Read from an official public record. The source is named beside it.' },
  assumption: { text: 'Your assumption', hint: 'An input you set. Change it to match your deal.' },
  estimate: { text: 'Estimate', hint: 'Worked out from the inputs above. Not a fact about the property.' }
};

/** The text and hover hint for a tag; a source, when given, joins the hint. Unknown kinds read as estimates, never as verified. */
export function labelText(kind, source = '') {
  const label = LABELS[kind] ?? LABELS.estimate;
  return { text: label.text, hint: source ? `${label.hint} Source: ${source}.` : label.hint };
}

/** A small tag naming what a figure is. */
export function labelTag(kind, source = '') {
  const safe = LABELS[kind] ? kind : 'estimate';
  const { text, hint } = labelText(safe, source);
  const tag = document.createElement('span');
  tag.className = `prov-tag prov-${safe}`;
  tag.textContent = text;
  tag.title = hint;
  return tag;
}

/** The legend shown once at the top of a tool, so the tags read the same everywhere. */
export function labelLegend(kinds = ['verified', 'assumption', 'estimate']) {
  const box = document.createElement('p');
  box.className = 'prov-legend';
  kinds.forEach((kind, i) => {
    if (i) box.append(' ');
    box.append(labelTag(kind), ` ${legendWords[kind]}`);
  });
  return box;
}

const legendWords = {
  verified: 'official public record',
  assumption: 'an input you can change',
  estimate: 'calculated, not a fact'
};

/** The state a section is in: 'loading', 'empty' or 'error'. true reads as error and false as empty, for the older message(text, isError) calls. */
export function stateKind(kind) {
  if (kind === true) return 'error';
  return kind === 'loading' || kind === 'error' ? kind : 'empty';
}

/**
 * The box a data section shows while it loads, when it has nothing to show,
 * or when its file did not load. Loading boxes are a polite live region and
 * mark themselves busy; errors are alerts and offer a reload.
 */
export function stateBox(text, kind = 'empty', { retry = false } = {}) {
  const k = stateKind(kind);
  const box = document.createElement('div');
  box.className = k === 'empty' ? 'state' : `state ${k}`;
  box.setAttribute('role', k === 'error' ? 'alert' : 'status');
  if (k === 'loading') box.setAttribute('aria-busy', 'true');
  if (k === 'loading') {
    const dot = document.createElement('span');
    dot.className = 'state-spinner';
    dot.setAttribute('aria-hidden', 'true');
    box.append(dot);
  }
  box.append(text);
  if (k === 'error' && retry) {
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'chip state-retry';
    again.textContent = 'Try again';
    again.addEventListener('click', () => location.reload());
    box.append(again);
  }
  return box;
}

/** A small heading over a block of figures that are all one kind ("Inputs  Your assumption"). */
export function labelHeading(text, kind, source = '') {
  const head = document.createElement('p');
  head.className = 'prov-heading eyebrow';
  head.append(text, labelTag(kind, source));
  return head;
}

/** Where the city tax rate comes from, for its Verified tag: the metric's source and the period the city reports. */
export function taxSource(snapshot, city) {
  const metric = (snapshot?.metrics ?? []).find((m) => m.key === 'taxRate');
  const period = (snapshot?.markets ?? []).find((m) => m.city === city)?.periods?.taxRate;
  return [metric?.source ?? 'Texas Comptroller', period].filter(Boolean).join(', ') + ' (typical property inside the city)';
}
