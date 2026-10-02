import { describe, expect, it } from "vitest";

import { birthDeathIr } from "../testing/birth-death.fixtures";
import { forkClockedIr, forkClockedOptions, forkIr } from "../testing/fork.fixtures";
import { optionsLabel, optionVariants } from "./option-variants";

describe("the option sets the zrth check compiles a net under", () => {
  it("opens with the net's options, then changes one applicable option at a time", () => {
    // GIVEN a plain fork, whose conflict is the only choice beside the shape, opened modular
    // WHEN its variants are listed
    const variants = optionVariants(forkIr, { shape: "modular" });
    // THEN the opening comes first, and no option that needs rates appears
    expect(variants).toEqual([
      { shape: "modular" },
      {},
      { shape: "modular", conflicts: "nondet" },
      { shape: "modular", layout: "per-module" },
    ]);
  });

  it("drops the options clock rates turn off, and lists the clocked conflict once", () => {
    // GIVEN the fork at rates, opened under clocks with its conflict left open
    // WHEN its variants are listed
    const variants = optionVariants(forkClockedIr, forkClockedOptions);
    // THEN the shape is never swept under clocks, and the combined change adds no second copy of the opening
    expect(variants).toEqual([
      { rates: "clock", conflicts: "nondet" },
      { conflicts: "nondet" },
      { rates: "clock" },
      { rates: "clock", conflicts: "nondet", layout: "per-module" },
    ]);
  });

  it("tries clock rates and the Int marking on a stochastic net opened under coins", () => {
    // GIVEN birth-death, opened modular under coins
    // WHEN its variants are labelled
    const labels = optionVariants(birthDeathIr, { shape: "modular" }).map(optionsLabel);
    // THEN clocks drop the shape, and the defaults read as such
    expect(labels).toEqual([
      "shape=modular",
      "rates=clock",
      "defaults",
      "shape=modular, marking=int",
      "shape=modular, layout=per-module",
    ]);
  });
});
