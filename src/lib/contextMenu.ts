export function disableBrowserContextMenu(target: Document = document) {
  target.addEventListener("contextmenu", preventContextMenu);
}

function preventContextMenu(event: Event) {
  event.preventDefault();
}
