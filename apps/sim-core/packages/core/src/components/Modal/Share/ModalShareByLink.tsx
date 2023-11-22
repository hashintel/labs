import React, { FC, useLayoutEffect, useRef, useState } from "react";
import urljoin from "url-join";

import { CheckboxInput } from "../../Inputs/Checkbox/CheckboxInput";
import { ModalShareAccessCodeDisclaimer } from "./ModalShareAccessCodeDisclaimer";
import { ModalShareCopyButton } from "./ModalShareCopyButton";
import { ModalShareSelect } from "./ModalShareSelect";
import { ModalShareViews, ModalShareViewsParams } from "./ModalShareViews";
import { ModalSplitBottomSection } from "../Split/ModalSplitBottomSection";
import { ModalSplitInner } from "../Split/ModalSplit";
import { SimulationProject } from "../../../features/project/types";
import { projectIsPrivate } from "../../../features/project/utils";
import { urlFromProject } from "../../../routes";
import { useParams } from "./utils";
import { useRequestAccessCode } from "./hooks";
import { viewerTabs } from "../../../features/viewer/utils";

import "./ModalShareByLink.scss";

const defaultParams: ModalShareViewsParams & {
  editor?: boolean;
  activity?: boolean;
  viewer?: boolean;
} = {
  view: viewerTabs[0].kind,
  editor: true,
  activity: true,
  viewer: true,
};

interface UrlParams {
  changedParams: [string, string][];
  requireAccessCode: boolean;
  accessCode: string | null;
  baseUrl: string;
}

const generateUrl = (params: UrlParams) => {
  const { requireAccessCode, accessCode, changedParams, baseUrl } = params;

  const searchParams = new URLSearchParams(changedParams);

  if (accessCode && requireAccessCode) {
    searchParams.set("accessCode", accessCode);
  }

  const searchParamString = searchParams.toString();

  return urljoin(
    window.location.origin,
    `${baseUrl}${searchParamString.length ? `?${searchParamString}` : ""}`,
  );
};

const useTargetVisibility = (project: SimulationProject) => {
  const privateSharingDisabled =
    projectIsPrivate(project) && !!project.access?.code;
  const defaultTargetVisibility = privateSharingDisabled ? "public" : "private";
  const [targetVisibility, setTargetVisibility] = useState(
    defaultTargetVisibility,
  );

  if (privateSharingDisabled && targetVisibility !== defaultTargetVisibility) {
    setTargetVisibility(defaultTargetVisibility);
  }

  return [
    targetVisibility,
    setTargetVisibility,
    privateSharingDisabled,
  ] as const;
};

export const ModalShareByLink: FC<{
  releases: string[];
  project: SimulationProject;
  selectedRelease: string;
  onSelectedReleaseChange: (selectedRelease: string) => void;
  hasReleases: boolean;
}> = ({
  releases,
  project,
  selectedRelease,
  onSelectedReleaseChange,
  hasReleases,
}) => {
  const { params, setParams, changedParams } = useParams(defaultParams);
  const { accessCode, requestAccessCode } = useRequestAccessCode(
    project,
    "Read",
  );

  const isPrivate = projectIsPrivate(project);

  const [targetVisibility, setTargetVisibility, privateSharingDisabled] =
    useTargetVisibility(project);

  const urlParams: UrlParams = {
    changedParams,
    accessCode,
    requireAccessCode: isPrivate && targetVisibility === "public",
    baseUrl: urlFromProject({
      pathWithNamespace: project.pathWithNamespace,
      ref: selectedRelease,
    }),
  };

  const urlParamsRef = useRef(urlParams);
  useLayoutEffect(() => {
    urlParamsRef.current = urlParams;
  });

  return (
    <ModalSplitInner
      innerClassName="ModalShareByLink"
      bottom={
        <div className="ModalShare__BottomSections">
          {hasReleases || isPrivate ? (
            <ModalSplitBottomSection>
              {hasReleases ? (
                <>
                  <h4>Version</h4>
                  <ModalShareSelect
                    className="ModalShare__RefSelect"
                    value={selectedRelease}
                    onChange={(evt) => {
                      onSelectedReleaseChange(evt.currentTarget.value);
                    }}
                    options={releases.map((release) => ({
                      value: release,
                    }))}
                  />
                </>
              ) : null}
              {isPrivate ? (
                <div className="ModalShareByLink__Visibility">
                  <h4>Visibility</h4>
                  <ModalShareSelect
                    options={[
                      {
                        value: "private",
                        displayValue:
                          project.ownerType === "User"
                            ? "Only you"
                            : `Users in @${project.namespace}`,
                      },
                      {
                        value: "public",
                        displayValue: "Anyone with the link",
                      },
                    ]}
                    value={targetVisibility}
                    onChange={(evt) => {
                      setTargetVisibility(evt.target.value);
                    }}
                    disabled={privateSharingDisabled}
                  />
                </div>
              ) : null}
            </ModalSplitBottomSection>
          ) : null}
          <ModalShareViews
            params={params}
            onParamsChange={setParams}
            availableTabs={viewerTabs}
          />
          <ModalSplitBottomSection flex className="ModalShareByLink__Right">
            <h4>Other options</h4>
            <label htmlFor="editor">
              <CheckboxInput
                id="editor"
                name="editor"
                checked={!params.editor}
                onChange={(evt) => {
                  const editor = !evt.target.checked;
                  setParams({ ...params, editor });
                }}
              />
              Hide the code editor
            </label>
            <label htmlFor="viewer">
              <CheckboxInput
                id="viewer"
                name="viewer"
                checked={!params.viewer}
                onChange={(evt) => {
                  const viewer = !evt.target.checked;
                  setParams({ ...params, viewer });
                }}
              />
              Hide the viewer
            </label>
            <label htmlFor="activity">
              <CheckboxInput
                id="activity"
                name="activity"
                checked={!params.activity}
                onChange={(evt) => {
                  const activity = !evt.target.checked;
                  setParams({ ...params, activity });
                }}
              />
              Hide the activity sidebar
            </label>
            <div className="ModalShareByLink__LinkSection">
              <ModalShareCopyButton
                text={async () => {
                  if (
                    urlParamsRef.current.requireAccessCode &&
                    !urlParamsRef.current.accessCode
                  ) {
                    await requestAccessCode();
                  }

                  return generateUrl(urlParamsRef.current);
                }}
              />
              {urlParams.requireAccessCode ? (
                <ModalShareAccessCodeDisclaimer hasAccessCode name="link" />
              ) : null}
            </div>
          </ModalSplitBottomSection>
        </div>
      }
    />
  );
};
