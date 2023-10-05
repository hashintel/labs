import React, { FC, useState } from "react";
import { shallowEqual, useSelector } from "react-redux";
import { useForm } from "react-hook-form";

import { AnalysisModal } from "./AnalysisModal";
import { IconAlertOutline, IconPlus } from "../../Icon";
import { ModalFormEntryRequiredText } from "../FormEntry";
import { Operation, OperationTypes } from "../../Analysis/types";
import { OperationItem } from "./OperationItem";
import { OutputOperation } from "../../../features/analysis/analysisJsonTypes";
import { RESERVED_BUILT_IN_KEYS } from "../../../features/files/validate";
import { ReactSelectOption } from "../../Dropdown/types";
import { selectLocalBehaviorKeyFieldNames } from "../../../features/files/selectors";
import { useSafeOnClose } from "../../../hooks/useSafeOnClose";
import { validateOutput } from "../../../features/analysis/analysisJsonValidation";
import { validateTitle } from "../../../features/analysis/validation";

import "./ModalOutputMetrics.scss";

type ModalOutputMetricsProps = {
  onClose: VoidFunction;
  onSave: Function;
  onDelete?: Function;
  existingMetricKeys?: string[];
  metricKey?: string;
  operations?: Operation[];
  isCreate?: boolean;
};

type FormInputs = {
  title: string;
  operations: Operation[];
};

export const defaultNewOperation: Operation = {
  op: OperationTypes.get,
  field: "agent_id",
};

const operationTypesOptions: ReactSelectOption[] = [
  OperationTypes.filter,
  OperationTypes.count,
  OperationTypes.get,
  OperationTypes.sum,
  OperationTypes.min,
  OperationTypes.max,
  OperationTypes.mean,
].map((item) => ({
  value: item,
  label: item,
}));

export const ModalOutputMetrics: FC<ModalOutputMetricsProps> = ({
  onClose,
  onSave,
  onDelete = () => {},
  existingMetricKeys = [],
  metricKey = "MyMetric",
  isCreate = false,
  operations = [defaultNewOperation],
}) => {
  const [currentOperations, setCurrentOperations] = useState(operations);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [validationErrors, setValidationErrors] = useState<any[]>([]);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<FormInputs>({
    defaultValues: {
      title: metricKey,
      operations,
    },
    shouldFocusError: true,
    mode: "onTouched",
  });

  const validate = () => {
    const validationResults = validateOutput(
      currentOperations as OutputOperation[]
    );
    if (
      validationResults instanceof Error ||
      Array.isArray(validationResults)
    ) {
      setValidationErrors(
        Array.isArray(validationResults)
          ? validationResults
          : [validationResults]
      );
      return false;
    }

    return true;
  };

  const onSubmit = async (values: FormInputs) => {
    const result = {
      ...values,
      operations: currentOperations,
    };
    if (
      existingMetricKeys.includes(result.title) &&
      (metricKey !== result.title || isCreate)
    ) {
      // this means that we are either creating a new one or renaming an existing
      // one using a name that its already in use. This should fail the validation
      setError("title", {
        type: "manual",
        message:
          "The metric name you selected already exists. Please choose a different one",
      });
      return;
    }
    if (!validate()) {
      return;
    }
    onSave(result, metricKey);
    onClose();
  };

  const addNewOperationItem = () => {
    setIsFormDirty(true);
    setCurrentOperations([...currentOperations, defaultNewOperation]);
  };
  const deleteOperationItem = (index: number) => {
    setIsFormDirty(true);
    setCurrentOperations(
      currentOperations.filter((_val: Operation, idx: number) => idx !== index)
    );
  };
  const updateOperationItem = (index: number, newValues: Operation) => {
    setIsFormDirty(true);
    const newOps = [...currentOperations];
    newOps[index] = newValues;
    setCurrentOperations(newOps);
  };

  const AddNewOperation = () => (
    <>
      <div
        className="AnalysisModal__RepeatableFooterItem"
        onClick={addNewOperationItem}
      >
        <span>Add additional operation</span>
        <IconPlus size={14} />
      </div>
      <div className="AnalysisModal__RepeatableFooterItem" />
      <div className="AnalysisModal__RepeatableFooterItem" />
      <div className="AnalysisModal__RepeatableFooterItem" />
      <div className="AnalysisModal__RepeatableFooterItem" />
    </>
  );

  const safeOnClose = useSafeOnClose(!isFormDirty, true, onClose);
  const localBehaviorKeys = useSelector(
    selectLocalBehaviorKeyFieldNames,
    shallowEqual
  );
  const behaviorKeys = [...localBehaviorKeys, ...RESERVED_BUILT_IN_KEYS].sort();
  const behaviorKeysOptions: ReactSelectOption[] = behaviorKeys.map((key) => ({
    label: key,
    value: key,
  }));
  // TODO: we simplified this function to get on time with the release,
  // but leaving it here because we will update it after the board meeting (2021-01-21)
  const getPermittedOperations = (): ReactSelectOption[] =>
    operationTypesOptions;

  const footerLegend = isCreate ? (
    <>
      <strong>Finished?</strong> You'll be able to use your new metric in any
      plot.
    </>
  ) : (
    <>
      <strong>Don't want this metric anymore?</strong>

      <span
        className="AnalysisModal__Footer__Button delete"
        onClick={(evt) => {
          evt.preventDefault();
          onDelete(metricKey);
          onClose();
        }}
      >
        Delete it
      </span>
    </>
  );

  const modalTitle = isCreate ? "Define new metric" : "Edit metric";
  const submitButtonText = isCreate ? "Create new metric" : "Save changes";

  return (
    <AnalysisModal
      onClose={safeOnClose}
      title={modalTitle}
      footerLegend={footerLegend}
      submitButtonText={submitButtonText}
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="AnalysisModal__Container">
        {validationErrors.length === 1 && (
          <h3>There was an error while trying to save your metric</h3>
        )}
        {validationErrors.length > 1 && (
          <h3>There were some errors while trying to save your metric</h3>
        )}
        {validationErrors.map((error) => (
          <div
            key={error.name + error.message}
            className="AnalysisModal__ErrorNotification"
          >
            <IconAlertOutline size={32} />
            <p>{error.message}</p>
          </div>
        ))}

        <ModalFormEntryRequiredText
          className="AnalysisModal__TitleInputContainer"
          label="METRIC NAME"
          errorMessage={errors.title?.message}
          placeholder="MetricName"
          name="title"
          ref={register({ validate: validateTitle })}
        />

        <div className="ModalFormEntry__Label">
          <strong>OPERATIONS</strong>
        </div>

        <div className="ModalOutputMetrics__Operations AnalysisModal__RepeatableContainer">
          <span className="ModalOutputMetrics__Operations__Header AnalysisModal__RepeatableHeaderItem">
            TYPE
          </span>
          <span className="ModalOutputMetrics__Operations__Header AnalysisModal__RepeatableHeaderItem">
            FIELD
          </span>
          <span className="ModalOutputMetrics__Operations__Header AnalysisModal__RepeatableHeaderItem">
            COMPARISON
          </span>
          <span className="ModalOutputMetrics__Operations__Header AnalysisModal__RepeatableHeaderItem">
            VALUE
          </span>
          <span className="ModalOutputMetrics__Operations__Header AnalysisModal__RepeatableHeaderItem" />

          {currentOperations.length > 0 &&
            currentOperations.map((operation: Operation, index: number) => (
              <OperationItem
                operation={operation}
                index={index}
                key={`${operation.op}${index}`}
                onDelete={() => deleteOperationItem(index)}
                onChange={updateOperationItem}
                permittedOperations={getPermittedOperations()}
                behaviorKeysOptions={behaviorKeysOptions}
                hideDelete={index === 0 && currentOperations.length === 1}
              />
            ))}
          {currentOperations[currentOperations.length - 1].op !==
            OperationTypes.count && <AddNewOperation />}
        </div>
      </div>
    </AnalysisModal>
  );
};
