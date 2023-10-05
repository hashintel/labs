import { useEffect, useReducer, useRef } from "react";

import {
  LinkableProject,
  ProjectAccess,
  SimulationProject,
} from "../../../features/project/types";
import { ProjectAccessCodeAccessType } from "../../../shared/scopes";
import { projectReleaseTags } from "../../../util/api/queries/projectReleaseTags";
import { requestPrivateProjectAccessCode } from "../../../util/api/queries/requestPrivateProjectAccessCode";

export const useSelectableRelease = (
  project: LinkableProject,
  access: ProjectAccess,
  onError?: VoidFunction
) => {
  const [reducerState, dispatch] = useReducer(
    (
      state: {
        loading: boolean;
        hasReleases: boolean;
        releases: string[];
        selectedRelease: string;
      },
      action:
        | { type: "RESULTS"; payload: string[] }
        | { type: "CHOOSE"; payload: string }
    ) => {
      switch (action.type) {
        case "RESULTS":
          return {
            ...state,
            loading: false,
            hasReleases: action.payload.length > 0,
            releases: [
              ...(action.payload.length ? ["stable"] : []),
              "main",
              ...action.payload,
            ],
            selectedRelease: action.payload.length ? "stable" : "main",
          };
        case "CHOOSE":
          return { ...state, selectedRelease: action.payload };
      }
    },
    {
      loading: true,
      releases: [] as string[],
      selectedRelease: "stable",
      hasReleases: false,
    }
  );

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    const abortController = new AbortController();

    (async () => {
      try {
        const releases = await projectReleaseTags(
          project.pathWithNamespace,
          project.ref,
          access?.code,
          abortController.signal
        );
        dispatch({ type: "RESULTS", payload: releases });
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.error(err);
          onErrorRef.current?.();
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [access?.code, project.pathWithNamespace, project.ref]);

  const onSelectedReleaseChange = (release: string) =>
    dispatch({
      type: "CHOOSE",
      payload: release,
    });

  return [reducerState, onSelectedReleaseChange] as const;
};

export const useRequestAccessCode = (
  project: SimulationProject,
  level: ProjectAccessCodeAccessType
) => {
  const [{ accessCode, requesting }, accessCodeDispatch] = useReducer(
    (
      state: { accessCode: string | null; requesting: boolean },
      action:
        | { type: "requesting" }
        | { type: "requested"; result: string | null }
    ) => {
      switch (action.type) {
        case "requesting":
          return { requesting: true, accessCode: null };
        case "requested":
          return { requesting: false, accessCode: action.result };
      }
    },
    {
      accessCode: project.access?.code ?? null,
      requesting: false,
    }
  );

  if (project.access?.code && !accessCode) {
    accessCodeDispatch({ type: "requested", result: project.access.code });
  }

  const requestAccessCode = async () => {
    accessCodeDispatch({ type: "requesting" });

    try {
      accessCodeDispatch({
        type: "requested",
        result: await requestPrivateProjectAccessCode(project, level),
      });
    } catch (err) {
      console.error("Cannot fetch access code", err);
      accessCodeDispatch({ type: "requested", result: null });
    }
  };

  return {
    accessCode,
    requesting,
    requestAccessCode,
  };
};
