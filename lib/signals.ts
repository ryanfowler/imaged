export const onSignals = (signals: string[]): Promise<string> => {
  return new Promise((resolve) => {
    let resolved = false;
    signals.forEach((sig) => {
      process.on(sig, () => {
        if (!resolved) {
          resolve(sig);
        }
        resolved = true;
      });
    });
  });
};
