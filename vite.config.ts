import { defineConfig, type Plugin } from 'vite';

type Target = 'youtube' | 'native' | 'web';

/** Injects the YouTube Playables SDK as the very first script, only for the YouTube build. */
function playablesSdk(target: Target): Plugin {
  return {
    name: 'playables-sdk',
    transformIndexHtml(html) {
      const tag = target === 'youtube' ? '<script src="https://www.youtube.com/game_api/v1"></script>' : '';
      return html.replace('<!--YT_SDK-->', tag);
    },
  };
}

export default defineConfig(({ mode }) => {
  const target: Target = mode === 'youtube' ? 'youtube' : mode === 'native' ? 'native' : 'web';
  return {
    base: './',
    plugins: [playablesSdk(target)],
    define: { __PLATFORM__: JSON.stringify(target) },
    build: {
      target: 'es2020',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 1500,
      reportCompressedSize: true,
      rolldownOptions: {
        output: {
          // Keeps every file under YouTube's recommended 512 KiB.
          advancedChunks: {
            groups: [
              { name: 'three-core', test: /three\.core\.js/, priority: 2 },
              { name: 'three', test: /node_modules[\\/]three/, priority: 1 },
            ],
          },
        },
      },
    },
    server: { host: true },
  };
});
