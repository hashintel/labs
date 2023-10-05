import React, { FC, useState, MouseEventHandler, useRef } from "react";
import classNames from "classnames";

import { Dropdown } from "../../Dropdown";
import { FancyButton, FancyButtonProps } from "./FancyButton";
import { IconArrowDownDrop } from "../../Icon/ArrowDownDrop";
import { ReactSelectOption } from "../../Dropdown/types";

import "./FancyButtonWithDropdown.scss";

export const FancyButtonWithDropdown: FC<
  Omit<FancyButtonProps, "onClick"> & {
    dropdownOptions: ReactSelectOption[];
    onClick: MouseEventHandler;
    onOptionSelect: Function;
  }
> = ({
  children,
  className,
  dropdownOptions,
  onClick,
  onOptionSelect,
  ...props
}) => {
  const dropdownArrowRef = useRef(null);
  const [state, setState] = useState<"closed" | "open">("closed");
  const [selectedOption, setSelectedOption] = useState<ReactSelectOption>(
    dropdownOptions[0]
  );

  return (
    <div className="FancyButtonWithDropdownContainer">
      <FancyButton
        {...props}
        className={classNames("FancyButtonWithDropdown", className)}
        onClick={(evt) => {
          if (dropdownArrowRef.current === null) {
            return;
          }
          const clickedDropdownArrow = ((dropdownArrowRef.current as unknown) as Node).contains(
            (evt.target as unknown) as Node
          );
          if (clickedDropdownArrow) {
            return;
          }
          onClick(evt);
        }}
      >
        <div className="flex">
          <div>{children}</div>
          <span
            ref={dropdownArrowRef}
            onClick={(evt) => {
              evt.preventDefault();
              setState(state === "closed" ? "open" : "closed");
            }}
            className={state === "open" ? "rotate180degrees" : "rotate0degrees"}
          >
            <IconArrowDownDrop size={24} />
          </span>
        </div>
      </FancyButton>

      {state === "open" && (
        <div className="FancyButtonWithDropdown-dropdown">
          <Dropdown
            options={dropdownOptions}
            value={selectedOption}
            onChange={(option) => {
              setSelectedOption(option);
              setState("closed");
              onOptionSelect(option);
            }}
            menuIsOpen={true}
          />
        </div>
      )}
    </div>
  );
};
