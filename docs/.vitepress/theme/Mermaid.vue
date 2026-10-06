<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';

const props = defineProps<{ code: string }>();
const { isDark } = useData();
const svg = ref('');
const minWidth = ref(0);
const error = ref('');
let seq = 0;

// a wide diagram squeezed into the content column ends up with unreadable
// text, so it may shrink to this share of its natural width and scrolls
// sideways beyond that
const MIN_SCALE = 0.75;

// mermaid touches the dom, so it only loads in the browser
async function render() {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark.value ? 'dark' : 'default',
    // wrapped messages keep sequence diagrams from growing as wide as their
    // longest label, and one row of participant boxes is enough
    sequence: { wrap: true, width: 160, actorMargin: 40, mirrorActors: false },
  });
  try {
    const id = `mermaid-${Math.random().toString(36).slice(2)}-${seq++}`;
    svg.value = (await mermaid.render(id, decodeURIComponent(props.code))).svg;
    const viewBox = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) [\d.]+"/.exec(svg.value);
    minWidth.value = viewBox ? Math.round(Number(viewBox[1]) * MIN_SCALE) : 0;
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
    <div v-else :style="{ minWidth: `${minWidth}px` }" v-html="svg" />
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
/* mermaid sizes html labels before they land in .vp-doc, whose taller
   paragraph line-height would otherwise clip every multi-line label */
.mermaid-diagram :deep(svg p) {
  line-height: inherit;
}
.mermaid-error {
  color: var(--vp-c-danger-1);
  white-space: pre-wrap;
}
</style>
