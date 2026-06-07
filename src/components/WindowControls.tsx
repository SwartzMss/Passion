import { getCurrentWindow } from "@tauri-apps/api/window";

export function WindowControls() {
  const appWindow = getCurrentWindow();

  return (
    <div className="window-frame" data-tauri-drag-region>
      <div className="window-drag-region" data-tauri-drag-region />
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
          onClick={() => appWindow.close()}
        >
          x
        </button>
      </div>
    </div>
  );
}
