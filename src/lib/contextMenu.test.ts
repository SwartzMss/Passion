import { expect, it, vi } from "vitest";
import { disableBrowserContextMenu } from "./contextMenu";

it("prevents the WebView browser context menu", () => {
  const document = new Document();
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  const preventDefault = vi.spyOn(event, "preventDefault");

  disableBrowserContextMenu(document);
  document.dispatchEvent(event);

  expect(preventDefault).toHaveBeenCalled();
});
