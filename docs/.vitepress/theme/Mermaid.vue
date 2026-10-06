<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';

const props = defineProps<{ code: string }>();
const { isDark } = useData();
const svg = ref('');
const error = ref('');
let seq = 0;

// mermaid touches the dom, so it only loads in the browser
async function render() {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, theme: isDark.value ? 'dark' : 'default' });
  try {
    const id = `mermaid-${Math.random().toString(36).slice(2)}-${seq++}`;
    svg.value = (await mermaid.render(id, decodeURIComponent(props.code))).svg;
    error.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(render);
watch(isDark, render);
</script>

<template>
  <div class="mermaid-diagram">
    <pre v-if="error" class="mermaid-error">{{ error }}</pre>
    <div v-else v-html="svg" />
  </div>
</template>

<style scoped>
.mermaid-diagram {
  margin: 16px 0;
  overflow-x: auto;
}
.mermaid-diagram :deep(svg) {
  max-width: 100%;
  height: auto;
}
.mermaid-error {
  color: var(--vp-c-danger-1);
  white-space: pre-wrap;
}
</style>
