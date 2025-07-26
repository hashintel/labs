/**
 * This will get imported in the global scope
 *
 *
 * ```
 * let { incr } = hash_stdlib;
 *
 * (state, context) => {
 *   let a = 0;
 *   let b = incr(a);
 *   console.log(b);
 *
 *   return state;
 * };
 * ```
 */

// @ts-expect-error
import { jStat } from "jstat";
import { number } from "prop-types";
import { v4 as uuid } from "uuid";

// @ts-expect-error
export { jStat as stats } from "jstat";

export function incr(n: number) {
  return n + 1;
}

/**
 * Generate a valid uuid-v4 address to create a new with
 *
 * @param asStr Output the uuid as a string, if false, will output raw Uuid type
 */
export const generateAgentID = () => uuid();

type PotentialAgent = {
  position?: number[];
  direction?: number[];
  agent_name?: string;
  get?: (a: string) => any;
};

export interface Topology {
  x_bounds: number[];
  y_bounds: number[];
  z_bounds?: number[];
}

/** Initialization functions */
export const init = {
  scatter: (
    count: number,
    topology: Topology,
    template: PotentialAgent | Function,
  ) => scatter(count, topology, template),
  stack: (count: number, template: PotentialAgent | Function) =>
    stack(count, template),
  grid: (topology: Topology, template: PotentialAgent | Function) =>
    grid(topology, template),
  // "createLayout": (layout: string[][], templates, offset) =>
  //     createLayout(layout, templates, offset)
};

function scatter(
  count: number,
  topology: Topology,
  template: PotentialAgent | Function,
) {
  const { x_bounds, y_bounds } = topology;

  const width = x_bounds[1] - x_bounds[0];
  const height = y_bounds[1] - y_bounds[0];

  // Return agents
  const agents = [...Array(count)].map((_) => {
    const position = [
      Math.floor(Math.random() * width) + x_bounds[0],
      Math.floor(Math.random() * height) + y_bounds[0],
    ];

    if (typeof template === "function") {
      return {
        ...template(),
        position,
      };
    } else {
      return {
        ...template,
        position,
      };
    }
  });

  return agents;
}

function stack(count: number, template: PotentialAgent | Function) {
  const agents = [...Array(count)].map((_) => {
    if (typeof template === "function") {
      return {
        ...template(),
      };
    } else {
      return {
        ...template,
      };
    }
  });

  return agents;
}

export function grid(topology: Topology, template: PotentialAgent | Function) {
  const { x_bounds, y_bounds } = topology;

  const width = x_bounds[1] - x_bounds[0];
  const height = y_bounds[1] - y_bounds[0];
  const count = width * height;

  // Return agents
  const agents = [...Array(count)].map((_, ind) => {
    const position = [
      (ind % width) + x_bounds[0],
      Math.floor(ind / width) + y_bounds[0],
    ];

    if (typeof template === "function") {
      return {
        ...template(),
        position,
      };
    } else {
      return {
        ...template,
        position,
      };
    }
  });

  return agents;
}

export function createLayout(
  layout: string[][],
  templates: { [key: string]: PotentialAgent },
  offset: number[] = [0, 0, 0],
) {
  const height = layout.length;
  const agents: { [key: string]: PotentialAgent[] } = {};

  layout.forEach((row, pos_y) => {
    row.forEach((type, pos_x) => {
      // If type value is in layout keys, create agent
      if (type in templates) {
        if (!(type in agents)) {
          agents[type] = [];
        }

        const agent_name =
          (templates[type].agent_name ?? type) + agents[type].length;

        agents[type].push({
          ...templates[type],
          agent_name,
          position: [
            pos_x + offset[0],
            height - pos_y + offset[1],
            0 + offset[2],
          ],
        });
      }
    });
  });

  // Flatten the agents into a single array
  const agent_list = [];
  for (const key in agents) {
    agent_list.push(...agents[key]);
  }

  return agent_list;
}

/** PRNG */

/**
 * Generates a random number
 */
function sfc32(a: number, b: number, c: number, d: number) {
  return function () {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    var t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export var rng = {
  _random_fn: Math.random,
};

function xmur3(str: string) {
  for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++)
    (h = Math.imul(h ^ str.charCodeAt(i), 3432918353)),
      (h = (h << 13) | (h >>> 19));
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/**
 * Sets a seed for rng.random() and the jStat library
 * @param s string for seed
 */
export function setSeed(s: string) {
  const seed = xmur3(s);
  rng._random_fn = sfc32(seed(), seed(), seed(), seed());
  jStat.setRandom(rng._random_fn);
}

/**
 * Returns a random number betweeon 0 and 1
 */
export function random() {
  return rng._random_fn();
}

/** Spatial Functions */

/**
 * Returns the specified distance between two agents.
 *  distance is one of the four distance functions supported by HASH,
 *  defaults to manhattan distance.
 * @param a
 * @param b
 * @param distance
 */
export function distanceBetween(
  agentA: PotentialAgent,
  agentB: PotentialAgent,
  distance = "euclidean",
) {
  interface IdFuncs {
    [index: string]: (a_pos: number[], b_pos: number[]) => number;
  }

  const { abs, pow, max, sqrt } = Math;

  const dFuncs: IdFuncs = {
    manhattan: (a_pos: number[], b_pos: number[]) =>
      abs(a_pos[0] - b_pos[0]) +
      abs(a_pos[1] - b_pos[1]) +
      abs(a_pos[2] - b_pos[2]),
    euclidean: (a_pos: number[], b_pos: number[]) =>
      sqrt(
        pow(a_pos[0] - b_pos[0], 2) +
          pow(a_pos[1] - b_pos[1], 2) +
          pow(a_pos[2] - b_pos[2], 2),
      ),
    euclidean_sq: (a_pos: number[], b_pos: number[]) =>
      pow(a_pos[0] - b_pos[0], 2) +
      pow(a_pos[1] - b_pos[1], 2) +
      pow(a_pos[2] - b_pos[2], 2),
    chebyshev: (a_pos: number[], b_pos: number[]) =>
      max(
        abs(a_pos[0] - b_pos[0]),
        abs(a_pos[1] - b_pos[1]),
        abs(a_pos[2] - b_pos[2]),
      ),
  };

  const aPos: number[] | undefined =
    agentA.position || (agentA.get ? agentA.get("position") : undefined);
  const bPos: number[] | undefined =
    agentB.position || (agentB.get ? agentB.get("position") : undefined);

  if (!aPos || !bPos) {
    throw new Error("agents must have position");
  }
  return dFuncs[distance](aPos, bPos);
}

/**
 * Returns the unit vector of the direction of an agent
 * @param a agent type
 */
export function normalizeVector(vec: number[]) {
  const magnitude = Math.sqrt(
    vec.reduce((acc: number, val: number) => acc + val ** 2, 0),
  );
  return vec.map((v) => v / magnitude);
}

/**
 * * Returns a position array of x,y,z is set to true
 * @param topology the Context.globals().topology object
 * @param z_plane defaults to false
 */
export function randomPosition(
  topology: {
    z_bounds: number[] | undefined;
    x_bounds: number[] | undefined;
    y_bounds: number[] | undefined;
  },
  z_plane = false,
) {
  const { floor, random } = Math;

  let z_pos = 0;
  if (z_plane) {
    if (!topology.z_bounds) {
      throw new Error("topology z_bounds needed if z_plane flag set to true");
    }
    z_pos = floor(
      random() * (topology.z_bounds[1] - topology.z_bounds[0]) +
        topology.z_bounds[0],
    );
  }
  if (!topology.x_bounds || !topology.y_bounds) {
    throw new Error("topology missing x_bounds or y_bounds");
  }
  return [
    floor(
      random() * (topology.x_bounds[1] - topology.x_bounds[0]) +
        topology.x_bounds[0],
    ),
    floor(
      random() * (topology.y_bounds[1] - topology.y_bounds[0]) +
        topology.y_bounds[0],
    ),
    z_pos,
  ];
}

/** Neighbor Functions */

/**
 * Returns all neighbors that share an agent's position
 * @param agentA
 * @param neighbors - context.neighbors() array or array of agents
 * */
export function neighborsOnPosition(
  agentA: PotentialAgent,
  neighbors: PotentialAgent[],
) {
  return neighbors.filter((neighbor) => {
    const aPos: number[] | undefined =
      agentA.position || (agentA.get ? agentA.get("position") : undefined);
    const nPos: number[] | undefined =
      neighbor.position ||
      (neighbor.get ? neighbor.get("position") : undefined);

    if (!aPos || !nPos) {
      throw new Error("agents must have position");
    }

    for (let ind = 0; ind < aPos.length; ind++) {
      if (aPos[ind] !== nPos[ind]) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Returns all neighbors within a certain vision radius of an agent.
 * Defaults vision max_radius to 1, min_radius to 0
 * Default is 2D (z_axis set to false), set z_axis to true for 3D positions
 * @param agentA
 * @param neighbors - context.neighbors() array or array of agents
 * @param max_radius - defaults to 1
 * @param min_radius - defaults to 0
 * @param z_axis - defaults to false
 */
export function neighborsInRadius(
  agentA: PotentialAgent,
  neighbors: PotentialAgent[],
  max_radius = 1,
  min_radius = 0,
  z_axis = false,
) {
  return neighbors.filter((neighbor) => {
    const aPos: number[] | undefined =
      agentA.position || (agentA.get ? agentA.get("position") : undefined);
    const nPos: number[] | undefined =
      neighbor.position ||
      (neighbor.get ? neighbor.get("position") : undefined);

    if (!aPos || !nPos) {
      throw new Error("agents must have position");
    }

    const notZ: number = z_axis ? 0 : 1;

    for (let ind = 0; ind < aPos.length - 1 * notZ; ind++) {
      const max = [aPos[ind] + max_radius, aPos[ind] - max_radius];
      const min = [aPos[ind] + min_radius, aPos[ind] - min_radius];
      if (
        !(
          (nPos[ind] <= max[0] && nPos[ind] >= min[0]) ||
          (nPos[ind] >= max[1] && nPos[ind] <= min[1])
        )
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Searches and returns all neighbors whose positions are in front of an agent.
 * Default is set to planar calculations and will return all neighbors located
 * in front of the plane created by the agent's direction
 *
 * Colinear - If set to true, will return all neighbors on the same line as agent a.
 * @param agentA
 * @param neighbors - context.neighbors() array or array of agents
 * @param colinear - defaults to false
 */
export function neighborsInFront(
  agentA: PotentialAgent,
  neighbors: PotentialAgent[],
  colinear = false,
) {
  return neighbors.filter((neighbor) => {
    const aPos: number[] | undefined =
      agentA.position || (agentA.get ? agentA.get("position") : undefined);
    const aDir: number[] | undefined =
      agentA.direction || (agentA.get ? agentA.get("direction") : undefined);
    const nPos: number[] | undefined =
      neighbor.position ||
      (neighbor.get ? neighbor.get("position") : undefined);

    if (!aPos || !nPos) {
      throw new Error("agents must have position");
    }
    if (!aDir) {
      throw new Error("agents must have direction");
    }

    if (colinear) {
      const count = aDir.reduce(function (n, val) {
        return n + val;
      }, 0);

      const dx = nPos[0] - aPos[0];
      const dy = nPos[1] - aPos[1];
      const dz = nPos[2] - aPos[2];

      const xt = aDir[0] !== 0 ? dx / aDir[0] : 0;
      const yt = aDir[1] !== 0 ? dy / aDir[1] : 0;
      const zt = aDir[2] !== 0 ? dz / aDir[2] : 0;

      // Only one direction set - only that axis value can change
      if (count === 1) {
        return (
          (xt > 0 && dy === 0 && dz === 0) ||
          (yt > 0 && dx === 0 && dz === 0) ||
          (zt > 0 && dx === 0 && dy === 0)
        );
      }
      // Two directions set
      else if (count === 2) {
        return (
          (xt === yt && xt > 0 && dz === 0) ||
          (yt === zt && yt > 0 && dx === 0) ||
          (xt === zt && xt > 0 && dy === 0)
        );
      }
      // Three directions set
      else if (count === 3) {
        return xt === yt && yt === zt && xt > 0;
      }
      // Else direction is [0,0,0] or an unsupported direction array
      else {
        return false;
      }

      return true;
    }

    // Planar calculations
    const dx = nPos[0] - aPos[0];
    const dy = nPos[1] - aPos[1];
    const dz = nPos[2] - aPos[2];

    const D = aDir[0] * dx + aDir[1] * dy + aDir[2] * dz;

    if (D <= 0) {
      return false;
    }

    return true;
  });
}

/**
 * Searches and returns all neighbors whose positions are behind an agent.
 * Default is set to planar calculations and will return all neighbors located
 * behind the plane created by the agent's direction
 *
 * Colinear - If set to true, will return all neighbors on the same line as agent a.
 * @param agentA
 * @param neighbors - context.neighbors() array or array of agents
 * @param colinear - defaults to false
 */
export function neighborsBehind(
  agentA: PotentialAgent,
  neighbors: PotentialAgent[],
  colinear = false,
) {
  return neighbors.filter((neighbor) => {
    const aPos: number[] | undefined =
      agentA.position || (agentA.get ? agentA.get("position") : undefined);
    const aDir: number[] | undefined =
      agentA.direction || (agentA.get ? agentA.get("direction") : undefined);
    const nPos: number[] | undefined =
      neighbor.position ||
      (neighbor.get ? neighbor.get("position") : undefined);

    if (!aPos || !nPos) {
      throw new Error("agents must have position");
    }
    if (!aDir) {
      throw new Error("agents must have direction");
    }

    if (colinear) {
      const count = aDir.reduce(function (n, val) {
        return n + val;
      }, 0);

      const dx = nPos[0] - aPos[0];
      const dy = nPos[1] - aPos[1];
      const dz = nPos[2] - aPos[2];

      const xt = aDir[0] !== 0 ? (nPos[0] - aPos[0]) / aDir[0] : 0;
      const yt = aDir[1] !== 0 ? (nPos[1] - aPos[1]) / aDir[1] : 0;
      const zt = aDir[2] !== 0 ? (nPos[2] - aPos[2]) / aDir[2] : 0;

      // Only one direction set - only that axis value can change
      if (count === 1) {
        return (
          (xt < 0 && dy === 0 && dz === 0) ||
          (yt < 0 && dx === 0 && dz === 0) ||
          (zt < 0 && dx === 0 && dy === 0)
        );
      }
      // Two directions set
      else if (count === 2) {
        return (
          (xt === yt && xt < 0 && dz === 0) ||
          (yt === zt && yt < 0 && dx === 0) ||
          (xt === zt && xt < 0 && dy === 0)
        );
      }
      // Three directions set
      else if (count === 3) {
        return xt === yt && yt === zt && xt < 0;
      }
      // Else direction is [0,0,0] or an unsupported direction array
      else {
        return false;
      }

      return true;
    }

    // Planar calculations
    const dx = nPos[0] - aPos[0];
    const dy = nPos[1] - aPos[1];
    const dz = nPos[2] - aPos[2];

    const D = aDir[0] * dx + aDir[1] * dy + aDir[2] * dz;

    if (D >= 0) {
      return false;
    }

    return true;
  });
}
