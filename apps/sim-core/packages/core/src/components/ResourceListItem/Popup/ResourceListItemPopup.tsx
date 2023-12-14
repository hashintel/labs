import React, { FC, Fragment, useState } from "react";
import { useDispatch } from "react-redux";
import { ArrowContainer, Position } from "react-tiny-popover";
import ReactMarkdown from "react-markdown";
import classnames from "classnames";
import format from "date-fns/format";
import urljoin from "url-join";

import { FancyAnchor } from "../../Fancy/Anchor";
import { FancyButton } from "../../Fancy/Button";
import { ResourceListItemPopupTable } from "./Table";
import {
  ResourceProject,
  ResourceProjectType,
} from "../../../features/project/types";
import { SITE_URL } from "../../../util/api/paths";
import { ScrollFade } from "../../ScrollFade/ScrollFade";
import { addDependencies } from "../../../features/files/slice";
import { scrollBy } from "./util";
import { trackEvent } from "../../../features/analytics";
import { useResizeObserver } from "../../../hooks/useResizeObserver/useResizeObserver";

import "./ResourceListItemPopup.css";

interface ResourceListItemPopupProps {
  position: Position;
  targetRect: ClientRect;
  popoverRect: ClientRect;
  resource: ResourceProject;
  presentItems: string[];
}

const style = { opacity: "0.95" };

const arrowStyle = {
  width: "20px",
  height: "20px",
  borderLeft: "1px solid var(--theme-border)",
  borderRight: "none",
  borderTop: "none",
  borderBottom: "1px solid var(--theme-border)",
  backgroundColor: "black",
  transform: "translateX(4px) rotate(45deg)",
};

const AddDatasetsLabel = {
  All: <>Add all files</>,
  Additional: <>Add additional files</>,
  Selected: <>Add selected files</>,
};

const useRepositionPopoverOnElementResize = () =>
  useResizeObserver<HTMLDivElement>(
    () => {
      /**
       * Doesn't appear to be an official way to force the popover to
       * reposition so forcing it via a scroll.
       *
       * @see https://github.com/alexkatz/react-tiny-popover/issues/59
       */
      scrollBy(0, 1);

      setTimeout(() => {
        scrollBy(0, -1);
      });
    },
    { onObserve: null },
  );

const infoTextByType: { [type in ResourceProjectType]: string } = {
  Dataset: "dataset",
  Behavior: "behavior",
};

/**
 * Due to issue in date-fns, we need to use `aaaaa'm'` to get `am/pm`.
 * @see https://github.com/date-fns/date-fns/issues/946
 */
const renderUpdatedAtTime = (updatedAt: string) =>
  format(new Date(updatedAt), "do LLL yyyy 'at' hh':'mmaaaaa'm'");

/**
 * copied directly from MAIN
 * @todo nathggns: figure out how to share this
 */
export function linkShortnames(text?: string): string {
  if (!text) {
    return "";
  }

  const parts: string[] = text.split(/( @[a-zA-Z0-9-_]+(?=\s|\.|,|$))/g);

  for (let idx = 1; idx < parts.length; idx += 2) {
    parts[idx] = ` [${parts[idx].slice(1)}](https://hash.ai/${parts[idx].slice(
      1,
    )})`;
  }
  return parts.join("");
}

/**
 * copied directly from MAIN
 * @todo nathggns: figure out how to share this
 */
const ResourceMarkdownDescription: FC<{
  description: string;
  trusted: boolean;
}> = ({ description, trusted }) => (
  <ReactMarkdown skipHtml={!trusted} linkTarget="_blank noreferrer noopener">
    {linkShortnames(description)}
  </ReactMarkdown>
);

export const ResourceListItemPopup: FC<ResourceListItemPopupProps> = ({
  position,
  targetRect,
  popoverRect,
  resource,
  presentItems,
}) => {
  const dispatch = useDispatch();
  const setPopupContainerRef = useRepositionPopoverOnElementResize();
  const [deselectedItems, setDeselectedItems] = useState<string[]>([]);

  const selectableItems = resource.files.filter(
    (file) => !presentItems.includes(file.path.formatted),
  );
  const selectableItemsCount = selectableItems.length;
  const addButtonDisabled = deselectedItems.length === selectableItemsCount;
  const multiItemMode = resource.files.length > 1;

  const updateSimulation = async () => {
    if (!resource.latestRelease) {
      throw new Error("Cannot add a resource which does not have a release");
    }

    const tag = resource.latestRelease.tag;

    switch (resource.type) {
      case "Dataset":
        dispatch(
          trackEvent({
            action: "Import Dataset",
            label: `${resource.name} - ${resource.pathWithNamespace}`,
          }),
        );

        break;
      case "Behavior":
        dispatch(
          trackEvent({
            action: "Import Behavior",
            label: `${resource.name} - ${resource.pathWithNamespace}`,
          }),
        );
        break;
    }

    await dispatch(
      addDependencies(
        Object.fromEntries(
          resource.files
            .filter(
              (files) =>
                !deselectedItems.includes(files.path.formatted) &&
                !presentItems.includes(files.path.formatted),
            )
            .map((item) => [item.path.formatted, tag]),
        ),
      ),
    );
  };

  return (
    <ArrowContainer
      position={position}
      targetRect={targetRect}
      popoverRect={popoverRect}
      arrowSize={14}
      arrowStyle={arrowStyle}
      style={style}
    >
      <div className="ResourceListItemPopup" ref={setPopupContainerRef}>
        <div className="ResourceListItemPopup__Scroller">
          <h1 className="ResourceListItemPopup__header">{resource.name}</h1>
          <h2 className="ResourceListItemPopup__shortname">
            {multiItemMode
              ? resource.pathWithNamespace
              : resource.files[0].path.formatted}
          </h2>
          <ScrollFade>
            {(ref: (ref: HTMLParagraphElement) => void) => (
              <div className="ResourceListItemPopup__text" ref={ref}>
                {resource.description ? (
                  <ResourceMarkdownDescription
                    description={resource.description}
                    trusted={resource.trusted}
                  />
                ) : (
                  <em>
                    This {infoTextByType[resource.type]} is lacking a
                    description. Please <strong>preview in index</strong> to
                    find out more.
                  </em>
                )}
              </div>
            )}
          </ScrollFade>
          {multiItemMode && (
            <ResourceListItemPopupTable
              deselectedItems={deselectedItems}
              onDeselectAllItems={() => {
                setDeselectedItems(
                  selectableItems.map((item) => item.path.formatted),
                );
              }}
              onDeselectItem={(itemId: string) => {
                setDeselectedItems([...deselectedItems, itemId]);
              }}
              onSelectAllItems={() => {
                setDeselectedItems([]);
              }}
              onSelectItem={(itemPath: string) => {
                setDeselectedItems(
                  deselectedItems.filter((path) => path !== itemPath),
                );
              }}
              presentItems={presentItems}
              resource={resource}
              selectableItemsCount={selectableItemsCount}
            />
          )}
          {/** @todo Reimplement the dependencies list */}
          <div className="ResourceListItemPopup__grid">
            <div className="ResourceListItemPopup__grid__item">
              <div className="ResourceListItemPopup__meta">
                <h4 className="ResourceListItemPopup__meta__heading">
                  Last Updated
                </h4>
                <p className="ResourceListItemPopup__meta__contents">
                  {renderUpdatedAtTime(resource.updatedAt)}
                </p>
              </div>
              {resource.subject.length ? (
                <div className="ResourceListItemPopup__meta">
                  <h4 className="ResourceListItemPopup__meta__heading">
                    Schema Relations
                  </h4>
                  <p className="ResourceListItemPopup__meta__contents">
                    {resource.subject.map((subject, idx, arr) => (
                      <Fragment key={subject.name}>
                        <a
                          href={`${SITE_URL}/schemas/${subject.name}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {subject.name}
                        </a>
                        {arr[idx + 1] ? <>, </> : null}
                      </Fragment>
                    ))}
                  </p>
                </div>
              ) : null}
              <FancyButton
                icon="plus"
                className={classnames({
                  ResourceListItemPopup__button: true,
                  "ResourceListItemPopup__button--disabled": addButtonDisabled,
                })}
                onClick={updateSimulation}
                disabled={addButtonDisabled}
              >
                {multiItemMode ? (
                  presentItems.length > 0 ? (
                    AddDatasetsLabel.Additional
                  ) : deselectedItems.length > 0 &&
                    deselectedItems.length < selectableItemsCount ? (
                    AddDatasetsLabel.Selected
                  ) : (
                    AddDatasetsLabel.All
                  )
                ) : (
                  <>Add to Project</>
                )}
              </FancyButton>
            </div>
            <div className="ResourceListItemPopup__grid__item">
              <div className="ResourceListItemPopup__meta">
                <h4 className="ResourceListItemPopup__meta__heading">
                  Published By
                </h4>
                <p className="ResourceListItemPopup__meta__contents">
                  {resource.owner.name}
                </p>
              </div>
              <FancyAnchor
                icon="openInNew"
                target="_blank"
                className="ResourceListItemPopup__button"
                path={urljoin(SITE_URL, resource.pathWithNamespace)}
              >
                Preview in Index
              </FancyAnchor>
            </div>
          </div>
          {presentItems.length > 0 ? (
            <em className="ResourceListItemPopup__delete-explain">
              If you wish to remove this {infoTextByType[resource.type]}, please
              use the <strong>Project Files</strong> pane above.
            </em>
          ) : null}
        </div>
      </div>
    </ArrowContainer>
  );
};
