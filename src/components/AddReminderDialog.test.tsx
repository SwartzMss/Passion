import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AddReminderDialog } from "./AddReminderDialog";

it("rejects empty title", async () => {
  const user = userEvent.setup();
  render(<AddReminderDialog onCancel={() => {}} onSave={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.getByText("Title is required.")).toBeInTheDocument();
});

it("saves valid reminder", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<AddReminderDialog onCancel={() => {}} onSave={onSave} />);

  await user.type(screen.getByLabelText("Title"), "Pay rent");
  await user.type(screen.getByLabelText("Date and time"), "2099-01-01T09:00");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(onSave).toHaveBeenCalledWith({
    title: "Pay rent",
    notes: null,
    remindAt: new Date("2099-01-01T09:00").toISOString(),
  });
});
