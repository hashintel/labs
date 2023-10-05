import { createContext, useContext, useEffect, useRef } from "react";
import { ShepherdTourContext } from "react-shepherd";
import type BaseStep from "shepherd.js/src/types/step";
import type BaseTour from "shepherd.js/src/types/tour";

import { TourShowcase } from "../../../features/project/types";

import "./HashCoreTour.css";

export { ShepherdTour } from "react-shepherd";

export interface Step extends BaseStep {
  options: BaseStep.StepOptions;
}

export interface TourShowEvent {
  tour: Tour;
  step: Step;
  previous?: Step;
}

export interface Tour extends BaseTour {
  steps: Step[];

  getById(id: string | number): Step;

  on(eventName: string, handler: (evt?: any) => void): void;
  on(eventName: "show", handler: (evt: TourShowEvent) => void): void;

  off(eventName: string, handler: (evt?: any) => void): void;
  off(eventName: "show", handler: (evt: TourShowEvent) => void): void;
}

export function useTour() {
  return useContext(ShepherdTourContext) as Tour;
}

export interface HashCoreTourConfig {
  shouldShowBackdrop: boolean;
  shouldCenter: boolean;
}

export interface HashTourConfigContextType {
  config: HashCoreTourConfig;
  isVisible: boolean;
  tourShowcase: TourShowcase[] | null;
  update(tourConfig: HashCoreTourConfig | null): void;
}

export const HashTourConfigContext = createContext<HashTourConfigContextType | null>(
  null
);

/**
 * @warning this only works once per mount– it will not update to reflect
 *          changes to the values parameter (this is to allow the use of inline
 *          object declarations without constantly re-triggering the effect)
 */
export function useConfigHashTourForSlide(values?: HashCoreTourConfig) {
  const valuesRef = useRef(values);
  const context = useContext(HashTourConfigContext)!;
  const update = context.update;

  useEffect(() => {
    if (!valuesRef.current) {
      return;
    }

    update(valuesRef.current);

    return () => {
      update(null);
    };
  }, [update]);

  return context;
}
