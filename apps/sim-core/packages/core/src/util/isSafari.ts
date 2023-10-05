export const isSafari = () =>
  navigator.userAgent.includes("Safari") &&
  !navigator.userAgent.includes("Chrome");

export const safariVersion = () => {
  const match = navigator.userAgent.match(/Version\/(\d+)\.(\d+).(\d+)/);
  if (!match) {
    return;
  }
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
  };
};
