// retired.js — where links to retired tools go now.
//
// Terra was simplified to four core features (Jobs, the Development Map, News
// and Events). Old links to the tools that were retired still arrive from
// bookmarks, alert emails and shared messages, so each one is sent somewhere
// useful with a short note instead of a blank page:
//
//   #property&tool=deal&city=X   Deal of the week, now under News (#news&view=deal&city=X)
//   #property (any other tool)   the Development Map, the closest live tool
//   #career (any tool)           Jobs
//   #markets&tool=compare|calc|uw|sites|pay   the market's City data
//
// Plain functions with no DOM, so the backend's tests cover them.

const RETIRED_MARKET_TOOLS = {
  compare: 'Compare cities',
  calc: 'The deal calculator',
  uw: 'The underwriting model',
  sites: 'Site finder',
  pay: 'Salary check'
};

const RETIRED_PROPERTY_TOOLS = {
  owner: 'Who owns this',
  leases: 'Lease radar',
  distress: 'Distress',
  drive: 'Drive time'
};

/**
 * The hash an old link should open instead, and the note to show, or null
 * when the hash names nothing retired.
 */
export function retiredRoute(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const city = params.get('city') ?? '';
  const withCity = (base) => `${base}${city ? `&city=${encodeURIComponent(city)}` : ''}`;
  if (params.has('property')) {
    const tool = params.get('tool') ?? 'owner';
    if (tool === 'deal') return { hash: withCity('#news&view=deal'), note: 'Deal of the week has moved to News.' };
    const name = RETIRED_PROPERTY_TOOLS[tool] ?? 'The Property tab';
    return { hash: withCity('#markets&tool=map'), note: `${name} has been retired. Here's the Development Map instead.` };
  }
  if (params.has('career')) {
    return { hash: '#', note: 'The Career tools have been retired. Your jobs, saved jobs and tracker are all still here.' };
  }
  if (params.has('markets')) {
    const name = RETIRED_MARKET_TOOLS[params.get('tool')];
    if (name) return { hash: withCity('#markets'), note: `${name} has been retired. Here's the market's city data instead.` };
  }
  return null;
}
