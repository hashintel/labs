/* petri net type definition

  tree sketch: https://tree.nathanfriend.com/?s=(%27opt9s!(%27fancy!true~fullPath7~trailingSlash7~rootDot7)~B(%27B%27structure6J5CEtokenID6transit9s3in4*out46token5G0EHELENK5*defaultVFue2dyn8ics2stochastics6l8bdaC6kernelC2scenarioC6title%2FH6initiFMarkingCKeterVFueC2metadata6%7Bmisc.%20presentat9F%20info%7D%27)~vers9!%271%27)*6--%20%200%5B%5D2%5Cn30*id*H*L*4putArcG0EJIDEweight5G3N62-7!fFse8am9ionBsource!Cs0E*-FalGs()Hn8eJplaceK6par8LslugNtype%01NLKJHGFECB987654320-*
*/

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
