import { describe, expect, it } from "vitest";

import { PIPELINE_EDGES, PIPELINE_VIEWBOX, edgeFocus, edgeLabel, edgeLine, nodeBox, nodeFocus } from "./pipeline-layout";
import { STAGES } from "./stages";

describe("the pipeline layout", () => {
  it("keeps every node inside the view box, no two overlapping", () => {
    // GIVEN every stage
    // WHEN each is given its box
    const boxes = STAGES.map((stage) => nodeBox(stage.id));
    // THEN each box lies inside the view box, and no two boxes overlap
    for (const box of boxes) {
      expect(box.x - box.width / 2).toBeGreaterThanOrEqual(PIPELINE_VIEWBOX.x);
      expect(box.x + box.width / 2).toBeLessThanOrEqual(PIPELINE_VIEWBOX.x + PIPELINE_VIEWBOX.width);
      expect(box.y - box.height / 2).toBeGreaterThanOrEqual(PIPELINE_VIEWBOX.y);
      expect(box.y + box.height / 2).toBeLessThanOrEqual(PIPELINE_VIEWBOX.y + PIPELINE_VIEWBOX.height);
    }
    boxes.forEach((a, i) =>
      boxes.slice(i + 1).forEach((b) => {
        const apart =
          Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2;
        expect(apart).toBe(true);
      }),
    );
  });

  it("joins every stage to the graph by at least one edge", () => {
    // GIVEN every stage
    // THEN some edge starts or ends at it
    for (const stage of STAGES) {
      expect(PIPELINE_EDGES.some((edge) => edge.from === stage.id || edge.to === stage.id), stage.id).toBe(true);
    }
  });

  it("draws an edge from the side of one box to the side of the other", () => {
    // GIVEN the lowering and the module graph, side by side
    const lower = nodeBox("lower");
    const graph = nodeBox("graph");
    // WHEN the edge between them is drawn
    const line = edgeLine(lower, graph);
    // THEN it leaves the right side of the first at mid-height and stops short of the left side of the second
    expect(line.y1).toBe(lower.y);
    expect(line.x1).toBe(lower.x + lower.width / 2 + 1);
    expect(line.x2).toBe(graph.x - graph.width / 2 - 3);
  });
});

describe("edgeLabel", () => {
  it("sets a label above a horizontal line, beside a vertical one, off the upper side of a diagonal", () => {
    // GIVEN lines in each direction
    const rightward = { x1: 0, y1: 0, x2: 100, y2: 0 };
    const downward = { x1: 0, y1: 0, x2: 0, y2: 100 };
    const upward = { x1: 0, y1: 0, x2: 0, y2: -100 };
    const downRight = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const downLeft = { x1: 100, y1: 0, x2: 0, y2: 100 };
    // WHEN a label is set halfway along each
    // THEN it sits centred above a horizontal line, starts right of a vertical one and stands
    // off the upper side of a diagonal; "below" moves it to the other side
    expect(edgeLabel(rightward, 0.5)).toEqual({ x: 50, y: -6, anchor: "middle" });
    expect(edgeLabel(downward, 0.5)).toEqual({ x: 6, y: 53, anchor: "start" });
    expect(edgeLabel(upward, 0.5).anchor).toBe("start");
    expect(edgeLabel(downRight, 0.5).anchor).toBe("start");
    expect(edgeLabel(downLeft, 0.5).anchor).toBe("end");
    expect(edgeLabel(downLeft, 0.5, "below").anchor).toBe("start");
    expect(edgeLabel(rightward, 0.5, "below")).toEqual({ x: 50, y: 9, anchor: "middle" });
  });
});

describe("focus", () => {
  it("leaves every node and edge at rest while no stage has the focus", () => {
    // GIVEN no focused stage
    // THEN a node and an edge both rest
    expect(nodeFocus("lower", null)).toBe("rest");
    expect(edgeFocus({ from: "ir", to: "lower" }, null)).toBe("rest");
  });

  it("lights the focused stage and its edges, keeps its neighbours, dims the rest", () => {
    // GIVEN the focus on the lowering
    const focused = "lower";
    // THEN the lowering and an edge into it are lit, the stages one edge away stay near, and a
    // stage or an edge further off is dimmed
    expect(nodeFocus("lower", focused)).toBe("focus");
    expect(nodeFocus("options", focused)).toBe("near");
    expect(nodeFocus("code-parser", focused)).toBe("near");
    expect(nodeFocus("diagnostics", focused)).toBe("near");
    expect(nodeFocus("hover", focused)).toBe("dim");
    expect(edgeFocus({ from: "ir", to: "lower" }, focused)).toBe("focus");
    expect(edgeFocus({ from: "emit", to: "files" }, focused)).toBe("dim");
  });
});
