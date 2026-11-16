/**
 * This is here to "yield" to allow React/the browser to do other stuff
 *
 * @see https://surma.dev/things/when-workers/
 */

const { port1, port2 } = new MessageChannel();
port2.start();

function correlationToken(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}

export const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    const uid = correlationToken();
    port2.addEventListener(
      "message",
      function yieldToBrowserMessageHandler(ev) {
        if (ev.data === uid) {
          port2.removeEventListener("message", yieldToBrowserMessageHandler);
          resolve();
        }
      },
    );
    port1.postMessage(uid);
  });
