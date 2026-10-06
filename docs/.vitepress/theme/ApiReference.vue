<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { useData, withBase } from 'vitepress';

// scalar needs the dom, so it only loads in the browser
const ScalarReference = defineAsyncComponent(async () => {
  await import('@scalar/api-reference/style.css');
  return (await import('@scalar/api-reference')).ApiReference;
});

const { isDark } = useData();

const configuration = computed(() => ({
  // written by `npm run openapi:export --workspace=backend`
  url: withBase('/openapi.json'),
  // the document's own server is "/", which on this site would be the docs
  // host, so requests go to a server the reader names instead
  servers: [
    {
      url: '{server}',
      description: 'Your Sluby server',
      variables: {
        server: {
          default: 'http://localhost:8080',
          description: 'Where the Studio and API are reachable',
        },
      },
    },
  ],
  authentication: { preferredSecurityScheme: 'bearerAuth' },
  showExtensions: ['x-required-scope'],
  forceDarkModeState: isDark.value ? 'dark' : 'light',
  hideDarkModeToggle: true,
  // the defaults reach out to scalar's services: web fonts from their cdn,
  // an ai chat backed by their api, and buttons that send the reader to
  // their hosted client, mcp generator and publishing toolbar
  withDefaultFonts: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  hideClientButton: true,
  showDeveloperTools: 'never',
}));
</script>

<template>
  <ClientOnly>
    <!-- vp-raw keeps vitepress's router off scalar's own hash links -->
    <div class="api-reference vp-raw">
      <ScalarReference :configuration="configuration" />
    </div>
  </ClientOnly>
</template>

<style scoped>
.api-reference {
  --scalar-custom-header-height: var(--vp-nav-height);
  --scalar-font: var(--vp-font-family-base);
  --scalar-font-code: var(--vp-font-family-mono);
}
/* scalar's headings take their size from the element around them, as they do
   in its standalone build, but vitepress gives every heading a fixed size */
.api-reference :deep(:is(h1, h2, h3, h4, h5, h6)) {
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
}
</style>
