import React, { FC, memo, ReactNode, useMemo } from "react";
import classnames from "classnames";
import format from "date-fns/format";

import { HashCoreConsoleAlert } from "./HashCoreConsoleAlert";
import { IconAlert, IconCheck, IconClose, IconStop } from "../../Icon";
import { Scrollable } from "../../Scrollable";
import type { UserAlert } from "../../../features/viewer/types";
import { selectIdKindAndPathFromFiles } from "../../../features/files/selectors";
import { useFilesSelector } from "../../../features/files/FilesContext";
import { useViewer } from "../../../features/viewer/ViewerContext";

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
  const { userAlerts, clearUserAlerts } = useViewer();

  const files = useFilesSelector(selectIdKindAndPathFromFiles);

  const filesMap = useMemo(
    () => Object.fromEntries(files.map((file) => [file.path.formatted, file])),
    [files]
  );

  return (
    <div
      className={classnames({
        HashCoreConsole: true,
        "HashCoreConsole--empty": userAlerts.length === 0,
      })}
    >
      <div
        className="HashCoreConsole__clear"
        onClick={() => clearUserAlerts()}
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
