import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import {
  createSshTunnel,
  deleteSshTunnel,
  listSshTunnels,
  startSshTunnel,
  stopSshTunnel,
  updateSshTunnel,
} from "../../lib/api";
import type {
  NewSshTunnel,
  SshTunnelBindAddress,
  SshTunnelInfo,
  SshTunnelStatus,
} from "../../types";

type Filter = "all" | "running" | "stopped";
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

  useEffect(() => {
    refresh().catch((err) => setError(readError(err)));
  }, []);

  const counts = useMemo(
    () => ({
      all: tunnels.length,
      running: tunnels.filter((tunnel) => visualStatus(tunnel.status) === "running").length,
      stopped: tunnels.filter((tunnel) => visualStatus(tunnel.status) === "stopped").length,
    }),
    [tunnels],
  );

  const visibleTunnels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return tunnels.filter((tunnel) => {
      if (filter !== "all" && visualStatus(tunnel.status) !== filter) {
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
  const isFilteredEmpty = tunnels.length > 0 && visibleTunnels.length === 0;

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

  function closeForm() {
    setError(null);
    setMode("list");
    setEditingTunnel(null);
    setForm(DEFAULT_FORM);
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

  return (
    <section className="ssh-panel">
      <Header />
      {error && mode === "list" ? <p className="error" role="alert">{error}</p> : null}

      <div className="ssh-toolbar">
        <div className="ssh-filters" aria-label="SSH 隧道筛选">
          <FilterButton active={filter === "all"} count={counts.all} label="全部" onClick={() => setFilter("all")} />
          <FilterButton active={filter === "running"} count={counts.running} label="运行中" onClick={() => setFilter("running")} />
          <FilterButton active={filter === "stopped"} count={counts.stopped} label="已停止" onClick={() => setFilter("stopped")} />
        </div>
        <label className="ssh-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="搜索 SSH 隧道"
            placeholder="搜索隧道名称、目标或用户名"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="primary-action" onClick={openCreate} type="button">
          新建隧道
        </button>
      </div>

      <div className="ssh-table-wrap">
        <h2>隧道列表</h2>
        {visibleTunnels.length === 0 ? (
          <div className="ssh-empty-state">
            <div className="ssh-empty-content">
              <SshEmptyIcon />
              <strong>{isFilteredEmpty ? "没有匹配的隧道" : "暂无 SSH 隧道"}</strong>
              <p>
                {isFilteredEmpty
                  ? "调整搜索条件或切换筛选状态后再试。"
                  : "创建一个本地端口转发后，隧道会显示在这里。"}
              </p>
            </div>
          </div>
        ) : (
          <div className="ssh-table-shell">
            <table aria-label="SSH 隧道列表" className="ssh-table">
              <SshTunnelTableHead />
              <tbody>
                {visibleTunnels.map((tunnel) => (
                  <SshTunnelRow
                    isBusy={isBusy}
                    key={tunnel.id}
                    onDelete={() => mutate(() => deleteSshTunnel(tunnel.id))}
                    onEdit={() => openEdit(tunnel)}
                    onStart={() => mutate(() => startSshTunnel(tunnel.id).then(() => undefined))}
                    onStop={() => mutate(() => stopSshTunnel(tunnel.id).then(() => undefined))}
                    tunnel={tunnel}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="ssh-table-summary">
          共 {visibleTunnels.length} 条
          <span>|</span>
          运行中: {counts.running}
          <span>|</span>
          已停止: {counts.stopped}
        </div>
      </div>

      {mode !== "list" ? (
        <div className="modal-backdrop" role="presentation">
          <div
            aria-labelledby="ssh-tunnel-form-title"
            aria-modal="true"
            className="modal ssh-tunnel-modal"
            role="dialog"
          >
            <div className="modal-title ssh-form-heading">
              <h2 id="ssh-tunnel-form-title">
                {mode === "edit" ? "编辑隧道" : "新建隧道"}
              </h2>
              <button
                aria-label={mode === "edit" ? "关闭编辑隧道" : "关闭新建隧道"}
                onClick={closeForm}
                type="button"
              >
                ×
              </button>
            </div>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div className="ssh-form-grid">
              <label className="field-label">
                <span><RequiredMark />隧道名称</span>
                <input
                  aria-label="隧道名称"
                  placeholder="请输入隧道名称"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
              <label className="field-label">
                <span><RequiredMark />本地端口</span>
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
              <label className="field-label">
                <span><RequiredMark />远程地址</span>
                <input
                  aria-label="远程地址"
                  placeholder="如：192.168.1.10"
                  value={form.remoteHost}
                  onChange={(event) =>
                    setForm({ ...form, remoteHost: event.target.value })
                  }
                />
              </label>
              <label className="field-label">
                <span><RequiredMark />远程端口</span>
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
                <span><RequiredMark />用户名</span>
                <input
                  aria-label="用户名"
                  placeholder="如：root"
                  value={form.username}
                  onChange={(event) =>
                    setForm({ ...form, username: event.target.value })
                  }
                />
              </label>
              <label className="field-label ssh-file-field">
                <span><RequiredMark />私钥文件</span>
                <span>
                  <input
                    aria-label="私钥文件"
                    placeholder="选择私钥文件（如：id_rsa）"
                    value={form.keyPath}
                    onChange={(event) =>
                      setForm({ ...form, keyPath: event.target.value })
                    }
                  />
                  <button type="button" onClick={choosePrivateKey}>
                    选择文件
                  </button>
                </span>
              </label>
            </div>
            <div className="modal-actions ssh-form-actions">
              <button type="button" onClick={closeForm}>
                取消
              </button>
              <button
                className="primary-action"
                disabled={isBusy}
                onClick={submitForm}
                type="button"
              >
                {mode === "edit" ? (
                  "保存"
                ) : (
                  <>
                    <span aria-hidden="true">▷</span>
                    保存并启动
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RequiredMark() {
  return <span className="ssh-required-mark" aria-hidden="true">*</span>;
}

function SshTunnelTableHead() {
  return (
    <>
      <colgroup>
        <col className="ssh-col-name" />
        <col className="ssh-col-local-port" />
        <col className="ssh-col-remote-target" />
        <col className="ssh-col-username" />
        <col className="ssh-col-status" />
        <col className="ssh-col-actions" />
      </colgroup>
      <thead>
        <tr>
          <th>名称</th>
          <th>本地端口</th>
          <th>远程目标</th>
          <th>用户名</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
    </>
  );
}

function SshTunnelRow({
  isBusy,
  onDelete,
  onEdit,
  onStart,
  onStop,
  tunnel,
}: {
  isBusy: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onStart: () => void;
  onStop: () => void;
  tunnel: SshTunnelInfo;
}) {
  const remoteTarget = `${tunnel.remoteHost}:${tunnel.remotePort}`;
  return (
    <tr>
      <td>
        <SshTunnelNameCell tunnel={tunnel} />
      </td>
      <td>{tunnel.localPort}</td>
      <td className="ssh-text-cell" title={remoteTarget}>{remoteTarget}</td>
      <td className="ssh-text-cell" title={tunnel.username}>{tunnel.username}</td>
      <td>
        <span className={`ssh-status ${visualStatus(tunnel.status)}`}>
          {statusLabel(tunnel.status)}
        </span>
      </td>
      <td>
        <SshTunnelActions
          isBusy={isBusy}
          onDelete={onDelete}
          onEdit={onEdit}
          onStart={onStart}
          onStop={onStop}
          status={tunnel.status}
        />
      </td>
    </tr>
  );
}

function SshTunnelNameCell({ tunnel }: { tunnel: SshTunnelInfo }) {
  return (
    <div className="ssh-name-cell" title={tunnel.name}>
      <strong>{tunnel.name}</strong>
      {tunnel.description ? <small>{tunnel.description}</small> : null}
    </div>
  );
}

function SshTunnelActions({
  isBusy,
  onDelete,
  onEdit,
  onStart,
  onStop,
  status,
}: {
  isBusy: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onStart: () => void;
  onStop: () => void;
  status: SshTunnelStatus;
}) {
  const isRunning = status === "running";
  const isStarting = status === "starting";
  const mainLabel = isRunning ? "停止" : isStarting ? "取消" : "启动";
  const mainAction = isRunning || isStarting ? onStop : onStart;
  const lockMutatingActions = isRunning || isStarting;

  return (
    <div className="ssh-row-actions">
      <span className="ssh-action-slot">
        <button disabled={isBusy} onClick={mainAction} type="button">
          {mainLabel}
        </button>
      </span>
      <span className="ssh-action-slot">
        <button disabled={isBusy || lockMutatingActions} onClick={onEdit} type="button">
          编辑
        </button>
      </span>
      <span className="ssh-action-slot">
        <button disabled={isBusy || lockMutatingActions} onClick={onDelete} type="button">
          删除
        </button>
      </span>
    </div>
  );
}

function Header() {
  return (
    <div className="ssh-hero">
      <div>
        <h1>SSH 隧道</h1>
        <p className="muted">通过 SSH 端口转发访问远程设备和服务。</p>
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
      <span>{label}</span>
      <strong>{count}</strong>
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
  return visualStatus(status) === "running" ? "运行中" : "已停止";
}

function SshEmptyIcon() {
  return (
    <svg aria-hidden="true" className="ssh-empty-icon" viewBox="0 0 64 64">
      <path d="M18 36 32 24l14 12v15H18V36Z" />
      <path d="M12 31 32 14l20 17" />
      <path d="M26 51V39h12v12" />
      <path d="M14 51h36" />
    </svg>
  );
}

function visualStatus(status: SshTunnelStatus): "running" | "stopped" {
  return status === "running" || status === "starting" ? "running" : "stopped";
}

function readError(err: unknown) {
  if (typeof err === "object" && err && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "操作失败。";
}
