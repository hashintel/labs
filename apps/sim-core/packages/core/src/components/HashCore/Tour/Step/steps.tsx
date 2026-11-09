import React from "react";

import {
  BackButton,
  Button,
  Buttons,
  KeyboardSupport,
  ProgressIndicator,
} from "./util";
import { HashCoreTourStepAgents } from "./HashCoreTourStepAgents";
import { HashCoreTourStepDatasets } from "./HashCoreTourStepDatasets";
import { HashCoreTourStepDone } from "./HashCoreTourStepDone";
import { HashCoreTourStepIntro } from "./HashCoreTourStepIntro";
import { HashCoreTourStepPause } from "./HashCoreTourStepPause";
import { HashCoreTourStepPlay } from "./HashCoreTourStepPlay";
import { HashCoreTourStepPlots } from "./HashCoreTourStepPlots";
import { HashCoreTourStepRefresh } from "./HashCoreTourStepRefresh";

export const steps = [
  {
    id: "intro",
    text: <HashCoreTourStepIntro />,
  },
  {
    id: "languages",
    text: (
      <>
        <KeyboardSupport />
        <p>
          <strong>
            HASH Core features a live code editor for creating, editing, and
            running simulations in your browser.
          </strong>
        </p>
        <p>
          Core supports JavaScript or Python - when you create a new file you
          can select the file extension for the language of your choice (this
          tutorial will be in JavaScript).
        </p>
        <Buttons>
          <BackButton />
          <Button type="next">Next</Button>
        </Buttons>
        <ProgressIndicator />
      </>
    ),
  },
  {
    id: "agents",
    text: <HashCoreTourStepAgents />,
  },
  {
    id: "behaviors",
    text: (
      <>
        <KeyboardSupport />
        <p>
          Every agent has a state (which you set as a JSON object) and (often)
          has behaviors.
        </p>
        <p>
          <a
            href="https://docs.hash.ai/core/creating-simulations/behaviors"
            target="_blank"
          >
            Behaviors are “actions” that, if attached to an agent, run every
            timestep.
          </a>{" "}
          They’re functions which take in the current state and context of the
          agent, perform an action, and return the next state of the agent.
        </p>
        <Buttons>
          <BackButton />
          <Button type="next">Next</Button>
        </Buttons>
        <ProgressIndicator />
      </>
    ),
  },
  {
    id: "play",
    text: <HashCoreTourStepPlay />,
  },
  {
    id: "pause",
    text: <HashCoreTourStepPause />,
  },
  {
    id: "refresh",
    text: <HashCoreTourStepRefresh />,
  },
  {
    id: "plots",
    text: <HashCoreTourStepPlots />,
  },
  {
    id: "plots-desc",
    text: (
      <>
        <KeyboardSupport />
        <p>
          <a
            href="https://docs.hash.ai/core/creating-simulations/views/analysis"
            target="_blank"
          >
            HASH plots charts from your simulation
          </a>
          , letting you observe patterns and answer questions about your
          simulation. For instance does a certain variable converge to a single
          value? Or what's the optimal parameter setting for a given scenario?
        </p>
        <p>
          HASH autogenerates initial outputs and plots, any of which you can
          customize and expand by editing analysis.json.
        </p>
        <Buttons>
          <BackButton />
          <Button type="next">Next</Button>
        </Buttons>
        <ProgressIndicator />
      </>
    ),
  },
  {
    id: "datasets",
    text: <HashCoreTourStepDatasets />,
  },
  {
    id: "done",
    text: <HashCoreTourStepDone />,
  },
].map((step) => ({
  id: `${step.id}`,
  buttons: [],
  cancelIcon: {
    enabled: false,
  },
  text: document.createElement("div"),
  jsx: step.text,
}));

export const VERSION = "1.1";
