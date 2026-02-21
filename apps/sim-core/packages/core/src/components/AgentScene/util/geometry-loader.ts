import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

import { BUILTIN_MODELS, BUILTIN_MODELS_DB } from "./builtinmodels";

export type RawGeometry = [THREE.BufferGeometry, THREE.Material];

export const loadGeometryMesh = async (
  userMeshName: string,
  num: number,
): Promise<RawGeometry> => {
  switch (userMeshName) {
    case "box":
      return geoHelper("BoxGeometry", num, [1, 1, 1]);
    case "cone":
      const [geo, mat] = geoHelper("ConeGeometry", num, [0.5, 1, 30]);
      // Our cones point in the forward direction
      // Cones normally point up
      // We need to rotate them so they point the correct direction
      geo.rotateX(Math.PI);
      geo.rotateY(Math.PI / 2);
      return [geo, mat];
    case "flatplane":
      const [geoPlane, matPlane] = geoHelper("PlaneGeometry", num, [1, 1]);
      geoPlane.translate(0, 0, -0.5);
      return [geoPlane, matPlane];
    case "cylinder":
      return geoHelper("CylinderGeometry", num, [0.5, 0.5]);
    case "dodecahedron":
      return geoHelper("DodecahedronGeometry", num, [0.5]);
    case "icosahedron":
      return geoHelper("IcosahedronGeometry", num, [0.5]);
    case "octahedron":
      return geoHelper("OctahedronGeometry", num, [0.5]);
    case "sphere":
      return geoHelper("SphereGeometry", num, [0.5]);
    case "tetrahedron":
      return geoHelper("TetrahedronGeometry", num, [0.5]);
    case "torus":
      return geoHelper("TorusGeometry", num, [0.3, 0.2, 10, 10]);
    case "torusknot":
      return geoHelper("TorusKnotGeometry", num, [0.3, 0.2, 10, 10]);
    case "pickedAgent":
      return pickedMesh();
    default:
      try {
        const model = await polyLoader(userMeshName);
        return model;
      } catch {
        // Fail through and produce a box
        return geoHelper("BoxGeometry", num, [1, 1, 1]);
      }
  }
};

type SupportedShapes =
  | "BoxGeometry"
  | "ConeGeometry"
  | "PlaneGeometry"
  | "CylinderGeometry"
  | "DodecahedronGeometry"
  | "IcosahedronGeometry"
  | "OctahedronGeometry"
  | "SphereGeometry"
  | "TetrahedronGeometry"
  | "TorusGeometry"
  | "TorusKnotGeometry";

/**
 * Create a new InstanceMesh from a geometry name and constructor parameters
 */
const geoHelper = (
  geoType: SupportedShapes,
  numMeshes: number,
  args: number[],
): RawGeometry => {
  const geometry = new THREE[geoType](...args);
  geometry.computeVertexNormals();

  const colors = new Float32Array(numMeshes * 3).map(() => 0);
  geometry.setAttribute("color", new THREE.InstancedBufferAttribute(colors, 3));
  const material = new THREE.MeshPhongMaterial({
    vertexColors: true,
    shininess: 0.1,
    reflectivity: 0.1,
  });
  return [geometry, material];
};

const pickedMesh = (): RawGeometry => {
  const coneGeometry = new THREE.ConeGeometry();
  coneGeometry.scale(0.2, 0.2, 0.2);
  coneGeometry.rotateX(Math.PI);
  coneGeometry.translate(0, 0.8, 0);

  const boxGeometry = new THREE.BoxGeometry();
  boxGeometry.scale(1.05, 1.05, 1.05);

  const merged = mergeGeometries([coneGeometry, boxGeometry], false);
  if (!merged) throw new Error("Failed to merge picked-agent geometry");

  merged.rotateX(Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: "white",
    wireframe: true,
  });

  return [merged, material];
};

/**
 * Fetch a model from the API and return its geoemtry and materials
 */
export const polyLoader = async (meshName: string): Promise<RawGeometry> => {
  // Check for a built-in and any specific rotation information
  const builtin = BUILTIN_MODELS[meshName];
  if (!builtin) {
    throw new Error(`Unrecognised meshName ${meshName}`);
  }

  const { rotX, rotY, rotZ } = builtin;

  const { folderPath, objectUrl, materialUrl } =
    await fetchPolyFromBuiltinDb(meshName);

  // Three has built-in loaders that know how to fetch from URLs, but the most reliable
  // method is to just fetch the texts manually and have the loaders parse them
  const [objText, mtlText] = await Promise.all([
    fetch(objectUrl).then((rawObj) => rawObj.text()),
    fetch(materialUrl).then((rawMtl) => rawMtl.text()),
  ]);

  const materialLoader = new MTLLoader();

  // Need to set this, otherwise meshes will end up black
  materialLoader.setMaterialOptions({
    ignoreZeroRGBs: true,
  });

  const materials = materialLoader.parse(mtlText, folderPath);

  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);

  const mergedGeometries: THREE.BufferGeometry[] = [];
  const mergedMaterials: THREE.Material[] = [];

  objLoader.parse(objText).traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      mergedGeometries.push(obj.geometry);
      mergedMaterials.push(obj.material);
    }
  });

  mergedMaterials.concat(Object.values(materials.materials));
  const geometry = mergeGeometries(mergedGeometries, true);

  const material = mergedMaterials[0] ?? new THREE.MeshStandardMaterial();

  // Resize the mesh to fit within a single cube
  const boundingBox = new THREE.Box3();
  const sizingMesh = new THREE.Mesh(geometry, material);
  boundingBox.setFromObject(sizingMesh);
  const size = boundingBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  geometry.scale(1 / maxDim, 1 / maxDim, 1 / maxDim);

  // Move the mesh down so it sits at the floor of the bounding box
  geometry.translate(0, -(1 - size.y / maxDim) / 2, 0);

  // We need to align the coordinate systems of the normal geometry and the models
  geometry.rotateX(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();

  // Apply any builtin-specific rotation
  geometry.rotateX((rotX ?? 0) * (Math.PI / 180));
  geometry.rotateY((rotY ?? 0) * (Math.PI / 180));
  geometry.rotateZ((rotZ ?? 0) * (Math.PI / 180));

  return [geometry, material];
};

const fetchPolyFromBuiltinDb = async (slug: string) => {
  const { folderPath, resourceUrls } = BUILTIN_MODELS_DB.find((model) => {
    return model.slug === slug;
  }) || { folderPath: null, resourceUrls: [] };

  if (!folderPath) {
    throw new Error("No folderPath found for built-in model " + slug);
  }

  const objectUrl = resourceUrls.find((url) =>
    url.toLowerCase().endsWith(".obj"),
  );

  if (!objectUrl) {
    throw new Error("No .obj file found for built-in model " + slug);
  }

  const materialUrl = resourceUrls.find((url) =>
    url.toLowerCase().endsWith(".mtl"),
  );

  if (!materialUrl) {
    throw new Error("No .mtl file found for built-in model " + slug);
  }

  return {
    folderPath,
    objectUrl,
    materialUrl,
  };
};
