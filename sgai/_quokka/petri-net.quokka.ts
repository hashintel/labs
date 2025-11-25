/* petri net type definition */

type Place = {
  id: string;
  name: string;
  slug: string;
  tokenTypes: string[];
};

type Transition = {};

type Arc = {
  from: Place | Transition;
  to: Place | Transition;
};

type PetriNet = {
  structure: {
    places: Place[];
    transitions: Transition[];
    arcs: Arc[];
  };
};
