import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";

import { FancyButton } from "../../Fancy/Button";
import { IconEarth } from "../../Icon/Earth";
import { IconLock } from "../../Icon/Lock";
import { ModalFullScreen } from "../FullScreen/ModalFullScreen";
import { NewProjectField } from "./NewProjectField";
import { NewProjectModalValues } from "./types";
import { Org } from "../../../util/api/types";
import { ProjectVisibility } from "../../../features/project/types";
import { Select } from "../../Inputs/Select/Select";
import { TipWithError } from "./TipWithError";
import { USER_ORG_VALUE, namespacePrefix, useOrgs } from "./utils";
import {
  handleQueryCodeErrors,
  validateName,
  validatePath,
} from "../../../features/project/validation";
import { slugify } from "../../../routes";
import { useFatalError } from "../../ErrorBoundary/ErrorBoundary";
import { useSafeOnClose } from "../../../hooks/useSafeOnClose";

import "./ModalNewProject.css";

const getOrgValue = (org?: Org | null) =>
  org ? (org.id === "user" ? USER_ORG_VALUE : org.shortname) : null;

export const ModalNewProject: FC<{
  onCancel: VoidFunction;
  onSubmit: (values: NewProjectModalValues) => Promise<void>;
  defaultName?: string;
  action: ReactNode;
  defaultVisibility?: ProjectVisibility;
  visibilityDisabled?: boolean;
  defaultNamespace?: string;
}> = ({
  onCancel,
  onSubmit,
  action,
  defaultVisibility = "public",
  visibilityDisabled,
  defaultName = "",
  defaultNamespace,
}) => {
  const fatalError = useFatalError();
  const orgs = useOrgs();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [nameFocused, setNameFocused] = useState(false);
  const [namespaceFocused, setNamespaceFocused] = useState(false);
  const [pathFocused, setPathFocused] = useState(false);
  const [visibilityFocused, setVisibilityFocused] = useState(false);

  const defaultOrg = defaultNamespace
    ? orgs.find((org) => org.shortname === defaultNamespace)
    : null;

  const {
    register,
    handleSubmit,
    watch,
    formState: { isDirty, isSubmitting, dirtyFields, errors },
    setValue,
    setError,
  } = useForm<NewProjectModalValues>({
    defaultValues: {
      namespace: getOrgValue(defaultOrg) ?? USER_ORG_VALUE,
      visibility: defaultVisibility,
      name: defaultName,
      path: slugify(defaultName),
    },
    shouldFocusError: true,
    mode: "onBlur",
  });

  const setNameRef = useCallback(
    (node: HTMLInputElement | null) => {
      nameRef.current = node;
      register(node, {
        validate: validateName,
      });
    },
    [register],
  );

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const safeOnCancel = useSafeOnClose(
    Object.keys(dirtyFields).length === 0,
    !isSubmitting,
    onCancel,
  );

  const namespace = watch("namespace");
  const visibility = watch("visibility");
  const privateLabel =
    namespace === USER_ORG_VALUE ? "Private" : "Private to org";

  const createModel = async (values: NewProjectModalValues) => {
    try {
      await handleQueryCodeErrors(values, setError, async () => {
        await onSubmit({
          ...values,
          namespace:
            values.namespace === USER_ORG_VALUE ? "@user" : values.namespace,
        });
      });
    } catch (err) {
      fatalError(err);
    }
  };

  return (
    <ModalFullScreen
      onClose={safeOnCancel}
      modalClassName="ModalNewProject"
      esc={!isDirty}
    >
      <form autoComplete="off" onSubmit={handleSubmit(createModel)}>
        <fieldset disabled={isSubmitting}>
          <NewProjectField
            focused={nameFocused}
            error={!!errors.name}
            name="Name"
            fieldName="name"
          >
            <div className="ModalNewProject__Input ModalNewProject__Input--text">
              <input
                type="text"
                name="name"
                id="name"
                required
                placeholder="e.g. Disease Model"
                onFocus={() => {
                  setNameFocused(true);
                }}
                onBlur={() => {
                  setNameFocused(false);
                }}
                onChange={(evt) => {
                  if (!dirtyFields.path) {
                    setValue("path", slugify(evt.target.value), {
                      shouldValidate: !!errors.path,
                    });
                  }
                }}
                ref={setNameRef}
              />
            </div>
            <TipWithError
              tip="You can change this at any time"
              error={errors.name?.message}
            />
          </NewProjectField>
          <NewProjectField
            focused={namespaceFocused || pathFocused}
            error={!!errors.path}
            name="URL"
            fieldName="path"
          >
            <div className="ModalNewProject__Input ModalNewProject__Input--text">
              <Select
                className="ModalNewProject__Input__FakeSelect"
                name="namespace"
                id="namespace"
                required
                focused={namespaceFocused}
                onFocusedChange={setNamespaceFocused}
                options={orgs.map((org) => ({
                  value: getOrgValue(org)!,
                  displayValue: `@${org.shortname}`,
                }))}
                defaultValue={namespace}
                prefix={<span>{namespacePrefix}/</span>}
                suffix={<span>/</span>}
                ref={register}
              />
              <input
                type="text"
                name="path"
                id="path"
                required
                placeholder="new-model-path"
                onFocus={() => {
                  setPathFocused(true);
                }}
                onBlur={() => {
                  setPathFocused(false);
                }}
                ref={register({ validate: validatePath })}
              />
            </div>
            <TipWithError
              tip="Your project URL cannot be changed once set"
              error={errors.path?.message}
            />
          </NewProjectField>
          <NewProjectField
            focused={visibilityFocused}
            name="Visibility"
            fieldName="visibility"
            showTip={visibilityDisabled}
          >
            <div className="ModalNewProject__Input">
              <Select
                className="ModalNewProject__Input__FakeSelect"
                name="visibility"
                id="visibility"
                required
                focused={visibilityFocused}
                onFocusedChange={setVisibilityFocused}
                disabled={visibilityDisabled}
                options={[
                  {
                    value: "public",
                    displayValue: "Public",
                    selectedDisplayValue: (
                      <>
                        <IconEarth /> Public
                      </>
                    ),
                  },
                  {
                    value: "private",
                    displayValue: privateLabel,
                    selectedDisplayValue: (
                      <>
                        <IconLock /> {privateLabel}
                      </>
                    ),
                  },
                ]}
                defaultValue={visibility}
                ref={register}
              />
            </div>
            <TipWithError
              tip={
                visibilityDisabled
                  ? "The source project must be public before this fork can be public"
                  : "Who should be able to view this project?"
              }
            />
          </NewProjectField>
          <div className="ModalNewProject__Submit">
            <FancyButton type="submit" disabled={isSubmitting}>
              <strong>{action}</strong>
            </FancyButton>
          </div>
        </fieldset>
      </form>
    </ModalFullScreen>
  );
};
