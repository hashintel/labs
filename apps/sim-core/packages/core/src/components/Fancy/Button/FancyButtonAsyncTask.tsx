import React, { FC, useEffect, useRef, useState } from "react";
import { CSSTransition, TransitionGroup } from "react-transition-group";
import classNames from "classnames";

import { FancyButton, FancyButtonProps } from "./FancyButton";
import { IconCheck, IconSpinner } from "../../Icon";
import { setSignalTimeout } from "../../../util/setSignalTimeout";

import "./FancyButtonAsyncTask.scss";

const animationMs = 200;

export const FancyButtonAsyncTask: FC<
  Omit<FancyButtonProps, "onClick"> & {
    doneText?: string;
    onTaskBegin: () => Promise<unknown>;
    onTaskEnd?: () => unknown;
    labelClassName?: string;
    once?: boolean;
  }
> = ({
  doneText = "Done",
  children,
  className,
  onTaskBegin,
  onTaskEnd,
  labelClassName,
  style,
  once,
  ...props
}) => {
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<"start" | "progress" | "end">("start");
  const previousStateRef = useRef(state);

  useEffect(() => {
    previousStateRef.current = state;
  }, [state]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  return (
    <FancyButton
      {...props}
      className={classNames("FancyButtonAsyncTask", className)}
      disabled={state !== "start"}
      style={{
        ["--FancyButtonAsyncTask-ms" as any]: `${animationMs}ms`,
        ...(style ?? {}),
      }}
      onClick={async (evt) => {
        evt.preventDefault();

        controllerRef.current?.abort();
        controllerRef.current = new AbortController();

        const signal = controllerRef.current!.signal;
        const progressAbortController = new AbortController();

        signal.addEventListener("abort", () => progressAbortController.abort());

        setSignalTimeout(
          () => {
            setState("progress");
          },
          100,
          progressAbortController.signal
        );

        await onTaskBegin();
        progressAbortController.abort();

        if (!signal.aborted) {
          setState("end");

          if (once) {
            await onTaskEnd?.();
          } else {
            setSignalTimeout(
              async () => {
                setState("start");
                await onTaskEnd?.();
              },
              1_000,
              signal
            );
          }
        }
      }}
    >
      {/**
       * Fragment to work around issue with FancyButton icon placement
       * @todo make this unnecessary
       */}
      <>
        <strong
          className={classNames("FancyButtonAsyncTask__Label", labelClassName)}
        >
          {children}
        </strong>
        <TransitionGroup component={null} exit={false}>
          {state === "progress" || previousStateRef.current === "progress" ? (
            <CSSTransition
              key="done"
              classNames="FancyButtonAsyncTask__Overlay"
              timeout={animationMs}
            >
              <div
                className="FancyButtonAsyncTask__Overlay"
                onClick={(evt) => {
                  evt.preventDefault();
                  evt.stopPropagation();
                }}
              >
                <IconSpinner size={16} />
              </div>
            </CSSTransition>
          ) : null}
        </TransitionGroup>
        <TransitionGroup component={null}>
          {state === "end" ? (
            <CSSTransition
              key="progress"
              classNames="FancyButtonAsyncTask__Overlay"
              timeout={animationMs}
            >
              <div
                className="FancyButtonAsyncTask__Overlay FancyButtonAsyncTask__Overlay--done"
                onClick={(evt) => {
                  evt.preventDefault();
                  evt.stopPropagation();
                }}
              >
                {doneText} <IconCheck />
              </div>
            </CSSTransition>
          ) : null}
        </TransitionGroup>
      </>
    </FancyButton>
  );
};
