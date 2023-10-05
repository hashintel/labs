import React, { FC } from "react";
import { useDispatch, useSelector } from "react-redux";
import { components } from "react-select";
import { useForm } from "react-hook-form";

import { BigModal } from "../BigModal";
import { FancyButton } from "../../Fancy/Button";
import {
  ModalFormEntry,
  ModalFormEntryDropdown,
  ModalFormEntryRequiredText,
  useKeywords,
  useLicenses,
} from "../FormEntry";
import { ModalTwoColumn } from "../TwoColumn";
import type { ReleaseMeta } from "../../../util/api/types";
import { getCreateReleaseDescription } from "./util";
import {
  handleQueryCodeErrors,
  validateDescription,
  validateName,
} from "../../../features/project/validation";
import { release } from "../../../features/project/slice";
import { selectCurrentProjectRequired } from "../../../features/project/selectors";
import { useFatalError } from "../../ErrorBoundary/ErrorBoundary";

// n.b. `react-select` has kind of a weird module/exports setup, we only
// actually want the `Option` component here
const { Option } = components;

type ModalCreateReleaseProps = {
  onClose: VoidFunction;
  data?: ReleaseMeta;
};

type FormInputs = {
  name: string;
  description: string;
};

export const ModalReleaseCreate: FC<ModalCreateReleaseProps> = ({
  onClose,
  data,
}) => {
  const project = useSelector(selectCurrentProjectRequired);
  const dispatch = useDispatch();
  const fatalError = useFatalError();

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
    setError,
  } = useForm<FormInputs>({
    defaultValues: {
      name: project.name,
      description: project.description ?? "",
    },
    shouldFocusError: true,
    mode: "onTouched",
  });

  /* KEYWORD OPTIONS */
  const [keywordOptions, selectedKeywords, setSelectedKeywords] = useKeywords(
    data?.keywords,
    project.keywords
  );

  /* LICENSE OPTIONS */
  const [licenseOptions, selectedLicense, setSelectedLicense] = useLicenses(
    data?.licenses,
    project.license
  );

  const onSubmit = async (values: FormInputs) => {
    try {
      await handleQueryCodeErrors(values, setError, async () => {
        await dispatch(
          release({
            tag: "1.0.0",
            updateDescription: "Initial Release",
            update: {
              name: values.name,
              description: values.description,
              keywords: selectedKeywords.map((keyword) => keyword.value),
              license: selectedLicense.value ?? "",
            },
          })
        );

        onClose();
      });
    } catch (err) {
      fatalError(err);
    }
  };

  return (
    <BigModal onClose={onClose}>
      <ModalTwoColumn
        title="Create a release"
        intro={getCreateReleaseDescription(project)}
        onSubmit={handleSubmit(onSubmit)}
        disabled={isSubmitting}
        leftChildren={
          <>
            <ModalFormEntryRequiredText
              label="TITLE"
              errorMessage={errors.name?.message}
              placeholder="e.g. Disease Model"
              name="name"
              ref={register({ validate: validateName })}
            />

            <ModalFormEntry
              label="DESCRIPTION"
              optional
              flex
              error={errors.description?.message}
              errorInline={false}
            >
              <textarea
                placeholder="Type a description of your model and how to use it here."
                name="description"
                ref={register({
                  validate: validateDescription,
                })}
              />
            </ModalFormEntry>
          </>
        }
        rightChildren={
          <>
            <ModalFormEntryDropdown
              isDisabled={isSubmitting}
              label="LICENSE"
              options={licenseOptions}
              value={selectedLicense}
              onChange={setSelectedLicense}
              isSearchable={false}
            />

            <ModalFormEntryDropdown
              isDisabled={isSubmitting}
              label="KEYWORD(S)"
              optional
              options={keywordOptions}
              value={selectedKeywords}
              onChange={setSelectedKeywords}
              placeholder="Start typing to enter"
              isMulti
              isClearable
              creatable
              components={{
                Option: (props) => (
                  <Option {...props}>
                    {props.data.label}
                    {props.data.count && ` (${props.data.count})`}
                  </Option>
                ),
              }}
            />
            <FancyButton
              icon="hindex"
              theme="white"
              type="submit"
              disabled={isSubmitting}
            >
              <strong>CREATE RELEASE</strong>
            </FancyButton>
          </>
        }
      />
    </BigModal>
  );
};
