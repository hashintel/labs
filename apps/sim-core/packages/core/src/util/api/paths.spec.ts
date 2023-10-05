import * as paths from "./paths";

test("no paths end with a slash", () => {
  for (const path of Object.values(paths)) {
    if (typeof path === "string") {
      expect(path.endsWith("/")).toBe(false);
    }
  }
});
