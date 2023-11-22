import type { TabKind } from "./enums";

export interface UserAlert {
  type: "warning" | "error" | "complete";
  timestamp: number;
  message: string;
  context: string | undefined;
  simulationId: string | null;
  hideLinksToDocs?: true;
}

export type UserAlertInState = UserAlert & {
  uuid: string;
};

export interface ViewerTab {
  kind: TabKind;
  name: string;
}

export interface ViewerSlice {
  currentTab: TabKind;
  currentProcessChart: string;
  tabOrder: ViewerTab[];
  visibleTabs: TabKind[];
  userAlerts: UserAlertInState[];
  editor: boolean;
  activity: boolean;
  embedded: boolean;
  viewer: boolean;
}
