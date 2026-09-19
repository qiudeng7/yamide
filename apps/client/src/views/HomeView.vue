<script setup lang="ts">
import { ref } from 'vue'
const status = ref('未连接')
async function checkServer() { status.value = '检查中…'; try { status.value = (await fetch('/api/health')).ok ? '服务端在线' : '服务端异常' } catch { status.value = '无法连接服务端' } }
</script>
<template><main class="home"><p class="eyebrow">YAMIDE</p><h1>远程工作台</h1><p class="description">终端、资源管理器、Agent 与浏览器的统一入口。</p><button type="button" @click="checkServer">检查服务端</button><p class="status">{{ status }}</p></main></template>
<style scoped>
.home { max-width: 720px; margin: 0 auto; padding: 15vh 24px; }.eyebrow { color: #64748b; font-size: .8rem; letter-spacing: .2em; } h1 { margin: 16px 0 8px; font-size: clamp(2.5rem, 8vw, 5rem); }.description, .status { color: #64748b; } button { margin-top: 24px; border: 0; border-radius: 10px; padding: 12px 18px; background: #111827; color: white; cursor: pointer; }
</style>
