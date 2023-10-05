import React, { FC } from "react";
import { useSelector } from "react-redux";
import classNames from "classnames";

import { CheckboxInput } from "../../Inputs/Checkbox/CheckboxInput";
import { FileNameWithShortnameIcon } from "../../FileName/FileNameWithShortnameIcon";
import { HcBehaviorFile } from "../../../features/files/types";
import { ModalFormEntry } from "../FormEntry";
import { ModalSplitBottomSection } from "../Split/ModalSplitBottomSection";
import { SimpleTooltip } from "../../SimpleTooltip";
import { SimulationProject } from "../../../features/project/types";
import { selectLocalBehaviorFiles } from "../../../features/files/selectors";
import { selectProjectPublishedFiles } from "../../../features/project/selectors";

import "./ModalReleaseChooseFiles.scss";

export const canChooseFiles = (project?: SimulationProject | null) =>
  project?.type === "Behavior";

/**
 * @todo enable publishing non-behavior files
 */
export const ModalReleaseChooseFiles: FC<{
  selectedFiles: HcBehaviorFile[];
  onSelectedFilesChange: (selectedFiles: HcBehaviorFile[]) => void;
}> = ({ selectedFiles, onSelectedFilesChange }) => {
  const files = useSelector(selectLocalBehaviorFiles);
  const existingFiles = useSelector(selectProjectPublishedFiles);

  return (
    <ModalSplitBottomSection
      className="ModalReleaseChooseFiles"
      small
      scrollable
    >
      <ModalFormEntry label="Choose Files">
        <ul className="ModalReleaseChooseFiles__List">
          {files.map((behavior) => {
            const behaviorPath = behavior.path.formatted;
            const published = existingFiles.includes(behaviorPath);
            const toPublish = selectedFiles.some(
              (behavior) => behavior.path.formatted === behaviorPath
            );

            return (
              <li key={behavior.id}>
                <label className={classNames("ModalReleaseChooseFiles__File")}>
                  <CheckboxInput
                    disabled={published}
                    checked={published || toPublish}
                    onChange={(evt) => {
                      const checked = evt.target.checked;

                      onSelectedFilesChange(
                        checked
                          ? [...selectedFiles, behavior]
                          : selectedFiles.filter(
                              (file) => file.path.formatted !== behaviorPath
                            )
                      );
                    }}
                  />
                  <FileNameWithShortnameIcon
                    path={behavior.path}
                    hasTitle={false}
                  />
                  {published ? (
                    <SimpleTooltip
                      position="below"
                      containerClassName="ModalTooltipContainer"
                    >
                      Behaviors cannot currently be removed from published
                      projects
                    </SimpleTooltip>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </ModalFormEntry>
    </ModalSplitBottomSection>
  );
};
