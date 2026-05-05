import { curriedQuery } from "./../query";

export const coreVersions = curriedQuery<{ coreVersions: string[] }, undefined>(
  `query { coreVersions }`,
);
