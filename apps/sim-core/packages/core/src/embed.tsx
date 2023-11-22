import React from "react";
import { render } from "react-dom";

import { LoadingIcon } from "./components/LoadingIcon";
import { basicUser } from "./util/api/queries/basicUser";
import { getEmbedParams } from "./util/getEmbedParams";
import { unpreparedProjectByPath } from "./util/api/queries/unpreparedProjectByPath";

import "./styles.css";

document.documentElement.classList.add("embed");
render(<LoadingIcon fullScreen />, document.getElementById("root"));

const params = getEmbedParams();

const projectPromise = unpreparedProjectByPath(
  params.project,
  params.ref,
  params.access?.code,
);
// @todo remove this
const basicUserPromise = basicUser();

import(
  /* webpackChunkName: "embed-boot" */ "./components/EmbedApp/bootEmbed"
).then(({ bootEmbed }) => bootEmbed(params, projectPromise, basicUserPromise));
