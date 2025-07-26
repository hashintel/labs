import { curriedQuery } from "./../query";

export const registerEvents = curriedQuery<
  { registerEvents: boolean },
  { actions: { action: string; label?: string; context?: any }[] }
>(
  `mutation registerEvents($actions: [AnalyticEvent!]!) {
        registerEvents(actions: $actions)
     }`,
);
