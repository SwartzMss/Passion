import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";

export function WindowControls() {
  const appWindow = getCurrentWindow();

  function startDragging(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    appWindow.startDragging().catch((err) => {
      console.error("failed to start window dragging", err);
    });
  }

  return (
    <div className="window-frame">
      <div
        className="window-titlebar"
        onMouseDown={startDragging}
      >
        <span className="window-title">Passion</span>
      </div>
      <div className="window-controls">
        <button
          type="button"
          aria-label="最小化"
          title="最小化"
          onClick={() => appWindow.minimize()}
        >
          -
        </button>
        <button
          type="button"
          aria-label="关闭"
          title="关闭"
          onClick={() => appWindow.hide()}
        >
          x
        </button>
      </div>
    </div>
  );
}
