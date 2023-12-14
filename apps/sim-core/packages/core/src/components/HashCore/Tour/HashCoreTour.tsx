import React, {
  FC,
  Fragment,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";

import { Avatar, CloseButton, VERSION, steps } from "./Step";
import {
  HashCoreTourConfig,
  HashTourConfigContext,
  HashTourConfigContextType,
  ShepherdTour,
  Tour,
  TourShowEvent,
  useTour,
} from "./react-shepherd-wrapper";
import type { TourProgress } from "../../../util/api/types";
import { getTourShowcase } from "../../../util/api";
import {
  selectCurrentProject,
  selectProjectLoaded,
} from "../../../features/project/selectors";
import { selectTourProgress } from "../../../features/user/selectors";
import { tourProgress } from "../../../features/user/thunks";
import { urlFromProject } from "../../../routes";
import { useGettingStartedProject } from "./util";
import { usePromise } from "../../../hooks/usePromise";
import { useSafeQueryParams } from "../../../hooks/useSafeQueryParams";

const tourOptions = {
  defaultStepOptions: {
    cancelIcon: { enabled: true, label: "Exit" },
    arrow: false,
  },
  exitOnEsc: false,
  keyboardNavigation: false,
};

const TOUR_HIDDEN_IDX = -1;
const useTourPosition = (tour: Tour): [number, number, boolean] => {
  const [{ activeIdx, prevIdx, stepId }, update] = useReducer(
    <S extends { activeIdx: number; prevIdx: number; stepId: string | null }>(
      state: S,
      action: S,
    ) => ({ ...state, ...action }),
    { activeIdx: TOUR_HIDDEN_IDX, prevIdx: TOUR_HIDDEN_IDX, stepId: null },
  );

  const isVisible = activeIdx !== TOUR_HIDDEN_IDX;

  const activeIdxRef = useRef(activeIdx);
  activeIdxRef.current = activeIdx;

  const { steps } = tour;

  useEffect(() => {
    const onShow = ({ step, previous }: TourShowEvent) => {
      const idx = steps.indexOf(step);

      update({
        activeIdx: idx,
        prevIdx: previous ? steps.indexOf(previous) : 0,
        stepId: step.options.id ?? `Step${idx}`,
      });
    };

    const onHide = () =>
      update({
        activeIdx: TOUR_HIDDEN_IDX,
        prevIdx: activeIdxRef.current,
        stepId: null,
      });

    tour.on("show", onShow);
    tour.on("cancel", onHide);
    tour.on("complete", onHide);

    return () => {
      tour.off("show", onShow);
      tour.off("cancel", onHide);
      tour.off("complete", onHide);
    };
  }, [tour, steps, update]);

  useEffect(() => {
    if (!stepId) {
      return;
    }

    const className = `HashCoreTour-Step-${stepId}`;

    document.documentElement.classList.add(className);

    return () => {
      document.documentElement.classList.remove(className);
    };
  }, [stepId]);

  return [activeIdx, prevIdx, isVisible];
};

const useAutoTriggerTour = (tour: Tour, isVisible: boolean) => {
  const project = useSelector(selectCurrentProject);
  const projectLoaded = useSelector(selectProjectLoaded);
  const tourProgress = useSelector(selectTourProgress);

  const [{ triggerTour, fromOnboardingRoute }, setQueryParams] =
    useSafeQueryParams();

  const gettingStartedSim = useGettingStartedProject();
  const gettingStarted = [
    project?.pathWithNamespace,
    project?.forkOf?.pathWithNamespace,
  ].includes(gettingStartedSim?.pathWithNamespace);

  const gettingStartedRef = useRef(gettingStarted);
  const isVisibleRef = useRef(isVisible);

  useEffect(() => {
    if (isVisibleRef.current && !isVisible && triggerTour) {
      setQueryParams({ triggerTour: undefined });
    }

    isVisibleRef.current = isVisible;
  }, [isVisible, setQueryParams, triggerTour]);

  useEffect(() => {
    const triggeringManually = triggerTour !== undefined;

    if (
      tour.isActive() ||
      !(projectLoaded && (triggeringManually || gettingStarted))
    ) {
      return;
    }

    const { completed, version } = tourProgress ?? {};

    if (triggeringManually || !completed) {
      const lastStepViewed =
        ((!completed && version === VERSION && tourProgress?.lastStepViewed) ||
        triggerTour
          ? tour.getById(triggerTour ?? tourProgress?.lastStepViewed)
          : null
        )?.options.id ?? steps[0].id;

      gettingStartedRef.current = gettingStarted;

      tour.start();
      tour.show(lastStepViewed);
    }

    if (triggeringManually && fromOnboardingRoute) {
      setQueryParams({
        triggerTour: undefined,
        fromOnboardingRoute: undefined,
      });
    }
  }, [
    triggerTour,
    tour,
    gettingStarted,
    projectLoaded,
    fromOnboardingRoute,
    setQueryParams,
    tourProgress,
  ]);

  useEffect(() => {
    const wasGettingStarted = gettingStartedRef.current;
    gettingStartedRef.current = gettingStarted;

    if (tour.isActive() && wasGettingStarted && !gettingStarted) {
      tour.cancel();
    }
  }, [gettingStarted, tour]);
};

const useSyncProgressBar = (activeIdx: number, prevIdx: number) => {
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--tour-progress",
      `${((activeIdx + 1) / steps.length) * 100}%`,
    );

    document.documentElement.style.setProperty(
      "--tour-prev-progress",
      `${((prevIdx + 1) / steps.length) * 100}%`,
    );
  }, [activeIdx, prevIdx]);
};

const useHashTourConfig = (isVisible: boolean): HashTourConfigContextType => {
  const tourShowcase = usePromise(getTourShowcase, isVisible);
  const initialState = {
    shouldShowBackdrop: false,
    shouldCenter: false,
  };
  const [{ shouldShowBackdrop, shouldCenter }, update] = useReducer(
    (state: HashCoreTourConfig, action: HashCoreTourConfig | null) =>
      action
        ? {
            ...state,
            ...action,
          }
        : initialState,
    initialState,
  );

  useEffect(() => {
    if (shouldCenter) {
      document.documentElement.classList.add("HashCoreTour-Center");
    } else {
      document.documentElement.classList.remove("HashCoreTour-Center");
    }
  }, [shouldCenter]);

  return useMemo(
    () => ({
      tourShowcase,
      update,
      isVisible,
      config: {
        shouldShowBackdrop,
        shouldCenter,
      },
    }),
    [shouldCenter, shouldShowBackdrop, tourShowcase, isVisible],
  );
};

const useIsCompleted = (
  tour: Tour,
  tourProgress: TourProgress | null,
  activeIdx: number,
) => {
  const { completed = false } = tourProgress ?? {};
  const [isCompleted, setIsCompleted] = useState(completed);

  useEffect(() => {
    setIsCompleted(completed);
  }, [completed]);

  useEffect(() => {
    const { steps } = tour;

    if (tour.isActive() && !steps[activeIdx + 1] && !isCompleted) {
      setIsCompleted(true);
    }
  }, [activeIdx, tour, isCompleted]);

  return isCompleted;
};

const useTrackProgress = (
  tour: Tour,
  activeIdx: number,
  prevIdx: number,
  isCompleted: boolean,
) => {
  const dispatch = useDispatch();

  useEffect(() => {
    if (!tour.isActive() || (activeIdx === 0 && prevIdx <= activeIdx)) {
      return;
    }

    /**
     * If we've previously completed it and are now just reviewing it,
     * we don't want to overwrite their progress
     */
    const currentStep = isCompleted ? tour.steps.length - 1 : activeIdx;
    const lastStepViewed = tour.steps[currentStep].options.id ?? "";

    dispatch(
      tourProgress({
        completed: isCompleted,
        version: VERSION,
        lastStepViewed,
      }),
    );
  }, [activeIdx, dispatch, isCompleted, prevIdx, tour]);
};

const TourWithBackdrop: FC = () => {
  const tour = useTour();
  const tourProgress = useSelector(selectTourProgress);
  const [activeIdx, prevIdx, isVisible] = useTourPosition(tour);
  const hashTourConfig = useHashTourConfig(isVisible);
  const isCompleted = useIsCompleted(tour, tourProgress, activeIdx);

  useAutoTriggerTour(tour, isVisible);
  useSyncProgressBar(activeIdx, prevIdx);
  useTrackProgress(tour, activeIdx, prevIdx, isCompleted);

  return (
    <HashTourConfigContext.Provider value={hashTourConfig}>
      {createPortal(
        <>
          <div
            className={`HashCoreTour-backdrop ${
              hashTourConfig.config.shouldShowBackdrop
                ? ""
                : "HashCoreTour-backdrop--hidden"
            }`}
            onClick={() => {
              if (isCompleted) {
                tour.cancel();
              }
            }}
          />
          <div className="HashCoreTour__AvatarPreload">
            {hashTourConfig.tourShowcase?.map(
              ({ avatar, thumbnail, pathWithNamespace, ref }) => (
                <Avatar
                  avatar={avatar}
                  thumbnail={thumbnail}
                  key={urlFromProject({
                    pathWithNamespace,
                    ref,
                  })}
                />
              ),
            )}
          </div>
        </>,
        document.body,
      )}
      {steps.map((step, idx) => (
        <Fragment key={idx}>
          {createPortal(
            idx === activeIdx ? (
              <>
                {isCompleted ? <CloseButton /> : null}
                {step.jsx}
              </>
            ) : null,
            step.text,
          )}
        </Fragment>
      ))}
    </HashTourConfigContext.Provider>
  );
};

export const HashCoreTour: FC = ({ children }) => (
  <ShepherdTour steps={steps} tourOptions={tourOptions}>
    <TourWithBackdrop />
    {children}
  </ShepherdTour>
);
