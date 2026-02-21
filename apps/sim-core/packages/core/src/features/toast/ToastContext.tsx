import React, {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type { SimulationProject } from "../project/types";
import { ToastKind } from "./enums";
import type { ToastSlice } from "./types";
import { isProjectLatest } from "../project/utils";

function computeToastForProject(
  project: SimulationProject | null,
  canEdit: boolean,
  canWriteProject: boolean,
  fromLegacy: boolean = false,
): ToastSlice {
  let kind = ToastKind.None;
  let data: any;

  if (canEdit && project) {
    if (canWriteProject) {
      if (isProjectLatest(project)) {
        kind = project.latestRelease
          ? ToastKind.ProjectEditable
          : ToastKind.None;
      } else {
        kind = ToastKind.None;
      }
    } else {
      kind = ToastKind.ProjectPreview;
    }
  }

  if (fromLegacy) {
    data = kind;
    kind = ToastKind.LegacySimulationAccess;
  }

  return { kind, data };
}

export { computeToastForProject };

export interface ToastContextValue {
  toastKind: ToastKind;
  toastData: any;
  displayToast: (toast: ToastSlice) => void;
  setToastForProject: (
    project: SimulationProject | null,
    canEdit: boolean,
    canWriteProject: boolean,
    fromLegacy?: boolean,
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
};

export const ToastProvider: FC<PropsWithChildren> = ({ children }) => {
  const [toast, setToast] = useState<ToastSlice>({ kind: ToastKind.None });

  const displayToast = useCallback((t: ToastSlice) => setToast(t), []);

  const setToastForProject = useCallback(
    (
      project: SimulationProject | null,
      canEdit: boolean,
      canWriteProject: boolean,
      fromLegacy: boolean = false,
    ) => {
      setToast(
        computeToastForProject(project, canEdit, canWriteProject, fromLegacy),
      );
    },
    [],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toastKind: toast.kind,
      toastData: toast.data,
      displayToast,
      setToastForProject,
    }),
    [toast.kind, toast.data, displayToast, setToastForProject],
  );

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
};
