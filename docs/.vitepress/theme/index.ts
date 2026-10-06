import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import Mermaid from './Mermaid.vue';
import ApiReference from './ApiReference.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Mermaid', Mermaid);
    app.component('ApiReference', ApiReference);
  },
} satisfies Theme;
