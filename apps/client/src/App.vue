<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  api,
  attempt,
  error,
  saveConnection,
  serverUrl,
  token,
  type Workspace,
} from "./api";
import ResourceView from "./components/ResourceView.vue";
import ExplorerView from "./components/ExplorerView.vue";
const explorer = ref<InstanceType<typeof ExplorerView>>();
function leave() {
  return explorer.value?.leave() ?? true;
}
function back() {
  if (leave()) selected.value = "";
}
function settings() {
  if (leave()) {
    connected.value = false;
    selected.value = "";
  }
}
function selectResource(id: string) {
  if (id === resourceId.value || leave()) resourceId.value = id;
}
const connected = ref(false);
const busy = ref(false);
const workspaces = ref<Workspace[]>([]);
const selected = ref("");
const resourceId = ref("");
const showCreate = ref(false);
const name = ref("");
const directory = ref("");
const agents = ref<{ id: string; name: string }[]>([]);
const agentId = ref("");
const workspace = computed(() =>
  workspaces.value.find((w) => w.id === selected.value),
);
const resource = computed(() =>
  workspace.value?.resources.find((r) => r.id === resourceId.value),
);
async function refresh() {
  const list = await api<Workspace[]>("/workspaces");
  workspaces.value = list;
  if (selected.value && !list.some((w) => w.id === selected.value))
    selected.value = "";
  if (
    workspace.value &&
    !workspace.value.resources.some((r) => r.id === resourceId.value)
  )
    resourceId.value = workspace.value.resources[0]?.id ?? "";
}
async function connect() {
  busy.value = true;
  await attempt(async () => {
    const config = await api<{
      root: string;
      agents: { id: string; name: string }[];
    }>("/config");
    agents.value = config.agents;
    agentId.value = config.agents[0]?.id ?? "";
    directory.value = config.root;
    await refresh();
    saveConnection();
    connected.value = true;
  });
  busy.value = false;
}
function select(w: Workspace) {
  selected.value = w.id;
  resourceId.value = w.resources[0]?.id ?? "";
}
async function create() {
  await attempt(async () => {
    const w = await api<Workspace>("/workspaces", "POST", {
      name: name.value,
      directory: directory.value,
    });
    await refresh();
    select(w);
    showCreate.value = false;
    name.value = "";
  });
}
async function add(type: "terminal" | "agent") {
  if (!leave()) return;
  busy.value = true;
  await attempt(async () => {
    const r = await api<{ id: string }>(
      `/workspaces/${selected.value}/resources`,
      "POST",
      { type, agentId: agentId.value },
    );
    await refresh();
    resourceId.value = r.id;
  });
  busy.value = false;
}
async function removeWorkspace() {
  if (!confirm("删除 Workspace 并结束其中所有终端和 Agent？项目文件会保留。"))
    return;
  await attempt(async () => {
    await api(`/workspaces/${selected.value}`, "DELETE");
    selected.value = "";
    await refresh();
  });
}
async function removeResource() {
  if (!confirm("结束并移除此资源？")) return;
  await attempt(async () => {
    await api(
      `/workspaces/${selected.value}/resources/${resourceId.value}`,
      "DELETE",
    );
    await refresh();
  });
}
onMounted(() => {
  if (serverUrl.value && token.value) void connect();
});
</script>
<template>
  <main>
    <header>
      <button v-if="workspace" @click="back">‹</button>
      <div class="brand">
        YAMIDE<small>{{ workspace ? workspace.name : "远程工作台" }}</small>
      </div>
      <button @click="settings">连接设置</button>
    </header>
    <div v-if="error" class="error" role="alert">
      {{ error }}<button @click="error = ''">×</button>
    </div>
    <section v-if="!connected" class="connect panel">
      <span class="eyebrow">你的工作现场，一直在线</span>
      <h1>连接工作台</h1>
      <p class="muted">连接电脑上的 YAMIDE Server，使用文件、终端和 Agent。</p>
      <form @submit.prevent="connect">
        <label
          >服务端地址<input
            v-model="serverUrl"
            placeholder="https://your-server:3000"
            type="url"
            required /></label
        ><label
          >访问令牌<input
            v-model="token"
            type="password"
            autocomplete="off"
            required /></label
        ><button class="primary" :disabled="busy">
          {{ busy ? "连接中…" : "连接" }}
        </button>
      </form>
    </section>
    <section v-else-if="!workspace" class="workspace-list">
      <div class="heading">
        <h1>Workspaces</h1>
        <button class="primary" @click="showCreate = !showCreate">
          ＋ 新建</button
        ><button @click="attempt(refresh)">刷新</button>
      </div>
      <form v-if="showCreate" class="panel" @submit.prevent="create">
        <label
          >名称<input
            v-model="name"
            maxlength="100"
            required
            placeholder="我的项目" /></label
        ><label>服务器工作目录<input v-model="directory" required /></label
        ><button class="primary">创建 Workspace</button>
      </form>
      <p v-if="!workspaces.length" class="muted">
        新建 Workspace，开始你的第一项工作。
      </p>
      <button
        v-for="w in workspaces"
        :key="w.id"
        class="workspace-card"
        @click="select(w)"
      >
        <div>
          <strong>{{ w.name }}</strong
          ><small>{{ w.directory }}</small>
        </div>
        <span>{{ w.resources.length }} 个资源 ›</span>
      </button>
      <p class="muted footnote">
        关闭客户端后，Workspace 中的任务继续在服务端运行。
      </p>
    </section>
    <section v-else class="workspace-content">
      <div class="workspace-toolbar">
        <span class="muted">{{ workspace.directory }}</span
        ><button :disabled="busy" @click="add('terminal')">＋ 终端</button
        ><select v-if="agents.length" v-model="agentId" aria-label="Agent 类型">
          <option v-for="a in agents" :key="a.id" :value="a.id">
            {{ a.name }}
          </option></select
        ><button :disabled="busy || !agents.length" @click="add('agent')">
          ＋ Agent</button
        ><button class="danger" @click="removeWorkspace">删除 Workspace</button>
      </div>
      <nav class="tabs">
        <button
          v-for="r in workspace.resources"
          :key="r.id"
          :class="{ active: resourceId === r.id }"
          @click="selectResource(r.id)"
        >
          {{ r.type === "explorer" ? "▣" : r.type === "terminal" ? "›_" : "◇" }}
          {{ r.name }}<small>{{ r.status }}</small>
        </button>
      </nav>
      <div v-if="resource" class="resource-content">
        <ExplorerView
          ref="explorer"
          v-if="resource.type === 'explorer'"
          :key="`${selected}:${resource.id}`"
          :wid="selected"
        /><template v-else
          ><ResourceView
            :key="`${selected}:${resource.id}`"
            :wid="selected"
            :resource="resource"
            @refresh="attempt(refresh)"
          /><button class="danger remove-resource" @click="removeResource">
            结束并移除 {{ resource.name }}
          </button></template
        >
      </div>
      <p v-else class="muted">添加资源以开始工作。</p>
    </section>
  </main>
</template>
