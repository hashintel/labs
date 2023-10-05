import React, { FC } from "react";
import { useSelector } from "react-redux";
import urljoin from "url-join";

import { FancyButton } from "../../Fancy/Button";
import { HcDependencyFile } from "../../../features/files/types";
import { HcFileKind } from "../../../features/files/enums";
import { IconAlertOutline } from "../../Icon/AlertOutline";
import { Modal } from "../Modal";
import { SITE_URL } from "../../../util/api/paths";
import { Scope, useScope } from "../../../features/scopes";
import { selectCurrentProjectRequired } from "../../../features/project/selectors";
import { selectPrivateDependencies } from "../../../features/files/selectors";

import "./ModalPrivateDependencies.css";

const getPrivateKindsMessage = (files: HcDependencyFile[]) => {
  const kinds = [];

  if (files.some((file) => file.kind === HcFileKind.Dataset)) {
    kinds.push("datasets");
  }

  if (files.some((file) => file.kind === HcFileKind.SharedBehavior)) {
    kinds.push("behaviors");
  }

  return kinds.join(" and ");
};

export const ModalPrivateDependencies: FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const privateDependencies = useSelector(selectPrivateDependencies);
  const privateKinds = getPrivateKindsMessage(privateDependencies);
  const project = useSelector(selectCurrentProjectRequired);
  const canLinkToProjectInIndex = useScope(Scope.linkToProjectInIndex);

  const makeCurrentProjectPrivateText = (
    <>or make the current project private</>
  );

  return (
    <Modal onClose={onClose} modalClassName="ModalPrivateDependencies">
      <IconAlertOutline size={260} />
      <div className="ModalPrivateDependencies__content">
        <h2>This simulation depends on private {privateKinds}:</h2>
        <ul>
          {privateDependencies.map((dependency) => (
            <li key={dependency.path.formatted}>
              <a
                href={urljoin(SITE_URL, dependency.pathWithNamespace)}
                target="_blank"
              >
                {dependency.path.formatted}
              </a>
            </li>
          ))}
        </ul>
        <h4>In order to proceed, please:</h4>
        <ul>
          <li>make the above {privateKinds} publicly visible</li>
          <li>
            {canLinkToProjectInIndex ? (
              <a
                href={urljoin(SITE_URL, project.pathWithNamespace)}
                target="_blank"
              >
                {makeCurrentProjectPrivateText}
              </a>
            ) : (
              makeCurrentProjectPrivateText
            )}
          </li>
          <li>retry releasing this simulation</li>
        </ul>
        <FancyButton theme="black" onClick={onClose}>
          <b>OKAY</b>
        </FancyButton>
      </div>
    </Modal>
  );
};
