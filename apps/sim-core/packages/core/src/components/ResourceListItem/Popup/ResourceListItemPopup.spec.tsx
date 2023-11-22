/**
 * @todo this file should use central mocks for projects
 */
import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";

import { HcFileKind } from "../../../features/files/enums";
import {
  HcSharedBehaviorFile,
  HcSharedDatasetFile,
} from "../../../features/files/types";
import { ResourceListItemPopup } from "./ResourceListItemPopup";
import { defaultBehaviorKeys } from "../../../features/files/utils";
import { parse } from "../../../util/files";
import { store } from "../../../features/store";
import { noop } from "lodash";

jest.mock("./util", () => ({ scrollBy: jest.fn() }));

const mockRect: ClientRect = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON: noop,
};

const datasetOne: HcSharedDatasetFile = {
  pathWithNamespace: "@publisher/dataset/one.csv",
  id: "@publisher/dataset/one.csv",
  path: parse("@publisher/dataset/one.csv"),
  repoPath: "data/one.csv",
  kind: HcFileKind.Dataset,
  canUserEdit: true,
  contents: "http://dataset.com/one",
  data: { name: "Dataset One", s3Key: "one.csv", inPlaceData: null },
  latestTag: "1.0.0",
  ref: "1.0.0",
  name: "Dataset One Project",
  visibility: "public",
};

const datasetTwo: HcSharedDatasetFile = {
  pathWithNamespace: "@publisher/dataset/two.csv",
  id: "@publisher/dataset/two.csv",
  path: parse("@publisher/dataset/two.csv"),
  repoPath: "data/two.csv",
  kind: HcFileKind.Dataset,
  canUserEdit: true,
  contents: "http://dataset.com/two",
  data: { name: "Dataset Two", s3Key: "two.csv", inPlaceData: null },
  latestTag: "1.0.0",
  ref: "1.0.0",
  name: "Dataset Two Project",
  visibility: "public",
};

const behaviorOne: HcSharedBehaviorFile = {
  pathWithNamespace: "@publisher/behavior.js",
  id: "@publisher/behavior.js",
  path: parse("@publisher/behavior.js"),
  repoPath: "src/behaviors/behavior.js",
  canUserEdit: true,
  contents: "",
  latestTag: "1.0.0",
  ref: "1.0.0",
  name: "Behavior Project",
  kind: HcFileKind.SharedBehavior,
  visibility: "public",
  keys: defaultBehaviorKeys,
};

it("renders without crashing with one dataset with none present", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ResourceListItemPopup
        position="right"
        targetRect={mockRect}
        popoverRect={mockRect}
        presentItems={[]}
        resource={{
          name: "",
          description: "",
          subject: [{ name: "Thing" }],
          id: "@publisher/resource",
          pathWithNamespace: "@publisher/resource",
          namespace: "publisher",
          keywords: [],
          license: { id: "", name: "" },
          visibility: "public",
          ownerType: "User",
          owner: {
            name: "Publisher",
          },
          trusted: false,
          type: "Dataset",
          createdAt: "",
          updatedAt: "2019-10-01T13:12:11Z",
          files: [datasetOne],
          canUserEdit: true,
          latestRelease: {
            tag: "1.0.0",
            createdAt: "",
          },
        }}
      />
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});

it("renders without crashing with one dataset with it present", () => {
  const div = document.createElement("div");

  ReactDOM.render(
    <Provider store={store}>
      <ResourceListItemPopup
        position="right"
        targetRect={mockRect}
        popoverRect={mockRect}
        presentItems={[datasetOne.pathWithNamespace]}
        resource={{
          name: "",
          description: "",
          trusted: false,
          type: "Dataset",
          createdAt: "",
          updatedAt: "2019-10-01T13:12:11Z",
          subject: [{ name: "Thing" }],
          id: "@publisher/resource",
          pathWithNamespace: "@publisher/resource",
          namespace: "publisher",
          keywords: [],
          license: { id: "", name: "" },
          visibility: "public",
          ownerType: "User",
          owner: {
            name: "Publisher",
          },
          files: [datasetOne],
          canUserEdit: true,
          latestRelease: {
            tag: "1.0.0",
            createdAt: "",
          },
        }}
      />
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});

it("renders without crashing with one trusted dataset with it present", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ResourceListItemPopup
        position="right"
        targetRect={mockRect}
        popoverRect={mockRect}
        presentItems={[datasetOne.pathWithNamespace]}
        resource={{
          name: "",
          description: "",
          trusted: true,
          type: "Dataset",
          createdAt: "",
          updatedAt: "2019-10-01T13:12:11Z",
          subject: [{ name: "Thing" }],
          id: "@publisher/resource",
          pathWithNamespace: "@publisher/resource",
          namespace: "publisher",
          keywords: [],
          license: { id: "", name: "" },
          visibility: "public",
          ownerType: "User",
          owner: {
            name: "Publisher",
          },
          files: [datasetOne],
          canUserEdit: true,
          latestRelease: {
            tag: "1.0.0",
            createdAt: "",
          },
        }}
      />
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});

it("renders without crashing with two datasets with none present", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ResourceListItemPopup
        position="right"
        targetRect={mockRect}
        popoverRect={mockRect}
        presentItems={[]}
        resource={{
          name: "",
          description: "",
          id: "@publisher/resource",
          pathWithNamespace: "@publisher/resource",
          namespace: "publisher",
          keywords: [],
          license: { id: "", name: "" },
          visibility: "public",
          ownerType: "User",
          owner: {
            name: "Publisher",
          },
          trusted: false,
          type: "Dataset",
          createdAt: "",
          updatedAt: "2019-10-01T13:12:11Z",
          subject: [{ name: "Thing" }],
          files: [datasetOne, datasetTwo],
          canUserEdit: true,
          latestRelease: {
            tag: "1.0.0",
            createdAt: "",
          },
        }}
      />
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});

it("renders without crashing with two datasets with one present", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ResourceListItemPopup
        position="right"
        targetRect={mockRect}
        popoverRect={mockRect}
        presentItems={[datasetOne.pathWithNamespace]}
        resource={{
          name: "",
          description: "",
          subject: [{ name: "Thing" }],
          id: "@publisher/resource",
          pathWithNamespace: "@publisher/resource",
          namespace: "publisher",
          keywords: [],
          license: { id: "", name: "" },
          visibility: "public",
          ownerType: "User",
          owner: {
            name: "Publisher",
          },
          trusted: false,
          type: "Dataset",
          createdAt: "",
          updatedAt: "2019-10-01T13:12:11Z",
          files: [datasetOne, datasetTwo],
          canUserEdit: true,
          latestRelease: {
            tag: "1.0.0",
            createdAt: "",
          },
        }}
      />
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});

it("renders without crashing with two datasets with two present", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ResourceListItemPopup
        position="right"
        targetRect={mockRect}
        popoverRect={mockRect}
        presentItems={[
          datasetOne.pathWithNamespace,
          datasetTwo.pathWithNamespace,
        ]}
        resource={{
          name: "",
          description: "",
          subject: [{ name: "Thing" }],
          id: "@publisher/resource",
          pathWithNamespace: "@publisher/resource",
          namespace: "publisher",
          keywords: [],
          license: { id: "", name: "" },
          visibility: "public",
          ownerType: "User",
          owner: {
            name: "Publisher",
          },
          trusted: false,
          type: "Dataset",
          createdAt: "",
          updatedAt: "2019-10-01T13:12:11Z",
          files: [datasetOne, datasetTwo],
          canUserEdit: true,
          latestRelease: {
            tag: "1.0.0",
            createdAt: "",
          },
        }}
      />
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});

it("renders without crashing one behavior with none present", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ResourceListItemPopup
        position="right"
        targetRect={mockRect}
        popoverRect={mockRect}
        presentItems={[]}
        resource={{
          name: "",
          description: "",
          updatedAt: "2019-10-01T13:12:11Z",
          subject: [{ name: "Thing" }],
          id: "@publisher/resource",
          pathWithNamespace: "@publisher/resource",
          namespace: "publisher",
          keywords: [],
          license: { id: "", name: "" },
          visibility: "public",
          ownerType: "User",
          owner: {
            name: "Publisher",
          },
          trusted: false,
          createdAt: "",
          type: "Behavior",
          files: [behaviorOne],
          canUserEdit: true,
          latestRelease: {
            tag: "1.0.0",
            createdAt: "",
          },
        }}
      />
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});

it("renders without crashing one behavior with one present", () => {
  const div = document.createElement("div");
  ReactDOM.render(
    <Provider store={store}>
      <ResourceListItemPopup
        position="right"
        targetRect={mockRect}
        popoverRect={mockRect}
        presentItems={[behaviorOne.pathWithNamespace]}
        resource={{
          name: "",
          description: "",
          updatedAt: "2019-10-01T13:12:11Z",
          subject: [{ name: "Thing" }],
          id: "@publisher/resource",
          pathWithNamespace: "@publisher/resource",
          namespace: "publisher",
          ownerType: "User",
          keywords: [],
          license: { id: "", name: "" },
          visibility: "public",
          owner: {
            name: "Publisher",
          },
          trusted: false,
          createdAt: "",
          type: "Behavior",
          files: [behaviorOne],
          canUserEdit: true,
          latestRelease: {
            tag: "1.0.0",
            createdAt: "",
          },
        }}
      />
    </Provider>,
    div,
  );
  ReactDOM.unmountComponentAtNode(div);
});
