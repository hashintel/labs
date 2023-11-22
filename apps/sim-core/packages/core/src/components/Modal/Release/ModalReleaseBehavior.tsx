import React, { FC, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { components } from "react-select";
import { useForm } from "react-hook-form";
import { unwrapResult } from "@reduxjs/toolkit";

import type { AppDispatch } from "../../../features/types";
import { HcBehaviorFile } from "../../../features/files/types";
import { ModalForm } from "../ModalForm";
import {
  ModalFormEntry,
  ModalFormEntryDropdown,
  ModalFormEntryPublishAs,
  ModalFormEntryRequiredText,
  useKeywords,
  useLicenses,
  usePublishAs,
} from "../FormEntry";
import { ModalReleaseChooseFiles } from "./ModalReleaseChooseFiles";
import { ModalSplit } from "../Split/ModalSplit";
import { ModalSplitBottomSection } from "../Split/ModalSplitBottomSection";
import { ModalSplitLegacyTitle } from "../Split/ModalSplitLegacyTitle";
import type { ReleaseMeta } from "../../../util/api/types";
import { ToastKind } from "../../../features/toast";
import { displayToast } from "../../../features/toast/slice";
import { forkAndReleaseBehaviors } from "../../../features/thunks";
import {
  handleQueryCodeErrors,
  validateDescription,
  validateName,
  validatePath,
} from "../../../features/project/validation";
import { selectCurrentProjectRequired } from "../../../features/project/selectors";
import { slugify } from "../../../routes";
import { useFatalError } from "../../ErrorBoundary/ErrorBoundary";
import { useOrgs } from "../NewProject/utils";

// n.b. `react-select` has kind of a weird module/exports setup, we only
// actually want the `Option` component here
const { Option } = components;

interface FormInputs {
  name: string;
  path: string;
  description: string;
}

interface ModalPublishBehaviorToIndexProps {
  onHide: VoidFunction;
  data: ReleaseMeta;
  file: HcBehaviorFile;
}

export const ModalReleaseBehavior: FC<ModalPublishBehaviorToIndexProps> = ({
  onHide,
  data,
  file,
}) => {
  const project = useSelector(selectCurrentProjectRequired);
  const orgs = useOrgs();
  const fatalError = useFatalError();
  const dispatch = useDispatch<AppDispatch>();

  const [toPublish, setToPublish] = useState<HcBehaviorFile[]>([file]);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors, dirtyFields },
    setError,
    setValue,
  } = useForm<FormInputs>({
    defaultValues: {
      name: file.path.name,
      path: slugify(file.path.name),
      description: project.description ?? "",
    },
    shouldFocusError: true,
    mode: "onTouched",
  });

  /* KEYWORD OPTIONS */
  const [keywordOptions, selectedKeywords, setSelectedKeywords] = useKeywords(
    data?.keywords,
  );

  /* LICENSE OPTIONS */
  const [licenseOptions, selectedLicense, setSelectedLicense] = useLicenses(
    data?.licenses,
  );

  /* SUBJECT OPTIONS */
  // const [subjectOptions, selectedSubjects, setSelectedSubjects] = useSubjects(
  //   data?.subjects
  // );

  /* PUBLISH AS OPTIONS */
  const [publishAsOptions, selectedPublishAs, setSelectedPublishAs] =
    usePublishAs(orgs);

  const submitDisabled = toPublish.length === 0;

  const onSubmit = async (values: FormInputs) => {
    if (submitDisabled) {
      return;
    }

    try {
      await handleQueryCodeErrors(values, setError, async () => {
        const { forkedBehaviors } = await dispatch(
          forkAndReleaseBehaviors({
            projectPath: project.pathWithNamespace,
            name: values.name,
            namespace:
              selectedPublishAs.value === "user"
                ? ""
                : selectedPublishAs.subLabel!,
            path: values.path,
            behaviors: toPublish.map((file) => ({
              path: file.repoPath,
              filename: file.path.base,
            })),
            projectDescription: values.description,
            keywords: selectedKeywords.map((keyword) => keyword.value),
            // subjects: selectedSubjects.map((subject) => subject.label),
            license: selectedLicense.value ?? "",
            // @todo allow for private behavior releases
            visibility: "public",
          }),
        ).then(unwrapResult);

        dispatch(
          displayToast({
            kind: ToastKind.ReleaseBehaviorSuccess,
            data: forkedBehaviors,
          }),
        );

        onHide();
      });
    } catch (err) {
      fatalError(err);
    }
  };

  return (
    <ModalSplit
      onClose={onHide}
      top={
        <ModalSplitLegacyTitle
          title="Release behaviors"
          description={
            <>
              Create a fork of your project and release one or more behaviors
              from it, which other users can import into their own projects. You
              will need to update references to these behaviors in your project
              with their new paths.
            </>
          }
        />
      }
      bottom={
        <ModalForm onSubmit={handleSubmit(onSubmit)} disabled={isSubmitting}>
          <ModalReleaseChooseFiles
            selectedFiles={toPublish}
            onSelectedFilesChange={setToPublish}
          />
          <ModalSplitBottomSection flex divide={false}>
            <ModalFormEntryRequiredText
              label="TITLE"
              errorMessage={errors.name?.message}
              placeholder="e.g. Disease Model"
              name="name"
              ref={register({ validate: validateName })}
              onChange={(evt) => {
                if (!dirtyFields.path) {
                  setValue("path", slugify(evt.target.value), {
                    shouldValidate: !!errors.path,
                  });
                }
              }}
            />
            <ModalFormEntryRequiredText
              label="PATH"
              name="path"
              errorMessage={errors?.path?.message}
              placeholder="new-model-path"
              ref={register({ validate: validatePath })}
            />

            <ModalFormEntry
              label="DESCRIPTION"
              optional
              flex
              error={errors.description?.message}
              errorInline={false}
            >
              <textarea
                placeholder={[
                  "Type a description of your behaviors and how to use them",
                  "here. Please explain how they ‘relate to’ different types",
                  "of agents, and how they can be used in practice.",
                ].join(" ")}
                name="description"
                ref={register({
                  validate: validateDescription,
                })}
              />
            </ModalFormEntry>
          </ModalSplitBottomSection>
          <ModalSplitBottomSection flex divide={false}>
            <ModalFormEntryDropdown
              isDisabled={isSubmitting}
              label="LICENSE"
              options={licenseOptions}
              value={selectedLicense}
              onChange={setSelectedLicense}
              isSearchable={false}
            />

            {/* <ModalFormEntryDropdown
              isDisabled={isSubmitting}
              label="RELATES TO"
              optional
              options={subjectOptions}
              value={selectedSubjects}
              onChange={setSelectedSubjects}
              placeholder="Select subject(s)"
              isMulti
              isClearable
              components={{
                Option: (props) => (
                  <Option {...props}>
                    <div>{props.data.label}</div>
                    <div className="sub-label">{props.data.subLabel}</div>
                  </Option>
                ),
              }}
            /> */}

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

            <ModalFormEntryPublishAs
              buttonLabel="RELEASE BEHAVIORS"
              publishAsOptions={publishAsOptions}
              selectedPublishAs={selectedPublishAs}
              setSelectedPublishAs={setSelectedPublishAs}
              disabled={isSubmitting}
              submitDisabled={submitDisabled}
            />
          </ModalSplitBottomSection>
        </ModalForm>
      }
    />
  );
};
