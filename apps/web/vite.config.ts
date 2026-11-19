import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const srcDir = decodeURIComponent(
	new URL("./src", import.meta.url).pathname,
).replace(/^\/([A-Za-z]:\/)/, "$1");

export default defineConfig({
	plugins: [
		vue(),
		tailwindcss(),
		VitePWA({
			registerType: "autoUpdate",
			includeAssets: ["favicon.svg", "pwa-192x192.png", "pwa-512x512.png"],
			manifest: {
				name: "Acanthis",
				short_name: "Acanthis",
				description: "多源轻小说在线阅读与同步客户端",
				start_url: "/",
				display: "standalone",
				background_color: "#f8f7f4",
				theme_color: "#f8f7f4",
				icons: [
					{
						src: "/pwa-192x192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "/pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
					},
					{
						src: "/pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
			workbox: {
				globIgnores: ["**/config.js"],
				navigateFallback: "/index.html",
				navigateFallbackDenylist: [/^\/v1\//, /^\/config\.js$/],
				runtimeCaching: [
					{
						urlPattern: /\/config\.js$/,
						handler: "NetworkOnly",
					},
				],
			},
		}),
	],
	resolve: {
		alias: {
			"@": srcDir,
		},
	},
	worker: {
		format: "es",
	},
});
