import React, { FC, useState } from "react";
import classNames from "classnames";
import { SerializableAgentState } from "@hashintel/engine-web";
import { useRecoilState, useRecoilValue } from "recoil";

import * as sceneState from "../../AgentScene/state/SceneState";
import { ActivityEmpty } from "../ActivityEmpty";
import { IconClose } from "../../Icon";

import "./Inspector.css";
import { WrappedSplitterLayout } from "../../WrappedSplitterLayout/WrappedSplitterLayout";

export const AgentInspector: FC = () => {
  const [selectedAgentIds, setSelectedAgents] = useRecoilState(
    sceneState.SelectedAgentIds
  );
  const agentIds = Object.keys(selectedAgentIds).reverse();

  if (agentIds.length === 0) {
    return (
      <div className="AgentInspector">
        <h2>Inspector</h2>
        <ActivityEmpty>No agent or analysis has been selected.</ActivityEmpty>
      </div>
    );
  }

  const agentData = agentIds.map((id) => <AgentInfo id={id} key={id} />);

  return (
    <div className="AgentInspector">
      <div className="AgentInspector__Header">
        <h2>Inspector</h2>
        <button
          onClick={(evt) => {
            evt.preventDefault();
            setSelectedAgents({});
          }}
          className="AgentInspector__ClearSelection"
        >
          Clear
        </button>
      </div>
      <div className="AgentInspector__List">{agentData}</div>
    </div>
  );
};

const AgentInfo: FC<{ id: string }> = ({ id }) => {
  // Toggled means "open" so the contents are visible
  // Agents are closed by default
  const [toggled, setToggled] = useState(true);
  const agent = useRecoilValue(sceneState.SelectedAgentData(id));
  const hoveredAgent = useRecoilValue(sceneState.HoveredAgent);
  const isAgentHovered = id === hoveredAgent;

  // Provide a way to deselect the agent
  const [selectedAgents, setSelectedAgents] = useRecoilState(
    sceneState.SelectedAgentIds
  );
  const unselectAgent = () => {
    const tempIds = { ...selectedAgents };
    delete tempIds[id];
    setSelectedAgents(tempIds);
  };

  // Save ourself if the agent is not in this step
  // Generate items for the other fields on the agent
  const original: SerializableAgentState = agent?.original ?? { agent_id: id };
  const { agent_name, agent_id, ...rest } = original;

  const otherFields = Object.entries(rest)
    // Push the primitive values to the top (looks better sylistically)
    .sort(([, field]) => {
      if (typeof field === "object") {
        return 1;
      } else {
        return -1;
      }
    })
    .map(([key, field]) => (
      <AgentProperty value={field} name={key} key={key} />
    ));

  if (otherFields.length === 0) {
    otherFields.push(
      <AgentProperty value="Unavailable at this step" name={null} key="none" />
    );
  }

  const identifier = agent_name ?? agent_id.slice(0, 5);

  return (
    <div
      key={id}
      className={classNames({
        AgentInfo: true,
        "AgentInfo--hovered": isAgentHovered,
      })}
    >
      {/* Draw the value name and controls */}
      <div
        className="AgentInfo__Header"
        onClick={(evt) => {
          evt.preventDefault();
          setToggled(!toggled);
        }}
      >
        <div
          className={classNames(
            "codicon",
            `codicon-${toggled ? "chevron-down" : "chevron-right"}`
          )}
        />
        {identifier}
        <button
          className="AgentInfo__Delete"
          onClick={(event) => {
            event.stopPropagation();
            unselectAgent();
          }}
        >
          <IconClose size={8} />
        </button>
      </div>

      {/* Draw the children */}
      <div hidden={!toggled} className="AgentInfo__Children">
        {otherFields}
      </div>
    </div>
  );
};

const xyzFields = ["position", "velocity", "scale", "direction"];

const AgentProperty: FC<{
  name: string | null;
  value: any;
}> = ({ value, name }) => {
  // if the value is just a simple number/string/boolean
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    const prettyField = prettifyField(value);
    return (
      <div style={{ display: "flex" }}>
        {name ? (
          <span
            style={{
              marginRight: "8px",
              textOverflow: "ellipsis",
              overflow: "hidden",
            }}
          >
            {name}
          </span>
        ) : null}
        <span
          style={{
            opacity: 0.4,
            textOverflow: "ellipsis",
            overflow: "hidden",
          }}
        >
          {prettyField}
        </span>
      </div>
    );
  }

  // If the value is array of values
  if (Array.isArray(value)) {
    const objectArray = value.map((val, idx) => {
      let subname = null as null | string;
      if (name && xyzFields.includes(name)) {
        subname = ["x", "y", "z"][idx];
      }
      subname = subname ?? idx.toString();
      return <AgentProperty name={subname} value={val} key={subname} />;
    });

    // If it's empty, still display something
    if (objectArray.length === 0) {
      objectArray.push(<AgentProperty name={""} value={"none"} key={name} />);
    }

    return <InfoHeader name={name ?? "0"}>{objectArray}</InfoHeader>;
  }

  // if the value is an object
  // objects get rendered as a list of keys + values
  //
  // No circular references!
  if (typeof value === "object" && value !== null) {
    const agentProps = Object.entries(value).map(
      ([key, value]: [string, any]) => {
        return <AgentProperty name={key} value={value} key={key} />;
      }
    );
    return <InfoHeader name={name ?? "0"}>{agentProps}</InfoHeader>;
  }

  return null;
};

const InfoHeader: FC<{ name: string }> = ({ name, children }) => {
  const [toggled, setToggled] = useState(false);
  const toggle = () => setToggled(!toggled);

  return (
    <div>
      <div
        onClick={(evt) => {
          evt.preventDefault();
          toggle();
        }}
        className="AgentInfo__Name"
      >
        <div
          className={classNames(
            "codicon",
            `codicon-${toggled ? "chevron-down" : "chevron-right"}`
          )}
        />
        <span>{name}</span>
      </div>
      <div hidden={!toggled} className="AgentInfo__Children">
        {children ?? null}
      </div>
    </div>
  );
};

const prettifyField = (val: any) =>
  (val ?? "null").toLocaleString(undefined, {
    maximumSignificantDigits: 21,
  });

export const AgentInspectorSplitterLayout = () => (
  <div>
    <WrappedSplitterLayout
      vertical={true}
      percentage={true}
      primaryMinSize={20}
      secondaryMinSize={30}
      secondaryInitialSize={40}
      secondaryHidden={true}
    >
      <AgentInspector />
      <div />
    </WrappedSplitterLayout>
  </div>
);
