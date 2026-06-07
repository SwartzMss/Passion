import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WorkbenchHome } from "./WorkbenchHome";

it("shows assistant feature cards", () => {
  render(
    <WorkbenchHome
      pendingReminderCount={2}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={() => {}}
      onOpenSettings={() => {}}
    />,
  );

  expect(screen.getByText("提醒")).toBeInTheDocument();
  expect(screen.getByText("2 个待提醒")).toBeInTheDocument();
  expect(screen.getByText("翻译")).toBeInTheDocument();
  expect(screen.getByText("网络检测")).toBeInTheDocument();
});

it("opens translation from the workbench", async () => {
  const user = userEvent.setup();
  const onOpenTranslation = vi.fn();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={onOpenTranslation}
      onOpenNetworkDiagnostics={() => {}}
      onOpenSettings={() => {}}
    />,
  );

  await user.click(screen.getByRole("button", { name: "开始翻译" }));

  expect(onOpenTranslation).toHaveBeenCalledOnce();
});

it("opens network diagnostics from the workbench", async () => {
  const user = userEvent.setup();
  const onOpenNetworkDiagnostics = vi.fn();
  render(
    <WorkbenchHome
      pendingReminderCount={0}
      onOpenReminders={() => {}}
      onAddReminder={() => {}}
      onOpenTranslation={() => {}}
      onOpenNetworkDiagnostics={onOpenNetworkDiagnostics}
      onOpenSettings={() => {}}
    />,
  );

  await user.click(screen.getByRole("button", { name: "开始检测" }));

  expect(onOpenNetworkDiagnostics).toHaveBeenCalledOnce();
});
