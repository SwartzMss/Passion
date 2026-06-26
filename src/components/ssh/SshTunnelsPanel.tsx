import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import {
  createSshTunnel,
  deleteSshTunnel,
  getSshTunnelSettings,
  listSshTunnels,
  startSshTunnel,
  stopSshTunnel,
  updateSshTunnel,
  updateSshTunnelSettings,
} from "../../lib/api";
import type {
  NewSshTunnel,
  SshTunnelBindAddress,
  SshTunnelInfo,
  SshTunnelStatus,
} from "../../types";

type Filter = "all" | "running" | "stopped" | "error";
type Mode = "list" | "create" | "edit";

const DEFAULT_FORM = {
  name: "",
  description: "",
  localPort: "8080",
  bindAddress: "127.0.0.1" as SshTunnelBindAddress,
  remoteHost: "",
  remotePort: "22",
  username: "",
  keyPath: "",
};

export function SshTunnelsPanel() {
  const [tunnels, setTunnels] = useState<SshTunnelInfo[]>([]);
  const [sshExecutablePath, setSshExecutablePath] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("list");
  const [editingTunnel, setEditingTunnel] = useState<SshTunnelInfo | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function refresh() {
    setTunnels(await listSshTunnels());
  }

  async function loadSettings() {
    const settings = await getSshTunnelSettings();
    setSshExecutablePath(settings.sshExecutablePath ?? "");
  }

  useEffect(() => {
    refresh().catch((err) => setError(readError(err)));
    loadSettings().catch((err) => setError(readError(err)));
  }, []);

  const counts = useMemo(
    () => ({
      all: tunnels.length,
      running: tunnels.filter((tunnel) => tunnel.status === "running").length,
      stopped: tunnels.filter((tunnel) => tunnel.status === "stopped").length,
      error: tunnels.filter((tunnel) => tunnel.status === "error").length,
    }),
    [tunnels],
  );

  const visibleTunnels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tunnels.filter((tunnel) => {
      if (filter !== "all" && tunnel.status !== filter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [
        tunnel.name,
        tunnel.description ?? "",
        tunnel.remoteHost,
        tunnel.username,
        String(tunnel.localPort),
        String(tunnel.remotePort),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [filter, query, tunnels]);

  async function mutate(action: () => Promise<void>) {
    setError(null);
    setIsBusy(true);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(readError(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function saveSshExecutablePath() {
    await mutate(async () => {
      const settings = await updateSshTunnelSettings({
        sshExecutablePath: sshExecutablePath.trim(),
      });
      setSshExecutablePath(settings.sshExecutablePath ?? "");
    });
  }

  async function chooseSshExecutable() {
    const selected = await open({ directory: false, multiple: false });
    if (typeof selected === "string") {
      setSshExecutablePath(selected);
    }
  }

  async function choosePrivateKey() {
    const selected = await open({ directory: false, multiple: false });
    if (typeof selected === "string") {
      setForm((current) => ({ ...current, keyPath: selected }));
    }
  }

  function openCreate() {
    setError(null);
    setEditingTunnel(null);
    setForm(DEFAULT_FORM);
    setMode("create");
  }

  function openEdit(tunnel: SshTunnelInfo) {
    setError(null);
    setEditingTunnel(tunnel);
    setForm({
      name: tunnel.name,
      description: tunnel.description ?? "",
      localPort: String(tunnel.localPort),
      bindAddress: tunnel.bindAddress,
      remoteHost: tunnel.remoteHost,
      remotePort: String(tunnel.remotePort),
      username: tunnel.username,
      keyPath: tunnel.keyPath,
    });
    setMode("edit");
  }

  async function submitForm() {
    const validation = validateForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    const payload: NewSshTunnel = {
      name: form.name.trim(),
      description: form.description.trim() ? form.description.trim() : null,
      localPort: Number(form.localPort),
      bindAddress: form.bindAddress,
      remoteHost: form.remoteHost.trim(),
      remotePort: Number(form.remotePort),
      username: form.username.trim(),
      keyPath: form.keyPath.trim(),
    };
    await mutate(async () => {
      if (mode === "edit" && editingTunnel) {
        await updateSshTunnel(editingTunnel.id, payload);
      } else {
        await createSshTunnel(payload);
      }
      setMode("list");
      setEditingTunnel(null);
      setForm(DEFAULT_FORM);
    });
  }

  if (mode !== "list") {
    return (
      <section className="ssh-panel">
        <Header />
        {error ? <p className="error" role="alert">{error}</p> : null}
        <article className="ssh-form-panel">
          <div className="ssh-form-heading">
            <h2>{mode === "edit" ? "编辑隧道" : "新建隧道"}</h2>
            <button type="button" onClick={() => setMode("list")}>取消</button>
          </div>
          <div className="ssh-form-grid">
            <label className="field-label">
              隧道名称
              <input
                aria-label="隧道名称"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="field-label">
              描述
              <input
                aria-label="描述"
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </label>
            <label className="field-label">
              本地端口
              <input
                aria-label="本地端口"
                inputMode="numeric"
                type="number"
                value={form.localPort}
                onChange={(event) =>
                  setForm({ ...form, localPort: event.target.value })
                }
              />
            </label>
            <fieldset className="ssh-bind-field">
              <legend>绑定地址</legend>
              <label>
                <input
                  checked={form.bindAddress === "127.0.0.1"}
                  name="bind-address"
                  onChange={() => setForm({ ...form, bindAddress: "127.0.0.1" })}
                  type="radio"
                />
                仅本机访问
              </label>
              <label>
                <input
                  checked={form.bindAddress === "0.0.0.0"}
                  name="bind-address"
                  onChange={() => setForm({ ...form, bindAddress: "0.0.0.0" })}
                  type="radio"
                />
                允许外部访问
              </label>
            </fieldset>
            <label className="field-label">
              远程地址
              <input
                aria-label="远程地址"
                value={form.remoteHost}
                onChange={(event) =>
                  setForm({ ...form, remoteHost: event.target.value })
                }
              />
            </label>
            <label className="field-label">
              远程端口
              <input
                aria-label="远程端口"
                inputMode="numeric"
                type="number"
                value={form.remotePort}
                onChange={(event) =>
                  setForm({ ...form, remotePort: event.target.value })
                }
              />
            </label>
            <label className="field-label">
              用户名
              <input
                aria-label="用户名"
                value={form.username}
                onChange={(event) =>
                  setForm({ ...form, username: event.target.value })
                }
              />
            </label>
            <label className="field-label ssh-file-field">
              私钥文件
              <span>
                <input
                  aria-label="私钥文件"
                  value={form.keyPath}
                  onChange={(event) =>
                    setForm({ ...form, keyPath: event.target.value })
                  }
                />
                <button type="button" onClick={choosePrivateKey}>
                  选择私钥
                </button>
              </span>
            </label>
          </div>
          <div className="ssh-form-actions">
            <button type="button" onClick={() => setMode("list")}>
              取消
            </button>
            <button
              className="primary-action"
              disabled={isBusy}
              onClick={submitForm}
              type="button"
            >
              {mode === "edit" ? "保存" : "创建并启动"}
            </button>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="ssh-panel">
      <Header />
      {error ? <p className="error" role="alert">{error}</p> : null}

      <article className="ssh-settings-panel">
        <label className="field-label">
          SSH 程序路径
          <input
            aria-label="SSH 程序路径"
            placeholder="未配置时自动检测 PATH 中的 ssh.exe"
            value={sshExecutablePath}
            onChange={(event) => setSshExecutablePath(event.target.value)}
          />
        </label>
        <div className="ssh-row-actions">
          <button disabled={isBusy} onClick={chooseSshExecutable} type="button">
            选择 SSH 程序
          </button>
          <button disabled={isBusy} onClick={saveSshExecutablePath} type="button">
            保存 SSH 路径
          </button>
        </div>
      </article>

      <div className="ssh-toolbar">
        <div className="ssh-filters" aria-label="SSH 隧道筛选">
          <FilterButton active={filter === "all"} count={counts.all} label="全部" onClick={() => setFilter("all")} />
          <FilterButton active={filter === "running"} count={counts.running} label="运行中" onClick={() => setFilter("running")} />
          <FilterButton active={filter === "stopped"} count={counts.stopped} label="已停止" onClick={() => setFilter("stopped")} />
          <FilterButton active={filter === "error"} count={counts.error} label="异常" onClick={() => setFilter("error")} />
        </div>
        <input
          aria-label="搜索 SSH 隧道"
          placeholder="搜索名称、地址、用户或端口"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="primary-action" onClick={openCreate} type="button">
          新建隧道
        </button>
      </div>

      <div className="ssh-table-wrap">
        {visibleTunnels.length === 0 ? (
          <div className="empty-state">没有 SSH 隧道</div>
        ) : (
          <table aria-label="SSH 隧道列表" className="ssh-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>本地端口</th>
                <th>目标</th>
                <th>用户</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleTunnels.map((tunnel) => (
                <tr key={tunnel.id}>
                  <td>
                    <strong>{tunnel.name}</strong>
                    {tunnel.description ? <p>{tunnel.description}</p> : null}
                    {tunnel.errorMessage ? (
                      <p className="ssh-error-detail">{tunnel.errorMessage}</p>
                    ) : null}
                  </td>
                  <td>{tunnel.bindAddress}:{tunnel.localPort}</td>
                  <td>{tunnel.remoteHost}:{tunnel.remotePort}</td>
                  <td>{tunnel.username}</td>
                  <td>
                    <span className={`ssh-status ${tunnel.status}`}>
                      {statusLabel(tunnel.status)}
                    </span>
                  </td>
                  <td>
                    <div className="ssh-row-actions">
                      {tunnel.status === "running" ? (
                        <button disabled={isBusy} onClick={() => mutate(() => stopSshTunnel(tunnel.id).then(() => undefined))} type="button">
                          停止
                        </button>
                      ) : null}
                      {tunnel.status === "stopped" ? (
                        <>
                          <button disabled={isBusy} onClick={() => mutate(() => startSshTunnel(tunnel.id).then(() => undefined))} type="button">
                            启动
                          </button>
                          <button disabled={isBusy} onClick={() => openEdit(tunnel)} type="button">
                            编辑
                          </button>
                          <button disabled={isBusy} onClick={() => mutate(() => deleteSshTunnel(tunnel.id))} type="button">
                            删除
                          </button>
                        </>
                      ) : null}
                      {tunnel.status === "error" ? (
                        <>
                          <button disabled={isBusy} onClick={() => mutate(() => startSshTunnel(tunnel.id).then(() => undefined))} type="button">
                            重启
                          </button>
                          <button disabled={isBusy} onClick={() => openEdit(tunnel)} type="button">
                            编辑
                          </button>
                          <button disabled={isBusy} onClick={() => mutate(() => deleteSshTunnel(tunnel.id))} type="button">
                            删除
                          </button>
                        </>
                      ) : null}
                      {tunnel.status === "starting" ? (
                        <button disabled={isBusy} onClick={() => mutate(() => stopSshTunnel(tunnel.id).then(() => undefined))} type="button">
                          取消
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Header() {
  return (
    <div className="ssh-hero">
      <div>
        <h1>SSH 隧道</h1>
        <p className="muted">管理本地端口转发隧道。</p>
      </div>
    </div>
  );
}

function FilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? "active" : ""}
      onClick={onClick}
      type="button"
    >
      {label} {count}
    </button>
  );
}

function validateForm(form: typeof DEFAULT_FORM) {
  if (!form.name.trim()) {
    return "隧道名称不能为空。";
  }
  const localPortError = validatePort(form.localPort, "本地端口");
  if (localPortError) {
    return localPortError;
  }
  if (!form.remoteHost.trim()) {
    return "远程地址不能为空。";
  }
  const remotePortError = validatePort(form.remotePort, "远程端口");
  if (remotePortError) {
    return remotePortError;
  }
  if (!form.username.trim()) {
    return "用户名不能为空。";
  }
  if (!form.keyPath.trim()) {
    return "私钥文件不能为空。";
  }
  return null;
}

function validatePort(value: string, label: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return `${label}必须是 1 到 65535 之间的整数。`;
  }
  return null;
}

function statusLabel(status: SshTunnelStatus) {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "error":
      return "异常";
    case "stopped":
      return "已停止";
  }
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "操作失败。";
}
