import React, { FC, MouseEventHandler, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";

import { Ext } from "../../../util/files/enums";
import type { HcSharedBehaviorFile } from "../../../features/files/types";
import { IconInformationOutline } from "../../Icon";
import { LinkBehavior } from "../../Link/LinkBehavior";
import type { ParsedPath } from "../../../util/files/types";
import { SimulationProject } from "../../../features/project/types";
import { destinationPathInUse, parse } from "../../../util/files";
import { forkOpenBehavior } from "../../../features/files/slice";
import { selectIdKindAndPathFromFiles } from "../../../features/files/selectors";
import { useModalNameBehavior } from "../../HashCore/Files/hooks/useModalNameBehavior";

import "../FileBanner.css";
import "./FileBannerShared.css";

interface FileBannerSharedProps {
  file: HcSharedBehaviorFile;
  project: SimulationProject;
}

export const FileBannerShared: FC<FileBannerSharedProps> = ({
  file,
  project,
}) => {
  const destination = useMemo(
    () => parse({ name: file.path.name, ext: file.path.ext }),
    [file],
  );

  const dispatch = useDispatch();

  const copy = (destination: ParsedPath) => {
    dispatch(forkOpenBehavior({ source: file, destination, project }));
  };

  const showModalNameBehavior = useModalNameBehavior(
    {
      action: "Fork",
      placeholder: "Name your forked behavior",
      onSubmit: copy,
    },
    destination,
  );

  const files = useSelector(selectIdKindAndPathFromFiles);

  const onClick: MouseEventHandler = (evt) => {
    evt.preventDefault();

    if (file.path.ext !== Ext.Rs && file.latestTag) {
      if (destinationPathInUse(files, file.id, destination)) {
        showModalNameBehavior();
      } else {
        copy(destination);
      }
    }
  };

  return (
    <div className="FileBanner FileBannerShared" onClick={onClick}>
      <IconInformationOutline size={51} />
      <p>
        <strong>
          This is an imported behavior that is currently in read-only mode;
        </strong>{" "}
        click here to create a local ‘fork’ of it within this simulation
        (references to this behavior will need to be updated to use its new
        local name).{" "}
        <LinkBehavior file={file} onClick={(evt) => evt.stopPropagation()}>
          Alternatively, click here to{" "}
          {file.canUserEdit ? <>edit</> : <>view</>} the behavior in its
          original context.
        </LinkBehavior>
      </p>
    </div>
  );
};
