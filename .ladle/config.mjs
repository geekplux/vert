/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: 'src/**/*.stories.tsx',
  // Ladle bundles its own Vite 6; the app's vite.config.ts uses a Vite 8 plugin, so keep them apart.
  viteConfig: '.ladle/vite.config.ts',
};
