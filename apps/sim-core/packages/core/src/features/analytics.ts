type AnalyticsEventMeta = {
  action: string;
  label?: string;
  context?: any;
};

/**
 * Local-first: analytics events are no-ops.
 * Kept as stubs so callers don't need to be updated yet.
 */
export const trackEvent = (_event: AnalyticsEventMeta) => {};

export const trackEvents = (_events: AnalyticsEventMeta[]) => {};
