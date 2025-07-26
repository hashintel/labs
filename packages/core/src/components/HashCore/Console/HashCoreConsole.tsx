import React, { FC, memo, ReactNode, useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import classnames from "classnames";
import format from "date-fns/format";

import { HashCoreConsoleAlert } from "./HashCoreConsoleAlert";
import { IconAlert, IconCheck, IconClose, IconStop } from "../../Icon";
import { Scrollable } from "../../Scrollable";
import type { UserAlert } from "../../../features/viewer/types";
import { clearUserAlerts } from "../../../features/viewer/slice";
import { selectIdKindAndPathFromFiles } from "../../../features/files/selectors";
import { selectUserAlerts } from "../../../features/viewer/selectors";
import { useModalCloudUsage } from "../../Modal/CloudUsage";

import "./HashCoreConsole.css";

const errorIconMap: Record<UserAlert["type"], ReactNode> = {
  error: <IconStop />,
  warning: <IconAlert size={18} />,
  complete: <IconCheck />,
};

/**
 * memo is necessary here as parent components re-render on every keypress due
 * to https://github.com/hashintel/internal/issues/1304
 *
 * @todo nathggns: remove when the above is fixed
 */
export const HashCoreConsole: FC = memo(function HashCoreConsole() {
  const userAlerts = useSelector(selectUserAlerts);
  const dispatch = useDispatch();

  const files = useSelector(selectIdKindAndPathFromFiles);

  const filesMap = useMemo(
    () => Object.fromEntries(files.map((file) => [file.path.formatted, file])),
    [files],
  );

  // Show a modal on more important alert messages
  const [showModal, hideModal] = useModalCloudUsage();
  useEffect(() => {
    const errorContexts = userAlerts.map((err) => err.message);
    if (errorContexts.includes("Out of cloud compute credits")) {
      showModal();
      return () => {
        hideModal();
      };
    }
  }, [userAlerts, showModal, hideModal]);

  return (
    <div
      className={classnames({
        HashCoreConsole: true,
        "HashCoreConsole--empty": userAlerts.length === 0,
      })}
    >
      <div
        className="HashCoreConsole__clear"
        onClick={() => dispatch(clearUserAlerts())}
      >
        <IconClose size={10} />
      </div>

      <Scrollable className="HashCoreConsoleScrollable">
        {({ itemClassName }) => (
          <ul className="HashCoreConsole__alert-list">
            {userAlerts.map((alert) => {
              return (
                <li
                  className={`HashCoreConsole__alert HashCoreConsole__alert--${alert.type} ${itemClassName}`}
                  key={alert.uuid}
                >
                  <div className="timestamp">
                    {format(new Date(alert.timestamp), "yyyy-MM-dd HH:mm:ss")}
                  </div>
                  <span className="type">
                    {errorIconMap[alert.type]} {alert.type}
                  </span>{" "}
                  <HashCoreConsoleAlert alert={alert} files={filesMap} />
                </li>
              );
            })}
          </ul>
        )}
      </Scrollable>
    </div>
  );
});
