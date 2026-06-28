import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { HttpApiTesterPanel } from "./HttpApiTesterPanel";

vi.mock("../../lib/api", () => ({
  sendHttpRequest: vi.fn(async () => ({
    status: 200,
    statusText: "OK",
    elapsedMs: 42,
    sizeBytes: 18,
    receivedAt: "2026-06-28T14:30:00Z",
    headers: [{ key: "content-type", value: "application/json" }],
    body: '{"ok":true}',
  })),
}));

it("renders the lightweight http api tester", () => {
  render(<HttpApiTesterPanel />);

  expect(screen.getByRole("heading", { name: "接口测试" })).toBeInTheDocument();
  expect(screen.getByText("轻量级接口测试工具，支持 GET、POST、PUT、PATCH、DELETE 等常见请求。")).toBeInTheDocument();
  expect(screen.getByLabelText("请求方法")).toHaveValue("GET");
  expect(screen.getByLabelText("请求地址")).toHaveValue("https://api.github.com/users/octocat");
  expect(screen.getByRole("tab", { name: "Headers" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("tab", { name: "认证" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "设置" })).not.toBeInTheDocument();
  expect(screen.getByDisplayValue("Accept")).toBeInTheDocument();
  expect(screen.getByDisplayValue("application/json")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "删除" })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "编辑" })).toHaveLength(2);
});

it("sends a request and shows response metadata", async () => {
  const user = userEvent.setup();
  render(<HttpApiTesterPanel />);

  await user.click(screen.getByRole("button", { name: /发送/ }));

  expect(await screen.findByText("200 OK")).toBeInTheDocument();
  expect(screen.getByText("42ms")).toBeInTheDocument();
  expect(screen.getByText("18 B")).toBeInTheDocument();
  expect(screen.getByText(/\"ok\": true/)).toBeInTheDocument();

  const api = await import("../../lib/api");
  expect(api.sendHttpRequest).toHaveBeenCalledWith({
    method: "GET",
    url: "https://api.github.com/users/octocat",
    headers: [
      { key: "Accept", value: "application/json" },
      { key: "User-Agent", value: "Passion/1.0" },
    ],
    query: [],
    body: null,
  });
});

it("supports query and body tabs", async () => {
  const user = userEvent.setup();
  render(<HttpApiTesterPanel />);

  await user.click(screen.getByRole("tab", { name: "Query" }));
  await user.click(screen.getByRole("button", { name: /添加 Query/ }));
  await user.type(screen.getByLabelText("Query 键 1"), "page");
  await user.type(screen.getByLabelText("Query 值 1"), "1");

  await user.click(screen.getByRole("tab", { name: "Body" }));
  await user.selectOptions(screen.getByLabelText("请求方法"), "POST");
  fireEvent.change(screen.getByLabelText("请求 Body"), {
    target: { value: '{"name":"Passion"}' },
  });
  await user.click(screen.getByRole("button", { name: /发送/ }));

  const api = await import("../../lib/api");
  expect(api.sendHttpRequest).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: "POST",
      query: [{ key: "page", value: "1" }],
      body: '{"name":"Passion"}',
    }),
  );
});
