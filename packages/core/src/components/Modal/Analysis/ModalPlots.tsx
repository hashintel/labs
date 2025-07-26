import React, { FC, useState } from "react";
import { useForm } from "react-hook-form";

import { AnalysisModal } from "./AnalysisModal";
import { ChartTypes, XAxisItemType, YAxisItemType } from "../../Analysis/types";
import { CheckboxInput } from "../../Inputs/Checkbox/CheckboxInput";
import { IconAlertOutline, IconPlus } from "../../Icon";
import {
  MAGIC_STEPS_KEY,
  transformPlotDataBasedOnChartType,
} from "../../Analysis/modals";
import {
  ModalFormEntryDropdown,
  ModalFormEntryRequiredText,
} from "../FormEntry";
import { ModalFormEntryLabel } from "../FormEntry/ModalFormEntryLabel";
import { ReactSelectOption } from "../../Dropdown/types";
import { YAxisItem } from "./YAxisItem";
import { useFatalError } from "../../ErrorBoundary/ErrorBoundary";
import { validatePlot } from "../../../features/analysis/analysisJsonValidation";

import "./ModalPlots.scss";

interface ModalPlotsProps {
  onClose: VoidFunction;
  onSave: Function;
  outputs: Record<string, any[]>;
  onDelete?: Function;
  plotKey?: number;
  plotTitle?: string;
  plotChartType?: string;
  layout?: {
    height?: number;
    width?: number;
    hideLegend?: boolean;
    hideCollatedLegend?: boolean;
  };
  YAxisItems?: YAxisItemType[];
  XAxisItems?: XAxisItemType[];
  isCreate?: boolean;
  combinedHeightOfAllPlots?: number;
}

interface FormInputs {
  title: string;
  chartType: ChartTypes;
  YAxisItems: YAxisItemType[];
  XAxisItems: XAxisItemType[];
}

const chartTypeOptions: ReactSelectOption[] = [
  ChartTypes.area,
  ChartTypes.bar,
  ChartTypes.box,
  ChartTypes.histogram,
  ChartTypes.timeseries,
  ChartTypes.line,
  ChartTypes.scatter,
].map((item) => ({
  value: item,
  label: item,
}));

const DEFAULT_PLOT_HEIGHT = 50;

const plotSupportsXAxis = (type: ChartTypes) =>
  ["histogram", "scatter", "line"].includes(type);
const plotSupportsYAxis = (type: ChartTypes) =>
  ["area", "box", "bar", "histogram", "timeseries", "scatter", "line"].includes(
    type,
  );

const shouldShowXAxis = (
  chartType: ChartTypes,
  _xAxisItems: XAxisItemType[] = [],
  yAxisItems: XAxisItemType[] = [],
) => {
  const plotSupportsIt = plotSupportsXAxis(chartType);
  if (!plotSupportsIt) {
    return false;
  }
  if (chartType === ChartTypes.histogram) {
    // if we already have X, then we show that
    return yAxisItems.length === 0;
  }
  return true;
};

const shouldShowYAxis = (
  chartType: ChartTypes,
  xAxisItems: XAxisItemType[] = [],
  _yAxisItems: YAxisItemType[] = [],
) => {
  const plotSupportsIt = plotSupportsYAxis(chartType);
  if (!plotSupportsIt) {
    return false;
  }
  if (chartType === ChartTypes.histogram) {
    return xAxisItems.length === 0;
  }
  return true;
};

export const ModalPlots: FC<ModalPlotsProps> = ({
  onClose,
  onSave,
  outputs,
  onDelete = () => {},
  plotKey = false,
  plotTitle = "",
  plotChartType = false,
  layout = {
    width: "100%",
    height: `${DEFAULT_PLOT_HEIGHT}%`,
    hideLegend: false,
    hideCollatedLegend: false,
  },
  isCreate = false,
  YAxisItems = [],
  XAxisItems = [],
  combinedHeightOfAllPlots = 0,
}) => {
  const fatalError = useFatalError();

  const [currentYAxisItems, setCurrentYAxisItems] =
    useState<YAxisItemType[]>(YAxisItems);
  const [currentXAxisItems, setCurrentXAxisItems] =
    useState<XAxisItemType[]>(XAxisItems);
  const [chartType, setChartType] = useState<ReactSelectOption>(
    isCreate ?? !plotChartType
      ? chartTypeOptions[0]
      : { label: String(plotChartType), value: String(plotChartType) },
  );
  const [hideLegend, setHideLegend] = useState(!!layout.hideLegend);
  const [hideCollatedLegend, setHideCollatedLegend] = useState(
    !!layout.hideCollatedLegend,
  );
  const [validationErrors, setValidationErrors] = useState<Error[]>([]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInputs>({
    defaultValues: {
      title: plotTitle,
    },
    shouldFocusError: true,
    mode: "onTouched",
  });

  const metricKeys = Object.keys(outputs);

  const prepareDataForValidation = (input: any) =>
    transformPlotDataBasedOnChartType({
      title: input.title,
      type: input.chartType.value,
      data: { yitems: input.yitems, xitems: input.xitems },
      layout: input.layout,
      position: input.position,
    });

  const getFormState = (values: FormInputs) => ({
    ...values, // title
    chartType,
    yitems: currentYAxisItems,
    xitems: currentXAxisItems,
    layout: {
      height: layout.height,
      width: layout.width,
      hideLegend: hideLegend,
      hideCollatedLegend: hideCollatedLegend,
    },
    position: {
      x: "0%",
      y: `${combinedHeightOfAllPlots}%`,
    },
  });

  const validate = (result: any) => {
    const validationResults = validatePlot(
      prepareDataForValidation(result),
      outputs,
    );

    if (
      validationResults instanceof Error ||
      Array.isArray(validationResults)
    ) {
      setValidationErrors(
        !Array.isArray(validationResults)
          ? [validationResults]
          : validationResults,
      );
      return false;
    }
    return true;
  };

  const onSubmit = (values: FormInputs) => {
    const result = getFormState(values);
    if (!validate(result)) {
      return;
    }

    try {
      onSave(result, plotKey);
      onClose();
    } catch (err) {
      fatalError(err);
    }
  };

  const addNewAxisItem = (axisToAddTo: "x" | "y") => {
    const newInput = {
      name: `${metricKeys[metricKeys.length - 1]}${currentXAxisItems.length}`,
      metric: metricKeys[metricKeys.length - 1],
    };
    if (axisToAddTo === "x") {
      setCurrentXAxisItems([...currentXAxisItems, newInput]);
    } else {
      setCurrentYAxisItems([...currentYAxisItems, newInput]);
    }
  };

  const deleteAxisItem = (axisToModify: "x" | "y", index: number) => {
    if (axisToModify === "x") {
      setCurrentXAxisItems(
        currentXAxisItems.filter((_val, idx) => idx !== index),
      );
    } else {
      setCurrentYAxisItems(
        currentYAxisItems.filter((_val, idx) => idx !== index),
      );
    }
  };

  const updateAxisItem = (
    axisToUpdate: "x" | "y",
    index: number,
    newValues: YAxisItemType,
  ) => {
    const items = axisToUpdate === "x" ? currentXAxisItems : currentYAxisItems;
    const newOps = [...items];
    newOps[index] = newValues;
    if (axisToUpdate === "x") {
      setCurrentXAxisItems(newOps);
    } else {
      setCurrentYAxisItems(newOps);
    }
  };

  const addNewXAxisItem = () => addNewAxisItem("x");
  const addNewYAxisItem = () => addNewAxisItem("y");
  const deleteXAxisItem = (index: number) => deleteAxisItem("x", index);
  const deleteYAxisItem = (index: number) => deleteAxisItem("y", index);
  const updateXAxisItem = (index: number, newValues: XAxisItemType) =>
    updateAxisItem("x", index, newValues);
  const updateYAxisItem = (index: number, newValues: YAxisItemType) =>
    updateAxisItem("y", index, newValues);

  const AddNewYAxisItem = () => (
    <>
      <div
        className="AnalysisModal__RepeatableFooterItem"
        onClick={addNewYAxisItem}
      >
        <span>Add Y Axis Item</span>
        <IconPlus size={14} />
      </div>
      <div className="AnalysisModal__RepeatableFooterItem" />
      <div className="AnalysisModal__RepeatableFooterItem" />
    </>
  );

  const AddNewXAxisItem = () => (
    <>
      <div
        className="AnalysisModal__RepeatableFooterItem"
        onClick={addNewXAxisItem}
      >
        <span>Add X axis item</span>
        <IconPlus size={14} />
      </div>
      <div className="AnalysisModal__RepeatableFooterItem" />
      <div className="AnalysisModal__RepeatableFooterItem" />
    </>
  );

  const metricKeysOptions: ReactSelectOption[] = metricKeys.map((key) => ({
    value: key,
    label: key,
  }));
  const metricKeysOptionsWithMagicSteps: ReactSelectOption[] = [
    ...metricKeysOptions,
    {
      value: MAGIC_STEPS_KEY,
      label: "Steps",
    },
  ];

  const title = isCreate ? "Create new analysis plot" : "Edit plot";
  const submitButtonText = isCreate ? "Create new plot" : "Save changes";
  const footerLegend = isCreate ? (
    <>
      <strong>Finished creating your plot?</strong> You can always edit it
      later.
    </>
  ) : (
    <>
      <strong>Don't want this plot anymore?</strong>

      <span
        className="AnalysisModal__Footer__Button delete"
        onClick={(evt) => {
          evt.preventDefault();
          onDelete(plotKey);
          onClose();
        }}
      >
        Delete it
      </span>
    </>
  );

  const magicStepsXAxisItem = { metric: MAGIC_STEPS_KEY, name: "Steps" };

  // TODO: clean this up
  if (
    ["line", "scatter"].includes(chartType.value) &&
    !isCreate &&
    currentXAxisItems.length === 0
  ) {
    setCurrentXAxisItems([magicStepsXAxisItem]);
  }

  return (
    <AnalysisModal
      onClose={onClose}
      title={title}
      onSubmit={handleSubmit(onSubmit)}
      submitButtonText={submitButtonText}
      footerLegend={footerLegend}
    >
      <div className="ModalPlots__Container">
        {validationErrors.length === 1 && (
          <h3>There was an error while trying to save your Plot</h3>
        )}
        {validationErrors.length > 1 && (
          <h3>There were some errors while trying to save your Plot</h3>
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
        <ModalFormEntryDropdown
          label="PLOT TYPE"
          options={chartTypeOptions}
          value={chartType}
          isSearchable={true}
          onChange={(newValue) => {
            setChartType(newValue);
            if (["line", "scatter"].includes(newValue.value) && isCreate) {
              setCurrentXAxisItems([magicStepsXAxisItem]);
            } else {
              setCurrentXAxisItems([]);
            }
          }}
        />

        <ModalFormEntryRequiredText
          className="ModalPlots__PlotName"
          label="PLOT TITLE"
          errorMessage={errors.title?.message}
          placeholder="My Plot"
          name="title"
          ref={register()}
        />

        <ModalFormEntryLabel>Legend display</ModalFormEntryLabel>
        <div className="ModalPlots__LegendDisplayContainer">
          <label
            htmlFor="hideLegendCheckbox"
            className="ModalPlots__LegendDisplayLabel"
          >
            <CheckboxInput
              checked={hideLegend}
              id="hideLegendCheckbox"
              onChange={(evt) => setHideLegend(evt.target.checked)}
            />
            Hide legends
          </label>
          <label
            htmlFor="hideCollatedLegendCheckbox"
            className="ModalPlots__LegendDisplayLabel"
          >
            <CheckboxInput
              checked={hideCollatedLegend}
              id="hideCollatedLegendCheckbox"
              onChange={(evt) => setHideCollatedLegend(evt.target.checked)}
            />
            Hide legends in collated view only
          </label>
        </div>

        {shouldShowXAxis(
          chartType.value as ChartTypes,
          currentXAxisItems,
          currentYAxisItems,
        ) && (
          <>
            <div className="ModalFormEntry__Label">
              <strong>X AXIS</strong>
            </div>
            {["line", "scatter"].includes(chartType.value) ? (
              <div className="ModalFormEntry__Description">
                By default, the X axis will plot Steps. Change this by choosing
                another metric.
              </div>
            ) : null}

            <div className="ModalPlots__YAxisItems AnalysisModal__RepeatableContainer">
              <span className="ModalPlots__YAxisItems__Header AnalysisModal__RepeatableHeaderItem">
                LABEL
              </span>
              <span className="ModalPlots__YAxisItems__Header AnalysisModal__RepeatableHeaderItem">
                METRIC
              </span>
              <span className="ModalPlots__YAxisItems__Header AnalysisModal__RepeatableHeaderItem" />

              {currentXAxisItems.length > 0 &&
                currentXAxisItems.map((item, index) => (
                  <YAxisItem
                    item={item}
                    index={index}
                    key={index}
                    metricKeysOptions={
                      ["line", "scatter"].includes(chartType.value)
                        ? metricKeysOptionsWithMagicSteps
                        : metricKeysOptions
                    }
                    onDelete={() => deleteXAxisItem(index)}
                    onChange={updateXAxisItem}
                    hideDelete={
                      index === 0 &&
                      currentXAxisItems.length === 1 &&
                      chartType.value !== "histogram" &&
                      chartType.value !== "scatter" &&
                      chartType.value !== "line"
                    }
                  />
                ))}

              <AddNewXAxisItem />
            </div>
          </>
        )}

        {shouldShowYAxis(
          chartType.value as ChartTypes,
          currentXAxisItems,
          currentYAxisItems,
        ) && (
          <>
            <div className="ModalFormEntry__Label">
              <strong>Y AXIS</strong>
            </div>

            <div className="ModalPlots__YAxisItems AnalysisModal__RepeatableContainer">
              <span className="ModalPlots__YAxisItems__Header AnalysisModal__RepeatableHeaderItem">
                LABEL
              </span>
              <span className="ModalPlots__YAxisItems__Header AnalysisModal__RepeatableHeaderItem">
                METRIC
              </span>
              <span className="ModalPlots__YAxisItems__Header AnalysisModal__RepeatableHeaderItem" />

              {currentYAxisItems.length > 0 &&
                currentYAxisItems.map((item, index) => (
                  <YAxisItem
                    item={item}
                    index={index}
                    key={index}
                    metricKeysOptions={metricKeysOptions}
                    onDelete={() => deleteYAxisItem(index)}
                    onChange={updateYAxisItem}
                    hideDelete={
                      index === 0 &&
                      currentXAxisItems.length === 1 &&
                      chartType.value !== "histogram" &&
                      chartType.value !== "scatter" &&
                      chartType.value !== "line"
                    }
                  />
                ))}

              <AddNewYAxisItem />
            </div>
          </>
        )}
      </div>
    </AnalysisModal>
  );
};
