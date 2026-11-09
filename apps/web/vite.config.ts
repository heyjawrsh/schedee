import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	// Tauri expects a fixed port and fails fast if it is taken.
	server: { port: 5173, strictPort: true },
	clearScreen: false,
});
