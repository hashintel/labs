import React, { FC, memo, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { navigate } from "hookrouter";

import { DiscordWidget } from "../DiscordWidget";
import { HashCoreAccessGate } from "./AccessGate/HashCoreAccessGate";
import { HashCoreHeader, HashCoreMain } from ".";
import { HashCoreTour } from "./Tour";
import { SimulationProjectWithHcFiles } from "../../features/project/types";
import { ToastManager } from "../Toast";
import {
  description as defaultMetaDescription,
  image as defaultMetaImage,
} from "../../metaTags.json";
import { localStorageProjectKey } from "../../util/localStorageProjectKey";
import {
  selectAccessGate,
  selectCurrentProject,
} from "../../features/project/selectors";
import { selectDidSave, selectFileIds } from "../../features/files/selectors";
import { setProjectWithMeta } from "../../features/actions";
import {
  toggleActivity,
  toggleEditor,
  toggleViewer,
} from "../../features/viewer/slice";
import { trackEvent } from "../../features/analytics";
import { urlFromProject } from "../../routes";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useParameterisedUi } from "../../hooks/useParameterisedUi";
import { useSaveOrFork } from "../../hooks/useSaveOrFork";
import { useShouldUnload } from "../../hooks/shouldUnload";

export const HashCore: FC = memo(function HashCore() {
  const dispatch = useDispatch();

  const project = useSelector(selectCurrentProject);
  const fileIds = useSelector(selectFileIds);
  const accessGate = useSelector(selectAccessGate);
  const didSave = useSelector(selectDidSave);

  useParameterisedUi();

  const firstLoadTracked = useRef(false);
  useEffect(() => {
    if (project && !firstLoadTracked.current) {
      dispatch(
        trackEvent({
          action: "Open Project",
          label: `${project.type} - ${project.pathWithNamespace} - ${project.ref} - From direct link`,
          context: {
            type: project.type,
          },
        })
      );
      firstLoadTracked.current = true;
    }
  }, [dispatch, project]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        /**
         * `document.hasFocus() ||` is a Safari workaround, storage events fire
         * even in the same tab
         *
         * @see: https://bugs.webkit.org/show_bug.cgi?id=210512
         * @see: https://github.com/hashintel/internal/pull/1549
         */
        document.hasFocus() ||
        !(
          project &&
          /**
           * This is not sufficient because a project's local storage key can
           * be changed by user interaction (renaming a project, changing
           * ownership, etc).
           *
           * @todo Handle this edge case
           */
          event.key === localStorageProjectKey(project) &&
          event.newValue
        )
      ) {
        return;
      }

      const nextProject: SimulationProjectWithHcFiles = JSON.parse(
        event.newValue
      );

      dispatch(setProjectWithMeta(nextProject, { replaceTabs: false }));
      navigate(urlFromProject(nextProject), true, {}, false);
    };

    window.addEventListener("storage", onStorage, { passive: true });
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [dispatch, project, fileIds]);

  useShouldUnload(didSave);

  const [saveOrFork] = useSaveOrFork();

  useKeyboardShortcuts({
    meta: {
      async s() {
        await saveOrFork();
      },
    },
    metaShift: {
      a() {
        dispatch(toggleActivity());
      },
      e() {
        dispatch(toggleEditor());
      },
      y() {
        dispatch(toggleViewer());
      },
    },
  });

  useEffect(() => {
    document.title = `HASH Core ${project ? ` - ${project.name}` : ""}`;
  }, [project, project?.name]);

  useEffect(() => {
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", project?.description || defaultMetaDescription);
    document
      .querySelector('meta[name="twitter:description"]')
      ?.setAttribute("content", project?.description || defaultMetaDescription);
    document
      .querySelector('meta[name="twitter:image"]')
      ?.setAttribute(
        "content",
        project?.image || project?.thumbnail || defaultMetaImage
      );
  }, [project?.description, project?.image, project?.thumbnail]);

  return (
    <HashCoreTour>
      <ToastManager />
      <HashCoreHeader />
      {accessGate ? (
        <HashCoreAccessGate accessGate={accessGate} />
      ) : project ? (
        <HashCoreMain />
      ) : null}
      <DiscordWidget />
    </HashCoreTour>
  );
});
