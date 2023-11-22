import { CallbackInterface } from "recoil";

import {
  HoveredAgent,
  SelectedAgentIds,
  StageDimensions,
  dimensionDefaults,
} from "./SceneState";
import { selectGlobals } from "../../../features/files/selectors";
import { store } from "../../../features/store";

/**
 * Set the dimensions of the viewer stage on viewer reset
 * Also clears some recoil state
 * @see Controls for camera reset
 */
export const resetViewer =
  ({ set, reset }: CallbackInterface) =>
  async () => {
    // Set the dimensions of the stage on reset
    let { pxMin, pxMax, pyMin, pyMax } = dimensionDefaults;

    // The user may have defined their own initial stage bounds in globals.json
    const globals = selectGlobals(store.getState());
    if (globals) {
      try {
        const { topology } = JSON.parse(globals);
        if (topology) {
          // Fallback to default values if user has failed to specify any
          pxMin = topology.x_bounds?.[0] ?? pxMin;
          pxMax = topology.x_bounds?.[1] ?? pxMax;
          pyMin = topology.y_bounds?.[0] ?? pyMin;
          pyMax = topology.y_bounds?.[1] ?? pyMax;
        }
      } catch {
        // globals.json is not valid JSON
      }
    }

    set(StageDimensions, {
      pxMin,
      pxMax,
      pyMin,
      pyMax,
    });

    // Clear selected agents while we're at it
    reset(SelectedAgentIds);
    reset(HoveredAgent);
  };
