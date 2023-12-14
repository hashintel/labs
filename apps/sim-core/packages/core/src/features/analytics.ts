import { AppThunk } from "./types";
import { selectCurrentUser } from "./user/selectors";
import { selectEmbedded } from "./viewer/selectors";

interface AnalyticsEventMeta {
  action: string;
  label?: string;
  context?: any;
}

export const trackEvent = (event: AnalyticsEventMeta) => trackEvents([event]);

/**
 * Send events to the API
 * We require a specific category, and an action for Google Analytics reporting.
 * Accepts an optional label (for display in GA) and arbitrary context object
 */
export const trackEvents =
  (events: AnalyticsEventMeta[]): AppThunk =>
  (dispatch, getState) => {
    const state = getState();

    const embedded = selectEmbedded(state);
    const user = selectCurrentUser(state);

    // // Don't track events for staff members
    if (user?.staffMember) {
      return;
    }

    const mappedEvents = embedded
      ? events.map((event) => ({
          ...event,
          context: {
            ...(event.context ?? {}),
            embedded,
          },
        }))
      : events;

    // report to the API if any are of interest to it
    reportEvents(mappedEvents);
  };

const reportEvents = (events: AnalyticsEventMeta[]) => {
  // We want accurate reporting on these events.
  const actionTypesToReport = [
    "Run Simulation",
    "Open Project",
    "Experiment Run",
    "Experiment Simulation Run",
  ];
  const eventsToReport = events.reduce<AnalyticsEventMeta[]>(
    (eventsOfInterest, currentEvent) => {
      const { action, label, context } = currentEvent;
      if (actionTypesToReport.includes(action)) {
        eventsOfInterest.push({
          action: action.replace(/ /g, ""),
          label,
          context,
        });
      }
      return eventsOfInterest;
    },
    [],
  );
  if (eventsToReport.length > 0) {
    // migration shim
    // disable event reporting,
    // but keep this code alive so that all of the event tracking
    // touchpoints remain in the codebase.
    // that instrumentation will be useful to anyone who
    // ends up hosting this.
    // registerEvents({ actions: eventsToReport });
  }
};
