import React, { Dispatch, FC, SetStateAction } from "react";

import { RadioInput } from "../../../Inputs/Radio/RadioInput";

import "./VersionPicker.css";

interface VersionPickerProps {
  nextMajorVersion: string;
  nextMinorVersion: string;
  nextPatchVersion: string;
  selectedVersion: string;
  setSelectedVersion: Dispatch<SetStateAction<string>>;
}

type VersionWithHint = [string, string, string];

export const VersionPicker: FC<VersionPickerProps> = ({
  nextMajorVersion = "1.0.0",
  nextMinorVersion = "0.1.0",
  nextPatchVersion = "0.0.1",
  selectedVersion,
  setSelectedVersion,
}) => (
  <ol className="VersionPicker">
    {(
      [
        [nextMajorVersion, "major", "Major: breaking changes introduced"],
        [nextMinorVersion, "minor", "Minor: for backward-compatible changes"],
        [nextPatchVersion, "patch", "Patch: for backward-compatible bug fixes"],
      ] as VersionWithHint[]
    ).map(([version, bump, hint]) => (
      <li className="VersionPicker__item" key={version}>
        <RadioInput
          id={`VersionPicker--${bump}`}
          className="VersionPicker__input"
          name="VersionPicker"
          value={version}
          checked={version === selectedVersion}
          onChange={(evt) => setSelectedVersion(evt.target.value)}
        />
        <label
          className="VersionPicker__label"
          htmlFor={`VersionPicker--${bump}`}
        >
          {version}
          <br />
          <span className="VersionPicker__label--hint">{hint}</span>
        </label>
      </li>
    ))}
  </ol>
);
