/**
 * This is here to "yield" to allow React/the browser to do other stuff
 *
 * @see https://surma.dev/things/when-workers/
 */

const { port1, port2 } = new MessageChannel();
port2.start();

export const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    const uid = Math.random();
    port2.addEventListener(
      "message",
      function yieldToBrowserMessageHandler(ev) {
        if (ev.data === uid) {
          port2.removeEventListener("message", yieldToBrowserMessageHandler);
          resolve();
        }
      }
    );
    port1.postMessage(uid);
  });
