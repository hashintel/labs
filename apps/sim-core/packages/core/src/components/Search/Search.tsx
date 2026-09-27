import React, { FC } from "react";
import classNames from "classnames";

import { IconClose, IconMagnify, IconSync } from "../Icon";
import { RoundedTextInput } from "../Inputs/RoundedTextInput";

import "./Search.css";

type SearchProps = {
  onChange: (term: string) => void;
  loading: boolean;
  searchTerm: string;
};

export const Search: FC<SearchProps> = ({ onChange, loading, searchTerm }) => {
  const clearable = searchTerm.length > 0;

  return (
    <RoundedTextInput
      className="Search"
      inputClassName="Search__Input"
      placeholder="Search..."
      value={searchTerm}
      onChange={(evt) => {
        onChange(evt.currentTarget.value);
      }}
    >
      <div
        className={classNames({
          Search__Icon: true,
          clearable,
        })}
        onClick={(evt) => {
          if (clearable) {
            evt.preventDefault();
            onChange("");
          }
        }}
      >
        {loading ? (
          <IconSync size={18} />
        ) : clearable ? (
          <IconClose />
        ) : (
          <IconMagnify />
        )}
      </div>
    </RoundedTextInput>
  );
};
