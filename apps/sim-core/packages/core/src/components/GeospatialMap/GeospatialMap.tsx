import React, { FC, useCallback, useEffect, useRef, useState } from "react";
import ReactMapboxGl, { Layer, Popup, Source } from "react-mapbox-gl";
import * as o from "fp-ts/es6/Option";
import * as r from "fp-ts/es6/Record";
import { AgentState } from "@hashintel/engine-web";
import { MapLayerMouseEvent } from "mapbox-gl";
import { debounce } from "lodash";

import { SimulationViewerLazyTab } from "../SimulationViewer/LazyTab/SimulationViewerLazyTab";
import { mapColor } from "../../util/palette";
import { useResizeObserver } from "../../hooks/useResizeObserver/useResizeObserver";

import "mapbox-gl/dist/mapbox-gl.css";
import "./GeospatialMap.css";

export type GeospatialMapProps = {
  simulationStep: AgentState[] | null;
  simulationId: string | null | undefined;
  errored: boolean;
};

type PopupData = {
  coordinates: [number, number];
  description: string;
};

// Injected by vite.
// To specify, add a '.env' file containing, e.g.,
//    MAPBOX_API_TOKEN=pk.eyJ1IjoianV[...]kZWFsbHtbinwPK4yA
// Then rebuild.
const accessToken = import.meta.env.MAPBOX_API_TOKEN;
const MapComponent = accessToken
  ? ReactMapboxGl({
      accessToken,
      trackResize: false,
    })
  : null;

const onClick = (setPopup: (popup: PopupData) => void) => (
  evt: MapLayerMouseEvent
) =>
  setPopup({
    coordinates: evt.lngLat.toArray() as [number, number],
    description: evt.features![0]!.properties!.description,
  });

type AgentStateLngLat = AgentState & {
  lng_lat: [number, number];
};

function hasLngLatNotHidden(agent: AgentState): agent is AgentStateLngLat {
  return (
    agent.lng_lat !== undefined &&
    agent.lng_lat !== null &&
    Array.isArray(agent.lng_lat) &&
    agent.lng_lat.length === 2 &&
    typeof agent.lng_lat[0] === "number" &&
    typeof agent.lng_lat[1] === "number" &&
    !agent.hidden
  );
}

const debounced = debounce((fn) => fn(), 100);

// If there's no MapBox API key, we'll crash instantiating the MapComponent.
// So instead return a placeholder GeospatialMap with user instructions.
const GeospatialMapPlaceholder: FC<GeospatialMapProps> = () => (
  <div style={{ margin: "1em" }}>
    <h3>MapBox requires an API token.</h3>
    <p>
      Please add <code>MAPBOX_API_TOKEN=your-token</code> to the{" "}
      <code>.env</code> file if you wish to enable MapBox.
    </p>
    <p>You can create the .env file if it doesn't exist.</p>
    <p>
      MapBox API access tokens can be found at{" "}
      <a target="_blank" href="https://account.mapbox.com/access-tokens/">
        https://account.mapbox.com/access-tokens/
      </a>
    </p>
  </div>
);

///
/// A simple radio button bar component in HASH's stylings.
///
export const GeospatialMap: FC<GeospatialMapProps> = !MapComponent
  ? GeospatialMapPlaceholder
  : ({ simulationStep, simulationId, errored }) => {
      const lngLatAgents: AgentStateLngLat[] = (simulationStep ?? []).filter(
        hasLngLatNotHidden
      );

      const agentAverageCenter: [number, number] | undefined =
        lngLatAgents.length > 0
          ? (lngLatAgents
              .reduce<[number, number]>(
                (acc, agent) => [
                  acc[0] + agent.lng_lat[0],
                  acc[1] + agent.lng_lat[1],
                ],
                [0, 0]
              )
              .map((val) => val / lngLatAgents.length) as [number, number])
          : undefined;

      const [center, setCenter] = useState<[number, number] | undefined>(
        agentAverageCenter
      );
      const [popup, setPopup] = useState<PopupData | undefined>(undefined);

      useEffect(() => {
        if (center === undefined && agentAverageCenter !== undefined) {
          setCenter(agentAverageCenter);
        }
      }, [center, agentAverageCenter]);

      const instanceRef = useRef<InstanceType<typeof MapComponent>>();

      const setResizeRef = useResizeObserver(() => {
        debounced(() => {
          instanceRef.current?.state.map?.resize();
        });
      });

      const mapRef = useCallback(
        (instance: InstanceType<typeof MapComponent>) => {
          instanceRef.current = instance;
          setResizeRef(instance?.container);
        },
        [setResizeRef]
      );

      if (!simulationStep && simulationId && !errored) {
        return <SimulationViewerLazyTab />;
      }

      return (
        <MapComponent
          ref={mapRef}
          style="mapbox://styles/mapbox/dark-v10"
          center={center ?? [-73.9549, 40.769]}
          onMoveEnd={(updated) =>
            center !== undefined
              ? setCenter(updated.getCenter().toArray() as [number, number])
              : undefined
          }
        >
          <Source
            id="markers"
            geoJsonSource={{
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: lngLatAgents.map((agent, idx) => ({
                  type: "Feature",
                  id: agent.agent_id,
                  geometry: {
                    type: "Point",
                    coordinates: agent.lng_lat,
                  },
                  properties: {
                    description: JSON.stringify(
                      r.filterWithIndex((idx) =>
                        ((agent.popup_fields as Array<string>) ?? []).includes(
                          idx
                        )
                      )(agent),
                      null,
                      2
                    ),
                    agent_idx: idx,
                    color: `#${o.getOrElse(() => "ffffff")(
                      o.map((color: number) => color.toString(16))(
                        mapColor(
                          agent.geo_color ?? agent.color ?? "random",
                          agent.agent_id
                        )
                      )
                    )}`,
                    radius: agent.geo_radius ?? 5,
                    opacity: agent.geo_opacity ?? 1,
                  },
                })),
              },
            }}
          />
          <Layer
            id="marker"
            sourceId="markers"
            type="circle"
            paint={{
              "circle-color": ["get", "color"],
              "circle-radius": ["get", "radius"],
              "circle-opacity": ["get", "opacity"],
            }}
            onClick={onClick(setPopup)}
          />

          {popup && (
            <Popup
              coordinates={popup.coordinates}
              onClick={() => setPopup(undefined)}
            >
              <pre>{popup.description}</pre>
            </Popup>
          )}
        </MapComponent>
      );
    };
