import { AppThunk } from "./types";
import { registerEvents } from "../util/api/queries/registerEvents";
import { selectCurrentUser } from "./user/selectors";
import { selectEmbedded } from "./viewer/selectors";

type AnalyticsEventMeta = {
  action: string;
  label?: string;
  context?: any;
};

export const trackEvent = (event: AnalyticsEventMeta) => trackEvents([event]);

/**
 * Send events to the API
 * We require a specific category, and an action for Google Analytics reporting.
 * Accepts an optional label (for display in GA) and arbitrary context object
 */
export const trackEvents = (events: AnalyticsEventMeta[]): AppThunk => (
  dispatch,
  getState
) => {
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
    []
  );
  if (eventsToReport.length > 0) {
    registerEvents({ actions: eventsToReport });
  }
};
