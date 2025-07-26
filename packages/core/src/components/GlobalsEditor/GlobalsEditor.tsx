import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { batch, useDispatch, useSelector } from "react-redux";
import { JsonMap } from "@hashintel/engine-web";

import { FancyButton } from "../Fancy/Button";
import { GlobalsObject } from "./GlobalsObject";
import { IconAlert } from "../Icon/Alert";
import { ParsedGlobals } from "../../features/files/types";
import { globalConfigSchema } from "../../util/monaco-config";
import { globalsFileId, stringifyGlobals } from "../../features/files/utils";
import { parseGlobals } from "./utils";
import { selectCanToggleVisualGlobals } from "../../features/scopes";
import { selectGlobals } from "../../features/files/selectors";
import { toggleVisualGlobals, updateFile } from "../../features/files/slice";
import { useCancellableDebounce } from "../../hooks/useCancellableDebounce";

import "./GlobalsEditor.scss";

const emptyMessage = (
  <p className="GlobalsEditor__Info">
    There are no properties to configure for this project.
  </p>
);

const skipSchema = (field: string) => field !== "schema";

export const GlobalsEditor: FC = () => {
  const dispatch = useDispatch();
  const globalsString = useSelector(selectGlobals);
  const canToggleVisualGlobals = useSelector(selectCanToggleVisualGlobals);
  const [globalsState, setGlobals] = useState(parseGlobals(globalsString));

  const globalsStateRef = useRef(globalsState);

  useEffect(() => {
    globalsStateRef.current = globalsState;
  });

  const { lastGlobalsString, error } = globalsState;
  const globals: ParsedGlobals =
    globalsState?.globals &&
    typeof globalsState.globals === "object" &&
    !Array.isArray(globalsState.globals)
      ? globalsState.globals
      : {};

  /**
   * @todo this duplicates useParseAnalysis – use that somewhow
   */
  if (globalsString !== lastGlobalsString) {
    /**
     * This is equivalent to using getDerivedStateFromProps
     *
     * @see https://reactjs.org/docs/hooks-faq.html#how-do-i-implement-getderivedstatefromprops
     * @see https://blog.isquaredsoftware.com/2020/05/blogged-answers-a-mostly-complete-guide-to-react-rendering-behavior/#render-behavior-edge-cases
     */
    setGlobals(parseGlobals(globalsString));
  }

  /**
   * If there is an update to Redux globals in the time between when this
   * timeout is scheduled and when it is triggered, we don't want to then
   * replace Redux globals with the scheduled update (overwriting the
   * change from elsewhere).
   */
  const scheduleUpdate = useCancellableDebounce([globalsString]);

  const onChange = useCallback(
    (globals: JsonMap) => {
      setGlobals({ ...globalsStateRef.current, globals });

      scheduleUpdate(() => {
        const contents = stringifyGlobals(globals);

        /**
         * We need to ensure our local copy of globals is updated in the same
         * render as the redux copy to ensure we don't overwrite our local copy
         * with the redux copy (and that we don't re-parse the redux copy which
         * breaks performance).
         */
        batch(() => {
          setGlobals({
            globals,
            lastGlobalsString: contents,
            error: null,
          });
          dispatch(updateFile({ id: globalsFileId, contents }));
        });
      }, 200);
    },
    [dispatch, scheduleUpdate],
  );

  /**
   * @todo this assumes too much about the shame of globals.schema
   */
  const schemaWithDefaults = useMemo(
    () =>
      typeof globals?.schema === "object"
        ? {
            ...globals.schema,
            properties: {
              ...("properties" in globals.schema! &&
              typeof globals.schema?.properties === "object"
                ? globals.schema.properties
                : {}),
              ...globalConfigSchema.properties,
            },
          }
        : globalConfigSchema,
    [globals?.schema],
  );

  if (!globals) {
    return (
      <div className="GlobalsEditor">
        {error ? (
          <div className="GlobalsEditor__Error">
            <IconAlert size={90} />
            <p className="GlobalsEditor__Info">Error parsing globals.json</p>

            {canToggleVisualGlobals ? (
              <FancyButton
                icon="pencil"
                theme="blue"
                onClick={(evt) => {
                  evt.preventDefault();
                  dispatch(toggleVisualGlobals());
                }}
              >
                <strong>Edit globals.json</strong>
              </FancyButton>
            ) : null}
          </div>
        ) : (
          <p className="GlobalsEditor__Info">Loading…</p>
        )}
      </div>
    );
  }

  return (
    <div className="GlobalsEditor">
      <GlobalsObject
        value={globals}
        schema={schemaWithDefaults}
        emptyMessage={emptyMessage}
        onChange={onChange}
        filterField={skipSchema}
        depth={0}
      />
    </div>
  );
};
