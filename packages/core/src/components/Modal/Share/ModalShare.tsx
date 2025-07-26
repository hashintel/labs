import React, { FC } from "react";
import { useSelector } from "react-redux";
import { Tab, TabList, TabPanel, Tabs } from "react-tabs";
import classNames from "classnames";

import { ModalShareByLink } from "./ModalShareByLink";
import { ModalShareEmbed } from "./ModalShareEmbed";
import { ModalSplitOuter } from "../Split/ModalSplit";
import { selectCurrentProjectRequired } from "../../../features/project/selectors";
import { useSelectableRelease } from "./hooks";

import "./ModalShare.scss";

/**
 * @todo clean up tab styling
 */
export const ModalShare: FC<{
  onClose: VoidFunction;
}> = ({ onClose }) => {
  const project = useSelector(selectCurrentProjectRequired);
  const [
    { loading, releases, selectedRelease, hasReleases },
    onSelectedReleaseChange,
  ] = useSelectableRelease(project, project.access);

  return (
    <ModalSplitOuter
      onClose={onClose}
      modalClassName={classNames("ModalShare", {
        "ModalShare--loading": loading,
      })}
      onClick={onClose}
      loading={loading}
    >
      <Tabs>
        {/**
         * @todo add tab support to ModalSplit
         */}
        <TabList className="ModalSplitInner__Top ModalShare__Tabs">
          <Tab
            className="ModalShare__Tabs__Tab"
            selectedClassName="ModalShare__Tabs__Tab--selected"
          >
            Share by link
          </Tab>
          <Tab
            className="ModalShare__Tabs__Tab"
            selectedClassName="ModalShare__Tabs__Tab--selected"
          >
            Embed
          </Tab>
        </TabList>
        <TabPanel>
          <ModalShareByLink
            project={project}
            releases={releases}
            selectedRelease={selectedRelease}
            onSelectedReleaseChange={onSelectedReleaseChange}
            hasReleases={hasReleases}
          />
        </TabPanel>
        <TabPanel>
          <ModalShareEmbed
            project={project}
            releases={releases}
            selectedRelease={selectedRelease}
            onSelectedReleaseChange={onSelectedReleaseChange}
            hasReleases={hasReleases}
          />
        </TabPanel>
      </Tabs>
    </ModalSplitOuter>
  );
};
