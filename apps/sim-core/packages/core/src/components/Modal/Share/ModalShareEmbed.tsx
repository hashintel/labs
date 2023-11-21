import React, { FC, MouseEvent } from "react";

import { FancyButton } from "../../Fancy";
import { IS_DEV } from "../../../util/api/paths";
import { IconSpinner } from "../../Icon";
import { ModalShareAccessCodeDisclaimer } from "./ModalShareAccessCodeDisclaimer";
import { ModalShareCopyButton } from "./ModalShareCopyButton";
import { ModalShareSelect } from "./ModalShareSelect";
import { ModalShareViews, ModalShareViewsParams } from "./ModalShareViews";
import { ModalSplitBottomSection } from "../Split/ModalSplitBottomSection";
import { ModalSplitInner } from "../Split/ModalSplit";
import { SimulationProject } from "../../../features/project/types";
import { embeddableTabs, viewerTabs } from "../../../features/viewer/utils";
import { getSafeQueryParams } from "../../../util/getSafeQueryParams";
import { projectIsPrivate } from "../../../features/project/utils";
import { useParams } from "./utils";
import { useRequestAccessCode } from "./hooks";

import "./ModalShareEmbed.scss";

const linkToBuild =
  getSafeQueryParams()?.forceRootEmbed !== "true" ? IS_DEV : false;

const embedViewerTabs = viewerTabs.filter((tab) =>
  embeddableTabs.includes(tab.kind)
);

const defaultParams: ModalShareViewsParams = {
  view: embedViewerTabs[0].kind,
};

const iframeSrcCode = (
  pathWithNamespace: string,
  ref: string,
  accessCode: string | null,
  params: (readonly [string, string])[]
) => {
  const query: Record<string, string> = {
    project: pathWithNamespace,
    ref,
    ...Object.fromEntries(params),
  };

  if (typeof accessCode === "string") {
    query.accessCode = accessCode;
  }

  return `\
<iframe src="${window.location.origin}/${
    linkToBuild ? `${BUILD_STAMP}/` : ""
  }embed.html?${new URLSearchParams(
    query
  ).toString()}" width="700" height="400" frameborder="0" scrolling="auto"></iframe>`;
};

export const ModalShareEmbed: FC<{
  project: SimulationProject;
  selectedRelease: string;
  onSelectedReleaseChange: (release: string) => void;
  releases: string[];
  hasReleases: boolean;
}> = ({
  project,
  selectedRelease,
  releases,
  onSelectedReleaseChange,
  hasReleases,
}) => {
  const { accessCode, requesting, requestAccessCode } = useRequestAccessCode(
    project,
    "ReadEmbed"
  );

  const { params, setParams, changedParams } = useParams(defaultParams);
  const value = iframeSrcCode(
    project.pathWithNamespace,
    selectedRelease,
    accessCode,
    changedParams
  );

  const isPrivate = projectIsPrivate(project);

  return (
    <ModalSplitInner
      innerClassName="ModalShareEmbed"
      top={
        <>
          <div className="ModalShareEmbed__Sizer" data-value={value}>
            <textarea
              readOnly
              value={value}
              onClick={(evt) => {
                if (!evt.shiftKey) {
                  evt.preventDefault();
                  (evt.target as HTMLTextAreaElement).select();
                }
              }}
            />
            <ModalShareCopyButton
              text={value}
              className="ModalShareEmbed__Copy"
            />
            {isPrivate && !accessCode ? (
              <div className="ModalShareEmbed__Sizer__RequestToken">
                {requesting ? (
                  <IconSpinner size={36} />
                ) : (
                  <FancyButton
                    onClick={async (evt: MouseEvent<HTMLButtonElement>) => {
                      evt.preventDefault();
                      await requestAccessCode();
                    }}
                    theme="blue"
                  >
                    <strong>Create shareable code</strong>
                  </FancyButton>
                )}
              </div>
            ) : null}
          </div>
          {isPrivate ? (
            <ModalShareAccessCodeDisclaimer
              hasAccessCode={!!accessCode}
              name="code"
            />
          ) : null}
        </>
      }
      bottom={
        <div className="ModalShare__BottomSections">
          <ModalShareViews
            params={params}
            onParamsChange={setParams}
            availableTabs={embedViewerTabs}
          />
          {hasReleases ? (
            <ModalSplitBottomSection>
              <h4>Version</h4>
              <ModalShareSelect
                options={releases.map((release) => ({ value: release }))}
                value={selectedRelease}
                onChange={(evt) => onSelectedReleaseChange(evt.target.value)}
                className="ModalShare__RefSelect ModalShareEmbed__ReleasePicker"
              />
            </ModalSplitBottomSection>
          ) : null}
        </div>
      }
    />
  );
};
