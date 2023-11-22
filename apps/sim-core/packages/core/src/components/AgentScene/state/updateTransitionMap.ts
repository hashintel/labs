import * as THREE from "three";
import { AgentState, Vec3 } from "@hashintel/engine-web";
import { CallbackInterface } from "recoil";

import { AgentTransition, RenderSummary } from "../util/anim";
import { MappedTransitions, StageDimensions } from "./SceneState";

const tempColor = new THREE.Color();

/*
Uses the previous RenderSummary to create a new RenderSummary that describes
transitions that the 3D viewer must take.
*/
export const updateTransitionMap =
  ({ set, snapshot }: CallbackInterface) =>
  async (oldSummary: RenderSummary, states: AgentState[]) => {
    /**
     * Update the agents themselves
     */
    const removals = new Set(Object.keys(oldSummary));
    const newSummary = { ...oldSummary };
    for (const agent of states) {
      const agentId = agent.agent_id ?? "AGENT_ID_NOT_FOUND";
      if (!agent.position) {
        continue;
      }

      /*
    OF NOTE:
      This agent data is coming from recoil. We can "dangerouslyMutate" it while 
      making sure it gets committed back using the normal recoilSetState. 
    */
      // This can be undefined, dont' rely on it
      const oldAgent = newSummary[agentId] as AgentTransition | undefined;

      // 1. Extract position
      const [posX, posY, posZ] = [...(agent.position ?? [1, 1, 1])];
      const newPosition: Vec3 = [posX, posY ?? 0, posZ ?? 0];

      // 2. Extract scaling
      const scalex = agent.scale ? agent.scale[0] : 1;
      const scaley = agent.scale ? agent.scale[1] : 1;
      const scalez = agent.height ?? (agent.scale ? agent.scale[2] : 1);
      const newScale: Vec3 = [scalex, scaley, scalez];
      const useHeight = agent.scale === undefined || agent.height !== undefined;

      // 3. Extract Direction
      const [newDirX, newDirY, newDirZ] = [
        ...((Array.isArray(agent.direction) ? agent.direction : null) ??
          (Array.isArray(agent.velocity) ? agent.velocity : null) ?? [0, 0, 0]),
      ];

      // If the velocity goes to zero, try using the previous state's direction
      // This helps prevent agents from flipping rotations around
      const newDirection: Vec3 = [newDirX ?? 0, newDirY ?? 0, newDirZ ?? 0];
      if (
        newDirection[0] === 0 &&
        newDirection[1] === 0 &&
        newDirection[2] === 0
      ) {
        const oldDir = oldAgent?.direction.to ?? oldAgent?.direction.current;
        if (oldDir) {
          newDirection[0] = oldDir[0];
          newDirection[1] = oldDir[1];
          newDirection[2] = oldDir[2];
        }
      }

      // 4. Extract Color
      //
      // Agents can have a "color" field and even an "rgb" field
      // RGB is specified is [r,g,b] whereas color is any three-compatible color description
      tempColor.set(agent.color ?? "green");
      const newColor: Vec3 = [tempColor.r, tempColor.g, tempColor.b];
      if (agent.rgb && !agent.color) {
        newColor[0] = agent.rgb[0] / 255;
        newColor[1] = agent.rgb[1] / 255;
        newColor[2] = agent.rgb[2] / 255;
      }

      // Weird carry over from before, any agents with a direction but no shape
      // are turned into "arrows" (ie pointed cones)
      let shape = agent.shape ?? oldAgent?.shape;
      if (!shape) {
        if (agent.direction || agent.velocity) {
          shape = "cone";
        } else {
          shape = "box";
        }
      }

      // 5. Assign a slot in the transitions
      //
      // Grab out any old data from the agent to act as the previous animation frame
      if (oldAgent) {
        newSummary[agentId] = {
          ...oldAgent,
          shape,
          original: agent,
          hidden: agent.hidden ?? false,
          color: { current: [...oldAgent.color.to], to: newColor },
          direction: { current: oldAgent.direction.to, to: newDirection },
          scale: { current: oldAgent.scale.to, to: newScale },
          position: { current: oldAgent.position.to, to: newPosition },
          network_neighbor_ids: agent.network_neighbor_ids,
          network_neighbor_in_ids: agent.network_neighbor_in_ids,
          network_neighbor_out_ids: agent.network_neighbor_out_ids,
        };
      } else {
        // If no existing agent exists, create a new one
        newSummary[agentId] = {
          color: { current: newColor, to: newColor },
          direction: { current: newDirection, to: newDirection },
          position: { current: newPosition, to: newPosition },
          scale: { current: [0, 0, 0], to: newScale },
          network_neighbor_ids: agent.network_neighbor_ids,
          network_neighbor_in_ids: agent.network_neighbor_in_ids,
          network_neighbor_out_ids: agent.network_neighbor_out_ids,
          useHeight,
          remove: false,
          shape,
          original: agent,
          hidden: agent.hidden ?? false,
        };
      }
      removals.delete(agentId);
    }

    // ID didn't show up in the new list of agents
    for (const removal of removals.values()) {
      const oldAgent = newSummary[removal];
      // Make sure this is actually actionable
      if (oldAgent) {
        if (oldAgent.remove) {
          // Either it was scheduled for deletion or should be deleted
          delete newSummary[removal];
        } else {
          // Or it needs to be scheduled for deletion
          newSummary[removal] = {
            ...oldAgent,
            remove: true,
            scale: { ...oldAgent.scale, to: [0, 0, 0] },
          };
        }
      }
    }

    set(MappedTransitions, newSummary);

    /**
     * Set the dimensions of the stage
     */
    const dims = await snapshot.getPromise(StageDimensions);
    let { pxMax, pxMin, pyMax, pyMin } = dims;
    for (const agent of Object.values(newSummary)) {
      pxMax = Math.max(agent.position.to[0], pxMax);
      pxMin = Math.min(agent.position.to[0], pxMin);
      pyMax = Math.max(agent.position.to[1], pyMax);
      pyMin = Math.min(agent.position.to[1], pyMin);
    }
    set(StageDimensions, {
      pxMax,
      pxMin,
      pyMax,
      pyMin,
    });
  };
