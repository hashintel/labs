import React, { FC, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { FancyButton } from "../../Fancy";
import { HcBehaviorFile } from "../../../features/files/types";
import { IconUpdate } from "../../Icon/Update";
import { ModalForm } from "../ModalForm";
import { ModalFormEntry } from "../index";
import {
  ModalReleaseChooseFiles,
  canChooseFiles,
} from "./ModalReleaseChooseFiles";
import { ModalSplit } from "../Split/ModalSplit";
import { ModalSplitBottomSection } from "../Split/ModalSplitBottomSection";
import { ModalSplitLegacyTitle } from "../Split/ModalSplitLegacyTitle";
import { VersionPicker } from "./VersionPicker/VersionPicker";
import { getCreateReleaseDescription } from "./util";
import { release } from "../../../features/project/slice";
import { selectCurrentProject } from "../../../features/project/selectors";
import { useFatalError } from "../../ErrorBoundary/ErrorBoundary";

import "./ModalReleaseUpdate.scss";

type ModalReleaseUpdateProps = {
  onClose: VoidFunction;
};

const parseVersion: (version: string) => [number, number, number] = (semver) =>
  semver
    .split(".")
    .map((part) => {
      const parsed = parseInt(part, 10);
      return isNaN(parsed) ? 0 : parsed;
    })
    .slice(0, 3) as [number, number, number];

export const ModalReleaseUpdate: FC<ModalReleaseUpdateProps> = ({
  onClose,
}) => {
  const project = useSelector(selectCurrentProject);
  const [toPublish, setToPublish] = useState<HcBehaviorFile[]>([]);

  const dispatch = useDispatch();
  const fatalError = useFatalError();

  if (!project?.latestRelease) {
    throw new Error(
      "Cannot update release for a project that has never been released"
    );
  }

  const [major, minor, patch] = parseVersion(project.latestRelease.tag);

  const nextMajorVersion = `${major + 1}.0.0`;
  const nextMinorVersion = `${major}.${minor + 1}.0`;
  const nextPatchVersion = `${major}.${minor}.${patch + 1}`;

  const [selectedVersion, setSelectedVersion] = useState(nextMajorVersion);
  const [changeSummary, setChangeSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    try {
      setSubmitting(true);

      await dispatch(
        release({
          tag: selectedVersion,
          updateDescription: changeSummary,
          toPublish: toPublish.map((file) => file.path.formatted),
        })
      );
      onClose();
    } catch (err) {
      fatalError(err);
    }
  }

  return (
    <ModalSplit
      onClose={onClose}
      modalClassName="ModalReleaseUpdate"
      top={
        <ModalSplitLegacyTitle
          title={
            <>
              Create an updated release <IconUpdate size={46} />
            </>
          }
          description={
            <>
              Let people know what kind of an update this is with an optional
              note. {getCreateReleaseDescription(project)}
            </>
          }
        />
      }
      bottom={
        <ModalForm disabled={submitting} onSubmit={onSubmit}>
          {canChooseFiles(project) ? (
            <ModalReleaseChooseFiles
              selectedFiles={toPublish}
              onSelectedFilesChange={setToPublish}
            />
          ) : null}
          <ModalSplitBottomSection>
            <ModalFormEntry label="Semantic Versioning">
              <VersionPicker
                nextMajorVersion={nextMajorVersion}
                nextMinorVersion={nextMinorVersion}
                nextPatchVersion={nextPatchVersion}
                selectedVersion={selectedVersion}
                setSelectedVersion={setSelectedVersion}
              />
            </ModalFormEntry>
          </ModalSplitBottomSection>
          <ModalSplitBottomSection>
            <ModalFormEntry label="CHANGE SUMMARY" optional flex>
              <textarea
                placeholder={`Let users know what's changed in your ${project.type.toLowerCase()} since the last published update.`}
                value={changeSummary}
                onChange={(evt) => setChangeSummary(evt.target.value)}
                rows={10}
              />
            </ModalFormEntry>
            <FancyButton
              icon="hindex"
              theme="white"
              type="submit"
              disabled={submitting}
            >
              <strong>
                {changeSummary.trim().length === 0
                  ? "CREATE RELEASE"
                  : "CREATE RELEASE WITH CHANGE SUMMARY"}
              </strong>
            </FancyButton>
          </ModalSplitBottomSection>
        </ModalForm>
      }
    />
  );
};
