import React, { FC, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import {
  BackButton,
  Button,
  Buttons,
  Indicator,
  ProgressIndicator,
  useKeyboardSupport,
  useSimulationPause,
} from "./util";
import { TabKind } from "../../../../features/viewer/enums";
import { addTab, selectCurrentTab } from "../../../../features/viewer";

const usePlotTab = (): [boolean, HTMLElement | null] => {
  const dispatch = useDispatch();
  const currentTab = useSelector(selectCurrentTab);
  const currentTabKind = currentTab === TabKind.Analysis;

  /**
   * Using state for this as we need to re-render when this changes to position
   * the indicator
   */
  const [elem, setElem] = useState<HTMLElement | null>(null);

  // @todo this may call too frequently
  useEffect(() => {
    dispatch(addTab(TabKind.Analysis));

    const elem = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".SimulationViewerMain .react-tabs__tab",
      ),
    ).find((tab) => tab.innerText.includes("Plots"));

    if (elem) {
      setElem(elem);
    }
  });

  return [currentTabKind, elem];
};

export const HashCoreTourStepPlots: FC = () => {
  const [plotTabSelected, plotTab] = usePlotTab();

  useKeyboardSupport();
  useSimulationPause();

  return (
    <>
      <Indicator
        element={plotTab}
        show={!plotTabSelected}
        position="left-overlap"
      />
      <p>
        You can visualize how particular variables or parameters of interest
        change over the lifetime of your simulation by switching to the
        'Analysis' view.
      </p>
      <p>
        <strong>
          Switch to the 'Analysis' view by clicking the tab above the viewer.
        </strong>
      </p>
      <Buttons>
        <BackButton />
        <Button type="next">Next</Button>
      </Buttons>
      <ProgressIndicator />
    </>
  );
};
