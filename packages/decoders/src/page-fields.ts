const PINTEREST_PAGE = 'ad.loc';

export const PAGE_FIELDS = {
  ga4: { page: ['dl'], referrer: ['dr'] },
  'google-ads': { page: ['url', 'dl'], referrer: ['ref'] },
  meta: { page: ['dl'], referrer: ['rl'] },
  'meta-capi': { page: ['event_source_url'], referrer: [] },
  pinterest: { page: [PINTEREST_PAGE], referrer: [] },
  'pinterest-capi': { page: ['event_source_url'], referrer: [] },
  sgtm: { page: ['page_location'], referrer: [] },
  tracker: { page: ['dl', 'page_location', 'page_url', 'url', 'u', 'loc', 'href'], referrer: [] },
} as const;
