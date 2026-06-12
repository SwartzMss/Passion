// @ts-expect-error This test reads a source file; the app tsconfig does not include Node types.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const styles = readFileSync("src/styles.css", "utf8");

it("keeps the app shell from creating page-level horizontal overflow", () => {
  expect(styles).toMatch(/html,\s*body\s*{[^}]*overflow-x:\s*hidden;/s);
  expect(styles).toMatch(/\.app-shell\s*{[^}]*box-sizing:\s*border-box;/s);
});
