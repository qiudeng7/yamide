<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, attempt } from "../api";
const props = defineProps<{ wid: string }>();
const path = ref(".");
const entries = ref<{ name: string; directory: boolean; symlink: boolean }[]>(
  [],
);
const file = ref("");
const content = ref("");
const original = ref("");
const saved = ref(false);
function leave() {
  return content.value === original.value || confirm("放弃未保存的修改？");
}
async function list() {
  await attempt(async () => {
    entries.value = await api(
      `/workspaces/${props.wid}/files?path=${encodeURIComponent(path.value)}`,
    );
  });
}
async function open(entry: { name: string; directory: boolean }) {
  if (!leave()) return;
  const target =
    path.value === "." ? entry.name : `${path.value}/${entry.name}`;
  if (entry.directory) {
    path.value = target;
    file.value = "";
    await list();
  } else
    await attempt(async () => {
      const data = await api<{ content: string }>(
        `/workspaces/${props.wid}/file?path=${encodeURIComponent(target)}`,
      );
      file.value = target;
      content.value = data.content;
      original.value = data.content;
      saved.value = false;
    });
}
async function up() {
  if (!leave()) return;
  file.value = "";
  path.value = path.value.split("/").slice(0, -1).join("/") || ".";
  await list();
}
async function save() {
  await attempt(async () => {
    await api(`/workspaces/${props.wid}/file`, "PUT", {
      path: file.value,
      content: content.value,
    });
    original.value = content.value;
    saved.value = true;
  });
}
defineExpose({ leave });
onMounted(list);
</script>
<template>
  <div class="explorer">
    <div class="file-toolbar">
      <button :disabled="path === '.'" @click="up">上一级</button
      ><span>{{ path }}</span
      ><button @click="list">刷新</button>
    </div>
    <div v-if="!file" class="file-list">
      <button v-for="entry in entries" :key="entry.name" @click="open(entry)">
        <span>{{ entry.directory ? "▣" : "▤" }}</span
        >{{ entry.name }}<small v-if="entry.symlink">链接</small>
      </button>
      <p v-if="!entries.length" class="muted">空目录</p>
    </div>
    <template v-else
      ><div class="file-toolbar">
        <button
          @click="
            () => {
              if (leave()) file = '';
            }
          "
        >
          返回</button
        ><span>{{ file }}</span
        ><button class="primary" @click="save">
          {{ saved && content === original ? "已保存" : "保存" }}
        </button>
      </div>
      <textarea
        v-model="content"
        class="file-editor"
        spellcheck="false"
        aria-label="文件内容"
      ></textarea>
    </template>
  </div>
</template>
