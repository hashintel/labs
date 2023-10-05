import React, { FC, MouseEventHandler, ReactNode } from "react";

import { Avatar, useKeyboardSupport } from "./util";
import { Link } from "../../../Link/Link";
import { Scope } from "../../../../features/scopes";
import { urlFromProject } from "../../../../routes";
import { useConfigHashTourForSlide, useTour } from "../react-shepherd-wrapper";

import "./HashCoreTourStepDone.css";

const ShowcaseItem: FC<{
  name: string;
  thumb?: ReactNode;
  path?: string;
  scope?: Scope;
  onClick?: MouseEventHandler;
  className?: string;
}> = ({ name, thumb, onClick, path = "#", scope, className = "" }) => (
  <Link
    title={name}
    scope={scope}
    path={path}
    onClick={onClick}
    className={`HashCoreTourStepDoneShowcase__Sim ${className}`}
  >
    <div className="HashCoreTourStepDoneShowcase__Sim__Thumb">{thumb}</div>
    <div className="HashCoreTourStepDoneShowcase__Sim__Name">
      <strong>{name}</strong>
    </div>
  </Link>
);

export const HashCoreTourStepDone: FC = () => {
  const tour = useTour();

  const { tourShowcase } = useConfigHashTourForSlide({
    shouldShowBackdrop: true,
    shouldCenter: true,
  });

  useKeyboardSupport(true, false);

  return (
    <>
      <div className="HashCoreTourDone">
        <h2>Congratulations!</h2>
        <p>
          Now you're ready to start building simulations with HASH!
          <br />
          Check out our{" "}
          <a
            href="https://docs.hash.ai/core/tutorials/hello-hash"
            target="_blank"
          >
            Getting Started tutorial
          </a>{" "}
          for more on getting set up.
          <br />
          You can replay this tour at any time from the 'Help' menu at the top
          of the page.
        </p>
        <div className="HashCoreTourStepDoneShowcase">
          {tourShowcase?.map(
            ({ pathWithNamespace, ref, avatar, thumbnail, name }) => (
              <ShowcaseItem
                name={name}
                path={urlFromProject({
                  pathWithNamespace,
                  ref,
                })}
                onClick={() => {
                  tour.complete();
                }}
                key={urlFromProject({
                  pathWithNamespace,
                  ref,
                })}
                thumb={<Avatar avatar={avatar} thumbnail={thumbnail} />}
              />
            )
          )}
          <ShowcaseItem
            name="Create New"
            scope={Scope.newProject}
            path="/new"
            onClick={() => {
              tour.complete();
            }}
            thumb="+"
            className="HashCoreTourStepDoneShowcase__Sim--Create"
          />
        </div>
      </div>
      <button
        className="HashCoreTourDoneButton"
        onClick={() => {
          tour.complete();
        }}
      >
        Alternatively,{" "}
        <strong>click here to continue exploring this simulation</strong>
      </button>
    </>
  );
};
