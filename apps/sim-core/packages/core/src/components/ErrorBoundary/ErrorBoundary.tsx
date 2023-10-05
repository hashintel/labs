import React, {
  Component,
  createContext,
  ErrorInfo,
  FC,
  useContext,
  useMemo,
  useState,
} from "react";
import * as Sentry from "@sentry/browser";
import { customAlphabet } from "nanoid";

import { BasicDiscordWidget } from "../DiscordWidget/DiscordWidget";
import { BigModal } from "../Modal";
import { ErrorDetails } from "../ErrorDetails";
import { FancyButton } from "../Fancy";
import { IS_LOCAL } from "../../util/api";
import { sentryConsoleLogAbortController } from "../../util/initSentry";

import "./ErrorBoundary.css";

/**
 * We use this to generate a "quotable" HASH id – this is not guaranteed to be
 * unique, but it doesn't really need to be, and there is a trade off between
 * uniqueness and quotability. The result from nanoid is prepended with 2 digits
 * representing the day of the month, which helps reduce likelihood of clashes.
 *
 * Using nanoid's "clash" tool, it would take 6 days generating 50 ids per hour
 * to have a 1% chance of a clash – this will be reduced massively as these ids
 * are scoped to the day of the month.
 *
 * @see https://zelark.github.io/nano-id-cc/
 */
const quotableId = (() => {
  const generateHashEventId = customAlphabet(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    6
  );

  return () =>
    `CORE-${new Date()
      .getUTCDate()
      .toString()
      .padStart(2, "0")}${generateHashEventId()}`;
})();

type ErrorBoundaryProps = {};
type ErrorBoundaryState = {
  didError: boolean;
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  eventId: string | null;
  detailsHidden: boolean;
  hashEventId: string | null;
};

type TErrorBoundaryContext = {
  handlePromiseRejection: (promise: Promise<any>) => void;
  fatalError: (err: any) => void;
} | null;

const ErrorBoundaryContext = createContext<TErrorBoundaryContext>(null);

export const useHandlePromiseRejection = () =>
  useContext(ErrorBoundaryContext)!.handlePromiseRejection;

export const useFatalError = () => useContext(ErrorBoundaryContext)!.fatalError;

/**
 * This component provides a `handlePromiseRejection` function to the
 * application using a context provider. This function attaches a promise
 * rejection handler to the passed promise. This allows async errors to be
 * handled by the ErrorBoundary, even though they would not normally be caught
 * by React. It uses the setState function from a useState hook to inform React
 * about the error, which is a trick suggested by a member of the React team.
 * The context value is memoized to ensure only one function is ever provided
 * and that there are not unnecessary re-renders of children that depend on this
 * function.
 *
 * @see https://github.com/facebook/react/issues/14981#issuecomment-468460187
 */
const ErrorBoundaryContextProvider: FC = ({ children }) => {
  const [, catchError] = useState();
  const contextValue = useMemo<TErrorBoundaryContext>(() => {
    const fatalError = (err: any) => {
      catchError(() => {
        throw err;
      });
    };

    return {
      fatalError,
      handlePromiseRejection(promise) {
        promise.catch(fatalError);
      },
    };
  }, []);

  return (
    <ErrorBoundaryContext.Provider value={contextValue}>
      {children}
    </ErrorBoundaryContext.Provider>
  );
};

/**
 * @warning ErrorBoundary is rendered above our Redux stores so it can use state
 * inside Redux
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  static getDerivedStateFromError(error: Error) {
    return {
      didError: true,
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      hashEventId: IS_LOCAL ? null : quotableId(),
    };
  }

  state = {
    didError: false,
    errorName: undefined,
    errorMessage: undefined,
    errorStack: undefined,
    eventId: null,
    detailsHidden: true,
    hashEventId: null,
  };

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { hashEventId } = this.state;

    /**
     * Cancel the in-flight sentry log of this error caused by React calling
     * console.error before notifying the error boundary
     */
    sentryConsoleLogAbortController.abort();

    Sentry.withScope((scope) => {
      scope.setTag("hashId", hashEventId);
      scope.setExtras(errorInfo as any);
      const eventId = Sentry.captureException(error);
      this.setState({ eventId });
    });
  }

  render() {
    const {
      didError,
      errorName,
      errorMessage,
      errorStack,
      detailsHidden,
      hashEventId,
    } = this.state;

    return didError ? (
      <BigModal>
        <div className="ErrorBoundary">
          <div className="ErrorBoundary__Header">
            <h2>An error has occurred</h2>
            {hashEventId ? (
              <div className="ErrorBoundary__Header__EventId">
                {hashEventId}
              </div>
            ) : null}
          </div>
          <p>
            We're sorry for any inconvenience caused. We've logged your error
            and will work to ensure it doesn't happen again. Any changes made to
            your simulation should have been saved.
          </p>
          <p>
            Please refresh this page and reattempt the operation, or see our{" "}
            <a
              href="https://docs.hash.ai/core/extra/troubleshooting#troubleshooting-crashes"
              target="_blank"
            >
              troubleshooting guide
            </a>
            .
          </p>
          <br />
          {hashEventId ? (
            <p>
              If your error repeatedly reoccurs, please contact us quoting the
              error ID in the top right corner of your screen.
            </p>
          ) : null}
          <ErrorDetails
            errorName={errorName}
            errorMessage={errorMessage}
            errorStack={errorStack}
            hidden={detailsHidden}
          />
          <footer className="ErrorBoundary__Footer">
            <FancyButton
              onClick={() => this.setState({ detailsHidden: !detailsHidden })}
            >
              <strong>{detailsHidden ? "SHOW" : "HIDE"} DETAILS</strong>
            </FancyButton>
            <FancyButton
              onClick={() => {
                location.reload();
              }}
            >
              <strong>REFRESH PAGE</strong>
            </FancyButton>
          </footer>
          <BasicDiscordWidget errored />
        </div>
      </BigModal>
    ) : (
      <ErrorBoundaryContextProvider>
        {this.props.children}
      </ErrorBoundaryContextProvider>
    );
  }
}
