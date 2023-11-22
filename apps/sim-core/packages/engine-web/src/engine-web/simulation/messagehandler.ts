import {
  IncomingMessage,
  MessageHandler,
  MessageHandlerState,
} from "../../glue";

export const builtInMessageHandlers: MessageHandler[] = [
  {
    name: "mapbox",
    handler: async (state: MessageHandlerState, properties: any) =>
      await Promise.all(
        state.get_messages().map((message: IncomingMessage) =>
          self
            .fetch(
              `https://api.mapbox.com/directions/v5/mapbox/${message.data["transportation_method"]}/${message.data["request_route"]}?geometries=geojson&access_token=pk.eyJ1IjoiYmVuZ29sZGhhYmVyIiwiYSI6ImNrN3AzaWE4ZjBnOGUzZG1mMmNqMXN4cDMifQ.nIFHk8XqZR7H8-IqaSKXTA`,
            )
            .then((res) => res.json())
            .then((json) => [json, message.from] as [string, string]),
        ),
      ).then((resultArr: [string, string][]) => {
        resultArr.forEach(([json, fromId]: [string, string]) =>
          state.add_message({
            to: [fromId],
            from: "mapbox",
            type: "mapbox_response",
            data: json,
          }),
        );
        return state;
      }),
  },
];
