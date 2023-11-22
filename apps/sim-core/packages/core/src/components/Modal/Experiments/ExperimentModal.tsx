import React, {
  ChangeEvent,
  FC,
  FormEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import { ProviderTargetEnv } from "@hashintel/engine-web";
import { Result, combine, ok } from "neverthrow";
import { omit, pick } from "lodash";
import { v4 as uuid } from "uuid";

import {
  AllFormDataTypeDynamicFieldsType,
  DistributionTypes,
  ExperimentTypes,
  FormDataDynamicFieldOptimizationErrorsType,
  FormDataDynamicFieldOptimizationFieldType,
  FormDataDynamicFieldOptimizationMetricObjective,
  FormDataDynamicFieldOptimizationType,
  FormDataType,
  FormErrorsType,
  ParseError,
  ParseResult,
  RawExperimentOptimizationField,
  RawExperimentOptimizationType,
  RawExperimentType,
} from "./types";
import { ExperimentTypeTooltip } from "./ExperimentTypeTooltip";
import { FancyButton } from "../../Fancy";
import { FancyButtonWithDropdown } from "../../Fancy/Button/FancyButtonWithDropdown";
import { IconHelpCircleOutline } from "../../Icon/HelpCircleOutline";
import { IconTrash } from "../../Icon";
import { Modal, ModalFormEntryDropdown, ModalFormEntryRequiredText } from "..";
import { ModalExit } from "../ModalExit";
import { ModalFormEntryLabel } from "../FormEntry/ModalFormEntryLabel";
import { ReactSelectOption } from "../../Dropdown/types";
import { RoundedSelect } from "../../Inputs/Select/RoundedSelect";
import { addUserAlert } from "../../../features/viewer/slice";
import {
  convertToReactSelectOption,
  convertToReactSelectOptions,
  errorsTypeHasError,
  flattenObjectKeysIntoString,
  formErrorsTypeFromDataType,
  getErrorClassname,
} from "./utils";
import {
  experimentsFileId,
  stringifyExperiments,
} from "../../../features/files/utils";
import {
  isRange,
  parseValuesFromInput,
  serializeParsedValues,
} from "./valuesParser";
import { parseGlobals } from "../../GlobalsEditor/utils";
import { queueExperiment } from "../../../features/simulator/simulate/queueExperiment";
import { selectExperiments } from "../../SimulationRunner/Controls/Experiments/selectors";
import {
  selectGlobals,
  selectParsedAnalysisMetricNames,
} from "../../../features/files/selectors";
import { selectProviderTarget } from "../../../features/simulator/simulate/selectors";
import { toggleProviderTarget } from "../../../features/simulator/simulate/thunks";
import { updateFile } from "../../../features/files/slice";
import { useRefState } from "../../../hooks/useRefState";
import {
  useSimulatorDispatch,
  useSimulatorSelector,
} from "../../../features/simulator/context";

import "./ExperimentModal.scss";

const typeOptions: ReactSelectOption[] = [
  {
    value: ExperimentTypes.values,
    label: "Value sweeping",
  },
  {
    value: ExperimentTypes.linspace,
    label: "Linspace sweeping",
  },
  {
    value: ExperimentTypes.arange,
    label: "Arange sweeping",
  },
  {
    value: ExperimentTypes.monteCarlo,
    label: "Monte Carlo sweeping",
  },
  {
    value: ExperimentTypes.group,
    label: "Group",
  },
  {
    value: ExperimentTypes.multiparameter,
    label: "Multiparameter",
  },
  {
    value: ExperimentTypes.optimization,
    label: "Optimization",
  },
];

const monteCarloDistributionOptions: ReactSelectOption[] = [
  DistributionTypes.normal,
  DistributionTypes.logNormal,
  DistributionTypes.poisson,
  DistributionTypes.beta,
  DistributionTypes.gamma,
].map((distribution) => ({ value: distribution, label: distribution }));

const optimizationMetricObjectiveOptions: ReactSelectOption[] = [
  FormDataDynamicFieldOptimizationMetricObjective.max,
  FormDataDynamicFieldOptimizationMetricObjective.min,
].map((value) => ({ value, label: value }));

const stepsInputProps = {
  type: "number",
  min: 1,
  step: 1,
  label: "STEPS",
  errorMessage: "",
};

const fieldInputProps = {
  label: "FIELD",
  placeholder: "Global parameter",
  errorMessage: "",
};

const defaultFieldOption = {
  value: "",
  label: "",
} as ReactSelectOption;

const initialFormDynamicFieldsData: Required<FormDataType["dynamicFields"]> = {
  values: {
    steps: 100,
    field: defaultFieldOption,
    values: "",
  },
  linspace: {
    steps: 100,
    field: defaultFieldOption,
    start: 0,
    stop: 0,
    samples: 0,
  },
  arange: {
    steps: 100,
    field: defaultFieldOption,
    start: 0,
    stop: 0,
    increment: 0,
  },
  "monte-carlo": {
    steps: 100,
    samples: 1,
    field: defaultFieldOption,
    distribution: monteCarloDistributionOptions[0],
    mean: 0,
    std: 0,
    mu: 0,
    sigma: 0,
    rate: 0,
    alpha: 0,
    beta: 0,
    shape: 0,
    scale: 0,
  },
  group: {
    steps: 100,
    runs: [],
  },
  multiparameter: {
    steps: 100,
    runs: [],
  },
  optimization: {
    maxRuns: 10,
    minSteps: 10,
    maxSteps: 100,
    metricName: {
      value: "",
      label: "",
    },
    metricObjective: {
      value: FormDataDynamicFieldOptimizationMetricObjective.max,
      label: FormDataDynamicFieldOptimizationMetricObjective.max,
    },
    fields: [],
  },
};

export const initialFormData = {
  experimentTitle: "",
  experimentType: typeOptions[0],
  dynamicFields: initialFormDynamicFieldsData,
};

const getFieldsForMonteCarloDistribution = (
  distribution: DistributionTypes,
): string[] => {
  switch (distribution) {
    case DistributionTypes.logNormal:
      return ["mu", "sigma"];

    case DistributionTypes.poisson:
      return ["rate"];

    case DistributionTypes.beta:
      return ["alpha", "beta"];

    case DistributionTypes.gamma:
      return ["shape", "scale"];

    case DistributionTypes.normal:
    default:
      return ["mean", "std"];
  }
};

const optimizationFieldTemplate = () => ({
  name: "",
  uuid: uuid(),
  value: "",
});

const prepareExperimentForFormData = (
  experiment?: RawExperimentType,
): FormDataType | undefined => {
  if (!experiment) {
    return;
  }
  /**
   * This isn't right – this is still the raw type at this point.
   *
   * @todo fix this
   */
  const clone: FormDataType = JSON.parse(JSON.stringify(experiment));
  const experimentType = experiment.experimentType as ExperimentTypes;
  clone.experimentType = convertToReactSelectOption(experimentType);
  if (experimentType === ExperimentTypes.values) {
    if (clone.dynamicFields[ExperimentTypes.values]) {
      const originalValues =
        experiment.dynamicFields[ExperimentTypes.values]!.values;
      clone.dynamicFields[ExperimentTypes.values]!.values =
        serializeParsedValues(originalValues);
    }
  }
  if (experimentType === ExperimentTypes.optimization) {
    if (clone.dynamicFields[ExperimentTypes.optimization]) {
      const originalFields =
        experiment.dynamicFields[ExperimentTypes.optimization];
      const cloneFields = clone.dynamicFields[ExperimentTypes.optimization];

      if (cloneFields) {
        if (Array.isArray(cloneFields.fields) && cloneFields.fields.length) {
          // @todo remove this casting
          cloneFields.fields = (
            cloneFields as any as RawExperimentOptimizationType
          ).fields.map(
            (
              field: RawExperimentOptimizationField,
            ): FormDataDynamicFieldOptimizationFieldType => {
              const newField = {
                name: field.name,
                uuid: uuid(),
              };

              if ("range" in field) {
                return {
                  ...newField,
                  value:
                    typeof (field.range as unknown) === "string"
                      ? field.range
                      : "",
                };
              } else if (Array.isArray(field.values)) {
                return {
                  ...newField,
                  value: serializeParsedValues(field.values),
                };
              } else {
                return { ...newField, value: "" };
              }
            },
          );
        } else {
          cloneFields.fields = [optimizationFieldTemplate()];
        }

        if (originalFields?.metricName) {
          cloneFields.metricName = {
            value: originalFields.metricName,
            label: originalFields.metricName,
          };
        }
        if (
          originalFields?.metricObjective ===
            FormDataDynamicFieldOptimizationMetricObjective.min ||
          originalFields?.metricObjective ===
            FormDataDynamicFieldOptimizationMetricObjective.max
        ) {
          cloneFields.metricObjective = {
            value: originalFields?.metricObjective,
            label: originalFields?.metricObjective,
          };
        } else {
          cloneFields.metricObjective =
            initialFormDynamicFieldsData[
              ExperimentTypes.optimization
            ].metricObjective;
        }
      }
    }

    return clone;
  }
  if (
    experimentType === ExperimentTypes.group ||
    experimentType === ExperimentTypes.multiparameter
  ) {
    // these experiment types do not use a `field` property but a 'runs'
    let value = clone.dynamicFields?.[experimentType]?.runs;
    if (Array.isArray(value) && value.length > 0) {
      value = convertToReactSelectOptions(value.join(","));
    } else {
      value = null;
    }
    clone.dynamicFields[experimentType]!.runs = value;
    return clone;
  }
  const fieldValue = experiment.dynamicFields?.[experimentType]?.field;
  const distributionValue =
    experiment.dynamicFields?.["monte-carlo"]?.distribution;
  const hasFieldTypeString = typeof fieldValue === "string";
  const hasDistributionTypeString = typeof distributionValue === "string"; // monte-carlo case
  if (hasFieldTypeString) {
    clone.dynamicFields[experimentType]!.field =
      convertToReactSelectOption(fieldValue);
  }
  if (hasDistributionTypeString) {
    clone.dynamicFields["monte-carlo"]!.distribution =
      convertToReactSelectOption(distributionValue);
  }
  return clone;
};

const onSubmitSpecificExperimentHandler = (
  experimentType: ExperimentTypes,
  formData: FormDataType,
  fields: AllFormDataTypeDynamicFieldsType,
): Result<any, FormErrorsType> => {
  let clone = JSON.parse(JSON.stringify(fields));
  switch (experimentType) {
    case ExperimentTypes.monteCarlo:
      // we need only the fields for the specific distribution
      clone.field = clone.field.value;
      clone.distribution = clone.distribution.value;
      clone = pick(clone, [
        "steps",
        "samples",
        "field",
        "distribution",
        ...getFieldsForMonteCarloDistribution(clone.distribution),
      ]);
      return ok(clone);

    case ExperimentTypes.values:
      if (typeof clone.values === "string") {
        const res = parseValuesFromInput(clone.values).mapErr(
          (error: ParseError) => {
            const formErrors = formErrorsTypeFromDataType(formData);
            formErrors.dynamicFields![experimentType]!.values =
              error.msg ?? "Error parsing values";
            return formErrors;
          },
        );
        if (res.isOk()) {
          clone.values = res.unwrapOr([]);
        }
        if (res.isErr()) {
          return res;
        }
      }
      clone.field = clone.field.value;
      return ok(clone);

    case ExperimentTypes.group:
    case ExperimentTypes.multiparameter:
      clone.runs = clone.runs?.map((run: ReactSelectOption) => run.value) ?? [];
      return ok(clone);

    case ExperimentTypes.optimization: {
      clone.metricName = clone.metricName.value;
      clone.metricObjective = clone.metricObjective.value;
      let formErrors: FormErrorsType | null = null;
      const results = clone.fields.map(
        (
          field: FormDataDynamicFieldOptimizationFieldType,
          idx: number,
        ): Result<RawExperimentOptimizationField, void> => {
          const parsedValue: ParseResult<any[]> = parseValuesFromInput(
            field.value,
          );

          return parsedValue
            .map((values) => ({
              name: field.name,
              ...(values.length && isRange(values[0])
                ? { range: field.value }
                : { values: values }),
            }))
            .mapErr((error) => {
              if (formErrors === null) {
                // Prepare `formErrors`
                formErrors = formErrorsTypeFromDataType(formData);
              }
              formErrors.dynamicFields![experimentType]!.fields![idx].value =
                error.msg ?? "Error parsing values";
            });
        },
      );

      const res = combine(results)
        .map((fields) => {
          clone.fields = fields;
        })
        .mapErr(() => formErrors!);
      if (res.isErr()) {
        return res;
      }
      return ok(clone);
    }
    default:
      if (clone.field?.value) {
        clone.field = clone.field.value;
      }
      return ok(clone);
  }
};

export const ExperimentModal: FC<{
  onClose: () => void;
  experiment?: RawExperimentType;
}> = ({ onClose, experiment }) => {
  // EFFECTS
  const [formErrors, setFormErrors] = useState<FormErrorsType>({});
  const [formData, setFormData] = useState<FormDataType>(
    () => prepareExperimentForFormData(experiment) ?? initialFormData,
  );
  const shouldRunExperimentAfterSaving = useRef(false);
  const dispatch = useDispatch();
  const simulationTarget = useSimulatorSelector(selectProviderTarget);
  const [newSimulationTarget, setNewSimulationTarget, newSimulationTargetRef] =
    useRefState<ProviderTargetEnv>(simulationTarget);
  const simulatorDispatch = useSimulatorDispatch();
  const experiments: [string, RawExperimentType][] | null =
    useSelector(selectExperiments);
  const globals = parseGlobals(useSelector(selectGlobals));
  const fieldOptions =
    (globals?.globals
      ? flattenObjectKeysIntoString(globals.globals).map((global: string) =>
          convertToReactSelectOption(global),
        )
      : null) ?? [];
  const metricOptions = useSelector(selectParsedAnalysisMetricNames).map(
    (name): ReactSelectOption => ({ value: name, label: name }),
  );
  const canUseCloud = false;

  // FUNCTIONS
  const validate = () => {
    setFormErrors({});
    if (formData.experimentTitle.trim() === "") {
      setFormErrors({ experimentTitle: "This field is required" });
      return false;
    }
    if (experimentTitles.includes(formData.experimentTitle) && !experiment) {
      setFormErrors({
        experimentTitle: "An experiment with that title already exists",
      });
      return false;
    }
    const experimentType = formData.experimentType.value as ExperimentTypes;
    const fields =
      formData.dynamicFields[experimentType] ??
      // this condition is hit when you switch the Experiment Type + you are editing an Experiment
      initialFormData.dynamicFields[experimentType];

    const formErrors = formErrorsTypeFromDataType(formData);
    const errors = formErrors.dynamicFields![experimentType]!;
    if (experimentType === ExperimentTypes.optimization) {
      const optimizationFields = fields as FormDataDynamicFieldOptimizationType;
      if (optimizationFields.minSteps > optimizationFields.maxSteps) {
        (errors as FormDataDynamicFieldOptimizationErrorsType).minSteps =
          "minSteps cannot be larger than maxSteps";
      }
    }

    setFormErrors(formErrors);
    return !errorsTypeHasError(formErrors);
  };

  const onSubmit = (evt: FormEvent<HTMLFormElement>): void => {
    evt.preventDefault();
    if (!validate()) {
      return;
    }
    const experimentType: ExperimentTypes | string =
      formData.experimentType.value;
    let fields = JSON.parse(
      //@ts-ignore
      JSON.stringify(formData.dynamicFields[experimentType]),
    );

    const res = onSubmitSpecificExperimentHandler(
      experimentType as ExperimentTypes,
      formData,
      fields,
    ).mapErr((err) => {
      setFormErrors(err);
    });
    if (res.isOk()) {
      fields = res.unwrapOr(undefined)!;
    }

    if (res.isErr()) {
      return;
    }

    for (const fieldName in fields) {
      const val = fields[fieldName];
      if (
        fieldName !== "field" &&
        typeof val !== "number" &&
        !isNaN(val) &&
        !isNaN(parseFloat(val))
      ) {
        fields[fieldName] = Array.isArray(val)
          ? val.map((num) => parseFloat(num))
          : parseFloat(val);
      }
    }

    const result: any = {
      title: formData.experimentTitle,
      type: experimentType,
      ...fields,
    };

    // in case the JSON is malformed
    const newExperiments: any = {};
    newExperiments[result.title] = omit(result, "title");
    if (experiments && experiments.length > 0) {
      experiments.forEach((exp: any) => {
        if (exp[0] !== result.title) {
          newExperiments[exp[0]] = exp[1];
        }
      });
    }
    // if we are editing and title changed, do not add the old entry into the new results
    if (experiment && formData.experimentTitle !== experiment.experimentTitle) {
      delete newExperiments[experiment.experimentTitle];
    }
    const contents = stringifyExperiments(newExperiments);
    dispatch(updateFile({ id: experimentsFileId, contents }));
    if (shouldRunExperimentAfterSaving.current) {
      // switch the simulation environment target if the user changed it
      if (newSimulationTargetRef.current !== simulationTarget) {
        simulatorDispatch(toggleProviderTarget(newSimulationTargetRef.current));
      }
      simulatorDispatch(queueExperiment(result.title));
    }
    onClose();
  };

  /**
   * @todo should just use lodash set notation for fieldName parsing
   */
  const onChange = (
    fieldName: string,
    value: number | string | ReactSelectOption | ChangeEvent<HTMLInputElement>,
  ): void => {
    const clone: any = JSON.parse(JSON.stringify(formData));
    const splitted = fieldName.split(".");
    if (splitted.length === 1) {
      clone[fieldName] = value;
      // @ts-ignore
      if (fieldName === "experimentType" && value.value !== clone[fieldName]) {
        // we changed the experiment type, thus we have to rebuild the dynamicFields
        const clonedDynamicFields: typeof initialFormData.dynamicFields =
          JSON.parse(JSON.stringify(initialFormData.dynamicFields));

        clonedDynamicFields.optimization.fields = [optimizationFieldTemplate()];
        clonedDynamicFields.optimization.metricName = metricOptions[0];
        clone.dynamicFields = clonedDynamicFields;
      }
      setFormData(clone);
      if (value !== "") {
        setFormErrors({ ...omit(formErrors, fieldName) });
      }
      return;
    }
    const [experimentType, field, ...pieces] = splitted;
    if (pieces.length === 0) {
      clone.dynamicFields[experimentType][field] = value;
    } else {
      let target = clone.dynamicFields[experimentType][field];
      while (pieces.length > 1) {
        target = target[pieces.shift()!];
      }
      target[pieces[pieces.length - 1]] = value;
    }
    setFormData(clone);
    if (value !== "") {
      // clear errors for this field
      const newErrors: any = JSON.parse(JSON.stringify(formErrors));
      if (newErrors.dynamicFields?.[experimentType]) {
        delete newErrors?.dynamicFields[experimentType][field];
      }
      setFormErrors(newErrors);
    }
  };

  const shouldShowType = (experimentType: ExperimentTypes) =>
    formData.experimentType.value === experimentType;

  const shouldShowMonteCarlo = (distribution: DistributionTypes) => {
    const defaultOpt = {
      label: DistributionTypes.normal,
      value: DistributionTypes.normal,
    };
    const currentDistribution: ReactSelectOption =
      formData.dynamicFields?.["monte-carlo"]?.distribution ?? defaultOpt;
    return currentDistribution.value === String(distribution);
  };

  useLayoutEffect(() => {
    if (experiments) {
      return;
    }
    console.error("experiments.json is malformed, closing modal");
    dispatch(
      addUserAlert({
        type: "error",
        message: `You can't use the Experiments visual editor because your experiments file has a typo.`,
        context: "experiments.json",
        timestamp: Date.now(),
        simulationId: null,
      }),
    );
    onClose();
  }, [experiments, onClose, dispatch]);

  const hasExperiments = experiments && experiments.length > 0;
  const experimentTitles = !hasExperiments
    ? []
    : experiments?.map((item: any) => item[0]) ?? [];
  const experimentTitlesMinusGroupsAndMultiparameterAsOptions = !hasExperiments
    ? []
    : experiments
        ?.filter(
          (item: any) =>
            item[1].type !== "multiparameter" && item[1].type !== "group",
        )
        .map((item: any) => convertToReactSelectOption(item[0])) ?? [];

  const showValues = shouldShowType(ExperimentTypes.values);
  const showLinspace = shouldShowType(ExperimentTypes.linspace);
  const showArange = shouldShowType(ExperimentTypes.arange);
  const showMonteCarlo = shouldShowType(ExperimentTypes.monteCarlo);
  const showGroup = shouldShowType(ExperimentTypes.group);
  const showMultiparameter = shouldShowType(ExperimentTypes.multiparameter);

  const showMonteCarloNormal = shouldShowMonteCarlo(DistributionTypes.normal);
  const showMonteCarloLogNormal = shouldShowMonteCarlo(
    DistributionTypes.logNormal,
  );
  const showMonteCarloPoisson = shouldShowMonteCarlo(DistributionTypes.poisson);
  const showMonteCarloBeta = shouldShowMonteCarlo(DistributionTypes.beta);
  const showMonteCarloGamma = shouldShowMonteCarlo(DistributionTypes.gamma);

  return (
    <Modal
      modalClassName="ExperimentModal"
      onClose={onClose}
      containerClassName="ExperimentModal__Container"
    >
      <div className="ExperimentModal__Topbar">
        <a
          className="ExperimentModal__GetHelp"
          href="https://docs.hash.ai/core/creating-simulations/experiments"
          target="_blank"
          rel="noopener noreferrer"
        >
          GET HELP{" "}
          <span className="ExperimentModal__GetHelpIcon">
            <IconHelpCircleOutline size={13} />
          </span>
        </a>
        {onClose && <ModalExit onClose={onClose} />}
      </div>

      <form autoComplete="off" onSubmit={onSubmit}>
        <div className="ExperimentModal__Content">
          <h1>{!experiment ? "Create a new experiment" : "Edit experiment"}</h1>
          {!experiment && (
            <p className="ExperimentModal__CreationHint">
              Creating a new experiment will add an experiment to your
              experiments.json file which can be run at any time.
            </p>
          )}

          <div className="ExperimentModal__TypeDropdownContainer">
            <ModalFormEntryDropdown
              label="TYPE"
              options={typeOptions}
              value={formData.experimentType}
              isSearchable={false}
              onChange={(selectedOption) =>
                onChange("experimentType", selectedOption)
              }
              data-testid="dropdown-type"
            />
            <ExperimentTypeTooltip
              type={formData.experimentType.value as ExperimentTypes}
            />
          </div>

          <div className="ExperimentModal__TitleContainer">
            <ModalFormEntryRequiredText
              autoFocus
              label="EXPERIMENT TITLE"
              value={formData.experimentTitle}
              className={getErrorClassname(!!formErrors?.experimentTitle)}
              errorMessage={formErrors?.experimentTitle}
              placeholder="Experiment title"
              onChange={(evt) => onChange("experimentTitle", evt.target.value)}
            />
          </div>

          <div className="ExperimentModal__DynamicFieldsContainer">
            {showValues && (
              <>
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.values?.steps,
                  )}
                  value={formData.dynamicFields?.values?.steps}
                  onChange={(evt) => onChange("values.steps", evt.target.value)}
                />
                <ModalFormEntryDropdown
                  label="FIELD"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.values?.field,
                  )}
                  options={fieldOptions}
                  value={formData.dynamicFields?.values?.field}
                  isSearchable
                  creatable
                  onChange={(selectedOption) =>
                    onChange("values.field", selectedOption)
                  }
                  data-testid="dropdown-values-field"
                />

                <ModalFormEntryRequiredText
                  {...fieldInputProps}
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.values?.values,
                  )}
                  errorMessage={formErrors?.dynamicFields?.values?.values}
                  label="VALUES"
                  placeholder="Comma, separated, list"
                  value={formData.dynamicFields?.values?.values}
                  onChange={(evt) =>
                    onChange("values.values", evt.target.value)
                  }
                />
              </>
            )}

            {showLinspace && (
              <>
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.linspace?.steps,
                  )}
                  value={formData.dynamicFields?.linspace?.steps}
                  onChange={(evt) =>
                    onChange("linspace.steps", evt.target.value)
                  }
                />
                <ModalFormEntryDropdown
                  label="FIELD"
                  options={fieldOptions}
                  value={formData.dynamicFields?.linspace?.field}
                  isSearchable
                  creatable
                  onChange={(selectedOption) =>
                    onChange("linspace.field", selectedOption)
                  }
                  data-testid="dropdown-linspace-field"
                />
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  step="any"
                  min={0}
                  label="START"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.linspace?.start,
                  )}
                  value={formData.dynamicFields?.linspace?.start}
                  onChange={(evt) =>
                    onChange("linspace.start", evt.target.value)
                  }
                  data-testid="input-linspace-start"
                />
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  step="any"
                  min={0}
                  label="STOP"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.linspace?.stop,
                  )}
                  value={formData.dynamicFields?.linspace?.stop}
                  onChange={(evt) =>
                    onChange("linspace.stop", evt.target.value)
                  }
                  data-testid="input-linspace-stop"
                />
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  min={0}
                  label="SAMPLES"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.linspace?.samples,
                  )}
                  value={formData.dynamicFields?.linspace?.samples}
                  onChange={(evt) =>
                    onChange("linspace.samples", evt.target.value)
                  }
                  data-testid="input-linspace-samples"
                />
              </>
            )}

            {showArange && (
              <>
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.arange?.steps,
                  )}
                  value={formData.dynamicFields?.arange?.steps}
                  onChange={(evt) => onChange("arange.steps", evt.target.value)}
                />
                <ModalFormEntryDropdown
                  label="FIELD"
                  options={fieldOptions}
                  value={formData.dynamicFields?.arange?.field}
                  isSearchable
                  creatable
                  onChange={(selectedOption) =>
                    onChange("arange.field", selectedOption)
                  }
                  data-testid="dropdown-arange-field"
                />
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  step="any"
                  min={0}
                  label="START"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.arange?.start,
                  )}
                  value={formData.dynamicFields?.arange?.start}
                  onChange={(evt) => onChange("arange.start", evt.target.value)}
                  data-testid="input-arange-start"
                />
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  step="any"
                  min={0}
                  label="STOP"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.arange?.stop,
                  )}
                  value={formData.dynamicFields?.arange?.stop}
                  onChange={(evt) => onChange("arange.stop", evt.target.value)}
                  data-testid="input-arange-stop"
                />
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  step="any"
                  min={0}
                  label="INCREMENT"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.arange?.increment,
                  )}
                  value={formData.dynamicFields?.arange?.increment}
                  onChange={(evt) =>
                    onChange("arange.increment", evt.target.value)
                  }
                  data-testid="input-arange-increment"
                />
              </>
            )}

            {showMonteCarlo && (
              <>
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  label="STEPS"
                  type="number"
                  min="1"
                  step="1"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.["monte-carlo"]?.steps,
                  )}
                  value={formData.dynamicFields?.["monte-carlo"]?.steps}
                  errorMessage=""
                  onChange={(evt) =>
                    onChange("monte-carlo.steps", evt.target.value)
                  }
                />
                <ModalFormEntryDropdown
                  label="FIELD"
                  options={fieldOptions}
                  value={formData.dynamicFields?.["monte-carlo"]?.field}
                  isSearchable
                  creatable
                  onChange={(selectedOption) =>
                    onChange("monte-carlo.field", selectedOption)
                  }
                  data-testid="dropdown-monte-carlo-field"
                  className={getErrorClassname(
                    !!formErrors.dynamicFields?.["monte-carlo"]?.field,
                  )}
                />
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  min={0}
                  label="SAMPLES"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.["monte-carlo"]?.samples,
                  )}
                  value={formData.dynamicFields?.["monte-carlo"]?.samples}
                  onChange={(evt) =>
                    onChange("monte-carlo.samples", evt.target.value)
                  }
                  data-testid="input-montecarlo-samples"
                />
                <ModalFormEntryDropdown
                  label="DISTRIBUTION"
                  options={monteCarloDistributionOptions}
                  value={formData.dynamicFields?.["monte-carlo"]?.distribution}
                  isSearchable={false}
                  onChange={(selectedOption) =>
                    onChange("monte-carlo.distribution", selectedOption)
                  }
                  data-testid="dropdown-monte-carlo-distribution"
                />
                {showMonteCarloNormal && (
                  <>
                    <ModalFormEntryRequiredText
                      {...stepsInputProps}
                      step="any"
                      min={0}
                      label="STD"
                      className={getErrorClassname(
                        !!formErrors?.dynamicFields?.["monte-carlo"]?.std,
                      )}
                      value={formData.dynamicFields?.["monte-carlo"]?.std}
                      onChange={(evt) =>
                        onChange("monte-carlo.std", evt.target.value)
                      }
                      data-testid="input-montecarlo-normal-std"
                    />
                    <ModalFormEntryRequiredText
                      {...stepsInputProps}
                      step="any"
                      min={0}
                      label="MEAN"
                      className={getErrorClassname(
                        !!formErrors?.dynamicFields?.["monte-carlo"]?.mean,
                      )}
                      value={formData.dynamicFields?.["monte-carlo"]?.mean}
                      onChange={(evt) =>
                        onChange("monte-carlo.mean", evt.target.value)
                      }
                      data-testid="input-montecarlo-normal-mean"
                    />
                  </>
                )}
                {showMonteCarloLogNormal && (
                  <>
                    <ModalFormEntryRequiredText
                      {...stepsInputProps}
                      step="any"
                      min={0}
                      label="MU"
                      className={getErrorClassname(
                        !!formErrors?.dynamicFields?.["monte-carlo"]?.mu,
                      )}
                      value={formData.dynamicFields?.["monte-carlo"]?.mu}
                      onChange={(evt) =>
                        onChange("monte-carlo.mu", evt.target.value)
                      }
                      data-testid="input-montecarlo-lognormal-mu"
                    />
                    <ModalFormEntryRequiredText
                      {...stepsInputProps}
                      step="any"
                      min={0}
                      label="SIGMA"
                      className={getErrorClassname(
                        !!formErrors?.dynamicFields?.["monte-carlo"]?.sigma,
                      )}
                      value={formData.dynamicFields?.["monte-carlo"]?.sigma}
                      onChange={(evt) =>
                        onChange("monte-carlo.sigma", evt.target.value)
                      }
                      data-testid="input-montecarlo-lognormal-sigma"
                    />
                  </>
                )}
                {showMonteCarloPoisson && (
                  <ModalFormEntryRequiredText
                    {...stepsInputProps}
                    step="any"
                    min={0}
                    label="RATE"
                    className={getErrorClassname(
                      !!formErrors?.dynamicFields?.["monte-carlo"]?.rate,
                    )}
                    value={formData.dynamicFields?.["monte-carlo"]?.rate}
                    onChange={(evt) =>
                      onChange("monte-carlo.rate", evt.target.value)
                    }
                    data-testid="input-montecarlo-poisson-rate"
                  />
                )}
                {showMonteCarloBeta && (
                  <>
                    <ModalFormEntryRequiredText
                      {...stepsInputProps}
                      step="any"
                      min={0}
                      label="ALPHA"
                      className={getErrorClassname(
                        !!formErrors?.dynamicFields?.["monte-carlo"]?.alpha,
                      )}
                      value={formData.dynamicFields?.["monte-carlo"]?.alpha}
                      onChange={(evt) =>
                        onChange("monte-carlo.alpha", evt.target.value)
                      }
                      data-testid="input-montecarlo-beta-alpha"
                    />
                    <ModalFormEntryRequiredText
                      {...stepsInputProps}
                      step="any"
                      min={0}
                      label="BETA"
                      className={getErrorClassname(
                        !!formErrors?.dynamicFields?.["monte-carlo"]?.beta,
                      )}
                      value={formData.dynamicFields?.["monte-carlo"]?.beta}
                      onChange={(evt) =>
                        onChange("monte-carlo.beta", evt.target.value)
                      }
                      data-testid="input-montecarlo-beta-beta"
                    />
                  </>
                )}
                {showMonteCarloGamma && (
                  <>
                    <ModalFormEntryRequiredText
                      {...stepsInputProps}
                      step="any"
                      min={0}
                      label="SHAPE"
                      className={getErrorClassname(
                        !!formErrors?.dynamicFields?.["monte-carlo"]?.shape,
                      )}
                      value={formData.dynamicFields?.["monte-carlo"]?.shape}
                      onChange={(evt) =>
                        onChange("monte-carlo.shape", evt.target.value)
                      }
                      data-testid="input-montecarlo-gamma-shape"
                    />
                    <ModalFormEntryRequiredText
                      {...stepsInputProps}
                      step="any"
                      min={0}
                      label="SCALE"
                      className={getErrorClassname(
                        !!formErrors?.dynamicFields?.["monte-carlo"]?.scale,
                      )}
                      value={formData.dynamicFields?.["monte-carlo"]?.scale}
                      onChange={(evt) =>
                        onChange("monte-carlo.scale", evt.target.value)
                      }
                      data-testid="input-montecarlo-gamma-scale"
                    />
                  </>
                )}
              </>
            )}

            {showGroup && (
              <>
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.group?.steps,
                  )}
                  value={formData.dynamicFields?.group?.steps}
                  onChange={(evt) => onChange("group.steps", evt.target.value)}
                />
                <ModalFormEntryDropdown
                  isSearchable
                  isMulti
                  label="RUNS"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.group?.runs,
                  )}
                  options={
                    experimentTitlesMinusGroupsAndMultiparameterAsOptions
                  }
                  value={formData.dynamicFields?.group?.runs ?? []}
                  onChange={(selectedOptions) => {
                    onChange(
                      "group.runs",
                      selectedOptions === null ? [] : selectedOptions,
                    );
                  }}
                  data-testid="dropdown-group-runs"
                />
              </>
            )}

            {showMultiparameter && (
              <>
                <ModalFormEntryRequiredText
                  {...stepsInputProps}
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.multiparameter?.steps,
                  )}
                  value={formData.dynamicFields?.multiparameter?.steps}
                  onChange={(evt) =>
                    onChange("multiparameter.steps", evt.target.value)
                  }
                />
                <ModalFormEntryDropdown
                  isSearchable
                  isMulti
                  label="RUNS"
                  className={getErrorClassname(
                    !!formErrors?.dynamicFields?.multiparameter?.runs,
                  )}
                  options={
                    experimentTitlesMinusGroupsAndMultiparameterAsOptions
                  }
                  value={formData.dynamicFields?.multiparameter?.runs ?? []}
                  onChange={(selectedOptions) => {
                    onChange(
                      "multiparameter.runs",
                      selectedOptions === null ? [] : selectedOptions,
                    );
                  }}
                  data-testid="dropdown-multiparameter-runs"
                />
              </>
            )}
            {shouldShowType(ExperimentTypes.optimization) ? (
              metricOptions.length === 0 ? (
                <p>
                  You must define some analysis metrics in order to use this
                  experiment type.
                </p>
              ) : (
                <>
                  <ModalFormEntryRequiredText
                    type="number"
                    min={1}
                    step={1}
                    label="Max Runs"
                    className={getErrorClassname(
                      !!formErrors?.dynamicFields?.optimization?.maxRuns,
                    )}
                    value={formData.dynamicFields?.optimization?.maxRuns}
                    onChange={(evt) =>
                      onChange(
                        "optimization.maxRuns",
                        parseInt(evt.target.value, 10),
                      )
                    }
                    // @todo this casting shouldn't be necessary
                    errorMessage={
                      formErrors.dynamicFields?.optimization?.maxRuns
                    }
                  />
                  <ModalFormEntryRequiredText
                    type="number"
                    min={1}
                    step={1}
                    label="Min Steps"
                    className={getErrorClassname(
                      !!formErrors?.dynamicFields?.optimization?.minSteps,
                    )}
                    value={formData.dynamicFields?.optimization?.minSteps}
                    onChange={(evt) =>
                      onChange(
                        "optimization.minSteps",
                        parseInt(evt.target.value, 10),
                      )
                    }
                    // @todo this casting shouldn't be necessary
                    errorMessage={
                      formErrors.dynamicFields?.optimization?.minSteps
                    }
                  />
                  <ModalFormEntryRequiredText
                    type="number"
                    min={1}
                    step={1}
                    label="Max Steps"
                    className={getErrorClassname(
                      !!formErrors?.dynamicFields?.optimization?.maxSteps,
                    )}
                    value={formData.dynamicFields?.optimization?.maxSteps}
                    onChange={(evt) =>
                      onChange(
                        "optimization.maxSteps",
                        parseInt(evt.target.value, 10),
                      )
                    }
                  />
                  <ModalFormEntryDropdown
                    label="Metric"
                    options={metricOptions}
                    className={getErrorClassname(
                      !!formErrors?.dynamicFields?.optimization?.metricName,
                    )}
                    value={
                      formData.dynamicFields?.[ExperimentTypes.optimization]
                        ?.metricName?.value
                        ? formData.dynamicFields?.[ExperimentTypes.optimization]
                            ?.metricName
                        : metricOptions[0]
                    }
                    onChange={(selectedOption) => {
                      onChange("optimization.metricName", selectedOption);
                    }}
                  />
                  <ModalFormEntryDropdown
                    isSearchable={false}
                    label="Metric Objective"
                    className={getErrorClassname(
                      !!formErrors?.dynamicFields?.optimization
                        ?.metricObjective,
                    )}
                    options={optimizationMetricObjectiveOptions}
                    value={
                      formData.dynamicFields?.[ExperimentTypes.optimization]
                        ?.metricObjective ??
                      initialFormDynamicFieldsData.optimization.metricObjective
                    }
                    onChange={(selectedOption) =>
                      onChange("optimization.metricObjective", selectedOption)
                    }
                  />
                </>
              )
            ) : null}
          </div>
          {shouldShowType(ExperimentTypes.optimization) ? (
            <>
              <div className="ExperimentsModal__FieldsTableContainer">
                <div className="ExperimentsModal__FieldsTable">
                  <div className="ExperimentsModal__FieldsRow">
                    <div className="ExperimentsModal__FieldsCell">
                      <ModalFormEntryLabel>Field</ModalFormEntryLabel>
                    </div>
                    <div className="ExperimentsModal__FieldsCell">
                      <ModalFormEntryLabel>
                        Value{" "}
                        <small>
                          (Comma, separated, list, or range delimited by "-")
                        </small>
                      </ModalFormEntryLabel>
                    </div>
                  </div>
                  {(
                    formData.dynamicFields[ExperimentTypes.optimization]
                      ?.fields ?? []
                  ).map((field, idx, rows) => (
                    <div
                      className="ExperimentsModal__FieldsRow"
                      key={field.uuid}
                    >
                      <div className="ExperimentsModal__FieldsCell">
                        <RoundedSelect
                          name={`fields.${idx}.name`}
                          options={[
                            {
                              disabled: true,
                              value: "",
                              displayValue: "Choose a field",
                            },
                            ...fieldOptions,
                          ]}
                          value={field.name ?? ""}
                          onChange={(evt) =>
                            onChange(
                              `optimization.fields.${idx}.name`,
                              evt.target.value,
                            )
                          }
                          required
                        />
                      </div>
                      <div className="ExperimentsModal__FieldsCell">
                        <ModalFormEntryRequiredText
                          required
                          className={getErrorClassname(
                            !!formErrors?.dynamicFields?.optimization?.fields?.[
                              idx
                            ]?.value,
                          )}
                          value={field.value}
                          onChange={(evt) => {
                            onChange(
                              `optimization.fields.${idx}.value`,
                              evt.target.value,
                            );
                          }}
                          placeholder="Value"
                          errorMessage={
                            formErrors.dynamicFields?.optimization?.fields?.[
                              idx
                            ]?.value
                          }
                        />
                      </div>
                      {rows.length > 1 && (
                        <div className="ExperimentsModal__FieldsCell ExperimentsModal__FieldsCellDelete">
                          <FancyButton
                            onClick={(evt) => {
                              evt.preventDefault();
                              const clone: typeof formData = JSON.parse(
                                JSON.stringify(formData),
                              );
                              clone.dynamicFields[
                                ExperimentTypes.optimization
                              ]?.fields.splice(idx, 1);
                              setFormData(clone);
                            }}
                            theme="transparent"
                          >
                            <IconTrash size={20} />
                          </FancyButton>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <FancyButton
                className="ExperimentModal__AddField"
                theme="blue"
                icon="plus"
                onClick={(evt) => {
                  evt.preventDefault();
                  const clone: typeof formData = JSON.parse(
                    JSON.stringify(formData),
                  );
                  const fields =
                    clone.dynamicFields[ExperimentTypes.optimization]?.fields ??
                    [];

                  fields.push(optimizationFieldTemplate());
                  setFormData(clone);
                  Promise.resolve().then(() => {
                    document
                      .querySelector<HTMLInputElement>(
                        `[name="fields.${fields.length - 1}.name"]`,
                      )
                      ?.focus();
                  });
                }}
              >
                <strong>Add Field</strong>
              </FancyButton>
            </>
          ) : null}
        </div>
        <div className="ExperimentModal__ActionButtonsContainer">
          <FancyButton onClick={onClose} theme="transparent">
            Discard
          </FancyButton>
          <FancyButton
            onClick={() => {
              shouldRunExperimentAfterSaving.current = false;
            }}
            theme="black"
            type="submit"
          >
            Save without running
          </FancyButton>

          {shouldShowType(ExperimentTypes.optimization) ? (
            canUseCloud ? (
              <FancyButton
                onClick={() => {
                  shouldRunExperimentAfterSaving.current = true;
                  setNewSimulationTarget("cloud");
                }}
                theme="blue"
                type="submit"
              >
                Save and run in hCloud
              </FancyButton>
            ) : null
          ) : canUseCloud ? (
            <FancyButtonWithDropdown
              onClick={() => {
                shouldRunExperimentAfterSaving.current = true;
              }}
              type="submit"
              theme="blue"
              dropdownOptions={
                simulationTarget === "cloud"
                  ? [
                      { label: "cloud", value: "cloud" },
                      { label: "local", value: "local" },
                    ]
                  : [
                      { label: "local", value: "local" },
                      { label: "cloud", value: "cloud" },
                    ]
              }
              onOptionSelect={(option: ReactSelectOption) => {
                const value = option.value as ProviderTargetEnv;
                setNewSimulationTarget(value);
              }}
            >
              Save and run{" "}
              {newSimulationTarget === "cloud" ? "in hCloud" : "locally"}
            </FancyButtonWithDropdown>
          ) : (
            <FancyButton
              onClick={() => {
                shouldRunExperimentAfterSaving.current = true;
                setNewSimulationTarget("web");
              }}
              theme="blue"
              type="submit"
            >
              Save and run locally
            </FancyButton>
          )}
        </div>
      </form>
    </Modal>
  );
};
