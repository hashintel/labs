import { closeSearch, openSearch, searchReducer } from "./slice";

describe("search reducer", () => {
  it("should have a 'normal' initial state", () => {
    expect(searchReducer(undefined, { type: "" })).toEqual({
      open: false,
    });
  });

  describe("openSearch", () => {
    it("should set open to true", () => {
      expect(searchReducer(undefined, openSearch())).toEqual({ open: true });
    });
  });

  describe("closeSearch", () => {
    it("should set open to false", () => {
      expect(searchReducer(undefined, closeSearch())).toEqual({ open: false });
    });
  });
});
