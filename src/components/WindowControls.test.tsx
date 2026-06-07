import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WindowControls } from "./WindowControls";

const minimize = vi.fn();
const hide = vi.fn();
const startDragging = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize,
    hide,
    startDragging,
  }),
}));

it("shows the app title and only minimize and close window controls", async () => {
  const user = userEvent.setup();
  render(<WindowControls />);

  expect(screen.getByText("Passion")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "最小化" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "最大化" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "最小化" }));
  await user.click(screen.getByRole("button", { name: "关闭" }));

  expect(minimize).toHaveBeenCalled();
  expect(hide).toHaveBeenCalled();
});

it("starts dragging from the title area", async () => {
  const user = userEvent.setup();
  render(<WindowControls />);

  await user.pointer({
    keys: "[MouseLeft>]",
    target: screen.getByText("Passion"),
  });

  expect(startDragging).toHaveBeenCalled();
});
