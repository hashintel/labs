import React from "react";
import { createRoot } from "react-dom/client";

import { LoadingIcon } from "./components/LoadingIcon";
import { basicUser } from "./util/api/queries/basicUser";
import { getEmbedParams } from "./util/getEmbedParams";
import { unpreparedProjectByPath } from "./util/api/queries/unpreparedProjectByPath";

import "./styles.css";

document.documentElement.classList.add("embed");
const root = createRoot(document.getElementById("root")!);
root.render(<LoadingIcon fullScreen />);

const params = getEmbedParams();

const projectPromise = unpreparedProjectByPath(
  params.project,
  params.ref
);
// @todo remove this
const basicUserPromise = basicUser();

import(
  /* webpackChunkName: "embed-boot" */ "./components/EmbedApp/bootEmbed"
).then(({ bootEmbed }) => bootEmbed(params, projectPromise, basicUserPromise));
