import React, { FC } from "react";

import { HashCoreFilesSearchItemWithIcons } from "./HashCoreFilesSearchItemWithIcons";
import { MonacoIconButton } from "./MonacoIconComponents";
import type { SearchMatch } from "./types";
import { useKeepInView } from "../../../KeepInView";

import "./HashCoreFilesSearchMatch.scss";

type SearchResultProps = {
  match: SearchMatch;
  onClick: (match: SearchMatch) => void;
  onReplace: (match: SearchMatch) => Promise<void>;
  replacing: boolean;
  pending: boolean;
};

export const HashCoreFilesSearchMatch: FC<SearchResultProps> = ({
  match,
  onClick,
  onReplace,
  replacing,
  pending,
}) => {
  const [parentRef, childRef] = useKeepInView();

  return (
    <div
      className="HashCoreFilesSearchMatch"
      onClick={async (evt) => {
        evt.preventDefault();

        await onClick(match);
      }}
    >
      <HashCoreFilesSearchItemWithIcons
        icons={
          replacing ? (
            <MonacoIconButton
              title="Replace"
              iconName="search-replace"
              disabled={pending}
              onClick={async () => {
                await onReplace(match);
              }}
            />
          ) : null
        }
        style={{ overflow: "hidden" }}
        ref={parentRef}
      >
        {match.beforeText}
        <span ref={childRef}>
          {replacing ? (
            <>
              <span className="HashCoreFilesSearchMatch__MatchDiff HashCoreFilesSearchMatch__MatchDiff--Before">
                {match.matchedText}
              </span>
              {match.replaceTerm ? (
                <span className="HashCoreFilesSearchMatch__MatchDiff HashCoreFilesSearchMatch__MatchDiff--After">
                  {match.replaceTerm}
                </span>
              ) : null}
            </>
          ) : (
            <span className="HashCoreFilesSearchMatch__MatchedText">
              {match.matchedText}
            </span>
          )}
        </span>
        {match.afterText}
      </HashCoreFilesSearchItemWithIcons>
    </div>
  );
};
