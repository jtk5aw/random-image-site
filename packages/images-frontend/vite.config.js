import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Define path aliases here if needed
      // '@': path.resolve(__dirname, 'src')
    },
    extensions: ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json'],
  },
  // Configuration for environment variables
  define: {
    // Fallback for process.env references in the codebase
    "process.env": {},
  },
  // Configure esbuild to handle JSX in .js files
  esbuild: {
    loader: "jsx",
    include: /src\/.*\.jsx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
  // Handle SVG imports
  assetsInclude: ['**/*.svg'],
  css: {
    postcss: './postcss.config.js',
  },
  build: {
    outDir: "dist", // Output directory for Vite build
    sourcemap: true,
  },
  server: {
    port: 3000, // Use the same port as CRA for consistency
    open: true,
  },
});
