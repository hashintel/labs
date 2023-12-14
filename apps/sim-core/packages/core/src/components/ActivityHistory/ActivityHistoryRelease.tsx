import React, { FC, useRef } from "react";
import { useSelector } from "react-redux";

import { ActivityHistoryItem } from "./ActivityHistoryItem";
import { ActivityHistoryRowSpacer } from "./ActivityHistoryRowSpacer";
import { ActivityTime } from "./ActivityTime";
import { LazyIconLoading } from "../Icon/Loading/LazyIconLoading";
import { selectProjectPathWithNamespace } from "../../features/project/selectors";
import { theme } from "../../util/theme";
import { urlFromProject } from "../../routes";
import { useCurrentRefItem } from "./hooks";
import { useSafeQueryParams } from "../../hooks/useSafeQueryParams";

import "./ActivityHistoryRelease.scss";

/**
 * @todo release indicator
 */
export const ActivityHistoryRelease: FC<{
  tag: string;
  createdAt: number | null;
}> = ({ tag, createdAt }) => {
  const pathWithNamespace = useSelector(selectProjectPathWithNamespace);
  const ref = useRef<HTMLElement>(null);
  const { current, currentlySwitchingTo } = useCurrentRefItem(tag, ref);

  const [queryParams] = useSafeQueryParams();

  if (!pathWithNamespace) {
    return null;
  }

  return (
    <ActivityHistoryItem
      as="link"
      path={urlFromProject({
        pathWithNamespace,
        ref: tag,
      })}
      query={queryParams}
      viewable={!currentlySwitchingTo && !current}
      ref={ref}
    >
      {tag === "main" ? <>Working copy</> : <>Release {tag}</>}{" "}
      {current ? <>•</> : null}
      <ActivityHistoryRowSpacer />
      {currentlySwitchingTo ? (
        <div className="ActivityHistoryRelease__Loading">
          <LazyIconLoading end={theme.dark} />
        </div>
      ) : null}
      {createdAt === null ? null : <ActivityTime time={createdAt} />}
    </ActivityHistoryItem>
  );
};
