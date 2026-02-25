import { emitKeypressEvents } from 'node:readline';

type CancellationController = {
  signal: AbortSignal;
  cancel: () => void;
  dispose: () => void;
};

export function createCancellationController(): CancellationController {
  const controller = new AbortController();
  const cancel = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  const onSigint = () => cancel();
  const onSigterm = () => cancel();

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  const stdin = process.stdin;
  let restoreRawMode = false;
  let restorePaused = false;
  const onKeypress = (_value: string, key?: { name?: string }) => {
    if (key?.name === 'escape') {
      cancel();
    }
  };

  if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
    emitKeypressEvents(stdin);
    stdin.on('keypress', onKeypress);

    if (!stdin.isRaw) {
      stdin.setRawMode(true);
      restoreRawMode = true;
    }

    if (stdin.isPaused()) {
      stdin.resume();
      restorePaused = true;
    }
  }

  const dispose = () => {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);

    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      stdin.removeListener('keypress', onKeypress);
      if (restoreRawMode) {
        stdin.setRawMode(false);
      }
      if (restorePaused) {
        stdin.pause();
      }
    }
  };

  return { signal: controller.signal, cancel, dispose };
}
