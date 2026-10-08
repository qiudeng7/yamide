<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  api,
  attempt,
  serverUrl,
  token,
  type Resource,
  type RuntimeEvent,
} from "../api";
const props = defineProps<{ wid: string; resource: Resource }>();
const emit = defineEmits<{ refresh: [] }>();
const terminalHost = ref<HTMLDivElement>();
const connection = ref("连接中");
const status = ref(props.resource.status);
const draft = ref("");
const log = ref<{ kind: string; text: string }[]>([]);
type Permission = {
  id: string;
  toolCall: { title: string };
  options: { optionId: string; name: string }[];
};
const permissions = ref<Permission[]>([]);
let socket: WebSocket | undefined;
let terminal: Terminal | undefined;
let fit: FitAddon | undefined;
let observer: ResizeObserver | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let disposed = false;
let lastMessage = Date.now();
const path = `/workspaces/${props.wid}/resources/${props.resource.id}`;
function send(data: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}
function resize() {
  try {
    fit?.fit();
    if (terminal)
      send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
  } catch {
    /* Wait for layout. */
  }
}
function append(kind: string, text: string) {
  const last = log.value.at(-1);
  if (last?.kind === kind && kind === "assistant") last.text += text;
  else log.value.push({ kind, text });
  if (log.value.length > 500) log.value.shift();
}
function event(e: RuntimeEvent) {
  if (e.type === "output") terminal?.write(e.data as string);
  if (e.type === "status") {
    status.value = (e.data as Resource).status;
    emit("refresh");
  }
  if (e.type === "removed" || e.type === "workspace-removed") {
    disposed = true;
    socket?.close();
    emit("refresh");
  }
  if (e.type === "user-message") append("user", e.data as string);
  if (e.type === "stderr") append("system", e.data as string);
  if (e.type === "turn-end") append("system", "本轮结束");
  if (e.type === "permission-resolved")
    permissions.value = permissions.value.filter(
      (p) => p.id !== (e.data as { id: string }).id,
    );
  if (e.type === "agent-update") {
    const u = e.data as {
      sessionUpdate: string;
      content?: { type: string; text?: string };
      title?: string;
      status?: string;
      entries?: unknown;
    };
    if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text")
      append("assistant", u.content.text ?? "");
    else if (u.sessionUpdate === "agent_thought_chunk") return;
    else if (
      u.sessionUpdate === "tool_call" ||
      u.sessionUpdate === "tool_call_update"
    )
      append("tool", `${u.title ?? "工具"} · ${u.status ?? ""}`);
    else if (u.sessionUpdate === "plan")
      append("tool", JSON.stringify(u.entries));
  }
}
async function syncPermissions() {
  if (props.resource.type === "agent" && status.value !== "exited")
    await attempt(async () => {
      permissions.value = await api<Permission[]>(`${path}/permissions`);
    });
}
function connect() {
  if (disposed) return;
  connection.value = "连接中";
  try {
    const url = new URL("/ws", serverUrl.value);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.onopen = () => {
      send({
        type: "attach",
        token: token.value,
        wid: props.wid,
        rid: props.resource.id,
      });
    };
    socket.onmessage = (msg) => {
      lastMessage = Date.now();
      const data = JSON.parse(msg.data) as {
        type: string;
        resource: Resource;
        events: RuntimeEvent[];
        event: RuntimeEvent;
        message?: string;
      };
      if (data.type === "snapshot") {
        terminal?.reset();
        log.value = [];
        status.value = data.resource.status;
        for (const e of data.events) event(e);
        connection.value = "已连接";
        resize();
        void syncPermissions();
      }
      if (data.type === "event") {
        event(data.event);
        if (data.event.type === "permission") void syncPermissions();
      }
      if (data.type === "error") connection.value = data.message ?? "连接错误";
    };
    socket.onclose = (e) => {
      connection.value = e.code === 1008 ? "认证失败" : "已断开，正在重连";
      if (!disposed && e.code !== 1008) retry = setTimeout(connect, 2000);
    };
    socket.onerror = () => {
      connection.value = "连接失败";
    };
  } catch {
    connection.value = "地址无效";
  }
}
async function prompt() {
  await attempt(async () => {
    await api(`${path}/prompt`, "POST", { text: draft.value });
    draft.value = "";
  });
}
async function approve(id: string, optionId?: string) {
  await attempt(async () => {
    await api(`${path}/permissions/${id}`, "POST", { optionId });
    await syncPermissions();
  });
}
onMounted(async () => {
  if (props.resource.type === "terminal") {
    await nextTick();
    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      scrollback: 5000,
      theme: { background: "#131923", foreground: "#e2e8f0" },
    });
    fit = new FitAddon();
    terminal.loadAddon(fit);
    if (terminalHost.value) {
      terminal.open(terminalHost.value);
      observer = new ResizeObserver(resize);
      observer.observe(terminalHost.value);
    }
    terminal.onData((data) => send({ type: "input", data }));
  }
  connect();
  heartbeat = setInterval(() => {
    if (
      socket?.readyState === WebSocket.OPEN &&
      Date.now() - lastMessage > 45000
    )
      socket.close();
    else send({ type: "ping" });
  }, 15000);
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(retry);
  clearInterval(heartbeat);
  socket?.close();
  observer?.disconnect();
  terminal?.dispose();
});
</script>
<template>
  <div class="resource-view">
    <div class="resource-status">
      <span>{{ connection }}</span
      ><span>{{ status }}</span
      ><span v-if="resource.error">{{ resource.error }}</span>
    </div>
    <template v-if="resource.type === 'terminal'">
      <div ref="terminalHost" class="terminal-host"></div>
      <div class="keys">
        <button
          v-for="key in [
            { name: 'Esc', data: '\x1b' },
            { name: 'Tab', data: '\t' },
            { name: 'Ctrl+C', data: '\x03' },
            { name: '↑', data: '\x1b[A' },
            { name: '↓', data: '\x1b[B' },
            { name: '←', data: '\x1b[D' },
            { name: '→', data: '\x1b[C' },
          ]"
          :key="key.name"
          @click="
            send({ type: 'input', data: key.data });
            terminal?.focus();
          "
        >
          {{ key.name }}
        </button>
      </div>
    </template>
    <template v-else>
      <div class="agent-log">
        <p v-if="!log.length" class="muted">
          发送一个任务，Agent 会在 Workspace 中工作。
        </p>
        <article v-for="(item, i) in log" :key="i" :class="item.kind">
          <small>{{ item.kind }}</small>
          <pre>{{ item.text }}</pre>
        </article>
      </div>
      <div v-for="p in permissions" :key="p.id" class="permission">
        <strong>{{ p.toolCall.title }}</strong>
        <div>
          <button
            v-for="o in p.options"
            :key="o.optionId"
            @click="approve(p.id, o.optionId)"
          >
            {{ o.name }}</button
          ><button @click="approve(p.id)">取消</button>
        </div>
      </div>
      <form class="composer" @submit.prevent="prompt">
        <textarea
          v-model="draft"
          placeholder="让 Agent 帮你完成任务…"
          rows="3"
        ></textarea>
        <div>
          <button
            type="button"
            @click="
              attempt(async () => {
                await api(`${path}/cancel`, 'POST');
              })
            "
          >
            停止</button
          ><button
            class="primary"
            :disabled="status !== 'idle' || !draft.trim()"
          >
            发送
          </button>
        </div>
      </form>
    </template>
  </div>
</template>
