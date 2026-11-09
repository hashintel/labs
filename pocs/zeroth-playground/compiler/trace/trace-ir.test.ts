import { describe, expect, it } from "vitest";

import { lineContaining } from "../testing/line-containing";
import { servedQueue } from "../testing/small-nets.fixtures";
import { provenanceAt } from "./provenance";
import { traceIr } from "./trace-ir";

import type { PetriNetIr } from "../ir/schema";

const QUEUE_TEXT = `name: queue
kind: stochastic

places:
  Waiting:
  Served:
    capacity: 5

marking:
  Waiting: 2

transitions:
  Arrive:
    outputs:
      Waiting:
    rate: 2
  Serve:
    inputs:
      Waiting:
        weight: 2
    outputs:
      Served:
    rate: 1.5
    controllable: true
`;

describe("traceIr", () => {
  const trace = traceIr(servedQueue, QUEUE_TEXT);

  it("describes a transition, its fields and its arcs from the innermost range", () => {
    // GIVEN the queue's IR text and its trace
    // WHEN the lines of Serve, its rate and its weighted arc are looked up
    const transition = provenanceAt(trace, lineContaining(QUEUE_TEXT, "  Serve:"));
    const rate = provenanceAt(trace, lineContaining(QUEUE_TEXT, "    rate: 1.5"));
    const arc = provenanceAt(trace, lineContaining(QUEUE_TEXT, "        weight: 2"));
    // THEN each gets the innermost range's record
    expect(transition).toEqual({
      what: "Transition Serve",
      why: "takes from Waiting; adds to Served; fires at rate 1.5, tested over dt each step; controllable.",
      ir: "transitions.Serve",
      source: { kind: "transition", name: "Serve" },
    });
    expect(rate).toMatchObject({
      what: "Serve's firing rate",
      ir: "transitions.Serve.rate",
    });
    expect(arc).toMatchObject({
      what: "Arc from Waiting into Serve: 2 tokens",
      ir: "transitions.Serve.inputs.Waiting",
      source: { kind: "place", name: "Waiting" },
    });
  });

  it("describes places, the marking, the kind and a section", () => {
    // GIVEN the queue's IR text and its trace
    // WHEN a place, a marking entry, the kind and a section head are looked up
    const place = provenanceAt(trace, lineContaining(QUEUE_TEXT, "  Served:"));
    const marking = provenanceAt(trace, lineContaining(QUEUE_TEXT, "  Waiting: 2"));
    const kind = provenanceAt(trace, lineContaining(QUEUE_TEXT, "kind: stochastic"));
    const section = provenanceAt(trace, lineContaining(QUEUE_TEXT, "places:"));
    // THEN each says what it is
    expect(place).toMatchObject({
      what: "Place Served",
      why: "starts empty; holds at most 5.",
      source: { kind: "place", name: "Served" },
    });
    expect(marking).toMatchObject({
      what: "Initial tokens of Waiting",
      ir: "marking.Waiting",
    });
    expect(kind).toMatchObject({ what: "A stochastic net" });
    expect(section?.what).toBe("The places, in the order the net lists them");
  });

  it("gives nothing to a section the IR does not have", () => {
    // GIVEN the queue's text with a section that is not part of the IR
    const text = `${QUEUE_TEXT}\nzeroth:\n  shape: modular\n`;
    // WHEN it is traced
    const withSection = traceIr(servedQueue, text);
    // THEN its lines are off every range
    expect(provenanceAt(withSection, lineContaining(text, "  shape: modular"))).toBeNull();
  });
});

describe("traceIr quoting", () => {
  it("reads a key the dumper quotes", () => {
    // GIVEN a net with a place named On, which YAML 1.1 reads as a Boolean
    const toggle: PetriNetIr = {
      name: "toggle",
      kind: "stochastic",
      places: { On: null, Off: null },
      marking: { On: 1 },
      transitions: {
        Flip: { inputs: { On: null }, outputs: { Off: null }, rate: 1 },
      },
    };
    const text = [
      "name: toggle",
      "kind: stochastic",
      "",
      "places:",
      "  'On':",
      "  'Off':",
      "",
      "marking:",
      "  'On': 1",
      "",
      "transitions:",
      "  Flip:",
      "    inputs:",
      "      'On':",
      "    outputs:",
      "      'Off':",
      "    rate: 1",
      "",
    ].join("\n");
    // WHEN its IR text is traced
    const trace = traceIr(toggle, text);
    // THEN the quoted key is the place On
    expect(provenanceAt(trace, lineContaining(text, "  'On':"))).toMatchObject({
      what: "Place On",
      ir: "places.On",
      source: { kind: "place", name: "On" },
    });
  });

  it("reads the lines of a block scalar as text, not as keys", () => {
    // GIVEN the queue with a kernel whose lines look like keys
    const text = QUEUE_TEXT.replace(
      "    rate: 1.5\n",
      "    rate: 1.5\n    kernel: |\n      Air: 1\n      Waiting: 2\n",
    );
    // WHEN it is traced
    const trace = traceIr(servedQueue, text);
    // THEN the kernel's lines belong to the kernel
    const kernel = provenanceAt(trace, lineContaining(text, "    kernel: |"));
    expect(provenanceAt(trace, lineContaining(text, "      Air: 1"))).toEqual(kernel);
    expect(provenanceAt(trace, lineContaining(text, "      Waiting: 2"))).toEqual(kernel);
  });
});

describe("traceIr under clock rates", () => {
  it("reads a rate as a clock armed with it", () => {
    // GIVEN the birth-death net under clock rates
    const birthDeath: PetriNetIr = {
      name: "birth_death",
      kind: "stochastic",
      places: { Population: null },
      transitions: {
        Birth: { outputs: { Population: null }, rate: 2 },
        Death: { inputs: { Population: null }, rate: 1 },
      },
    };
    const text = [
      "name: birth_death",
      "kind: stochastic",
      "",
      "places:",
      "  Population:",
      "",
      "transitions:",
      "  Birth:",
      "    outputs:",
      "      Population:",
      "    rate: 2",
      "  Death:",
      "    inputs:",
      "      Population:",
      "    rate: 1",
      "",
    ].join("\n");
    // WHEN its IR text is traced, and a rate, a transition and the kind are looked up
    const trace = traceIr(birthDeath, text, { rates: "clock" });
    const rate = provenanceAt(trace, lineContaining(text, "    rate: 2"));
    const transition = provenanceAt(trace, lineContaining(text, "  Death:"));
    const kind = provenanceAt(trace, lineContaining(text, "kind: stochastic"));
    // THEN each reads a rate as a clock armed with it
    expect(rate).toMatchObject({
      what: "Birth's firing rate",
      why: "Arms an exponential clock with this rate when the transition fires.",
    });
    expect(transition?.why).toBe(
      "takes from Population; adds nothing; fires at rate 1, a clock armed with exp(1) each time it fires.",
    );
    expect(kind?.why).toBe(
      "Every transition has a rate; each arms an exponential clock and fires when it expires.",
    );
  });
});
