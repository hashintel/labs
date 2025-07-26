import { Ext } from "./enums";
import type { FilePathParts, ParsedPath } from "./types";
import { parse } from "./parse";

describe("parse", () => {
  it.each`
    input                                        | name                          | ext         | base                               | dir                           | root   | formatted
    ${"description"}                             | ${"README"}                   | ${Ext.Md}   | ${"README.md"}                     | ${""}                         | ${""}  | ${"README.md"}
    ${"initialState"}                            | ${"init"}                     | ${Ext.Json} | ${"init.json"}                     | ${""}                         | ${""}  | ${"init.json"}
    ${"properties"}                              | ${"globals"}                  | ${Ext.Json} | ${"globals.json"}                  | ${""}                         | ${""}  | ${"globals.json"}
    ${"analysis"}                                | ${"analysis"}                 | ${Ext.Json} | ${"analysis.json"}                 | ${""}                         | ${""}  | ${"analysis.json"}
    ${"behavior"}                                | ${"behavior"}                 | ${Ext.Js}   | ${"behavior.js"}                   | ${""}                         | ${""}  | ${"behavior.js"}
    ${"behavior.py"}                             | ${"behavior"}                 | ${Ext.Py}   | ${"behavior.py"}                   | ${""}                         | ${""}  | ${"behavior.py"}
    ${"loading"}                                 | ${"loading"}                  | ${Ext.Txt}  | ${"loading.txt"}                   | ${""}                         | ${""}  | ${"loading.txt"}
    ${"/5e3de630a4edb3a224fb6019.csv"}           | ${"5e3de630a4edb3a224fb6019"} | ${Ext.Csv}  | ${"5e3de630a4edb3a224fb6019.csv"}  | ${""}                         | ${"/"} | ${"/5e3de630a4edb3a224fb6019.csv"}
    ${"/5e41c771a4edb31d5cfb602b.json"}          | ${"5e41c771a4edb31d5cfb602b"} | ${Ext.Json} | ${"5e41c771a4edb31d5cfb602b.json"} | ${""}                         | ${"/"} | ${"/5e41c771a4edb31d5cfb602b.json"}
    ${"@ciaran/test-behavior"}                   | ${"test-behavior"}            | ${Ext.Js}   | ${"test-behavior.js"}              | ${"ciaran"}                   | ${"@"} | ${"@ciaran/test-behavior.js"}
    ${"@5dadbd3ca8c33362e61876bd/test-behavior"} | ${"test-behavior"}            | ${Ext.Js}   | ${"test-behavior.js"}              | ${"5dadbd3ca8c33362e61876bd"} | ${"@"} | ${"@5dadbd3ca8c33362e61876bd/test-behavior.js"}
    ${"built-in.rs"}                             | ${"built-in"}                 | ${Ext.Rs}   | ${"built-in.rs"}                   | ${""}                         | ${""}  | ${"built-in.rs"}
    ${"@hash/datapack/some.csv"}                 | ${"some"}                     | ${Ext.Csv}  | ${"some.csv"}                      | ${"hash/datapack"}            | ${"@"} | ${"@hash/datapack/some.csv"}
  `('parse("$input")', ({ input, name, ext, base, dir, root, formatted }) => {
    expect(parse(input)).toEqual({ name, ext, base, dir, root, formatted });
  });

  const filePartTests: [
    FilePathParts,
    Omit<ParsedPath, keyof FilePathParts>,
  ][] = [
    [
      {
        name: "description",
        ext: Ext.Md,
        dir: "",
        root: "",
      },
      { base: "description.md", formatted: "description.md" },
    ],
    [
      {
        name: "5e3de630a4edb3a224fb6019",
        ext: Ext.Csv,
        dir: "",
        root: "/",
      },
      {
        base: "5e3de630a4edb3a224fb6019.csv",
        formatted: "/5e3de630a4edb3a224fb6019.csv",
      },
    ],
    [
      {
        name: "test-behavior",
        ext: Ext.Js,
        dir: "ciaran",
        root: "@",
      },
      { base: "test-behavior.js", formatted: "@ciaran/test-behavior.js" },
    ],
  ];

  it.each(filePartTests)("parse(%j)", (input, output) => {
    expect(parse(input)).toEqual({ ...input, ...output });
  });

  // TODO: @mysterycommand - what should it do if it can't match? e.g. bad "ext"
});
