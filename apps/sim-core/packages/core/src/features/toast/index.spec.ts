import type { RootState } from "../types";
import { ToastKind } from "./enums";
import { displayToast, toastReducer } from "./slice";
import { selectToastData, selectToastKind } from "./selectors";

describe("toast feature", () => {
  it("reducer should have an initial state", () => {
    expect(toastReducer(undefined, { type: "" })).toEqual({
      kind: ToastKind.None,
    });
  });

  it.each([
    [{ kind: ToastKind.ProjectForked }],
    [{ kind: ToastKind.ProjectPreview }],
    [{ kind: ToastKind.ProjectEditable }],
    [{ kind: ToastKind.None }],
  ] as [{ kind: ToastKind; data?: string }][])(
    "reducer should demonstrate expected behavior",
    (payload) => {
      const state = {
        toast: toastReducer(undefined, {
          type: displayToast.type,
          payload,
        }),
      } as RootState;

      expect(selectToastKind(state)).toEqual(payload.kind);
      expect(selectToastData(state)).toEqual(payload.data);
    },
  );
});
