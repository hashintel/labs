import { describe, expect, it } from "vitest";

import { NO_EDITS, editFile, isEdited, recompiled, shownText, toggleEditing } from "./module-edits";

describe("module edits", () => {
  it("shows an edit in place of the compiled text until the text reads as compiled again", () => {
    // GIVEN editing on, and net.py edited from x = 1 to x = 2
    const edited = editFile(toggleEditing(NO_EDITS), "net.py", "x = 2\n", "x = 1\n");
    // WHEN net.py is edited back to the compiled text
    const restored = editFile(edited, "net.py", "x = 1\n", "x = 1\n");
    // THEN net.py shows its edit while it differs, another file shows what the compiler wrote,
    // and the edit back drops the entry
    expect(isEdited(edited)).toBe(true);
    expect(isEdited(edited, "net.py")).toBe(true);
    expect(shownText(edited, "net.py", "x = 1\n")).toBe("x = 2\n");
    expect(shownText(edited, "place_a.py", "a\n")).toBe("a\n");
    expect(restored).toEqual({ editing: true, texts: {} });
  });

  it("drops the texts on a new compilation and keeps the toggle", () => {
    // GIVEN editing on with net.py edited, and no edits at all
    const edited = editFile(toggleEditing(NO_EDITS), "net.py", "x = 2\n", "x = 1\n");
    // WHEN the module is compiled again
    // THEN the edited texts are gone with editing still on, and no edits stay the same object
    expect(recompiled(edited)).toEqual({ editing: true, texts: {} });
    expect(recompiled(NO_EDITS)).toBe(NO_EDITS);
  });

  it("keeps the edited texts when editing is turned off", () => {
    // GIVEN editing on with net.py edited
    const edited = editFile(toggleEditing(NO_EDITS), "net.py", "x = 2\n", "x = 1\n");
    // WHEN editing is turned off
    const off = toggleEditing(edited);
    // THEN the edit is still there
    expect(off).toEqual({ editing: false, texts: { "net.py": "x = 2\n" } });
  });
});
