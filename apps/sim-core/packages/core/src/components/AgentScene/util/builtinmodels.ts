type PolyModel = {
  folderPath: string;
  resourceUrls: string[];
  slug: string;
};

export const BUILTIN_MODELS: {
  // rotation as degrees
  [id: string]: { rotX?: number; rotY?: number; rotZ?: number };
} = {
  "elm-tree": {},
  "palm-tree": {},
  "spruce-tree": {},
  "train-tracks": {},
  "xmas-tree": {},
  ant: { rotZ: 270 },
  bamboo: {},
  bird: { rotZ: 270 },
  boat: {},
  car: {},
  cat: {},
  conveyor: { rotZ: 90 },
  crane: { rotZ: 90 },
  crate: { rotZ: 45 },
  cybertruck: { rotZ: 45 },
  dolphin: {},
  factory: {},
  fire: {},
  fish: {},
  forklift: {},
  fox: {},
  house: {},
  jet: {},
  locomotive: {},
  missile: { rotZ: 270 },
  pig: {},
  pipe: { rotZ: 270 },
  plane: { rotZ: 270 },
  rabbit: {},
  radar: {},
  satellite: { rotX: 90 },
  silo: {},
  skyscraper: {},
  store: {},
  wheat: {},
  windturbine: {},
};

export const BUILTIN_MODELS_DB: PolyModel[] = [
  {
    folderPath: "https://cdn-us1.hash.ai/polys/bamboo/",
    slug: "bamboo",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/bamboo/PUSHILIN_bamboo.mtl",
      "https://cdn-us1.hash.ai/polys/bamboo/PUSHILIN_bamboo.obj",
      "https://cdn-us1.hash.ai/polys/bamboo/PUSHILIN_bamboo.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/spruce-tree/",
    slug: "spruce-tree",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/spruce-tree/SpruceTree_BaseColor.png",
      "https://cdn-us1.hash.ai/polys/spruce-tree/SpruceTree.mtl",
      "https://cdn-us1.hash.ai/polys/spruce-tree/SpruceTree.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/wheat/",
    slug: "wheat",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/wheat/FieldOfWheat_BaseColor.png",
      "https://cdn-us1.hash.ai/polys/wheat/FieldOfWheat.mtl",
      "https://cdn-us1.hash.ai/polys/wheat/FieldOfWheat.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/ant/",
    slug: "ant",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/ant/CHAHIN_ANT.mtl",
      "https://cdn-us1.hash.ai/polys/ant/CHAHIN_ANT.obj",
      "https://cdn-us1.hash.ai/polys/ant/CHAHIN_ANT_TEXTURE.jpg",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/cat/",
    slug: "cat",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/cat/Mesh_Cat.mtl",
      "https://cdn-us1.hash.ai/polys/cat/Mesh_Cat.obj",
      "https://cdn-us1.hash.ai/polys/cat/Tex_Cat.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/plane/",
    slug: "plane",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/plane/PUSHILIN_Plane.mtl",
      "https://cdn-us1.hash.ai/polys/plane/PUSHILIN_Plane.obj",
      "https://cdn-us1.hash.ai/polys/plane/PUSHILIN_PLANE.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/locomotive/",
    slug: "locomotive",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/locomotive/1392 Train.mtl",
      "https://cdn-us1.hash.ai/polys/locomotive/1392 Train.obj",
      "https://cdn-us1.hash.ai/polys/locomotive/1392 Train.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/palm-tree/",
    slug: "palm-tree",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/palm-tree/QueenPalmTree_BaseColor.png",
      "https://cdn-us1.hash.ai/polys/palm-tree/QueenPalmTree.mtl",
      "https://cdn-us1.hash.ai/polys/palm-tree/QueenPalmTree.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/xmas-tree/",
    slug: "xmas-tree",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/xmas-tree/materials.mtl",
      "https://cdn-us1.hash.ai/polys/xmas-tree/model.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/pig/",
    slug: "pig",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/pig/Mesh_Pig.mtl",
      "https://cdn-us1.hash.ai/polys/pig/Mesh_Pig.obj",
      "https://cdn-us1.hash.ai/polys/pig/Tex_Pig.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/cybertruck/",
    slug: "cybertruck",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/cybertruck/materials.mtl",
      "https://cdn-us1.hash.ai/polys/cybertruck/model.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/house/",
    slug: "house",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/house/PUSHILIN_house.mtl",
      "https://cdn-us1.hash.ai/polys/house/PUSHILIN_house.obj",
      "https://cdn-us1.hash.ai/polys/house/PUSHILIN_house.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/car/",
    slug: "car",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/car/1377 Car.mtl",
      "https://cdn-us1.hash.ai/polys/car/1377 Car.obj",
      "https://cdn-us1.hash.ai/polys/car/1377 Car.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/dolphin/",
    slug: "dolphin",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/dolphin/Dolphin_BaseColor.png",
      "https://cdn-us1.hash.ai/polys/dolphin/Dolphin.mtl",
      "https://cdn-us1.hash.ai/polys/dolphin/Dolphin.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/radar/",
    slug: "radar",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/radar/SatelliteDish_BaseColor.png",
      "https://cdn-us1.hash.ai/polys/radar/SatelliteDish.mtl",
      "https://cdn-us1.hash.ai/polys/radar/SatelliteDish.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/silo/",
    slug: "silo",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/silo/CHAHIN_SILO_TEXTURE.jpg",
      "https://cdn-us1.hash.ai/polys/silo/CHAHIN_SILO.mtl",
      "https://cdn-us1.hash.ai/polys/silo/CHAHIN_SILO.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/bird/",
    slug: "bird",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/bird/Flying gull Texture 1.mtl",
      "https://cdn-us1.hash.ai/polys/bird/Flying gull Texture 1.obj",
      "https://cdn-us1.hash.ai/polys/bird/Gull tex1.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/fire/",
    slug: "fire",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/fire/PUSHILIN_campfire.mtl",
      "https://cdn-us1.hash.ai/polys/fire/PUSHILIN_campfire.obj",
      "https://cdn-us1.hash.ai/polys/fire/PUSHILIN_campfire.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/missile/",
    slug: "missile",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/missile/DefaultMaterial_Base_Color.png",
      "https://cdn-us1.hash.ai/polys/missile/Missile.mtl",
      "https://cdn-us1.hash.ai/polys/missile/Missile.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/pipe/",
    slug: "pipe",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/pipe/Pipe.mtl",
      "https://cdn-us1.hash.ai/polys/pipe/Pipe.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/skyscraper/",
    slug: "skyscraper",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/skyscraper/PUSHILIN_skyscraper.mtl",
      "https://cdn-us1.hash.ai/polys/skyscraper/PUSHILIN_skyscraper.obj",
      "https://cdn-us1.hash.ai/polys/skyscraper/PUSHILIN_skyscraper.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/elm-tree/",
    slug: "elm-tree",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/elm-tree/ElmTree_BaseColor.png",
      "https://cdn-us1.hash.ai/polys/elm-tree/ElmTree.mtl",
      "https://cdn-us1.hash.ai/polys/elm-tree/ElmTree.OBJ",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/jet/",
    slug: "jet",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/jet/1397 Jet.mtl",
      "https://cdn-us1.hash.ai/polys/jet/1397 Jet.obj",
      "https://cdn-us1.hash.ai/polys/jet/1397 Jet.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/factory/",
    slug: "factory",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/factory/PUSHILIN_factory.mtl",
      "https://cdn-us1.hash.ai/polys/factory/PUSHILIN_factory.obj",
      "https://cdn-us1.hash.ai/polys/factory/PUSHILIN_factory.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/satellite/",
    slug: "satellite",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/satellite/SpaceProbe_BaseColor.png",
      "https://cdn-us1.hash.ai/polys/satellite/SpaceProbe.mtl",
      "https://cdn-us1.hash.ai/polys/satellite/SpaceProbe.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/fox/",
    slug: "fox",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/fox/Fox_BaseColor.png",
      "https://cdn-us1.hash.ai/polys/fox/Fox.mtl",
      "https://cdn-us1.hash.ai/polys/fox/Fox.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/train-tracks/",
    slug: "train-tracks",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/train-tracks/Bullet Train Texture.png",
      "https://cdn-us1.hash.ai/polys/train-tracks/Rails.mtl",
      "https://cdn-us1.hash.ai/polys/train-tracks/Rails.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/forklift/",
    slug: "forklift",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/forklift/materials.mtl",
      "https://cdn-us1.hash.ai/polys/forklift/model.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/rabbit/",
    slug: "rabbit",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/rabbit/Mesh_Rabbit.mtl",
      "https://cdn-us1.hash.ai/polys/rabbit/Mesh_Rabbit.obj",
      "https://cdn-us1.hash.ai/polys/rabbit/Tex_Rabbit.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/conveyor/",
    slug: "conveyor",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/conveyor/materials.mtl",
      "https://cdn-us1.hash.ai/polys/conveyor/model.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/crane/",
    slug: "crane",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/crane/materials.mtl",
      "https://cdn-us1.hash.ai/polys/crane/model.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/crate/",
    slug: "crate",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/crate/materials.mtl",
      "https://cdn-us1.hash.ai/polys/crate/model.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/fish/",
    slug: "fish",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/fish/Mesh_Fish.mtl",
      "https://cdn-us1.hash.ai/polys/fish/Mesh_Fish.obj",
      "https://cdn-us1.hash.ai/polys/fish/Tex_Salmon.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/store/",
    slug: "store",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/store/materials.mtl",
      "https://cdn-us1.hash.ai/polys/store/model.obj",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/boat/",
    slug: "boat",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/boat/Tugboat.mtl",
      "https://cdn-us1.hash.ai/polys/boat/Tugboat.obj",
      "https://cdn-us1.hash.ai/polys/boat/Tugboat_BaseColor.png",
    ],
  },
  {
    folderPath: "https://cdn-us1.hash.ai/polys/windturbine/",
    slug: "windturbine",
    resourceUrls: [
      "https://cdn-us1.hash.ai/polys/windturbine/windturbine.mtl",
      "https://cdn-us1.hash.ai/polys/windturbine/windturbine.obj",
    ],
  },
];
